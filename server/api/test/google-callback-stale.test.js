'use strict';

// Протухшая ссылка возврата от Google — не падение сервера.
//
// 🔴 Метка состояния одноразовая (`DELETE ... RETURNING`) и живёт десять минут.
// Ученик отвлёкся на выбор аккаунта, обновил страницу, нажал «назад» — и
// получал голый 500 вместо входа. 14.09.2026 это случилось прямо посреди того,
// как класс вступал по ссылке: у одного из семи вход кончился ошибкой сервера.
// Объяснить её ученику нечем, а повторить попытку он не догадается.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

test.after(() => pool.end());

const CLIENT_APP_JS = path.join(__dirname, '..', '..', '..', '..', 'ege-social-app-main', 'app', 'app.js');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const start = serverSource.indexOf("url.pathname === '/api/v1/auth/google/callback'");
const block = serverSource.slice(start, start + 1800);

test('протухшая метка возвращает человека в приложение, а не в 500', () => {
  assert.match(block, /catch \(error\)/, 'ошибка обмена обязана перехватываться');
  assert.match(block, /error\.message === 'oauth_state_invalid'/, 'именно этот случай, а не любой подряд');
  assert.match(block, /\?auth=retry/, 'и возвращать в приложение с пометкой');
});

test('прочие ошибки по-прежнему поднимаются', () => {
  // Глушить всё подряд нельзя: redirect_uri_mismatch или отказ Google — это
  // настоящие поломки, и молчание о них стоило бы дороже.
  assert.match(block, /throw error;/, 'всё остальное пробрасывается дальше');
});

// Клиент живёт в соседнем репозитории, и на сервере его нет — там этот тест
// просто пропускается. Гонять его локально всё равно стоит: пометка без
// объяснения на экране бесполезна ровно так же, как 500.
test('клиент объясняет пометку словами', { skip: !fs.existsSync(CLIENT_APP_JS) && 'клиент рядом не лежит' }, () => {
  const appJs = fs.readFileSync(CLIENT_APP_JS, 'utf8');
  assert.ok(appJs.includes("url.searchParams.get('auth') !== 'retry'"), 'клиент обязан её читать');
  assert.ok(appJs.includes('Вход не завершился — нажмите «Войти через Google» ещё раз'),
    'и сказать, что делать');
});
