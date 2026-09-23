'use strict';
// Страж режима «Кто раньше» (order-mode.js + order-data.js).
//
// Главное правило режима: у события есть длительность, и то, что случилось В ХОДЕ
// длительного события, с ним не сравнивается («Северная война» и «Полтавская
// битва» — вопрос без ответа). Нарушение не видно глазами: колода просто иногда
// спрашивает невозможное, а засчитывает «правильным» случайное. Поэтому проверяем
// сотни колод, а не одну.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. order-data.js собран из актуальной таблицы ───────────────────────────
// Правка order-events.txt без пересборки не доезжает до людей молча.
const tmp = path.join(os.tmpdir(), `order-data-${process.pid}.js`);
execFileSync(process.execPath, [path.join(__dirname, 'build-order-data.js')], { env: { ...process.env, ORDER_DATA_OUT: tmp }, stdio: 'pipe' });
const fresh = fs.readFileSync(tmp, 'utf8'); fs.unlinkSync(tmp);
assert.equal(read('order-data.js'), fresh,
  'order-data.js устарел: после правки order-events.txt запусти node tools-and-docs/build-order-data.js');

// ── 2. Данные ────────────────────────────────────────────────────────────────
const ctx = { console, Date, Math, document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: () => null } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('order-data.js'), ctx);
vm.runInContext(read('order-mode.js'), ctx);
const data = ctx.orderEventsData;
assert.ok(Array.isArray(data) && data.length >= 400, `событий подозрительно мало: ${data && data.length}`);
const YEAR_IN_TEXT = /(^|[^\d№])(8\d\d|9\d\d|1\d\d\d|20\d\d)(?!\d)/;
for (const r of data) {
  assert.equal(r.length, 6, 'запись не из шести полей: ' + JSON.stringify(r));
  assert.ok(r[1] <= r[2], 'конец раньше начала: ' + r[0]);
  assert.ok(!YEAR_IN_TEXT.test(r[0]), 'год в тексте выдаёт ответ: ' + r[0]);
}
// Контрольные длительности из таблицы владельца — ловят «интервал сжался в год».
const find = t => data.find(r => r[0] === t);
for (const [t, s, e] of [['Северная война', 17000101, 17211231], ['Великая Отечественная война', 19410622, 19450509], ['Ливонская война', 15580101, 15831231]]) {
  const r = find(t);
  assert.ok(r, 'нет контрольного события: ' + t);
  assert.deepEqual([r[1], r[2]], [s, e], 'сбилась длительность: ' + t);
}

// ── 3. Колоды дуэли ──────────────────────────────────────────────────────────
const day = n => Date.UTC(Math.floor(n / 1e4), Math.floor(n / 100) % 100 - 1, n % 100) / 864e5;
const fineOf = new Map(data.map(r => [r[0], { sp: r[4], ep: r[5] }]));
let photo = 0;
for (let run = 0; run < 300; run++) {
  const deck = ctx.buildOrderDuelDeck();
  assert.ok(deck && deck.length >= 30, 'колода не собралась или короткая');
  const seen = new Set();
  for (const it of deck) {
    assert.equal(it.e.length, it.k === 't' ? 3 : 2, 'ход неверного размера');
    for (const ev of it.e) {
      assert.ok(!seen.has(ev.t), 'событие дважды в одной колоде: ' + ev.t);
      seen.add(ev.t);
      assert.ok(ev.l && ev.s && ev.e && ev.y, 'в колоде нет подписи или границ: ' + ev.t);
    }
    const s = it.e.slice().sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < s.length; i++) {
      const a = s[i], b = s[i + 1];
      assert.ok(a.e < b.s, `пересекаются — «кто раньше» без ответа: «${a.t}» (${a.l}) и «${b.t}» (${b.l})`);
      const fa = fineOf.get(a.t), fb = fineOf.get(b.t);
      if (fa && fb && fa.ep > 0 && fb.sp > 0) {
        assert.ok(day(b.s) - day(a.e) >= 45, `точные даты ближе 45 дней: «${a.t}» и «${b.t}»`);
      }
    }
    if (it.k === 'p' && (day(s[1].s) - day(s[0].e)) / 365.25 < 5) photo++;
  }
}
assert.ok(photo / 300 >= 8, `фотофиниш почти не встречается: ${photo / 300} на колоду`);

// ── 4. Режим подключён всюду, где должен ─────────────────────────────────────
const index = read('index.html');
assert.match(index, /data-action="openOrderMode"/, 'нет плитки тренировки в лобби');
assert.match(index, /<script src="order-data\.js\?v=/, 'order-data.js не подключён');
assert.match(read('app.js'), /openOrderMode:\s*\(\) => window\.openOrderMode/, 'нет обработчика плитки');
assert.match(read('service-worker.js'), /order-data\.js\?v=/, 'order-data.js не в прекэше');
assert.match(read('server/api/src/state-merge.js'), /'orderBest', 'orderGames'/, 'сервер не сливает рекорд «Кто раньше»');

console.log('order-mode.selftest: ok');
