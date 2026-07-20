'use strict';

const http = require('http');
const { WebSocket, WebSocketServer } = require('ws');
const { env } = require('./env');
const { pool, runMigrations } = require('./db');
const { verifyInitData } = require('./initdata');
const { timingSafeEqualText, randomToken } = require('./crypto');
const { json, redirect, readJson, requestIp, safeReturnTo } = require('./http');
const {
  resolveIdentity, loadUser, createSession, sessionCookies, clearSessionCookies, getSession,
  revokeSession, csrfValid, userForClient, createGuest, createGoogleStart, finishGoogle, claimLegacyDocument,
} = require('./auth');
const { mergeStateValues } = require('./state-merge');
const { DocumentStore, accessContext } = require('./store');
const { MemoryRateLimiter } = require('./rate-limit');
const { startFirebaseMirror } = require('./firebase-mirror');

const store = new DocumentStore();
const limiter = new MemoryRateLimiter();
const APP = env.firebaseAppId;
const studentPath = id => `artifacts/${APP}/public/data/students/${id}`;
const statePath = id => `artifacts/${APP}/private/data/state/${id}`;

function log(level, event, details = {}) {
  const safe = { level, event, at: new Date().toISOString(), ...details };
  delete safe.token;
  delete safe.cookie;
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(safe));
}

function noRoute() {
  const error = new Error('not_found');
  error.statusCode = 404;
  return error;
}

function requireSession(session) {
  if (!session) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  return session;
}

function requireMutationAuth(req, session) {
  requireSession(session);
  if (!csrfValid(req, session)) throw Object.assign(new Error('csrf_failed'), { statusCode: 403 });
}

function internalRequest(req) {
  if (!env.internalApiToken) return false;
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') && timingSafeEqualText(header.slice(7), env.internalApiToken);
}

async function replaceSession(req, res, userId, oldSession) {
  if (oldSession) await revokeSession(req);
  const created = await createSession(userId, req);
  const user = await loadUser(userId);
  return { headers: { 'Set-Cookie': sessionCookies(created) }, user };
}

async function redeemLogin(req, res, session, body) {
  const token = String(body.token || '').trim();
  const kind = body.kind === 'session' ? 'session' : 'token';
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(token)) throw Object.assign(new Error('invalid_token'), { statusCode: 400 });
  const table = kind === 'session' ? 'login_sessions' : 'login_tokens';
  const result = await pool.query(`SELECT data FROM ${table} WHERE doc_id=$1 AND COALESCE((data->>'exp')::bigint,0)>$2`, [token, Date.now()]);
  if (!result.rowCount) throw Object.assign(new Error('token_expired'), { statusCode: 404 });
  const data = result.rows[0].data || {};
  if (kind === 'session' && data.status !== 'confirmed') throw Object.assign(new Error('session_not_confirmed'), { statusCode: 409 });
  const tgId = String(data.tgId || '');
  if (!/^\d+$/.test(tgId)) throw Object.assign(new Error('invalid_telegram_identity'), { statusCode: 400 });

  const existingTg = session?.user?.identities?.find(i => i.provider === 'telegram');
  const hasRealIdentity = session?.user?.identities?.some(i => i.provider === 'telegram' || i.provider === 'google');
  if (hasRealIdentity && (!existingTg || existingTg.subject !== tgId) && !body.replace) {
    throw Object.assign(new Error('identity_switch_confirmation_required'), { statusCode: 409, details: { tgId, name: data.name || '' } });
  }
  const linkUserId = !body.replace && session?.user?.isAnonymous ? session.userId : (existingTg?.subject === tgId ? session.userId : null);
  const userId = await resolveIdentity({ provider: 'telegram', subject: tgId, displayName: String(data.name || ''), profile: { first_name: data.name || '' }, linkUserId });
  const consumed = await pool.query(`DELETE FROM ${table} WHERE doc_id=$1 RETURNING doc_id`, [token]);
  if (!consumed.rowCount) throw Object.assign(new Error('token_already_used'), { statusCode: 409 });
  const switched = await replaceSession(req, res, userId, session);
  return { user: switched.user, tgId, name: String(data.name || ''), headers: switched.headers };
}

async function refreshPremium(tgId) {
  if (!env.botToken) return;
  const config = await pool.query("SELECT data FROM app_config WHERE doc_id='limits'");
  const chats = Array.isArray(config.rows[0]?.data?.premiumChats) ? config.rows[0].data.premiumChats : [];
  if (!chats.length) return;
  let member = false;
  for (const chat of chats) {
    const chatId = Number(chat && chat.id);
    if (!chatId) continue;
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${env.botToken}/getChatMember`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: Number(tgId) }), signal: AbortSignal.timeout(8000),
      });
    } catch (_) { return; }
    const payload = await response.json().catch(() => null);
    if (!payload?.ok) {
      if (/not found|user_not_participant/i.test(payload?.description || '')) continue;
      return;
    }
    const status = payload.result?.status || '';
    if (['creator', 'administrator', 'member'].includes(status) || (status === 'restricted' && payload.result?.is_member)) { member = true; break; }
  }
  const current = await pool.query('SELECT data FROM student_profiles WHERE doc_id=$1', [tgId]);
  if (!current.rowCount) return;
  const data = { ...current.rows[0].data, premiumAuto: member, premiumAutoAt: Date.now() };
  await pool.query('UPDATE student_profiles SET data=$2,version=version+1,updated_at=now() WHERE doc_id=$1', [tgId, JSON.stringify(data)]);
}

async function handleInternal(req, res, url) {
  if (!internalRequest(req)) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  if (req.method === 'POST' && url.pathname === '/internal/v1/store/get') {
    const body = await readJson(req);
    const doc = await store.get(body.path, null, { internal: true });
    return json(res, 200, { doc });
  }
  if (req.method === 'POST' && url.pathname === '/internal/v1/store/write') {
    const body = await readJson(req);
    const result = await store.write(body.path, body.data || {}, body.mode || 'merge', null, { internal: true, auditAction: 'internal.write' });
    return json(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/internal/v1/store/delete') {
    const body = await readJson(req);
    return json(res, 200, { deleted: await store.delete(body.path, null, { internal: true }) });
  }
  if (req.method === 'POST' && url.pathname === '/internal/v1/store/query') {
    const body = await readJson(req);
    return json(res, 200, { docs: await store.query(body.path, body.constraints || [], null, { internal: true }) });
  }
  if (req.method === 'POST' && url.pathname === '/internal/v1/notifications/claim') {
    const claimed = await require('./db').tx(async client => {
      const result = await client.query(`SELECT doc_id,data FROM notification_jobs
        WHERE attempts<5 AND next_attempt_at<=now() AND (
          status='pending' OR (status='processing' AND locked_at<now()-interval '10 minutes')
        )
        ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`);
      if (result.rowCount) await client.query(
        `UPDATE notification_jobs SET status='processing',locked_at=now(),attempts=attempts+1,updated_at=now()
         WHERE doc_id=ANY($1::text[])`, [result.rows.map(r => r.doc_id)]);
      return result.rows;
    });
    return json(res, 200, { jobs: claimed.map(row => ({ id: row.doc_id, ...row.data })) });
  }
  const ack = url.pathname.match(/^\/internal\/v1\/notifications\/([^/]+)\/(ack|fail)$/);
  if (req.method === 'POST' && ack) {
    const body = await readJson(req);
    const jobId = decodeURIComponent(ack[1]);
    if (ack[2] === 'ack') await pool.query(
      "UPDATE notification_jobs SET status='delivered',delivered_at=now(),locked_at=NULL,updated_at=now() WHERE doc_id=$1 AND status='processing'", [jobId]);
    else await pool.query(`UPDATE notification_jobs SET
      status=CASE WHEN attempts<5 THEN 'pending' ELSE 'failed' END,
      last_error=$2,locked_at=NULL,
      next_attempt_at=now()+CASE attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' ELSE interval '20 minutes' END,
      updated_at=now() WHERE doc_id=$1 AND status='processing'`, [jobId, String(body.error || '').slice(0, 1000)]);
    return json(res, 200, { ok: true });
  }
  throw noRoute();
}

async function handle(req, res) {
  const started = Date.now();
  const url = new URL(req.url, env.publicOrigin);
  const ip = requestIp(req);
  const bucket = limiter.take(`${ip}:all`, 300);
  if (!bucket.ok) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(Math.ceil((bucket.resetAt - Date.now()) / 1000)) });

  try {
    if (url.pathname.startsWith('/internal/')) return await handleInternal(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      const check = await pool.query('SELECT now() AS now');
      return json(res, 200, { ok: true, database: true, now: check.rows[0].now, version: '1.0.0' });
    }

    let session = await getSession(req);
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/session') {
      return session ? json(res, 200, { user: userForClient(session.user) }) : json(res, 401, { error: 'no_session' });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/guest') {
      if (!limiter.take(`${ip}:auth`, 20).ok) return json(res, 429, { error: 'rate_limited' });
      const result = await createGuest(req, session);
      const headers = result.session ? { 'Set-Cookie': sessionCookies(result.session) } : {};
      return json(res, 200, { user: userForClient(result.user) }, headers);
    }
    if (req.method === 'POST' && (url.pathname === '/api/v1/auth/telegram' || url.pathname === '/auth/telegram')) {
      if (!env.botToken) throw Object.assign(new Error('telegram_not_configured'), { statusCode: 503 });
      if (!limiter.take(`${ip}:auth`, 20).ok) return json(res, 429, { error: 'rate_limited' });
      const body = await readJson(req, 32768);
      const verified = verifyInitData(String(body.initData || ''), env.botToken, { maxAgeSec: 86400 });
      if (!verified.ok) throw Object.assign(new Error(verified.reason || 'telegram_invalid'), { statusCode: 401 });
      const tgUser = verified.user || {};
      const userId = await resolveIdentity({
        provider: 'telegram', subject: verified.tgId,
        displayName: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '), profile: tgUser,
        linkUserId: session?.user?.isAnonymous ? session.userId : null,
      });
      const switched = await replaceSession(req, res, userId, session);
      pool.query('UPDATE teacher_profiles SET user_id=$1 WHERE doc_id=$2 AND user_id IS NULL', [userId, String(verified.tgId)]).catch(() => {});
      refreshPremium(String(verified.tgId)).catch(error => log('warn', 'premium.refresh.failed', { message: error.message }));
      return json(res, 200, { token: 'vps-session', user: userForClient(switched.user) }, switched.headers);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/google/start') {
      if (!limiter.take(`${ip}:google`, 10, 10 * 60 * 1000).ok) return json(res, 429, { error: 'rate_limited' });
      const returnTo = safeReturnTo(url.searchParams.get('returnTo') || '/');
      return redirect(res, await createGoogleStart(session, returnTo));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/google/callback') {
      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const result = await finishGoogle(req, code, state);
      if (session) await revokeSession(req);
      const separator = result.returnTo.includes('?') ? '&' : '?';
      return redirect(res, `${env.publicOrigin}${result.returnTo}${separator}auth=google`, sessionCookies(result.session));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      requireMutationAuth(req, session);
      await revokeSession(req);
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookies() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/magic/redeem') {
      if (!limiter.take(`${ip}:magic`, 30, 60 * 60 * 1000).ok) return json(res, 429, { error: 'rate_limited' });
      const body = await readJson(req, 32768);
      const result = await redeemLogin(req, res, session, body);
      return json(res, 200, { user: userForClient(result.user), tgId: result.tgId, name: result.name }, result.headers);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/legacy/claim') {
      requireMutationAuth(req, session);
      if (!limiter.take(`${ip}:legacy`, 10, 60 * 60 * 1000).ok) return json(res, 429, { error: 'rate_limited' });
      if (!session.user.isAnonymous) throw Object.assign(new Error('guest_session_required'), { statusCode: 403 });
      const body = await readJson(req, 32768);
      const legacyId = String(body.legacyId || '').trim();
      if (/^\d+$/.test(legacyId) || legacyId.startsWith('google_') || !/^[A-Za-z0-9_-]{16,180}$/.test(legacyId)) {
        throw Object.assign(new Error('legacy_id_invalid'), { statusCode: 400 });
      }
      const exists = await pool.query('SELECT 1 FROM student_profiles WHERE doc_id=$1 UNION SELECT 1 FROM student_states WHERE doc_id=$1', [legacyId]);
      if (!exists.rowCount) throw Object.assign(new Error('legacy_profile_not_found'), { statusCode: 404 });
      const userId = await claimLegacyDocument(session.userId, legacyId);
      const user = await loadUser(userId);
      return json(res, 200, { user: userForClient(user), legacyId });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/pin/link') {
      requireMutationAuth(req, session);
      if (!limiter.take(`${ip}:pin`, 5, 15 * 60 * 1000).ok) return json(res, 429, { error: 'rate_limited' });
      const body = await readJson(req, 32768);
      const pin = String(body.pin || '').replace(/\D/g, '');
      if (!/^\d{8}$/.test(pin)) throw Object.assign(new Error('invalid_pin'), { statusCode: 400 });
      const found = await pool.query("SELECT doc_id,data,user_id FROM student_profiles WHERE data->>'syncPin'=$1 LIMIT 2", [pin]);
      if (!found.rowCount) throw Object.assign(new Error('pin_not_found'), { statusCode: 404 });
      const currentId = session.user.canonicalDocId;
      const target = found.rows.find(row => row.doc_id !== currentId);
      if (!target) throw Object.assign(new Error('own_pin'), { statusCode: 409 });
      const userId = await claimLegacyDocument(session.userId, target.doc_id);
      const stateRows = await pool.query('SELECT doc_id,data FROM student_states WHERE user_id=$1', [userId]);
      const profileRows = await pool.query('SELECT doc_id,data FROM student_profiles WHERE user_id=$1', [userId]);
      const stateValues = [];
      for (const row of stateRows.rows) if (row.data?.fullStateJson) stateValues.push(row.data.fullStateJson);
      for (const row of profileRows.rows) if (row.data?.fullStateJson) stateValues.push(row.data.fullStateJson);
      const merged = mergeStateValues(stateValues);
      const updatedUser = await loadUser(userId);
      const keepId = updatedUser?.canonicalDocId || target.doc_id;
      if (merged) {
        await pool.query(`INSERT INTO student_states(doc_id,user_id,data,version) VALUES($1,$2,$3,1)
          ON CONFLICT(doc_id) DO UPDATE SET user_id=$2,data=$3,version=student_states.version+1,updated_at=now()`,
          [keepId, userId, JSON.stringify({ fullStateJson: JSON.stringify(merged), updatedAt: Date.now() })]);
      }
      await pool.query('INSERT INTO audit_events(actor_user_id,action,target,details) VALUES($1,$2,$3,$4)',
        [userId, 'identity.pin_link', target.doc_id, JSON.stringify({ keepId })]);
      return json(res, 200, {
        ok: true, targetId: target.doc_id, canonicalId: keepId,
        tgId: String(target.data?.tgId || target.data?.knownTgId || (/^\d+$/.test(target.doc_id) ? target.doc_id : '')),
        state: merged,
      });
    }

    requireSession(session);
    if (req.method === 'GET' && url.pathname === '/api/v1/store/doc') {
      return json(res, 200, await store.get(url.searchParams.get('path'), session));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/store/query') {
      const body = await readJson(req);
      return json(res, 200, { docs: await store.query(body.path, body.constraints || [], session) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/store/doc') {
      requireMutationAuth(req, session);
      const body = await readJson(req);
      const result = await store.write(body.path, body.data || {}, body.mode || 'merge', session, { expectedVersion: body.expectedVersion });
      return json(res, 200, result);
    }
    if (req.method === 'DELETE' && url.pathname === '/api/v1/store/doc') {
      requireMutationAuth(req, session);
      return json(res, 200, { deleted: await store.delete(url.searchParams.get('path'), session) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/store/transaction') {
      requireMutationAuth(req, session);
      const body = await readJson(req);
      return json(res, 200, await store.transaction(body.mutations, session));
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/me/state') {
      const id = session.user.canonicalDocId;
      return json(res, 200, await store.get(statePath(id), session).catch(error => error.statusCode === 404 ? ({ exists: false, data: null, version: 0 }) : Promise.reject(error)));
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/me/state') {
      requireMutationAuth(req, session);
      const body = await readJson(req);
      const fullStateJson = typeof body.state === 'string' ? body.state : JSON.stringify(body.state || {});
      return json(res, 200, await store.write(statePath(session.user.canonicalDocId), { fullStateJson, updatedAt: Date.now() }, 'merge', session,
        { expectedVersion: body.baseRevision }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/profile') {
      return json(res, 200, await store.get(studentPath(session.user.canonicalDocId), session));
    }
    if (req.method === 'PATCH' && url.pathname === '/api/v1/me/profile') {
      requireMutationAuth(req, session);
      const body = await readJson(req, 65536);
      const allowed = Object.fromEntries(Object.entries(body).filter(([key]) => ['name', 'classCode', 'username'].includes(key)));
      return json(res, 200, await store.write(studentPath(session.user.canonicalDocId), allowed, 'merge', session));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/me/assignments') {
      const profile = await store.get(studentPath(session.user.canonicalDocId), session);
      return json(res, 200, { assignments: profile.data?.pendingAssignments || [] });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/leaderboards') {
      const field = url.searchParams.get('type') === 'duel' ? 'duelRating' : 'totalSolved';
      const docs = await store.query(`artifacts/${APP}/public/data/students`, [{ type: 'orderBy', field, direction: 'desc' }, { type: 'limit', count: 20 }], session);
      return json(res, 200, { rows: docs });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/teacher/classes') {
      const ctx = await accessContext(session);
      if (!ctx.teacher && !ctx.admin) throw Object.assign(new Error('teacher_required'), { statusCode: 403 });
      return json(res, 200, { role: ctx.role, orgId: ctx.orgId, classes: [...ctx.classes] });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/teacher/students') {
      const ctx = await accessContext(session);
      const classCode = String(url.searchParams.get('classCode') || '');
      if (!ctx.admin && (!ctx.teacher || !ctx.classes.has(classCode))) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      const docs = await store.query(`artifacts/${APP}/public/data/students`, [{ type: 'where', field: 'classCode', op: '==', value: classCode }, { type: 'limit', count: 3000 }], session);
      return json(res, 200, { students: docs });
    }

    throw noRoute();
  } catch (error) {
    const status = Number(error.statusCode) || (error.code === '23505' ? 409 : 500);
    log(status >= 500 ? 'error' : 'warn', 'request.failed', {
      method: req.method, path: url.pathname, status, code: error.code || '', message: error.message, elapsedMs: Date.now() - started,
    });
    return json(res, status, { error: error.message || 'internal', ...(error.details ? { details: error.details } : {}) });
  }
}

const server = http.createServer(handle);
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
const sockets = new Set();

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, env.publicOrigin);
    if (url.pathname !== '/api/v1/duels/ws' && url.pathname !== '/api/v1/store/ws') throw new Error('not_found');
    if (String(req.headers.origin || '') !== env.publicOrigin) throw new Error('origin_forbidden');
    const session = await getSession(req, { touch: false });
    if (!session) throw new Error('unauthorized');
    req.vpsSession = session;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } catch (_) { socket.destroy(); }
});

wss.on('connection', (ws, req) => {
  ws.subscriptions = new Set();
  ws.session = req.vpsSession;
  sockets.add(ws);
  ws.on('message', async raw => {
    try {
      const message = JSON.parse(String(raw));
      if (message.type === 'subscribe' && typeof message.path === 'string' && message.path.length < 1000) {
        const path = message.path.replace(/\/$/, '');
        const segments = path.split('/');
        if (segments.length === 6) {
          const document = await store.get(path, ws.session);
          if (!document.exists) throw new Error('subscription_not_found');
        } else if (segments.length === 5) {
          if (!['students', 'classes', 'matches', 'config', 'leaderboards'].includes(segments[4])) {
            throw new Error('subscription_forbidden');
          }
          await store.query(path, [{ type: 'limit', count: 1 }], ws.session);
        } else throw new Error('invalid_subscription');
        ws.subscriptions.add(path);
        ws.send(JSON.stringify({ type: 'subscribed', path }));
      }
      if (message.type === 'unsubscribe') ws.subscriptions.delete(String(message.path || '').replace(/\/$/, ''));
      if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong', at: Date.now() }));
    } catch (error) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', error: error.message || 'invalid_message' }));
    }
  });
  ws.on('close', () => sockets.delete(ws));
});

store.on('change', change => {
  const payload = JSON.stringify({ ...change, changeType: change.type, type: 'change' });
  for (const ws of sockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const interested = [...ws.subscriptions].some(path => change.path === path || change.collectionPath === path);
    if (interested) ws.send(payload);
  }
});

async function start() {
  await runMigrations();
  startFirebaseMirror(store, console);
  const cleanupAuthAndQueues = () => Promise.all([
    pool.query("DELETE FROM user_sessions WHERE expires_at<now() OR revoked_at<now()-interval '7 days'"),
    pool.query("DELETE FROM oauth_states WHERE expires_at<now()"),
    pool.query("DELETE FROM login_tokens WHERE COALESCE((data->>'exp')::bigint,0)<$1", [Date.now()]),
    pool.query("DELETE FROM login_sessions WHERE COALESCE((data->>'exp')::bigint,0)<$1", [Date.now()]),
    pool.query("DELETE FROM notification_jobs WHERE status IN ('delivered','failed') AND updated_at<now()-interval '30 days'"),
  ]).catch(error => log('warn', 'maintenance.cleanup.failed', { message: error.message }));
  await cleanupAuthAndQueues();
  setInterval(cleanupAuthAndQueues, 60 * 60 * 1000).unref();
  const cleanupMatches = () => pool.query(`DELETE FROM duel_matches
    WHERE (data->>'status'='waiting' AND updated_at<now()-interval '2 minutes')
       OR (data->>'status'='finished' AND updated_at<now()-interval '1 day')`).catch(() => {});
  cleanupMatches();
  setInterval(cleanupMatches, 60000).unref();
  server.listen(env.port, env.host, () => log('info', 'server.started', { host: env.host, port: env.port }));
}

if (require.main === module) start().catch(error => { log('error', 'server.start.failed', { message: error.message }); process.exit(1); });

module.exports = { server, store, handle, start };
