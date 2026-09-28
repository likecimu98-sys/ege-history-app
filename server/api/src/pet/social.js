'use strict';

// «Летописчик»: хвастаться без шума (решение владельца 27.09.2026).
// Общей ленты действий нет. Питомца видят тот, кому интересно: профиль по тапу
// в топе с реакциями, «Кто круче?» из двух случайных, редкие «Новости двора».
// Наружу — только публичный id кошелька; свободного текста нет нигде.

const C = require('./catalog');
const W = require('./wallet');

const RANK = Object.fromEntries(C.RARITIES.map((r, i) => [r, i]));

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function httpError(status, code, extra) { return W.httpError(status, code, extra); }

// Мини-вид питомца для чужих глаз: без шкал, кошелька и счётчиков.
function publicPet(row, now) {
  const pet = row.pet || {};
  const level = W.levelOf(num(pet.xp));
  const stage = W.stageOf(level).id;
  return {
    publicId: row.public_id,
    name: pet.name || 'Летописчик',
    species: pet.species,
    level,
    stage,
    stageName: W.stageName(pet.species, stage),
    sick: !!pet.sick,
    equipped: pet.sick ? {} : (row.equipped || {}),
    styleIcon: W.styleIconActive(row, now),
  };
}

async function walletByPublicId(db, publicId) {
  const id = String(publicId || '').slice(0, 32);
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw httpError(404, 'no_pet');
  const { rows } = await db.query('SELECT * FROM pet_wallets WHERE public_id=$1 AND pet IS NOT NULL', [id]);
  if (!rows[0]) throw httpError(404, 'no_pet');
  return rows[0];
}

// Профиль питомца: крупно, коллекция, самая редкая вещь, реакции.
async function profile(db, viewerId, publicId, now = Date.now()) {
  const row = await walletByPublicId(db, publicId);
  const inv = await W.inventory(db, row.user_id);
  const owned = C.ITEMS.filter(item => inv[item.id]);
  const byRarity = {};
  for (const item of owned) byRarity[item.rarity] = (byRarity[item.rarity] || 0) + 1;
  const best = owned.slice().sort((a, b) => (RANK[b.rarity] - RANK[a.rarity]) || (C.itemValue(b) - C.itemValue(a)))[0] || null;
  const day = W.mskDay(now);
  const [reactions, mine, votes] = await Promise.all([
    db.query('SELECT emoji, count(*)::int AS n FROM pet_reactions WHERE to_user=$1 GROUP BY emoji', [row.user_id]),
    viewerId ? db.query('SELECT emoji FROM pet_reactions WHERE from_user=$1 AND to_user=$2 AND day=$3', [viewerId, row.user_id, day])
      : Promise.resolve({ rows: [] }),
    db.query('SELECT count(*)::int AS n FROM pet_votes WHERE winner=$1 AND week=$2', [row.user_id, W.weekOf(now)]),
  ]);
  const counts = {};
  for (const r of reactions.rows) counts[r.emoji] = r.n;
  const rare = [row.pet.species, ...((row.counters?.stable || []).map(p => p.species))]
    .filter(sp => C.SPECIES.some(s => s.id === sp && s.rare));
  return {
    profile: {
      ...publicPet(row, now),
      owner: await W.ownerName(db, row.user_id),
      self: viewerId === row.user_id,
      collection: { owned: owned.length, total: C.ITEMS.length, byRarity },
      bestItem: best ? best.id : null,
      rareSpecies: [...new Set(rare)],
      awards: { top1: num(row.awards?.top1), top3: num(row.awards?.top3), top10: num(row.awards?.top10) },
      reactions: counts,
      myReaction: mine.rows[0]?.emoji || null,
      styleVotes: votes.rows[0]?.n || 0,
    },
  };
}

async function react(db, viewerId, publicId, emoji, now = Date.now()) {
  if (!C.SOCIAL.reactions.includes(emoji)) throw httpError(400, 'bad_emoji');
  const row = await walletByPublicId(db, publicId);
  if (row.user_id === viewerId) throw httpError(400, 'self');
  const { rowCount } = await db.query(
    'INSERT INTO pet_reactions(from_user, to_user, day, emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [viewerId, row.user_id, W.mskDay(now), emoji]);
  if (!rowCount) throw httpError(409, 'already_reacted');
  const me = await W.lockWallet(db, viewerId);
  if (me.pet) { W.markRound(me, 'react', now); await W.saveWallet(db, me); }
  return { ...(await profile(db, viewerId, publicId, now)), round: me.pet ? W.roundView(me, now) : null };
}

// «Кто круче?». Пару выбирает сервер и помнит её: голосовать можно только за
// показанную пару, а не за кого угодно по id.
async function pickPair(db, viewerId) {
  const { rows } = await db.query(
    'SELECT * FROM pet_wallets WHERE pet IS NOT NULL AND user_id <> $1 ORDER BY random() LIMIT 2', [viewerId]);
  return rows.length === 2 ? rows : null;
}

async function battleView(db, w, now) {
  const day = W.mskDay(now);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM pet_votes WHERE voter=$1 AND day=$2', [w.user_id, day]);
  const used = rows[0]?.n || 0;
  const left = Math.max(0, C.SOCIAL.battleDaily - used);
  let pair = null;
  const saved = w.counters?.battle;
  if (left > 0) {
    if (saved && saved.a && saved.b) {
      const got = await db.query('SELECT * FROM pet_wallets WHERE user_id = ANY($1::uuid[]) AND pet IS NOT NULL', [[saved.a, saved.b]]);
      if (got.rows.length === 2) pair = [got.rows.find(r => r.user_id === saved.a), got.rows.find(r => r.user_id === saved.b)];
    }
    if (!pair) {
      pair = await pickPair(db, w.user_id);
      w.counters = { ...(w.counters || {}), battle: pair ? { a: pair[0].user_id, b: pair[1].user_id } : null };
    }
  }
  return { battle: { left, daily: C.SOCIAL.battleDaily, a: pair ? publicPet(pair[0], now) : null, b: pair ? publicPet(pair[1], now) : null } };
}

async function battle(db, userId, now = Date.now()) {
  const w = await W.lockWallet(db, userId);
  if (!w.pet) throw httpError(409, 'no_pet');
  const out = await battleView(db, w, now);
  await W.saveWallet(db, w);
  return out;
}

async function vote(db, userId, pick, now = Date.now()) {
  if (pick !== 'a' && pick !== 'b') throw httpError(400, 'bad_pick');
  const w = await W.lockWallet(db, userId);
  if (!w.pet) throw httpError(409, 'no_pet');
  const saved = w.counters?.battle;
  if (!saved || !saved.a || !saved.b) throw httpError(409, 'no_pair');
  const day = W.mskDay(now);
  const { rows } = await db.query('SELECT count(*)::int AS n FROM pet_votes WHERE voter=$1 AND day=$2', [userId, day]);
  if ((rows[0]?.n || 0) >= C.SOCIAL.battleDaily) throw httpError(429, 'votes_done');
  const winner = pick === 'a' ? saved.a : saved.b;
  const loser = pick === 'a' ? saved.b : saved.a;
  await db.query('INSERT INTO pet_votes(voter, day, week, winner, loser) VALUES($1,$2,$3,$4,$5)',
    [userId, day, W.weekOf(now), winner, loser]);
  const events = [];
  await W.addXp(db, w, C.SOCIAL.battleXp, events);
  w.counters = { ...(w.counters || {}), battle: null, votes: num(w.counters?.votes) + 1 };
  W.markRound(w, 'vote', now);
  const next = await battleView(db, w, now);
  await W.saveWallet(db, w);
  return { ...next, events, voted: pick, round: W.roundView(w, now) };
}

// «Новости двора»: не больше пяти за последние сутки.
async function news(db, now = Date.now()) {
  const { rows } = await db.query(
    `SELECT n.kind, n.params, n.created_at, w.public_id FROM pet_news n LEFT JOIN pet_wallets w ON w.user_id = n.user_id AND w.pet IS NOT NULL
     WHERE n.created_at > to_timestamp($1 / 1000.0) - interval '24 hours'
     ORDER BY n.created_at DESC LIMIT 5`, [now]);
  // publicId — чтобы тап по новости открывал профиль героя (наружу только публичный id).
  return { news: rows.map(r => ({ kind: r.kind, ...(r.params || {}), at: new Date(r.created_at).getTime(), publicId: r.public_id || null })) };
}

module.exports = { profile, react, battle, vote, news, publicPet };
