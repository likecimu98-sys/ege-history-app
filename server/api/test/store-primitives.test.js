'use strict';

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePath, collectionFromPath, applyPatch, mergeMatchData } = require('../src/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

test('parses only known document and collection paths', () => {
  const doc = parsePath('artifacts/ege-history-bot/public/data/students/42');
  assert.equal(doc.table, 'student_profiles');
  assert.equal(doc.docId, '42');
  const collection = collectionFromPath('artifacts/ege-history-bot/private/data/state');
  assert.equal(collection.table, 'student_states');
  assert.throws(() => parsePath('artifacts/x/public/data/secrets/1'), /unknown_collection/);
  assert.throws(() => parsePath('artifacts/x/private/data/students/1'), /invalid_visibility/);
});

test('applies merge, delete and Firestore-compatible array operations', () => {
  const current = { keep: 1, remove: 2, values: [{ id: 1 }, { id: 2 }] };
  const result = applyPatch(current, {
    remove: { __vpsOp: 'delete' },
    values: { __vpsOp: 'arrayRemove', values: [{ id: 1 }] },
    added: { __vpsOp: 'arrayUnion', values: ['a', 'a', 'b'] },
  }, true);
  assert.deepEqual(result, { keep: 1, values: [{ id: 2 }], added: ['a', 'b'] });
});

test('set mode does not retain fields absent from the new document', () => {
  assert.deepEqual(applyPatch({ old: true }, { fresh: true }, false), { fresh: true });
});

test('duel merge ignores delayed and duplicate player updates', () => {
  const current = {
    status: 'playing', startTime: 100,
    player1: { uid: 'one', score: 5, combo: 2, seq: 3, final: false },
    player2: { uid: 'two', score: 4, combo: 1, seq: 2 },
  };
  const delayed = applyPatch(current, { player1: { uid: 'one', score: 3, combo: 0, seq: 2 } }, true);
  assert.deepEqual(mergeMatchData(current, delayed, { player1: delayed.player1 }).player1, current.player1);
  const finished = applyPatch(current, { status: 'finished', player1: { uid: 'one', score: 6, combo: 0, seq: 4, final: true } }, true);
  const merged = mergeMatchData(current, finished, { status: 'finished', player1: finished.player1 });
  assert.equal(merged.status, 'finished');
  assert.equal(merged.player1.score, 6);
  assert.equal(merged.player1.final, true);
});
