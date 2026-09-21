'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('rejoining school preserves groups and school owner role', async () => {
  const bot = fs.readFileSync(path.join(__dirname, '../server/bot/src/bot.js'), 'utf8');
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
