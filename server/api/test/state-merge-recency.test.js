'use strict';

// Слияние записей фактов (factStreaks) по свежести. Раньше побеждал «лучший уровень»,
// а при равенстве — первая копия: повтор факта на 5-м уровне терялся при каждом
// слиянии, и ученица «который день» решала в «Повторении» те же 4 факта (30.09.2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeStateValues } = require('../src/state-merge');

const DAY = 864e5;
const T0 = Date.UTC(2026, 6, 31);

test('повтор факта 5-го уровня переживает слияние со старой копией в любом порядке', () => {
  const old = { level: 5, points: 3, nextReview: T0 + 60 * DAY, lastUpdated: T0 };
  const fresh = { level: 5, points: 3, nextReview: T0 + 120 * DAY, lastUpdated: T0 + 60 * DAY };
  for (const order of [[old, fresh], [fresh, old]]) {
    const merged = mergeStateValues(order.map(v => ({ stats: { factStreaks: { t1_162: v } } })));
    assert.equal(merged.stats.factStreaks.t1_162.nextReview, fresh.nextReview);
  }
});

test('«забыл» (срыв уровня) — тоже свежее и не откатывается к старому уровню', () => {
  const old = { level: 4, points: 3, nextReview: T0 + 30 * DAY, lastUpdated: T0 };
  const lapse = { level: 2, points: 3, nextReview: T0 + 31 * DAY, lastUpdated: T0 + 30 * DAY, lapses: 1 };
  const merged = mergeStateValues([{ stats: { factStreaks: { a: old } } }, { stats: { factStreaks: { a: lapse } } }]);
  assert.equal(merged.stats.factStreaks.a.level, 2);
  assert.equal(merged.stats.factStreaks.a.lapses, 1);
});

test('записи без отметки времени сливаются по-старому — лучший уровень', () => {
  const merged = mergeStateValues([
    { stats: { factStreaks: { a: { level: 1, points: 3 }, b: { level: 0, points: 2 } } } },
    { stats: { factStreaks: { a: { level: 3, points: 3 }, b: { level: 0, points: 1 } } } },
  ]);
  assert.equal(merged.stats.factStreaks.a.level, 3);
  assert.equal(merged.stats.factStreaks.b.points, 2);
});

test('клиентский закон слияния совпадает с серверным', (t) => {
  const fs = require('fs');
  const path = require('path');
  // На сервере лежит только API — сверка идёт там, где есть весь репозиторий.
  const file = path.join(__dirname, '../../../state.js');
  if (!fs.existsSync(file)) return t.skip('state.js сайта рядом нет (выкладка API)');
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf('window.factStreakNewer = function');
  const j = src.indexOf('\n};', i);
  assert.ok(i > 0 && j > i, 'в state.js нет window.factStreakNewer');
  const win = {};
  new Function('window', src.slice(i, j + 3))(win);
  const cases = [
    [{ level: 5, lastUpdated: 2 }, { level: 5, lastUpdated: 1 }],
    [{ level: 1, lastUpdated: 1 }, { level: 4, lastUpdated: 2 }],
    [{ level: 3 }, { level: 2 }],
    [{ level: 2, points: 3 }, { level: 2, points: 3 }],
  ];
  const server = require('../src/state-merge');
  for (const [a, b] of cases) {
    const viaServer = server.mergeStateValues([{ stats: { factStreaks: { k: b } } }, { stats: { factStreaks: { k: a } } }]).stats.factStreaks.k;
    assert.deepEqual(win.factStreakNewer(a, b) ? a : b, viaServer, JSON.stringify([a, b]));
  }
});
