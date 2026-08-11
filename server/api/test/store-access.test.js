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
  projectDocument, classDocId, DocumentStore, denyContext, authorizeWrite
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

// ─────────────── рассылка уведомлений о новом ДЗ (hw_assigned_bulk) ───────────────
//
// 🔴 Разбор 11.08.2026. Клиент давно шлёт ОДНО задание рассылки на весь класс, и бот
// этот тип умеет — а сервер его не знал и отвечал 403. В итоге ДЗ летней школы легло
// во входящие 107 ученикам, а уведомление не получил НИКТО: заданий рассылки за пять
// дней ноль, в логе ровно один отказ на notifyJobs. Учитель при этом видел
// уведомления (до него доходили разрешённые hw_done) и считал, что всё работает.

const bulkJob = (ids) => ({ type: 'hw_assigned_bulk', studentIds: ids, recId: 'a_1', task: 'task4', total: 10, ts: Date.now() });
const jobRef = ref('notifyJobs', 'job_1');
// Клиент отдаёт profiles по списку id — здесь достаточно вернуть учеников с классами.
const clientWithStudents = (byId) => ({
  query: async (_sql, params) => ({
    rows: (params[0] || []).map(id => byId[id]).filter(Boolean),
  }),
});

test('учитель рассылает уведомление о ДЗ всему своему классу', async () => {
  const client = clientWithStudents({
    '111': studentRow('111', '7A'),
    '222': studentRow('222', '7A'),
  });
  assert.equal(await authorizeWrite(client, jobRef, teacherOf7A, null, bulkJob(['111', '222']), 'create'), true,
    'массовая рассылка своему классу обязана проходить — иначе о новом ДЗ не узнает никто');
});

test('в рассылку нельзя подмешать ученика чужого класса', async () => {
  const client = clientWithStudents({
    '111': studentRow('111', '7A'),
    '999': studentRow('999', '9B'),   // чужой
  });
  assert.equal(await authorizeWrite(client, jobRef, teacherOf7A, null, bulkJob(['111', '999']), 'create'), false,
    'через список чужих id можно было бы рассылать вне своего класса');
});

test('несуществующий адресат рассылку не пропускает', async () => {
  const client = clientWithStudents({ '111': studentRow('111', '7A') });
  assert.equal(await authorizeWrite(client, jobRef, teacherOf7A, null, bulkJob(['111', 'нет-такого']), 'create'), false);
});

test('не учитель рассылку не создаёт, пустой список тоже не проходит', async () => {
  const client = clientWithStudents({ '111': studentRow('111', '7A') });
  assert.equal(await authorizeWrite(client, jobRef, guest, null, bulkJob(['111']), 'create'), false,
    'ученик не имеет права рассылать уведомления классу');
  assert.equal(await authorizeWrite(client, jobRef, teacherOf7A, null, bulkJob([]), 'create'), false,
    'пустая рассылка — признак ошибки, а не безобидная запись');
});

test('размер рассылки не режет большую школу, но у списка есть потолок', async () => {
  // Летняя школа — полторы сотни человек, она влезала и в прежние 8 КБ, поэтому
  // размер НЕ был причиной поломки. Но у школы на несколько классов список
  // десятизначных id перевалит за 8 КБ, и рассылка молча упёрлась бы в тот же
  // потолок. Берём заведомо больший список, иначе проверка ничего не проверяет
  // (поймано саботажем: со старым лимитом тест на 150 учеников оставался зелёным).
  const ids = Array.from({ length: 800 }, (_, i) => String(1000000000 + i));
  assert.ok(JSON.stringify(bulkJob(ids)).length > 8192, 'тест обязан выходить за прежний лимит');
  const byId = {};
  for (const id of ids) byId[id] = studentRow(id, '7A');
  assert.equal(await authorizeWrite(clientWithStudents(byId), jobRef, teacherOf7A, null, bulkJob(ids), 'create'), true,
    'большая школа обязана пролезать в лимит размера');

  const tooMany = Array.from({ length: 1001 }, (_, i) => String(i));
  assert.equal(await authorizeWrite(clientWithStudents({}), jobRef, teacherOf7A, null, bulkJob(tooMany), 'create'), false,
    'тысяча с лишним адресатов — это уже не класс');
});

// ───────────────────────── объяснение отказа в логе ─────────────────────────

test('отказ называет актора, владение документом и поля вне учительского списка', () => {
  // Боевой случай 05.08.2026: 44 отказа подряд, и по логу нельзя было понять,
  // чей это запрос и на каком условии он упал.
  const row = studentRow('8618432261', 'letnyaya-2wp4tbt');
  const patch = { _mergedInto: 'x', _mergedAt: 1, knownTgId: '1', googleEmail: 'a@b.c', knownGoogleId: 'g' };
  const outsider = context({ docIds: ['other'], userId: 77 });

  const text = denyContext(ref('students', '8618432261'), outsider, row, patch);
  assert.match(text, /актор=77/, 'не видно, чей это был запрос');
  assert.match(text, /свой=нет/, 'не видно, что документ чужой');
  assert.match(text, /учитель=нет/, 'не видно роли пишущего');
  // Именно эти три поля вывели патч за учительский белый список.
  assert.match(text, /вне_списка_учителя=\[knownTgId,googleEmail,knownGoogleId\]/,
    'не названы поля, из-за которых патч не прошёл');
  // Значения полей в лог попадать не должны — там ФИО и почта.
  assert.doesNotMatch(text, /a@b\.c/, 'в лог утекло значение поля');
});

test('на своём документе отказ не выдумывает лишних полей', () => {
  const row = studentRow('555', '7A');
  const own = context({ docIds: ['555'], userId: 9 });
  const text = denyContext(ref('students', '555'), own, row, { name: 'Ы' });
  assert.match(text, /свой=да/);
  assert.doesNotMatch(text, /вне_списка_учителя/,
    'для своего документа учительский список не при чём');
});

test('гость в отказе виден как гость', () => {
  const text = denyContext(ref('classes', '7A'), null, null, { assignments: [] });
  assert.match(text, /актор=гость/);
  assert.match(text, /свой=нет/);
});

test('сбор объяснения не роняет сам отказ', () => {
  // denyContext вызывается В ПУТИ ОШИБКИ. Если она бросит, честный 403
  // превратится в 500: ученик увидит «сервер сломался» вместо «нельзя», а в
  // логе будет stack вместо причины. Диагностика не имеет права быть опаснее
  // того, что она диагностирует — поэтому на кривом ctx она обязана вернуть
  // строку, а не исключение.
  const row = studentRow('555', '7A');
  const broken = [
    { userId: 5 },                                   // docIds вообще нет
    { userId: 6, docIds: null },                     // docIds пустой
    { userId: 7, docIds: ['555'] },                  // массив вместо Set — .has отсутствует
    { userId: 8, docIds: { has: () => { throw new Error('бум'); } } }, // .has бросает
  ];
  for (const ctx of broken) {
    const text = denyContext(ref('students', '555'), ctx, row, { name: 'Ы' });
    assert.equal(typeof text, 'string', 'объяснение обязано быть строкой при любом ctx');
    assert.ok(text.length > 0, 'пустое объяснение бесполезно в логе');
  }

  // Мало не упасть — надо ещё остаться ПОЛЕЗНЫМ. Три первых случая кривые, но
  // поправимые: актора из них видно, и в лог обязан уйти он, а не заглушка
  // «контекст не собрался». Иначе внутренние проверки можно было бы выкинуть,
  // положившись на один try/catch, и лог тихо обеднел бы (проверено саботажем:
  // без этого утверждения подмена на голый ctx.docIds.has не ловилась).
  for (const ctx of broken.slice(0, 3)) {
    const text = denyContext(ref('students', '555'), ctx, row, { name: 'Ы' });
    assert.match(text, new RegExp(`актор=${ctx.userId}`),
      'на поправимо кривом ctx объяснение обязано остаться содержательным');
    assert.doesNotMatch(text, /не собрался/,
      'свалились в заглушку там, где могли назвать причину');
  }
  // Патч и текущая строка тоже могут прийти какими угодно.
  assert.equal(typeof denyContext(ref('students', '1'), undefined, undefined, undefined), 'string');
});

test('объяснение отказа реально подставляется в лог, а не просто существует', () => {
  // Три теста выше проверяют саму denyContext. Если её перестать вызывать в
  // write(), они останутся зелёными, а в логе снова будет отказ без причины —
  // ровно та дыра, из-за которой разбор 05.08 упёрся в тупик. Тест на проводку
  // приходится делать по исходнику: write() ходит в PostgreSQL, которого в
  // юнит-прогоне нет.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.match(source, /const denied = [\s\S]{0,400}?denyContext\(ref, ctx, current, effectivePatch\)/,
    'denyContext не подставляется в строку denied — отказ снова будет без причины');
});
