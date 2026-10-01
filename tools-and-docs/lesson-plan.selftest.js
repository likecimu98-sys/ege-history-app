// Страж «Урока» главной кнопки (lesson-plan.js + обвязка в ui.js/state.js/app.js).
// Прогоняет сценарии реальных учеников (владелец 30.09.2026: «детально проработай
// сценарии»): новичок, класс с границей, свой период, давний ученик «вразброс»,
// знающий главу с первого раза, выбранная вручную глава, тонкие главы.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null, createElement: () => ({}) } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('data.js').replace(/\b(const|let)\s+(bigData|task\w*Data)\b/g, 'var $2'), ctx);
vm.runInContext(read('config.js').replace(/^const TASK_CONFIG/m, 'var TASK_CONFIG'), ctx);
vm.runInContext('window.state = { currentTask: "task4", stats: { factStreaks: {} } };', ctx);
// utils.js целиком требует DOM — берём из него ровно две нужные функции.
const utils = read('utils.js');
const NL = String.fromCharCode(10);
const fnSrc = name => { const i = utils.indexOf('function ' + name + '('); const j = utils.indexOf(NL + '}', i); assert.ok(i >= 0 && j > i, 'нет ' + name + ' в utils.js'); return utils.slice(i, j + 2); };
vm.runInContext(fnSrc('getYearFromFact') + NL + fnSrc('factKey'), ctx);
vm.runInContext(read('lesson-plan.js'), ctx);
const LP = ctx.LessonPlan;
const idx = LP.index();
const CH = LP.CHAPTERS;
assert.strictEqual(CH.length, 23, 'глав не 23');
// Главы идут встык, без дыр и наложений.
for (let i = 1; i < CH.length; i++) assert.strictEqual(CH[i].from, CH[i - 1].to + 1, 'дыра между главами ' + i);
assert.strictEqual(CH[0].from, 862); assert.strictEqual(CH[22].to, 2026);

// Почти каждый факт лежит в какой-то главе (без года — единицы).
let totalKeys = 0;
['task1', 'task3', 'task4', 'task5', 'task7'].forEach(t => {
  const data = t === 'task7' ? ctx.task7Data : ctx.TASK_CONFIG[t].data();
  totalKeys += new Set(data.map(f => ctx.factKey(f, t))).size;
});
assert.ok(idx.all.size >= totalKeys * 0.99, `в главах ${idx.all.size} из ${totalKeys} фактов`);

const keysOf = (a, b) => [...idx.all].filter(([, v]) => v.y >= a && v.y <= b).map(([k]) => k);
// Доля share выучена В КАЖДОЙ главе окна [a, b], остальное встречено.
const learnAll = (fsx, a, b, share, extra) => CH.forEach(c => { const lo = Math.max(a, c.from), hi = Math.min(b, c.to); if (lo <= hi) learnOne(fsx, lo, hi, share, extra); });
const learnOne = (fsx, a, b, share, extra) => { const ks = keysOf(a, b); ks.slice(0, Math.ceil(ks.length * share)).forEach(k => { fsx[k] = { level: 1, points: 3, nextReview: Date.now() + 864e5, ...(extra || {}) }; }); ks.slice(Math.ceil(ks.length * share)).forEach(k => { fsx[k] = fsx[k] || { level: 0, points: 1, nextReview: 0 }; }); };

// 1. Новичок — первая глава, всё в рамках.
let p = LP.plan({ fs: {}, from: 862, to: 2026 });
assert.strictEqual(p.cur.ch, 0); assert.strictEqual(p.cur.zone, 'in'); assert.strictEqual(p.closed, 0);
assert.strictEqual(p.cur.name, 'Русь IX–X вв.');

// 2. Закрытие главы: встречено ≥90% и выучено ≥50%.
let f = {}; learnAll(f, 862, 999, 0.5);
p = LP.plan({ fs: f, from: 862, to: 2026 });
assert.ok(p.chapters[0].closed, 'глава с 50% выученного и 100% встреченного не закрылась');
assert.strictEqual(p.cur.ch, 1, 'после закрытия первой главы урок не перешёл ко второй');
f = {}; learnAll(f, 862, 999, 0.4);
assert.ok(!LP.plan({ fs: f, from: 862, to: 2026 }).chapters[0].closed, '40% выученного закрыли главу');

// 3. Знающий главу закрывает её за один проход: всё встречено впервые, 95% верно.
f = {}; keysOf(1000, 1199).forEach((k, i, arr) => { f[k] = { level: 0, points: 1, nextReview: 0, f: i < Math.ceil(arr.length * 0.95) ? 1 : 0 }; });
learnAll(f, 862, 999, 0.6);
p = LP.plan({ fs: f, from: 862, to: 2026 });
assert.ok(p.chapters[1].closed && p.chapters[1].knewIt, 'глава, решённая верно с первого раза, не закрылась');
assert.strictEqual(p.cur.ch, 2);
// …а 80% с первого раза — ещё не «знает»: учим как обычно.
f = {}; keysOf(1000, 1199).forEach((k, i, arr) => { f[k] = { level: 0, points: 1, nextReview: 0, f: i < Math.floor(arr.length * 0.8) ? 1 : 0 }; });
assert.ok(!LP.plan({ fs: f, from: 862, to: 2026 }).chapters[1].closed, '80% с первого раза закрыли главу');

// 4. Класс «дошёл до 1881»: всё до границы закрыто → «забегаем вперёд», а не стоп.
f = {}; learnAll(f, 862, 1881, 0.6);
p = LP.plan({ fs: f, from: 862, to: 1881 });
assert.strictEqual(p.cur.zone, 'after', 'после закрытия рамок класса урок не пошёл дальше');
assert.strictEqual(p.cur.ch, 13);
assert.strictEqual(p.inRangeClosed, p.inRangeTotal);
// Пока есть дыры в начале — урок в них, хоть класс и ушёл далеко.
f = {}; learnAll(f, 1000, 1881, 0.6);
assert.strictEqual(LP.plan({ fs: f, from: 862, to: 1881 }).cur.ch, 0, 'дыра в первой главе пропущена');

// 5. Граница класса посреди главы (1485): глава режется — часть до границы в рамках.
p = LP.plan({ fs: {}, from: 862, to: 1485 });
const cut = LP.plan({ fs: (() => { const x = {}; learnAll(x, 862, 1485, 0.6); return x; })(), from: 862, to: 1485 });
assert.strictEqual(cut.cur.ch, 3, 'остаток главы после границы не стал следующим');
assert.strictEqual(cut.cur.from, 1486); assert.strictEqual(cut.cur.zone, 'after');

// 6. Свой период ученика (XVIII век): начинаем с него, потом вперёд, начало — в самом конце.
p = LP.plan({ fs: {}, from: 1700, to: 1799 });
assert.strictEqual(p.cur.ch, 7); assert.strictEqual(p.cur.zone, 'in');
f = {}; learnAll(f, 1700, 2026, 0.6);
p = LP.plan({ fs: f, from: 1700, to: 1799 });
assert.strictEqual(p.cur.zone, 'before', 'после XVIII–XXI вв. урок не вернулся к началу истории');
assert.strictEqual(p.cur.ch, 0);

// 7. Давний ученик «вразброс» (как топ-ученики: ~60% встречено, ~30% выучено везде) —
//    урок начинает с первой главы с дырами, а не с нуля и не с середины.
f = {};
[...idx.all.keys()].forEach((k, i) => { if (i % 10 < 6) f[k] = { level: i % 10 < 3 ? 1 : 0, points: 1, nextReview: 0 }; });
p = LP.plan({ fs: f, from: 862, to: 2026 });
assert.strictEqual(p.cur.ch, 0); assert.ok(p.cur.seen > 0 && p.cur.learned > 0);

// 8. Глава, выбранная в «Пути», главнее порядка (одно занятие).
p = LP.plan({ fs: {}, from: 862, to: 2026, pin: 12 });
assert.strictEqual(p.cur.ch, 12); assert.strictEqual(p.cur.zone, 'pin');

// 9. Путь монотонен: выучивание фактов никогда не отбрасывает урок назад.
f = {}; let prev = -1;
for (const [k] of idx.all) {
  f[k] = { level: 1, points: 3, nextReview: Date.now() + 864e5 };
  if (Object.keys(f).length % 97 === 0) { const c = LP.plan({ fs: f, from: 862, to: 2026 }).cur; const at = c ? c.ch : 99; assert.ok(at >= prev, 'урок откатился назад'); prev = at; }
}
assert.strictEqual(LP.plan({ fs: f, from: 862, to: 2026 }).cur, null, 'всё выучено, а путь не пройден');

// 10. В каждой главе по каждому заданию окно даёт ≥8 фактов (таблица соберётся).
for (const c of CH) for (const t of ['task1', 'task3', 'task4', 'task5', 'task7']) {
  const w = LP.taskWindow({ from: c.from, to: c.to }, t, 862);
  let n = 0; idx.byTask[t].forEach(y => { if (y >= w.from && y <= w.to) n++; });
  assert.ok(n >= LP.RULES.MIN_POOL, `${c.name} / ${t}: в окне ${w.from}–${w.to} только ${n}`);
  assert.ok(w.from <= c.from && w.to >= c.to, 'окно не накрывает главу');
}
// Окно не уходит ниже рамок ученика, если хватает глав вперёд.
const w8 = LP.taskWindow({ from: 1700, to: 1725 }, 'task7', 1700);
assert.ok(w8.from >= 1700, 'окно ушло ниже своего периода ученика: ' + w8.from);

// 11. Долг для частоты повтора: к повтору + ошибки в окне.
f = {}; keysOf(862, 999).slice(0, 5).forEach(k => { f[k] = { level: 2, nextReview: 1 }; });
const mist = [{ task: 'task4', fact: ctx.bigData.find(x => ctx.getYearFromFact(x) === 1380) }];
assert.strictEqual(LP.backlog(f, 862, 1399, mist, Date.now()), 6);
assert.strictEqual(LP.backlog(f, 1400, 2026, mist, Date.now()), 0);

// 12. «Свои» задания главы: в «Руси IX–X» культуры (задание 7) один факт — глава его не
//     требует, таблицы по нему не идут (иначе — памятники XI–XII вв. под вывеской главы).
assert.ok(!LP.nativeTypes(862, 999).has('task7'), 'культура стала «своей» для Руси IX–X');
assert.ok(LP.nativeTypes(862, 999).has('task4'), 'задание 4 выпало из Руси IX–X');
// 13. Готовность главы: 0 у нового, 100 у закрытой, не убывает по мере учёбы.
assert.strictEqual(LP.plan({ fs: {}, from: 862, to: 2026 }).cur.progress, 0);
f = {}; learnAll(f, 862, 999, 0.6);
assert.strictEqual(LP.plan({ fs: f, from: 862, to: 2026 }).chapters[0].progress, 100);
{
  const g = {}; let last = -1;
  keysOf(1000, 1199).forEach((k, i) => {
    g[k] = { level: i % 2 ? 1 : 0, points: 1, nextReview: 0 };
    const pr = LP.windowStats(g, 1000, 1199).progress;
    assert.ok(pr >= last, 'готовность главы убыла'); last = pr;
  });
}
// 14. Невиданное главы считается отдельно — по нему урок ведёт первым.
assert.ok(LP.unlearnedByTask({}, 862, 999).unseen > 0 && LP.unlearnedByTask({}, 862, 999).unseenBy.task7 === 0, 'невиданное считается по чужим заданиям');

// ── Обвязка ──
const ui = read('ui.js'), st = read('state.js'), app = read('app.js');
assert.match(ui, /const forced = window\.state && window\.state\._forcedWin;/, 'applyTrainerPeriod перетирает окно урока');
assert.match(ui, /window\.state\._forcedWin = a\.period/, '_startLessonRun не передаёт окно урока');
assert.match(ui, /chapterMoved/, 'смена главы посреди занятия не отслеживается');
assert.match(st, /function _lessonReviewPool\(lesson, limit, now\)/, 'нет повтора из пройденного');
assert.match(st, /lesson\.every \|\| 3/, 'частота повтора урока не учитывается');
assert.match(st, /f: \(isCorrect && isSure\) \? 1 : 0/, 'SRS не пишет «с первого раза»');
assert.match(app, /window\.state\._pinChapter = null;/, 'выбранная глава переживает выход в меню');
assert.match(app, /window\.state\._lesson = null;[^\n]*\n[^\n]*_pinChapter/, 'урок переживает выход в меню');
const table = read('table.js');
assert.match(table, /const retick = \(\) => \{ window\.state\._normalTableTick = tick0; \};/, 'перегенерация таблицы сбивает чередование повтора');
assert.match(table, /st\._blendTable && st\._lesson && st\._lesson\.cumTo\) return \{ from: st\._lesson\.cumFrom, to: st\._lesson\.cumTo \}/, 'обманки таблицы повтора берутся из окна главы');
assert.match(ui, /window\.LessonPlan\.setProbe\(_lessonTableProbe\)/, 'проба сборки таблиц не подключена');
// Проба сборки в lesson-plan.js: отказ пробы расширяет окно, ошибка пробы — не ломает.
LP.setProbe((t, a) => !(t === 'task5' && a >= 1900));
const w5 = LP.taskWindow({ from: 1917, to: 1921 }, 'task5', 862);
assert.ok(w5.from < 1900, 'отказ пробы не расширил окно: ' + w5.from);
LP.setProbe(() => { throw new Error('x'); });
assert.ok(LP.taskWindow({ from: 1700, to: 1725 }, 'task4', 862).from === 1700, 'сломанная проба ломает окно');
LP.setProbe(null);
assert.match(app, /window\.state\._lesson = pendingLesson;/, 'первая таблица перезапуска урока строится без урока');
assert.match(ui, /window\.state\._pendingLesson = lesson;/, 'урок не передаётся до первой таблицы');
assert.match(st, /if \(lessonNow && lessonNow\.segTo && window\.state\._lessonPoolRelax\) return pool;/, 'запасные попытки урока не берут всё окно');
assert.match(table, /const fullTries = window\.state\._lesson \? 30 : 15;/, 'у урока нет запаса полных попыток');
assert.match(table, /putBack\(old, from\)/, 'перенос в занятую ячейку снова выкидывает ответ в варианты');
assert.match(ui, /function _celebrateNewChapters\(plan, onGo\)/, 'нет праздника «Глава пройдена»');
assert.match(read('cloud-sync.js'), /'lesson_closed_seen'/, 'отпразднованные главы переезжают к другому аккаунту');
assert.match(ui, /Норма дня ✓/, 'на кнопке не видно нормы дня');
assert.match(table, /const steps = \[\s*\[Math\.min\(a0, lesson\.cumFrom\)/, 'урок снова уходит из глав сразу во «всю историю»');
assert.ok(table.indexOf('const steps = [') < table.indexOf('validateTable({ allowShort: true })'), 'короткая таблица раньше расширения лет урока');
assert.match(read('state.js'), /window\.factStreakNewer = function/, 'слияние фактов снова «по лучшему уровню»');
assert.match(read('cloud-sync.js'), /window\.factStreakNewer\(v, cur\)/, 'облачное слияние не по свежести');
assert.match(read('state.js'), /window\.mistakeResolved = function/, 'ошибка снова закрывается только выучиванием');
assert.match(read('cloud-sync.js'), /!window\.mistakeResolved\(m, st\.factStreaks\)/, 'облачное слияние воскрешает исправленные ошибки');
assert.match(read('index.html'), /<script src="lesson-plan\.js\?v=[^"]+" defer><\/script>\s*<script src="ui\.js/, 'lesson-plan.js не подключён перед ui.js');
assert.match(read('service-worker.js'), /\.\/lesson-plan\.js\?v=/, 'lesson-plan.js не в прекэше SW');

// Владелец 01.10: «в 1-й главе нет фактов по 7-му — пусть 7-е начинается со 2-й
// главы, без костылей» и «7-го должно быть меньше». Редкие факты задания уходят в
// следующую главу, где оно есть; окно таблиц захватывает их настоящие годы.
{
  const dest = ctx.task7Data.find(f => /Десятинная/.test(f.culture));
  assert.ok(dest, 'нет Десятинной церкви в задании 7');
  assert.ok(!LP.nativeTypes(CH[0].from, CH[0].to).has('task7'), 'в «Руси IX–X» снова есть задание 7');
  assert.ok(LP.nativeTypes(CH[1].from, CH[1].to).has('task7'), 'в «Руси XI–XII» нет задания 7');
  assert.strictEqual(LP.lessonYear(dest, 'task7'), CH[1].from, 'Десятинная церковь не перенесена в главу 2');
  assert.strictEqual(LP.unlearnedByTask({}, CH[0].from, CH[0].to).by.task7, 0, 'урок главы 1 предлагает задание 7');
  const w7 = LP.taskWindow({ from: CH[1].from, to: CH[1].to }, 'task7', 862);
  assert.ok(w7.from <= 996, 'окно таблиц главы 2 не захватывает Десятинную церковь: ' + w7.from);
  // Ни у одного задания в главе не остаётся 1–3 «сиротских» фактов.
  ['task1', 'task3', 'task4', 'task5', 'task7'].forEach(t => CH.forEach(c => {
    let n = 0; idx.byTask[t].forEach(y => { if (y >= c.from && y <= c.to) n++; });
    assert.ok(n === 0 || n >= 4, t + ' в главе «' + c.name + '»: ' + n + ' факт(а) — меньше таблицы');
  }));
  assert.ok(ui.includes("const TASK_WEIGHT = { task7: 2 };"), 'задание 7 снова выпадает наравне с остальными');
  assert.ok(ui.includes("t === 'task7' ? LINES_PER_TASK / 2"), 'подход к заданию 7 снова 16 строк');
}

console.log('lesson-plan: OK — 23 главы, ' + idx.all.size + ' фактов, сценарии: новичок, закрытие, «знаю с первого раза», граница класса, свой период, вразброс, выбор главы, монотонность, окна таблиц, долг');
