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

// ── домашка: эпохи-рамки ──
// Каждая эпоха — посильная порция (3–8 правителей), и вместе они покрывают всех
// ровно по разу: учитель, выдавая эпохи по очереди, не повторит и не пропустит никого.
const seen = new Map();
for (const e of T.eras) {
  const list = T.inRange(e.ys, e.ye);
  assert.ok(list.length >= 3 && list.length <= 8, e.t + ': правителей ' + list.length);
  list.forEach(r => seen.set(r.id, (seen.get(r.id) || 0) + 1));
}
for (const r of R) assert.strictEqual(seen.get(r.id), 1, r.name + ': в эпохах ' + (seen.get(r.id) || 0) + ' раз');
// Край рамки не тянет соседа: в XIX век (1801–1894) не входит Николай II, а Александр III входит.
const xix = T.inRange(1801, 1894).map(r => r.name).join();
assert.ok(/Александр III/.test(xix) && !/Николай II/.test(xix), 'рамка 1801–1894: ' + xix);
assert.ok(T.inRange(1700, 1700).some(r => /Петр I/.test(r.name)), 'год внутри правления Петра не находит его');

// Этап ДЗ «tsar» проходит все места, где этап собирают, хранят и считают.
const stateSrc = read('state.js'), uiSrc = read('ui.js'), csSrc = read('cloud-sync.js');
assert.match(stateSrc, /RANGE_TASKS = new Set\(\[[^\]]*'tsar'/, 'tsar не в RANGE_TASKS — рамки сотрутся при нормализации');
assert.ok(stateSrc.includes("if (o.task === 'tsar') { o.metric = 'learned'; o.rulers = tsarRulerIds(it.rulers); }"), 'нормализация теряет список правителей');
assert.strictEqual(csSrc.split("if (o.task === 'tsar') { o.metric = 'learned'; o.rulers = ").length - 1, 2, 'выдача ученику/классу теряет список правителей');
assert.match(csSrc, /itemRemaining = \(it\) => it\.task === 'tsar'/, 'кабинет учителя не считает этап правителей');
assert.ok(uiSrc.includes("{ v: 'tsar',"), 'нет этапа в конструкторе ДЗ');
assert.ok(uiSrc.includes('window.openTsarMode({ hw: true, rulers: it.rulers'), 'этап ДЗ не открывает тренажёр с колодой');
// Счёт этапа — функция из state.js: выученные хоть раз (known) и нынешние (mastered), без повторов.
const sctx = { window: {} }; sctx.window.window = sctx.window; vm.createContext(sctx);
vm.runInContext(stateSrc.match(/function tsarKnownCount[\s\S]*?\n\}/)[0] + ';window.f = tsarKnownCount;', sctx);
assert.strictEqual(sctx.window.f([16, 161, 17], { known: [16], mastered: [16, 17, 5] }), 2, 'счёт выученных правителей этапа');
assert.strictEqual(sctx.window.f([16], null), 0, 'пустой прогресс тренажёра');

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
