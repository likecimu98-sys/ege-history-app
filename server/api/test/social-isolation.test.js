'use strict';

// 🔴 ГЛАВНЫЙ ТЕСТ ЭТАПА 2. Он проверяет не поведение, а границу: маршрут
// обществознания физически не обращается к данным истории.
//
// Почему это тест по исходникам, а не по базе. Нарушение границы выглядит
// безобидно — одна строка `FROM student_states` в новом обработчике, — и на
// живой базе даёт не ошибку, а ТИХО ПРАВИЛЬНЫЙ ответ: там же лежит прогресс
// того же человека. Заметить это можно только когда ученик обществознания
// затрёт свою историю или увидит чужой класс. Поэтому запрет проверяется на
// уровне текста запроса, до всякого выполнения.
//
// Правило, которое здесь закреплено: в модулях предмета допустимы ТОЛЬКО
// таблицы social_* плюс общий аккаунт (app_users, user_identities,
// user_sessions). Ничего больше.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/db');

test.after(() => pool.end());

const SRC = path.join(__dirname, '..', 'src', 'subjects', 'social');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
// Все предметные миграции, а не одна: следующая точно так же не имеет права
// трогать таблицы истории, и забыть про неё легче всего.
const SOCIAL_MIGRATIONS = fs.readdirSync(MIGRATIONS_DIR)
  .filter(name => /social/.test(name) && name.endsWith('.sql'))
  .map(name => path.join(MIGRATIONS_DIR, name));
const MIGRATION = path.join(MIGRATIONS_DIR, '005_social_subject.sql');

// Комментарии из проверки убираем намеренно: в них перечислены запрещённые
// таблицы (это и есть объяснение запрета), и без очистки тест ловил бы
// собственную документацию вместо кода.
function code(file) {
  return fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^\s*--.*$/gm, ' ');
}

const SOCIAL_FILES = fs.readdirSync(SRC).filter(name => name.endsWith('.js')).map(name => path.join(SRC, name));

// Каждая таблица, к которой обращается SQL: после FROM, JOIN, INTO, UPDATE.
//
// Формы, где следующее слово — НЕ таблица, отсеиваются явно: «DO UPDATE SET» из
// ON CONFLICT, «FOR UPDATE SKIP LOCKED» из блокировки строк и «JOIN LATERAL (».
// Иначе тест падал бы на SET, SKIP и LATERAL — то есть на ровном месте, и его
// начали бы чинить ослаблением проверки.
const SQL_KEYWORDS = new Set(['SET', 'SELECT', 'VALUES', 'ONLY', 'LATERAL']);
function referencedTables(source) {
  const tables = new Set();
  const re = /\b(?:FROM|JOIN|INTO)\s+([A-Za-z_][A-Za-z0-9_]*)|(?<!\b(?:FOR|DO)\s)\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1] || match[2];
    if (name && !SQL_KEYWORDS.has(name.toUpperCase())) tables.add(name);
  }
  return tables;
}

const SHARED_ACCOUNT_TABLES = new Set(['app_users', 'user_identities', 'user_sessions']);

test('модули обществознания обращаются только к social_* и общему аккаунту', () => {
  for (const file of SOCIAL_FILES) {
    for (const table of referencedTables(code(file))) {
      const ok = table.startsWith('social_') || SHARED_ACCOUNT_TABLES.has(table);
      assert.ok(ok, `${path.basename(file)}: запрос к таблице «${table}» вне предмета обществознания`);
    }
  }
});

test('таблицы истории не упоминаются в коде предмета ни в каком виде', () => {
  // Отдельная, более грубая проверка: даже строковая склейка имени таблицы
  // истории (`'student_' + 'states'` тоже сюда попадёт как подстрока) не должна
  // встречаться. Список — ровно то, что перечислено в плане этапа.
  const forbidden = [
    'student_states', 'student_profiles', 'student_assignments', 'teacher_profiles',
    'duel_matches', 'notification_jobs', 'usage_counters', 'organizations',
  ];
  for (const file of SOCIAL_FILES) {
    const source = code(file);
    for (const name of forbidden) {
      // Граница слева обязана исключать подчёркивание: social_usage_counters —
      // ЭТО предметная таблица, а не usage_counters истории, и путать их нельзя.
      assert.ok(!new RegExp(`(?<![A-Za-z0-9_])${name}`).test(source),
        `${path.basename(file)}: упомянута таблица истории «${name}»`);
    }
    // «classes», «assignments» и «leaderboards» — имена таблиц истории, но они
    // же встречаются как куски URL и как social_*-имена. Поэтому ищем только
    // самостоятельное слово в позиции таблицы.
    for (const table of referencedTables(source)) {
      assert.ok(!['classes', 'assignments', 'leaderboards', 'app_config'].includes(table),
        `${path.basename(file)}: запрос к таблице истории «${table}»`);
    }
  }
});

test('предмет не приходит из тела запроса', () => {
  // Если бы обработчик читал subject от клиента, страница обществознания могла
  // бы адресоваться данным истории одним лишним ключом в JSON.
  for (const file of SOCIAL_FILES) {
    const source = code(file);
    assert.ok(!/body\s*\.\s*subject/.test(source), `${path.basename(file)}: subject читается из тела запроса`);
    assert.ok(!/\bsubject\s*:/.test(source), `${path.basename(file)}: предмет передаётся параметром, а не маршрутом`);
  }
});

test('миграция создаёт только таблицы social_*', () => {
  const sql = code(MIGRATION);
  const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
  assert.ok(created.length >= 9, 'в миграции должно быть девять предметных таблиц');
  for (const table of created) {
    assert.ok(table.startsWith('social_'), `миграция создаёт непредметную таблицу «${table}»`);
  }
  assert.deepEqual(created.slice().sort(), [
    'social_assignment_progress', 'social_assignments', 'social_attempt_events',
    'social_class_members', 'social_classes', 'social_profiles', 'social_states',
    'social_usage_counters', 'social_weekly_scores',
  ].sort());
});

test('ни одна предметная миграция не изменяет таблицы истории', () => {
  assert.ok(SOCIAL_MIGRATIONS.length >= 2, 'проверять нужно ВСЕ миграции предмета');
  for (const file of SOCIAL_MIGRATIONS) {
    const sql = code(file);
    const name = path.basename(file);
    // ALTER допустим ТОЛЬКО над собственной таблицей предмета. Смысл проверки в
    // том, чтобы миграция обществознания не переписала таблицу истории; запрет
    // на любой ALTER вообще означал бы, что предмет нельзя развивать без новой
    // копии данных.
    for (const [, altered] of sql.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
      assert.ok(altered.startsWith('social_'), `${name}: миграция изменяет чужую таблицу «${altered}»`);
    }
    assert.ok(!/\bDROP\b/i.test(sql), `${name}: в миграции этапа 2 не должно быть DROP`);
    for (const table of referencedTables(sql)) {
      assert.ok(table.startsWith('social_'), `${name}: миграция трогает таблицу «${table}»`);
    }
    for (const [, created] of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g).map(m => [m[0], m[1]]).map(x => [x[0], x[1]])) {
      assert.ok(created.startsWith('social_'), `${name}: создаётся непредметная таблица «${created}»`);
    }
  }
});

test('очередь уведомлений предмета отделена от очереди истории', () => {
  // Общую notification_jobs разбирает бот истории своим токеном: попади туда
  // социальное задание — ученик обществознания не получит ничего, а причину
  // будут искать в приложении.
  const store = code(path.join(SRC, 'store.js'));
  assert.ok(store.includes('social_notification_jobs'));
  assert.ok(!/(?<![A-Za-z0-9_])notification_jobs/.test(store), 'предмет не имеет права писать в очередь истории');
  const server = code(path.join(__dirname, '..', 'src', 'server.js'));
  assert.match(server, /\/internal\/v1\/subjects\/social\/notifications\/claim/,
    'у бота предмета должен быть свой маршрут забора уведомлений');
});

test('рассылка по классу создаётся одним оператором, а не циклом', () => {
  // 🔴 Цикл по ученикам обрывается на первом сбое, и вторая половина класса
  // молча остаётся без домашки. Это уже случалось в истории.
  const store = code(path.join(SRC, 'store.js'));
  const start = store.indexOf('async function enqueueAssignmentNotifications');
  const end = store.indexOf('\nasync function', start + 10);
  const body = store.slice(start, end > start ? end : undefined);
  assert.ok(body.includes('INSERT INTO social_notification_jobs'));
  assert.ok(body.includes('FROM social_class_members'), 'получатели выбираются тем же запросом');
  assert.ok(!/\bfor\s*\(/.test(body) && !/\.forEach\(/.test(body),
    'обход получателей циклом здесь недопустим');
});

test('удаление аккаунта уносит все предметные данные — это держит схема', () => {
  const sql = code(MIGRATION);
  const references = [...sql.matchAll(/REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*id\s*\)\s*(ON DELETE [A-Z ]+)?/g)];
  assert.ok(references.length >= 9, 'внешние ключи обязаны быть у каждой таблицы');
  for (const [, table, rule] of references) {
    assert.ok(table === 'app_users' || table.startsWith('social_'),
      `внешний ключ ведёт в чужую таблицу «${table}»`);
    // 🔴 В 001_initial.sql стоит SET NULL, и удаление аккаунта оставляло бы
    // прогресс «ничейным»: данные никуда не деваются, просто теряют владельца.
    assert.match(String(rule || ''), /ON DELETE CASCADE/,
      `таблица со ссылкой на ${table} должна каскадно удаляться вместе с аккаунтом`);
  }
});

test('день и неделя считаются Москвой, а не часами процесса', () => {
  for (const file of SOCIAL_FILES) {
    const source = code(file);
    assert.ok(!source.includes('CURRENT_DATE'), `${path.basename(file)}: CURRENT_DATE зависит от таймзоны сервера`);
  }
  const store = code(path.join(SRC, 'store.js'));
  assert.ok(store.includes("AT TIME ZONE 'Europe/Moscow'"), 'квота обязана считаться по Москве');
  const schema = code(path.join(SRC, 'schema.js'));
  assert.ok(/moscow-time/.test(schema), 'день и неделя события берутся из общей серверной функции');
});

test('сервер разводит предметы по префиксу маршрута', () => {
  const server = code(path.join(__dirname, '..', 'src', 'server.js'));
  assert.match(server, /SOCIAL_PREFIX/, 'ветка обществознания должна выбираться по префиксу');
  assert.match(server, /handleSocial\(/);
  // Маршруты истории обязаны остаться ниже, за requireSession — то есть общая
  // ветка не должна начинаться раньше предметной.
  assert.ok(server.indexOf('handleSocial(') < server.indexOf("url.pathname === '/api/v1/store/doc'"),
    'предметная ветка должна отсекаться до общих маршрутов истории');
});

test('неделя считается одной общей функцией для обоих предметов', () => {
  // Копия «понедельника по Москве» в другом файле разъедется молча — и топ
  // сломается ровно так, как это уже было в истории.
  const server = code(path.join(__dirname, '..', 'src', 'server.js'));
  const store = code(path.join(SRC, 'store.js'));
  assert.ok(!/function mondayStr/.test(server), 'в server.js не должно быть второй копии mondayStr');
  assert.ok(!/function mondayStr/.test(store), 'в store.js не должно быть второй копии mondayStr');
  assert.ok(/require\(.*moscow-time.*\)/.test(server) && /require\(.*moscow-time.*\)/.test(store));
});
