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
// Деятели задания 5 — источник личностей той же эпохи для вопросов «назовите полководца».
vm.runInContext(read('data.js').replace(/\b(const|let)\s+(bigData|task\w*Data)\b/g, 'var $2'), ctx);
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

// Личности в вопросах — из времени карты: у карт войны 1941–1945 все 4 варианта из
// 1936–1950 (владелец 30.09: «не Кутузовы»), и одно лицо не повторяется под другим именем.
{
  const yearOf = name => {
    const n = String(name).toLowerCase().replace(/ё/g, 'е');
    const hit = ctx.task5Data.filter(d => String(d.person).toLowerCase().replace(/ё/g, 'е').endsWith(n));
    // однофамильцы (Павлов-физиолог и Павлов из Сталинграда): годится любой из них
    const ys = hit.map(d => parseInt(String(d.year).match(/\d+/), 10));
    return ys.find(y => y >= 1936 && y <= 1950) || ys[0] || 0;
  };
  let ww = 0;
  for (const g of fipi) {
    const p = g.asks.find(a => a.kind === 'person');
    if (!p || !['жуков', 'рокоссовский', 'павлов'].includes(p.answer.toLowerCase())) continue;
    for (let i = 0; i < 20; i++) {
      const q = ctx.MapMode.fipiQuestions(g).find(z => z.kind === 'person');
      if (!q) continue;
      ww++;
      for (const o of q.options.filter(x => x !== q.answer)) {
        const y = yearOf(o);
        assert.ok(!y || (y >= 1936 && y <= 1950), `${g.id}: «${o}» (${y}) не из войны`);
      }
    }
  }
  assert.ok(ww > 0, 'вопросы по личностям войны не собираются');
  const dup = [];
  for (const g of fipi) for (let i = 0; i < 10; i++) {
    const q = ctx.MapMode.fipiQuestions(g).find(z => z.kind === 'person');
    if (q && q.options.some(o => o !== q.answer && (o.includes(q.answer) || q.answer.includes(o)))) dup.push(g.id + ': ' + q.options.join(', '));
  }
  assert.deepStrictEqual(dup.slice(0, 3), [], 'одно лицо под двумя именами');
}
console.log('map-mode: личности по эпохе карты — ok');


// Правитель карты атласа правил в её годы (владелец 01.10: «в карте по XX веку
// меня исправили — ситуация сложилась при Петре I»). У «Образования СССР» стоял
// «Петр I», у Транссиба — «Иван IV; Ермак». Каждая запись должна разбираться
// справочником REIGNS и пересекаться с годами карты; иначе — сюда, в справочник
// или в данные, но не мимо.
{
  const bad = [];
  for (const m of atlas) {
    if (!String(m.ruler || '').trim()) continue;
    const rs = ctx.MapMode.rulerReigns(m.ruler);
    if (!rs) { bad.push(m.id + ': правитель «' + m.ruler + '» не в справочнике'); continue; }
    const [a, b] = m._span;
    rs.forEach(r => { if (!(r.from <= b + 2 && r.to >= a - 2)) bad.push(m.id + ' (' + a + '–' + b + '): ' + r.name + ' правил ' + r.from + '–' + r.to); });
  }
  assert.deepStrictEqual(bad, [], 'правитель не из времени карты');
  const ussr = atlas.find(m => m.id === 'map:obrazovanie-sssr');
  assert.ok(ussr && ctx.MapMode.rulerFits(ussr), 'Образование СССР: правитель должен быть Ленин');
  assert.ok(!ctx.MapMode.rulerFits(Object.assign({}, ussr, { ruler: 'Петр I' })), 'Пётр I на карте 1922 года не должен проходить');
}
console.log('map-mode: правители по годам карт — ok');
