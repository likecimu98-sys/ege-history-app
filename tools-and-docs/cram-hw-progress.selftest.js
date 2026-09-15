'use strict';
// Этап ДЗ «Зубрёжка дат» считается ЖИВЬЁМ по ключам cram:* в factStreaks, а события
// зубрёжки грузятся асинхронно. Пока кэш холодный, сопоставить ключи с годами нечем.
//
// 🔴 Жалобы 09.08.2026:
//   «Иногда галочка слетает с дат. Появится и снова пропадёт. Хотя всё сделано давно»
//   «Перезаходишь в бота — и галочка с дат пропадает, хотя они сделаны»
// Причина: cramLearnedCount возвращал НОЛЬ там, где ответить было нечем, и «не знаю»
// становилось неотличимо от «не выучено ни одного». У сданного задания это снимало
// галочку в интерфейсе, а у АКТИВНОГО ноль ещё и записывался в it.done (refreshHwState)
// и уезжал учителю: ученик видит «сделано», учитель — «не сдано».
//
// Инвариант: неизвестность обязана оставаться неизвестностью и НЕ понижать прогресс.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── Вырезаем настоящие функции из исходников ────────────────────────────────
function extract(source, header, name) {
  const from = source.indexOf(header);
  assert.ok(from > 0, `${name} не найдена`);
  const end = source.indexOf('\n};', from) >= 0 && source.indexOf('\n};', from) < source.indexOf('\n}', from) + 1
    ? source.indexOf('\n};', from) + 3
    : source.indexOf('\n}', from) + 2;
  return source.slice(from, end);
}

const uiSrc = read('ui.js');
const cramSrc = extract(uiSrc, 'window.cramLearnedCount = function(', 'cramLearnedCount');

function makeCram({ rangeIds, streaks }) {
  const box = {
    window: {
      state: { stats: { factStreaks: streaks } },
      cramEventIdsInRange: () => rangeIds,
      isFactLearned: v => !!(v && ((v.level || 0) > 0 || (v.points || 0) >= 3 || (v.streak || 0) >= 3)),
    },
  };
  vm.createContext(box);
  vm.runInContext(cramSrc, box);
  return box.window.cramLearnedCount;
}

const learned = { level: 1, points: 5, streak: 3 };
const streaks = { 'cram:e1': learned, 'cram:e2': learned, 'cram:e3': learned };

// ── 1. Данные загружены — считаем честно ────────────────────────────────────
{
  const count = makeCram({ rangeIds: new Set(['e1', 'e2', 'e3']), streaks });
  assert.equal(count(862, 1054), 3, 'при загруженных данных счёт обязан быть точным');
}

// ── 2. Данные НЕ загружены — «не знаю», а не ноль ───────────────────────────
{
  const count = makeCram({ rangeIds: null, streaks });
  const got = count(862, 1054);
  assert.notEqual(got, 0,
    'ноль при незагруженных данных — это и есть слетающая галочка');
  assert.equal(got, null, 'неизвестность обязана быть явной (null)');
}

// ── 3. Запрос по колоде (без диапазона) работает как раньше ─────────────────
{
  const count = makeCram({ rangeIds: null, streaks: { 'cram:deckA:x': learned, 'cram:deckB:y': learned } });
  assert.equal(count('deckA'), 1, 'счёт по префиксу колоды не должен зависеть от диапазона');
}

// ── 4. hwItemProgress не понижает прогресс, пока счёт неизвестен ────
//
// Вместе с ним тянем hwItemGoal/hwItemAvailable: с 15.09 прогресс зубрёжки
// упирается в УРЕЗАННУЮ цель, и врозь эти три функции больше не живут.
const stateSrc = strip(read('state.js'));
function pullFn(name) {
  const from = stateSrc.indexOf(`function ${name}(`);
  assert.ok(from > 0, `${name} не найдена`);
  return stateSrc.slice(from, stateSrc.indexOf('\n}', from) + 2);
}
const hwFns = [pullFn('hwItemProgress'), pullFn('hwItemAvailable'), pullFn('hwItemGoal')].join('\n');

function runHw(item, live, rangeIds) {
  const box = {
    window: {
      cramLearnedCount: () => live,
      cramEventIdsInRange: () => rangeIds,
      state: { stats: {} },
    },
    learnedCountInPeriod: () => ({ learned: 0, total: 0 }),
  };
  vm.createContext(box);
  vm.runInContext(`${hwFns}; this.p = hwItemProgress; this.g = hwItemGoal;`, box);
  return { progress: box.p(item), goal: box.g(item) };
}
{
  const item = { task: 'cram', goal: 6, progress: 6, yearStart: 862, yearEnd: 1054 };
  const ids6 = new Set(['1', '2', '3', '4', '5', '6']);

  assert.equal(runHw(item, null, ids6).progress, 6,
    'при неизвестном счёте обязано держаться последнее известное значение');
  assert.equal(runHw(item, 6, ids6).progress, 6, 'при известном счёте берём его');
  assert.equal(runHw({ ...item, progress: 0 }, 4, ids6).progress, 4,
    'живой счёт важнее пустого кэша');
}

// ── 4a. Цель зубрёжки урезается по числу дат в диапазоне ────
//
// 🔴 Жалоба 15.09.2026: «не может доделать ДЗ по зубрёжке, последний вариант
// не засчитывает». Учитель выдал «12 дат за 1801–1825», а в колоде их 11:
// составитель и тренажёр по-разному читали год у события 93 (Государственный
// Совет — «год роспуска»). Двенадцатой даты не существует в природе, и этап
// не закрывался никогда. У всех остальных этапов такой потолок есть с 12.08.
{
  const eleven = new Set(Array.from({ length: 11 }, (_, i) => String(i + 1)));
  const item = { task: 'cram', goal: 12, progress: 11, yearStart: 1801, yearEnd: 1825 };

  const got = runHw(item, 11, eleven);
  assert.equal(got.goal, 11, 'цель зубрёжки не урезана по числу доступных дат — этап не закрыть');
  assert.equal(got.progress, 11, 'прогресс обязан дотягиваться до урезанной цели');

  // Кэш дат ещё не загружен (null) — «не знаю», цель не трогаем.
  assert.equal(runHw(item, 11, null).goal, 12,
    'при незагруженных датах цель урезалась вслепую — так можно закрыть этап, которого не делали');

  // Без рамок состав колод живёт внутри cram.html: считать нечем, не режем.
  assert.equal(runHw({ task: 'cram', goal: 30, progress: 0 }, 0, null).goal, 30,
    'этап без диапазона идёт по всем колодам — урезать его цель неоткуда');
}

// ── 5. refreshHwState запоминает счёт и НЕ понижает его ─────────────────────
{
  const s = strip(read('state.js'));
  assert.match(s, /it\.progress = Math\.max\(Number\(it\.progress\) \|\| 0, live\)/,
    'живой счёт зубрёжки не запоминается — у сданного этапа галочка не вернётся');
  assert.match(s, /if \(typeof live === 'number'\)/,
    'кэш обновляется даже при неизвестном счёте — так он обнулится');
  // Кэширование обязано идти ДО раннего выхода для несданных заданий, иначе
  // у сданного этапа (ровно случай со скриншота) progress так и останется нулём.
  const cacheAt = s.indexOf("if (!it || it.task !== 'cram') return;");
  const guardAt = s.indexOf("if (a.status !== 'active') return;", s.indexOf('s.assignments.forEach(a => {'));
  assert.ok(cacheAt > 0 && guardAt > cacheAt,
    'кэш живого счёта стоит после отсева сданных заданий — их галочки не восстановятся');
}

// ── 6. Кабинет учителя не показывает ноль вместо «не знаю» ──────────────────
{
  const c = strip(read('cloud-sync.js'));
  assert.match(c, /if \(hasRange && !rangeIds\) return null;/,
    'в кабинете учителя незагруженные данные снова превращаются в ноль');
  assert.match(c, /const cramProgress = \(it\) => \{[\s\S]{0,220}?Number\(it\.progress\) \|\| 0/,
    'кабинет не опирается на сохранённый прогресс, когда счёт неизвестен');
  assert.match(c, /it\.task === 'cram'\s*\n?\s*\? Math\.max\(0, \(it\.goal \|\| 0\) - cramProgress\(it\)\)/,
    'остаток по зубрёжке считается мимо cramProgress');
}

console.log('cram-hw-progress.selftest: ok');
