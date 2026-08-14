'use strict';

// Заявка на роль учителя с сайта и выдача роли по почте.
//
// Зачем это появилось: заявка существовала только кнопкой в боте, а выдача
// шла по telegram id. Человек, вошедший через Google и не открывавший бота,
// был заперт с обеих сторон — и попросить роль нечем, и выдать её нечем.
// Бот при этом отвечал «ещё не открывал тренажёр», хотя человек занимался.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

test.after(() => pool.end());

const SRC = path.join(__dirname, '..', 'src', 'subjects', 'social');
const storeSource = fs.readFileSync(path.join(SRC, 'store.js'), 'utf8');
const routesSource = fs.readFileSync(path.join(SRC, 'routes.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

function body(name, source = storeSource) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `функция ${name} должна существовать`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('поиск по почте требует РОВНО одного кандидата', () => {
  const fn = body('whoIsByEmail');
  assert.ok(fn.includes('rowCount !== 1'), 'при нескольких совпадениях роль выдавать нельзя');
  assert.ok(fn.includes('lower(u.email) = $1') && fn.includes('lower(i.email) = $1'),
    'почта живёт и в аккаунте, и в личности провайдера');
  assert.ok(fn.includes('disabled_at IS NULL'), 'отключённый аккаунт не должен находиться');
  assert.ok(!/\$\{/.test(fn.replace(/`[^`]*`/g, match => match.replace(/\$\{[^}]*\}/g, ''))) || fn.includes('[needle]'),
    'почта уходит параметром, а не подстановкой в текст запроса');
});

test('заявка не будит админов повторно и не выдаётся учителю', () => {
  const fn = body('requestTeacherRole');
  assert.ok(fn.includes("return { status: 'already'"), 'у учителя и админа заявки быть не может');
  assert.ok(fn.includes("status IN ('pending', 'processing')"), 'повторная заявка должна схлопываться');
  assert.ok(fn.includes("kind = 'teacher_request'"), 'дедупликация обязана смотреть только на заявки');
  assert.ok(fn.includes("return { status: 'no_admins' }"), 'без админов заявку принимать нечестно');
});

test('заявка кладётся в очередь по одному заданию на админа', () => {
  const fn = body('requestTeacherRole');
  assert.ok(fn.includes('INSERT INTO social_notification_jobs'), 'доставку делает бот через общую очередь');
  assert.ok(!fn.includes('unnest('), 'unnest после FROM проверка изоляции читает как таблицу');
  assert.ok(fn.includes('FROM (VALUES'), 'получатели разворачиваются в VALUES');
  assert.ok(fn.includes('...admins'), 'адреса уходят параметрами');
  // user_id = заявитель: получателя-админа в app_users может не быть вовсе.
  assert.ok(fn.includes('$1, list.admin'), 'в задании заявитель и получатель — разные поля');
});

test('заявку не принимают у гостя', () => {
  const start = routesSource.indexOf("path === '/me/teacher-request'");
  assert.notEqual(start, -1, 'маршрут заявки должен существовать');
  const chunk = routesSource.slice(start, start + 900);
  assert.ok(chunk.includes('requireMutationAuth'), 'заявка — мутация и обязана проходить CSRF');
  assert.ok(chunk.includes('session.user.isAnonymous') && chunk.includes('sign_in_required'),
    'гость исчезает вместе с браузером, а классы его переживут');
  assert.ok(chunk.includes('env.adminTelegramIds'), 'получатели берутся из настройки сервера, а не из запроса');
});

test('профиль сообщает, какие способы входа привязаны', () => {
  assert.ok(routesSource.includes("item.provider === 'google'"), 'клиент должен знать про Google');
  assert.ok(routesSource.includes("item.provider === 'telegram'"), 'клиент должен знать про Telegram');
  assert.ok(routesSource.includes('hasGoogle:') && routesSource.includes('hasTelegram:'),
    'по одному isAnonymous «телеграм + гугл» и «только телеграм» неразличимы');
});

test('внутренняя выдача роли принимает почту наравне с telegram id', () => {
  const start = serverSource.indexOf("'/internal/v1/subjects/social/roles'");
  assert.notEqual(start, -1);
  const chunk = serverSource.slice(start, start + 1400);
  assert.ok(chunk.includes('whoIsByEmail'), 'без поиска по почте google-аккаунт роль не получит');
  assert.ok(chunk.indexOf('body.userId') < chunk.indexOf('body.telegramId'),
    'явный идентификатор имеет приоритет над поиском');
  assert.ok(chunk.includes('user_not_found'), 'ненайденный аккаунт обязан давать 404, а не тихий успех');
});
