'use strict';
// Страж /api/v1/teacher/contacts (кнопка «Написать» в кабинете учителя).
// Маршрут отдаёт @username учеников — контакт несовершеннолетнего. Отдавать
// его можно только учителю ЭТОЙ группы (или админу) и только username, без
// имени, фото и прочего из Telegram-профиля.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const start = src.indexOf("url.pathname === '/api/v1/teacher/contacts'");
const block = start < 0 ? '' : src.slice(start, src.indexOf('\n    }\n', start));

test('маршрут контактов есть', () => {
  assert.ok(block.length > 0, 'маршрут /api/v1/teacher/contacts не найден');
});

test('контакты только учителю своей группы или админу', () => {
  assert.match(block, /!ctx\.admin && \(!ctx\.teacher \|\| !ctx\.classes\.has\(classCode\)\)/);
  assert.match(block, /statusCode: 403/);
  assert.match(block, /!classCode \|\|/, 'пустой код группы не должен отдавать ничего');
});

test('наружу уходит только username, влитые дубли пропускаются', () => {
  assert.match(block, /profile->>'username'/);
  assert.doesNotMatch(block, /photo_url|first_name|last_name/);
  assert.match(block, /_mergedInto' IS NULL/);
  assert.match(block, /replace\(\/\[\^A-Za-z0-9_\]\/g, ''\)/, 'username чистится до символов Telegram-ника');
});
