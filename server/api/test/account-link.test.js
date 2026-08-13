'use strict';

// Слияние аккаунтов и узнавание человека из эпохи Firebase.
//
// 🔴 Почему это отдельный файл с проверкой ТЕКСТА и подставным соединением.
// 13.08.2026 нашлись две тихие поломки сразу:
//   * `mergeUsers` переносил только таблицы истории — он написан до появления
//     обществознания, и слияние молча оставляло на отключаемом аккаунте
//     прогресс, роль учителя, классы, домашки и свои задания;
//   * google-личности из Firebase импортированы с firebase uid в subject, а
//     настоящий Google присылает числовой sub, поэтому первый же вход через
//     Google заводил человеку второй, пустой аккаунт.
// Обе видны только постфактум: приложение работает, данные «просто не те».

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/subjects/social/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const PRIMARY = '11111111-1111-1111-1111-111111111111';
const SECONDARY = '22222222-2222-2222-2222-222222222222';

function recordingClient() {
  const log = [];
  return {
    log,
    async query(sql, params = []) {
      log.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows: [], rowCount: 0 };
    },
  };
}

// --------------------------------------------------------- перенос данных --

test('слияние переносит ВСЕ предметные таблицы', async () => {
  const client = recordingClient();
  await store.mergeUserData(client, PRIMARY, SECONDARY);
  const text = client.log.map(entry => entry.sql).join('\n');

  // Список сверяется с миграциями, а не переписывается руками: забытая таблица —
  // это потерянные данные человека, и заметить это можно только по жалобе.
  //
  // Переносить нужно ровно те таблицы, у которых есть колонка владельца.
  // `social_assignment_tasks` (состав варианта) владельца не имеет и переезжает
  // сама — вместе со своим заданием, у которого id не меняется.
  const migrations = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter(name => /^00[567]_/.test(name))
    .map(name => fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8'))
    .join('\n');
  const blocks = [...migrations.matchAll(/CREATE TABLE IF NOT EXISTS\s+(social_[a-z_]+)\s*\(([\s\S]*?)\n\);/g)];
  assert.ok(blocks.length >= 10, 'таблицы предмета должны читаться из миграций');
  const owned = blocks.filter(([, , body]) => /\b(user_id|teacher_user_id)\b/.test(body)).map(([, table]) => table);
  assert.ok(owned.length >= 9, 'таблиц с владельцем должно быть большинство');
  for (const table of owned) {
    assert.ok(text.includes(table), `слияние не трогает ${table} — данные останутся на отключённом аккаунте`);
  }
  // 🔴 Направление переноса. Перепутанные местами аргументы означают, что данные
  // уедут на отключаемый аккаунт, а живой останется пустым, — и по логам это
  // выглядит как успешное слияние.
  for (const entry of client.log) {
    if (entry.sql.startsWith('DELETE FROM')) {
      assert.deepEqual(entry.params, [SECONDARY], 'удалять можно только хвосты второго аккаунта');
      continue;
    }
    assert.deepEqual(entry.params, [PRIMARY, SECONDARY], 'перенос всегда идёт из второго аккаунта в первый');
  }
});

test('роль учителя при слиянии повышается, а не теряется', async () => {
  const client = recordingClient();
  await store.mergeUserData(client, PRIMARY, SECONDARY);
  const profile = client.log.find(entry => entry.sql.includes('INSERT INTO social_profiles'));
  assert.ok(profile, 'профиль обязан переноситься');
  // Учитель, слитый в аккаунт ученика, обязан остаться учителем: иначе слияние
  // молча отнимает доступ к классам, и восстановить его может только админ.
  assert.match(profile.sql, /role = CASE/);
  assert.match(profile.sql, /EXCLUDED\.role = 'admin' THEN 'admin'/);
  assert.match(profile.sql, /EXCLUDED\.role = 'teacher' THEN 'teacher'/);
});

test('выполнение домашки при слиянии не ухудшается', async () => {
  const client = recordingClient();
  await store.mergeUserData(client, PRIMARY, SECONDARY);
  const progress = client.log.find(entry => entry.sql.includes('INSERT INTO social_assignment_progress'));
  assert.ok(progress);
  assert.match(progress.sql, /earned = GREATEST/);
  assert.match(progress.sql, /questions = GREATEST/);
  assert.match(progress.sql, /status = CASE WHEN social_assignment_progress\.status = 'done' OR EXCLUDED\.status = 'done' THEN 'done'/);
});

test('попытки переносятся целиком: они источник баллов', async () => {
  const client = recordingClient();
  await store.mergeUserData(client, PRIMARY, SECONDARY);
  const events = client.log.find(entry => entry.sql.includes('social_attempt_events'));
  assert.ok(events);
  assert.match(events.sql, /^UPDATE social_attempt_events SET user_id=\$1 WHERE user_id=\$2$/);
});

test('хвосты на втором аккаунте удаляются явно', async () => {
  // Строки с составным ключом копируются, а не переносятся. Без явного удаления
  // они уехали бы в каскад при следующем удалении аккаунта.
  const client = recordingClient();
  await store.mergeUserData(client, PRIMARY, SECONDARY);
  const deletes = client.log.filter(entry => entry.sql.startsWith('DELETE FROM'));
  const tables = deletes.map(entry => entry.sql.match(/DELETE FROM (\w+)/)[1]);
  for (const table of ['social_class_members', 'social_assignment_progress', 'social_usage_counters', 'social_weekly_scores']) {
    assert.ok(tables.includes(table), `${table}: копия осталась бы на втором аккаунте`);
  }
});

// ------------------------------------------------------- узнавание по почте --

const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');

test('mergeUsers обязан звать перенос предметных данных', () => {
  const start = authSource.indexOf('async function mergeUsers(');
  const block = authSource.slice(start, authSource.indexOf('\nasync function', start + 1));
  assert.match(block, /mergeUserData\(client, primaryId, secondaryId\)/);
  // Порядок важен: сначала данные, потом перепривязка личностей и отключение.
  assert.ok(block.indexOf('mergeUserData') < block.indexOf('disabled_at=now()'),
    'данные обязаны переехать до отключения второго аккаунта');
});

test('поиск аккаунта по почте требует google-личности и единственного кандидата', () => {
  const start = authSource.indexOf('async function findLegacyAccountByEmail(');
  const block = authSource.slice(start, authSource.indexOf('\nasync function', start + 1));
  // Почта без уже существующей google-личности — это чужой человек с той же
  // почтой в профиле; связывать по ней нельзя.
  assert.match(block, /i\.provider = 'google'/);
  assert.match(block, /result\.rowCount === 1/);
  assert.match(block, /disabled_at IS NULL/);
  assert.match(block, /lower\(u\.email\) = \$1/);
});

test('связывание по почте включено ТОЛЬКО для Google', () => {
  // У Telegram почты нет вовсе, у гостя тем более. Разрешить это всем
  // провайдерам значит отдать аккаунт любому, кто впишет чужой адрес.
  assert.match(authSource, /linkByVerifiedEmail = false/, 'по умолчанию связывание выключено');
  const enabled = [...authSource.matchAll(/linkByVerifiedEmail:\s*true/g)];
  assert.equal(enabled.length, 1, 'включать связывание разрешено ровно в одном месте — в google-ветке');
  const googleStart = authSource.indexOf('async function finishGoogle(');
  const googleBlock = authSource.slice(googleStart, authSource.indexOf('\nmodule.exports', googleStart));
  assert.match(googleBlock, /linkByVerifiedEmail: true/);
  // Признак подтверждённой почты обязан проверяться до связывания.
  assert.ok(googleBlock.indexOf('email_verified') < googleBlock.indexOf('linkByVerifiedEmail'),
    'связываем только подтверждённую Google почту');
});
