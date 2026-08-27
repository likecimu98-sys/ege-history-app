'use strict';

// Уведомление учителю не имеет права уронить сохранение ответов.
//
// 🔴 ЧТО БЫЛО. Строка «ученик сдал» вставлялась внутрь той же транзакции, что
// сохраняет попытки, а её конфликт со СТАРЫМ уникальным индексом
// (assignment_id, telegram_id) не гасился — арбитром указан только dedup_key.
// Ошибка ловилась в JS и «игнорировалась», но транзакция к этому моменту уже
// оборвана: следующий запрос отвечает 25P02, весь POST /me/attempts — 500.
// Клиент на 5xx правильно оставляет очередь на потом, поэтому очередь
// застревала НАВСЕГДА. 27.08.2026 ученица решила 31 задание — учитель не
// увидел ни одного, потому что одноклассник сдал ту же домашку раньше неё.
//
// Здесь проверяется, что этого не повторится с ЛЮБОЙ ошибкой уведомления, а не
// только с этой: точка отката возвращает транзакцию в рабочее состояние.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const root = path.join(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'src', 'subjects', 'social', 'store.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'migrations', '013_social_notification_scope.sql'), 'utf8');

// Клиент, который ведёт себя как Postgres: любая ошибка обрывает транзакцию, и
// дальше проходит только откат к точке сохранения.
function abortingClient({ failOn }) {
  const calls = [];
  let aborted = false;
  return {
    calls,
    savepoints: () => calls.filter(text => /SAVEPOINT/.test(text)),
    query: async text => {
      calls.push(text);
      if (/^ROLLBACK TO SAVEPOINT/.test(text)) { aborted = false; return { rowCount: 0, rows: [] }; }
      if (aborted) {
        const error = new Error('current transaction is aborted, commands ignored until end of transaction block');
        error.code = '25P02';
        throw error;
      }
      if (failOn(text)) {
        aborted = true;
        const error = new Error('duplicate key value violates unique constraint');
        error.code = '23505';
        throw error;
      }
      return { rowCount: 0, rows: [] };
    },
  };
}

const assignment = { id: 'a-1', teacher_user_id: 'teacher-1', title: '', class_title: '' };

test('сбой уведомления не обрывает транзакцию с ответами', async () => {
  const client = abortingClient({ failOn: text => text.includes('INSERT INTO social_notification_jobs') });
  // Учитель у задания есть — иначе вставка бы даже не начиналась.
  const original = client.query;
  client.query = async text => (text.includes('FROM user_identities')
    ? { rowCount: 1, rows: [{ telegram_id: '352253483' }] }
    : original(text));

  await store.notifyCompletionSafely(client, assignment, 'student-2');

  // Главное: транзакция снова рабочая. Именно это и не выполнялось.
  await client.query('SELECT 1');
  assert.ok(client.savepoints().some(text => text.startsWith('SAVEPOINT')), 'точка отката ставится ДО вставки');
  assert.ok(client.savepoints().some(text => text.startsWith('ROLLBACK TO SAVEPOINT')),
    'и при сбое к ней возвращаются, а не просто глотают исключение');
});

test('успешное уведомление точку отката освобождает', async () => {
  const client = abortingClient({ failOn: () => false });
  const original = client.query;
  client.query = async text => (text.includes('FROM user_identities')
    ? { rowCount: 1, rows: [{ telegram_id: '352253483' }] }
    : original(text));

  await store.notifyCompletionSafely(client, assignment, 'student-2');
  assert.ok(client.savepoints().some(text => text.startsWith('RELEASE SAVEPOINT')),
    'иначе точки копились бы на каждую сдачу в пачке');
  assert.ok(!client.savepoints().some(text => text.startsWith('ROLLBACK TO SAVEPOINT')),
    'откатывать нечего');
});

test('сохранение ответов идёт через защищённое уведомление', () => {
  // 🔴 Прямой вызов enqueueCompletionNotification из saveAttempts возвращает
  // ровно ту поломку: голый try/catch не лечит оборванную транзакцию.
  assert.ok(storeSource.includes('await notifyCompletionSafely(client, assignment, userId);'),
    'saveAttempts обязан звать обёртку с точкой отката');
  assert.ok(!/try \{ await enqueueCompletionNotification/.test(storeSource),
    'и не голый try/catch');
});

// ------------------------------------------------------------- индексы ---

test('старый индекс рассылки сужен до строк без ключа повтора', () => {
  // Пара (задание, учитель) разрешала РОВНО ОДНО уведомление о сдаче на всё
  // задание: второй сдавший ученик ронял вставку. dedup_key отвечает за дубли
  // сам, а старый индекс обязан касаться только рассылки о выдаче.
  assert.match(migration, /DROP INDEX IF EXISTS social_notification_jobs_assignment_uq/);
  assert.match(migration, /WHERE assignment_id IS NOT NULL AND dedup_key = ''/);
});

test('ON CONFLICT рассылки о выдаче повторяет предикат индекса', () => {
  // Арбитр выводится по предикату. Разойдись они — Postgres не найдёт индекс и
  // ответит 42P10 на КАЖДУЮ выдачу домашки.
  assert.ok(storeSource.includes(
    "ON CONFLICT (assignment_id, telegram_id) WHERE assignment_id IS NOT NULL AND dedup_key = '' DO NOTHING"),
    'предикат в запросе обязан совпадать с предикатом индекса дословно');
});
