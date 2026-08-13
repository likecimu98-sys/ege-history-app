'use strict';
// Сводки бота обязаны видеть ВСЕХ учеников, а не первые 500.
//
// 🔴 store/query отдаёт максимум 500 строк, когда лимит не запрошен явно, и молчит
// об обрезке. 13.08.2026 утренний «Пульс» доложил «решено вчера: 0 строк» — на
// самом деле 1070 строк у 16 человек. Ровно ноль, а не «часть»: без ORDER BY срез
// берёт 500 САМЫХ СТАРЫХ записей, а неравенства (lastActive > …) фильтруются уже
// ПОСЛЕ среза — активных там не остаётся вовсе. По той же причине стрик-пинг и
// дедлайн-пинг каждый день писали в лог «0».
//
// Тест держит два обещания: ни одного обхода коллекции мимо scanAll, и сам scanAll
// просит явный потолок и кричит, когда в него упёрся.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'bot', 'src', 'engage.js');
const src = fs.readFileSync(file, 'utf8');
const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── 1. Ни одного обхода в обход обёртки ─────────────────────────────────────
// Именно эта строка и была багом — во всех пяти местах сразу.
const bare = [...code.matchAll(/fdb\.collection\([^\n]*?\)\s*\.get\(\)/g)].map(m => m[0]);
assert.deepEqual(bare, [],
  `обход коллекции мимо scanAll — выдача молча обрежется на 500:\n${bare.join('\n')}`);

// Каждый collection( в модуле обязан быть аргументом scanAll.
for (const line of code.split('\n')) {
  if (!line.includes('fdb.collection(')) continue;
  assert.ok(line.includes('scanAll('),
    `обход коллекции не через scanAll: ${line.trim()}`);
}

// ── 2. Обёртка просит потолок явно и знает предел API ───────────────────────
const capLine = code.match(/const SCAN_CAP = (\d+);/);
assert.ok(capLine, 'SCAN_CAP не найден');
assert.equal(Number(capLine[1]), 5000, 'потолок должен совпадать с максимумом API (store.js)');

// Потолок API берём из самого API — если там опустят, тест поймает расхождение.
const store = fs.readFileSync(path.join(__dirname, '..', 'server', 'api', 'src', 'store.js'), 'utf8');
const apiCap = store.match(/Math\.min\((\d+), Math\.max\(0, Number\(\(constraints \|\| \[\]\)\.find/);
assert.ok(apiCap, 'не нашёл потолок в store.js');
assert.equal(Number(apiCap[1]), Number(capLine[1]),
  'потолок бота разошёлся с потолком API — часть учеников снова станет невидимой');

// ── 3. Поведение: лимит уходит в запрос, упор в потолок слышно ──────────────
const body = code.slice(code.indexOf('async function scanAll('),
  code.indexOf('\n    }', code.indexOf('async function scanAll(')) + 6);
const make = new Function('console', `const SCAN_CAP = ${capLine[1]}; ${body}; return scanAll;`);

const shouts = [];
const scanAll = make({ error: (...a) => shouts.push(a.join(' ')) });
const fakeRef = (count) => ({
  asked: null,
  limit(n) { this.asked = n; return this; },
  async get() { return { docs: Array.from({ length: count }, (_, i) => i) }; },
});

(async () => {
  // Обычный случай: лимит запрошен, крика нет.
  const small = fakeRef(1143);
  const res = await scanAll('ученики', small);
  assert.equal(small.asked, 5000, 'scanAll не запросил явный потолок — API молча вернёт 500');
  assert.equal(res.docs.length, 1143, 'scanAll потерял строки');
  assert.deepEqual(shouts, [], 'закричал там, где всё в порядке');

  // Упёрлись в потолок — обязан заорать, иначе следующий раз опять промолчим.
  await scanAll('все ученики', fakeRef(5000));
  assert.equal(shouts.length, 1, 'упор в потолок прошёл молча — ровно так баг и прятался');
  assert.match(shouts[0], /потолок/, 'в предупреждении не сказано, что упёрлись в потолок');
  assert.match(shouts[0], /все ученики/, 'в предупреждении не видно, какой именно обход обрезан');

  console.log('engage-scan-limit.selftest: ok');
})().catch(e => { console.error(e.message); process.exit(1); });
