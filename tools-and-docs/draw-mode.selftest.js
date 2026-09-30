// Страж рисования поверх экрана (draw-mode.js): модуль подключён, в прекэше,
// грузится только на компьютере и не отнимает у тренажёра его клавиши.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const src = read('draw-mode.js');
new vm.Script(src, { filename: 'draw-mode.js' });   // синтаксис

const ui = read('ui.js');
assert.match(ui, /'draw-mode\.js' \+ v/, 'ui.js не грузит draw-mode.js');
assert.match(ui, /'draw-mode\.css' \+ v/, 'ui.js не грузит draw-mode.css');
assert.match(ui, /matchMedia\('\(pointer: fine\)'\)[\s\S]{0,80}innerWidth >= 900/, 'рисование должно грузиться только на компьютере');
const sw = read('service-worker.js');
assert.match(sw, /draw-mode\.js\?v=/, 'draw-mode.js не в прекэше');
assert.match(sw, /draw-mode\.css\?v=/, 'draw-mode.css не в прекэше');

// Цифры 1–9 ставят ответ в тренажёре — рисование не должно их перехватывать без Shift.
assert.match(src, /e\.shiftKey && \/\^\[1-6\]\$\/\.test\(code\)/, 'цвета — только Shift+цифра');
assert.doesNotMatch(src, /if \(\/\^\[1-6\]\$\/\.test\(code\)\) \{/, 'голые цифры не должны менять цвет');
// Esc при рисовании выключает рисование и не уводит в лобби.
assert.match(src, /k === 'Escape'\) \{ eat\(\); toggle\(false\)/);
assert.match(src, /function eat\(\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}/);

// Каждая функция объявлена ОДИН раз: 30.09.2026 правка скриптом задвоила ~300
// строк модуля — работало (поздние объявления перекрывают ранние), но это мина.
for (const fn of ['build', 'tick', 'paint', 'applyStage', 'toggle', 'key', 'makeAnchor']) {
  const n = src.split('function ' + fn + '(').length - 1;
  assert.strictEqual(n, 1, 'function ' + fn + ' объявлена ' + n + ' раз');
}
console.log('draw-mode.selftest: ok');
