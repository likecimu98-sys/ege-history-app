'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const appSource = read('app.js');
const tableSource = read('table.js');
const uiSource = read('ui.js');
const stateSource = read('state.js');
const cloudSource = read('cloud-sync.js');
const dataSource = read('data.js');

assert.match(appSource, /new Set\(hwIds\.split\(','\)/, 'Homework URL indices must be deduplicated');
assert.match(appSource, /hwCurrentPool\.splice\(0, rows\.length\)/, 'Each solved row must advance homework once');

const tableContext = {
  console,
  document: { addEventListener() {} },
  requestAnimationFrame() {},
  setTimeout,
  clearTimeout,
};
tableContext.window = tableContext;
tableContext.globalThis = tableContext;
tableContext.state = { hwCurrentPool: [0, 1, 2] };
tableContext.task3Data = [];
vm.createContext(tableContext);
vm.runInContext(tableSource, tableContext, { filename: 'table.js' });

const task3Rows = [
  { process: 'борьба за власть между сыновьями Владимира Святого', fact: 'убийство Бориса и Глеба', year: 1015 },
  { process: '  Борьба за власть между сыновьями Владимира Святого  ', fact: 'вокняжение Ярослава', year: 1019 },
  { process: 'реформы Петра I', fact: 'учреждение Сената', year: 1711 },
];
tableContext.task3Data = task3Rows;
const selected = tableContext._selectHomeworkTargets(
  'task3',
  { displayField: 'process', fieldName: 'fact' },
  task3Rows,
  [0, 1, 2],
  2
);
assert.deepEqual(
  Array.from(selected, row => row.fact),
  ['убийство Бориса и Глеба', 'учреждение Сената'],
  'Visually duplicate task 3 processes must not appear in one table'
);
assert.deepEqual(
  Array.from(tableContext.state.hwCurrentPool),
  [0, 2, 1],
  'The duplicate row must move to the next round instead of being lost'
);

assert.doesNotMatch(
  dataSource,
  /борьба за власть между сыновьями Владимира Святославича/,
  'The FIPI wording must use the canonical task 3 process'
);
assert.match(
  dataSource,
  /process: "борьба за власть между сыновьями Владимира Святого", fact: "убийство князей Бориса и Глеба"/
);

assert.match(uiSource, /String\(a\.id \|\| ''\)\.indexOf\('legacy_'\) === 0/);
assert.match(uiSource, /window\.refreshHwState\) window\.refreshHwState\(\);\s*if \(window\.updateHwNavBadge\)/);
assert.match(uiSource, /const active = \(s\.assignments \|\| \[\]\)\.filter\(_hwAssignmentActive\)/);
assert.doesNotMatch(uiSource, /Sfx\.loop\('duel'\)/, 'Incoming duel challenge must never start looped audio');
assert.doesNotMatch(uiSource, /_playChallengeChime/, 'Incoming duel challenge must remain silent');
assert.match(uiSource, /duelChalPulse/, 'The silent visual duel notification must remain');

assert.match(stateSource, /const removedLegacy = assignmentsBeforeCleanup - s\.assignments\.length/);
assert.match(cloudSource, /a\.status === 'active' && String\(a\.id\)\.indexOf\('legacy_'\) === 0/);

const { mergeStateValues } = require(path.join(ROOT, 'server', 'api', 'src', 'state-merge'));
const merged = mergeStateValues([
  { stats: { assignments: [
    { id: 'legacy_task3_old', status: 'active', items: [{ task: 'task3', goal: 10, progress: 0 }] },
    { id: 'legacy_task3_done', status: 'done', items: [{ task: 'task3', goal: 5, progress: 5 }] },
    { id: 'hw-current', status: 'active', items: [{ task: 'task3', goal: 6, progress: 1 }] },
  ] } },
]);
assert.deepEqual(merged.stats.assignments.map(item => item.id).sort(), ['hw-current', 'legacy_task3_done']);
assert.equal(merged.stats.hwFlashcardsToSolve, 5);

console.log('Homework, table uniqueness and silent duel self-test passed.');
