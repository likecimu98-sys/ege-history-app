'use strict';

const fs = require('fs');
const path = require('path');
const { pool, tx, runMigrations } = require('../src/db');
const { resolveIdentity, claimLegacyDocument, mergeUsers } = require('../src/auth');
const { initFirestore, readCollection, hash } = require('./firestore-common');

const COLLECTIONS = [
  ['public', 'students', 'student_profiles'],
  ['private', 'state', 'student_states'],
  ['public', 'teachers', 'teacher_profiles'],
  ['public', 'orgs', 'organizations'],
  ['public', 'classes', 'classes'],
  ['public', 'matches', 'duel_matches'],
  ['public', 'loginTokens', 'login_tokens'],
  ['public', 'loginSessions', 'login_sessions'],
  ['public', 'notifyJobs', 'notification_jobs'],
  ['public', 'config', 'app_config'],
  ['public', 'leaderboards', 'leaderboards'],
];

function strongestIdentity(id, data) {
  const tgId = String(data.tgId || data.knownTgId || (/^\d+$/.test(id) ? id : '')).trim();
  if (/^\d+$/.test(tgId)) return { provider: 'telegram', subject: tgId };
  const google = String(data.knownGoogleId || (id.startsWith('google_') ? id : '')).replace(/^google_/, '');
  if (google) return { provider: 'google', subject: google };
  return { provider: 'legacy', subject: id };
}

async function linkStudent(id, data) {
  const identity = strongestIdentity(id, data);
  let userId = await resolveIdentity({
    ...identity, displayName: String(data.name || ''), email: String(data.googleEmail || ''),
    profile: { imported: true, username: data.username || '' },
  });
  userId = await claimLegacyDocument(userId, id);
  const tgIds = [data.tgId, data.knownTgId].map(String).filter(value => /^\d+$/.test(value));
  for (const tgId of [...new Set(tgIds)]) userId = await resolveIdentity({ provider: 'telegram', subject: tgId, displayName: String(data.name || ''), linkUserId: userId });
  const googleIds = [data.knownGoogleId, id.startsWith('google_') ? id : ''].map(value => String(value || '').replace(/^google_/, '')).filter(Boolean);
  for (const googleId of [...new Set(googleIds)]) userId = await resolveIdentity({ provider: 'google', subject: googleId, displayName: String(data.name || ''), email: String(data.googleEmail || ''), linkUserId: userId });
  return userId;
}

async function upsert(table, id, data, userId = null) {
  const extra = table === 'notification_jobs' ? ',status' : '';
  const extraValue = table === 'notification_jobs' ? ",COALESCE($4,'pending')" : '';
  const params = table === 'notification_jobs' ? [id, userId, JSON.stringify(data), data.status || 'pending'] : [id, userId, JSON.stringify(data)];
  await pool.query(`INSERT INTO ${table}(doc_id,user_id,data${extra}) VALUES($1,$2,$3${extraValue})
    ON CONFLICT(doc_id) DO UPDATE SET user_id=COALESCE(EXCLUDED.user_id,${table}.user_id),data=EXCLUDED.data,
      version=${table}.version+1,updated_at=now()`, params);
}

async function extractAssignments(classDocs, studentDocs, stateDocs, userIds) {
  for (const row of classDocs) for (const assignment of row.data.assignments || []) {
    if (!assignment?.id) continue;
    await pool.query(`INSERT INTO assignments(id,class_code,payload) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET class_code=EXCLUDED.class_code,payload=EXCLUDED.payload,updated_at=now()`,
      [assignment.id, row.id, JSON.stringify(assignment)]);
  }
  const students = new Map(studentDocs.map(row => [row.id, row.data]));
  const states = new Map(stateDocs.map(row => [row.id, row.data]));
  for (const id of new Set([...students.keys(), ...states.keys()])) {
    const profile = students.get(id) || {};
    let state = null;
    try { state = JSON.parse(states.get(id)?.fullStateJson || profile.fullStateJson || '{}'); } catch (_) {}
    for (const assignment of state?.stats?.assignments || state?.assignments || []) {
      if (!assignment?.id || !userIds.get(id)) continue;
      await pool.query(`INSERT INTO assignments(id,class_code,payload) VALUES($1,$2,$3)
        ON CONFLICT(id) DO NOTHING`, [assignment.id, profile.classCode || null, JSON.stringify(assignment)]);
      await pool.query(`INSERT INTO student_assignments(assignment_id,student_user_id,status,progress)
        VALUES($1,$2,$3,$4) ON CONFLICT(assignment_id,student_user_id) DO UPDATE SET
          status=EXCLUDED.status,progress=EXCLUDED.progress,updated_at=now()`,
        [assignment.id, userIds.get(id), assignment.status || 'active', JSON.stringify({ items: assignment.items || [] })]);
    }
  }
}

async function main() {
  await runMigrations();
  const firestore = initFirestore();
  const loaded = new Map();
  for (const [visibility, name] of COLLECTIONS) loaded.set(`${visibility}/${name}`, await readCollection(firestore, visibility, name));

  const students = loaded.get('public/students');
  const states = loaded.get('private/state');
  const studentsById = new Map(students.map(row => [row.id, row.data]));
  const statesById = new Map(states.map(row => [row.id, row.data]));
  const userIds = new Map();
  for (const id of new Set([...studentsById.keys(), ...statesById.keys()])) {
    userIds.set(id, await linkStudent(id, { ...(statesById.get(id) || {}), ...(studentsById.get(id) || {}) }));
  }
  for (const student of students) {
    const targetId = String(student.data?._mergedInto || '').trim();
    if (!targetId || targetId === student.id || !userIds.has(targetId)) continue;
    const targetUserId = userIds.get(targetId);
    const sourceUserId = userIds.get(student.id);
    if (targetUserId !== sourceUserId) await tx(client => mergeUsers(client, targetUserId, sourceUserId));
    userIds.set(student.id, targetUserId);
  }

  for (const [visibility, name, table] of COLLECTIONS) {
    for (const row of loaded.get(`${visibility}/${name}`)) {
      let userId = null;
      if (name === 'students' || name === 'state') userId = userIds.get(row.id) || null;
      if (name === 'teachers') {
        const tgUser = await pool.query("SELECT user_id FROM user_identities WHERE provider='telegram' AND subject=$1", [row.id]);
        userId = tgUser.rows[0]?.user_id || null;
      }
      await upsert(table, row.id, row.data, userId);
    }
  }

  let migratedPublicStates = 0;
  for (const student of students) {
    if (!student.data?.fullStateJson || statesById.has(student.id)) continue;
    await upsert('student_states', student.id, {
      fullStateJson: student.data.fullStateJson,
      updatedAt: Number(student.data.updatedAt || student.data.lastActive) || Date.now(),
      migratedFromPublic: true,
    }, userIds.get(student.id) || null);
    migratedPublicStates++;
  }

  await extractAssignments(loaded.get('public/classes'), students, states, userIds);
  const report = {
    importedAt: new Date().toISOString(),
    collections: Object.fromEntries(COLLECTIONS.map(([visibility, name]) => [`${visibility}/${name}`, loaded.get(`${visibility}/${name}`).length])),
    migratedPublicStates,
    stateHashes: Object.fromEntries([...new Set([...studentsById.keys(), ...statesById.keys()])]
      .map(id => [id, hash(statesById.get(id)?.fullStateJson || studentsById.get(id)?.fullStateJson || '')])
      .filter(([id]) => statesById.has(id) || !!studentsById.get(id)?.fullStateJson)),
  };
  const outArg = process.argv.find(value => value.startsWith('--output='));
  if (outArg) {
    const outputPath = path.resolve(outArg.slice(9));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ ...report, stateHashes: `[${Object.keys(report.stateHashes).length} hashes written to report]` }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
