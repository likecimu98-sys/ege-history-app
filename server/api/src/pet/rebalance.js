'use strict';

// Разовый пересчёт монет под экономику v3 (27.09.2026, решение владельца).
//
// Почему: в v2 ачивки платили 50/150/400/1000, и у первых владельцев питомцев
// основная часть монет пришла не за решение, а за ачивки, открывшиеся разом.
// Правило пересчёта — «как если бы v3 действовала с самого начала»:
//   • каждая оплаченная ачивка — по новой ставке (20/50/120/300);
//   • подарок при вылуплении НЕ отнимаем: для новых он 150, но у тех, кто уже
//     получил 300, это подарок, а не ошибка (симуляция на проде: без этого
//     правила пересчёт срезал бы у каждого по 150 и троих обнулил);
//   • уже решённые строки — по 2 монеты вместо 1, победы в дуэлях — по 30
//     вместо 10, баллы ЕГЭ за таблицы — 0 (двойной счёт);
//   • в минус не уводим: купленное остаётся купленным.
// Разница — одной строкой журнала 'rebalance' с разбивкой, поэтому сумма журнала
// продолжает сходиться с балансом. Разовость — строка в audit_events.

const C = require('./catalog');
const W = require('./wallet');

const MARK = 'pet.rebalance.v3';

async function rebalanceV3(pool, tx) {
  const done = await pool.query('SELECT 1 FROM audit_events WHERE action=$1 LIMIT 1', [MARK]);
  if (done.rowCount) return null;
  const { rows: users } = await pool.query('SELECT user_id FROM pet_wallets');
  const report = [];
  for (const { user_id: userId } of users) {
    const r = await tx(async client => {
      const w = await W.lockWallet(client, userId);
      const already = await client.query("SELECT 1 FROM pet_ledger WHERE user_id=$1 AND reason='rebalance' AND ref='v3'", [userId]);
      if (already.rowCount) return null;
      const { rows } = await client.query('SELECT reason, delta, ref, details FROM pet_ledger WHERE user_id=$1', [userId]);
      const parts = { achievements: 0, welcome: 0, solve: 0 };
      for (const row of rows) {
        const delta = Number(row.delta);
        if (row.reason === 'achievement' && delta > 0) {
          const rarity = row.details?.rarity || C.ACHIEVEMENTS[row.ref];
          parts.achievements += (C.ACHIEVEMENT_REWARD[rarity] || 0) - delta;
        } else if (row.reason === 'solve') {
          const lines = Number(row.details?.lines) || 0;
          const wins = Number(row.details?.duelWins) || 0;
          // v2 не разбивал оплату на ставки — пересчитываем из разбивки details.
          if (row.details && row.details.parts === undefined && row.details.boosted === undefined) {
            parts.solve += lines * C.ECONOMY.rates.solved + wins * C.ECONOMY.rates.duelWins - delta;
          }
        } else if (row.reason === 'daily' || row.reason === 'streak') {
          // Бонусы «первого решения дня» и серии дней в v3 заменены входами и
          // сундуками — выданное не отнимаем.
        }
      }
      let diff = parts.achievements + parts.welcome + parts.solve;
      if (Number(w.balance) + diff < 0) diff = -Number(w.balance);
      await client.query("INSERT INTO pet_ledger(user_id, delta, reason, ref, details) VALUES($1,$2,'rebalance','v3',$3)",
        [userId, diff, JSON.stringify({ ...parts, applied: diff })]);
      w.balance = Number(w.balance) + diff;
      if (diff > 0) w.earned_total = Number(w.earned_total) + diff; else w.spent_total = Number(w.spent_total) - diff;
      // Питомец объяснит перемену при следующем входе.
      w.counters = { ...(w.counters || {}), notice: { kind: 'rebalance', diff, at: Date.now() } };
      await W.saveWallet(client, w);
      return { userId, diff, parts };
    });
    if (r) report.push(r);
  }
  await pool.query('INSERT INTO audit_events(action, target, details) VALUES($1, $2, $3)',
    [MARK, 'pet_wallets', JSON.stringify({ wallets: report.length, total: report.reduce((a, x) => a + x.diff, 0) })]);
  return report;
}

module.exports = { rebalanceV3, MARK };
