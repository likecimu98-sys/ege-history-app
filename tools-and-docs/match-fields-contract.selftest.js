'use strict';

// 🔴 ДОГОВОР О ПОЛЯХ СОЗДАНИЯ МАТЧА между клиентом и сервером.
//
// authorizeWrite для matches в режиме create проверяет поля БЕЛЫМ списком, и лишнее
// поле отвергает запрос ЦЕЛИКОМ — не вырезается, как в профиле ученика, а именно
// рушит создание.
//
// Так дуэли и сломались: клиент научился режиму «подбор» и стал слать `matchRounds`
// с колодой раундов, а в белом списке этого поля не было. Каждая дуэль в режиме
// «подбор» получала 403 и не создавалась вовсе. На экране — ничего, в логе сервера —
// безымянное `forbidden` без документа и полей. 01.08.2026 таких отказов было 12 за
// день, и увидеть их удалось, только добавив расшифровку в лог.
//
// Тест сравнивает ИСХОДНИКИ: клиентский объект нового матча против серверного
// перечня. Поднимать браузер и Postgres ради одной проверки дороже, чем зафиксировать
// сам договор.
//
// ⚠️ Живёт в tools-and-docs, а НЕ в server/api/test, хотя проверяет серверное правило:
// deploy-api.ps1 заливает на сервер только папку server/api и гоняет её тесты там.
// Клиентского cloud-sync.js на сервере нет — тест падал бы на каждом выкате API.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// Комментарии вырезаем ПЕРЕД разбором: иначе объяснительный текст выше сам себя
// «подтвердит» — ровно на этом обжигался страж полей состояния.
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const serverSource = stripComments(read('server/api/src/store.js'));
const clientSource = stripComments(read('cloud-sync.js'));

// ─── Что разрешает сервер ────────────────────────────────────────────────────
const allowMatch = serverSource.match(/MATCH_CREATE_FIELDS = new Set\(\[([\s\S]*?)\]\)/);
assert.ok(allowMatch, 'MATCH_CREATE_FIELDS не найден в store.js — договор проверить не по чему');
const serverFields = new Set((allowMatch[1].match(/'(\w+)'/g) || []).map(s => s.slice(1, -1)));
assert.ok(serverFields.size >= 6, `Белый список подозрительно короткий (${serverFields.size}) — проверь разбор`);

// Проверка, что список действительно применяется, а не остался украшением.
assert.match(serverSource, /fields\.every\(key => MATCH_CREATE_FIELDS\.has\(key\)\)/,
  'Создание матча больше не сверяется с MATCH_CREATE_FIELDS');

// ─── Что шлёт клиент ─────────────────────────────────────────────────────────
// Якорь — сам вызов создания матча, а не текст рядом.
const createAt = clientSource.indexOf('addDoc(matchesRef, {');
assert.ok(createAt >= 0, 'Не найдено создание матча (addDoc(matchesRef, {…)) в cloud-sync.js');
const bodyStart = clientSource.indexOf('\n', createAt) + 1;
const bodyEnd = clientSource.indexOf('});', bodyStart);
assert.ok(bodyEnd > bodyStart, 'Не найден конец объекта нового матча');
const createLines = clientSource.slice(bodyStart, bodyEnd).split('\n');

// ⚠️ Разбираем ПОСТРОЧНО и берём только ключи ВЕРХНЕГО уровня.
// Объект записан по одному ключу на строку, а вложенный игрок — целиком в одной
// строке (`player1: { uid, name, score, combo, elo }`). Поэтому построчный разбор
// даёт ровно то, что уходит на сервер: `player1`, а не его внутренности. Разбор
// «по всему тексту» ловил бы uid/name/score и требовал бы разрешать их на сервере —
// то есть проверял бы не тот договор.
const clientFields = new Set();
for (const line of createLines) {
  const plain = line.match(/^\s*(\w+)\s*:/);
  if (plain) { clientFields.add(plain[1]); continue; }
  // Условные вставки: `...(matchRounds ? { matchRounds } : {})`.
  const spread = line.match(/\.\.\.\(\s*\w+\s*\?\s*\{\s*(\w+)\s*\}/);
  if (spread) clientFields.add(spread[1]);
}

assert.ok(clientFields.has('status') && clientFields.has('player1'),
  `Разбор полей клиента сломался: не вижу базовых. Нашёл: ${[...clientFields].join(', ')}`);

// ─── Собственно договор ──────────────────────────────────────────────────────
const orphans = [...clientFields].filter(f => !serverFields.has(f));
assert.deepEqual(orphans, [],
  'Клиент шлёт при создании матча поля, которых сервер не разрешает. Белый список '
  + 'отвергает запрос ЦЕЛИКОМ — дуэль не создастся вовсе, молча, с 403 в логе. '
  + `Добавь поля в MATCH_CREATE_FIELDS (server/api/src/store.js). Лишние: ${orphans.join(', ')}`);

// ─── Поле, потеря которого уже стоила инцидента ──────────────────────────────
assert.ok(serverFields.has('matchRounds'),
  'Сервер снова не принимает matchRounds — это ломает режим «подбор» целиком (инцидент 01.08.2026)');

// ─── Обратная проверка: список не должен зарастать ───────────────────────────
// Разрешать больше, чем клиент шлёт, — значит расширять поверхность записи без нужды.
// player2 клиент шлёт явным null (создатель ждёт соперника), поэтому он в обоих.
const unused = [...serverFields].filter(f => !clientFields.has(f));
assert.deepEqual(unused, [],
  `В MATCH_CREATE_FIELDS разрешены поля, которых клиент не шлёт: ${unused.join(', ')}. `
  + 'Убери их — белый список должен быть ровно по факту, иначе он перестаёт что-либо защищать.');

console.log(`store-match-fields: ok (клиент шлёт ${clientFields.size} полей, сервер разрешает ${serverFields.size})`);
