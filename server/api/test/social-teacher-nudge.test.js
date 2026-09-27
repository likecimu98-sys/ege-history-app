'use strict';

// Напоминание учителю, который взял роль и остановился.
//
// Зачем это появилось: на 27.09.2026 из 99 учителей класс завели 59, а домашку
// выдали 38. Роль сама по себе не даёт ничего — работа начинается с первой
// выданной домашки, и именно до неё человек чаще всего не доходит.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

test.after(() => pool.end());

const SRC = path.join(__dirname, '..', 'src', 'subjects', 'social');
const storeSource = fs.readFileSync(path.join(SRC, 'store.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

function body(name) {
  const start = storeSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `функция ${name} должна существовать`);
  const next = storeSource.indexOf('\nasync function ', start + 1);
  return storeSource.slice(start, next === -1 ? storeSource.length : next);
}

test('напоминание уходит только учителю без единой домашки', () => {
  const fn = body('enqueueTeacherNudges');
  assert.ok(fn.includes("p.role = 'teacher'"), 'ученику это сообщение не адресовано');
  assert.ok(/NOT EXISTS \(SELECT 1 FROM social_assignments a WHERE a\.teacher_user_id = p\.user_id\)/.test(fn),
    'выдавшему хотя бы одну домашку напоминать не о чем');
  assert.ok(fn.includes("i.provider = 'telegram'"), 'без Telegram написать некуда');
  assert.ok(fn.includes('disabled_at IS NULL'), 'удалённому аккаунту не пишем');
});

// 🔴 Самое тонкое место. role_granted_at появился только в миграции 015, и у
// всех выданных до неё ролей он пуст. Без COALESCE условие «роль старше суток»
// отсекло бы ВСЕХ прежних учителей — то есть ровно тех 61, ради кого
// напоминание и писалось, — и выглядело бы это как «никого не нашлось».
test('учителя, получившие роль до миграции, попадают в выборку', () => {
  const fn = body('enqueueTeacherNudges');
  assert.ok(fn.includes('COALESCE(p.role_granted_at, p.created_at)'),
    'у ролей, выданных до миграции 015, момент выдачи пуст');
  assert.ok((fn.match(/COALESCE\(p\.role_granted_at, p\.created_at\)/g) || []).length >= 2,
    'и в условии, и в порядке — иначе сортировка по пустому полю перемешает очередь');
});

test('сообщение уходит ровно один раз за всё время', () => {
  const fn = body('enqueueTeacherNudges');
  assert.ok(fn.includes("'nudge:teach:' || p.user_id"), 'ключ повтора строится на самом учителе');
  assert.ok(fn.includes('ON CONFLICT (dedup_key)'), 'повторный тик не должен слать второе письмо');
  assert.ok(!fn.includes("'nudge:start:'"), '🔴 ключ ученика и ключ учителя не должны совпадать: одному человеку положены оба');
  assert.ok(fn.includes('$1'), 'выдержка после выдачи роли — параметр, а не константа в тексте');
});

// 🔴 У кого нет класса, тому нельзя советовать выдать домашнее задание: выдавать
// некому, и совет читается как невнимательность. Положение различается здесь, а
// текст выбирает бот.
test('положение учителя различается: нет класса или нет домашки', () => {
  const fn = body('enqueueTeacherNudges');
  assert.ok(fn.includes("CASE WHEN cls.class_id IS NULL THEN 'no_class' ELSE 'no_homework' END"),
    'без класса и без домашки — разные советы');
  assert.ok(fn.includes("'students'"), 'пустой класс от собранного отличается числом учеников');
  assert.ok(fn.includes("c.status = 'active'"), 'убранный в архив класс не считается');
});

test('маршрут ставит в очередь оба напоминания и считает их отдельно', () => {
  const start = serverSource.indexOf("'/internal/v1/subjects/social/nudges'");
  assert.notEqual(start, -1);
  const chunk = serverSource.slice(start, start + 1200);
  assert.ok(chunk.includes('enqueueStartNudges') && chunk.includes('enqueueTeacherNudges'),
    'бот зовёт маршрут одним тиком, значит оба напоминания ставятся здесь');
  assert.ok(chunk.includes('students,') && chunk.includes('teachers'),
    'по общему числу не понять, кому ушло — счётчики обязаны быть раздельными');
});

test('очередь получает столько параметров, сколько плейсхолдеров', async () => {
  const store = require('../src/subjects/social/store');
  const seen = [];
  const db = { async query(text, params) { seen.push({ text, params }); return { rowCount: 3, rows: [] }; } };
  const queued = await store.enqueueTeacherNudges({ db, limit: 40 });
  assert.equal(queued, 3, 'функция возвращает число поставленных задач');
  const call = seen[0];
  const placeholders = new Set(call.text.match(/\$\d+/g) || []);
  assert.equal(placeholders.size, call.params.length, 'иначе Postgres отвечает 08P01');
  assert.equal(call.params[1], 40, 'ограничение пачки доезжает до запроса');
});

test('размер пачки ограничен сверху', async () => {
  const store = require('../src/subjects/social/store');
  const seen = [];
  const db = { async query(text, params) { seen.push(params); return { rowCount: 0, rows: [] }; } };
  await store.enqueueTeacherNudges({ db, limit: 100000 });
  assert.ok(seen[0][1] <= 200, 'одним тиком нельзя разослать всю базу');
});
