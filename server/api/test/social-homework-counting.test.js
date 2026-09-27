'use strict';

// Кому принадлежит ответ ученика.
//
// Домашка считалась по фильтрам: любой подходящий ответ шёл в зачёт КАЖДОМУ
// активному заданию, чьим блокам и темам он соответствовал. 20.08.2026 это
// вылезло числами, которые невозможно объяснить: у ученицы домашка с целью
// 20 вопросов показывала «36 отвечено». Она решила 25 заданий в окне первой
// домашки и 17 — в окне второй; шесть совпали, и всё вместе записалось обеим.
// Первая была сдана ещё 16-го и продолжала расти неделю спустя.
//
// Здесь проверяются два правила, которые это закрывают:
//   * ответ, данный ВНУТРИ домашки, принадлежит ей одной; свободная тренировка
//     по-прежнему засчитывается всякой подходящей — иначе ученик решал бы по
//     теме и не понимал, почему счётчик стоит;
//   * сданная домашка замирает целиком, вместе с баллом.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../src/subjects/social/schema');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');
const PROGRESS_READ = 'FROM social_assignment_progress WHERE assignment_id';
const assignmentOf = goal => ({
  id: 'a-1', question_goal: goal, issued_at: new Date(),
  types: [], blocks: [], topics: [], include_images: false, task_ids: [],
});

// ------------------------------------------------------------- заморозка --

test('сданная домашка больше не пересчитывается', async () => {
  // 🔴 «36 из 20» выглядит поломкой счёта, а не усердием. Сданная работа обязана
  // замереть вместе с баллом: иначе оценка за сданное менялась бы задним числом.
  const done = {
    rowCount: 1,
    rows: [{ earned: 18, possible: 20, questions: 20, status: 'done', completed_at: new Date('2026-08-16T12:00:00Z') }],
  };
  const calls = [];
  const client = {
    query: async text => {
      calls.push(text);
      if (text.includes(PROGRESS_READ)) return done;
      return { rowCount: 0, rows: [] };
    },
  };
  const progress = await store.recomputeAssignment(client, assignmentOf(20), 'student-1');
  assert.equal(progress.questions, 20, 'число ответов осталось тем, каким было на сдаче');
  assert.equal(progress.earned, 18, 'и балл тоже');
  assert.equal(progress.justCompleted, false, 'сдана она была раньше — уведомление уже ушло');
  assert.ok(!calls.some(text => text.includes('INSERT INTO social_assignment_progress')),
    'пересчёта не было вовсе, а не «был, но с тем же результатом»');
});

test('незавершённая домашка считается дальше', async () => {
  // Обратная сторона заморозки: пока цель не достигнута, каждая попытка обязана
  // двигать счётчик. Иначе правило «сданное замирает» превратилось бы в
  // «домашка не считается никогда».
  const calls = [];
  const client = {
    query: async text => {
      calls.push(text);
      if (text.includes(PROGRESS_READ)) {
        return { rowCount: 1, rows: [{ earned: 4, possible: 6, questions: 3, status: 'active', completed_at: null }] };
      }
      if (text.includes('INSERT INTO social_assignment_progress')) {
        return { rowCount: 1, rows: [{ earned: 6, possible: 8, questions: 4, status: 'active', completed_at: null }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const progress = await store.recomputeAssignment(client, assignmentOf(20), 'student-1');
  assert.equal(progress.questions, 4, 'счётчик двигается');
  assert.ok(calls.some(text => text.includes('INSERT INTO social_assignment_progress')), 'пересчёт состоялся');
});

// --------------------------------------------------------- принадлежность --

// 🔴 Правило «что зачтено этой домашке» состоит из трёх частей: ответ дан
// ПОСЛЕ выдачи, подходит под выборку работы и не принадлежит другой домашке.
// Оно живёт в countedAttemptSql — одно на всех, кто его спрашивает.
//
// Пока части были выписаны по местам, третья попала только в пересчёт: разбор
// у учителя показывал задания, которых балл не считал. На проде это не
// теория — 10 639 ответов лежат внутри какой-нибудь домашки, а пар работ,
// делящих класс, 370.
test('правило зачёта написано ОДИН раз и содержит все три части', () => {
  const start = storeSource.indexOf('function countedAttemptSql(');
  assert.notEqual(start, -1, 'правило вынесено в отдельную функцию');
  const rule = storeSource.slice(start, storeSource.indexOf('\n}', start));
  assert.match(rule, /e\.attempted_at >= \$\{issued\}/, 'ответ дан после выдачи');
  assert.match(rule, /attemptPoolSql\(\{/, 'ответ подходит под выборку работы');
  assert.match(rule, /e\.assignment_id IS NULL OR e\.assignment_id = \$\{assignment\}/,
    'ответ не принадлежит другой домашке');
});

test('все, кто считает зачтённое, зовут общее правило', () => {
  // Пересчёт задаёт баллы, разбор объясняет их учителю, список зачтённого
  // уезжает клиенту, а подборка трудных заданий показывает те же ответы
  // с другой стороны. Разойтись им нельзя ни в одной части.
  for (const fn of ['recomputeAssignment', 'assignmentStudentDetail',
    'studentAssignments', 'assignmentResults']) {
    const start = storeSource.indexOf(`async function ${fn}(`);
    assert.notEqual(start, -1, `функция ${fn} должна существовать`);
    const next = storeSource.indexOf('\nasync function ', start + 1);
    const block = storeSource.slice(start, next === -1 ? storeSource.length : next);
    assert.match(block, /countedAttemptSql\(\{/, `${fn} обязана звать общее правило, а не писать своё`);
  }
  // И ни у кого не должно остаться собственной копии третьей части.
  const copies = storeSource.split('e.assignment_id IS NULL OR e.assignment_id').length - 1;
  assert.equal(copies, 1, `условие принадлежности написано ${copies} раз вместо одного`);
});

test('принадлежность события пишется в базу', () => {
  assert.match(storeSource, /given_answer, assignment_id\)/);
  assert.match(storeSource, /event\.assignmentId \|\| null/);
});

test('кривой id домашки не роняет пачку ответов', () => {
  // Потерять сотню ответов из-за одного испорченного поля хуже, чем потерять
  // принадлежность одного ответа.
  const broken = schema.attemptEvent({
    eventId: 'abcdefghijklmnop', taskId: 'ABC123', earned: 1, possible: 1, assignmentId: 'не-uuid',
  });
  assert.equal(broken.assignmentId, '', 'принадлежность теряется, а ответ сохраняется');
  const good = schema.attemptEvent({
    eventId: 'abcdefghijklmnop', taskId: 'ABC123', earned: 1, possible: 1,
    assignmentId: '11111111-2222-3333-4444-555555555555',
  });
  assert.equal(good.assignmentId, '11111111-2222-3333-4444-555555555555');
  const absent = schema.attemptEvent({ eventId: 'abcdefghijklmnop', taskId: 'ABC123', earned: 1, possible: 1 });
  assert.equal(absent.assignmentId, '', 'свободная тренировка остаётся без принадлежности');
});

// ------------------------------------------------------------- миграция --

test('миграция принадлежности не приписывает прошлую работу никакой домашке', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '012_social_attempt_assignment.sql'), 'utf8');
  for (const [, table] of sql.matchAll(/ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(table.startsWith('social_'), `изменяется непредметная таблица ${table}`);
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS assignment_id uuid/);
  // 🔴 Ни NOT NULL, ни DEFAULT: у событий, записанных до миграции,
  // принадлежности нет и взяться ей неоткуда. Значение по умолчанию приписало бы
  // всю прошлую работу одной домашке.
  assert.ok(!/assignment_id uuid[^;]*NOT NULL/.test(sql), 'колонка обязана оставаться nullable');
  assert.ok(!/assignment_id uuid[^;]*DEFAULT/.test(sql), 'и без значения по умолчанию');
  // Удалённая домашка не должна уносить историю попыток: по тем же событиям
  // считаются баллы ученика и недельный рейтинг.
  assert.match(sql, /ON DELETE SET NULL/);
  assert.ok(!/DROP\s+(TABLE|COLUMN)/i.test(sql), 'миграция не удаляет ни таблиц, ни колонок');
  assert.equal((sql.match(/DROP CONSTRAINT IF EXISTS/g) || []).length,
    (sql.match(/ADD CONSTRAINT/g) || []).length,
    'каждое ограничение снимается перед добавлением, иначе повторный прогон падает');
});
