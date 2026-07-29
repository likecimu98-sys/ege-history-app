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
  shuffleArray(items) { return [...items]; },
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

const lawRows = [
  { process: 'развитие законодательства Древней Руси', fact: 'создание Устава Владимира Всеволодовича', year: 1113 },
  { process: 'развитие законодательства в Древней Руси', fact: 'создание первой части Русской Правды', year: 1016 },
  { process: 'формирование свода законов Русская Правда', fact: 'написание Устава Владимира Мономаха', year: 1113 },
];
for (let i = 0; i < lawRows.length; i++) {
  for (let j = i + 1; j < lawRows.length; j++) {
    assert.equal(
      tableContext._task3Conflicts(lawRows[i], lawRows[j]),
      true,
      'Task 3 law-process variants must never share one table'
    );
  }
}
assert.equal(
  tableContext._task3Conflicts(
    { process: 'организация совместной обороны Руси против половцев', fact: 'Любечский съезд князей', year: 1097 },
    { process: 'борьба Руси против половцев', fact: 'поход князя Игоря', year: 1185 }
  ),
  true,
  'Task 3 Polovtsy processes must not create two defensible matches'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'распад Древнерусского государства на самостоятельные княжества и земли', fact: 'разорение Киева войском Андрея Боголюбского', year: 1169 },
    { process: 'распад Руси на самостоятельные земли', fact: 'установление республиканского правления в Новгороде', year: 1136 }
  ),
  true,
  'Task 3 fragmentation processes must not create two defensible matches'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'распад Древнерусского государства на самостоятельные княжества и земли', fact: 'разорение Киева войском Андрея Боголюбского', year: 1169 },
    { process: 'установление республиканской формы правления в Новгороде', fact: 'изгнание князя Всеволода Мстиславича', year: 1136 }
  ),
  true,
  'Task 3 republican-form wording must be recognized as the fragmentation family'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'правление князя Ярослава Мудрого', fact: 'разгром печенегов', year: 1036 },
    { process: 'развитие законодательства в Древней Руси', fact: 'создание первой части Русской Правды при Ярославе Мудром', year: 1016 }
  ),
  true,
  'Task 3 broad Yaroslav process must not coexist with another Yaroslav fact'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'борьба русских земель с монгольскими завоевателями', fact: 'двухнедельная оборона Торжка', year: 1238 },
    { process: 'первое столкновение Руси с монгольским войском', fact: 'битва на реке Калке', year: 1223 }
  ),
  true,
  'Task 3 Mongol-conflict processes must not accept each other’s facts'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'внешнеполитическая деятельность первых русских князей', fact: 'поход князя Олега на Византию', year: 907 },
    { process: 'внешняя политика князя Владимира Святославича', fact: 'осада Корсуни', year: 988 }
  ),
  true,
  'Task 3 broad early foreign-policy process must not coexist with a specific ruler process'
);
assert.equal(
  tableContext._task3Conflicts(
    { process: 'принятие христианства на Руси', fact: 'крещение Руси при князе Владимире Святославиче', year: 988 },
    { process: 'внешняя политика князя Владимира Святославича', fact: 'осада Корсуни русским войском', year: 988 }
  ),
  true,
  'Task 3 Christianization and Korsun rows must not create two defensible matches'
);
assert.equal(
  tableContext._task5Interchangeable(
    { event: 'составление Русской Правды', person: 'Ярослав Мудрый', year: 1016 },
    { event: 'законодательное ограничение произвола ростовщиков', person: 'Владимир Мономах', year: 1113 }
  ),
  true,
  'Vladimir Monomakh must not be offered as a second defensible author of Russkaya Pravda'
);
assert.equal(
  tableContext._task5Interchangeable(
    { event: 'расцвет Владимиро-Суздальского княжества', person: 'Всеволод Большое Гнездо', year: 1176 },
    { event: 'перенос столицы из Суздаля во Владимир', person: 'Андрей Боголюбский', year: 1157 }
  ),
  true,
  'Andrei Bogolyubsky and Vsevolod must not both defend the broad principality-flourishing event'
);
assert.match(
  dataSource,
  /event: "окончательный разгром печенегов под Киевом", person: "Ярослав Мудрый"/,
  'Task 5 Pecheneg event must identify Yaroslav’s specific victory'
);
assert.doesNotMatch(
  dataSource,
  /event: "борьба Руси с печенегами", person: "Ярослав Мудрый"/
);
assert.match(
  dataSource,
  /event: "заключение договора Руси с Византией в 944 г\.", person: "князь Игорь Старый"/,
  'Task 5 treaty with Byzantium must distinguish Igor from Oleg'
);
assert.doesNotMatch(
  dataSource,
  /event: "заключение договора Руси с Византией", person: "князь Игорь Старый"/
);
assert.match(
  stateSource,
  /\/памятник культуры создан в \(\?:xi\|11\) в\/i, \[2, 3, 4, 5, 6, 166\]/,
  'Task 7 generic XI-century trait must cover every applicable early object'
);
assert.match(
  stateSource,
  /ярослав\[а-я\]\* мудр\/i, \[2, 3, 4\]/,
  'Task 7 Yaroslav-era monument trait must also cover Slovo o Zakone i Blagodati'
);
assert.match(
  stateSource,
  /новгородск\[а-я\]\* земл\/i, \[3, 14\]/,
  'Task 7 Novgorod-land trait must cover both applicable churches'
);
assert.match(
  stateSource,
  /киево-печерск\[а-я\]\* монастыр\)\/i, \[6, 11, 166\]/,
  'Task 7 Nestor traits must cover the chronicle and both Boris-and-Gleb titles'
);
assert.match(
  stateSource,
  /\/андрея боголюбского\/i, \[8, 9, 12\]/,
  'Task 7 monuments created under Andrei Bogolyubsky must be one ambiguity group'
);
assert.match(
  stateSource,
  /\/современником владимира мономаха\/i, \[6, 10, 11\]/,
  'Task 7 Monomakh-contemporary traits must be one ambiguity group'
);
assert.match(
  stateSource,
  /\/произведение создано в \(\?:xii\|12\) в\/i, \[7, 8, 9, 10, 11, 12, 13, 14\]/,
  'Task 7 generic XII-century work trait must cover every applicable object'
);
const task7Rows = [
  { id: 1, culture: 'Общий памятник', trait: 'Общая характеристика', appliesToIds: [1, 2, 3] },
  { id: 2, culture: 'Памятник 2', trait: 'Характеристика 2', appliesToIds: [2] },
  { id: 3, culture: 'Памятник 3', trait: 'Характеристика 3', appliesToIds: [3] },
  { id: 4, culture: 'Памятник 4', trait: 'Характеристика 4', appliesToIds: [4] },
  { id: 5, culture: 'Памятник 5', trait: 'Характеристика 5', appliesToIds: [5] },
];
const compatibleTask7 = tableContext.pickCompatibleTask7Target(task7Rows, 4);
assert.equal(compatibleTask7.length, 4, 'Narrow task 7 must backtrack to a complete four-row table');
for (let i = 0; i < compatibleTask7.length; i++) {
  for (let j = i + 1; j < compatibleTask7.length; j++) {
    const a = compatibleTask7[i], b = compatibleTask7[j];
    assert.equal(
      a.appliesToIds.includes(b.id) || b.appliesToIds.includes(a.id),
      false,
      'Backtracking task 7 selection must contain no cross-applicable traits'
    );
  }
}

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

// ─── Режимы дуэли: стыковка и единая формула очков ───────────────────────────
// Свайп и подбор делят один рейтинг Elo и один топ дуэлей. Если формула очков
// разъедется, победы в двух режимах начнут стоить разного — а увидим мы это
// только по кривому топу через неделю. Поэтому обе проверяются вместе.
const matchSource = read('match-mode.js');
const swipeSource = read('swipe-mode.js');
const modesSource = read('modes.js');

const SCORE_FORMULA = /score \+?= 10 \+ Math\.min\(20, \(_(?:sw|m)\.streak - 1\) \* 2\)/;
assert.match(swipeSource, SCORE_FORMULA, 'swipe duel lost the shared scoring formula');
assert.match(matchSource, SCORE_FORMULA, 'match duel lost the shared scoring formula');
assert.match(swipeSource, /score = Math\.max\(0, _sw\.score - 5\)/, 'swipe duel lost the miss penalty');
assert.match(matchSource, /score = Math\.max\(0, _m\.score - 5\)/, 'match duel lost the miss penalty');

// Дуэль не должна засчитываться в дневную норму: норма — про самостоятельную работу.
assert.match(matchSource, /if \(_m\.duel\) \{[\s\S]*?\} else if \(window\.creditNorm\)/,
  'match duel must not credit the daily norm');

// Совместимость режимов: 'auto' стыкуется с любым играбельным, конкретный — только
// сам с собой, неизвестный режим не играется вовсе (защита старых клиентов).
const modeHelpers = cloudSource.match(
  /const DUEL_MODES_PLAYABLE = \[[^\]]*\];[\s\S]*?function _duelModeMatches\(want, has\) \{[\s\S]*?\n        \}/);
assert.ok(modeHelpers, 'duel mode helpers not found in cloud-sync.js');
const modeCtx = vm.createContext({});
vm.runInContext(modeHelpers[0] + '\nthis.playable = _duelModePlayable; this.matches = _duelModeMatches;', modeCtx);
assert.equal(modeCtx.playable('swipe'), true);
assert.equal(modeCtx.playable('match'), true);
assert.equal(modeCtx.playable('classic'), false, 'classic must not be offered as a playable duel');
assert.equal(modeCtx.playable(undefined), false, 'a match without mode is legacy classic — not playable');
assert.equal(modeCtx.matches('auto', 'swipe'), true);
assert.equal(modeCtx.matches('auto', 'match'), true);
assert.equal(modeCtx.matches('auto', 'quiz'), false, 'auto must never join a mode this build cannot play');
assert.equal(modeCtx.matches('swipe', 'match'), false, 'an explicit mode must not cross over');
assert.equal(modeCtx.matches('match', 'match'), true);

// Роутинг режима в игру: без него игрок сядет в классическую таблицу против подбора.
assert.match(modesSource, /duelMode === 'match' && window\.openMatchDuel/, 'match duel is not routed in startDuelGame');
assert.match(modesSource, /duelMode === 'swipe' && window\.openSwipeDuel/, 'swipe duel routing was lost');
// Колода подбора обязана уехать в документ матча — иначе у игроков разные карточки.
assert.match(cloudSource, /\.\.\.\(matchRounds \? \{ matchRounds \} : \{\}\)/, 'match deck is not stored in the match document');
assert.match(cloudSource, /window\.state\.duel\.matchRounds = data\.matchRounds \|\| null/, 'match deck is not read back from the match document');

console.log('Homework, table uniqueness and silent duel self-test passed.');
