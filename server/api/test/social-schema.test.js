'use strict';

// Контракт обществознания на входе. Проверяется не «валидатор работает», а
// конкретные обещания плана этапа 2: №9 выключено по умолчанию, роль себе не
// назначить, повтор события не создаёт вторую попытку, день и неделя считает
// сервер.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/subjects/social/schema');
const { pool } = require('../src/db');

test.after(() => pool.end());

const NOW = Date.parse('2026-08-12T10:00:00+03:00');

function attempt(extra = {}) {
  return schema.attemptEvent({
    eventId: 'aaaaaaaaaaaaaaaa1111',
    taskId: 'A1B2C3',
    taskType: 'choice',
    possible: 1,
    earned: 1,
    correct: true,
    ...extra,
  }, { now: NOW });
}

test('ученик не может назначить себе роль, класс или премиум', () => {
  // Белый перечень полей профиля — это и есть защита. Лишнее поле отвергает
  // запрос целиком, а не вырезается молча: «молча выкинули» невозможно заметить.
  for (const evil of [{ role: 'teacher' }, { classId: 'x' }, { premium: true }, { limit: 0 }]) {
    assert.throws(() => schema.profilePatch({ displayName: 'Иван', ...evil }), /profile_unknown_field/);
  }
  for (const evil of [{ premium: true }, { unlimited: true }, { role: 'admin' }]) {
    assert.throws(() => schema.settings(evil), /settings_unknown_field/);
  }
  // Разрешённое проходит.
  const ok = schema.profilePatch({ displayName: '  Иванов Иван  ', settings: { includeImages: true, count: 20 } });
  assert.equal(ok.displayName, 'Иванов Иван');
  assert.deepEqual(ok.settings, { includeImages: true, count: 20 });
});

test('снимок нельзя записать без baseRevision', () => {
  // Запись «поверх всего» — это способ потерять вечер работы на втором
  // устройстве. Даже первая запись обязана назвать, поверх чего она идёт.
  assert.throws(() => schema.statePut({ state: { a: 1 } }), /base_revision_required/);
  const ok = schema.statePut({ state: { a: 1 }, baseRevision: 0 });
  assert.deepEqual(ok, { state: { a: 1 }, baseRevision: 0 });
  // Клиент хранит прогресс строкой — строку тоже принимаем.
  assert.deepEqual(schema.statePut({ state: '{"a":2}', baseRevision: 5 }).state, { a: 2 });
  assert.throws(() => schema.statePut({ state: '{нет', baseRevision: 1 }), /state_invalid_json/);
  assert.throws(() => schema.statePut({ state: [1, 2], baseRevision: 1 }), /state_must_be_object/);
});

test('день и неделя события считаются по Москве сервером', () => {
  // 12.08.2026 — среда. Понедельник её недели — 10 августа.
  const event = attempt();
  assert.equal(event.mskDay, '2026-08-12');
  assert.equal(event.weekStart, '2026-08-10');

  // Ночь понедельника по Москве — это уже новая неделя, хотя в UTC ещё
  // воскресенье. Ровно на этом ломался недельный топ истории.
  const night = attempt({ attemptedAt: Date.parse('2026-08-10T00:30:00+03:00'), eventId: 'bbbbbbbbbbbbbbbb2222' });
  assert.equal(night.weekStart, '2026-08-10');
  assert.equal(night.mskDay, '2026-08-10');
});

test('время попытки не может быть из будущего', () => {
  // Иначе переводом часов на телефоне работа переносилась бы в следующую неделю
  // рейтинга, а дневная квота обнулялась бы по желанию.
  const future = attempt({ attemptedAt: NOW + 5 * 24 * 60 * 60 * 1000 });
  assert.equal(future.attemptedAt, NOW);
  const ancient = attempt({ attemptedAt: NOW - 400 * 24 * 60 * 60 * 1000 });
  assert.ok(ancient.attemptedAt >= NOW - 31 * 24 * 60 * 60 * 1000, 'слишком старое подтягивается к границе очереди');
});

test('баллы события зажаты в разумные границы', () => {
  assert.equal(attempt({ earned: 99, possible: 5 }).earned, 5, 'набрать больше возможного нельзя');
  assert.equal(attempt({ earned: -3 }).earned, 0);
  assert.equal(attempt({ possible: 0 }).possible, 1);
  assert.equal(attempt({ possible: 9999 }).possible, 30);
});

test('в пачке попыток дубликаты по eventId схлопываются', () => {
  // База отсекла бы их по PRIMARY KEY, но тогда вся пачка ушла бы в конфликт.
  const events = schema.attemptBatch({
    events: [
      { eventId: 'aaaaaaaaaaaaaaaa1111', taskId: 'A1B2C3', possible: 1, earned: 1 },
      { eventId: 'aaaaaaaaaaaaaaaa1111', taskId: 'A1B2C3', possible: 1, earned: 1 },
      { eventId: 'cccccccccccccccc3333', taskId: 'B2C3D4', possible: 1, earned: 0 },
    ],
  }, { now: NOW });
  assert.equal(events.length, 2);
});

test('пачка попыток ограничена сверху', () => {
  const many = Array.from({ length: 51 }, (_, i) => ({ eventId: `event${String(i).padStart(15, '0')}`, taskId: 'A1' }));
  assert.throws(() => schema.attemptBatch({ events: many }, { now: NOW }), /too_many_events/);
  assert.throws(() => schema.attemptBatch({ events: [] }), /events_required/);
});

test('фильтры ДЗ принимают только реальные типы, блоки и темы предмета', () => {
  assert.deepEqual(schema.typeList(['choice', 'task1', 'choice']), ['choice', 'task1']);
  assert.throws(() => schema.typeList(['task9']), /types_unknown_value/);
  assert.deepEqual(schema.blockList(['5', '1']), ['1', '5']);
  assert.throws(() => schema.blockList(['6']), /blocks_unknown_value/);
  assert.deepEqual(schema.topicList(['2.7', '2.7', '1.1']), ['1.1', '2.7']);
  assert.throws(() => schema.topicList(['7.1']), /topics_unknown_value/);
  // Исторические периоды в контракт обществознания не попадают вовсе.
  assert.throws(() => schema.topicList(['862-1236']), /topics_unknown_value/);
});

test('№9 выключено по умолчанию и включается только явной настройкой', () => {
  const plain = schema.assignmentCreate({ classId: 'c-1', topics: ['1.1'] }, { now: NOW });
  assert.equal(plain.includeImages, false, 'забытое поле не имеет права включить графики');
  const explicit = schema.assignmentCreate({ classId: 'c-1', includeImages: true }, { now: NOW });
  assert.equal(explicit.includeImages, true);
});

test('срок ДЗ не может быть в прошлом', () => {
  // Иначе ученик открывает домашку уже просроченной и не понимает, что делать.
  assert.throws(() => schema.assignmentCreate(
    { classId: 'c-1', dueAt: new Date(NOW - 1000).toISOString() }, { now: NOW }), /due_at_must_be_future/);
  const ok = schema.assignmentCreate({ classId: 'c-1', dueAt: new Date(NOW + 86400000).toISOString() }, { now: NOW });
  assert.equal(new Date(ok.dueAt).getTime(), NOW + 86400000);
});

test('фильтры выданного ДЗ не переписываются задним числом', () => {
  // Смена условий после выдачи переписала бы уже засчитанное выполнение.
  for (const evil of [{ topics: ['1.1'] }, { types: ['choice'] }, { blocks: ['2'] }, { includeImages: true }]) {
    assert.throws(() => schema.assignmentPatch(evil, { now: NOW }), /assignment_unknown_field/);
  }
  assert.deepEqual(schema.assignmentPatch({ status: 'cancelled' }, { now: NOW }), { status: 'cancelled' });
});

test('код приглашения читается с доски и не содержит путающихся символов', () => {
  assert.equal(schema.joinCode(' abcd-2345 '), 'ABCD2345');
  for (const bad of ['ABCD', 'ABCD23450', 'ABCDO234', 'ABCD1234', 'ABCDI234', '']) {
    assert.throws(() => schema.joinCode(bad), /join_code_invalid/, `принят кривой код: ${bad}`);
  }
  assert.ok(!schema.JOIN_CODE_ALPHABET.includes('0'));
  assert.ok(!schema.JOIN_CODE_ALPHABET.includes('O'));
  assert.ok(!schema.JOIN_CODE_ALPHABET.includes('1'));
});
