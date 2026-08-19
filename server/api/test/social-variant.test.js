'use strict';

// Собранный вариант первой части: шестнадцать мест бланка, на каждом либо
// задание учителя, либо задание банка ФИПИ.
//
// Проверяется то, чего не видно в кабинете:
//   * место в бланке задаёт вес задания — №3 стоит балл, №6 два, а механика у
//     них одна; без номера вариант нельзя сравнить с настоящим экзаменом;
//   * на строке ровно один источник — иначе вопрос либо нечем показать, либо
//     непонятно как считать;
//   * задание ФИПИ хранится конкретным идентификатором, а не «подставь любое»:
//     вариант класс разбирает вместе, и №9 обязан быть один на всех;
//   * прежние домашки из своих заданий продолжают выдаваться.

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

function assignment(extra = {}) {
  return { classId: CLASS_ID, source: 'custom', title: 'Вариант 1', ...extra };
}

// --------------------------------------------------------------- контракт --

test('вариант принимает и своё задание, и задание банка', () => {
  const data = schema.assignmentCreate(assignment({
    tasks: [
      { line: 1, customTaskId: TASK_A },
      { line: 9, bankTaskId: 'F58D49' },
    ],
  }));
  assert.equal(data.source, 'custom');
  assert.deepEqual(data.slots, [
    { line: 1, customTaskId: TASK_A, bankTaskId: '' },
    { line: 9, customTaskId: '', bankTaskId: 'F58D49' },
  ]);
  // Цель — весь вариант: «сдал» означает «решил все шестнадцать».
  assert.equal(data.questionGoal, 2);
  // Фильтры банка обнуляются: иначе в зачёт попали бы посторонние задания,
  // решённые в то же время.
  assert.deepEqual([data.types, data.blocks, data.topics], [[], [], []]);
});

test('строки варианта выстраиваются по бланку, а не по порядку заполнения', () => {
  const data = schema.assignmentCreate(assignment({
    tasks: [
      { line: 13, customTaskId: TASK_B },
      { line: 2, customTaskId: TASK_A },
      { line: 9, bankTaskId: 'F58D49' },
    ],
  }));
  assert.deepEqual(data.slots.map(slot => slot.line), [2, 9, 13]);
});

test('на строке ровно один источник', () => {
  assert.throws(() => schema.assignmentCreate(assignment({ tasks: [{ line: 1 }] })),
    /variant_needs_one_source/);
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 1, customTaskId: TASK_A, bankTaskId: 'F58D49' }],
  })), /variant_needs_one_source/);
});

test('одно место бланка занято один раз', () => {
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 3, customTaskId: TASK_A }, { line: 3, customTaskId: TASK_B }],
  })), /variant_line_repeats/);
});

test('одно задание не стоит в варианте дважды', () => {
  // Вторая попытка по тому же заданию в зачёт не идёт: вариант с дублем
  // невозможно закрыть полностью, и увидеть это можно только по классу,
  // застрявшему на «15 из 16».
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 2, customTaskId: TASK_A }, { line: 4, customTaskId: TASK_A }],
  })), /variant_task_repeats/);
});

test('место в бланке обязательно и лежит в пределах первой части', () => {
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ customTaskId: TASK_A }],
  })), /variant_line_required/);
  // 17-я строка первой части не существует; integer прижимает её к 16, поэтому
  // проверяем именно нулевую и отрицательную границу.
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 0, customTaskId: TASK_A }],
  })), /variant_line_required/);
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: -3, customTaskId: TASK_A }],
  })), /variant_line_required/);
});

test('вариант не длиннее первой части', () => {
  const tasks = Array.from({ length: 17 }, (_, index) => ({ line: index + 1, bankTaskId: `T${index}0001` }));
  assert.throws(() => schema.assignmentCreate(assignment({ tasks })), /variant_too_long/);
});

test('идентификатор задания банка проверяется по форме', () => {
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 9, bankTaskId: 'ой' }],
  })), /variant_bank_task_unknown/);
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 9, bankTaskId: "F58D49'; DROP TABLE social_assignments; --" }],
  })), /variant_bank_task_unknown/);
});

test('лишнее поле в строке варианта отвергает запрос целиком', () => {
  // Перечни белые: «лишнее поле молча выкинули» заметить невозможно.
  assert.throws(() => schema.assignmentCreate(assignment({
    tasks: [{ line: 1, customTaskId: TASK_A, points: 5 }],
  })), /variant_unknown_field/);
});

test('пустой вариант не выдаётся', () => {
  assert.throws(() => schema.assignmentCreate(assignment({ tasks: [] })), /task_ids_required/);
});

test('прежняя домашка из своих заданий выдаётся по-старому', () => {
  // 🔴 Так выданные ДЗ уже живут у классов, и кабинет старой версии продолжает
  // присылать именно taskIds. Место в бланке у них не задано — это законно.
  const data = schema.assignmentCreate(assignment({ taskIds: [TASK_A, TASK_B] }));
  assert.deepEqual(data.taskIds, [TASK_A, TASK_B]);
  assert.deepEqual(data.slots, [
    { line: 0, customTaskId: TASK_A, bankTaskId: '' },
    { line: 0, customTaskId: TASK_B, bankTaskId: '' },
  ]);
  assert.equal(data.questionGoal, 2);
});

test('домашка по банку состава не имеет', () => {
  const data = schema.assignmentCreate({ classId: CLASS_ID, blocks: ['2'], questionGoal: 10 });
  assert.equal(data.source, 'bank');
  assert.deepEqual(data.slots, []);
  assert.deepEqual(data.taskIds, []);
});

// ----------------------------------------------------------------- запись --

// Подставная база: проверяем, ЧТО именно уходит в SQL, не поднимая PostgreSQL.
function fakeDb(plan) {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      const answer = plan.find(item => text.includes(item.match));
      return answer ? answer.result : { rowCount: 0, rows: [] };
    },
  };
  return { client, calls, db: client, transact: async run => run(client) };
}

const CREATED = {
  rowCount: 1,
  rows: [{
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', class_id: CLASS_ID, title: 'Вариант 1',
    types: [], blocks: [], topics: [], question_goal: 2, include_images: false,
    due_at: null, status: 'active', issued_at: new Date(), source: 'custom',
  }],
};

test('состав уходит в базу с местом в бланке и источником задания', async () => {
  const fake = fakeDb([
    { match: 'FROM social_classes', result: { rowCount: 1, rows: [{ id: CLASS_ID }] } },
    { match: 'SELECT id FROM social_custom_tasks', result: { rowCount: 1, rows: [{ id: TASK_A }] } },
    { match: 'INSERT INTO social_assignments', result: CREATED },
  ]);
  const data = schema.assignmentCreate(assignment({
    tasks: [{ line: 3, customTaskId: TASK_A }, { line: 9, bankTaskId: 'F58D49' }],
  }));
  await store.createAssignment(TEACHER, data, { db: fake.client, transact: fake.transact });

  const insert = fake.calls.find(call => call.text.includes('INSERT INTO social_assignment_tasks'));
  assert.ok(insert, 'состав варианта обязан записываться');
  // 🔴 Число подстановок обязано совпадать с числом параметров. Ровно на этом
  // месте в requestTeacherRole когда-то потерялся «::text», и каждая заявка
  // учителя падала пятисоткой — увидеть это по коду было нельзя.
  const placeholders = new Set([...insert.text.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
  assert.equal(placeholders.size, insert.params.length,
    `подстановок ${placeholders.size}, параметров ${insert.params.length}`);
  assert.equal(Math.max(...placeholders), insert.params.length);
  // Первая строка — своё задание на третьей линии, вторая — банк на девятой.
  assert.deepEqual(insert.params, ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TASK_A, '', null, 'F58D49']);
  assert.match(insert.text, /\(\$1, \$2::uuid, 0, \$3::text, 3\)/);
  assert.match(insert.text, /\(\$1, \$4::uuid, 1, \$5::text, 9\)/);
});

test('вариант целиком из банка не требует ни одного своего задания', async () => {
  const fake = fakeDb([
    { match: 'FROM social_classes', result: { rowCount: 1, rows: [{ id: CLASS_ID }] } },
    { match: 'INSERT INTO social_assignments', result: CREATED },
  ]);
  const data = schema.assignmentCreate(assignment({
    tasks: [{ line: 1, bankTaskId: 'FB8C48' }, { line: 9, bankTaskId: 'F58D49' }],
  }));
  await store.createAssignment(TEACHER, data, { db: fake.client, transact: fake.transact });
  // Запроса на владение не было: своих заданий в варианте нет, и проверять
  // нечего. Раньше пустой список уходил в ANY($2::uuid[]) и не находил ничего,
  // а несовпадение количества роняло выдачу с «task_not_found».
  assert.ok(!fake.calls.some(call => call.text.includes('SELECT id FROM social_custom_tasks')));
  assert.ok(fake.calls.some(call => call.text.includes('INSERT INTO social_assignment_tasks')));
});

test('чужое задание в вариант не попадает', async () => {
  const fake = fakeDb([
    { match: 'FROM social_classes', result: { rowCount: 1, rows: [{ id: CLASS_ID }] } },
    // Владелец нашёлся только у одного из двух.
    { match: 'SELECT id FROM social_custom_tasks', result: { rowCount: 1, rows: [{ id: TASK_A }] } },
  ]);
  const data = schema.assignmentCreate(assignment({
    tasks: [{ line: 1, customTaskId: TASK_A }, { line: 2, customTaskId: TASK_B }],
  }));
  await assert.rejects(
    store.createAssignment(TEACHER, data, { db: fake.client, transact: fake.transact }),
    /task_not_found/);
});

// ----------------------------------------------------------------- чтение --

const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');

test('задание банка едет клиенту одним идентификатором', () => {
  const start = storeSource.indexOf('function variantSlotForClient(');
  assert.ok(start > 0, 'строка варианта обязана иметь свою сборку для клиента');
  const block = storeSource.slice(start, storeSource.indexOf('\n}', start));
  assert.match(block, /source: 'bank'/);
  assert.match(block, /source: 'custom'/);
  assert.match(block, /examLine/);
});

test('строка из банка не выпадает из состава при чтении', () => {
  // LEFT JOIN, а не JOIN: у строки из банка своего задания нет, и обычное
  // соединение молча выбросило бы №9 из варианта — ученик получил бы 15
  // заданий вместо 16 и не смог бы его закрыть.
  for (const name of ['assignmentTasksForStudent', 'assignmentTasksForTeacher']) {
    const start = storeSource.indexOf(`async function ${name}(`);
    const block = storeSource.slice(start, storeSource.indexOf('\n// ', start + 1));
    assert.match(block, /LEFT JOIN social_custom_tasks t ON t\.id = at\.custom_task_id/, name);
    assert.match(block, /at\.bank_task_id, at\.exam_line/, name);
  }
});

test('в зачёт варианта идут и задания банка', () => {
  // Пересчёт выполнения сверяет решённое со списком заданий ДЗ. Пока список
  // собирался только из custom_task_id, задание ФИПИ на девятой строке не
  // засчитывалось никогда, и вариант нельзя было сдать.
  const start = storeSource.indexOf('async function activeAssignmentsFor(');
  const block = storeSource.slice(start, storeSource.indexOf('\n// ', start + 1));
  assert.match(block, /array_agg\(COALESCE\(at\.custom_task_id::text, at\.bank_task_id\)\)/);
});

// --------------------------------------------------------------- миграция --

test('миграция состава идемпотентна и не теряет данные', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_social_variant_slots.sql'), 'utf8');
  for (const [, table] of sql.matchAll(/ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(table.startsWith('social_'), `изменяется непредметная таблица ${table}`);
  }
  // Колонки добавляются с IF NOT EXISTS, ограничения — через DROP IF EXISTS:
  // миграции прогоняются заново при каждом деплое.
  assert.match(sql, /ADD COLUMN IF NOT EXISTS bank_task_id text NOT NULL DEFAULT ''/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS exam_line integer NOT NULL DEFAULT 0/);
  assert.equal((sql.match(/DROP CONSTRAINT IF EXISTS/g) || []).length,
    (sql.match(/ADD CONSTRAINT/g) || []).length,
    'каждое ограничение снимается перед добавлением, иначе повторный прогон падает');
  // 🔴 Ровно один источник на строку — на уровне базы, а не только схемы.
  assert.match(sql, /CHECK \(\(custom_task_id IS NOT NULL\) <> \(bank_task_id <> ''\)\)/);
  // Значения по умолчанию обязательны: у всех уже выданных вариантов состав
  // записан без номеров, и без DEFAULT миграция уронила бы существующие строки.
  assert.ok(!/DROP\s+(TABLE|COLUMN)/i.test(sql), 'миграция не удаляет ни таблиц, ни колонок');

  // 🔴 Порядок команд. PostgreSQL отказывается снимать NOT NULL с колонки,
  // входящей в первичный ключ: «column "custom_task_id" is in a primary key».
  // Миграции прогоняются при СТАРТЕ сервера, поэтому обратный порядок валит не
  // только миграцию, но и весь запуск — API уходит в перезапуск по кругу.
  // Ровно это и случилось 19.08.2026 при первой выкатке.
  const dropKey = sql.indexOf('DROP CONSTRAINT IF EXISTS social_assignment_tasks_pkey');
  const dropNotNull = sql.indexOf('ALTER COLUMN custom_task_id DROP NOT NULL');
  const addKey = sql.indexOf('ADD CONSTRAINT social_assignment_tasks_pkey');
  assert.ok(dropKey > 0 && dropNotNull > 0 && addKey > 0, 'все три команды ключа на месте');
  assert.ok(dropKey < dropNotNull, 'ключ снимается ДО снятия NOT NULL');
  assert.ok(dropNotNull < addKey, 'новый ключ ставится после');
});
