'use strict';
// Страж «Датриса» (tetris-mode.js).
//
// Главный инвариант: падающий год подходит РОВНО к одному стакану. Два стакана с
// одним годом — ход без правильного ответа, и игрок получает кирпич ни за что;
// ноль стаканов — тоже. Колода длинная и строится случайно, поэтому проверяем
// сотни колод, проигрывая цепочку замен целиком.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ctx = { console, Math, Date, performance: { now: () => 0 }, requestAnimationFrame() {}, cancelAnimationFrame() {},
  document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null, addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('order-data.js'), ctx);
vm.runInContext(read('tetris-mode.js'), ctx);

const single = new Map();
for (const r of ctx.orderEventsData) if (Math.floor(r[1] / 1e4) === Math.floor(r[2] / 1e4)) single.set(r[0], Math.floor(r[1] / 1e4));
const eras = new Set();
for (let run = 0; run < 300; run++) {
  const deck = ctx.buildTetrisDuelDeck();
  assert.ok(deck && deck.init.length === 4 && deck.steps.length >= 30, 'колода не собралась');
  eras.add(deck.era);
  const cups = deck.init.map(c => ({ ...c }));
  const check = where => {
    const ys = cups.map(c => c.y);
    assert.equal(new Set(ys).size, 4, `два стакана с одним годом (${where}): ${ys.join(', ')}`);
    for (const c of cups) {
      assert.ok(single.has(c.t), 'событие не из order-data или длится больше года: ' + c.t);
      assert.equal(single.get(c.t), c.y, 'год стакана не совпадает с данными: ' + c.t);
      assert.ok(c.t.length <= 60, 'текст не влезет в стакан: ' + c.t);
    }
  };
  check('начало');
  for (const [k, st] of deck.steps.entries()) {
    assert.ok(st.t >= 0 && st.t <= 3, 'целевой стакан вне 0–3');
    const falling = cups[st.t].y;
    assert.equal(cups.filter(c => c.y === falling).length, 1, `год ${falling} подходит не к одному стакану (шаг ${k})`);
    cups[st.t] = { ...st.n };
    check('шаг ' + k);
  }
}
assert.ok(eras.size >= 3, 'дуэли почти всегда в одной эпохе: ' + [...eras].join(', '));

// Подключение — там, где его забывают.
assert.match(read('index.html'), /data-action="openTetrisMode"/, 'нет плитки «Датрис» в лобби');
assert.match(read('index.html'), /<script src="tetris-mode\.js\?v=/, 'tetris-mode.js не подключён');
assert.match(read('app.js'), /openTetrisMode:\s*\(\) => window\.openTetrisMode/, 'нет обработчика плитки');
assert.match(read('service-worker.js'), /tetris-mode\.js\?v=/, 'tetris-mode.js не в прекэше');
assert.match(read('cloud-sync.js'), /DUEL_MODES_PLAYABLE = \[[^\]]*'tetris'/, '«Датрис» не в списке играбельных режимов');
assert.match(read('modes.js'), /duelMode === 'tetris' && window\.openTetrisDuel/, 'дуэль не запускает «Датрис»');
assert.match(read('server/api/src/state-merge.js'), /'tetrisBest', 'tetrisGames'/, 'сервер не сливает рекорд «Датриса»');

console.log('tetris-mode.selftest: ok');
