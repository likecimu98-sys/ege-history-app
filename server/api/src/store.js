'use strict';

const { EventEmitter } = require('events');
const { pool, tx } = require('./db');
const { canonicalFor } = require('./auth');
const { mergeStateJson } = require('./state-merge');
const { sha256 } = require('./crypto');

const COLLECTIONS = Object.freeze({
  students: 'student_profiles',
  state: 'student_states',
  teachers: 'teacher_profiles',
  orgs: 'organizations',
  classes: 'classes',
  matches: 'duel_matches',
  loginTokens: 'login_tokens',
  loginSessions: 'login_sessions',
  notifyJobs: 'notification_jobs',
  config: 'app_config',
  leaderboards: 'leaderboards',
});

const PUBLIC_STUDENT_FIELDS = new Set([
  'name', 'username', 'classCode', 'totalSolved', 'egePoints', 'weeklyScore', 'weeklyEgePoints',
  'weekStartStr', 'duelRating', 'duelElo', 'duelGames', 'duelWins', 'duelLosses', 'duelDraws', 'lastActive'
]);
const TEACHER_STUDENT_WRITE_FIELDS = new Set([
  'pendingAssignments', 'revokedAssignments', 'inviteClassCode', 'inviteAt', 'leftClassAt', 'classCode',
  '_mergedInto', '_mergedAt', '_mergedFrom'
]);

function parsePath(raw) {
  const path = String(raw || '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  if (parts.length !== 6 || parts[0] !== 'artifacts' || parts[2] !== 'public' && parts[2] !== 'private' || parts[3] !== 'data') {
    const error = new Error('invalid_document_path');
    error.statusCode = 400;
    throw error;
  }
  const collection = parts[4];
  const table = COLLECTIONS[collection];
  if (!table) {
    const error = new Error('unknown_collection');
    error.statusCode = 400;
    throw error;
  }
  if (collection === 'state' && parts[2] !== 'private') throw Object.assign(new Error('invalid_state_path'), { statusCode: 400 });
  if (collection !== 'state' && parts[2] !== 'public') throw Object.assign(new Error('invalid_visibility'), { statusCode: 400 });
  if (!parts[5] || parts[5].length > 500) throw Object.assign(new Error('invalid_document_id'), { statusCode: 400 });
  return { path, appId: parts[1], visibility: parts[2], collection, table, docId: parts[5] };
}

function collectionFromPath(raw) {
  const path = String(raw || '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  if (parts.length !== 5) throw Object.assign(new Error('invalid_collection_path'), { statusCode: 400 });
  return parsePath(`${path}/_query_`);
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function opKind(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value.__vpsOp : null;
}

function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function applyPatch(current, patch, merge) {
  const target = merge ? { ...(current || {}) } : {};
  for (const [key, raw] of Object.entries(patch || {})) {
    const kind = opKind(raw);
    if (kind === 'delete') { delete target[key]; continue; }
    if (kind === 'arrayUnion') {
      const arr = Array.isArray(target[key]) ? [...target[key]] : [];
      for (const value of raw.values || []) if (!arr.some(item => sameValue(item, value))) arr.push(clone(value));
      target[key] = arr;
      continue;
    }
    if (kind === 'arrayRemove') {
      const remove = raw.values || [];
      target[key] = (Array.isArray(target[key]) ? target[key] : []).filter(item => !remove.some(value => sameValue(item, value)));
      continue;
    }
    target[key] = clone(raw);
  }
  return target;
}

function publicStudent(data) {
  const out = {};
  for (const key of PUBLIC_STUDENT_FIELDS) if (data && data[key] !== undefined) out[key] = data[key];
  return out;
}

function classCodes(raw) {
  return (Array.isArray(raw) ? raw : []).map(value => typeof value === 'string' ? value : value && value.code).filter(Boolean).map(String);
}

async function accessContext(session, client = pool) {
  if (!session || !session.user) return null;
  const docIds = new Set();
  for (const identity of session.user.identities || []) docIds.add(canonicalFor(identity.provider, identity.subject));
  if (session.user.canonicalDocId) docIds.add(session.user.canonicalDocId);
  const owned = await client.query('SELECT doc_id FROM student_profiles WHERE user_id=$1 UNION SELECT doc_id FROM student_states WHERE user_id=$1', [session.userId]);
  for (const row of owned.rows) docIds.add(row.doc_id);

  const telegramIds = (session.user.identities || []).filter(i => i.provider === 'telegram').map(i => String(i.subject));
  let teacher = null;
  if (telegramIds.length) {
    const result = await client.query('SELECT doc_id,data FROM teacher_profiles WHERE doc_id=ANY($1::text[]) LIMIT 1', [telegramIds]);
    if (result.rowCount) teacher = { docId: result.rows[0].doc_id, data: result.rows[0].data || {} };
  }
  const admin = telegramIds.some(id => require('./env').env.adminTelegramIds.has(id)) || teacher?.data?.role === 'admin';
  const role = admin ? 'admin' : (teacher?.data?.role || (teacher ? 'solo' : 'student'));
  let classes = new Set(classCodes(teacher?.data?.classes));
  const orgId = teacher?.data?.orgId ? String(teacher.data.orgId) : '';
  if (role === 'org_owner' && orgId) {
    const peers = await client.query("SELECT data FROM teacher_profiles WHERE data->>'orgId'=$1", [orgId]);
    for (const peer of peers.rows) for (const code of classCodes(peer.data.classes)) classes.add(code);
  }
  return { userId: session.userId, user: session.user, docIds, telegramIds, teacher, admin, role, classes, orgId };
}

async function targetStudent(client, docId) {
  const result = await client.query('SELECT doc_id,user_id,data,version FROM student_profiles WHERE doc_id=$1', [docId]);
  return result.rows[0] || null;
}

function teacherCanSeeStudent(ctx, student) {
  if (!ctx || !student) return false;
  if (ctx.admin) return true;
  return !!ctx.teacher && ctx.classes.has(String(student.data?.classCode || ''));
}

async function authorizeRead(client, ref, ctx, row, { query = false } = {}) {
  if (!ctx) return { ok: false };
  if (ctx.admin) return { ok: true, full: true };
  switch (ref.collection) {
    case 'students':
      if (ctx.docIds.has(ref.docId) || row?.user_id === ctx.userId) return { ok: true, full: true };
      if (teacherCanSeeStudent(ctx, row)) return { ok: true, full: true };
      return query ? { ok: true, full: false } : { ok: false };
    case 'state': {
      if (ctx.docIds.has(ref.docId) || row?.user_id === ctx.userId) return { ok: true, full: true };
      return { ok: teacherCanSeeStudent(ctx, await targetStudent(client, ref.docId)), full: true };
    }
    case 'teachers':
      if (ctx.telegramIds.includes(ref.docId)) return { ok: true, full: true };
      if (ctx.role === 'org_owner' && ctx.orgId && row?.data?.orgId === ctx.orgId) return { ok: true, full: true };
      return { ok: false };
    case 'orgs':
      return { ok: !!ctx.teacher && (ctx.orgId === ref.docId || ctx.role === 'org_owner'), full: true };
    case 'notifyJobs':
      return { ok: false };
    case 'loginTokens':
      return { ok: false };
    case 'loginSessions':
      return { ok: row?.user_id === ctx.userId, full: true };
    case 'classes':
    case 'matches':
    case 'config':
    case 'leaderboards':
      return { ok: true, full: true };
    default:
      return { ok: false };
  }
}

function ownMatchActor(ctx, player) {
  return !!player && ctx.docIds.has(String(player.uid || ''));
}

function mergeMatchData(current, next, patch) {
  if (!current) return next;
  const statusRank = { waiting: 1, playing: 2, finished: 3 };
  if ((statusRank[current.status] || 0) > (statusRank[next.status] || 0)) next.status = current.status;
  if (Number(current.startTime) > 0 && Number(next.startTime) !== Number(current.startTime)) next.startTime = current.startTime;
  for (const key of ['player1', 'player2']) {
    if (!patch?.[key] || !current[key] || !next[key] || String(current[key].uid || '') !== String(next[key].uid || '')) continue;
    const before = current[key];
    const candidate = { ...next[key] };
    const beforeSeq = Number(before.seq);
    const candidateSeq = Number(candidate.seq);
    if (Number.isFinite(beforeSeq) && Number.isFinite(candidateSeq) && candidateSeq <= beforeSeq) {
      next[key] = before;
      continue;
    }
    if (!Number.isFinite(candidateSeq) && Number(candidate.score) < Number(before.score)) candidate.score = before.score;
    if (before.final) candidate.final = true;
    for (const counter of ['done', 'correct']) {
      if (Number(before[counter]) > Number(candidate[counter])) candidate[counter] = before[counter];
    }
    next[key] = candidate;
  }
  return next;
}

async function authorizeWrite(client, ref, ctx, current, patch, mode, { internal = false } = {}) {
  if (internal || ctx?.admin) return true;
  if (!ctx) return false;
  switch (ref.collection) {
    case 'students': {
      if (ctx.docIds.has(ref.docId) || current?.user_id === ctx.userId) return true;
      if (!teacherCanSeeStudent(ctx, current)) return false;
      return Object.keys(patch || {}).every(key => TEACHER_STUDENT_WRITE_FIELDS.has(key));
    }
    case 'state':
      return ctx.docIds.has(ref.docId) || current?.user_id === ctx.userId;
    case 'classes':
      return !!ctx.teacher && (ctx.classes.has(ref.docId) || ctx.role === 'org_owner');
    case 'matches': {
      const before = current?.data || {};
      if (mode === 'create') {
        const fields = Object.keys(patch || {});
        return patch?.status === 'waiting' && patch?.player2 == null && ownMatchActor(ctx, patch?.player1)
          && fields.every(key => ['status', 'mode', 'swipeSections', 'createdAt', 'player1', 'player2', 'startTime'].includes(key));
      }
      const player1Own = ownMatchActor(ctx, before.player1);
      const player2Own = ownMatchActor(ctx, before.player2);
      if (mode === 'delete') return player1Own || player2Own;
      if (!player1Own && !player2Own) {
        const fields = Object.keys(patch || {});
        return before.status === 'waiting' && before.player2 == null && patch?.status === 'playing'
          && ownMatchActor(ctx, patch?.player2)
          && fields.every(key => ['status', 'player2', 'startTime'].includes(key));
      }
      const actorKey = player1Own ? 'player1' : 'player2';
      if (!Object.keys(patch || {}).every(key => key === actorKey || key === 'status')) return false;
      if (patch?.[actorKey] && String(patch[actorKey].uid || '') !== String(before[actorKey]?.uid || '')) return false;
      if (patch?.status && patch.status !== 'finished') return false;
      return true;
    }
    case 'loginSessions':
      if (mode === 'delete') return current?.user_id === ctx.userId;
      if (mode !== 'create') return false;
      return patch?.status === 'pending'
        && Number(patch?.exp) > Date.now()
        && Number(patch?.exp) <= Date.now() + 20 * 60 * 1000
        && Object.keys(patch || {}).every(key => ['status', 'createdAt', 'exp'].includes(key));
    case 'loginTokens':
      return false;
    case 'notifyJobs': {
      if (mode !== 'create' || !['hw_assigned', 'hw_done'].includes(patch?.type)) return false;
      if (JSON.stringify(patch || {}).length > 8192) return false;
      if (patch.type === 'hw_assigned') {
        const student = await targetStudent(client, String(patch.studentId || ''));
        return !!ctx.teacher && teacherCanSeeStudent(ctx, student);
      }
      const profiles = await client.query('SELECT doc_id,data FROM student_profiles WHERE user_id=$1 OR doc_id=ANY($2::text[])',
        [ctx.userId, [...ctx.docIds]]);
      const ownClass = profiles.rows.some(row => String(row.data?.classCode || '') === String(patch.classCode || ''));
      const claimedId = String(patch.studentId || '');
      return ownClass && (!claimedId || ctx.telegramIds.includes(claimedId) || ctx.docIds.has(claimedId));
    }
    case 'teachers':
    case 'orgs':
    case 'config':
    case 'leaderboards':
      return false;
    default:
      return false;
  }
}

function filterValue(value, op, expected) {
  if (op === '==') return sameValue(value, expected);
  if (op === '>=') return value >= expected;
  if (op === '<=') return value <= expected;
  if (op === '>') return value > expected;
  if (op === '<') return value < expected;
  return false;
}

function applyConstraints(rows, constraints) {
  let out = rows;
  for (const c of constraints || []) {
    if (c.type === 'where') out = out.filter(row => filterValue(row.data?.[c.field], c.op, c.value));
  }
  const order = (constraints || []).find(c => c.type === 'orderBy');
  if (order) {
    const dir = order.direction === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a.data?.[order.field], bv = b.data?.[order.field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }
  const cap = Math.min(5000, Math.max(0, Number((constraints || []).find(c => c.type === 'limit')?.count) || 500));
  return out.slice(0, cap);
}

class DocumentStore extends EventEmitter {
  async get(path, session, options = {}) {
    const ref = parsePath(path);
    const client = options.client || pool;
    const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1`, [ref.docId]);
    if (!result.rowCount) return { exists: false, id: ref.docId, data: null, version: 0 };
    const row = result.rows[0];
    const ctx = options.context || await accessContext(session, client);
    const access = options.internal ? { ok: true, full: true } : await authorizeRead(client, ref, ctx, row);
    if (!access.ok) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return { exists: true, id: ref.docId, data: access.full ? row.data : publicStudent(row.data), version: Number(row.version) };
  }

  async query(path, constraints, session, options = {}) {
    const ref = collectionFromPath(path);
    const client = options.client || pool;
    const ctx = options.context || await accessContext(session, client);
    if (!ctx && !options.internal) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table}`);
    const rows = [];
    for (const row of result.rows) {
      const rowRef = { ...ref, docId: row.doc_id };
      const access = options.internal ? { ok: true, full: true } : await authorizeRead(client, rowRef, ctx, row, { query: true });
      if (!access.ok) continue;
      if (ref.collection === 'students' && !access.full) rows.push({ ...row, doc_id: `public_${sha256(row.doc_id).slice(0, 20)}`, data: publicStudent(row.data) });
      else rows.push(row);
    }
    return applyConstraints(rows, constraints).map(row => ({ id: row.doc_id, data: row.data, version: Number(row.version) }));
  }

  async write(path, patch, mode, session, options = {}) {
    const ref = parsePath(path);
    const execute = async client => {
      const ctx = options.context || await accessContext(session, client);
      const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1 FOR UPDATE`, [ref.docId]);
      const current = result.rows[0] || null;
      const actualMode = current ? mode : 'create';
      if (!await authorizeWrite(client, ref, ctx, current, patch, actualMode, options)) {
        throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      }
      if (mode === 'update' && !current) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      const conflictMerged = options.expectedVersion !== undefined
        && Number(options.expectedVersion) !== Number(current?.version || 0);
      if (conflictMerged && ref.collection !== 'state') {
        throw Object.assign(new Error('version_conflict'), { statusCode: 409 });
      }
      const merge = mode === 'update' || mode === 'merge';
      let next = applyPatch(current?.data || {}, patch || {}, merge);
      if (ref.collection === 'matches') next = mergeMatchData(current?.data || null, next, patch || {});
      if (!options.replaceState
          && (ref.collection === 'state' || ref.collection === 'students')
          && patch?.fullStateJson && current?.data?.fullStateJson) {
        next.fullStateJson = mergeStateJson(current.data.fullStateJson, patch.fullStateJson);
      }
      let userId = current?.user_id || null;
      if ((ref.collection === 'students' || ref.collection === 'state') && ctx
          && (ctx.docIds.has(ref.docId) || (!!current?.user_id && current.user_id === ctx.userId))) userId = ctx.userId;
      if (!current && ['loginSessions', 'notifyJobs', 'matches'].includes(ref.collection)) userId = ctx?.userId || null;
      if (current && sameValue(current.data, next)) {
        return { id: ref.docId, data: current.data, version: Number(current.version), conflictMerged, unchanged: true };
      }
      const saved = await client.query(`INSERT INTO ${ref.table}(doc_id,user_id,data,version)
        VALUES($1,$2,$3,1)
        ON CONFLICT(doc_id) DO UPDATE SET
          user_id=COALESCE(${ref.table}.user_id,EXCLUDED.user_id),data=EXCLUDED.data,
          version=${ref.table}.version+1,updated_at=now()
        RETURNING doc_id,data,version`, [ref.docId, userId, JSON.stringify(next)]);
      if (options.auditAction) await client.query(
        'INSERT INTO audit_events(actor_user_id,action,target,details) VALUES($1,$2,$3,$4)',
        [ctx?.userId || null, options.auditAction, ref.path, JSON.stringify({ fields: Object.keys(patch || {}) })]
      );
      return { id: ref.docId, data: saved.rows[0].data, version: Number(saved.rows[0].version), conflictMerged };
    };
    const saved = options.client ? await execute(options.client) : await tx(execute);
    if (!options.client) this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'write', version: saved.version });
    return saved;
  }

  async delete(path, session, options = {}) {
    const ref = parsePath(path);
    const execute = async client => {
      const ctx = options.context || await accessContext(session, client);
      const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1 FOR UPDATE`, [ref.docId]);
      const current = result.rows[0] || null;
      if (!current) return false;
      if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== Number(current.version || 0)) {
        throw Object.assign(new Error('version_conflict'), { statusCode: 409 });
      }
      if (!await authorizeWrite(client, ref, ctx, current, {}, 'delete', options)) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      await client.query(`DELETE FROM ${ref.table} WHERE doc_id=$1`, [ref.docId]);
      return true;
    };
    const deleted = options.client ? await execute(options.client) : await tx(execute);
    if (deleted && !options.client) this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'delete', version: 0 });
    return deleted;
  }

  async transaction(mutations, session) {
    if (!Array.isArray(mutations) || mutations.length > 50) throw Object.assign(new Error('invalid_transaction'), { statusCode: 400 });
    const changes = [];
    const result = await tx(async client => {
      const ctx = await accessContext(session, client);
      for (const mutation of mutations) {
        if (mutation.type === 'delete') {
          await this.delete(mutation.path, session, { client, context: ctx, expectedVersion: mutation.expectedVersion });
          changes.push(mutation.path);
        } else {
          await this.write(mutation.path, mutation.data || {}, mutation.mode || 'update', session,
            { client, context: ctx, expectedVersion: mutation.expectedVersion, auditAction: 'store.transaction' });
          changes.push(mutation.path);
        }
      }
      return { ok: true };
    });
    for (const path of changes) {
      const ref = parsePath(path);
      this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'transaction' });
    }
    return result;
  }
}

module.exports = { DocumentStore, parsePath, collectionFromPath, applyPatch, mergeMatchData, accessContext, publicStudent, COLLECTIONS };
