// Страж «Тиндера правителей» (tsar-mode.js + tsar-data.js).
// Проверяет данные, сборку круга для каждого правителя и подключение режима:
// плитка, действие, прекэш, поле прогресса в обеих половинах слияния.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} },
  document: { currentScript: { src: 'http://x/tsar-mode.js?v=t' }, getElementById: () => null, createElement: () => ({}), head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} } };
ctx.window = ctx; ctx.state = { stats: {} }; vm.createContext(ctx);
vm.runInContext(read('tsar-data.js'), ctx);
vm.runInContext(read('tsar-mode.js'), ctx);
const R = ctx.TSAR_DATA, T = ctx.TsarMode;

// ── данные ──
assert.ok(R.length >= 30, 'правителей меньше 30: ' + R.length);
assert.strictEqual(new Set(R.map(r => r.id)).size, R.length, 'повтор id правителя');
const span = s => { const m = String(s).match(/^(\d{3,4}) - (\d{3,4})$/); return m ? [+m[1], +m[2]] : null; };
for (const r of R) {
  const c = span(r.correctYears);
  assert.ok(c && c[0] < c[1], r.name + ': годы правления не в виде «ГГГГ - ГГГГ»');
  assert.strictEqual(r.wrongYears.length, 3, r.name + ': неверных вариантов не 3');
  assert.ok(!r.wrongYears.includes(r.correctYears), r.name + ': верные годы среди неверных');
  assert.strictEqual(new Set(r.wrongYears).size, 3, r.name + ': повтор неверных вариантов');
  assert.ok(r.events.filter(e => e.isTrue).length >= 2, r.name + ': меньше двух верных событий');
  r.events.forEach(e => assert.ok(e.text && e.explanation, r.name + ': событие без текста или пояснения'));
}
// Правления по хронологии не пересекаются — чужое событие-ловушка не может оказаться верным.
const sorted = R.map(r => span(r.correctYears)).sort((a, b) => a[0] - b[0]);
for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][0] >= sorted[i - 1][1], 'правления пересекаются: ' + sorted[i - 1] + ' и ' + sorted[i]);

// ── «похожие» годы ──
for (const r of R) for (let k = 0; k < 20; k++) {
  const close = T.closeYears(r.correctYears);
  assert.strictEqual(close.length, 3, r.name + ': похожих вариантов не 3');
  assert.ok(!close.includes(r.correctYears), r.name + ': похожий вариант совпал с верным');
  close.forEach(x => { const s = span(x); assert.ok(s && s[0] < s[1], r.name + ': кривой похожий вариант ' + x); });
}

// ── сборка круга ──
const sharedOf = new Map(); T.shared.forEach(g => g.forEach(t => sharedOf.set(t, g)));
for (const r of R) for (let k = 0; k < 40; k++) {
  const round = T.buildRound(r.id, k % 2 ? { cnt: { [r.id]: 2 } } : null);
  assert.strictEqual(round.years.length, 4, r.name + ': вариантов годов не 4');
  assert.strictEqual(new Set(round.years).size, 4, r.name + ': повтор вариантов годов');
  assert.strictEqual(round.years.filter(y => y === r.correctYears).length, 1, r.name + ': верные годы не один раз');
  const texts = round.events.map(e => e.text);
  assert.strictEqual(new Set(texts).size, texts.length, r.name + ': повтор события в круге');
  assert.ok(round.events.length >= 3 && round.events.length <= 7, r.name + ': событий в круге ' + round.events.length);
  const ownTrue = new Set(r.events.filter(e => e.isTrue).map(e => e.text));
  for (const e of round.events) {
    const mine = r.events.find(x => x.text === e.text);
    if (mine) { assert.strictEqual(e.isTrue, mine.isTrue, r.name + ': своё событие с чужой пометкой'); continue; }
    assert.strictEqual(e.isTrue, false, r.name + ': чужое событие помечено верным');
    const g = sharedOf.get(e.text);
    assert.ok(!(g && g.some(t => ownTrue.has(t))), r.name + ': ловушкой подставлено его же событие — ' + e.text);
  }
}

// ── подключение ──
const html = read('index.html');
assert.match(html, /<script src="tsar-mode\.js\?v=[^"]+" defer><\/script>/, 'tsar-mode.js не подключён');
assert.match(html, /data-action="openTsarMode"/, 'нет плитки «Тиндер правителей»');
assert.match(read('app.js'), /openTsarMode:\s+\(\) => window\.openTsarMode\?\.\(\)/, 'нет обработчика openTsarMode');
const sw = read('service-worker.js');
assert.match(sw, /\.\/tsar-mode\.js\?v=/, 'tsar-mode.js не в прекэше');
assert.match(sw, /\.\/tsar-data\.js\?v=/, 'tsar-data.js не в прекэше');
assert.match(read('state.js'), /SAVE_FIELDS[\s\S]{0,1200}'tsarTinder'/, 'прогресс тренажёра не сохраняется');
assert.match(read('cloud-sync.js'), /states\.map\(s => s\.stats\?\.tsarTinder\)/, 'клиент не сливает прогресс тренажёра');
assert.match(read('server/api/src/state-merge.js'), /states\.map\(s => s\.stats\.tsarTinder\)/, 'сервер не сливает прогресс тренажёра');
console.log('tsar-mode: ok — ' + R.length + ' правителей, ' + R.reduce((n, r) => n + r.events.length, 0) + ' событий');
