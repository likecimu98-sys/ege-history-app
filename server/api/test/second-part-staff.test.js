'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const handler = source.slice(source.indexOf('async function handleSecondPartClasses('), source.indexOf('async function handleInternal('));

test('orphaned teacher array does not erase class ownership or school staff', async () => {
  const teachers = [
    { doc_id: '100', data: { role: 'org_owner', orgId: 'school', classes: [] } },
    { doc_id: '200', data: { role: 'org_teacher', orgId: 'school', name: 'Nastya', classes: [] } },
    { doc_id: '300', data: { role: 'org_teacher', orgId: 'other', classes: [] } },
  ];
  const pool = { query: async sql => ({ rows: sql.includes('FROM teacher_profiles') ? teachers
    : sql.includes('FROM classes') ? [{ doc_id: 'missing', data: { name: 'Recovered', ownerTgId: 200, orgId: 'old-school' } }]
    : [] }) };
  const env = { secondPartKey: 'narrow', adminTelegramIds: new Set() };
  const fn = new Function('pool', 'env', 'json', 'timingSafeEqualText', `${handler}; return handleSecondPartClasses;`)(
    pool, env, (_res, status, body) => ({ status, body }), (a, b) => a === b);
  const { body } = await fn({ headers: { 'x-trainer-key': 'narrow' } }, {});
  assert.deepEqual(body.classes[0], { code: 'missing', name: 'Recovered', second_part: true,
    owner_tg_id: 200, org_id: 'school', org_owner_tg_id: 100, students: [], students_without_telegram: 0 });
  assert.equal(body.teachers.find(t => t.tg_user_id === 200).org_owner_tg_id, 100);
  assert.equal(body.teachers.find(t => t.tg_user_id === 300).org_owner_tg_id, null);
  assert.equal((await fn({ headers: { 'x-trainer-key': 'wrong' } }, {})).status, 404);
});

test('rejoining school preserves groups and school owner role', async () => {
  const bot = fs.readFileSync(path.join(__dirname, '../../bot/src/bot.js'), 'utf8');
  const start = bot.indexOf("    if (payload.startsWith('t_') && fdb)");
  const stop = bot.indexOf('// подписка родителя', start);
  const code = bot.slice(start, stop);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const id of [100, 200]) {
    let profile = { classes: [{ code: 'keep', name: 'Keep' }] };
    const fdb = { doc: p => ({ set: async (data, opts) => {
      if (p.includes('/teachers/')) profile = opts.merge ? { ...profile, ...data } : data;
    } }) };
    const fn = new AsyncFunction('ctx', 'payload', 'fdb', 'orgs', 'base', 'displayName', 'admin',
      'applyCommandMenu', 'CMD_TEACHER', 'menuKeyboard', 'sendSafe', code);
    const ctx = { from: { id }, reply: async () => {} };
    await fn(ctx, 't_school', fdb, new Map([['school', { ownerTgId: 100, name: 'School' }]]), 'base',
      () => 'Teacher', { firestore: { FieldValue: { arrayUnion: v => [v] } } }, () => {}, [], () => {}, async () => {});
    assert.deepEqual(profile.classes, [{ code: 'keep', name: 'Keep' }]);
    assert.equal(profile.role, id === 100 ? 'org_owner' : 'org_teacher');
  }
});
