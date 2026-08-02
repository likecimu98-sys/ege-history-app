'use strict';
// Недельный топ держится на одной строке — weekStartStr. Клиент её пишет,
// сервер по ней отбирает строки топа. Формула вычисления этой строки физически
// продублирована (utils.js для браузера, server/api/src/server.js для node —
// один другого не импортирует), поэтому единственное, что не даёт им разойтись,
// это тест.
//
// 🔴 Регрессия 02.08.2026. Обе копии брали ЛОКАЛЬНОЕ время. VPS живёт в Etc/UTC,
// ученики — в MSK. Каждое воскресенье с 21:00 UTC (= 00:00 понедельника по
// Москве) до 00:00 UTC сервер считал, что неделя ещё старая, а всякий открывший
// приложение ученик писал себе weekStartStr новой недели — и исчезал из топа.
// Со стороны: «игроки поменялись, топ не обнулился».
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// ── Достаём обе копии формулы из исходников ──────────────────────────────────
function extract(source, header, name, where) {
  const start = source.indexOf(header);
  assert.ok(start > 0, `${name} не найдена в ${where}`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `не видно конца ${name} в ${where}`);
  // MSK_OFFSET_MS объявлен выше по файлу — передаём параметром, чтобы вырезать
  // ровно тело функции и не тащить весь модуль.
  return new Function('MSK_OFFSET_MS',
    `${source.slice(start, end + 2)}; return ${name};`)(3 * 60 * 60 * 1000);
}

const clientMonday = extract(read('utils.js'),
  'function getMondayOfCurrentWeek', 'getMondayOfCurrentWeek', 'utils.js');
const serverMonday = extract(read('server/api/src/server.js'),
  'function mondayStr', 'mondayStr', 'server.js');

// ── 1. Граница недели — полночь по Москве ────────────────────────────────────
const boundary = [
  // 23:59:59 воскресенья по Москве — неделя ещё старая.
  ['2026-08-02T20:59:59Z', '2026-07-27'],
  // 00:00:00 понедельника по Москве — ровно в этот миг неделя новая.
  ['2026-08-02T21:00:00Z', '2026-08-03'],
  // Тот самый момент, когда топ поймали сломанным: 01:39 понедельника в Москве.
  ['2026-08-02T22:39:00Z', '2026-08-03'],
  // 03:30 понедельника по Москве — UTC только что перевалил за полночь.
  ['2026-08-03T00:30:00Z', '2026-08-03'],
  // Середина недели и её первый час.
  ['2026-07-29T12:00:00Z', '2026-07-27'],
  ['2026-07-26T21:00:00Z', '2026-07-27'],
];
for (const [iso, expected] of boundary) {
  assert.equal(serverMonday(new Date(iso)), expected,
    `сервер: ${iso} должен попадать в неделю ${expected}`);
  assert.equal(clientMonday(new Date(iso)), expected,
    `клиент: ${iso} должен попадать в неделю ${expected}`);
}

// ── 2. Клиент и сервер обязаны совпадать в каждый час недели ─────────────────
const from = Date.parse('2026-07-30T00:00:00Z');
for (let h = 0; h < 24 * 9; h++) {
  const at = new Date(from + h * 3600 * 1000);
  assert.equal(clientMonday(at), serverMonday(at),
    `формулы разошлись на ${at.toISOString()}`);
}

// ── 3. Ответ не должен зависеть от зоны процесса ─────────────────────────────
// Именно эта зависимость и была багом: на ноутбуке в MSK всё сходилось, а на
// VPS в UTC — нет, поэтому «у меня работает» ничего не доказывало.
{
  const at = new Date('2026-08-02T22:39:00Z');
  const saved = process.env.TZ;
  const seen = new Set();
  for (const tz of ['UTC', 'Europe/Moscow', 'Asia/Vladivostok', 'America/New_York']) {
    process.env.TZ = tz;
    seen.add(serverMonday(at));
    seen.add(clientMonday(at));
  }
  if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  assert.equal(seen.size, 1,
    `метка недели поехала от часового пояса процесса: ${[...seen].join(', ')}`);
  assert.ok(seen.has('2026-08-03'), 'ожидалась неделя 2026-08-03');
}

// ── 4. Третьей копии формулы быть не должно ──────────────────────────────────
// В cloud-sync.js жили ещё две — в _mondayISO и в кабинете учителя. Пока они
// там, любая правка границы недели чинит топ и оставляет кабинет сломанным.
{
  const cloud = read('cloud-sync.js')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(cloud, /getDate\(\)\s*-\s*day\s*\+\s*1/,
    'в cloud-sync.js снова завелась своя формула понедельника — она должна быть только в utils.js');
  assert.match(cloud, /function _mondayISO[\s\S]{0,200}?window\.getMondayOfCurrentWeek/,
    '_mondayISO обязана делегировать в getMondayOfCurrentWeek');
  assert.match(cloud, /const monStr = window\.getMondayOfCurrentWeek\(\)/,
    'кабинет учителя обязан брать границу недели из общей функции');
}

// ── 5. Общая функция должна быть доступна клиенту ────────────────────────────
// cloud-sync.js грузится отдельным модулем и видит её только через window.
assert.match(read('utils.js'), /window\.getMondayOfCurrentWeek\s*=\s*getMondayOfCurrentWeek/,
  'getMondayOfCurrentWeek не выставлена в window — cloud-sync.js её не увидит');

console.log('weekly-top.selftest: ok');
