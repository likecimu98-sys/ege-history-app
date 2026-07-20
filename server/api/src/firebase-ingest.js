'use strict';

const fs = require('fs');
const { env } = require('./env');
const { pool, tx, runMigrations } = require('./db');
const { resolveIdentity, claimLegacyDocument, mergeUsers } = require('./auth');
const { DocumentStore } = require('./store');

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
  const tgId = String(data?.tgId || data?.knownTgId || (/^\d+$/.test(id) ? id : '')).trim();
  if (/^\d+$/.test(tgId)) return { provider: 'telegram', subject: tgId };
  const google = String(data?.knownGoogleId || (id.startsWith('google_') ? id : '')).replace(/^google_/, '');
  if (google) return { provider: 'google', subject: google };
  return { provider: 'legacy', subject: id };
}

async function linkStudent(id, data) {
  const identity = strongestIdentity(id, data);
  let userId = await resolveIdentity({
    ...identity, displayName: String(data?.name || ''), email: String(data?.googleEmail || ''),
    profile: { transitionIngest: true, username: data?.username || '' },
  });
  userId = await claimLegacyDocument(userId, id);
  for (const tgId of [...new Set([data?.tgId, data?.knownTgId].map(String).filter(value => /^\d+$/.test(value)))]) {
    userId = await resolveIdentity({ provider: 'telegram', subject: tgId, displayName: String(data?.name || ''), linkUserId: userId });
  }
  const googleIds = [data?.knownGoogleId, id.startsWith('google_') ? id : '']
    .map(value => String(value || '').replace(/^google_/, '')).filter(Boolean);
  for (const googleId of [...new Set(googleIds)]) {
    userId = await resolveIdentity({ provider: 'google', subject: googleId, displayName: String(data?.name || ''), email: String(data?.googleEmail || ''), linkUserId: userId });
  }
  return userId;
}

async function ownerFor(visibility, name, id, data) {
  if (name === 'students') return linkStudent(id, data);
  if (name === 'state') {
    const found = await pool.query('SELECT user_id FROM student_profiles WHERE doc_id=$1', [id]);
    return found.rows[0]?.user_id || linkStudent(id, data);
  }
  if (name === 'teachers' && /^\d+$/.test(id)) {
    return resolveIdentity({ provider: 'telegram', subject: id, displayName: String(data?.name || '') });
  }
  return null;
}

async function main() {
  if (!fs.existsSync(env.firebaseServiceAccount)) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing');
  await runMigrations();
  const admin = require('firebase-admin');
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(require(env.firebaseServiceAccount)) });
  const firestore = app.firestore();
  const store = new DocumentStore();
  let queue = Promise.resolve();

  for (const [visibility, name, table] of COLLECTIONS) {
    const collectionPath = `artifacts/${env.firebaseAppId}/${visibility}/data/${name}`;
    firestore.collection(collectionPath).onSnapshot(snapshot => {
      queue = queue.then(async () => {
        for (const change of snapshot.docChanges()) {
          const path = `${collectionPath}/${change.doc.id}`;
          if (change.type === 'removed') { await store.delete(path, null, { internal: true }); continue; }
          const data = change.doc.data() || {};
          const userId = await ownerFor(visibility, name, change.doc.id, data);
          // Before cutover Firebase is the source of truth. Preserve its state
          // exactly; smart device merging is reserved for client/API writes.
          await store.write(path, data, 'set', null, { internal: true, replaceState: true });
          if (userId) await pool.query(`UPDATE ${table} SET user_id=$1 WHERE doc_id=$2`, [userId, change.doc.id]);
          if (name === 'students' && data.fullStateJson) {
            const privatePath = `artifacts/${env.firebaseAppId}/private/data/state/${change.doc.id}`;
            await store.write(privatePath, {
              fullStateJson: data.fullStateJson,
              updatedAt: Number(data.updatedAt || data.lastActive) || Date.now(),
              migratedFromPublic: true,
            }, 'merge', null, { internal: true, replaceState: true });
            if (userId) await pool.query('UPDATE student_states SET user_id=$1 WHERE doc_id=$2', [userId, change.doc.id]);
          }
          if (name === 'students' && data._mergedInto && data._mergedInto !== change.doc.id) {
            const target = await pool.query('SELECT user_id FROM student_profiles WHERE doc_id=$1', [String(data._mergedInto)]);
            if (target.rows[0]?.user_id && userId && target.rows[0].user_id !== userId) {
              await tx(client => mergeUsers(client, target.rows[0].user_id, userId));
            }
          }
        }
        console.log(JSON.stringify({ level: 'info', event: 'firebase.ingest.batch', collection: name, changes: snapshot.docChanges().length, at: new Date().toISOString() }));
      }).catch(error => console.error(JSON.stringify({ level: 'error', event: 'firebase.ingest.failed', collection: name, message: error.message, at: new Date().toISOString() })));
    }, error => console.error(JSON.stringify({ level: 'error', event: 'firebase.ingest.listener', collection: name, message: error.message, at: new Date().toISOString() })));
  }
  console.log(JSON.stringify({ level: 'info', event: 'firebase.ingest.started', collections: COLLECTIONS.length, at: new Date().toISOString() }));
}

main().catch(error => { console.error(error); process.exit(1); });
