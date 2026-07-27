'use strict';

// Сбор ошибок и продуктовых событий.
//
// Зачем вообще: до 27.07.2026 в проде не было ни агрегатора ошибок, ни
// продуктовой аналитики. Показательный случай — баг textWarnings помечал все 215
// текстовых заданий банка ошибочными У ВСЕХ решавших, и нашли его руками через
// недели. Любая телеметрия показала бы это в первый день.
//
// ⚠️ ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: наружу из браузера приходит текст, который мог
// содержать что угодно — имя ученика, код класса, кусок его состояния. Ни одна
// строка не попадает в базу без чистки. Список scrubbers ниже — единственное
// место, где это решается; добавляешь новое поле — добавь и чистку.

const { pool } = require('./db');
const { sha256 } = require('./crypto');

const MAX_EVENTS_PER_MINUTE = 60;

// Разрешённые имена продуктовых событий. Закрытый перечень намеренно: иначе
// клиент (в том числе подделанный) насыпал бы в таблицу произвольных строк.
const EVENT_NAMES = new Set([
  'app_open', 'first_task_solved', 'daily_goal_done', 'duel_started',
  'exam_started', 'exam_finished', 'limit_reached', 'premium_shown', 'premium_taken',
  'hw_received', 'hw_done',
]);

// Свойства события: только числа и короткие метки из белого списка.
// Никаких строк, введённых человеком.
const EVENT_PROPS = new Set(['task', 'kim', 'points', 'seconds', 'count', 'mode', 'source', 'result']);

function scrubText(value, limit = 300) {
  let text = String(value == null ? '' : value);
  // Сначала выкидываем то, что похоже на персональные данные, и только потом режем.
  text = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    // Telegram ID и любые длинные числа — потенциальные идентификаторы.
    .replace(/\b\d{7,}\b/g, '<id>')
    .replace(/@[A-Za-z0-9_]{4,}/g, '<username>')
    // Токены и ключи в тексте ошибки.
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<hex>')
    .replace(/(token|secret|password|csrf)[=:]\s*\S+/gi, '$1=<redacted>');
  return text.slice(0, limit);
}

// Адрес файла нужен для разбора, а вот query-строка может нести что угодно.
function scrubSource(value) {
  const text = String(value == null ? '' : value).split('?')[0];
  return scrubText(text, 200);
}

function platformOf(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('telegram')) return 'tg';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (ua.includes('android')) return 'android';
  return 'desktop';
}

async function recordClientError(payload, userAgent, { db = pool } = {}) {
  const message = scrubText(payload.message, 300);
  if (!message) return null;
  const source = scrubSource(payload.source);
  const release = scrubText(payload.release, 40);
  const platform = platformOf(userAgent);
  // Одинаковые ошибки схлопываются в одну строку: один сломанный экран у тысячи
  // человек не должен превращаться в тысячу строк за минуту.
  const fingerprint = sha256(`${message}|${source}|${release}|${platform}`).slice(0, 32);

  await db.query(
    `INSERT INTO client_errors(fingerprint, message, source, release, platform)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (fingerprint)
     DO UPDATE SET count = client_errors.count + 1, last_seen_at = now()`,
    [fingerprint, message, source, release, platform]);
  return fingerprint;
}

function cleanProps(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    if (!EVENT_PROPS.has(key)) continue;
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    // Метки — только короткие и без пробелов: 'task4', 'duel', 'swipe'.
    else if (typeof value === 'string' && /^[a-z0-9_-]{1,24}$/i.test(value)) out[key] = value;
  }
  return out;
}

async function recordEvents(userId, events, { db = pool } = {}) {
  const rows = [];
  for (const event of Array.isArray(events) ? events.slice(0, 20) : []) {
    const name = String(event && event.name || '');
    if (!EVENT_NAMES.has(name)) continue;
    rows.push([userId, name, JSON.stringify(cleanProps(event.props))]);
  }
  if (!rows.length) return 0;
  // Одним запросом: события идут пачкой, по одному вставлять их незачем.
  const values = rows.map((_, index) => `($${index * 3 + 1},$${index * 3 + 2},$${index * 3 + 3}::jsonb)`).join(',');
  await db.query(`INSERT INTO product_events(user_id, name, props) VALUES ${values}`, rows.flat());
  return rows.length;
}

// Сводка для админского дашборда. Всё считается в SQL, наружу уходят только
// агрегаты — ни одной строки, привязанной к человеку.
async function metricsSummary({ db = pool } = {}) {
  const [dau, funnel, errors] = await Promise.all([
    db.query(`SELECT (created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
                     count(DISTINCT user_id) AS users
              FROM product_events
              WHERE name='app_open' AND created_at > now() - interval '14 days'
              GROUP BY 1 ORDER BY 1 DESC`),
    db.query(`SELECT name, count(*) AS total, count(DISTINCT user_id) AS users
              FROM product_events
              WHERE created_at > now() - interval '7 days'
              GROUP BY 1 ORDER BY 2 DESC`),
    db.query(`SELECT fingerprint, message, source, release, platform, count, last_seen_at
              FROM client_errors
              WHERE last_seen_at > now() - interval '7 days'
              ORDER BY last_seen_at DESC LIMIT 50`),
  ]);
  return { dau: dau.rows, funnel: funnel.rows, errors: errors.rows };
}

module.exports = {
  recordClientError, recordEvents, metricsSummary,
  scrubText, scrubSource, cleanProps, platformOf,
  EVENT_NAMES, MAX_EVENTS_PER_MINUTE,
};
