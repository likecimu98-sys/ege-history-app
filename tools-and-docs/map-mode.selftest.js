// Страж «Карт» (map-mode.js): по каждой из 81 карты строятся три вопроса,
// последний — «что изображено», у каждого 4 разных варианта, верный среди них
// и ровно один. Проверяем многократно — обманки случайные.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { window: {}, console, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('visualStudyData.generated.js'), ctx);
vm.runInContext(read('map-mode.js'), ctx);
const maps = ctx.visualStudyData.maps;
assert.ok(maps.length >= 80, 'карт меньше 80: ' + maps.length);
ctx.MapMode.prepare();
const kinds = {};
for (let round = 0; round < 25; round++) {
  for (const m of maps) {
    const qs = ctx.MapMode.questions(m);
    assert.strictEqual(qs.length >= 2, true, m.id + ': меньше двух вопросов');
    assert.strictEqual(qs[qs.length - 1].kind, 'title', m.id + ': последний вопрос — не «что изображено»');
    const seen = new Set();
    for (const q of qs) {
      kinds[q.kind] = (kinds[q.kind] || 0) + 1;
      assert.ok(!seen.has(q.kind), m.id + ': два вопроса одного вида');
      seen.add(q.kind);
      assert.strictEqual(q.options.length, 4, m.id + ' ' + q.kind + ': вариантов не 4');
      assert.strictEqual(new Set(q.options).size, 4, m.id + ' ' + q.kind + ': варианты повторяются');
      assert.strictEqual(q.options.filter(o => o === q.answer).length, 1, m.id + ' ' + q.kind + ': верный ответ не ровно один');
      if (q.kind === 'place') for (const o of q.options) if (o !== q.answer)
        assert.ok(!m._places.some(p => p.toLowerCase() === o.toLowerCase()), m.id + ': обманка «' + o + '» есть на этой карте');
    }
  }
}
assert.ok(kinds.place && kinds.when && kinds.ruler, 'вопросы всех видов должны встречаться: ' + JSON.stringify(kinds));
assert.match(read('index.html'), /<script src="map-mode\.js\?v=/, 'map-mode.js не подключён');
assert.match(read('service-worker.js'), /map-mode\.js\?v=/, 'map-mode.js не в прекэше');
assert.match(read('app.js'), /openMapMode:/, 'нет обработчика openMapMode');
console.log('map-mode.selftest: ok', JSON.stringify(kinds));
