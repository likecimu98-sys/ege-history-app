'use strict';

// Итоги недели: снимки топа и разовая выдача наград.
//
// 🔴 Почему снимки, а не профили. Недельные очки живут в профиле ученика
// (weeklyScore + weekStartStr) и переписываются новой неделей при первом же его
// входе в понедельник. К моменту, когда сервер решит «подвести итоги», у
// половины призёров прошлой недели в профиле уже 0 очков новой. Поэтому сервер
// сам каждые 15 минут записывает топ текущей недели, а итоги подводит по
// последнему снимку. Теряется максимум хвост последних 15 минут воскресенья.
//
// Неделя — по Москве, формулой moscow-time.mondayStr (единственной на сервере,
// см. weekly-top.selftest.js).

const { mondayStr } = require('../moscow-time');
const C = require('./catalog');
const W = require('./wallet');

const SNAPSHOT_SIZE = 50;
const DAY = 24 * 3600 * 1000;

async function snapshot(db, now = Date.now()) {
  const week = mondayStr(new Date(now));
  const { rowCount } = await db.query(`INSERT INTO weekly_top_snapshots(week, doc_id, user_id, score, updated_at)
      SELECT $1, doc_id, user_id, COALESCE((data->>'weeklyScore')::numeric, 0)::int, now()
      FROM student_profiles
      WHERE data->>'_mergedInto' IS NULL AND data->>'weekStartStr' = $1
        AND (data->>'weeklyScore') ~ '^[0-9]+([.][0-9]+)?$'
        AND (data->>'weeklyScore')::numeric > 0
      ORDER BY (data->>'weeklyScore')::numeric DESC
      LIMIT ${SNAPSHOT_SIZE}
    ON CONFLICT (week, doc_id) DO UPDATE SET
      score = GREATEST(weekly_top_snapshots.score, EXCLUDED.score),
      user_id = COALESCE(EXCLUDED.user_id, weekly_top_snapshots.user_id),
      updated_at = now()`, [week]);
  return { week, rows: rowCount };
}

function tier(prize) {
  return prize.nick === 'gold' ? 4 : prize.nick === 'silver' ? 3 : prize.nick === 'bronze' ? 2 : prize.nick ? 1 : 0;
}
const STYLE_TIER = { gold: 4, silver: 3, bronze: 2, violet: 1 };

// Подводит все ещё не подведённые недели до текущей (обычно одну — прошлую).
// Разовость держит первичный ключ weekly_awards: строку вставляет только один
// процесс, остальные получают пустой RETURNING и выходят.
async function finalize(pool, tx, now = Date.now(), { notify = true } = {}) {
  const current = mondayStr(new Date(now));
  const { rows: weeks } = await pool.query(
    `SELECT DISTINCT s.week FROM weekly_top_snapshots s
     WHERE s.week < $1 AND NOT EXISTS (SELECT 1 FROM weekly_awards a WHERE a.week = s.week)
     ORDER BY s.week`, [current]);
  const done = [];
  for (const { week } of weeks) {
    const result = await tx(async client => {
      const claim = await client.query(
        'INSERT INTO weekly_awards(week) VALUES($1) ON CONFLICT DO NOTHING RETURNING week', [week]);
      if (!claim.rowCount) return null;
      // Одного человека с двумя документами в топе не дублируем: место — по его лучшему.
      const { rows } = await client.query(`SELECT DISTINCT ON (COALESCE(user_id::text, doc_id))
          doc_id, user_id, score FROM weekly_top_snapshots WHERE week=$1
        ORDER BY COALESCE(user_id::text, doc_id), score DESC`, [week]);
      rows.sort((a, b) => b.score - a.score || String(a.doc_id).localeCompare(String(b.doc_id)));
      const results = [];
      let place = 0;
      for (const row of rows.slice(0, SNAPSHOT_SIZE)) {
        place += 1;
        const prize = C.prizeFor(place);
        const entry = { place, docId: row.doc_id, userId: row.user_id, score: row.score, prize: prize ? { ...prize } : null };
        results.push(entry);
        if (!prize || !row.user_id) continue;
        await grant(client, row.user_id, week, place, prize, now);
      }
      await client.query('UPDATE weekly_awards SET results=$2 WHERE week=$1', [week, JSON.stringify(results)]);
      if (notify) await queueNotifications(client, week, results);
      return { week, winners: results.length };
    });
    if (result) done.push(result);
  }
  return done;
}

async function grant(client, userId, week, place, prize, now) {
  const w = await W.lockWallet(client, userId);
  const paid = await W.move(client, w, prize.coins, 'weekly', week, { place });
  if (!paid) return; // уже выдано (повторный прогон) — ничего не трогаем
  if (prize.box) await W.addItem(client, userId, prize.box, 1, `weekly:${week}`);
  if (prize.nick) {
    const current = w.name_style;
    const currentTier = current && Number(current.until) > now ? (STYLE_TIER[current.color] || 0) : 0;
    const until = now + prize.days * DAY;
    // Более высокий цвет не затираем более низким; равный — продлеваем.
    if (tier(prize) >= currentTier) {
      w.name_style = { color: prize.nick, until: Math.max(until, currentTier === tier(prize) ? Number(current.until) : 0),
        crown: !!prize.crown, source: `weekly:${week}` };
    }
  }
  const awards = { ...(w.awards || {}) };
  if (place === 1) awards.top1 = (Number(awards.top1) || 0) + 1;
  if (place <= 3) awards.top3 = (Number(awards.top3) || 0) + 1;
  if (place <= 10) awards.top10 = (Number(awards.top10) || 0) + 1;
  awards.top50 = (Number(awards.top50) || 0) + 1;
  awards.lastWeek = { week, place };
  w.awards = awards;
  await W.saveWallet(client, w);
}

// Сообщение в Telegram — одним заданием на всю неделю (как hw_assigned_bulk):
// обрыв цикла рассылки не должен оставить без сообщения половину призёров.
async function queueNotifications(client, week, results) {
  const recipients = results
    .filter(r => r.prize && r.place <= 10 && /^\d+$/.test(String(r.docId)))
    .map(r => ({ tgId: String(r.docId), place: r.place, coins: r.prize.coins, nick: r.prize.nick || null,
      days: r.prize.days || 0, box: r.prize.box || null }));
  if (!recipients.length) return;
  await client.query(
    `INSERT INTO notification_jobs(doc_id, data, status) VALUES($1, $2, 'pending') ON CONFLICT (doc_id) DO NOTHING`,
    [`weekly_top_${week}`, JSON.stringify({ type: 'weekly_top', week, recipients, ts: Date.now() })]);
}

module.exports = { snapshot, finalize, SNAPSHOT_SIZE };
