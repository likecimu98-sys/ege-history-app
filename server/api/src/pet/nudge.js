'use strict';

// Напоминание в Telegram: «питомец проголодался». Главная петля тамагочи —
// вернуться, чтобы покормить; без напоминания её нет вовсе.
//
// Бережно, чтобы бот не стал спамом, который блокируют:
//  • только днём по Москве, 10:00–20:00;
//  • одному человеку — не чаще раза в двое суток;
//  • только если питомец правда в беде (голоден, болен, тоскует);
//  • только тем, кто заходил в последние 14 дней и не заходил последние 6 часов
//    (был недавно — сам увидит; пропал давно — не донимаем);
//  • у бота отдельный выключатель «🐾 Питомец» в /settings.
// Одно задание на весь проход — как hw_assigned_bulk и weekly_top.

const W = require('./wallet');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const EVERY_MS = 48 * HOUR;

function mskHour(ms) { return new Date(ms + 3 * HOUR).getUTCHours(); }

function reasonFor(pet) {
  if (pet.sick) return 'sick';
  if (pet.sat < 20) return 'hungry';
  if (pet.mood < 20) return 'sad';
  return null;
}

async function nudge(pool, tx, now = Date.now()) {
  const hour = mskHour(now);
  if (hour < 10 || hour >= 20) return 0;
  return tx(async client => {
    const { rows } = await client.query(`SELECT w.user_id, w.pet, w.counters,
        (SELECT i.subject FROM user_identities i WHERE i.user_id = w.user_id AND i.provider = 'telegram' LIMIT 1) AS tg
      FROM pet_wallets w WHERE w.pet IS NOT NULL FOR UPDATE OF w SKIP LOCKED`);
    const recipients = [];
    for (const row of rows) {
      if (!row.tg || !/^\d+$/.test(String(row.tg))) continue;
      const counters = row.counters || {};
      if (now - (Number(counters.lastNudge) || 0) < EVERY_MS) continue;
      const lastSeen = Number(row.pet.at) || 0;
      if (now - lastSeen > 14 * DAY || now - lastSeen < 6 * HOUR) continue;
      const pet = W.decayPet(row.pet, now);
      const reason = reasonFor(pet);
      if (!reason) continue;
      recipients.push({ tgId: String(row.tg), name: String(pet.name || 'Летописчик').slice(0, 20), species: pet.species, reason });
      await client.query(`UPDATE pet_wallets SET counters = counters || jsonb_build_object('lastNudge', $2::bigint)
        WHERE user_id = $1`, [row.user_id, now]);
    }
    if (!recipients.length) return 0;
    const id = `pet_nudge_${W.mskDay(now)}_${hour}`;
    await client.query(`INSERT INTO notification_jobs(doc_id, data, status) VALUES($1, $2, 'pending')
      ON CONFLICT (doc_id) DO NOTHING`, [id, JSON.stringify({ type: 'pet_nudge', recipients, ts: now })]);
    return recipients.length;
  });
}

module.exports = { nudge, reasonFor };
