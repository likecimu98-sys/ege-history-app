'use strict';

// Вход должен возвращаться на ТОТ ЖЕ хост, с которого ушёл.
//
// Почему это отдельный тест. Кука сессии принадлежит хосту, который её выдал.
// Пока приложение было одно, адрес возврата спокойно жил константой; с
// появлением обществознания на отдельном поддомене эта константа стала тихой
// поломкой: ученик уходит с obschestvo.*, Google возвращает его на
// reshay-istoriyu.ru, кука ложится туда — и на обществознании он по-прежнему не
// вошёл. Ошибки при этом не видно НИГДЕ: страница открывается, просто вход не
// сработал.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.PUBLIC_ORIGIN = 'https://reshay-istoriyu.ru';
process.env.GOOGLE_REDIRECT_URI = 'https://reshay-istoriyu.ru/api/v1/auth/google/callback';
process.env.SOCIAL_ORIGINS = 'https://obschestvo.reshay-istoriyu.ru';

const test = require('node:test');
const assert = require('node:assert/strict');
const { originForRequest, googleRedirectUri } = require('../src/auth');
const { pool } = require('../src/db');

test.after(() => pool.end());

const request = host => ({ headers: host ? { host } : {} });

test('возврат идёт на хост запроса, если он разрешён', () => {
  assert.equal(originForRequest(request('obschestvo.reshay-istoriyu.ru')), 'https://obschestvo.reshay-istoriyu.ru');
  assert.equal(originForRequest(request('reshay-istoriyu.ru')), 'https://reshay-istoriyu.ru');
});

test('чужой Host не уводит OAuth-возврат на чужой адрес', () => {
  // Host приходит от клиента. Без проверки по закрытому списку подделанный
  // заголовок увёл бы и код авторизации, и сессию.
  for (const evil of ['evil.com', 'obschestvo.reshay-istoriyu.ru.evil.com', 'reshay-istoriyu.ru:8443', '']) {
    assert.equal(originForRequest(request(evil)), 'https://reshay-istoriyu.ru', `принят чужой Host: ${evil}`);
  }
});

test('адрес возврата Google совпадает с хостом запроса', () => {
  assert.equal(googleRedirectUri(request('obschestvo.reshay-istoriyu.ru')),
    'https://obschestvo.reshay-istoriyu.ru/api/v1/auth/google/callback');
  // У истории адрес берётся из настройки дословно: в консоли Google может быть
  // указан путь, отличный от нашего шаблона, и переписывать его нельзя.
  assert.equal(googleRedirectUri(request('reshay-istoriyu.ru')), process.env.GOOGLE_REDIRECT_URI);
  assert.equal(googleRedirectUri(request('evil.com')), process.env.GOOGLE_REDIRECT_URI);
});

test('оба адреса возврата обязаны быть зарегистрированы в консоли Google', () => {
  // Тест-напоминание: redirect_uri сверяется Google дословно, и незарегистрированный
  // адрес даёт redirect_uri_mismatch — вход просто не работает.
  const uris = [
    googleRedirectUri(request('reshay-istoriyu.ru')),
    googleRedirectUri(request('obschestvo.reshay-istoriyu.ru')),
  ];
  assert.equal(new Set(uris).size, 2, 'у двух хостов должны быть два разных адреса возврата');
  for (const uri of uris) assert.match(uri, /^https:\/\/[^/]+\/api\/v1\/auth\/google\/callback$/);
});
