'use strict';

// Состав класса: учитель убирает ученика.
//
// В классе копятся прошлогодние выпускники, случайные люди по утёкшей ссылке и
// вторые аккаунты тех же детей. Убрать их было нечем, и таблица класса тем
// точнее врала, чем дольше класс жил.
//
// 🔴 Главное обещание здесь — «убрать» не значит «стереть». Строка членства
// остаётся со status='removed': вместе с ней остаются joined_at, по которому
// считается, какие работы ученику вообще выдавались, и весь его прогресс по
// уже выданным заданиям.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.PUBLIC_ORIGIN = 'https://reshay-istoriyu.ru';
process.env.SOCIAL_ORIGINS = 'https://obschestvo.reshay-istoriyu.ru';
process.env.SOCIAL_API = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/subjects/social/store');
const { handleSocial, PREFIX } = require('../src/subjects/social/routes');
const { pool } = require('../src/db');

test.after(() => pool.end());

const storeSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'subjects', 'social', 'store.js'), 'utf8');

const TEACHER = 'aaaa1111-2222-3333-4444-555566667777';
const CLASS_ID = 'cccc1111-2222-3333-4444-555566667777';
const STUDENT = 'bbbb1111-2222-3333-4444-555566667777';

// Подставное соединение: помнит выполненные операторы и отвечает заготовкой.
function fakeDb({ owned = true, updated = 1 } = {}) {
  const log = [];
  return {
    log,
    query(text, params) {
      log.push({ text, params });
      if (/FROM social_classes WHERE id=\$1 AND teacher_user_id=\$2/.test(text)) {
        return Promise.resolve({ rowCount: owned ? 1 : 0, rows: owned ? [{ id: CLASS_ID }] : [] });
      }
      if (/UPDATE social_class_members/.test(text)) {
        return Promise.resolve({ rowCount: updated, rows: updated ? [{ user_id: STUDENT }] : [] });
      }
      throw new Error(`неожиданный запрос: ${text}`);
    },
  };
}

// ------------------------------------------------------------ хранилище ---

test('ученик помечается убранным, а не удаляется', async () => {
  const db = fakeDb();
  const result = await store.removeClassStudent(TEACHER, CLASS_ID, STUDENT, { db });
  assert.deepEqual(result, { classId: CLASS_ID, studentId: STUDENT, status: 'removed' });

  const write = db.log.find(item => /social_class_members/.test(item.text));
  assert.match(write.text, /UPDATE social_class_members SET status='removed'/);
  // 🔴 Никакого DELETE. Потеря строки унесла бы joined_at, и вернувшийся ученик
  // получил бы пачку чужих просроченных домашек.
  assert.ok(!/DELETE\s+FROM\s+social_class_members/i.test(write.text), 'строка членства остаётся');
  assert.deepEqual(write.params, [CLASS_ID, STUDENT]);
  // Убрать можно только того, кто в классе сейчас: на этом же условии держится
  // отличие «убрал» от «его там и не было».
  assert.match(write.text, /status='active'/);
});

test('состав меняет только владелец класса', async () => {
  const db = fakeDb({ owned: false });
  await assert.rejects(() => store.removeClassStudent(TEACHER, CLASS_ID, STUDENT, { db }), error => {
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'class_not_found');
    return true;
  });
  // Проверка владения идёт ДО записи: иначе чужой класс успел бы измениться.
  assert.ok(!db.log.some(item => /UPDATE/.test(item.text)), 'до проверки владения ничего не пишется');
});

test('того, кого в классе нет, убрать нельзя', async () => {
  const db = fakeDb({ updated: 0 });
  await assert.rejects(() => store.removeClassStudent(TEACHER, CLASS_ID, STUDENT, { db }), error => {
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, 'student_not_found');
    return true;
  });
});

test('убранный ученик исчезает отовсюду, потому что членство читается со статусом', () => {
  // Ровно это и делает «убрать» работающим: домашка, таблица класса, карточка
  // ученика, состав варианта и рейтинг спрашивают членство одинаково. Запрос,
  // забывший статус, показывал бы убранного ученика на одном экране из шести —
  // и ничьей ошибкой это не выглядело бы.
  // Границей берём конец шаблонной строки, а не «столько-то символов»: в
  // запросе списка учеников между членством и его условием стоит LATERAL на
  // двадцать строк, и окно фиксированной длины до условия не дотягивалось.
  const reads = [];
  const needle = 'social_class_members m';
  for (let at = storeSource.indexOf(needle); at >= 0; at = storeSource.indexOf(needle, at + 1)) {
    const end = storeSource.indexOf('`', at);
    reads.push(storeSource.slice(at, end < 0 ? at + 400 : end));
  }
  assert.ok(reads.length >= 8, `членство читается во многих запросах (нашли ${reads.length})`);
  for (const fragment of reads) {
    assert.match(fragment, /m\.status\s*=\s*'active'/,
      `запрос читает членство без статуса:\n${fragment.slice(0, 200)}`);
  }
});

// -------------------------------------------------------------- маршрут ---

const fakeRes = () => ({ status: 0, payload: null, writeHead() { return this; }, end() {} });
const json = (res, status, payload) => { res.status = status; res.payload = payload; return res; };

function call(method, url, { requireMutationAuth = () => {} } = {}) {
  const calls = [];
  const api = {
    roleOf: () => Promise.resolve('teacher'),
    ensureProfile: () => Promise.resolve({ display_name: 'Учитель', role: 'teacher', settings: {} }),
    studentOverview: (...args) => { calls.push(['studentOverview', args]); return Promise.resolve({}); },
    removeClassStudent: (...args) => {
      calls.push(['removeClassStudent', args]);
      return Promise.resolve({ classId: CLASS_ID, studentId: STUDENT, status: 'removed' });
    },
  };
  const req = { method, headers: { origin: 'https://obschestvo.reshay-istoriyu.ru' }, body: null };
  const res = fakeRes();
  const session = {
    userId: TEACHER,
    user: { uid: TEACHER, displayName: 'Учитель', email: '', isAnonymous: false, identities: [] },
  };
  return handleSocial(req, res, new URL(`https://api.example${PREFIX}${url}`), session, {
    json,
    readJson: () => Promise.resolve({}),
    requireMutationAuth,
    limiter: { take: () => ({ ok: true }) },
    scope: 's:test',
    store: api,
  }).then(() => ({ res, calls }));
}

test('DELETE по ученику убирает его из класса от имени учителя из сессии', async () => {
  const { res, calls } = await call('DELETE', `/teacher/classes/${CLASS_ID}/students/${STUDENT}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.payload, { classId: CLASS_ID, studentId: STUDENT, status: 'removed' });
  const [name, args] = calls[0];
  assert.equal(name, 'removeClassStudent');
  // Учитель — из сессии, а не из адреса или тела: иначе состав чужого класса
  // менялся бы по одному запросу.
  assert.deepEqual(args.slice(0, 3), [TEACHER, CLASS_ID, STUDENT]);
});

test('тот же адрес методом GET по-прежнему открывает карточку', async () => {
  const { res, calls } = await call('GET', `/teacher/classes/${CLASS_ID}/students/${STUDENT}`);
  assert.equal(res.status, 200);
  assert.equal(calls[0][0], 'studentOverview');
});

test('удаление из класса проходит через проверку CSRF', async () => {
  // Кука у нас SameSite=None ради Telegram: без этой проверки чужая страница
  // вычистила бы класс от имени вошедшего учителя.
  const requireMutationAuth = () => { throw Object.assign(new Error('csrf_failed'), { statusCode: 403 }); };
  await assert.rejects(
    () => call('DELETE', `/teacher/classes/${CLASS_ID}/students/${STUDENT}`, { requireMutationAuth }),
    error => { assert.equal(error.message, 'csrf_failed'); return true; });
});
