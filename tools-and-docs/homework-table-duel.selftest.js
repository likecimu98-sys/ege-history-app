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

// Очистка обязана учитывать И удалённые legacy-фантомы, И свежие надгробия
// revoked — обе перемены требуют saveProgress, иначе не доедут до облака.
assert.match(stateSource, /const removedLegacy = \(assignmentsBeforeCleanup - s\.assignments\.length\) \+ tombstoned/);
// Отзыв ДЗ ставит надгробие, а не удаляет запись: удалённое воскресает при слиянии.
assert.match(stateSource, /a\.status = 'revoked'; a\.updatedAt = Date\.now\(\); marked\+\+;/,
  'reconcileRevokedAssignments must tombstone, not delete');
assert.doesNotMatch(stateSource, /s\.assignments = s\.assignments\.filter\(a => !\(a && set\.has\(a\.id\)/,
  'reconcileRevokedAssignments must not delete revoked records');
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
// Норма и прогресс ДЗ живут ТОЛЬКО в ветке «не дуэль».
assert.match(matchSource, /if \(_m\.duel\) \{[\s\S]*?\} else \{\s*\n\s*if \(window\.creditNorm\) window\.creditNorm\(1, 'task1'\);/,
  'match duel must not credit the daily norm');
// ДЗ «подбор» не проходит через checkAnswers — без этого вызова этап не сдвинется.
assert.match(matchSource, /if \(_m\.hw && window\.creditActiveHwItem\) \{\s*\n\s*window\.creditActiveHwItem\('match', 1, 0\);/,
  'match homework progress is not credited');
// Рамки учителя обязаны переживать нормализацию задания и оба санитайзера выдачи.
assert.match(stateSource, /const RANGE_TASKS = new Set\(\['cram', 'match'\]\)/, 'HW range-task list changed');
assert.equal((cloudSource.match(/window\.HW_RANGE_TASKS \|\| new Set\(\['cram'\]\)/g) || []).length, 2,
  'both assignment sanitizers must keep year ranges for range-tasks');
assert.match(uiSource, /window\.openMatchMode\(\{ hw: true, yearStart: it\.yearStart, yearEnd: it\.yearEnd \}\)/,
  'match homework must start with the teacher year range');

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

// ─── Анкета не должна всплывать у знакомого человека ─────────────────────────
// В Telegram localStorage может не пережить перезапуск клиента. Если решать по
// одному флагу, знакомого ученика спрашивают имя и согласие при каждом входе —
// это выглядит как потеря аккаунта и убивает возврат.
assert.match(uiSource, /function _alreadyOnboarded\(\)[\s\S]*?stats\.consent/,
  'onboarding must also accept consent restored from the cloud');
assert.match(uiSource, /if \(!_inTelegramNow\(\)\) \{ _showOnboardingOverlay\(\); return; \}/,
  'outside Telegram the onboarding must stay immediate');
assert.match(uiSource, /document\.addEventListener\('ege:cloud-state-loaded', once, \{ once: true \}\)/,
  'in Telegram the onboarding must wait for the cloud answer');
assert.match(uiSource, /setTimeout\(once, ONBOARDING_CLOUD_WAIT_MS\)/,
  'a new student must still see consent if the cloud never answers');
// Сигнал обязан приходить и при упавшей загрузке, иначе анкета зависнет невидимой.
assert.match(cloudSource, /finally \{[\s\S]{0,400}window\._cloudStateLoaded = true;[\s\S]{0,200}ege:cloud-state-loaded/,
  'the cloud-loaded signal must fire in finally, not only on success');
// Домашка собственной группы не должна висеть на учителе.
assert.match(cloudSource, /async function _dropOwnClassHomework\(groups\)/, 'teacher own-class HW sweep is missing');
assert.match(stateSource, /myClasses\.has\(a\.classCode\)/, 'refreshHwState must drop own-class homework');
assert.match(stateSource, /classCode: rec\.classCode \|\| null/, 'assignment classCode must survive normalization');
// 🔴 Журнал класса тянется в слушателе ДЗ по коду из localStorage, а сам код
// приезжает из облака ПОЗЖЕ — при загрузке профиля. На чистом устройстве (новый
// телефон, очистка данных, инкогнито) слушатель отрабатывал с пустым кодом, и
// первый вход оставался без домашки, хотя в журнале класса она лежала.
// Проверяем именно догрузку в момент, когда код стал известен.
assert.match(cloudSource,
  /localStorage\.setItem\('student_class_code', bestData\.classCode\);[\s\S]{0,1500}window\.pullClassAssignments\(bestData\.classCode\)/,
  'restoring classCode from the cloud must immediately pull the class journal');
// 🔴 Журнал класса обязан записываться ДО персональной рассылки. Пока он шёл
// последним, обрыв цикла по ученикам (закрытая вкладка, уснувший WebView, сеть)
// оставлял класс без журнала: 31.07 в летней школе ДЗ получили 13 из 145, а
// догнать остальных было нечем. Проверяем именно ПОРЯДОК двух записей.
{
  const assignBody = cloudSource.slice(cloudSource.indexOf('const codes = [...new Set(students.map'));
  const journalAt = assignBody.indexOf('assignments: arrayUnion(rec)');
  const fanoutAt = assignBody.indexOf('pendingAssignments: arrayUnion(rec)');
  assert.ok(journalAt > -1 && fanoutAt > -1, 'homework assign must write both the journal and per-student records');
  assert.ok(journalAt < fanoutAt,
    'the class journal must be written BEFORE the per-student fan-out, so an interrupted assign is still recoverable');
}

// 🔴 Отказ входа обязан ГОВОРИТЬ, а не молчать.
// Fail-closed сам по себе правильный (чужую серверную сессию подхватывать нельзя),
// но он был немым: клиент ретраил каждые 5 с, а ученик видел пустой аккаунт и не
// мог отличить «нет связи» от «сломалось приложение». Отсюда весь поток жалоб
// «не работает» без подробностей. Первую неудачу намеренно молчим — это обычно
// моргнувшая сеть; говорим со второй подряд.
const indexSourceHw = read('index.html');
assert.match(indexSourceHw, /id="lobby-cloud-banner"/,
  'плашка «нет связи с аккаунтом» исчезла — отказ входа снова немой');
assert.match(cloudSource, /_authFailStreak\+\+;[\s\S]{0,200}if \(_authFailStreak >= 2\)/,
  'плашка обязана показываться со ВТОРОЙ неудачи подряд, а не с первой и не никогда');
assert.match(cloudSource, /window\.retryCloudLogin = function/,
  'кнопка «войти заново» ни к чему не привязана');
assert.match(cloudSource, /_authFailStreak = 0;[\s\S]{0,80}_cloudBanner\(false\)/,
  'после удачного входа плашку обязаны убирать, иначе она останется висеть навсегда');

// ─── Перетаскивание: чужие фишки трогать нельзя ──────────────────────────────
// Слушатель висит на document и физически видит ЛЮБОЙ `.dnd-chip` на странице.
// Пока у него не было понятия «зона», он хватал варианты пробника и клал их
// логикой тренажёра таблиц: узел переезжал в слот, а в состояние пробника
// ответ не попадал и пропадал при следующей перерисовке (жалобы учеников 30.07
// «не сохранил ответы на 1, 2, 3, 4, 5, 7»). Проверяем именно РАЗДЕЛЕНИЕ, а не
// наличие слова: код обязан спрашивать зону и класть руками владельца.
const examSource = read('exam-mode.js');
assert.match(tableSource, /window\.registerChipDropZone = function/, 'chip drag lost its zone registry');
assert.match(tableSource, /const zone = zoneOf\(chip\);\s*\n\s*if \(!zone\) return;/,
  'a chip outside every registered zone must not be draggable at all');
assert.match(tableSource, /zone\.handlers\.drop\(chip, target\)/,
  'the drop must be performed by the zone owner, not by the table trainer');
assert.doesNotMatch(tableSource, /if \(drop && target && !isLocked\(target\)\) \{\s*\n\s*handleSlotClick\(target\)/,
  'the drag must not call the table trainer directly any more');
assert.match(tableSource, /zoneOf\(slot\) === drag\.zone/,
  'a chip must never be droppable into another zone slot');
assert.match(tableSource, /registerChipDropZone\('#classic-task-area'/, 'the table trainer must register its own zone');
assert.match(examSource, /registerChipDropZone\('#exam-mode-overlay'/, 'the mock exam must register its own zone');
// Пробник обязан класть ответ ЧЕРЕЗ СВОЁ состояние, иначе он снова «не сохранится».
assert.match(examSource, /ctx\.commit\(placeDigitInSlot\(ctx\.task, ctx\.value, chip\.dataset\.value/,
  'the mock exam drop must go through its own answer state');
// Один вариант стоит ровно в одном слоте — и при тапе, и при переносе.
assert.match(examSource, /function placeDigitInSlot\(task, value, digit, index\)[\s\S]{0,260}previousIndex !== -1\) slots\[previousIndex\] = ''/,
  'placeDigitInSlot must free the slot the digit came from');

// ─── Тренажёр визуала: разбор нельзя обрезать ────────────────────────────────
// `overflow: hidden` на корне вместе с max-height делал кнопку «Дальше»
// физически недостижимой после неверного ответа: прокрутки внутри нет, страница
// не растёт. Ученик с iPhone: «ничего больше не выходит, только в лобби выходить».
const stylesSource = read('styles.css');
assert.match(stylesSource, /\.visual-trainer-root \{[^}]*overflow-y: auto/,
  'visual trainer must scroll its content, never clip it');
assert.doesNotMatch(stylesSource, /\.visual-trainer-root \{[^}]*overflow: hidden/,
  'visual trainer must not clip the razbor and the next button again');
assert.match(read('visual-trainer.js'), /btn\.scrollIntoView\(\{ block: 'nearest'/,
  'the next button must be scrolled into view after a wrong answer');

// ─── Уведомление о ДЗ не должно зависеть от цикла выдачи ─────────────────────
// 31.07.2026: массовая выдача создавала задание боту ВНУТРИ цикла по ученикам, по
// штуке на каждого. Цикл оборвался — и до кого не дошли, тот не получил сообщения
// НИКОГДА: из 145 человек уведомили 17, остальных 129 досылали руками из базы.
// Само ДЗ при этом доходило, его догоняет журнал класса, — потому и заметили не
// сразу, жалоба звучала как «бот не рассылает домашку».
const botSource = read('server/bot/src/bot.js');
// Якорь — тост массовой выдачи: он есть только в ней и переживает переименования.
const assignAt = cloudSource.indexOf('Выдаю ДЗ ');
assert.ok(assignAt >= 0, 'Не найдена массовая выдача ДЗ');
const assignBody = cloudSource.slice(assignAt, assignAt + 4000);

const bulkAt = assignBody.indexOf("type: 'hw_assigned_bulk'");
const loopAt = assignBody.indexOf('for (const s of students)');
assert.ok(bulkAt >= 0, 'Пропало общее задание боту со списком получателей');
assert.ok(loopAt >= 0, 'Не найден цикл персональной выдачи');
assert.ok(bulkAt < loopAt,
    'Уведомление снова ставится в очередь ПОСЛЕ цикла (или внутри него). Обрыв цикла '
    + 'опять оставит часть класса без сообщения о домашке — так потеряли 129 из 145.');
assert.doesNotMatch(assignBody.slice(loopAt),
    /for \(const s of students\)[\s\S]{0,600}_notifyJob\(/,
    'Внутри цикла выдачи снова создаётся задание боту на каждого ученика — это и есть '
    + 'та самая зависимость уведомления от того, дожил ли цикл до конца');

// Бот обязан понимать общий список, иначе уведомления просто перестанут приходить.
assert.match(botSource, /j\.type === 'hw_assigned_bulk' && Array\.isArray\(j\.studentIds\)/,
    'Бот не обрабатывает общее задание со списком получателей — уведомления о ДЗ не дойдут ни до кого');
// Неудачная отправка не должна помечать ученика обработанным: иначе повтор задания
// его пропустит, и сообщения он не получит уже никогда.
assert.match(botSource, /failed\+\+;[\s\S]{0,120}continue;/,
    'Отказ отправки снова помечает ученика обработанным — при повторе задания его пропустят');
assert.match(botSource, /if \(failed\) throw new Error\(`bulk_notify_partial/,
    'Частичная неудача рассылки больше не отправляет задание на повтор — потерянные адресаты не догонятся');

// ─── Выданное ДЗ нельзя стирать, не приняв ──────────────────────────────────
// 01.08.2026: у Султана и Веры три выдачи подряд исчезли — в профиле
// pendingAssignments пуст, в состоянии assignments: []. Приёмка чистила выдачу
// БЕЗУСЛОВНО (`arrayRemove(...pending)`), даже когда не приняла ни одной записи.
// Второго шанса нет: у ученика пусто, а учитель видит «выдано».
// ⚠️ Комментарии вырезаем: объяснение выше само содержит запрещённую строку, и без
// этого тест падал на собственном тексте. Тот же капкан, что у стража полей состояния.
const stripJsComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const cloudCode = stripJsComments(cloudSource);
const stateCode = stripJsComments(stateSource);

assert.doesNotMatch(cloudCode, /arrayRemove\(\.\.\.pending\)/,
    'Приёмка ДЗ снова стирает ВСЮ выдачу, включая непринятое. Так домашка пропадает '
    + 'навсегда: в профиле пусто, в состоянии пусто, повторить нечем.');
assert.match(cloudCode, /arrayRemove\(\.\.\.handled\)/,
    'Приёмка ДЗ должна снимать только реально обработанные записи');
assert.match(cloudCode, /if \(!window\.ingestAssignment\) \{ skipped\.noIngest\+\+; return; \}/,
    'Запись, которую не смогли принять, обязана ОСТАТЬСЯ в выдаче — иначе она потеряна');
assert.match(cloudCode, /window\.reportSilent\('ДЗ пришло, но не принято'|reportSilent\(\s*'ДЗ пришло, но не принято'/,
    'Молчаливый пропуск выданного ДЗ снова не сообщается — жалобу «пришло и пропало» опять поймаем со слов');

// ─── Запись без метки времени не «древняя» ──────────────────────────────────
// `(a.assignedAt || 0)` превращало отсутствующую метку в ноль, то есть в «выдано до
// начала времён», и метка «с чистого листа» хоронила такое ДЗ при каждом пересчёте —
// сразу после того, как оно пришло. Это и есть «появилось на секунду и пропало».
assert.doesNotMatch(cloudCode, /\(a\.assignedAt \|\| 0\) < sweepTs/,
    'Отсутствующая метка времени снова считается древностью — ДЗ будет сноситься «чистым листом»');
assert.doesNotMatch(stateCode, /Number\(a\.assignedAt \|\| 0\) < before/,
    'revokedLocally снова хоронит ДЗ без метки времени');
assert.match(stateCode, /const at = Number\(a\.assignedAt\);\s*\n\s*if \(!at\) return false;/,
    'revokedLocally должен пропускать записи без метки времени, а не считать их снятыми');

// ─── Слияние состояния не имеет права ТЕРЯТЬ домашку ────────────────────────
// 01.08.2026, корень жалобы «ДЗ пришло, плашка мигнула, список пуст»:
// applyMergedState присваивал `window.state.stats.assignments = st.assignments`
// ЦЕЛИКОМ. А слияние перед записью в облако собирается из копии профиля и
// localStorage, снятых ДО сетевого запроса. Пока запрос летит, приходит новое ДЗ и
// живёт только в памяти; ответ возвращается — и присвоение затирает список ПУСТЫМ,
// потом тем же пустым перезаписывается localStorage и уезжает в облако.
// Ломается тем чаще, чем медленнее сеть, — поэтому ловилось на телефонах.
assert.doesNotMatch(cloudCode, /window\.state\.stats\.assignments = st\.assignments;/,
    'applyMergedState снова ЗАМЕНЯЕТ список ДЗ целиком. Пустой результат слияния '
    + 'сотрёт домашку, пришедшую во время сетевого запроса, — и в памяти, и в localStorage.');
assert.match(cloudCode, /_mergeAssignmentLists\(window\.state\.stats\.assignments, st\.assignments\)/,
    'applyMergedState должен ДОПОЛНЯТЬ список ДЗ, а не заменять');

// Поведенческая проверка самой функции слияния: вытаскиваем её из исходника и гоняем.
{
    const fnStart = cloudSource.indexOf('function _mergeAssignmentLists');
    assert.ok(fnStart >= 0, 'Пропала функция слияния списков ДЗ');
    // Функция объявлена целиком до applyMergedState — берём кусок между ними.
    const fnEnd = cloudSource.indexOf('function applyMergedState', fnStart);
    assert.ok(fnEnd > fnStart, 'Не найден конец функции слияния');
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(cloudSource.slice(fnStart, fnEnd) + '\nglobalThis.merge = _mergeAssignmentLists;', ctx,
        { filename: 'merge-assignments.js' });
    const merge = ctx.merge;

    // Главный случай: в памяти свежее ДЗ, из облака пришёл пустой список.
    const fresh = [{ id: 'a_new', status: 'active', items: [{ goal: 10, progress: 0 }] }];
    assert.equal(merge(fresh, []).length, 1,
        'Пустой список из облака СТИРАЕТ свежее ДЗ — ровно эта потеря и ловилась у учеников');
    assert.equal(merge([], fresh).length, 1, 'Слияние обязано принимать ДЗ и из входящего списка');

    // Сданное не откатывается до активного ни с какой стороны.
    const done = [{ id: 'a1', status: 'done', items: [] }];
    const active = [{ id: 'a1', status: 'active', items: [] }];
    assert.equal(merge(done, active)[0].status, 'done', 'Активная копия не должна отменять сдачу');
    assert.equal(merge(active, done)[0].status, 'done', 'Сдача обязана побеждать активную копию');

    // Надгробие отзыва бьёт активное, но не сданное.
    const revoked = [{ id: 'a1', status: 'revoked', items: [] }];
    assert.equal(merge(active, revoked)[0].status, 'revoked', 'Отзыв обязан побеждать активное');
    assert.equal(merge(done, revoked)[0].status, 'done', 'Отзыв не отнимает уже сданное');

    // У двух активных копий берём максимальный прогресс каждого этапа.
    // ⚠️ Проверяем ОБА порядка. Первая редакция теста сверяла только (низкий, высокий)
    // и пропускала подмену условия на безусловное присваивание: в обратном порядке
    // прогресс молча откатывался назад. Проверено саботажем.
    const mkLow = () => [{ id: 'a1', status: 'active', items: [{ goal: 10, progress: 2 }] }];
    const mkHigh = () => [{ id: 'a1', status: 'active', items: [{ goal: 10, progress: 7 }] }];
    assert.equal(merge(mkLow(), mkHigh())[0].items[0].progress, 7, 'Прогресс ДЗ должен подниматься до большего');
    assert.equal(merge(mkHigh(), mkLow())[0].items[0].progress, 7, 'Прогресс ДЗ не должен откатываться назад');

    // Активные фантомы старой модели не воскресают.
    assert.equal(merge([], [{ id: 'legacy_x', status: 'active', items: [] }]).length, 0,
        'Активные legacy_* обязаны отсеиваться');
}

// ─── Период ДЗ обязан действовать на СТРОКИ ─────────────────────────────────
// 01.08.2026, жалоба ученицы: «несмотря на установленный временной период, в 4, 5 и 7
// попадаются задания со всей истории». Индексы в hwCurrentPool приходят ссылкой из
// бота и указывают в ПОЛНЫЙ набор данных — период к ним не применялся вовсе. ДЗ
// «задание №4, 862–1340» показывало Кёнигсберг 1945 и линию Маннергейма, и прогресс
// засчитывался за чужие годы.
{
    // Поведенческая проверка на настоящем отборе из table.js.
    const rows = [
        { year: '1036 г.', geo: 'Киев', event: 'разгром печенегов', c: 'early' },
        { year: '1945 г.', geo: 'Кёнигсберг', event: 'операция в Восточной Пруссии', c: '20th' },
        { year: '1113 г.', geo: 'Киев', event: 'восстание', c: 'early' },
        { year: '1812 г.', geo: 'Тарутино', event: 'манёвр русской армии', c: '19th' },
    ];
    const inPeriod = new Set([rows[0], rows[2]]); // только 862–1340

    const ctx = {
        console,
        document: { addEventListener() {} },
        requestAnimationFrame() {},
        shuffleArray(items) { return [...items]; },
        setTimeout, clearTimeout,
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.state = { hwCurrentPool: [0, 1, 2, 3] };
    ctx.task3Data = [];
    vm.createContext(ctx);
    vm.runInContext(tableSource, ctx, { filename: 'table.js' });

    const picked = ctx._selectHomeworkTargets(
        'task4', { displayField: 'event', fieldName: 'year' }, rows, [0, 1, 2, 3], 4, inPeriod);

    const years = picked.map(r => r.year);
    assert.ok(!years.includes('1945 г.') && !years.includes('1812 г.'),
        `В ДЗ попали строки вне заданного периода: ${years.join(', ')}. `
        + 'Период обязан отсекать строки, а не только подписывать заголовок.');
    assert.ok(years.includes('1036 г.'), 'Строки внутри периода обязаны оставаться доступными');

    // Выбывшие из периода не должны копиться в пуле и перебираться заново.
    assert.ok(!ctx.state.hwCurrentPool.includes(1) && !ctx.state.hwCurrentPool.includes(3),
        'Строки вне периода обязаны выбывать из пула ДЗ насовсем');

    // ── Рамки задания побеждают фильтр периода ──────────────────────────────
    // При заходе в ДЗ по ссылке из бота (`?hw=`) фильтр периода не выставляется
    // вовсе — остаётся «вся история». Проверка по нему пропускала все строки, и ДЗ
    // «862–1340» продолжало показывать 1945 год уже ПОСЛЕ починки 02.08.
    ctx.getYearFromFact = d => parseInt(String(d && d.year).match(/\d+/) || 0, 10) || 0;
    ctx.getBasePool = () => rows;               // фильтр разрешает всё («вся история»)
    ctx.getActiveHwRange = () => ({ from: 862, to: 1340 });
    const byAssignment = ctx._hwAllowedRows(rows, 'all');
    assert.ok(byAssignment.has(rows[0]) && byAssignment.has(rows[2]),
        'Строки внутри рамок задания обязаны быть разрешены');
    assert.ok(!byAssignment.has(rows[1]) && !byAssignment.has(rows[3]),
        'Рамки ДЗ проиграли фильтру периода: при заходе из бота фильтр = «вся история», '
        + 'и ДЗ снова покажет 1945 год');

    // Нет рамок у задания (этап без годов) — работаем по фильтру, как раньше.
    ctx.getActiveHwRange = () => null;
    assert.equal(ctx._hwAllowedRows(rows, 'all').size, rows.length,
        'Без рамок у задания отбор обязан падать обратно на фильтр периода');

    // Без набора-ограничителя поведение прежнее — иначе сломались бы старые вызовы.
    ctx.state.hwCurrentPool = [0, 1, 2, 3];
    const all = ctx._selectHomeworkTargets(
        'task4', { displayField: 'event', fieldName: 'year' }, rows, [0, 1, 2, 3], 4);
    assert.equal(all.length, 4, 'Без ограничителя периода отбор обязан работать как раньше');
}

// Оба сборщика таблиц обязаны передавать рамки периода в отбор ДЗ.
assert.equal((tableSource.match(/_selectHomeworkTargets\([\s\S]{0,220}?_hwAllowedRows\(/g) || []).length, 2,
    'Не оба сборщика таблиц ограничивают ДЗ рамками задания (нужны и общий, и task4)');
// Рамки берём У ЗАДАНИЯ, а не у фильтра: при заходе по ссылке из бота фильтр периода
// не выставляется вовсе, и по нему разрешено было бы всё.
assert.match(tableSource, /const range = window\.getActiveHwRange && window\.getActiveHwRange\(\);/,
    '_hwAllowedRows больше не спрашивает рамки у самого задания');
assert.match(stateSource, /window\.getActiveHwRange = function/,
    'Пропала выдача годов активного этапа ДЗ');
assert.doesNotMatch(tableSource, /_selectHomeworkTargets\('task4', TASK_CONFIG\.task4, window\.bigData, window\.state\.hwCurrentPool, rowsCount\)/,
    'task4 снова берёт строки ДЗ из полного bigData без периода');

// ─── Рабочий период: годы ДЗ и выбор ученика ────────────────────────────────
// 02.08.2026. Раньше _workingPeriod учитывал у этапа ДЗ ТОЛЬКО именованную эпоху
// (`it.period !== 'custom'`), а учитель почти всегда задаёт годами: у летней школы все
// восемь этапов — custom. Рабочий период проваливался на «дошли до года» класса, а
// если та граница не доехала на устройство — на всю историю. Плюс свой диапазон
// ученика нигде не хранился (ege_last_period пишет только эпохи) и затирался.
{
    const src = read('ui.js');

    // Этап ДЗ, заданный годами, обязан задавать рабочий период.
    assert.match(src, /it\.period === 'custom' && it\.yearStart && it\.yearEnd/,
        'Этап ДЗ с точными годами снова не задаёт рабочий период — «Учим новое» уйдёт мимо ДЗ');
    // Выбор ученика: хранится, побеждает лестницу, обрезается границей учителя.
    assert.match(src, /localStorage\.setItem\(OWN_RANGE_FROM/, 'Свой диапазон ученика снова не запоминается');
    assert.match(src, /const own = _ownChosenRange\(\);\s*\n\s*if \(own\) return own;/,
        'Рабочий период больше не отдаёт приоритет выбору ученика');
    // Решение владельца 02.08.2026: граница класса ограничивает ДОМАШКУ, а не
    // самостоятельные занятия. Обрезка выбора ученика по classUpto — регресс.
    assert.doesNotMatch(src, /Math\.min\(own\.to, classUpto\)/,
        'Выбор ученика снова обрезается границей учителя — он вправе учить что хочет вне ДЗ');
    assert.match(src, /window\.rememberOwnPeriod\(\$\('pg-filter-period'\)\.value/,
        'Кнопка «Применить» не сохраняет выбранный диапазон');
    // Диапазон должен доезжать до фильтра и до подписи.
    assert.match(src, /if \(wp && wp\.from && wp\.to\) \{[\s\S]{0,220}custom-year-start'\)\.value = wp\.from/,
        '_applyWpFilter не применяет диапазон {from,to}');
    assert.match(src, /if \(wp\.from && wp\.to\) return \{ from: wp\.from, to: wp\.to \};/,
        '_wpYearRange не понимает диапазон {from,to} — свайп получит чужие годы');

    // Аккаунт-зависимые ключи обязаны стираться при смене человека на общем устройстве.
    assert.match(cloudSource, /'ege_own_year_from', 'ege_own_year_to'/,
        'Свой диапазон не стирается при смене аккаунта — переедет к следующему ученику');
}

// ─── Гонка записи в облако не должна откатывать прогресс ─────────────────────
// Аудит ChatGPT/Codex 01.08: `localJson` снимался ДО `await getDoc`, и всё решённое
// за время запроса откатывалось назад — сначала в памяти, потом в облаке. Для
// assignments защиту сделали слиянием, остальные поля (totalSolvedEver, factStreaks,
// dailyStats, mistakesPool, пробники) перезаписываются целиком.
{
    // Якорь — ОПРЕДЕЛЕНИЕ функции: просто по имени первым попадается её вызов из выхода.
    const syncAt = cloudCode.indexOf('window.syncProgressToCloud = async function');
    assert.ok(syncAt >= 0, 'Не найдена запись прогресса в облако');
    const body = cloudCode.slice(syncAt, syncAt + 4000);
    const awaitAt = body.indexOf('await getDoc(doc(studentsCol, canonicalId))');
    const readAt = body.indexOf("localStorage.getItem('ege_final_storage_v4')");
    assert.ok(awaitAt >= 0 && readAt >= 0, 'Не найдены запрос профиля и чтение локального снимка');
    assert.ok(readAt > awaitAt,
        'Снимок локального состояния снова снимается ДО сетевого запроса. Всё, что ученик '
        + 'решит за время ожидания, откатится слиянием и уедет в облако откатанным.');
    assert.match(body, /if \(window\.saveLocal\) window\.saveLocal\(\);[\s\S]{0,200}ege_final_storage_v4/,
        'Живое состояние не сбрасывается в localStorage перед снятием снимка');
    assert.match(cloudCode, /deepMergeStates\(\s*\[blobJson, serverJson, freshLocal\]/,
        'Сверка после приватной записи снова не учитывает то, что решено за время запроса');
}

console.log('Homework, table uniqueness and silent duel self-test passed.');
