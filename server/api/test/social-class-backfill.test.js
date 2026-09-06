'use strict';

// Что получает ученик, вступивший в класс ПОСЛЕ выдачи домашки.
//
// Раньше — всё: запросы выдачи сравнивали только «состоит в классе» и «домашка
// активна», даты входа не касались вовсе. Для курса по темам это верно, для
// класса с работой к уроку — мусор: новичок получал пачку чужих работ, часть
// сразу «просрочено», и тянул вниз успешность класса в таблице учителя.
//
// Правило выбирает учитель у КЛАССА: all / undue / new (миграция 014).

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const schema = require('../src/subjects/social/schema');
const { pool } = require('../src/db');

test.after(() => pool.end());

const root = path.join(__dirname, '..');
const storeSource = fs.readFileSync(path.join(root, 'src', 'subjects', 'social', 'store.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '014_social_class_backfill.sql'), 'utf8');

// ------------------------------------------------------------ миграция ---

test('поле класса с закрытым перечнем значений', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS backfill text NOT NULL DEFAULT 'undue'/);
  assert.match(migration, /CHECK \(backfill IN \('all', 'undue', 'new'\)\)/);
  // Умолчание достаётся и существующим классам — это осознанно и проверено на
  // живых данных; см. комментарий миграции.
  assert.ok(!/DROP\s+(TABLE|COLUMN)/i.test(migration), 'миграция ничего не теряет');
});

// -------------------------------------------------------------- правило ---

test('правило видимости написано ОДИН раз и применено везде', () => {
  // 🔴 Пять запросов должны отвечать одинаково: что видит ученик, что ему
  // засчитывается, кого считать в таблице учителя, чьи задания варианта
  // отдавать и по скольким людям считать сводку бота. Разъехавшиеся копии
  // одного правила в этом проекте уже стоили дважды.
  assert.ok(storeSource.includes('const ASSIGNMENT_VISIBLE_SQL'), 'правило вынесено в константу');
  const uses = storeSource.split('${ASSIGNMENT_VISIBLE_SQL}').length - 1;
  assert.equal(uses, 5, `правило подставлено в пять запросов, а не в ${uses}`);
});

test('в правиле есть все три режима и оговорка «уже работал»', () => {
  const start = storeSource.indexOf('const ASSIGNMENT_VISIBLE_SQL');
  const block = storeSource.slice(start, storeSource.indexOf('`;', start));
  assert.match(block, /a\.issued_at >= m\.joined_at/, 'выданное при ученике видно всегда');
  assert.match(block, /c\.backfill = 'all'/);
  assert.match(block, /c\.backfill = 'undue' AND \(a\.due_at IS NULL OR a\.due_at >= m\.joined_at\)/);
  // 🔴 Главная ветка: сделанного не отбираем. Без неё смена настройки убрала бы
  // с экрана работу, которую ученик уже сдал.
  assert.match(block, /EXISTS \(SELECT 1 FROM social_assignment_progress pv/);
  // «new» отдельной ветки не имеет намеренно: это отсутствие всех остальных.
  assert.ok(!/c\.backfill = 'new'/.test(block), '«только новые» — это когда не сработала ни одна ветка');
});

test('счёт и показ используют одно правило', () => {
  // Если домашку не показали, она не имеет права и засчитывать ответы: иначе
  // ученик работает «в никуда», а у учителя растут числа по невыданной работе.
  for (const fn of ['activeAssignmentsFor', 'studentAssignments']) {
    const start = storeSource.indexOf(`async function ${fn}(`);
    const block = storeSource.slice(start, storeSource.indexOf('\n}', start));
    assert.ok(block.includes('${ASSIGNMENT_VISIBLE_SQL}'), `${fn} обязана применять правило`);
  }
});

// --------------------------------------------------------------- схема ---

test('перечень значений закрыт', () => {
  assert.deepEqual(schema.classPatch({ backfill: 'all' }), { backfill: 'all' });
  assert.deepEqual(schema.classPatch({ backfill: 'undue' }), { backfill: 'undue' });
  assert.deepEqual(schema.classPatch({ backfill: 'new' }), { backfill: 'new' });
  assert.throws(() => schema.classPatch({ backfill: 'everything' }), /class_backfill_unknown/);
  assert.throws(() => schema.classPatch({ backfill: '' }), /class_backfill_unknown/);
  // Неизвестное поле по-прежнему отвергается целиком — опечатка в имени не
  // должна тихо ничего не делать.
  assert.throws(() => schema.classPatch({ backfil: 'all' }), /class_unknown_field/);
});

test('настройка меняется отдельно от названия', () => {
  assert.deepEqual(schema.classPatch({ title: 'Класс', backfill: 'new' }), { title: 'Класс', backfill: 'new' });
});
