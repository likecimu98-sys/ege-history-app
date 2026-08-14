'use strict';
// Поиск соперника: фоновый, бессрочный, с очевидной отменой.
//
// 🔴 Раньше поиск держал модалку на весь экран и сам сдавался через 30 секунд —
// «Никого нет в сети 😢». Заниматься в это время было нельзя, а тридцати секунд
// не хватает почти никогда: подписчиков 145, и человек, готовый подождать минуту,
// всё равно оставался без матча. Решение владельца 14.08.2026: ждём столько,
// сколько человек готов ждать.
//
// Бессрочность держится на сердцебиении. Матч без признаков жизни другие клиенты
// пропускают (старше 30 с) и удаляют (старше 45 с), а сервер убирает waiting-матчи,
// не менявшиеся две минуты. Без отметки aliveAt «бесконечный» поиск умер бы через
// минуту, причём молча.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const modes = strip(fs.readFileSync(path.join(root, 'modes.js'), 'utf8'));
const cloud = strip(fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8'));
const store = strip(fs.readFileSync(path.join(root, 'server/api/src/store.js'), 'utf8'));

// ── 1. Срока у поиска больше нет ────────────────────────────────────────────
assert.doesNotMatch(modes, /duelSearchSeconds\s*>\s*\d+/,
  'Поиск снова сдаётся сам по таймеру — ровно это и просили убрать');
assert.doesNotMatch(modes, /Никого нет в сети/,
  'Вернулось сообщение об автоматической сдаче поиска');

// ── 2. Поиск идёт фоном, а не в модалке ─────────────────────────────────────
const start = modes.slice(modes.indexOf('window.startDuelSearch = function'),
  modes.indexOf('window.cancelDuelSearch = function'));
assert.ok(start.length > 100, 'startDuelSearch не найдена');
assert.doesNotMatch(start, /showModal\('duel-search-modal'\)/,
  'Поиск снова открывает модалку на весь экран — заниматься во время поиска нельзя');
assert.match(start, /_duelBarShow\(\)/, 'Поиск не показывает плашку');

// ── 3. Отмена очевидна: подписанная кнопка, а не крестик ────────────────────
const bar = modes.slice(modes.indexOf('function _duelBarEl()'), modes.indexOf('function _duelBarShow()'));
assert.match(bar, /btn\.textContent = 'Отменить'/, 'У плашки нет подписанной кнопки отмены');
assert.match(bar, /aria-label', 'Отменить поиск соперника'/, 'Кнопка отмены безымянна для скринридера');
assert.match(bar, /btn\.onclick = \(\) => window\.cancelDuelSearch\(/, 'Кнопка отмены ничего не отменяет');
assert.match(modes, /function _duelBarHide\(\)/, 'Плашку нечем убрать');

// ── 4. Найден соперник — плашка уходит, отсчёт виден ────────────────────────
// Поиск фоновый, человек мог решать таблицу: без модалки дуэль начиналась бы рывком.
const init = modes.slice(modes.indexOf('window.initDuelStart = function'));
assert.match(init.slice(0, 600), /_duelBarHide\(\)/, 'Плашка поиска остаётся висеть после начала дуэли');
assert.match(init.slice(0, 600), /showModal\('duel-search-modal'\)/,
  'Начало дуэли не показывает отсчёт — матч стартует рывком посреди чужого экрана');

// ── 5. Сердцебиение: есть, частое, и его гасят ──────────────────────────────
const hb = cloud.slice(cloud.indexOf('function _startDuelHeartbeat'), cloud.indexOf('window.startDuelSearchDb'));
assert.ok(hb.length > 100, '_startDuelHeartbeat не найдена');
assert.match(hb, /updateDoc\(doc\(matchesRef, matchId\), \{ aliveAt: Date\.now\(\) \}\)/,
  'Сердцебиение не отмечает aliveAt');
const every = hb.match(/\}, (\d+)\);/);
assert.ok(every, 'не вижу периода сердцебиения');
assert.ok(Number(every[1]) <= 25000,
  `Период ${every[1]} мс — матч успеет протухнуть между ударами (другие пропускают старше 30 с)`);
assert.match(hb, /catch \(e\)/,
  'Отказ сердцебиения роняет поиск: на старом сервере aliveAt запрещён, и поиск сломался бы совсем');
assert.match(cloud, /_startDuelHeartbeat\(newMatch\.id\)/, 'Сердцебиение не запускается после создания матча');
assert.match(cloud, /window\.state\.duel\.searching = false;\s*\n\s*_stopDuelHeartbeat\(\)/,
  'Сердцебиение продолжает стучать после начала матча');
const cancel = cloud.slice(cloud.indexOf('window.cancelDuelDb = async function'), cloud.indexOf('window.cancelDuelDb = async function') + 700);
assert.match(cancel, /_stopDuelHeartbeat\(\)/, 'Отмена поиска не гасит сердцебиение');

// ── 6. Возраст матча считается от признака жизни, а не от создания ──────────
assert.match(cloud, /const seenAt = Number\(data\.aliveAt\) \|\| Number\(data\.createdAt\) \|\| 0;/,
  'Возраст матча снова считается от createdAt — ждущего сочтут брошенным и удалят');
assert.match(cloud, /const age = now - seenAt;/, 'Возраст матча считается не от seenAt');

// ── 7. Сервер обязан пропускать aliveAt ─────────────────────────────────────
// Белый список полей матча отвергает лишнее ЦЕЛИКОМ — так уже ломался режим «подбор».
assert.match(store, /const PUBLIC_MATCH_FIELDS = \[[^\]]*'aliveAt'[^\]]*\];/,
  'aliveAt не отдаётся клиентам — сердцебиение не увидит никто, кроме самого ждущего');
assert.match(store, /key === actorKey \|\| key === 'status' \|\| key === 'aliveAt'/,
  'Владелец матча не имеет права обновлять aliveAt — сердцебиение будет отвергнуто с 403');
assert.match(store, /Number\.isFinite\(Number\(patch\.aliveAt\)\)/,
  'aliveAt принимается без проверки на число');

console.log('duel-search-background.selftest: ok');
