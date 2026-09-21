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

