'use strict';

// Разбор домашки по одному ученику: что именно он решал, что не вышло и
// сколько это заняло.
//
// Почему тест по исходникам. Опасность здесь не в падении, а в РАСХОЖДЕНИИ:
// разбор и колонка «Баллы» считают одно и то же двумя разными запросами. Стоит
// одному из них отстать — учитель увидит «12 вопросов» в таблице и десять строк
// в разборе, и оба числа будут выглядеть правдоподобно. Поэтому здесь
// закреплено, что выборка разбора повторяет правило зачёта дословно.

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

function body(name) {
  const start = storeSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `функция ${name} должна существовать`);
  const next = storeSource.indexOf('\nasync function ', start + 1);
  return storeSource.slice(start, next === -1 ? storeSource.length : next);
}

test('разбор берёт первую попытку по заданию, как и пересчёт домашки', () => {
  const detail = body('assignmentStudentDetail');
  const recompute = body('recomputeAssignment');
  for (const rule of [
    'DISTINCT ON (e.task_id)',
    'ORDER BY e.task_id, e.attempted_at',
    'e.attempted_at >= $',
  ]) {
    assert.ok(recompute.includes(rule), `пересчёт обязан содержать ${rule}`);
    assert.ok(detail.includes(rule), `разбор обязан содержать ${rule}`);
  }
});

test('разбор применяет те же фильтры домашки, что и зачёт', () => {
  const detail = body('assignmentStudentDetail');
  for (const filter of [
    'e.task_type = ANY(',
    'e.block_ids && ',
    'e.topic_codes && ',
    'e.has_images = false',
    'e.task_id = ANY(',
  ]) {
    assert.ok(detail.includes(filter), `разбор обязан фильтровать по ${filter}`);
  }
});

test('разбор доступен только владельцу задания и только по своему ученику', () => {
  const detail = body('assignmentStudentDetail');
  // ownedAssignment бросает, если домашка не принадлежит учителю.
  assert.ok(detail.includes('await ownedAssignment(teacherUserId, assignmentId'),
    'право на домашку обязано проверяться до всякой выборки');
  assert.ok(detail.includes('social_class_members') && detail.includes("m.status = 'active'"),
    'ученик обязан состоять в классе этой домашки');
  assert.ok(detail.includes('student_not_found'), 'посторонний ученик обязан давать 404, а не пустой разбор');
});

test('разбор отдаёт время и правильность по каждому заданию', () => {
  const detail = body('assignmentStudentDetail');
  for (const field of ['e.elapsed_ms', 'e.correct', 'e.attempted_at', 'e.exam_line', 'e.topic_codes']) {
    assert.ok(detail.includes(field), `разбор обязан возвращать ${field}`);
  }
  assert.ok(detail.includes('medianMs'), 'нужна медиана: одна забытая вкладка ломает среднее');
  assert.ok(!/avgMs|averageMs/.test(detail), 'среднее время по заданиям не показываем');
});

test('разбор не трогает таблиц истории', () => {
  const detail = body('assignmentStudentDetail');
  const tables = [...detail.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)].map(match => match[1].toLowerCase());
  const allowed = new Set(['social_class_members', 'social_profiles', 'social_attempt_events']);
  for (const table of tables) {
    assert.ok(allowed.has(table), `разбор обращается к посторонней таблице: ${table}`);
  }
});

test('маршрут разбора отдельный и разбирает оба идентификатора', () => {
  assert.ok(routesSource.includes('const detailMatch = path.match('), 'нужен отдельный маршрут разбора');
  assert.ok(routesSource.includes("uuid(decodeURIComponent(detailMatch[1]), 'assignment_not_found')"));
  assert.ok(routesSource.includes("uuid(decodeURIComponent(detailMatch[2]), 'student_not_found')"));
  assert.ok(routesSource.includes('store.assignmentStudentDetail(userId, assignmentId, studentId'),
    'маршрут обязан передавать учителя из сессии, а не из запроса');
});

// 🔴 Тест того же класса, что поймал 08P01 в заявке на учителя: сверяем число
// плейсхолдеров с числом параметров, собирая запрос по-настоящему. Строковая
// проверка «в запросе есть given_answer» пропустила бы сдвиг нумерации.
test('вставка попытки: плейсхолдеров ровно столько же, сколько параметров', async () => {
  const store = require('../src/subjects/social/store');
  const seen = [];
  const client = {
    async query(text, params) {
      seen.push({ text, params });
      return { rowCount: 1, rows: [{ event_id: 'e1' }] };
    },
  };
  const event = {
    eventId: 'e1', taskId: 'fipi-1', taskType: 'choice', blockIds: ['1'], topicCodes: ['1.1'],
    hasImages: false, correct: false, earned: 0, possible: 2, elapsedMs: 1000,
    kind: 'homework', examLine: 5, attemptedAt: Date.now(),
    mskDay: '2026-08-15', weekStart: '2026-08-10', givenAnswer: '134',
  };
  const accepted = await store.insertEvents(client, '11111111-1111-1111-1111-111111111111', [event]);
  assert.equal(accepted.length, 1, 'событие должно приняться');

  const insert = seen.find(call => /INSERT INTO social_attempt_events/.test(call.text));
  assert.ok(insert, 'вставка обязана случиться');
  const placeholders = new Set(insert.text.match(/\$\d+/g) || []);
  assert.equal(placeholders.size, insert.params.length,
    'у каждого параметра обязан быть свой плейсхолдер, иначе Postgres ответит 08P01');
  assert.ok(insert.params.includes('134'), 'ответ ученика обязан уехать в базу');
});

test('разбор отдаёт ответ ученика', () => {
  const fn = storeSource.slice(storeSource.indexOf('async function assignmentStudentDetail('));
  assert.ok(fn.includes('e.given_answer'), 'ответ обязан выбираться из события');
  assert.ok(fn.includes('givenAnswer: row.given_answer'), 'и доезжать до кабинета');
});
