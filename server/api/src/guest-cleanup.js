'use strict';

// Уборка брошенных гостевых аккаунтов.
//
// Каждый посетитель сайта создаёт app_users + user_identities + student_profiles
// + student_states + сессию. Чистки не было, и эти же строки потом просматривает
// каждый запрос.
//
// ⚠️ ГЛАВНОЕ, ЧЕГО НЕ УЧЁЛ ПЛАН. Он предлагал считать гостем того, у кого «нет
// привязанных telegram/google личностей». На этой базе такое правило удалило бы
// живых учеников: замер 27.07.2026 показал 1172 личности с провайдером `legacy`
// — это пользователи, перенесённые миграцией из Firebase, у которых
// telegram-личность появляется только при первом входе через новый API. Плюс 313
// пользователей вообще без личностей неясного происхождения.
// Настоящих гостей — 75, и у них есть однозначная метка: provider = 'guest'.
//
// Поэтому правило требует, чтобы гостевая личность СУЩЕСТВОВАЛА и была
// единственной. Пользователь без личностей вовсе под уборку не попадает никогда:
// «не знаю, кто это» — не повод удалять данные.

const { pool } = require('./db');

// Условие «это брошенный гость». Держим одним куском, чтобы подсчёт и удаление
// не могли разъехаться: показать пользователю одно число, а удалить другое —
// худшее, что здесь может случиться.
const STALE_GUEST_WHERE = `
  u.created_at < now() - ($1 || ' days')::interval
  AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'guest')
  AND NOT EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider <> 'guest')
  AND NOT EXISTS (
      SELECT 1 FROM student_profiles p WHERE p.user_id = u.id AND (
             COALESCE(p.data->>'totalSolved', '0') <> '0'
          OR COALESCE(p.data->>'classCode', '') <> ''
          OR COALESCE(p.data->>'inviteClassCode', '') <> ''
          OR COALESCE(p.data->>'googleEmail', '') <> ''
          OR length(COALESCE(p.data->>'fullStateJson', '')) > 200))
  AND NOT EXISTS (
      SELECT 1 FROM student_states s WHERE s.user_id = u.id
        AND length(COALESCE(s.data->>'fullStateJson', '')) > 200)
`;
// Сравнение totalSolved текстовое, без приведения к числу, намеренно: приведение
// падает на нечисловом значении и уронило бы всю уборку, а текстовое сравнение
// в сомнительном случае оставляет пользователя. Ошибаться надо в сторону «не удалять».

async function countStaleGuests(days = 30, { db = pool } = {}) {
  const result = await db.query(`SELECT count(*)::int AS total FROM app_users u WHERE ${STALE_GUEST_WHERE}`, [String(days)]);
  return result.rows[0].total;
}

async function deleteStaleGuests(days = 30, { db = pool, limit = 500 } = {}) {
  // Порция ограничена: разовое удаление тысяч строк держало бы блокировки и
  // мешало живым запросам. Не успели за раз — доберём через час.
  const result = await db.query(
    `DELETE FROM app_users WHERE id IN (
       SELECT u.id FROM app_users u WHERE ${STALE_GUEST_WHERE} LIMIT ${Number(limit) || 500}
     ) RETURNING id`, [String(days)]);
  return result.rowCount;
}

module.exports = { countStaleGuests, deleteStaleGuests, STALE_GUEST_WHERE };
