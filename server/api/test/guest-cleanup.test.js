'use strict';

// Регрессия на уборку гостей.
//
// ⚠️ Здесь проверяется не «удаляется ли мусор», а «НЕ удаляется ли живое».
// Ошибка в эту сторону необратима и незаметна: человек просто однажды обнаружит,
// что его прогресс исчез, и связать это с уборкой будет уже нечем.
//
// Замер на проде 27.07.2026, из-за которого условие именно такое:
//   legacy   1172  — перенесённые миграцией из Firebase, это ЖИВЫЕ ученики
//   guest      75  — настоящие гости
//   telegram   73
//   google     14
//   без личности вовсе  313
// Правило из плана («нет telegram/google») удалило бы всю строку legacy.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STALE_GUEST_WHERE, countStaleGuests, deleteStaleGuests } = require('../src/guest-cleanup');
const { pool } = require('../src/db');

test.after(() => pool.end());

test('гостевая личность обязана СУЩЕСТВОВАТЬ, а не просто отсутствовать чужая', () => {
  // Ровно та ошибка, которую предлагал план: «нет telegram/google» ловит и
  // мигрированных (legacy), и пользователей вообще без личностей.
  assert.match(STALE_GUEST_WHERE, /EXISTS \(SELECT 1 FROM user_identities i WHERE i\.user_id = u\.id AND i\.provider = 'guest'\)/,
    'без этого условия под уборку попадут мигрированные ученики');
  assert.match(STALE_GUEST_WHERE, /NOT EXISTS \(SELECT 1 FROM user_identities i WHERE i\.user_id = u\.id AND i\.provider <> 'guest'\)/,
    'гость, вошедший потом через Telegram, гостем быть перестал');
});

test('legacy и пользователи без личностей под условие не подпадают', () => {
  // legacy — это provider <> 'guest', значит второе условие их отсекает.
  // Пользователь совсем без личностей не проходит первое условие (EXISTS).
  assert.ok(!/provider IN \('telegram','google'\)/.test(STALE_GUEST_WHERE),
    'проверка по telegram/google — это и есть ошибка плана, её тут быть не должно');
});

test('любой признак жизни спасает аккаунт', () => {
  for (const marker of ['totalSolved', 'classCode', 'inviteClassCode', 'googleEmail', 'fullStateJson']) {
    assert.ok(STALE_GUEST_WHERE.includes(marker), `не проверяется признак жизни: ${marker}`);
  }
  // Прогресс живёт и в приватном состоянии, не только в профиле.
  assert.match(STALE_GUEST_WHERE, /FROM student_states s/);
});

test('totalSolved сравнивается текстом, без приведения к числу', () => {
  // Приведение падает на нечисловом значении и уронило бы всю уборку целиком;
  // текстовое сравнение в сомнительном случае оставляет пользователя.
  assert.ok(!/totalSolved'\)::numeric/.test(STALE_GUEST_WHERE),
    'приведение к numeric здесь опасно — одно кривое значение убьёт весь проход');
  assert.match(STALE_GUEST_WHERE, /COALESCE\(p\.data->>'totalSolved', '0'\) <> '0'/);
});

test('возраст задаётся параметром, а не подставляется в текст запроса', () => {
  assert.match(STALE_GUEST_WHERE, /\$1 \|\| ' days'/);
});

// ── поведение функций ──

function fakeDb(rows = 0) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: [{ total: rows }], rowCount: rows };
    },
  };
}

test('подсчёт и удаление используют ОДНО И ТО ЖЕ условие', async () => {
  const db = fakeDb(7);
  await countStaleGuests(30, { db });
  await deleteStaleGuests(30, { db });
  const normalized = STALE_GUEST_WHERE.replace(/\s+/g, ' ').trim();
  assert.ok(db.calls[0].sql.includes(normalized), 'подсчёт использует общее условие');
  assert.ok(db.calls[1].sql.includes(normalized), 'удаление использует то же условие');
  // Показать пользователю одно число, а удалить другое — худшее, что тут возможно.
});

test('удаление идёт порциями', async () => {
  const db = fakeDb(0);
  await deleteStaleGuests(30, { db, limit: 500 });
  assert.match(db.calls[0].sql, /LIMIT 500/, 'разовое удаление тысяч строк держало бы блокировки');
});

test('срок по умолчанию — 30 дней', async () => {
  const db = fakeDb(0);
  await countStaleGuests(undefined, { db });
  assert.deepEqual(db.calls[0].params, ['30']);
});
