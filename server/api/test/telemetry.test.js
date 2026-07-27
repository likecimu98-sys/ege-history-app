'use strict';

// Регрессия на обезличивание телеметрии.
//
// ⚠️ Критерий приёмки задачи 2.4: искусственно брошенная ошибка видна в трекере
// в течение минуты и НЕ СОДЕРЖИТ персональных данных. Вторая половина и есть
// самая опасная: в текст ошибки браузера легко попадает имя ученика, код класса
// или кусок его состояния, а пользователи здесь несовершеннолетние. Сломается
// чистка — мы этого не заметим, пока кто-нибудь не откроет таблицу.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scrubText, scrubSource, cleanProps, platformOf, recordClientError, recordEvents, EVENT_NAMES,
} = require('../src/telemetry');
const { pool } = require('../src/db');

test.after(() => pool.end());

test('из текста ошибки вычищаются персональные данные', () => {
  assert.match(scrubText('Ошибка у ivanov@gmail.com'), /<email>/);
  assert.ok(!scrubText('Ошибка у ivanov@gmail.com').includes('ivanov@gmail.com'));

  // Telegram ID — это идентификатор человека и одновременно id документа.
  assert.match(scrubText('Cannot read doc 352253483'), /<id>/);
  assert.ok(!scrubText('Cannot read doc 352253483').includes('352253483'));

  assert.match(scrubText('user @ivanov_2007 failed'), /<username>/);

  // Токены и ключи в тексте ошибки.
  assert.match(scrubText('csrf: aB3xK9mZ'), /csrf=<redacted>/);
  assert.ok(!scrubText('token=abcdef123456').includes('abcdef123456'));
  assert.match(scrubText('hash 0123456789abcdef0123456789abcdef'), /<hex>/);
});

test('короткие числа не считаются идентификаторами', () => {
  // Год, номер задания, номер строки — их портить незачем.
  assert.equal(scrubText('task4 line 1917'), 'task4 line 1917');
});

test('длина текста ограничена', () => {
  assert.ok(scrubText('я'.repeat(5000)).length <= 300);
  assert.ok(scrubSource('/x/'.repeat(5000)).length <= 200);
});

test('из адреса файла убирается строка запроса', () => {
  // В query может лежать что угодно, включая токен входа.
  assert.equal(scrubSource('https://reshay-istoriyu.ru/ui.js?v=1&token=secret'), 'https://reshay-istoriyu.ru/ui.js');
});

test('платформа определяется грубо, user-agent целиком не хранится', () => {
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Telegram-iOS'), 'tg');
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 13)'), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0)'), 'desktop');
  assert.equal(platformOf(''), 'desktop');
});

test('в свойства события проходят только числа и короткие метки из белого списка', () => {
  const props = cleanProps({
    task: 'task4',            // метка — можно
    points: 2,                // число — можно
    name: 'Иванов Иван',      // ⚠️ имя — нельзя, и ключа такого нет в списке
    classCode: '7A',          // ⚠️ код класса — нельзя
    comment: 'привет мир',    // ⚠️ произвольный текст — нельзя
    seconds: 42.5,
    mode: 'a'.repeat(50),     // слишком длинная метка — нельзя
    count: Infinity,          // не конечное число — нельзя
  });
  assert.deepEqual(props, { task: 'task4', points: 2, seconds: 42.5 });
});

test('перечень имён событий закрыт', () => {
  assert.ok(EVENT_NAMES.has('app_open'));
  assert.ok(EVENT_NAMES.has('limit_reached'));
  assert.ok(!EVENT_NAMES.has('произвольное_событие'));
});

// ── что реально уходит в базу ──

function fakeDb() {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; } };
}

test('в client_errors не попадает ни имя, ни username, ни Telegram ID', async () => {
  const db = fakeDb();
  await recordClientError({
    message: 'TypeError у Иванов Иван (@ivanov_2007), doc 352253483, mail ivanov@gmail.com',
    source: 'https://reshay-istoriyu.ru/ui.js?token=abc',
    release: '20260726-17',
  }, 'Telegram-iOS', { db });

  const params = db.calls[0].params.join(' | ');
  for (const secret of ['@ivanov_2007', '352253483', 'ivanov@gmail.com', 'token=abc']) {
    assert.ok(!params.includes(secret), `в базу уехало «${secret}»`);
  }
  // Имя человека, введённое кириллицей, чисткой не ловится — и это надо знать.
  // Поэтому в приёмке важно и то, что сообщения режутся по длине, и то, что
  // сюда попадает ТОЛЬКО message ошибки, а не состояние приложения.
  assert.equal(db.calls[0].params.length, 5, 'колонок ровно пять: отпечаток, текст, файл, релиз, платформа');
});

test('одинаковые ошибки схлопываются по отпечатку', async () => {
  const db = fakeDb();
  const payload = { message: 'Boom', source: '/app.js', release: 'r1' };
  const first = await recordClientError(payload, 'Android', { db });
  const second = await recordClientError(payload, 'Android', { db });
  assert.equal(first, second, 'один и тот же отпечаток');
  assert.match(db.calls[0].sql, /ON CONFLICT \(fingerprint\)[\s\S]*count = client_errors\.count \+ 1/,
    'иначе один сломанный экран у тысячи человек даст тысячу строк за минуту');
});

test('разные платформы разводятся по отдельным отпечаткам', async () => {
  const db = fakeDb();
  const payload = { message: 'Boom', source: '/app.js', release: 'r1' };
  const ios = await recordClientError(payload, 'iPhone', { db });
  const android = await recordClientError(payload, 'Android', { db });
  assert.notEqual(ios, android, 'баг может быть только на одной платформе — это надо видеть');
});

test('пустое сообщение не пишется вовсе', async () => {
  const db = fakeDb();
  assert.equal(await recordClientError({ message: '' }, 'x', { db }), null);
  assert.equal(db.calls.length, 0);
});

test('события с неизвестным именем отбрасываются', async () => {
  const db = fakeDb();
  const written = await recordEvents('u-1', [
    { name: 'app_open' },
    { name: 'выкачать_всё', props: { x: 1 } },
    { name: 'limit_reached' },
  ], { db });
  assert.equal(written, 2);
  assert.ok(!db.calls[0].params.includes('выкачать_всё'));
});

test('пачка событий ограничена сверху', async () => {
  const db = fakeDb();
  const many = Array.from({ length: 100 }, () => ({ name: 'app_open' }));
  assert.equal(await recordEvents('u-1', many, { db }), 20);
});
