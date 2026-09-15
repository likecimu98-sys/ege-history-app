'use strict';
// Тренажёр дат и составитель ДЗ обязаны одинаково понимать, какого года
// событие.
//
// 🔴 Жалоба 15.09.2026: «не может доделать ДЗ по зубрёжке, последний вариант
// не засчитывает».
//
// Правил было два. cram.html (mainYearTarget) читает «что знать»: если там
// сказано «год роспуска / окончания / завершения», берётся ПОСЛЕДНИЙ год из
// текста, иначе первый. ui.js брал первый всегда.
//
// Расходились они на событии 93 — Государственный Совет: «…в 1810-1906 годы…
// В 1906-1917 годах», знать надо «год роспуска». Колода кладёт его в 1917,
// составитель клал в 1810. Для домашки «Александр I, 1801–1825» это значило:
// подсказка насчитала 12 дат, учитель поставил цель 12, а в колоде их 11.
// Двенадцатой не существует — этап не закрывался никогда.
//
// Правда за колодой: её ученик и решает. Этот тест держит обе реализации
// вместе — они лежат в разных файлах и разъехаться могут молча.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const cram = read('cram.html');
const ui = read('ui.js');

// Функция целиком: от заголовка до закрывающей скобки в первой колонке.
function fn(src, name, where) {
  const from = src.indexOf('function ' + name + '(');
  assert.ok(from > 0, name + ' не найдена в ' + where);
  const end = src.indexOf('\n}', from);
  assert.ok(end > from, 'не найден конец ' + name + ' в ' + where);
  return src.slice(from, end + 2);
}

// ── Даты ────────────────────────────────────────────────────────────────────
const m = cram.match(/<script[^>]*id="app-data"[^>]*>([\s\S]*?)<\/script>/);
assert.ok(m, 'app-data в cram.html не найден');
const events = JSON.parse(m[1]).events.filter(e => !e.isVov);
assert.ok(events.length > 100, 'событий подозрительно мало: ' + events.length);

// ── Правило колоды ──────────────────────────────────────────────────────────
const deckBox = {};
vm.createContext(deckBox);
vm.runInContext(
  [fn(cram, 'norm', 'cram.html'),
   fn(cram, 'yearList', 'cram.html'),
   fn(cram, 'yearsOnly', 'cram.html'),
   fn(cram, 'mainYearTarget', 'cram.html'),
   fn(cram, 'eventYear', 'cram.html'),
   'this.year = eventYear;'].join('\n'),
  deckBox);

// ── Правило составителя ДЗ ──────────────────────────────────────────────────
const uiBox = {};
vm.createContext(uiBox);
vm.runInContext(
  [fn(ui, '_cramYearList', 'ui.js'),
   fn(ui, '_cramEventYear', 'ui.js'),
   'this.year = _cramEventYear;'].join('\n'),
  uiBox);

// ── Сверка по каждому событию ───────────────────────────────────────────────
const bad = [];
for (const e of events) {
  const deck = deckBox.year(e);
  const hw = uiBox.year(e);
  if (deck !== hw) bad.push(`id ${e.id}: колода ${deck}, составитель ${hw} · ${String(e.date).slice(0, 40)}`);
}
assert.deepStrictEqual(bad, [],
  'Составитель ДЗ и тренажёр считают год по-разному — ученик получит цель, которой нет в колоде:\n  ' + bad.join('\n  '));

// Событие 93 — то самое, на котором они разошлись. Держим его отдельно:
// если запись когда-нибудь выпадет из базы, тест обязан сказать об этом, а не
// молча позеленеть на выборке без единого спорного случая.
const gs = events.find(e => e.id === 93);
if (gs) {
  assert.strictEqual(deckBox.year(gs), 1917,
    'Государственный Совет вернулся к году учреждения — «знать год роспуска» перестало работать');
  assert.strictEqual(uiBox.year(gs), 1917, 'составитель ДЗ снова расходится с колодой на событии 93');
}

// ── Потолок цели на месте ───────────────────────────────────────────────────
const state = read('state.js');
assert.match(state, /if \(item.task === 'cram'\) \{/,
  'hwItemAvailable снова не считает зубрёжку — невыполнимая цель вернётся');
assert.match(state, /window\.cramEventIdsInRange\s*\?\s*window\.cramEventIdsInRange\(item\.yearStart, item\.yearEnd\)/,
  'доступные даты считаются не перечнем колоды');

console.log('cram-year-rule.selftest: ok (' + events.length + ' событий)');
