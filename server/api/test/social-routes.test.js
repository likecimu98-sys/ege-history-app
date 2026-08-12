'use strict';

// Маршруты обществознания: кто что имеет право сделать.
//
// Проверяются ровно те обещания плана, нарушение которых не видно на глаз:
// выключенный флаг молчит, чужой origin не принимается, ученик не становится
// учителем, учитель не видит чужой класс и не пишет состояние ученика.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.PUBLIC_ORIGIN = 'https://reshay-istoriyu.ru';
process.env.SOCIAL_ORIGINS = 'https://obschestvo.reshay-istoriyu.ru';
process.env.SOCIAL_API = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { env, originAllowed } = require('../src/env');
const { handleSocial, PREFIX } = require('../src/subjects/social/routes');
const { pool } = require('../src/db');

test.after(() => pool.end());

const SOCIAL_ORIGIN = 'https://obschestvo.reshay-istoriyu.ru';
const CLASS_ID = 'cccc1111-2222-3333-4444-555566667777';
const OTHER_CLASS_ID = 'dddd1111-2222-3333-4444-555566667777';

function fakeRes() {
  return { status: 0, payload: null, writeHead() { return this; }, end() {} };
}

const json = (res, status, payload) => { res.status = status; res.payload = payload; return res; };
const readJson = req => Promise.resolve(req.body || {});
const limiter = { take: () => ({ ok: true }) };

// Подставное хранилище: отвечает заготовками и запоминает вызовы, чтобы можно
// было проверить, ЧТО именно маршрут спросил у базы.
function fakeStore(overrides = {}) {
  const calls = [];
  const track = (name, value) => (...args) => {
    calls.push({ name, args });
    if (typeof value === 'function') return value(...args);
    return Promise.resolve(value);
  };
  const base = {
    calls,
    ensureProfile: track('ensureProfile', { display_name: 'Иван', role: 'student', settings: {} }),
    patchProfile: track('patchProfile', { display_name: 'Иван', role: 'student', settings: {} }),
    roleOf: track('roleOf', 'student'),
    setRole: track('setRole', { user_id: 'u2', role: 'teacher' }),
    getState: track('getState', { exists: false, state: null, revision: 0 }),
    putState: track('putState', { ok: true, revision: 2 }),
    saveAttempts: track('saveAttempts', { accepted: 1, duplicates: 0, assignments: [] }),
    studentAssignments: track('studentAssignments', []),
    myClasses: track('myClasses', [{ id: CLASS_ID, title: 'мой класс' }]),
    listClasses: track('listClasses', []),
    joinClass: track('joinClass', { classId: CLASS_ID, title: '11А' }),
    quotaState: track('quotaState', { limit: 0, used: 0 }),
    consumeQuota: track('consumeQuota', { ok: true, used: 1 }),
    weeklyLeaderboard: track('weeklyLeaderboard', { weekStart: '2026-08-10', rows: [] }),
    createClass: track('createClass', { id: CLASS_ID, title: '11А', join_code: 'ABCD2345', status: 'active' }),
    updateClass: track('updateClass', { id: CLASS_ID, title: '11А', join_code: 'ABCD2345', status: 'archived' }),
    rotateJoinCode: track('rotateJoinCode', { id: CLASS_ID, join_code: 'WXYZ6789' }),
    classStudents: track('classStudents', []),
    createAssignment: track('createAssignment', { id: 'a-1' }),
    listAssignments: track('listAssignments', []),
    ownedAssignment: track('ownedAssignment', { id: 'a-1', class_id: CLASS_ID, types: [], blocks: [], topics: [], question_goal: 10, include_images: false, due_at: null, status: 'active', issued_at: new Date(), title: '' }),
    updateAssignment: track('updateAssignment', { id: 'a-1' }),
    cancelAssignment: track('cancelAssignment', { id: 'a-1', status: 'cancelled' }),
    assignmentResults: track('assignmentResults', { assignment: {}, results: [] }),
  };
  return { ...base, ...overrides, calls };
}

function session({ userId = 'u-1', telegram = null } = {}) {
  return {
    userId,
    user: {
      uid: userId, displayName: 'Иван', email: '', isAnonymous: false,
      identities: telegram ? [{ provider: 'telegram', subject: String(telegram) }] : [],
    },
  };
}

async function call(method, path, {
  body = null, origin = SOCIAL_ORIGIN, user = session(), store = fakeStore(),
  requireMutationAuth = () => {},
} = {}) {
  const req = { method, headers: { origin }, body };
  const res = fakeRes();
  const url = new URL(`https://api.example${PREFIX}${path}`);
  await handleSocial(req, res, url, user, { json, readJson, requireMutationAuth, limiter, scope: 's:test', store });
  return { res, store };
}

test('origin обществознания разрешён в общей авторизации', () => {
  // Без этого вход в обществознании падал бы на csrf_failed — молча, а прогресс
  // просто не сохранялся бы. Ровно это уже случалось с www в истории.
  assert.equal(originAllowed(SOCIAL_ORIGIN), true);
  assert.equal(originAllowed('https://reshay-istoriyu.ru'), true);
  assert.equal(originAllowed('https://obschestvo.reshay-istoriyu.ru.evil.com'), false);
});

test('при выключенном флаге предмета не существует', async () => {
  env.socialApi = false;
  try {
    await assert.rejects(() => call('GET', '/me/profile'), error => {
      // 404, а не 403: выключенная функция не подтверждает посторонним, что она есть.
      assert.equal(error.statusCode, 404);
      return true;
    });
  } finally {
    env.socialApi = true;
  }
});

test('со страницы истории в обществознание не попасть', async () => {
  await assert.rejects(() => call('GET', '/me/profile', { origin: 'https://reshay-istoriyu.ru' }), error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, 'origin_forbidden');
    return true;
  });
});

test('без сессии предметные маршруты закрыты', async () => {
  await assert.rejects(() => call('GET', '/me/profile', { user: null }), error => {
    assert.equal(error.statusCode, 401);
    return true;
  });
});

test('каждая мутация проходит через проверку CSRF', async () => {
  // Отсутствие CSRF на любой записи — это возможность чужой странице писать от
  // имени вошедшего ученика: куки у нас SameSite=None ради Telegram.
  const mutations = [
    ['PATCH', '/me/profile', { displayName: 'И' }],
    ['PUT', '/me/state', { state: {}, baseRevision: 0 }],
    ['POST', '/me/attempts', { events: [{ eventId: 'aaaaaaaaaaaaaaaa1111', taskId: 'A1B2C3' }] }],
    ['POST', '/me/classes/join', { code: 'ABCD2345' }],
    ['POST', '/quota/consume', { amount: 1 }],
  ];
  for (const [method, path, body] of mutations) {
    const requireMutationAuth = () => { throw Object.assign(new Error('csrf_failed'), { statusCode: 403 }); };
    await assert.rejects(() => call(method, path, { body, requireMutationAuth }), error => {
      assert.equal(error.message, 'csrf_failed', `${method} ${path} записывает без CSRF`);
      return true;
    });
  }
});

test('ученик не может назначить себе роль учителя', async () => {
  await assert.rejects(() => call('PATCH', '/me/profile', { body: { role: 'teacher' } }), /profile_unknown_field/);
  // И прямой учительский маршрут ему тоже закрыт.
  await assert.rejects(() => call('GET', '/teacher/classes'), error => {
    assert.equal(error.statusCode, 403);
    assert.equal(error.message, 'teacher_required');
    return true;
  });
});

test('учитель работает только со своими классами', async () => {
  // Владение проверяет хранилище одним запросом по паре (id, учитель): маршрут
  // обязан передать туда идентификатор учителя из СЕССИИ, а не из тела запроса.
  const store = fakeStore({ roleOf: () => Promise.resolve('teacher') });
  const { res } = await call('GET', `/teacher/classes/${CLASS_ID}/students`, { store });
  assert.equal(res.status, 200);
  const call1 = store.calls.find(item => item.name === 'classStudents');
  assert.equal(call1.args[0], 'u-1', 'учитель берётся из сессии');
  assert.equal(call1.args[1], CLASS_ID);
});

test('чужой класс отдаёт 404 из хранилища, а не пустой список', async () => {
  const store = fakeStore({
    roleOf: () => Promise.resolve('teacher'),
    classStudents: () => Promise.reject(Object.assign(new Error('class_not_found'), { statusCode: 404 })),
  });
  await assert.rejects(() => call('GET', `/teacher/classes/${OTHER_CLASS_ID}/students`, { store }), error => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('кривой идентификатор класса не доходит до базы', async () => {
  // Иначе PostgreSQL ответил бы 22P02 и наружу ушло бы 500 вместо честного 404.
  const store = fakeStore({ roleOf: () => Promise.resolve('teacher') });
  await assert.rejects(() => call('GET', '/teacher/classes/not-a-uuid/students', { store }), error => {
    assert.equal(error.statusCode, 404);
    return true;
  });
  assert.ok(!store.calls.some(item => item.name === 'classStudents'));
});

test('учителю не отдаётся состояние ученика ни одним маршрутом', async () => {
  const store = fakeStore({ roleOf: () => Promise.resolve('teacher') });
  for (const path of [`/teacher/classes/${CLASS_ID}/students`, '/teacher/assignments', '/teacher/assignments/aaaa1111-2222-3333-4444-555566667777/results']) {
    await call('GET', path, { store });
  }
  // 🔴 getState/putState существуют только для «моего» состояния. Появление их
  // вызова в учительской ветке означало бы, что учитель читает или, хуже,
  // перезаписывает прогресс ученика целиком.
  assert.ok(!store.calls.some(item => item.name === 'getState' || item.name === 'putState'));
});

test('конфликт снимка возвращается как 409 с актуальными данными', async () => {
  const store = fakeStore({ putState: () => Promise.resolve({ ok: false, conflict: true, revision: 9, state: { a: 1 } }) });
  const { res } = await call('PUT', '/me/state', { body: { state: {}, baseRevision: 3 }, store });
  assert.equal(res.status, 409);
  assert.equal(res.payload.revision, 9, 'клиент получает снимок для слияния, а не голую ошибку');
});

test('исчерпанная квота отвечает 429, а не тихим отказом', async () => {
  const store = fakeStore({ consumeQuota: () => Promise.resolve({ ok: false, limit: 30, used: 30, left: 0 }) });
  const { res } = await call('POST', '/quota/consume', { body: { amount: 1 }, store });
  assert.equal(res.status, 429);
  assert.equal(res.payload.error, 'daily_limit_reached');
});

test('рейтинг чужого класса не открывается по идентификатору', async () => {
  // Иначе по угаданному идентификатору класса посторонний собрал бы список
  // учеников школы.
  const store = fakeStore({ myClasses: () => Promise.resolve([]), listClasses: () => Promise.resolve([]) });
  const req = { method: 'GET', headers: { origin: SOCIAL_ORIGIN } };
  const res = fakeRes();
  const url = new URL(`https://api.example${PREFIX}/leaderboards/weekly?classId=${OTHER_CLASS_ID}`);
  await assert.rejects(
    () => handleSocial(req, res, url, session(), { json, readJson, requireMutationAuth: () => {}, limiter, scope: 's', store }),
    error => { assert.equal(error.statusCode, 404); return true; });
});

test('свой класс в рейтинге открывается', async () => {
  const store = fakeStore();
  const req = { method: 'GET', headers: { origin: SOCIAL_ORIGIN } };
  const res = fakeRes();
  const url = new URL(`https://api.example${PREFIX}/leaderboards/weekly?classId=${CLASS_ID}`);
  await handleSocial(req, res, url, session(), { json, readJson, requireMutationAuth: () => {}, limiter, scope: 's', store });
  assert.equal(res.status, 200);
});

test('роль выдаёт только админ предмета', async () => {
  const asTeacher = fakeStore({ roleOf: () => Promise.resolve('teacher') });
  await assert.rejects(
    () => call('POST', '/teacher/roles', { body: { userId: '11111111-1111-1111-1111-111111111111', role: 'teacher' }, store: asTeacher }),
    error => { assert.equal(error.message, 'admin_required'); return true; });

  // Админ сервера (Telegram ID из ADMIN_TELEGRAM_IDS) — единственный способ
  // получить первого учителя предмета через пользовательский маршрут.
  const adminId = [...env.adminTelegramIds][0];
  const store = fakeStore();
  const { res } = await call('POST', '/teacher/roles', {
    body: { userId: '11111111-1111-1111-1111-111111111111', role: 'teacher' },
    user: session({ telegram: adminId }), store,
  });
  assert.equal(res.status, 200);
  assert.equal(res.payload.role, 'teacher');
});

test('неизвестный предметный маршрут отвечает 404', async () => {
  await assert.rejects(() => call('GET', '/me/duels'), error => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});
