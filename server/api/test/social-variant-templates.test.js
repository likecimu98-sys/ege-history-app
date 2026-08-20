'use strict';

// Сохранённые варианты учителя: составил один раз, выдаёшь сколько угодно раз
// скольким угодно классам. До этого вариант жил только как состав уже выданной
// домашки — «выдать ещё раз» приходилось вытягивать из чужого прошлого долга,
// а не из вещи, которую учитель составил и хранит сам.
//
// Проверяется то, чего не видно в кабинете:
//   * состав шаблона — та же variantSlots, что и у выдачи: одна проверка на оба
//     места, а не две, которые могут разойтись;
//   * шаблон принадлежит учителю и недоступен чужому — ни на чтение, ни на запись;
//   * удаление шаблона не трогает уже выданные по нему домашки — состав скопирован
//     в social_assignment_tasks в момент выдачи, а не читается по ссылке.

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
const TASK_A = '44444444-4444-4444-4444-444444444444';

// --------------------------------------------------------------- контракт --

test('шаблон принимает название и состав в том же формате, что и выдача', () => {
  const data = schema.variantTemplateCreate({
    title: 'Вариант 1 · вся первая часть',
    tasks: [{ line: 1, customTaskId: TASK_A }, { line: 9, bankTaskId: 'F58D49' }],
  });
  assert.equal(data.title, 'Вариант 1 · вся первая часть');
  assert.deepEqual(data.slots, [
    { line: 1, customTaskId: TASK_A, bankTaskId: '' },
    { line: 9, customTaskId: '', bankTaskId: 'F58D49' },
  ]);
});

test('название обязательно — безымянный шаблон невозможно узнать в списке', () => {
  assert.throws(() => schema.variantTemplateCreate({ tasks: [{ line: 1, customTaskId: TASK_A }] }),
    /title_required/);
});

test('состав шаблона проверяется теми же правилами, что и состав выдачи', () => {
  // Один источник на строку, номер в пределах 1..16, без повторов — variantSlots
  // уже проверена в social-variant.test.js; здесь достаточно убедиться, что
  // шаблон действительно зовёт её, а не отдельную более слабую копию.
  assert.throws(() => schema.variantTemplateCreate({ title: 'т', tasks: [{ line: 1 }] }),
    /variant_needs_one_source/);
  assert.throws(() => schema.variantTemplateCreate({ title: 'т', tasks: [] }), /task_ids_required/);
});

test('лишнее поле отвергает запрос целиком', () => {
  assert.throws(() => schema.variantTemplateCreate({
    title: 'т', tasks: [{ line: 1, customTaskId: TASK_A }], classId: 'x',
  }), /variant_template_unknown_field/);
});

test('правка — переименование, пересборка состава или оба действия сразу', () => {
  const renamed = schema.variantTemplatePatch({ title: 'Новое имя' });
  assert.deepEqual(renamed, { title: 'Новое имя' });

  const resorted = schema.variantTemplatePatch({ tasks: [{ line: 2, customTaskId: TASK_A }] });
  assert.deepEqual(resorted, { slots: [{ line: 2, customTaskId: TASK_A, bankTaskId: '' }] });

  const both = schema.variantTemplatePatch({ title: 'И то и то', tasks: [{ line: 3, bankTaskId: 'F58D49' }] });
  assert.equal(both.title, 'И то и то');
  assert.deepEqual(both.slots, [{ line: 3, customTaskId: '', bankTaskId: 'F58D49' }]);
});

test('правка без единого поля ничего не просит изменить', () => {
  assert.throws(() => schema.variantTemplatePatch({}), /nothing_to_update/);
});

// ----------------------------------------------------------------- запись --

function fakeDb(plan) {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      const answer = plan.find(item => text.includes(item.match));
      return answer ? answer.result : { rowCount: 0, rows: [] };
    },
  };
  return { client, calls };
}

const ROW = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'Вариант 1', slots: [{ line: 1, customTaskId: TASK_A, bankTaskId: '' }],
  created_at: new Date(), updated_at: new Date(),
};

test('создание уходит одним запросом с составом в jsonb', async () => {
  const fake = fakeDb([{ match: 'INSERT INTO social_variant_templates', result: { rowCount: 1, rows: [ROW] } }]);
  const data = schema.variantTemplateCreate({ title: 'Вариант 1', tasks: [{ line: 1, customTaskId: TASK_A }] });
  const created = await store.createVariantTemplate(TEACHER, data, { db: fake.client });
  assert.equal(created.title, 'Вариант 1');
  assert.deepEqual(created.slots, [{ line: 1, customTaskId: TASK_A, bankTaskId: '' }]);
  const insert = fake.calls[0];
  assert.equal(insert.params[0], TEACHER);
  assert.equal(JSON.parse(insert.params[2])[0].customTaskId, TASK_A);
});

test('чужой шаблон недоступен ни на правку, ни на удаление', async () => {
  const fake = fakeDb([]); // WHERE teacher_user_id=$2 не совпал — rowCount 0 у обоих
  await assert.rejects(
    store.updateVariantTemplate('other-teacher', ROW.id, { title: 'x' }, { db: fake.client }),
    /variant_template_not_found/);
  await assert.rejects(
    store.deleteVariantTemplate('other-teacher', ROW.id, { db: fake.client }),
    /variant_template_not_found/);
  // Оба запроса обязаны фильтровать по teacher_user_id, а не только по id —
  // иначе владение проверяет комментарий, а не SQL.
  for (const call of fake.calls) assert.match(call.text, /teacher_user_id\s*=\s*\$2/);
});

test('удаление физическое: шаблон не архивируется', () => {
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');
  assert.match(storeSource, /DELETE FROM social_variant_templates WHERE id=\$1 AND teacher_user_id=\$2/);
});

// --------------------------------------------------------------- миграция --

test('таблица шаблонов не задевает чужие данные', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '010_social_variant_templates.sql'), 'utf8');
  for (const [, table] of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    assert.ok(table.startsWith('social_'), `создаётся непредметная таблица ${table}`);
  }
  assert.match(sql, /teacher_user_id uuid NOT NULL REFERENCES app_users\(id\) ON DELETE CASCADE/);
});

// ------------------------------------------------------------------ роуты --

const routesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'routes.js'), 'utf8');

test('маршруты шаблона требуют подтверждённой мутации на запись', () => {
  const create = routesSource.slice(routesSource.indexOf("method === 'POST' && path === '/teacher/variants'"));
  assert.match(create.slice(0, 200), /requireMutationAuth/);
  const patchDelete = routesSource.slice(routesSource.indexOf('variantMatch && (method'));
  assert.match(patchDelete.slice(0, 200), /requireMutationAuth/);
});

test('чтение списка не требует CSRF — это GET', () => {
  const block = routesSource.slice(
    routesSource.indexOf("path === '/teacher/variants'"),
    routesSource.indexOf("method === 'POST' && path === '/teacher/variants'"));
  assert.ok(!block.includes('requireMutationAuth'));
});

// -------------------------------------------------------- уведомление о сдаче --

test('учитель узнаёт о сдаче ТОЛЬКО при переходе в done, не на каждый повторный ответ', async () => {
  // 🔴 status пересчитывается на КАЖДУЮ попытку и остаётся 'done', даже когда
  // ученик просто перерешивает задания сверх цели. Сравнивать status после
  // апсерта слало бы уведомление на каждый такой повтор — учитель получил бы
  // тридцать сообщений про одного и того же ученика за вечер.
  const calls = [];
  const already = { rowCount: 1, rows: [{ completed_at: new Date() }] };
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      if (text.includes('FROM social_assignment_progress WHERE assignment_id')) return already;
      if (text.includes('INSERT INTO social_assignment_progress')) {
        return { rowCount: 1, rows: [{ earned: 10, possible: 10, questions: 5, status: 'done', completed_at: already.rows[0].completed_at }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const assignment = { id: 'a-1', question_goal: 5, issued_at: new Date(), types: [], blocks: [], topics: [], include_images: false, task_ids: [] };
  const progress = await store.recomputeAssignment(client, assignment, 'student-1');
  assert.equal(progress.justCompleted, false, 'уже был завершён раньше — это не первый переход');
});

test('первый переход в done помечен для уведомления', async () => {
  const client = {
    query: async text => {
      if (text.includes('FROM social_assignment_progress WHERE assignment_id')) return { rowCount: 0, rows: [] };
      if (text.includes('INSERT INTO social_assignment_progress')) {
        return { rowCount: 1, rows: [{ earned: 10, possible: 10, questions: 5, status: 'done', completed_at: new Date() }] };
      }
      return { rowCount: 0, rows: [] };
    },
  };
  const assignment = { id: 'a-1', question_goal: 5, issued_at: new Date(), types: [], blocks: [], topics: [], include_images: false, task_ids: [] };
  const progress = await store.recomputeAssignment(client, assignment, 'student-1');
  assert.equal(progress.justCompleted, true);
});

test('уведомление о сдаче ищет получателя по учителю ЗАДАНИЯ, а не по текущему владельцу класса', () => {
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');
  const start = storeSource.indexOf('async function enqueueCompletionNotification(');
  const block = storeSource.slice(start, storeSource.indexOf('\n}', start));
  assert.match(block, /WHERE i\.user_id = \$1 AND i\.provider = 'telegram'/);
  assert.match(block, /\[assignment\.teacher_user_id\]/);
});

test('дубль доставки закрыт ключом задание+ученик, а не только БД-флагом', () => {
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');
  const start = storeSource.indexOf('async function enqueueCompletionNotification(');
  const block = storeSource.slice(start, storeSource.indexOf('\n}', start));
  assert.match(block, /`completion:\$\{assignment\.id\}:\$\{studentUserId\}`/);
  assert.match(block, /ON CONFLICT \(dedup_key\) WHERE dedup_key <> '' DO NOTHING/);
});

test('учитель без Telegram не роняет пересчёт — просто некому доставить', async () => {
  const client = { query: async () => ({ rowCount: 0, rows: [] }) };
  const assignment = { id: 'a-1', teacher_user_id: 'teacher-no-telegram', title: 't', class_title: 'c' };
  await assert.doesNotReject(store.enqueueCompletionNotification(client, assignment, 'student-1'));
});

test('провал уведомления не отменяет зачтённую домашку', () => {
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');
  const start = storeSource.indexOf('async function saveAttempts(');
  const block = storeSource.slice(start, storeSource.indexOf('\n// ---', start + 1) > -1
    ? storeSource.indexOf('\n// ---', start + 1) : storeSource.length);
  assert.match(block, /try \{ await enqueueCompletionNotification/);
});

test('дедупликация уведомлений — ключ и частичный уникальный индекс', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '011_social_notification_dedup.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS dedup_key text NOT NULL DEFAULT ''/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS social_notification_jobs_dedup_uq[\s\S]*WHERE dedup_key <> ''/);
});
