'use strict';

// Регрессия на дневную квоту. До 26.07.2026 лимит жил только в браузере и
// снимался правкой одного числа в DevTools.
//
// Тесты гоняются на подставном соединении: поднимать PostgreSQL ради проверки
// того, КАКОЙ лимит выбран и КОГДА он считается выбранным, не нужно. Что этим
// НЕ проверяется и проверено быть не может без живой базы — настоящая
// атомарность параллельных consume; её обеспечивает то, что инкремент и
// проверка лимита выполняются одним оператором INSERT ... ON CONFLICT DO UPDATE
// ... WHERE (см. quota.js). Здесь проверяется, что этот оператор действительно
// такой и что отказ распознаётся по пустому RETURNING.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaState, consumeQuota, clampAmount } = require('../src/quota');
const { pool } = require('../src/db');

test.after(() => pool.end());

const session = { userId: 'u-1' };
const context = ({ admin = false, teacher = null, ownClasses = [] } = {}) => ({
  admin, teacher, docIds: new Set(['111']), ownClasses: new Set(ownClasses),
});

// Подставное соединение: отвечает по первому совпадению в таблице ответов.
// Счётчик держим в замыкании, чтобы consume видел собственные записи.
function fakeDb({ limits = {}, profile = {}, unlimitedClass = false, used = 0 }) {
  const state = { used, statements: [] };
  return {
    state,
    async query(sql, params) {
      state.statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('FROM app_config')) return { rows: [{ data: limits }], rowCount: 1 };
      if (sql.includes('FROM student_profiles')) return { rows: [{ data: profile }], rowCount: 1 };
      if (sql.includes('FROM classes')) return { rows: unlimitedClass ? [{}] : [], rowCount: unlimitedClass ? 1 : 0 };
      if (sql.includes('AS reset_at')) {
        return { rows: [{ used: state.used, reset_at: '2026-07-27T00:00:00+03:00' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO usage_counters')) {
        const [, , amount, limit] = params;
        // Повторяем семантику WHERE usage_counters.count < limit.
        if (state.used >= limit) return { rows: [], rowCount: 0 };
        state.used += amount;
        return { rows: [{ count: state.used }], rowCount: 1 };
      }
      throw new Error('неожиданный запрос: ' + sql.slice(0, 60));
    },
  };
}

test('обычный ученик получает бесплатный тариф', async () => {
  const db = fakeDb({ limits: { freeDaily: 30, premiumDaily: 200 }, used: 12 });
  const state = await quotaState(session, context(), { db });
  assert.equal(state.limit, 30);
  assert.equal(state.used, 12);
  assert.equal(state.left, 18);
  assert.equal(state.premium, false);
});

test('премиум получает премиальный тариф', async () => {
  const db = fakeDb({ limits: { freeDaily: 30, premiumDaily: 200 }, profile: { premium: true } });
  const state = await quotaState(session, context(), { db });
  assert.equal(state.limit, 200);
  assert.equal(state.premium, true);
});

test('premiumAuto считается премиумом наравне с premium', async () => {
  const db = fakeDb({ limits: { freeDaily: 30, premiumDaily: 200 }, profile: { premiumAuto: true } });
  assert.equal((await quotaState(session, context(), { db })).limit, 200);
});

test('учитель, админ и безлимитный класс освобождены от лимита', async () => {
  const limits = { freeDaily: 30, premiumDaily: 200 };
  const asTeacher = await quotaState(session, context({ teacher: { docId: '555' } }), { db: fakeDb({ limits }) });
  assert.equal(asTeacher.limit, 0, 'у учителя лимита нет');

  const asAdmin = await quotaState(session, context({ admin: true }), { db: fakeDb({ limits }) });
  assert.equal(asAdmin.limit, 0, 'у админа лимита нет');

  const inFreeClass = await quotaState(session, context({ ownClasses: ['7A'] }),
    { db: fakeDb({ limits, unlimitedClass: true }) });
  assert.equal(inFreeClass.limit, 0, 'класс с безлимитом снимает лимит');
  assert.equal(inFreeClass.classUnlimited, true);
});

test('нулевой лимит в конфиге означает безлимит, а не запрет', async () => {
  const db = fakeDb({ limits: { freeDaily: 0 } });
  const state = await quotaState(session, context(), { db });
  assert.equal(state.limit, 0);
  assert.equal(state.left, null, 'при безлимите остаток не считается');
});

test('расход списывается и уменьшает остаток', async () => {
  const db = fakeDb({ limits: { freeDaily: 10 }, used: 0 });
  const first = await consumeQuota(session, context(), 4, { db });
  assert.equal(first.ok, true);
  assert.equal(first.used, 4);
  assert.equal(first.left, 6);

  const second = await consumeQuota(session, context(), 4, { db });
  assert.equal(second.used, 8);
  assert.equal(second.left, 2);
});

test('исчерпанный лимит отказывает, а не уходит в минус', async () => {
  const db = fakeDb({ limits: { freeDaily: 10 }, used: 10 });
  const result = await consumeQuota(session, context(), 3, { db });
  assert.equal(result.ok, false);
  assert.equal(result.left, 0);
  assert.equal(db.state.used, 10, 'счётчик не должен вырасти при отказе');
});

test('при безлимите счётчик не трогается вовсе', async () => {
  const db = fakeDb({ limits: { freeDaily: 0 } });
  const result = await consumeQuota(session, context(), 5, { db });
  assert.equal(result.ok, true);
  assert.equal(db.state.statements.some(s => s.includes('INSERT INTO usage_counters')), false);
});

test('инкремент и проверка лимита выполняются одним оператором', async () => {
  // Это и есть гарантия от гонки двух вкладок: отдельных SELECT + UPDATE быть
  // не должно, иначе между ними проскочит второй запрос.
  const db = fakeDb({ limits: { freeDaily: 10 } });
  await consumeQuota(session, context(), 1, { db });
  const insert = db.state.statements.find(s => s.includes('INSERT INTO usage_counters'));
  assert.ok(insert, 'списание должно идти через INSERT ... ON CONFLICT');
  assert.match(insert, /ON CONFLICT \(user_id, day, kind\) DO UPDATE/);
  assert.match(insert, /WHERE usage_counters\.count < \$4/, 'проверка лимита обязана быть в том же операторе');
  assert.match(insert, /RETURNING count/);
});

test('день считается по Москве, а не по часам устройства', async () => {
  const db = fakeDb({ limits: { freeDaily: 10 } });
  await consumeQuota(session, context(), 1, { db });
  assert.ok(db.state.statements.every(s => !s.includes('CURRENT_DATE')),
    'CURRENT_DATE зависит от таймзоны сервера — нужен явный Europe/Moscow');
  assert.ok(db.state.statements.some(s => s.includes("AT TIME ZONE 'Europe/Moscow'")));
});

test('разовый расход ограничен сверху и снизу', () => {
  assert.equal(clampAmount(5), 5);
  assert.equal(clampAmount(0), 1);
  assert.equal(clampAmount(-7), 1);
  assert.equal(clampAmount(99999), 200);
  assert.equal(clampAmount('3'), 3);
  assert.equal(clampAmount(undefined), 1);
  assert.equal(clampAmount(2.9), 2);
});
