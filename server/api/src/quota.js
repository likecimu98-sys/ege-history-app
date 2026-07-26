'use strict';

// Дневная квота решённых строк.
//
// До 26.07.2026 лимит считался ИСКЛЮЧИТЕЛЬНО на клиенте (state.js, canSolveMore)
// по localStorage — то есть снимался из DevTools за десять секунд, и весь платный
// контур обходился тривиально.
//
// ⚠️ Честная граница этой защиты, зафиксируй её прежде чем что-то продавать:
// весь контент (data.js, exam-bank.generated.js) уже лежит в браузере, а «я решил
// N строк» — утверждение клиента. Сервер держит источником правды сам ЛИМИТ
// (тариф, признак премиума, безлимит класса — это серверные факты) и закрывает
// обход «в один клик», но не мешает тому, кто правит JS. Поэтому подписку нельзя
// продавать как «больше строк в день»: продавать надо то, что физически живёт на
// сервере. Это продуктовое решение — см. задачу 3.1 плана.
//
// День считается по Europe/Moscow, а не по часам устройства: иначе лимит
// добирался бы переводом времени на телефоне.

const { pool } = require('./db');

const MOSCOW_TODAY = "(now() AT TIME ZONE 'Europe/Moscow')::date";

function numeric(value) {
  return Math.max(0, Number(value) || 0);
}

async function quotaState(session, context, { db = pool, kind = 'lines' } = {}) {
  const [config, profiles, counter] = await Promise.all([
    db.query("SELECT data FROM app_config WHERE doc_id='limits'"),
    db.query('SELECT data FROM student_profiles WHERE user_id=$1 OR doc_id=ANY($2::text[])',
      [session.userId, [...context.docIds]]),
    db.query(`SELECT
        COALESCE((SELECT count FROM usage_counters
                  WHERE user_id=$1 AND day=${MOSCOW_TODAY} AND kind=$2), 0) AS used,
        ((${MOSCOW_TODAY} + 1) AT TIME ZONE 'Europe/Moscow') AS reset_at`,
      [session.userId, kind]),
  ]);

  const limits = (config.rows[0] && config.rows[0].data) || {};

  // ⚠️ premium читается из документа ученика, а СВОЙ документ ученик пишет
  // целиком — значит это ещё не защита, а перенос прежнего поведения на сервер.
  // Когда появятся настоящие платежи, источником правды обязана стать таблица
  // подписок (задача 3.1), а не флаг в профиле.
  const premium = profiles.rows.some(row => row.data && (row.data.premium || row.data.premiumAuto));

  let classUnlimited = false;
  if (context.ownClasses && context.ownClasses.size) {
    const unlimited = await db.query(
      `SELECT 1 FROM classes WHERE doc_id=ANY($1::text[])
       AND lower(COALESCE(data->>'unlimited','')) IN ('true','t','1') LIMIT 1`,
      [[...context.ownClasses]]);
    classUnlimited = unlimited.rowCount > 0;
  }

  const staff = !!(context.admin || context.teacher);
  const tariff = premium ? numeric(limits.premiumDaily) : numeric(limits.freeDaily);
  // 0 = безлимит. Освобождены ровно те же категории, что и в прежней клиентской
  // логике: учителя/админы и классы с безлимитом. ДЗ и дуэли освобождаются не
  // тарифом, а тем, что клиент по ним квоту не расходует (window.isQuotaExempt).
  const limit = (staff || classUnlimited) ? 0 : tariff;
  const used = numeric(counter.rows[0].used);

  return {
    limit,
    used,
    left: limit > 0 ? Math.max(0, limit - used) : null,
    premium,
    classUnlimited,
    staff,
    resetAt: new Date(counter.rows[0].reset_at).getTime(),
    clubUrl: String(limits.clubUrl || ''),
    message: String(limits.message || ''),
  };
}

async function consumeQuota(session, context, amount, { db = pool, kind = 'lines' } = {}) {
  const state = await quotaState(session, context, { db, kind });
  if (state.limit <= 0) return { ...state, ok: true };

  // Инкремент и проверка лимита — ОДНИМ оператором. Условие в WHERE не даёт
  // увеличить счётчик, если лимит уже выбран, поэтому две параллельные вкладки
  // не могут проскочить обе: строка блокируется на время UPDATE. Пустой
  // RETURNING и означает отказ.
  const updated = await db.query(
    `INSERT INTO usage_counters(user_id, day, kind, count)
     VALUES ($1, ${MOSCOW_TODAY}, $2, $3)
     ON CONFLICT (user_id, day, kind)
     DO UPDATE SET count = usage_counters.count + EXCLUDED.count, updated_at = now()
     WHERE usage_counters.count < $4
     RETURNING count`,
    [session.userId, kind, amount, state.limit]);

  if (!updated.rowCount) return { ...state, ok: false, used: state.limit, left: 0 };
  const used = numeric(updated.rows[0].count);
  return { ...state, ok: true, used, left: Math.max(0, state.limit - used) };
}

// Разовый расход ограничен сверху: одна проверка ответов не может стоить двести
// строк, а без потолка ошибка клиента выжгла бы дневную квоту одним запросом.
function clampAmount(raw) {
  return Math.min(200, Math.max(1, Math.trunc(Number(raw)) || 1));
}

module.exports = { quotaState, consumeQuota, clampAmount, MOSCOW_TODAY };
