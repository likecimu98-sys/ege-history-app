'use strict';
// Ученик обязан иметь возможность выбрать ЛЮБОЙ этап домашки, а не только первый
// незакрытый.
//
// 🔴 Зачем. Кнопка «Начать» вела строго на первый незакрытый этап (startAssignment).
// Если он по какой-то причине не закрывается, ученик заперт целиком: остальные этапы,
// которые он мог бы сделать, недоступны. Жалобы 12.08.2026 — Андрей («24 из 25, второй
// этап не нажимается») и «аська» (9 из 10). Причина застревания ещё ищется, но
// заложником она делать не должна.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.js'), 'utf8');
const code = ui.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── 1. Строка этапа умеет запускать именно СВОЙ этап ────────────────────────
const from = code.indexOf('function _hwItemRow(');
assert.ok(from > 0, '_hwItemRow не найдена');
const row = code.slice(from, code.indexOf('\n}', code.indexOf('return `\n      <button', from)) + 2);

assert.match(code.slice(from, from + 200), /function _hwItemRow\(it, idx, kind, assignmentId\)/,
  '_hwItemRow не принимает id задания — запускать будет нечего');
assert.match(row, /window\.startHwItem\('\$\{assignmentId\}',\$\{idx\}\)/,
  'строка этапа не вызывает startHwItem со своим индексом');

// ── 2. Индекс и id реально подставляются при отрисовке ──────────────────────
assert.match(code, /_hwItemRow\(it, i, kind, a\.id\)/,
  'в строку этапа не передаётся id задания — кнопка не будет знать, что запускать');

// ── 3. Сданное задание не воскрешаем ────────────────────────────────────────
assert.match(row, /const clickable = !!assignmentId && kind !== 'done';/,
  'этапы сданного задания стали кликабельными — так можно воскресить закрытое ДЗ');
assert.match(row, /if \(!clickable\) \{/, 'нет ветки для некликабельной строки');

// ── 4. Это кнопка, а не div: фокус с клавиатуры и роль для скринридера ──────
assert.match(row, /<button type="button"/, 'этап обязан быть кнопкой, а не div с onclick');
assert.match(row, /aria-label="Открыть этап/, 'у кнопки нет внятного имени для скринридера');
assert.match(row, /_hwEsc\(m\.name\)/,
  'имя задания не экранируется — кавычка в названии разорвёт атрибут');

// ── 5. Запуск этапа закрывает вкладку ДЗ ────────────────────────────────────
const si = code.indexOf('window.startHwItem = function');
assert.ok(si > 0, 'startHwItem не найдена');
const body = code.slice(si, code.indexOf('\n};', si) + 3);
assert.match(body, /getElementById\('hw-tab-overlay'\)/,
  'startHwItem не закрывает вкладку ДЗ — список останется поверх тренажёра');
// Закрывать надо ДО запуска режима, иначе оверлей перекроет открывшийся тренажёр.
assert.ok(body.indexOf("hw-tab-overlay") < body.indexOf('window.state.activeHw'),
  'вкладка закрывается после установки активного этапа — порядок важен');

// ── 6. Экранирование действительно экранирует ───────────────────────────────
const esc = new Function(`${code.slice(code.indexOf('function _hwEsc('), code.indexOf('\n}', code.indexOf('function _hwEsc(')) + 2)}; return _hwEsc;`)();
assert.equal(esc('Задание "5"'), 'Задание &quot;5&quot;');
assert.equal(esc("О'кей & <b>"), 'О&#39;кей &amp; &lt;b&gt;');
assert.equal(esc(null), '');

console.log('hw-stage-picker.selftest: ok');
