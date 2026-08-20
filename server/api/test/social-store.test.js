'use strict';

// Данные обществознания на подставном соединении.
//
// Что здесь ДЕЙСТВИТЕЛЬНО проверяется: какой SQL сервер считает источником
// правды. Настоящую атомарность параллельных записей без живой базы проверить
// нельзя — её обеспечивает форма операторов (одно INSERT ... ON CONFLICT ...
// WHERE вместо пары SELECT+UPDATE), и именно эта форма здесь и закрепляется.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const USER = '11111111-1111-1111-1111-111111111111';

function event(extra = {}) {
  return {
    eventId: 'aaaaaaaaaaaaaaaa1111',
    taskId: 'A1B2C3',
    taskType: 'choice',
    blockIds: ['2'],
    topicCodes: ['2.7'],
    hasImages: false,
    correct: true,
    earned: 1,
    possible: 1,
    elapsedMs: 5000,
    kind: 'practice',
    examLine: 0,
    attemptedAt: Date.parse('2026-08-12T10:00:00+03:00'),
    mskDay: '2026-08-12',
    weekStart: '2026-08-10',
    ...extra,
  };
}

// Подставное соединение: помнит, какие event_id уже «в базе», и ведёт журнал
// выполненных операторов.
function fakeDb({ knownEvents = [], assignments = [], state = null } = {}) {
  const seen = new Set(knownEvents);
  const log = [];
  const db = {
    log,
    seen,
    async query(sql, params = []) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      log.push({ sql: flat, params });
      if (flat.startsWith('INSERT INTO social_attempt_events')) {
        const id = params[0];
        if (seen.has(id)) return { rows: [], rowCount: 0 };
        seen.add(id);
        return { rows: [{ event_id: id }], rowCount: 1 };
      }
      if (flat.startsWith('INSERT INTO social_weekly_scores')) return { rows: [], rowCount: 1 };
      if (flat.includes('FROM social_assignments a')) return { rows: assignments, rowCount: assignments.length };
      // «Только что сдал» читается ДО апсерта — см. store.js. Ни одна фикстура
      // здесь не доводит ДЗ до 'done', так что это всегда «раньше не сдавал».
      if (flat.startsWith('SELECT earned, possible, questions, status, completed_at FROM social_assignment_progress')) return { rows: [], rowCount: 0 };
      if (flat.startsWith('INSERT INTO social_assignment_progress')) {
        return { rows: [{ earned: 3, possible: 5, questions: 4, status: 'active', completed_at: null }], rowCount: 1 };
      }
      if (flat.startsWith('INSERT INTO social_states')) {
        return state && state.revision !== params[2] ? { rows: [], rowCount: 0 } : { rows: [{ revision: (state?.revision || 0) + 1, updated_at: new Date() }], rowCount: 1 };
      }
      if (flat.startsWith('SELECT data, revision')) {
        return state ? { rows: [{ data: state.data, revision: state.revision, updated_at: new Date() }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (flat.startsWith('SELECT role FROM social_profiles')) return { rows: [{ role: db.role || 'student' }], rowCount: 1 };
      if (flat.includes('AS reset_at')) {
        return { rows: [{ used: db.used || 0, reset_at: '2026-08-13T00:00:00+03:00' }], rowCount: 1 };
      }
      if (flat.startsWith('INSERT INTO social_usage_counters')) {
        const [, , amount, limit] = params;
        if ((db.used || 0) >= limit) return { rows: [], rowCount: 0 };
        db.used = (db.used || 0) + amount;
        return { rows: [{ count: db.used }], rowCount: 1 };
      }
      if (flat.includes('FROM social_weekly_scores w')) {
        return { rows: db.leaderboardRows || [], rowCount: (db.leaderboardRows || []).length };
      }
      throw new Error('неожиданный запрос: ' + flat.slice(0, 80));
    },
  };
  return db;
}

const transactOn = db => fn => fn(db);

const ASSIGNMENT = {
  id: 'aaaa1111-2222-3333-4444-555566667777',
  title: 'Экономика',
  types: [],
  blocks: ['2'],
  topics: [],
  question_goal: 10,
  include_images: false,
  issued_at: '2026-08-11T09:00:00+03:00',
  class_id: 'cccc1111-2222-3333-4444-555566667777',
};

test('повторная доставка очереди не создаёт вторую попытку', async () => {
  // Ученик занимался в метро, очередь ушла дважды: приложение перезапустилось,
  // ответ первого запроса не дошёл. Вторая доставка обязана быть пустой.
  const db = fakeDb({ assignments: [ASSIGNMENT] });
  const first = await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  assert.equal(first.accepted, 1);
  assert.equal(first.duplicates, 0);

  const second = await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  assert.equal(second.accepted, 0);
  assert.equal(second.duplicates, 1);
  assert.deepEqual(second.assignments, [], 'по нулю принятых событий пересчитывать нечего');

  // Ни одного лишнего начисления в недельный рейтинг.
  const weekly = db.log.filter(item => item.sql.startsWith('INSERT INTO social_weekly_scores'));
  assert.equal(weekly.length, 1, 'дубликат не имеет права начислить баллы повторно');
});

test('идемпотентность держится ограничением базы, а не проверкой в коде', async () => {
  const db = fakeDb();
  await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  const insert = db.log.find(item => item.sql.startsWith('INSERT INTO social_attempt_events'));
  assert.match(insert.sql, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(insert.sql, /RETURNING event_id/, 'принятой считается только реально вставленная строка');
});

test('баллы ДЗ считаются по событиям, а не по суммам клиента', async () => {
  const db = fakeDb({ assignments: [ASSIGNMENT] });
  const result = await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  assert.equal(result.assignments.length, 1);
  assert.deepEqual(result.assignments[0], {
    assignmentId: ASSIGNMENT.id,
    title: 'Экономика',
    earned: 3, possible: 5, questions: 4, questionGoal: 10,
    status: 'active', completedAt: null,
  });

  const recompute = db.log.find(item => item.sql.startsWith('INSERT INTO social_assignment_progress'));
  assert.match(recompute.sql, /FROM social_attempt_events/, 'источник — таблица событий');
  // Дедупликация по стабильному ID: задание с двумя темами КЭС не закрывает цель дважды.
  assert.match(recompute.sql, /SELECT DISTINCT ON \(e\.task_id\)/);
  // Считается ПЕРВАЯ попытка: пересдача до победного не накручивает баллы.
  assert.match(recompute.sql, /ORDER BY e\.task_id, e\.attempted_at/);
  // Только работа ПОСЛЕ выдачи задания.
  assert.match(recompute.sql, /e\.attempted_at >= \$4/);
  // №9 попадает в зачёт только у ДЗ, где графики включены явно.
  assert.match(recompute.sql, /\$8::boolean OR e\.has_images = false/);
});

test('ДЗ засчитывает только работу после выдачи', async () => {
  const db = fakeDb({ assignments: [ASSIGNMENT] });
  await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  const recompute = db.log.find(item => item.sql.startsWith('INSERT INTO social_assignment_progress'));
  assert.equal(recompute.params[3], ASSIGNMENT.issued_at, 'границей служит момент выдачи задания');
});

test('в пересчёт попадают только активные ДЗ активных классов ученика', async () => {
  const db = fakeDb({ assignments: [] });
  await store.saveAttempts(USER, [event()], { db, transact: transactOn(db) });
  const lookup = db.log.find(item => item.sql.includes('FROM social_assignments a'));
  assert.match(lookup.sql, /JOIN social_class_members m ON m\.class_id = a\.class_id AND m\.user_id = \$1 AND m\.status = 'active'/);
  assert.match(lookup.sql, /JOIN social_classes c ON c\.id = a\.class_id AND c\.status = 'active'/);
  assert.match(lookup.sql, /WHERE a\.status = 'active'/);
});

test('снимок с чужим baseRevision не затирает работу второго устройства', async () => {
  const db = fakeDb({ state: { data: { tasks: { A: 1 } }, revision: 7 } });
  const conflict = await store.putState(USER, { tasks: {} }, 5, { db });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.revision, 7, 'клиенту возвращается актуальный снимок для слияния');
  assert.deepEqual(conflict.state, { tasks: { A: 1 } });

  const ok = await store.putState(USER, { tasks: {} }, 7, { db });
  assert.equal(ok.ok, true);
  assert.equal(ok.revision, 8);

  const insert = db.log.find(item => item.sql.startsWith('INSERT INTO social_states'));
  assert.match(insert.sql, /WHERE social_states\.revision = \$3/, 'проверка ревизии обязана быть в том же операторе');
});

test('квота обществознания считается своим счётчиком и по Москве', async () => {
  const db = fakeDb();
  const state = await store.quotaState(USER, { db, limits: { freeDaily: 30 } });
  assert.equal(state.limit, 30);
  assert.equal(state.left, 30);
  assert.ok(db.log.every(item => !item.sql.includes('CURRENT_DATE')));
  assert.ok(db.log.some(item => item.sql.includes("AT TIME ZONE 'Europe/Moscow'")));
  // Ни одного обращения к счётчикам истории.
  assert.ok(db.log.every(item => !/(?<![A-Za-z0-9_])usage_counters/.test(item.sql)));
});

test('расход списывается одним оператором и не уходит в минус', async () => {
  const db = fakeDb();
  const first = await store.consumeQuota(USER, 4, { db, limits: { freeDaily: 5 } });
  assert.equal(first.ok, true);
  assert.equal(first.left, 1);
  const second = await store.consumeQuota(USER, 4, { db, limits: { freeDaily: 5 } });
  assert.equal(second.ok, true, 'до предела расход проходит');
  const third = await store.consumeQuota(USER, 4, { db, limits: { freeDaily: 5 } });
  assert.equal(third.ok, false);
  assert.equal(third.left, 0);
  const insert = db.log.find(item => item.sql.startsWith('INSERT INTO social_usage_counters'));
  assert.match(insert.sql, /WHERE social_usage_counters\.count < \$4/);
});

test('учитель и админ предмета освобождены от квоты', async () => {
  const db = fakeDb();
  db.role = 'teacher';
  assert.equal((await store.quotaState(USER, { db, limits: { freeDaily: 30 } })).limit, 0);
  db.role = 'admin';
  assert.equal((await store.quotaState(USER, { db, limits: { freeDaily: 30 } })).limit, 0);
  db.role = 'student';
  assert.equal((await store.quotaState(USER, { db, limits: { freeDaily: 30 } })).limit, 30);
});

test('рейтинг не отдаёт ни полного имени, ни идентификатора', async () => {
  const db = fakeDb();
  db.leaderboardRows = [
    { user_id: USER, points: 40, questions: 30, display_name: 'Иванов Иван, 11 «А»' },
    { user_id: 'other', points: 10, questions: 12, display_name: 'Петрова Анна' },
  ];
  const board = await store.weeklyLeaderboard(USER, { db, weekStart: '2026-08-10' });
  assert.equal(board.rows[0].displayName, 'Иван И.');
  assert.equal(board.rows[1].displayName, 'Анна П.');
  assert.equal(board.rows[0].you, true);
  assert.equal(board.rows[1].you, false);
  for (const row of board.rows) {
    assert.ok(!('userId' in row) && !('user_id' in row), 'идентификатор наружу не уходит');
  }
});

test('код приглашения набирается с доски без путающихся символов', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = store.randomJoinCode();
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  }
});

test('чужой класс не отличить от несуществующего', async () => {
  // Разный ответ на «не твой» и «нет такого» выдал бы посторонним сам факт
  // существования класса, а по нему — что школа вообще есть в системе.
  const db = { async query() { return { rows: [], rowCount: 0 }; } };
  await assert.rejects(() => store.ownedClass(USER, 'any', { db }), error => {
    assert.equal(error.message, 'class_not_found');
    assert.equal(error.statusCode, 404);
    return true;
  });
});
