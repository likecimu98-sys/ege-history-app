'use strict';

// Сложность заданий: насколько часто на них ошибаются — по ВСЕМ ученикам.
//
// 🔴 Считаем долю НАБРАННЫХ БАЛЛОВ, а не «сколько раз взяли максимум».
// Соответствие, где все стабильно берут 1 балл из 2, по «максимуму» выглядит
// стопроцентным провалом, хотя половину ученик знает; однобалльное задание при
// этом либо 0, либо 100. Две разные шкалы в одном числе — это не мерка.
//
// 🔴 И сглаживание вместо голого процента. Сырая доля на трёх ответах — шум:
// одно невезение даёт «ноль», и задание встаёт впереди того, на котором
// спотыкаются полсотни человек подряд.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

// Подставная база: первый запрос — общие суммы, второй — по заданиям.
function db(totals, rows) {
  let call = 0;
  return { query: async () => (call++ === 0 ? { rows: [totals] } : { rows }) };
}

test('порядок — от самого проваливаемого', async () => {
  const result = await store.taskDifficulty({
    db: db({ earned: 700, possible: 1000 }, [
      { task_id: 'easy', attempts: 40, earned: 90, possible: 100 },
      { task_id: 'hard', attempts: 40, earned: 20, possible: 100 },
      { task_id: 'middle', attempts: 40, earned: 55, possible: 100 },
    ]),
  });
  assert.deepEqual(result.tasks.map(t => t.taskId), ['hard', 'middle', 'easy']);
  assert.ok(result.tasks[0].share < result.tasks[2].share);
});

test('редкое задание не обгоняет измеренное', async () => {
  // У «rare» сырая доля ноль, у «solid» — 25%. Без сглаживания rare встал бы
  // первым на одном невезении; со сглаживанием — нет.
  const result = await store.taskDifficulty({
    db: db({ earned: 700, possible: 1000 }, [
      { task_id: 'rare', attempts: 5, earned: 0, possible: 5 },
      { task_id: 'solid', attempts: 60, earned: 30, possible: 120 },
    ]),
  });
  assert.deepEqual(result.tasks.map(t => t.taskId), ['solid', 'rare'],
    'первым идёт то, что измерено, а не то, что не повезло');
});

test('доля считается по баллам, а не по «взял максимум»', async () => {
  // Два задания: на первом половина баллов у всех, на втором почти ноль.
  const result = await store.taskDifficulty({
    db: db({ earned: 700, possible: 1000 }, [
      { task_id: 'half', attempts: 50, earned: 50, possible: 100 },
      { task_id: 'nearZero', attempts: 50, earned: 5, possible: 100 },
    ]),
  });
  assert.equal(result.tasks[0].taskId, 'nearZero');
  assert.ok(result.tasks[0].share > 0, 'сглаживание не даёт нулей даже в худшем случае');
  assert.ok(result.tasks[1].share > result.tasks[0].share);
});

test('порог по числу ответов уезжает в запрос', async () => {
  let asked = null;
  const spy = { query: async (_text, params) => {
    if (params) asked = params[0];
    return { rows: [{ earned: 1, possible: 2 }] };
  } };
  await store.taskDifficulty({ db: spy, minAttempts: 7 });
  assert.equal(asked, 7, 'HAVING COUNT(*) >= порог');
});

test('пустая база не роняет расчёт', async () => {
  const result = await store.taskDifficulty({ db: db({ earned: 0, possible: 0 }, []) });
  assert.deepEqual(result.tasks, []);
  assert.equal(result.mean, 1, 'без данных считаем, что задания берут на максимум');
});
