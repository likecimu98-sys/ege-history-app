'use strict';

// Удаление аккаунта по требованию субъекта данных.
//
// 🔴 Почему тест на ТЕКСТ запросов. 12.08.2026 выяснилось, что DELETE
// /api/v1/me падал с 500 «column "id" does not exist»: в удалении
// notification_jobs стояло `RETURNING id`, а первичный ключ там называется
// doc_id. То есть право на удаление было записано в политике и не работало
// ни разу — заметить это можно было, только реально попробовав удалить
// аккаунт, чего никто не делал.
//
// Проверка по исходнику, а не по живой базе: ошибка в имени колонки не видна
// ни при каком юнит-тесте с подставным соединением — подставное соединение
// ответит на любой запрос.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

test.after(() => pool.end());

const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const initial = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial.sql'), 'utf8');

// Имена первичных ключей берём из самой миграции, чтобы тест не устарел молча.
function primaryKeyOf(table) {
  const block = initial.slice(initial.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
  const match = block.match(/^\s*([a-z_]+)\s+[a-z]+[^\n]*PRIMARY KEY/mi);
  return match ? match[1] : null;
}

test('колонки в RETURNING удаления аккаунта существуют', () => {
  const start = server.indexOf("url.pathname === '/api/v1/me'");
  assert.ok(start > 0, 'маршрут удаления аккаунта должен существовать');
  const block = server.slice(start, start + 4000);
  const deletes = [...block.matchAll(/DELETE FROM (\w+)[\s\S]*?RETURNING (\w+)/g)];
  assert.ok(deletes.length >= 3, 'удаление должно затрагивать несколько таблиц');
  for (const [, table, column] of deletes) {
    const pk = primaryKeyOf(table);
    if (!pk) continue;
    assert.equal(column, pk,
      `DELETE FROM ${table} возвращает «${column}», а первичный ключ таблицы — «${pk}»`);
  }
});

test('notification_jobs удаляется по doc_id', () => {
  // Отдельной строкой, потому что это ровно та ошибка, что ломала весь маршрут.
  assert.equal(primaryKeyOf('notification_jobs'), 'doc_id');
  assert.ok(!/DELETE FROM notification_jobs[\s\S]{0,200}RETURNING id\b/.test(server),
    'у notification_jobs нет колонки id — маршрут упадёт с 500');
});

test('предметные данные уносит каскад, а не отдельные запросы', () => {
  // Таблицы social_* заведены с ON DELETE CASCADE именно поэтому: перечислять
  // их здесь пришлось бы при каждой новой таблице, и однажды про одну забыли бы.
  const start = server.indexOf("url.pathname === '/api/v1/me'");
  const block = server.slice(start, start + 4000);
  assert.ok(!/DELETE FROM social_/.test(block),
    'social_* не удаляются вручную — это делает ON DELETE CASCADE');
  assert.match(block, /DELETE FROM app_users WHERE id=\$1/,
    'каскад запускается удалением пользователя');
});
