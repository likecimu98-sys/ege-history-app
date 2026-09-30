// Страж «Карт» (map-mode.js).
//  • Карты ЕГЭ (ФИПИ): по каждой из 64 карт — вопросы с одним верным ответом;
//    «верно/неверно» строго по ответу задания 12; вопросы с вариантами — 4 разных.
//  • Атлас (81 карта): последний вопрос — «что изображено», 4 разных варианта.
//  • Вопроса «что отмечено на карте» нет: ориентиры описания не совпадают с
//    надписями на картинке (владелец 30.09.2026).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { console, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => null } };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('visualStudyData.generated.js'), ctx);
vm.runInContext(read('exam-bank.generated.js'), ctx);
vm.runInContext(read('map-mode.js'), ctx);
const src = read('map-mode.js');
assert.doesNotMatch(src, /Что из этого отмечено на карте/, 'вопрос «что отмечено» вернулся');

const fipi = ctx.MapMode.fipi();
assert.strictEqual(fipi.length, 64, 'карт ФИПИ не 64: ' + fipi.length);
const bank = ctx.EGE_EXAM_BANK.tasks;
const kinds = {};
for (let round = 0; round < 20; round++) {
  for (const g of fipi) {
    const k12 = bank.find(t => t.kim === 12 && t.groupId === g.id);
    const truth = new Set(String(k12.answer).replace(/\D/g, '').split(''));
    assert.strictEqual(g.judgments.filter(j => j.ok).length, truth.size, g.id + ': число верных суждений');
    const qs = ctx.MapMode.fipiQuestions(g);
    assert.strictEqual(qs.length, 3, g.id + ': вопросов не 3');
    for (const q of qs) {
      kinds[q.kind] = (kinds[q.kind] || 0) + 1;
      assert.strictEqual(q.options.filter(o => o === q.answer).length, 1, g.id + ' ' + q.kind + ': верный не ровно один');
      assert.strictEqual(new Set(q.options).size, q.options.length, g.id + ': варианты повторяются');
      if (q.kind === 'tf') {
        const el = k12.elements.find(e => String(e.text).replace(/\s*\n\s*/g, ' ').trim() === q.statement);
        assert.ok(el, g.id + ': суждение не из задания 12');
        assert.strictEqual(q.answer, truth.has(String(el.n)) ? 'Верно' : 'Неверно', g.id + ': ответ суждения не совпал с ФИПИ');
      } else assert.strictEqual(q.options.length, 4, g.id + ' ' + q.kind + ': вариантов не 4');
    }
  }
}
assert.ok(kinds.tf && (kinds.city || kinds.century), 'нужны и суждения, и вопросы с вариантами: ' + JSON.stringify(kinds));

const atlas = ctx.MapMode.atlas();
assert.ok(atlas.length >= 80, 'карт атласа меньше 80');
for (let round = 0; round < 15; round++) for (const m of atlas) {
  const qs = ctx.MapMode.atlasQuestions(m);
  assert.strictEqual(qs[qs.length - 1].kind, 'title', m.id + ': последний не «что изображено»');
  for (const q of qs) {
    assert.strictEqual(q.options.length, 4, m.id + ' ' + q.kind);
    assert.strictEqual(new Set(q.options).size, 4, m.id + ' ' + q.kind + ': повтор вариантов');
    assert.strictEqual(q.options.filter(o => o === q.answer).length, 1, m.id + ' ' + q.kind + ': верный не один');
  }
}
assert.match(read('index.html'), /<script src="map-mode\.js\?v=/, 'map-mode.js не подключён');
assert.match(read('service-worker.js'), /map-mode\.js\?v=/, 'map-mode.js не в прекэше');
assert.match(read('app.js'), /openMapMode:/, 'нет обработчика openMapMode');
console.log('map-mode.selftest: ok', JSON.stringify(kinds));
