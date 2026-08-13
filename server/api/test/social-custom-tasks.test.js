'use strict';

// Свои задания учителя и домашка-«вариант» из них.
//
// Проверяется то, что нельзя увидеть глазами в кабинете:
//   * ответ согласован с вариантами (иначе задание нерешаемо, а выглядит
//     нормально — учитель узнает об этом по нулям у всего класса);
//   * вариант не смешивается с банком ФИПИ при пересчёте выполнения;
//   * чужое задание невозможно ни выдать, ни прочитать.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../src/subjects/social/schema');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const TEACHER = '22222222-2222-2222-2222-222222222222';
const CLASS_ID = '33333333-3333-3333-3333-333333333333';
const TASK_A = '44444444-4444-4444-4444-444444444444';
const TASK_B = '55555555-5555-5555-5555-555555555555';

function choiceTask(extra = {}) {
  return {
    type: 'choice',
    prompt: 'Выберите верные суждения о рынке',
    options: [{ n: 1, text: 'первое' }, { n: 2, text: 'второе' }, { n: 3, text: 'третье' }],
    answer: '13',
    ...extra,
  };
}

function matchingTask(extra = {}) {
  return {
    type: 'matching',
    prompt: 'Установите соответствие',
    options: [{ n: 1, text: 'права' }, { n: 2, text: 'обязанности' }],
    targets: [{ label: 'А', text: 'первое' }, { label: 'Б', text: 'второе' }, { label: 'В', text: 'третье' }],
    answer: '121',
    ...extra,
  };
}

// --------------------------------------------------------------- контракт --

test('задание учителя принимается в том же формате, что и банк ФИПИ', () => {
  const task = schema.customTask(choiceTask());
  assert.equal(task.type, 'choice');
  assert.deepEqual(task.options.map(option => option.n), [1, 2, 3]);
  assert.equal(task.answer, '13');
  assert.deepEqual(task.targets, []);
});

test('порядок цифр в ответе выбора не меняет самого ответа', () => {
  // «31» и «13» — один ответ. Иначе правильность зависела бы от того, в каком
  // порядке учитель набрал цифры, и половина заданий молча не засчитывалась бы.
  assert.equal(schema.customTask(choiceTask({ answer: '31' })).answer, '13');
  assert.equal(schema.customTask(choiceTask({ answer: '1, 3' })).answer, '13');
});

test('ответ вне вариантов отвергается', () => {
  // Ровно та опечатка, которую невозможно заметить: задание с ответом «4» при
  // трёх вариантах выглядит нормально и не берётся никем.
  assert.throws(() => schema.customTask(choiceTask({ answer: '4' })), /answer_out_of_options/);
});

test('в соответствии ответ обязан покрывать все строки', () => {
  assert.throws(() => schema.customTask(matchingTask({ answer: '12' })), /answer_length_must_match_targets/);
  assert.equal(schema.customTask(matchingTask()).answer, '121');
});

test('повторяющиеся номера вариантов и метки строк не проходят', () => {
  assert.throws(() => schema.customTask(choiceTask({
    options: [{ n: 1, text: 'a' }, { n: 1, text: 'b' }],
  })), /options_numbers_must_differ/);
  assert.throws(() => schema.customTask(matchingTask({
    targets: [{ label: 'А', text: 'a' }, { label: 'А', text: 'b' }],
  })), /targets_labels_must_differ/);
});

test('задание без вариантов или без условия не сохраняется', () => {
  assert.throws(() => schema.customTask(choiceTask({ options: [{ n: 1, text: 'одно' }] })), /options_need_two/);
  assert.throws(() => schema.customTask(choiceTask({ prompt: '' })), /prompt_required/);
});

test('вариант учителя не принимает фильтры банка и требует список заданий', () => {
  const data = schema.assignmentCreate({ classId: CLASS_ID, source: 'custom', taskIds: [TASK_A, TASK_B] });
  assert.equal(data.source, 'custom');
  assert.deepEqual(data.taskIds, [TASK_A, TASK_B]);
  // Цель равна числу заданий: «сдал вариант» означает «решил всё, что в нём есть».
  assert.equal(data.questionGoal, 2);
  assert.deepEqual([data.types, data.blocks, data.topics], [[], [], []]);
  assert.throws(() => schema.assignmentCreate({ classId: CLASS_ID, source: 'custom', taskIds: [] }), /task_ids_required/);
});

test('обычная домашка по банку осталась прежней', () => {
  const data = schema.assignmentCreate({ classId: CLASS_ID, blocks: ['2'], questionGoal: 12 });
  assert.equal(data.source, 'bank');
  assert.deepEqual(data.taskIds, []);
  assert.deepEqual(data.blocks, ['2']);
  assert.equal(data.questionGoal, 12);
});

// ------------------------------------------------------------------- SQL --

const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');

test('пересчёт варианта ограничен его собственными заданиями', () => {
  // 🔴 Без этого условия в вариант засчитывалось бы всё, что ученик решал в
  // приложении после выдачи: «домашка сдана», хотя ни одного задания учителя он
  // не открывал.
  const start = storeSource.indexOf('async function recomputeAssignment(');
  const block = storeSource.slice(start, storeSource.indexOf('\nasync function', start + 1));
  assert.match(block, /e\.task_id = ANY\(\$9::text\[\]\)/);
  assert.match(block, /assignment\.task_ids \|\| \[\]/);
});

test('состав варианта проверяется на принадлежность учителю', () => {
  const start = storeSource.indexOf('async function createAssignment(');
  const block = storeSource.slice(start, storeSource.indexOf('\n// -----', start + 1));
  assert.match(block, /teacher_user_id = \$1 AND status = 'active' AND id = ANY/);
  assert.match(block, /fail\('task_not_found', 404\)/);
  // Задание и его состав пишутся одной транзакцией: домашка без вопросов —
  // это домашка, которую нельзя выполнить.
  assert.match(block, /transact\(async client/);
});

test('ученик получает задания варианта только через членство в классе', () => {
  const start = storeSource.indexOf('async function assignmentTasksForStudent(');
  const block = storeSource.slice(start, storeSource.indexOf('\n// ', start + 1));
  assert.match(block, /social_class_members m ON m\.class_id = a\.class_id AND m\.user_id = \$1/);
  assert.match(block, /a\.status = 'active'/);
});

test('задание архивируется, а не удаляется', () => {
  // Удаление сняло бы его и с уже выданных вариантов (ON DELETE CASCADE), то
  // есть переписало бы прошлую домашку задним числом.
  const start = storeSource.indexOf('async function archiveCustomTask(');
  const block = storeSource.slice(start, storeSource.indexOf('\n// ', start + 1));
  assert.match(block, /UPDATE social_custom_tasks SET status='archived'/);
  assert.ok(!/DELETE FROM social_custom_tasks/.test(storeSource), 'задания учителя не удаляются физически');
});

test('состав варианта считается по позиции, а не по случайному порядку', () => {
  assert.match(storeSource, /INSERT INTO social_assignment_tasks\(assignment_id, custom_task_id, position\)/);
  assert.match(storeSource, /ORDER BY at\.position/);
});

test('миграция варианта не трогает чужие таблицы', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '007_social_custom_tasks.sql'), 'utf8');
  for (const [, table] of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(table.startsWith('social_'), `создаётся непредметная таблица ${table}`);
  }
  for (const [, table] of sql.matchAll(/ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(table.startsWith('social_'), `изменяется непредметная таблица ${table}`);
  }
  // Колонка обязана иметь значение по умолчанию: у всех уже выданных ДЗ
  // источник — банк, и без DEFAULT они стали бы вариантом без заданий.
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'bank'/);
});

// --------------------------------------------------------------- маршруты --

const routesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'routes.js'), 'utf8');

test('маршруты своих заданий закрыты ролью учителя', () => {
  const teacherBlock = routesSource.slice(routesSource.indexOf("path.startsWith('/teacher/')"));
  assert.match(teacherBlock, /path === '\/teacher\/tasks'/);
  assert.match(teacherBlock, /\/\^\\\/teacher\\\/tasks\\\/\(\[\^\/\]\+\)\$\//);
  const guard = routesSource.slice(0, routesSource.indexOf("path === '/teacher/tasks'"));
  assert.match(guard, /requireTeacher\(role\)/);
});

test('ученик читает задания варианта своим маршрутом, а не учительским', () => {
  assert.match(routesSource, /\/me\\\/assignments\\\/\(\[\^\/\]\+\)\\\/tasks/);
  assert.match(routesSource, /assignmentTasksForStudent\(userId, assignmentId/);
});
