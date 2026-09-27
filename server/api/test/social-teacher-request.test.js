'use strict';

// Роль учителя: человек берёт её сам, и мы знаем, откуда он пришёл.
//
// Зачем это появилось: роль выдавал администратор кнопкой в боте, то есть
// третьим шагом воронки стояло «подождите». На 27.09.2026 из 99 учителей класс
// завели 59, домашку выдали 38, а приходит учитель вечером накануне урока — к
// утру он уже задал по-другому. Заодно закрыта старая дыра: выдача шла по
// telegram id, и вошедший через Google был заперт с обеих сторон.

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

// 🔴 База общая с историей: одна и та же почта живёт в обоих предметах, и на
// общей выборке «ровно один кандидат» превращается в двух. Роль тогда не
// получал никто, хотя в обществознании такой человек ровно один.
test('поиск по почте сначала смотрит на учеников обществознания', () => {
  const fn = body('whoIsByEmail');
  assert.ok(fn.includes('socialOnly'), 'у поиска должно быть два прохода: по предмету и по всем');
  assert.ok(fn.includes("socialOnly ? 'JOIN' : 'LEFT JOIN'"),
    'предметный проход обязан отсекать аккаунты без профиля обществознания');
  assert.ok(/lookup\(true\)[\s\S]*lookup\(false\)/.test(fn),
    'предметный проход идёт ПЕРВЫМ, общий остаётся запасным');
});

// 🔴 Главный инвариант новой выдачи: отсутствие админов больше НЕ повод
// отказать. Раньше без списка админов заявка возвращала 'no_admins' — то есть
// роль зависела от того, настроен ли чат уведомлений. Теперь уведомление это
// побочный эффект, а не условие.
test('роль выдаётся сразу и не зависит от списка админов', () => {
  const fn = body('claimTeacherRole');
  assert.ok(fn.includes("return { status: 'already'"), 'у учителя и админа роль уже есть');
  assert.ok(!fn.includes("'no_admins'"), 'без админов роль всё равно обязана выдаваться');
  assert.ok(fn.includes('INSERT INTO social_profiles'), 'роль ставится здесь, а не отложенной заявкой');
  assert.ok(fn.includes("role = 'teacher'"), 'выдаётся именно учитель');
  assert.ok(!fn.includes("kind = 'teacher_request'"), 'ждать одобрения больше нечего');
});

// Профиля может не быть вовсе: строка в social_profiles появляется при первом
// сохранении настроек, а роль просит и тот, кто их не открывал ни разу.
test('роль выдаётся и тому, у кого ещё нет профиля', () => {
  const fn = body('claimTeacherRole');
  assert.ok(fn.includes('ON CONFLICT (user_id) DO UPDATE'), 'вставка с обновлением, а не UPDATE');
  assert.ok(fn.includes('INSERT INTO social_profiles(user_id, display_name, role, role_source'),
    'вставка обязана создавать строку, если её нет');
});

// 🔴 Кто пригласил — записывается ОДИН раз. Иначе повторный заход по чужой
// ссылке переписывал бы источник, и отчёт о каналах показывал бы последнюю
// ссылку вместо той, по которой человек на самом деле пришёл.
test('пригласивший не переписывается второй ссылкой', () => {
  const fn = body('claimTeacherRole');
  assert.ok(fn.includes('COALESCE(social_profiles.invited_by_user_id, EXCLUDED.invited_by_user_id)'),
    'первый пригласивший остаётся навсегда');
});

test('пригласить самого себя нельзя', () => {
  const fn = body('claimTeacherRole');
  assert.ok(fn.includes('String(found.userId) !== String(userId)'),
    'свой собственный код не должен считаться каналом');
});

test('источник роли ограничен закрытым перечнем', () => {
  assert.ok(storeSource.includes("TEACHER_ROLE_SOURCES = Object.freeze(['manual', 'self', 'invite'])"),
    'перечень источников закрыт и объявлен один раз');
  const fn = body('claimTeacherRole');
  assert.ok(fn.includes('TEACHER_ROLE_SOURCES.includes(source)'), 'чужое значение источника не должно попадать в базу');
  assert.ok(fn.includes("roleSource = inviter ? 'invite'"), 'пришедший по ссылке всегда записывается как invite');
});

// 🔴 Код приглашения коллеги и код класса ходят по одним и тем же учительским
// чатам. Разная длина — это не украшение: перепутавший их должен упереться в
// отказ, а не вступить учеником в собственный класс.
test('код приглашения отличается по длине от кода класса', () => {
  assert.ok(storeSource.includes('TEACHER_INVITE_CODE_LENGTH = 10'), 'код коллеги — десять символов');
  const classCode = storeSource.slice(storeSource.indexOf('function randomJoinCode('), storeSource.indexOf('function randomJoinCode(') + 220);
  assert.ok(/crypto\.randomBytes\(8\)/.test(classCode), 'код класса — восемь символов, и это единственное, что их разводит');
  const inviteCode = storeSource.slice(storeSource.indexOf('function randomInviteCode('), storeSource.indexOf('function randomInviteCode(') + 220);
  assert.ok(/crypto\.randomBytes\(TEACHER_INVITE_CODE_LENGTH\)/.test(inviteCode), 'длина кода коллеги берётся из константы');
});

test('чужой и несуществующий код приглашения неразличимы', () => {
  const fn = body('resolveTeacherInvite');
  assert.ok(fn.includes("p.role IN ('teacher', 'admin')"), 'код ученика не должен работать');
  assert.ok(fn.includes('disabled_at IS NULL'), 'удалённый учитель не приглашает');
  assert.ok(fn.includes('return null'), 'ответ один и тот же на любой неподходящий код');
  const route = routesSource.slice(routesSource.indexOf("path === '/teacher-invite'"));
  assert.ok(route.includes('valid: Boolean(inviter)') && route.includes('200'),
    'маршрут отвечает 200 и пустым именем, а не 404 — иначе по нему перебирают учителей');
});

// 🔴 Этот тест появился после того, как заявка с сайта падала с 500 ВСЕГДА, с
// первого дня: строка собирала «VALUES (3)» — число вместо плейсхолдера $3.
// Postgres находил в запросе два параметра, получал три и отвечал 08P01.
// Проверка по тексту запроса («есть FROM (VALUES») этого не видела, поэтому
// здесь запрос собирается по-настоящему и сверяется с числом параметров.
test('уведомление админам получает ровно столько параметров, сколько плейсхолдеров', async () => {
  const store = require('../src/subjects/social/store');
  const seen = [];
  const db = {
    async query(text, params) {
      seen.push({ text, params });
      if (/FROM app_users/.test(text)) {
        return { rowCount: 1, rows: [{ display_name: 'Тест', email: 'a@example.com', role: 'student', has_telegram: false }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const result = await store.claimTeacherRole('11111111-1111-1111-1111-111111111111', ['111', '222'], { db });
  assert.equal(result.status, 'granted', 'роль обязана выдаваться сразу');
  assert.equal(result.role, 'teacher');
  assert.equal(result.source, 'self', 'без кода приглашения источник — «взял сам»');

  const profile = seen.find(call => /INSERT INTO social_profiles/.test(call.text));
  assert.ok(profile, 'роль должна быть записана');

  const insert = seen.find(call => /INSERT INTO social_notification_jobs/.test(call.text));
  assert.ok(insert, 'админ обязан узнать о новом учителе');
  assert.ok(insert.text.includes("'teacher_granted'"), 'это уведомление о факте, а не вопрос');
  const placeholders = new Set(insert.text.match(/\$\d+/g) || []);
  assert.equal(placeholders.size, insert.params.length,
    'у каждого параметра обязан быть свой плейсхолдер, иначе Postgres отвечает 08P01');
  assert.ok(/VALUES \(\$\d/.test(insert.text), 'в VALUES стоят плейсхолдеры, а не числа');
  assert.ok(!insert.text.includes('unnest('), 'unnest после FROM проверка изоляции читает как таблицу');
  assert.deepEqual(insert.params.slice(2), ['111', '222'], 'получатели уходят параметрами');
});

test('учителю роль второй раз не выдаётся', async () => {
  const store = require('../src/subjects/social/store');
  const seen = [];
  const db = {
    async query(text) {
      seen.push(text);
      if (/FROM app_users/.test(text)) {
        return { rowCount: 1, rows: [{ display_name: 'Учитель', email: '', role: 'teacher', has_telegram: true }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const result = await store.claimTeacherRole('22222222-2222-2222-2222-222222222222', ['111'], { db });
  assert.equal(result.status, 'already');
  assert.ok(!seen.some(text => /INSERT INTO social_profiles/.test(text)), 'повторная запись роли не нужна');
  assert.ok(!seen.some(text => /social_notification_jobs/.test(text)), 'админа незачем будить второй раз');
});

test('роль не берут у гостя', () => {
  const start = routesSource.indexOf("path === '/me/teacher-request'");
  assert.notEqual(start, -1, 'маршрут обязан остаться на прежнем адресе — его зовут выкаченные клиенты');
  const chunk = routesSource.slice(start, start + 900);
  assert.ok(chunk.includes('requireMutationAuth'), 'выдача роли — мутация и обязана проходить CSRF');
  assert.ok(chunk.includes('session.user.isAnonymous') && chunk.includes('sign_in_required'),
    'гость исчезает вместе с браузером, а классы его переживут');
  assert.ok(chunk.includes('env.adminTelegramIds'), 'получатели берутся из настройки сервера, а не из запроса');
  assert.ok(chunk.includes('claimTeacherRole'), 'маршрут выдаёт роль, а не создаёт заявку');
});

// Выдача администратором обязана оставаться отличимой от самостоятельной:
// иначе отчёт о каналах запишет ручную выдачу в успехи ссылки.
test('выдача администратором помечается как manual', () => {
  const fn = body('setRole');
  assert.ok(fn.includes("COALESCE(role_source, 'manual')"), 'ручная выдача записывает свой источник');
  assert.ok(fn.includes('COALESCE(role_granted_at, now())'), 'момент выдачи не переписывается повторной командой');
  assert.ok(fn.includes("role === 'teacher' || role === 'admin'"), 'источник пишем только при выдаче роли, но не при снятии');
});

test('код приглашения переживает слияние аккаунтов', () => {
  assert.ok(storeSource.includes('UPDATE social_profiles SET invite_code = NULL'),
    'у второго аккаунта код снимается — иначе уникальный индекс не даст перенести');
  assert.ok(/WITH taken AS \([\s\S]{0,400}invite_code = \(SELECT invite_code FROM taken\)/.test(storeSource),
    'код переносится на основной аккаунт: ссылка уже разослана по чатам');
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
  const chunk = serverSource.slice(start, start + 2400);
  assert.ok(chunk.includes('whoIsByEmail'), 'без поиска по почте google-аккаунт роль не получит');
  assert.ok(chunk.indexOf('body.userId') < chunk.indexOf('body.telegramId'),
    'явный идентификатор имеет приоритет над поиском');
  assert.ok(chunk.includes('user_not_found'), 'ненайденный аккаунт обязан давать 404, а не тихий успех');
  assert.ok(chunk.includes('claimTeacherRole'), 'бот обязан уметь выдать роль по ссылке коллеги');
  assert.ok(chunk.includes("body.source === 'self' || body.source === 'invite'"),
    'самостоятельная выдача отличается от административной по источнику');
});

test('кабинет получает код приглашения вместе со списком классов', () => {
  const start = routesSource.indexOf("path === '/teacher/classes'");
  const chunk = routesSource.slice(start, start + 700);
  assert.ok(chunk.includes('teacherInviteCode'), 'код едет тем же запросом, что и классы');
  assert.ok(chunk.includes('inviteCode'), 'поле обязано попасть в ответ');
});
