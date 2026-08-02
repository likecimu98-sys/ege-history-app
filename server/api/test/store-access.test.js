'use strict';

// Регрессия на права ЧТЕНИЯ. До 26.07.2026 любая гостевая сессия одним запросом
// store/query получала весь реестр учеников с ФИО, @username и кодом класса —
// персональные данные несовершеннолетних. Правка без теста здесь не принимается:
// ошибка в authorizeRead не роняет приложение и не видна глазом, она просто тихо
// отдаёт лишнее. Каждый case из authorizeRead должен быть закрыт проверкой.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizeRead, authorizeCollectionQuery, publicStudent, publicMatch, studentClassView,
  projectDocument, classDocId, DocumentStore
} = require('../src/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

const APP = 'ege-history-bot';
const ref = (collection, docId) => ({
  path: `artifacts/${APP}/public/data/${collection}/${docId}`,
  appId: APP, visibility: 'public', collection, table: collection, docId,
});

// authorizeRead трогает client только в ветке 'state' (ищет владельца профиля).
// Остальные ветки — чистое решение по ctx и строке, поэтому клиент здесь заглушка.
const noClient = { query: async () => { throw new Error('database access not expected'); } };

function context({ docIds = [], classes = [], ownClasses = [], teacher = null, admin = false, role = 'student', userId = 1 } = {}) {
  return {
    userId, user: { uid: 'u' + userId }, docIds: new Set(docIds), telegramIds: [],
    teacher, admin, role, classes: new Set(classes), ownClasses: new Set(ownClasses), orgId: '',
  };
}

const studentRow = (docId, classCode, extra = {}) => ({
  doc_id: docId, user_id: 900, version: 1,
  data: { name: 'Иванов Иван', username: 'ivanov', classCode, totalSolved: 42, fullStateJson: '{"secret":1}', ...extra },
});

const guest = context({ docIds: ['guest_1'], userId: 1 });
const teacherOf7A = context({ docIds: ['555'], classes: ['7A'], teacher: { docId: '555', data: {} }, role: 'solo', userId: 2 });
const admin = context({ admin: true, role: 'admin', userId: 3 });

// ─────────────────────────── students ───────────────────────────

test('гость не читает чужой профиль ни одиночным чтением, ни запросом коллекции', async () => {
  const victim = studentRow('352253483', '7A');
  const single = await authorizeRead(noClient, ref('students', '352253483'), guest, victim);
  assert.equal(single.ok, false, 'одиночное чтение чужого профиля должно быть запрещено');

  // Именно этот режим и был дырой: query отдавал строку как «публичную».
  const inQuery = await authorizeRead(noClient, ref('students', '352253483'), guest, victim, { query: true });
  assert.equal(inQuery.ok, false, 'в режиме query чужой профиль тоже не отдаётся');
});

test('ученик читает свой профиль полностью', async () => {
  const mine = studentRow('guest_1', '');
  const access = await authorizeRead(noClient, ref('students', 'guest_1'), guest, mine);
  assert.deepEqual(access, { ok: true, full: true });
});

test('владение считается и по user_id, а не только по списку docIds', async () => {
  const mine = { ...studentRow('other_id', ''), user_id: guest.userId };
  const access = await authorizeRead(noClient, ref('students', 'other_id'), guest, mine);
  assert.equal(access.full, true);
});

test('учитель читает ученика своего класса и не читает чужого', async () => {
  const own = await authorizeRead(noClient, ref('students', '111'), teacherOf7A, studentRow('111', '7A'));
  assert.deepEqual(own, { ok: true, full: true });

  const foreign = await authorizeRead(noClient, ref('students', '222'), teacherOf7A, studentRow('222', '9B'), { query: true });
  assert.equal(foreign.ok, false, 'ученик чужого класса недоступен даже в режиме query');
});

test('админ читает любого ученика', async () => {
  const access = await authorizeRead(noClient, ref('students', '999'), admin, studentRow('999', '9B'));
  assert.deepEqual(access, { ok: true, full: true });
});

test('без сессии не читается ничего', async () => {
  const access = await authorizeRead(noClient, ref('students', '111'), null, studentRow('111', '7A'));
  assert.equal(access.ok, false);
});

// ────────────────── воспроизведение самой утечки ──────────────────

test('гостевая проба реестра учеников отвечает отказом, а не списком', async () => {
  // Дословный сценарий из аудита: POST /api/v1/store/query по коллекции students
  // с limit 5000. До правки он отдавал 200 и 1201 документ с ФИО, @username и
  // кодом класса. Проверяем весь путь query(), а не только решение authorizeRead:
  // именно в query() лежат фильтрация строк и подмена проекции.
  const store = new DocumentStore();
  const rows = [studentRow('352253483', '7A'), studentRow('111', '9B'), studentRow('222', '')];
  const client = { query: async () => ({ rows, rowCount: rows.length }) };
  const path = `artifacts/${APP}/public/data/students`;

  await assert.rejects(
    () => store.query(path, [{ type: 'limit', count: 5000 }], null, { client, context: guest }),
    error => error.statusCode === 403,
    'перечисление реестра посторонним должно отвечать 403');
});

test('учитель перечисляет учеников, но получает только свой класс', async () => {
  const store = new DocumentStore();
  const rows = [studentRow('111', '7A'), studentRow('222', '9B'), studentRow('333', '7A')];
  const client = { query: async () => ({ rows, rowCount: rows.length }) };
  const path = `artifacts/${APP}/public/data/students`;

  const docs = await store.query(path, [{ type: 'limit', count: 5000 }], null, { client, context: teacherOf7A });
  assert.deepEqual(docs.map(d => d.id).sort(), ['111', '333']);
  // Своим ученикам учитель видит документ целиком — на этом держится кабинет.
  assert.equal(docs[0].data.fullStateJson, '{"secret":1}');
});

test('право перечислить коллекцию отделено от права прочитать строку', () => {
  const studentsRef = ref('students', '_query_');
  assert.equal(authorizeCollectionQuery(studentsRef, guest), false);
  assert.equal(authorizeCollectionQuery(studentsRef, teacherOf7A), true);
  assert.equal(authorizeCollectionQuery(studentsRef, admin), true);
  assert.equal(authorizeCollectionQuery(studentsRef, null), false);
  // Список ожидающих дуэлей перечисляют все — иначе не с кем играть.
  assert.equal(authorizeCollectionQuery(ref('matches', '_query_'), guest), true);
});

// ─────────────────────────── matches ───────────────────────────

const matchRow = () => ({
  doc_id: 'match_1', user_id: null, version: 1,
  data: {
    status: 'waiting', mode: 'classic', createdAt: 1000, startTime: 0, swipeSections: ['a'],
    player1: { uid: '352253483', name: 'Пётр', score: 7, combo: 2, elo: 1180 },
    player2: null,
    secretField: 'не должно уехать наружу',
  },
});

test('участник дуэли читает свой матч целиком', async () => {
  const player = context({ docIds: ['352253483'], userId: 4 });
  const access = await authorizeRead(noClient, ref('matches', 'match_1'), player, matchRow());
  assert.deepEqual(access, { ok: true, full: true });
});

test('посторонний видит матч, но без uid игрока', async () => {
  const access = await authorizeRead(noClient, ref('matches', 'match_1'), guest, matchRow());
  assert.equal(access.ok, true, 'вызов на дуэль должен быть виден — иначе некого вызывать');
  assert.equal(access.full, false);

  const view = publicMatch(matchRow().data, guest);
  assert.equal(view.player1.uid, undefined, 'uid игрока — это Telegram ID, наружу он не уходит');
  assert.equal(view.secretField, undefined, 'проекция отдаёт только перечисленные поля');
  assert.equal(view.player1.name, 'Пётр');
  assert.equal(view.player1.elo, 1180);
  assert.equal(view.player1.score, undefined);
});

test('проекция матча сохраняет пустой слот и отвечает, чей это вызов', async () => {
  const data = matchRow().data;
  const owner = context({ docIds: ['352253483'], userId: 5 });

  const asStranger = publicMatch(data, guest);
  assert.equal(asStranger.player2, null, 'свободный слот должен остаться null — по нему клиент понимает, что можно войти');
  assert.equal(asStranger.status, 'waiting');
  assert.equal(asStranger.player1.self, false);

  // Клиент раньше узнавал свой вызов сравнением uid. Теперь это делает сервер.
  assert.equal(publicMatch(data, owner).player1.self, true);
});

// ─────────────────────────── classes ───────────────────────────

const classRow = () => ({
  doc_id: '7A', user_id: null, version: 1,
  data: {
    assignments: [{ id: 'a1' }], revokedAssignments: ['a0'], revokeBefore: 5, currentUpto: 1917,
    currentPeriod: '20th', unlimited: true, updatedAt: 10,
    teacherNote: 'внутренняя заметка учителя', roster: ['111', '222'],
  },
});

test('учитель класса читает документ класса целиком', async () => {
  const access = await authorizeRead(noClient, ref('classes', '7A'), teacherOf7A, classRow());
  assert.deepEqual(access, { ok: true, full: true });
});

test('ученик своего класса читает журнал ДЗ, но не внутренности класса', async () => {
  // Без этого доступа сломалась бы выдача домашних заданий: pullClassAssignments
  // вызывается именно учеником.
  const student = context({ docIds: ['111'], ownClasses: ['7A'], userId: 6 });
  const access = await authorizeRead(noClient, ref('classes', '7A'), student, classRow());
  assert.equal(access.ok, true);
  assert.equal(access.full, false);

  const view = studentClassView(classRow().data);
  assert.deepEqual(view.assignments, [{ id: 'a1' }]);
  assert.equal(view.currentUpto, 1917);
  assert.equal(view.unlimited, true);
  assert.equal(view.teacherNote, undefined);
  assert.equal(view.roster, undefined, 'список класса ученику не отдаём');
});

test('ученик не читает чужой класс', async () => {
  const student = context({ docIds: ['111'], ownClasses: ['7A'], userId: 7 });
  const access = await authorizeRead(noClient, ref('classes', '9B'), student, classRow());
  assert.equal(access.ok, false);
});

test('гость без класса не читает документ класса', async () => {
  const access = await authorizeRead(noClient, ref('classes', '7A'), guest, classRow());
  assert.equal(access.ok, false);
});

// ─────────────────────────── прочие коллекции ───────────────────────────

test('служебные коллекции остаются закрытыми', async () => {
  for (const collection of ['teachers', 'notifyJobs', 'loginTokens']) {
    const access = await authorizeRead(noClient, ref(collection, 'x'), guest, { doc_id: 'x', data: {} });
    assert.equal(access.ok, false, `${collection} не должна читаться посторонним`);
  }
});

test('настройки и рейтинг читаются всеми — персональных данных там нет', async () => {
  assert.equal((await authorizeRead(noClient, ref('config', 'limits'), guest, { data: {} })).ok, true);
  assert.equal((await authorizeRead(noClient, ref('leaderboards', 'top'), guest, { data: {} })).ok, true);
});

// ─────────────────────────── проекции ───────────────────────────

test('коллекция без описанной проекции не отдаётся урезанной', () => {
  // projectDocument возвращает null -> get/query отвечают отказом, а не пустышкой.
  assert.equal(projectDocument('teachers', { role: 'admin' }, guest), null);
  assert.equal(projectDocument('state', { fullStateJson: '{}' }, guest), null);
});

test('проекция ученика не содержит блоб состояния', () => {
  const view = publicStudent(studentRow('111', '7A').data);
  assert.equal(view.fullStateJson, undefined);
  assert.equal(view.name, 'Иванов Иван');
});

test('код класса нормализуется так же, как на клиенте', () => {
  assert.equal(classDocId('  7A '), '7A');
  assert.equal(classDocId('7/A'), '7_A');
  assert.equal(classDocId('a#b?c%d'), 'a_b_c_d');
  assert.equal(classDocId(null), '');
});

// ─────────────────────────── публичный рейтинг ───────────────────────────

test('рейтинг показывает имя и инициал фамилии, а не полное ФИО', () => {
  const { leaderboardName } = require('../src/server');
  // Ученики вводят «Фамилия Имя», часто дописывая класс через запятую.
  assert.equal(leaderboardName('Иванов Иван'), 'Иван И.');
  assert.equal(leaderboardName('Петров Пётр, 11 "А"'), 'Пётр П.');
  assert.equal(leaderboardName('  Сидорова   Анна  '), 'Анна С.');
  // Одно слово — это ник, сокращать нечего.
  assert.equal(leaderboardName('Ученик'), 'Ученик');
  assert.equal(leaderboardName(''), 'Аноним');
  assert.equal(leaderboardName(null), 'Аноним');
  // Отчество не должно превращаться в мусор: берём только первые два слова.
  assert.equal(leaderboardName('Иванов Иван Иванович'), 'Иван И.');
});

test('метка недели считается с понедельника', () => {
  const { mondayStr } = require('../src/server');
  // Моменты заданы абсолютно (Z), а не через new Date(y, m, d): местная зона
  // процесса не должна влиять на ответ — ровно на этом топ и сломался.
  // 2026-07-26 15:00 MSK — воскресенье, неделя началась 20 июля.
  assert.equal(mondayStr(new Date('2026-07-26T12:00:00Z')), '2026-07-20');
  assert.equal(mondayStr(new Date('2026-07-20T12:00:00Z')), '2026-07-20');
  assert.equal(mondayStr(new Date('2026-07-21T12:00:00Z')), '2026-07-20');
});

test('граница недели — полночь по Москве, а не по зоне процесса', () => {
  const { mondayStr } = require('../src/server');
  // 🔴 Регрессия 02.08.2026. VPS живёт в Etc/UTC. В 22:39 UTC воскресенья в
  // Москве уже 01:39 понедельника: ученики писали weekStartStr новой недели и
  // пропадали из топа, а сервер по своим часам отдавал прошлую неделю.
  assert.equal(mondayStr(new Date('2026-08-02T22:39:00Z')), '2026-08-03');
  // 20:59:59 UTC = 23:59:59 MSK воскресенья — неделя ещё старая.
  assert.equal(mondayStr(new Date('2026-08-02T20:59:59Z')), '2026-07-27');
  // 21:00:00 UTC = 00:00:00 MSK понедельника — ровно в этот миг неделя новая.
  assert.equal(mondayStr(new Date('2026-08-02T21:00:00Z')), '2026-08-03');
  // Обратный край: 00:30 UTC понедельника = 03:30 MSK, неделя та же новая.
  assert.equal(mondayStr(new Date('2026-08-03T00:30:00Z')), '2026-08-03');
});

// Сверку формулы с клиентской getMondayOfCurrentWeek держит
// tools-and-docs/weekly-top.selftest.js: сюда её класть нельзя — deploy-api.ps1
// гоняет эти тесты на VPS, где клиентского utils.js попросту нет.
