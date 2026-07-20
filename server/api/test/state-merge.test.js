'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeStateValues, mergeStateJson } = require('../src/state-merge');

test('merges progress without losing mock exams, mistakes or assignments', () => {
  const oldState = {
    stats: {
      totalSolvedEver: 10,
      egePoints: 3,
      factStreaks: { a: { level: 1, points: 2 } },
      assignments: [{ id: 'hw1', status: 'active', items: [{ task: 'task1', goal: 10, progress: 4 }] }],
      mockExams: { active: { id: 'exam-active', updatedAt: 10 }, history: [] },
      mockExamMistakes: [{ id: 'm1', createdAt: 10, taskNumber: 4 }]
    },
    mistakesPool: [{ fact: { id: 'fact-1' }, task: 'task1' }]
  };
  const newState = {
    stats: {
      totalSolvedEver: 14,
      egePoints: 5,
      factStreaks: { a: { level: 2, points: 1 }, b: { level: 1 } },
      assignments: [{ id: 'hw1', status: 'active', items: [{ task: 'task1', goal: 10, progress: 8 }] }],
      mockExams: { active: null, history: [{ id: 'exam-finished', completedAt: 20, score: 15 }] },
      mockExamMistakes: [{ id: 'm2', createdAt: 20, taskNumber: 8 }]
    },
    mistakesPool: [{ fact: { id: 'fact-2' }, task: 'task3' }]
  };
  const merged = mergeStateValues([oldState, newState]);
  assert.equal(merged.stats.totalSolvedEver, 14);
  assert.equal(merged.stats.egePoints, 5);
  assert.equal(merged.stats.factStreaks.a.level, 2);
  assert.equal(merged.stats.assignments[0].items[0].progress, 8);
  assert.equal(merged.stats.hwFlashcardsToSolve, 2);
  assert.equal(merged.stats.hwTask1, 2);
  assert.equal(merged.stats.mockExams.active.id, 'exam-active');
  assert.deepEqual(merged.stats.mockExams.history.map(item => item.id), ['exam-finished']);
  assert.deepEqual(merged.stats.mockExamMistakes.map(item => item.id), ['m1', 'm2']);
  assert.equal(merged.mistakesPool.length, 2);
});

test('completed exam suppresses stale active copy with the same id', () => {
  const merged = mergeStateValues([
    { stats: { mockExams: { active: { id: 'same', updatedAt: 100 }, history: [] } } },
    { stats: { mockExams: { active: null, history: [{ id: 'same', completedAt: 200 }] } } },
  ]);
  assert.equal(merged.stats.mockExams.active, null);
  assert.equal(merged.stats.mockExams.history.length, 1);
});

test('mergeStateJson accepts old flat state shape', () => {
  const result = JSON.parse(mergeStateJson(JSON.stringify({ totalSolvedEver: 5 }), JSON.stringify({ stats: { totalSolvedEver: 9 } })));
  assert.equal(result.stats.totalSolvedEver, 9);
});

test('keeps assignment items added on either device and legacy exam mistakes', () => {
  const merged = mergeStateValues([
    { stats: { assignments: [{ id: 'hw', status: 'active', items: [{ task: 'task1', goal: 2, progress: 1 }] }] } },
    { stats: {
      assignments: [{ id: 'hw', status: 'active', updatedAt: 1, items: [
        { task: 'task1', goal: 2, progress: 1 },
        { task: 'task3', goal: 3, progress: 2 },
      ] }],
      mockExamMistakes: [{ taskNumber: 8, sourceId: 'old', createdAt: 1, prompt: 'legacy' }],
    } },
  ]);
  assert.equal(merged.stats.assignments[0].items.length, 2);
  assert.equal(merged.stats.assignments[0].items[1].progress, 2);
  assert.equal(merged.stats.mockExamMistakes.length, 1);
});
