'use strict';

// Самые трудные задания: чем меряем трудность и в каком порядке показываем.
//
// 🔴 Меряем ЛЮДЬМИ, НЕ ВЗЯВШИМИ МАКСИМУМ, а не баллами. Процент по баллам
// прячет ровно то, ради чего в эту таблицу и смотрят: работа из десяти заданий
// стоит двадцати баллов, класс набирает восемнадцать — и кажется, что тему
// знают все, а внутри лежит задание на два балла, где каждый получил ровно
// один. По баллам это «50% верных», растворённые в средних 90%; по сути —
// задание, которое не взял никто.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const storeSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');

const row = (task_id, students, mastered, extra = {}) => ({
  task_id, students, mastered,
  task_type: 'choice', exam_line: 0,
  earned: extra.earned === undefined ? mastered : extra.earned,
  possible: extra.possible === undefined ? students : extra.possible,
});

// -------------------------------------------------------------- формула ---

test('трудность считается по людям, а не по набранным баллам', () => {
  // Два задания на два балла. У первого все получили ровно половину — по
  // баллам ровно столько же, сколько у второго, где половина класса взяла
  // максимум, а половина не получила ничего. Но взять задание целиком в первом
  // не смог никто, и именно его надо разбирать.
  const ranked = store.rankHardest([
    row('половина-у-всех', 10, 0, { earned: 10, possible: 20 }),
    row('поровну', 10, 5, { earned: 10, possible: 20 }),
  ], { minStudents: 2 });
  assert.equal(ranked.tasks[0].taskId, 'половина-у-всех');
  assert.equal(ranked.tasks[0].failPercent, 100);
  // И по баллам они неразличимы — показываем это число рядом именно затем,
  // чтобы разрыв был виден.
  assert.equal(ranked.tasks[0].pointPercent, 50);
  assert.equal(ranked.tasks[1].pointPercent, 50);
});

test('100% у пятерых стоит ниже 95% у пятидесяти', () => {
  // 🔴 Ради этого и сглаживание. На живых данных 24.09.2026 задание 22104B
  // видели 55 человек и максимум взяли трое — оно и есть то, что разбирают
  // классом. Без поправки на размер выборки его перекрывали десять заданий с
  // круглыми «100% из пяти», где сто процентов держатся на пяти ответах.
  //
  // 🔴 Фон обязателен, и это не декорация теста. Доля подтягивается к СРЕДНЕЙ
  // ПО ВЫБОРКЕ, а средняя по двум заданиям — это они сами: из пары «100% из
  // пяти» и «95% из пятидесяти» среднее выходит 95%, подтягивать не к чему, и
  // порядок честно остаётся прежним. Поправка работает там, где ей и место, —
  // когда трудное задание выделяется на фоне обычных. На проде фон такой:
  // 496 заданий, в среднем максимум не берут 37%.
  const ordinary = Array.from({ length: 60 }, (_, index) => row(`обычное-${index}`, 20, 13));
  const ranked = store.rankHardest([
    row('пятеро', 5, 0),
    row('многие', 55, 3),
    ...ordinary,
  ], { minStudents: 2 });
  assert.equal(ranked.meanFailPercent, 38, 'фон примерно как на проде');
  assert.equal(ranked.tasks[0].taskId, 'многие');
  assert.equal(ranked.tasks[1].taskId, 'пятеро');
  // Показанные проценты при этом честные, а не подкрученные под порядок.
  assert.equal(ranked.tasks[0].failPercent, 95);
  assert.equal(ranked.tasks[1].failPercent, 100);
});

test('задание, которое видели единицы, в список не попадает', () => {
  const ranked = store.rankHardest([
    row('один-ученик', 1, 0),
    row('нормальное', 12, 4),
  ], { minStudents: 5 });
  assert.deepEqual(ranked.tasks.map(item => item.taskId), ['нормальное']);
  assert.equal(ranked.considered, 1, 'и в счёт отобранных тоже не идёт');
  assert.equal(ranked.minStudents, 5, 'порог возвращается, чтобы его можно было назвать вслух');
});

test('среднее берётся по показанной выборке, а не по всей базе', () => {
  // Внутри одной домашки «средним» является она сама. Чужое среднее
  // перетасовало бы её задания между собой без всякой причины.
  const ranked = store.rankHardest([row('a', 10, 5), row('b', 10, 5)], { minStudents: 2 });
  assert.equal(ranked.meanFailPercent, 50);
});

test('длина списка ограничена — это подборка, а не выгрузка банка', () => {
  const many = Array.from({ length: 60 }, (_, index) => row(`t${index}`, 10, index % 10));
  const ranked = store.rankHardest(many, { minStudents: 2 });
  assert.ok(ranked.tasks.length <= 20, `в подборке ${ranked.tasks.length} заданий`);
  assert.equal(ranked.considered, 60, 'но видно, из скольких выбирали');
});

test('пустая выборка не роняет подсчёт', () => {
  const ranked = store.rankHardest([], { minStudents: 5 });
  assert.deepEqual(ranked.tasks, []);
  assert.equal(ranked.considered, 0);
});

// --------------------------------------------------------------- выборка ---

test('в счёт идёт ПЕРВАЯ попытка ученика по заданию', () => {
  // Иначе разбор ошибок и повторение занижали бы трудность: то же задание там
  // решают второй раз, уже зная ответ, и задание, которое с первого раза не
  // взял никто, выглядело бы простым.
  const uses = storeSource.split('DISTINCT ON (e.user_id, e.task_id)').length - 1;
  assert.ok(uses >= 2, `первая попытка отбирается явно (нашли ${uses} мест)`);
  const start = storeSource.indexOf('const FIRST_TRY_COLUMNS');
  assert.notEqual(start, -1, 'набор колонок первой попытки объявлен один раз');
  const grouping = storeSource.slice(storeSource.indexOf('const HARDEST_GROUPING'),
    storeSource.indexOf('`;', storeSource.indexOf('const HARDEST_GROUPING')));
  assert.match(grouping, /COUNT\(\*\) FILTER \(WHERE earned >= possible\)/,
    'взявшим считается только тот, кто получил ПОЛНЫЙ балл');
});

test('подборка домашки берёт тех же учеников и те же ответы, что и «Баллы»', () => {
  const start = storeSource.indexOf('async function assignmentResults(');
  const block = storeSource.slice(start, storeSource.indexOf('\nasync function ', start + 1));
  // Получатели — по общему правилу видимости, ответы — по общему правилу
  // зачёта. Свой запрос рядом с чужим счётом в этом файле расходился дважды.
  assert.match(block, /\$\{ASSIGNMENT_VISIBLE_SQL\}/, 'получатели те же, что в таблице результатов');
  assert.match(block, /countedAttemptSql\(\{/, 'и ответы отбираются общим правилом зачёта');
});
