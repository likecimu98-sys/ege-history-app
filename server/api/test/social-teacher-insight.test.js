'use strict';

// Кабинет учителя: сводка по классу, карточка ученика и «что валит класс».
//
// Все три отвечают на вопросы, ради которых кабинет и открывают, и все три
// раньше требовали от учителя ручной работы: чтобы узнать, сколько работ сдал
// ученик, надо было открыть каждую домашку по очереди и найти в ней его строку.
// На шести работах это шесть запросов и шесть прокруток — поэтому этого не
// делал никто, и «кто отстаёт» оставалось без ответа.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const root = path.join(__dirname, '..');
const src = path.join(root, 'src', 'subjects', 'social');
const storeSource = fs.readFileSync(path.join(src, 'store.js'), 'utf8');
const routesSource = fs.readFileSync(path.join(src, 'routes.js'), 'utf8');

const TEACHER = '11111111-1111-1111-1111-111111111111';
const CLASS = '22222222-2222-2222-2222-222222222222';
const STUDENT = '33333333-3333-3333-3333-333333333333';

// Подставное соединение: отвечает по первому совпадению и ведёт журнал запросов.
function fakeDb(answers) {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      log.push({ sql: flat, params });
      for (const [needle, rows] of answers) {
        if (flat.includes(needle)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const OWNED = ['FROM social_classes WHERE id', [{ id: CLASS, teacher_user_id: TEACHER, status: 'active', backfill: 'undue' }]];

// ------------------------------------------------- сводка по классу ---

test('список учеников отвечает «сдал N из M», а не только баллами за неделю', async () => {
  const db = fakeDb([
    OWNED,
    ['FROM social_class_members m', [{
      user_id: STUDENT,
      joined_at: new Date('2026-09-01T10:00:00Z'),
      display_name: 'Лиза',
      weekly_points: 12,
      weekly_questions: 30,
      hw_total: 5,
      hw_done: 3,
      hw_touched: 4,
      hw_overdue: 1,
      hw_earned: 24,
      hw_possible: 30,
      last_activity: new Date('2026-09-15T18:00:00Z'),
    }]],
  ]);
  const rows = await store.classStudents(TEACHER, CLASS, { db });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assignmentsTotal, 5);
  assert.equal(rows[0].assignmentsDone, 3);
  assert.equal(rows[0].assignmentsOverdue, 1);
  // Процент — баллы, а не «сдал/не сдал»: частичный балл за соответствие виден.
  assert.equal(rows[0].percent, 80);
  assert.ok(rows[0].lastActivityAt > 0, 'учителю важно «давно ли», а не только «сколько»');
  // Баллы за неделю никуда не делись: по ним видно, кто вообще занимается.
  assert.equal(rows[0].weeklyPoints, 12);
});

test('в знаменателе «сдал N из M» только то, что ученик реально получал', () => {
  // 🔴 Иначе новичок, которому по настройке класса не досталось прошлых работ,
  // выглядел бы в списке как злостный прогульщик: 0 из 6 за работы, которых при
  // нём не было. Правило видимости здесь обязано быть тем же самым, что у
  // ученика на экране, — общей константой, а не второй копией.
  const start = storeSource.indexOf('async function classStudents');
  const block = storeSource.slice(start, storeSource.indexOf('\n}', start));
  assert.match(block, /\$\{ASSIGNMENT_VISIBLE_SQL\}/, 'сводка считается тем же правилом видимости');
  assert.match(block, /a\.status <> 'cancelled'/, 'отменённая работа не висит долгом');
});

// --------------------------------------------------- ученик целиком ---

test('карточка ученика: его работы и номера, на которых он спотыкается', async () => {
  const db = fakeDb([
    OWNED,
    // Порядок важен: запрос работ тоже содержит «WHERE m.class_id ... m.user_id»,
    // поэтому более узкое совпадение обязано стоять раньше общего.
    ['JOIN social_assignments a ON a.class_id', [{
      id: '44444444-4444-4444-4444-444444444444',
      title: 'Экономика к четвергу',
      due_at: new Date('2026-09-10T20:59:00Z'),
      issued_at: new Date('2026-09-05T10:00:00Z'),
      question_goal: 10,
      status: 'active',
      earned: 8,
      possible: 10,
      questions: 10,
      progress_status: 'done',
      completed_at: new Date('2026-09-12T10:00:00Z'),
    }]],
    ['WHERE m.class_id = $1 AND m.user_id = $2 AND m.status', [{
      user_id: STUDENT, joined_at: new Date('2026-09-01T10:00:00Z'), display_name: 'Лиза',
    }]],
    ['GROUP BY e.exam_line', [
      { exam_line: 17, attempts: 9, earned: 2, possible: 9 },
      { exam_line: 4, attempts: 12, earned: 10, possible: 12 },
    ]],
  ]);
  const card = await store.studentOverview(TEACHER, CLASS, STUDENT, { db });
  assert.equal(card.student.displayName, 'Лиза');
  assert.equal(card.assignments.length, 1);
  // Сдал после срока — и это видно: «сдал» и «сдал вовремя» разные вещи.
  assert.equal(card.assignments[0].onTime, false);
  assert.equal(card.totals.assignmentsDone, 1);
  assert.equal(card.totals.assignmentsLate, 1);
  assert.equal(card.totals.percent, 80);
  // Слабые места — от худшего: учителю нужно, с чего начать разговор.
  assert.equal(card.weakLines[0].examLine, 17);
  assert.equal(card.weakLines[0].percent, 22);
});

// 🔴 Ноль в exam_line — это «задания нет в бланке», а не «номер ноль». Такие
// карточки собирались в строку «№0», и она выходила самой заметной: по ней
// больше всего попыток во всей базе.
test('задания вне бланка не превращаются в «№0»', () => {
  const lines = storeSource.split('\n').filter(line => line.includes('exam_line'));
  assert.ok(lines.some(line => line.includes('e.exam_line > 0')), 'срез по номерам отсекает ноль');
  assert.ok(!lines.some(line => line.includes('exam_line IS NOT NULL')),
    'проверки на NULL недостаточно: ноль ею не отсекается');
});

test('чужой ученик — 404, а не пустая карточка', async () => {
  const db = fakeDb([OWNED]);
  await assert.rejects(
    () => store.studentOverview(TEACHER, CLASS, STUDENT, { db }),
    error => error.code === 'student_not_found' && error.statusCode === 404);
});

// -------------------------------------------------- что валит класс ---

test('два среза считаются одинаково: класс и все ответы', async () => {
  const rows = [
    { bucket: 17, attempts: 40, earned: 12, possible: 40, students: 8 },
    { bucket: 4, attempts: 60, earned: 48, possible: 60, students: 9 },
  ];
  const db = fakeDb([['GROUP BY e.exam_line', rows], ['GROUP BY b.bucket', []]]);
  const all = await store.weakSpots({ db });
  assert.equal(all.lines[0].key, '17', 'первым идёт то, где ошибаются чаще всего');
  assert.equal(all.lines[0].percent, 30);
  assert.equal(all.lines[1].percent, 80);
  // 🔴 Никакого сглаживания: учитель читает процент как процент. Сглаживание
  // уместно в подборе заданий ученику (taskDifficulty), но в таблице для
  // человека оно превращает «30%» в число, которого нигде нет.
  assert.ok(!/smoothing/.test(storeSource.slice(
    storeSource.indexOf('async function weakSpots'),
    storeSource.indexOf('\n}', storeSource.indexOf('async function weakSpots')))),
  'процент учителя не подмешивает среднее по банку');
  // Рядом всегда число ответов и людей: по нему и видно, верить ли проценту.
  assert.equal(all.lines[0].attempts, 40);
  assert.equal(all.lines[0].students, 8);
});

test('срез по классу ограничен членством, а не выданными домашками', async () => {
  const db = fakeDb([['GROUP BY e.exam_line', []], ['GROUP BY b.bucket', []]]);
  await store.weakSpots({ db, classId: CLASS });
  const scoped = db.log.find(entry => entry.sql.includes('GROUP BY e.exam_line'));
  // Учителя спрашивают «где мои плавают», а не «где мои плавают в заданном
  // мной»: самостоятельные занятия ученика — такой же ответ на вопрос.
  assert.match(scoped.sql, /JOIN social_class_members m ON m\.user_id = e\.user_id AND m\.class_id = \$2/);
  assert.ok(!/social_assignments/.test(scoped.sql), 'срез не сужается до выданного');
});

test('владение классом проверяется ДО подсчёта', () => {
  // 🔴 weakSpots сам по себе только считает и не знает, чей это класс. Если
  // сначала посчитать, а проверить потом, чужой идентификатор в адресе отдаст
  // агрегат по чужим ученикам — и сделает это молча.
  const start = routesSource.indexOf("path === '/teacher/weak-spots'");
  const block = routesSource.slice(start, routesSource.indexOf('return json', start));
  const guard = block.indexOf('ownedClass');
  const compute = block.indexOf('store.weakSpots({ classId })');
  assert.ok(guard > -1, 'владение проверяется явно');
  assert.ok(guard < compute, 'проверка стоит раньше подсчёта');
});
