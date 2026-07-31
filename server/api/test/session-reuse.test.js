'use strict';

// 🔴 Вход НЕ должен пересоздавать живую сессию того же человека.
//
// Клиент зовёт /auth/telegram при каждом запуске приложения. Пока там стоял
// replaceSession, каждый запуск означал «отозвать старую сессию, выдать новую»:
// в базе за неделю осело 1180 сессий, у одного ученика — 248 при норме 1–3.
// Опасен не объём таблицы, а ОКНО между отзывом старой куки и принятием новой —
// попавшие в него запросы получают 401/403, а клиент на отказ реагирует молчаливым
// ожиданием. На iOS, где куки живут по более жёстким правилам, каждый лишний цикл
// входа — лишний шанс остаться без сессии вовсе.
//
// Проверяем исходник, а не живой сервер: поднимать Postgres ради одной ветки
// дороже, чем зафиксировать саму развилку. Тест обязан падать, если кто-то вернёт
// безусловный replaceSession в обработчик телеграм-входа.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');

test('телеграм-вход переиспользует живую сессию, а не пересоздаёт её', () => {
  const handler = serverSource.slice(serverSource.indexOf("url.pathname === '/api/v1/auth/telegram'"));
  const body = handler.slice(0, handler.indexOf('/api/v1/auth/google/start'));
  assert.match(body, /await ensureSession\(req, res, userId, session\)/,
    'вход снова пересоздаёт сессию при каждом запуске — вернулось окно 401/403');
  assert.doesNotMatch(body, /await replaceSession\(/,
    'в телеграм-входе не должно остаться безусловной замены сессии');
});

test('ensureSession продлевает сессию только тому же пользователю', () => {
  const fn = serverSource.match(/async function ensureSession\([\s\S]*?\n}/);
  assert.ok(fn, 'ensureSession исчез');
  assert.match(fn[0], /oldSession && oldSession\.userId === userId/,
    'условие совпадения пользователя пропало — сессия может достаться не тому человеку');
  assert.match(fn[0], /await extendSession\(oldSession\.id\)/,
    'сессия не продлевается — она протухнет в исходный срок');
  assert.match(fn[0], /return replaceSession\(req, res, userId, oldSession\)/,
    'смена человека обязана идти через полную замену сессии');
});

test('extendSession двигает срок жизни и отметку активности', () => {
  const fn = authSource.match(/async function extendSession\([\s\S]*?\n}/);
  assert.ok(fn, 'extendSession исчез');
  assert.match(fn[0], /UPDATE user_sessions SET expires_at = now\(\)\+/,
    'продление не двигает expires_at — смысл теряется');
  assert.match(fn[0], /last_seen_at = now\(\)/,
    'без отметки активности уборка старых сессий сочтёт живую сессию заброшенной');
  assert.match(fn[0], /WHERE id = \$1/, 'продление обязано бить ровно по одной сессии');
});
