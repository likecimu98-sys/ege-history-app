'use strict';

const fs = require('fs');
const path = require('path');
const { pool, runMigrations } = require('../src/db');
const { initFirestore, readCollection, hash } = require('./firestore-common');

const CHECKS = [
  ['public', 'students', 'student_profiles'],
  ['public', 'teachers', 'teacher_profiles'], ['public', 'orgs', 'organizations'],
  ['public', 'classes', 'classes'], ['public', 'matches', 'duel_matches'],
  ['public', 'loginTokens', 'login_tokens'], ['public', 'loginSessions', 'login_sessions'],
  ['public', 'notifyJobs', 'notification_jobs'], ['public', 'config', 'app_config'],
  ['public', 'leaderboards', 'leaderboards'],
];

async function main() {
  await runMigrations();
  const firestore = initFirestore();
  const report = { comparedAt: new Date().toISOString(), collections: {}, mismatches: [] };
  for (const [visibility, name, table] of CHECKS) {
    const source = await readCollection(firestore, visibility, name);
    const target = await pool.query(`SELECT doc_id,data FROM ${table}`);
    const targetMap = new Map(target.rows.map(row => [row.doc_id, row.data]));
    report.collections[`${visibility}/${name}`] = { firestore: source.length, postgres: target.rowCount };
    for (const row of source) {
      const pg = targetMap.get(row.id);
      if (!pg) { report.mismatches.push({ collection: name, id: row.id, reason: 'missing_in_postgres' }); continue; }
    }
  }
  const sourceStudents = await readCollection(firestore, 'public', 'students');
  const sourcePrivate = await readCollection(firestore, 'private', 'state');
  const effective = new Map();
  for (const row of sourceStudents) if (row.data?.fullStateJson) effective.set(row.id, row.data.fullStateJson);
  for (const row of sourcePrivate) if (row.data?.fullStateJson) effective.set(row.id, row.data.fullStateJson);
  const targetStates = await pool.query('SELECT doc_id,data FROM student_states');
  const targetStatesMap = new Map(targetStates.rows.map(row => [row.doc_id, row.data]));
  report.collections['private/state'] = {
    firestore: sourcePrivate.length,
    migratedPublicFallbacks: [...effective.keys()].filter(id => !sourcePrivate.some(row => row.id === id)).length,
    effective: effective.size,
    postgres: targetStates.rowCount,
  };
  for (const [id, state] of effective) {
    const pg = targetStatesMap.get(id);
    if (!pg) { report.mismatches.push({ collection: 'state', id, reason: 'missing_in_postgres' }); continue; }
    const left = hash(state);
    const right = hash(pg.fullStateJson || '');
    if (left !== right) report.mismatches.push({ collection: 'state', id, reason: 'state_hash', firestore: left, postgres: right });
  }
  for (const id of targetStatesMap.keys()) if (!effective.has(id)) {
    report.mismatches.push({ collection: 'state', id, reason: 'extra_in_postgres' });
  }
  report.ok = report.mismatches.length === 0 && Object.entries(report.collections).every(([name, item]) =>
    name === 'private/state' ? item.effective === item.postgres : item.firestore === item.postgres);
  const output = process.argv.find(value => value.startsWith('--output='));
  if (output) {
    const outputPath = path.resolve(output.slice(9));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({
    comparedAt: report.comparedAt,
    collections: report.collections,
    mismatchCount: report.mismatches.length,
    mismatchSample: report.mismatches.slice(0, 20),
    ok: report.ok,
    ...(output ? { fullReport: path.resolve(output.slice(9)) } : {}),
  }, null, 2));
  if (!report.ok) process.exitCode = 2;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
