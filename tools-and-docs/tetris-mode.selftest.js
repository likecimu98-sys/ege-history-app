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
  assert.ok(deck && deck.init.length === 3 && deck.steps.length >= 30, 'колода не собралась или не на три стакана');
  eras.add(deck.era);
  const cups = deck.init.map(c => ({ ...c }));
  const check = where => {
    const ys = cups.map(c => c.y);
    assert.equal(new Set(ys).size, cups.length, `два стакана с одним годом (${where}): ${ys.join(', ')}`);
    for (const c of cups) {
      assert.ok(single.has(c.t), 'событие не из order-data или длится больше года: ' + c.t);
      assert.equal(single.get(c.t), c.y, 'год стакана не совпадает с данными: ' + c.t);
      assert.ok(c.t.length <= 60, 'текст не влезет в стакан: ' + c.t);
    }
  };
  check('начало');
  for (const [k, st] of deck.steps.entries()) {
    assert.ok(st.t >= 0 && st.t < cups.length, 'целевой стакан вне колонок');
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

// Три стакана, а не четыре; число колонок игры — из колоды, а не зашито числом.
const tsrc = read('tetris-mode.js');
assert.match(tsrc, /const COLS = 3;/, 'стаканов снова не три');
assert.doesNotMatch(tsrc, /Math\.random\(\) \* 4\b|\/ 4\b|Math\.min\(3, col\)|\[0, 1, 2, 3\]/, 'где-то снова зашиты четыре колонки');

// ── Атака: видимая и отбиваемая ──
const tetris = read('tetris-mode.js');
assert.match(tetris, /function _threat\(n\)/, 'атака снова падает мгновенно, без «тучи» с отсчётом');
assert.match(tetris, /if \(_g\.incoming\.length\) \{[\s\S]{0,120}_g\.incoming\.shift\(\);[\s\S]{0,40}_g\.blkSent\+\+/, 'попадание больше не отбивает летящий кирпич');
assert.match(tetris, /const top = Math\.max\(\.\.\._g\.stacks\.map\(s => s\.length\)\)/, 'кирпич соперника снова падает не в самый высокий стакан');
assert.match(tetris, /_g\.charge = 0;\s*_g\.stacks\[bl\.col\]\.push/, 'промах больше не обнуляет шкалу заряда');

// Кирпичи копятся в запас и летят залпом по кнопке, а не сами.
assert.match(tetris, /if \(_g\.ammo < MAX_AMMO\) \{\s*_g\.ammo\+\+;/, 'полная шкала снова сама отправляет кирпич, а не кладёт в запас');
assert.match(tetris, /function _fire\(\) \{[\s\S]{0,200}_g\.ammo = 0;\s*_g\.atkSent \+= n;/, 'кнопка ⚔️ больше не бросает весь запас разом');
assert.match(tetris, /const dur = THREAT_MS \+ \(n - 1\) \* THREAT_EXTRA_MS;/, '«туча» залпа не удлиняется — отбить 4 кирпича за 3 секунды нельзя');

// Обучение: карточка ВЫШЕ подсвеченного элемента. 23.09 карточка жила внутри
// затемнения (z 5), подсвеченное поле (z 6) ложилось на неё — «Играть!» не
// нажималась. Программный .click() это не ловит, поэтому проверяем слои в CSS.
assert.match(tetris, /\.dt-tut-dim\{[^}]*z-index:5/, 'затемнение обучения больше не отдельный слой');
assert.match(tetris, /\.dt-tut-card\{[^}]*z-index:7/, 'карточка обучения ниже подсветки — кнопку не нажать');
assert.match(tetris, /\.dt-spot\{[^}]*z-index:6/, 'подсветка обучения не между затемнением и карточкой');
assert.doesNotMatch(tetris, /#dt-tut\{[^}]*z-index/, '#dt-tut снова создаёт свой слой — карточка окажется под подсветкой');
assert.match(read('duel-react.js'), /ui\.classList\.add\('dr-open', 'dr-intro', 'dr-hint'\)/, 'реакции больше не раскрываются в начале дуэли — их не находят');

// ── Реакции: едут вместе с последним счётом режима ──
const cloud = read('cloud-sync.js');
assert.match(cloud, /window\.state\.duel\._last = \{ score, combo, extra \}/, 'реакция уйдёт без полей режима и обнулит их у соперника');
assert.match(cloud, /\.\.\.\(emo \? \{ emo \} : \{\}\)/, 'реакция не едет в объекте игрока');
assert.match(cloud, /window\.onDuelReaction\(opp\.emo/, 'слушатель матча не передаёт реакции соперника');
assert.match(read('index.html'), /<script src="duel-react\.js\?v=/, 'duel-react.js не подключён');
assert.match(read('service-worker.js'), /duel-react\.js\?v=/, 'duel-react.js не в прекэше');

console.log('tetris-mode.selftest: ok');
