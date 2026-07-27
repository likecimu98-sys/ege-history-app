'use strict';

// Регрессия на трансляцию ограничений в SQL (задача 2.1).
//
// ⚠️ Что здесь проверяется в первую очередь — НЕ скорость, а то, что предфильтр
// не строже проверки прав. query() по-прежнему прогоняет authorizeRead по каждой
// вернувшейся строке и applyConstraints поверх результата, поэтому ошибка «в
// плюс» стоит лишнего чтения, а ошибка «в минус» молча теряет данные и ни одним
// пользовательским сценарием не ловится. Отсюда упор на случаи, где перевод
// делать НЕЛЬЗЯ.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueryPlan, applyConstraints } = require('../src/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const ref = (collection, table) => ({ collection, table: table || collection });
const studentsRef = ref('students', 'student_profiles');

function context({ admin = false, teacher = null, classes = [], docIds = ['111'], userId = 'u-1' } = {}) {
  return { admin, teacher, userId, docIds: new Set(docIds), classes: new Set(classes), ownClasses: new Set() };
}

test('фильтр по классу уходит в SQL и попадает в существующий индекс', () => {
  const ctx = context({ teacher: { docId: '555' }, classes: ['7A'] });
  const plan = buildQueryPlan(studentsRef, ctx, [
    { type: 'where', field: 'classCode', op: '==', value: '7A' },
    { type: 'limit', count: 3000 },
  ], false);

  assert.match(plan.sql, /WHERE/);
  // Выражение обязано совпадать с student_profiles_class_idx: индекс построен
  // на (data->>'classCode'), любая другая форма его не возьмёт.
  assert.match(plan.sql, /data->>\$\d+ = \$\d+/);
  assert.match(plan.sql, /LIMIT 3000/);
  assert.ok(plan.params.includes('classCode'));
  assert.ok(plan.params.includes('7A'));
});

test('имя поля и значение уходят параметрами, а не в текст запроса', () => {
  // Иначе поле из запроса клиента было бы вектором инъекции.
  const plan = buildQueryPlan(studentsRef, context({ teacher: {}, classes: ['7A'] }), [
    { type: 'where', field: "classCode'; DROP TABLE student_profiles; --", op: '==', value: 'x' },
  ], false);
  assert.ok(!plan.sql.includes('DROP TABLE'), 'имя поля не должно попадать в текст SQL');
  assert.ok(plan.params.some(p => String(p).includes('DROP TABLE')), 'оно должно быть параметром');
});

test('права сужают выборку до своего класса И своих документов', () => {
  const ctx = context({ teacher: { docId: '555' }, classes: ['7A', '9B'], docIds: ['555'] });
  const plan = buildQueryPlan(studentsRef, ctx, [], false);
  // Собственные документы учителя обязаны остаться: он и сам ученик в базе,
  // и его classCode может не совпадать ни с одним из его классов.
  assert.match(plan.sql, /doc_id = ANY/);
  assert.match(plan.sql, /user_id = /);
  assert.match(plan.sql, /data->>'classCode' = ANY/);
  assert.match(plan.sql, / OR /, 'условия прав объединяются через OR, а не через AND');
});

test('админу выборка не сужается', () => {
  const plan = buildQueryPlan(studentsRef, context({ admin: true }), [], false);
  assert.ok(!/WHERE/.test(plan.sql), 'у админа предфильтра по правам быть не должно');
});

test('внутренний вызов бота не сужается правами', () => {
  // Проверяем именно отсутствие WHERE: user_id встречается ещё и в списке
  // колонок SELECT, по нему судить нельзя.
  const plan = buildQueryPlan(studentsRef, context(), [], true);
  assert.ok(!/WHERE/.test(plan.sql), 'внутреннему вызову предфильтр по правам не ставится');
  assert.deepEqual(plan.params, []);
});

// ── случаи, где переводить НЕЛЬЗЯ ──

test('сравнение null не переводится: SQL выкинул бы строку, а JS её оставляет', () => {
  // data->>'f' для JSON-null даёт SQL NULL, и NULL = 'null' это NULL, то есть
  // строка выпала бы. sameValue(null, null) её оставляет — предфильтр оказался
  // бы СТРОЖЕ проверки, а это молчаливая потеря данных.
  const plan = buildQueryPlan(studentsRef, context({ admin: true }), [
    { type: 'where', field: 'classCode', op: '==', value: null },
  ], false);
  assert.ok(!/data->>\$/.test(plan.sql), 'условие с null не должно уходить в SQL');
});

test('неравенства не переводятся: data->> это текст, там 9 больше 10', () => {
  for (const op of ['>', '<', '>=', '<=']) {
    const plan = buildQueryPlan(studentsRef, context({ admin: true }), [
      { type: 'where', field: 'totalSolved', op, value: 100 },
    ], false);
    assert.ok(!/data->>\$/.test(plan.sql), `оператор ${op} не должен уходить в SQL`);
  }
});

test('объекты и массивы не переводятся', () => {
  for (const value of [{ a: 1 }, [1, 2], undefined]) {
    const plan = buildQueryPlan(studentsRef, context({ admin: true }), [
      { type: 'where', field: 'f', op: '==', value },
    ], false);
    assert.ok(!/data->>\$/.test(plan.sql));
  }
});

// ── сортировка ──

test('сортировка по числовому полю уходит в SQL вместе с LIMIT', () => {
  const plan = buildQueryPlan(studentsRef, context({ admin: true }), [
    { type: 'orderBy', field: 'totalSolved', direction: 'desc' },
    { type: 'limit', count: 20 },
  ], false);
  // Выражение повторяет student_profiles_total_idx дословно.
  assert.match(plan.sql, /ORDER BY \(data->>\$\d+\)::numeric DESC NULLS LAST/);
  assert.match(plan.sql, /LIMIT 20/);
});

test('сортировка по нечисловому полю остаётся в JS и НЕ тянет за собой LIMIT', () => {
  // Если срезать LIMIT в SQL без сортировки, отрежутся не те строки.
  const plan = buildQueryPlan(studentsRef, context({ admin: true }), [
    { type: 'orderBy', field: 'name', direction: 'asc' },
    { type: 'limit', count: 20 },
  ], false);
  assert.ok(!/ORDER BY/.test(plan.sql), 'сортировка по тексту в SQL была бы лексикографической');
  assert.ok(!/LIMIT/.test(plan.sql), 'без сортировки в SQL нельзя резать в SQL');
});

test('без сортировки LIMIT уходит в SQL', () => {
  const plan = buildQueryPlan(studentsRef, context({ admin: true }), [{ type: 'limit', count: 42 }], false);
  assert.match(plan.sql, /LIMIT 42/);
});

test('лимит по умолчанию и потолок сохранены', () => {
  assert.match(buildQueryPlan(studentsRef, context({ admin: true }), [], false).sql, /LIMIT 500/);
  assert.match(buildQueryPlan(studentsRef, context({ admin: true }), [{ type: 'limit', count: 99999 }], false).sql, /LIMIT 5000/);
});

// ── семантика JS-пути не изменилась ──

test('applyConstraints по-прежнему источник правды и остаётся поверх SQL', () => {
  const rows = [
    { doc_id: 'a', data: { classCode: '7A', totalSolved: 9 } },
    { doc_id: 'b', data: { classCode: '7A', totalSolved: 10 } },
    { doc_id: 'c', data: { classCode: '9B', totalSolved: 99 } },
    { doc_id: 'd', data: { classCode: '7A' } },
  ];
  const out = applyConstraints(rows, [
    { type: 'where', field: 'classCode', op: '==', value: '7A' },
    { type: 'orderBy', field: 'totalSolved', direction: 'desc' },
    { type: 'limit', count: 10 },
  ]);
  assert.deepEqual(out.map(r => r.doc_id), ['b', 'a', 'd'], 'числовая сортировка и null в конце');
});
