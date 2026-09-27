'use strict';

// Кошелёк и питомец ученика. Всё, что меняет монеты, выполняется внутри одной
// транзакции под блокировкой строки кошелька (SELECT … FOR UPDATE): две вкладки
// не купят одну вещь на одни и те же деньги, а баланс не уйдёт в минус — это
// дополнительно держит CHECK (balance >= 0) в самой таблице.
//
// Монеты начисляются по ДЕЛЬТЕ счётчиков профиля (totalSolved, egePoints,
// duelWins) относительно запомненных отметок. Отдельного «я решил, дай денег»
// нет: всё, что тренажёр уже считает, приносит монеты само, и новый режим не
// может «забыть начислить».
//
// ⚠️ Честная граница — та же, что у дневного лимита (AGENTS.md): счётчики
// профиля пишет клиент. Поэтому есть потолок монет в сутки, отметки только
// растут (качели «1000 → 500 → 1000» между устройствами не печатают деньги), а
// монеты не продаются за настоящие деньги вообще.

const crypto = require('crypto');
const C = require('./catalog');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MSK = 3 * HOUR;

function httpError(status, code, extra) {
  // Подробности уходят клиенту полем details (так их отдаёт общий обработчик ошибок).
  return Object.assign(new Error(code), { statusCode: status, ...(extra ? { details: extra } : {}) });
}

function mskDay(ms) {
  return new Date(ms + MSK).toISOString().slice(0, 10);
}
function prevDay(day) {
  return new Date(Date.parse(day + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
}
function mskHour(ms) {
  return new Date(ms + MSK).getUTCHours();
}
// Ночь по Москве: питомец спит, шкалы убывают вдвое медленнее. Ученик не
// обязан вставать в три часа ночи кормить.
function isNight(ms) {
  const h = mskHour(ms);
  return h >= 23 || h < 7;
}

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round2 = v => Math.round(v * 100) / 100;
const num = v => Math.max(0, Math.trunc(Number(v) || 0));

// ── Шкалы питомца ─────────────────────────────────────────────────────────
// Считаются лениво: при каждом обращении догоняем время с прошлого раза. Таймеров
// на сервере нет, и выключенный на неделю сервер не «заморит» никого лишним.
// Догоняем не дальше двух недель назад — дольше всё равно всё на нуле.
function decayPet(pet, now) {
  if (!pet) return pet;
  const next = { ...pet };
  let cur = Math.max(Number(next.at) || now, now - 14 * DAY);
  if (cur >= now) { next.at = now; return next; }
  let sat = Number(next.sat) || 0;
  let mood = Number(next.mood) || 0;
  let health = Number(next.health ?? 100);
  let starving = Number(next.starvingH) || 0;
  let sick = !!next.sick;
  while (cur < now) {
    const stop = Math.min(now, (Math.floor(cur / HOUR) + 1) * HOUR);
    const h = (stop - cur) / HOUR;
    const k = isNight(cur) ? 0.5 : 1;
    sat -= 4 * k * h;
    mood -= 2 * k * h;
    if (sat <= 0) {
      sat = 0;
      starving += h;
      if (starving >= 12) health -= 3 * k * h;
    } else {
      starving = 0;
      if (!sick && sat >= 50) health += 2 * h;
    }
    if (health < 35) mood -= 1 * k * h;
    health = clamp(health, 5, 100);
    if (starving >= 12 || health < 35) sick = true;
    cur = stop;
  }
  next.sat = round2(clamp(sat));
  next.mood = round2(clamp(mood));
  next.health = round2(health);
  next.starvingH = round2(starving);
  next.sick = sick;
  next.at = now;
  return next;
}

function petMoodState(pet, now) {
  if (!pet) return null;
  if (pet.sick) return 'sick';
  if (isNight(now)) return 'sleep';
  if (pet.sat < 20) return 'hungry';
  if (pet.mood < 25) return 'sad';
  if (pet.sat > 70 && pet.mood > 70) return 'happy';
  return 'ok';
}

// ── Доступ к данным ───────────────────────────────────────────────────────
async function lockWallet(db, userId) {
  await db.query('INSERT INTO pet_wallets(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
  const { rows } = await db.query('SELECT * FROM pet_wallets WHERE user_id=$1 FOR UPDATE', [userId]);
  return rows[0];
}

async function readWallet(db, userId) {
  const { rows } = await db.query('SELECT * FROM pet_wallets WHERE user_id=$1', [userId]);
  return rows[0] || null;
}

async function saveWallet(db, w) {
  await db.query(`UPDATE pet_wallets SET balance=$2, earned_total=$3, spent_total=$4, marks=$5, daily=$6,
      pet=$7, equipped=$8, name_style=$9, pity=$10, awards=$11, counters=$12, updated_at=now()
    WHERE user_id=$1`, [w.user_id, w.balance, w.earned_total, w.spent_total,
    JSON.stringify(w.marks || {}), JSON.stringify(w.daily || {}), w.pet ? JSON.stringify(w.pet) : null,
    JSON.stringify(w.equipped || {}), w.name_style ? JSON.stringify(w.name_style) : null,
    JSON.stringify(w.pity || {}), JSON.stringify(w.awards || {}), JSON.stringify(w.counters || {})]);
}

async function inventory(db, userId) {
  const { rows } = await db.query('SELECT item_id, qty FROM pet_inventory WHERE user_id=$1 AND qty>0', [userId]);
  const out = {};
  for (const row of rows) out[row.item_id] = Number(row.qty);
  return out;
}

async function addItem(db, userId, itemId, qty, source) {
  await db.query(`INSERT INTO pet_inventory(user_id, item_id, qty, source) VALUES($1,$2,$3,$4)
    ON CONFLICT (user_id, item_id) DO UPDATE SET qty=pet_inventory.qty+EXCLUDED.qty`,
  [userId, itemId, qty, source]);
}

async function takeItem(db, userId, itemId) {
  const { rowCount } = await db.query(
    'UPDATE pet_inventory SET qty=qty-1 WHERE user_id=$1 AND item_id=$2 AND qty>0', [userId, itemId]);
  return rowCount > 0;
}

// Движение монет: строка журнала + изменение баланса в памяти (сохраняет вызывающий
// через saveWallet в той же транзакции). Для разовых причин (ачивка, неделя)
// повтор отсекает уникальный индекс: вернёт false и ничего не начислит.
async function move(db, w, delta, reason, ref = null, details = {}) {
  if (!delta && reason !== 'achievement') return true;
  const once = reason === 'achievement' || reason === 'weekly';
  const { rowCount } = await db.query(
    `INSERT INTO pet_ledger(user_id, delta, reason, ref, details) VALUES($1,$2,$3,$4,$5)
     ${once ? 'ON CONFLICT DO NOTHING' : ''}`,
    [w.user_id, delta, reason, ref, JSON.stringify(details)]);
  if (!rowCount) return false;
  if (delta < 0 && Number(w.balance) + delta < 0) throw httpError(402, 'not_enough_coins');
  w.balance = Number(w.balance) + delta;
  if (delta > 0) w.earned_total = Number(w.earned_total) + delta;
  else w.spent_total = Number(w.spent_total) - delta;
  return true;
}

// Счётчики профиля — берём максимум по всем живым документам человека.
// Слитые дубли (_mergedInto) не считаем: это надгробие прежней личности.
const NUMERIC = field => `MAX(CASE WHEN data->>'${field}' ~ '^[0-9]+([.][0-9]+)?$' THEN (data->>'${field}')::numeric ELSE 0 END)`;
async function profileCounters(db, userId, docIds) {
  const { rows } = await db.query(
    `SELECT ${NUMERIC('totalSolved')} AS solved, ${NUMERIC('egePoints')} AS ege, ${NUMERIC('duelWins')} AS duel
     FROM student_profiles WHERE (user_id=$1 OR doc_id=ANY($2::text[])) AND data->>'_mergedInto' IS NULL`,
    [userId, [...(docIds || [])]]);
  const row = rows[0] || {};
  return { solved: num(row.solved), ege: num(row.ege), duelWins: num(row.duel) };
}

// ── Начисление за решение ─────────────────────────────────────────────────
// Возвращает список событий для всплывашек клиента: [{reason, delta, ...}].
async function credit(db, w, counters, now) {
  const events = [];
  if (!w.pet || !w.marks || w.marks.solved === undefined) return events;
  const marks = { ...w.marks };
  const d = {
    solved: Math.max(0, counters.solved - num(marks.solved)),
    ege: Math.max(0, counters.ege - num(marks.ege)),
    duelWins: Math.max(0, counters.duelWins - num(marks.duelWins)),
  };
  // Отметки только растут: откат счётчика (другое устройство прислало меньше)
  // не должен потом «доначислить» то же самое второй раз.
  marks.solved = Math.max(num(marks.solved), counters.solved);
  marks.ege = Math.max(num(marks.ege), counters.ege);
  marks.duelWins = Math.max(num(marks.duelWins), counters.duelWins);
  w.marks = marks;

  const raw = d.solved * C.ECONOMY.perLine + d.ege * C.ECONOMY.perEgePoint + d.duelWins * C.ECONOMY.perDuelWin;
  if (!raw) return events;

  const today = mskDay(now);
  const daily = { ...(w.daily || {}) };
  if (daily.day !== today) {
    // Новый день с решением: бонус за первый вход и серия дней подряд.
    daily.streak = daily.lastDay === prevDay(today) ? num(daily.streak) + 1 : 1;
    daily.lastDay = today;
    daily.day = today;
    daily.earned = 0;
    await move(db, w, C.ECONOMY.firstSolveOfDay, 'daily', today);
    events.push({ reason: 'daily', delta: C.ECONOMY.firstSolveOfDay });
    const streakBonus = C.ECONOMY.streakBonus[daily.streak]
      || (daily.streak > 30 && daily.streak % 30 === 0 ? C.ECONOMY.streakBonus[30] : 0);
    if (streakBonus) {
      await move(db, w, streakBonus, 'streak', String(daily.streak));
      events.push({ reason: 'streak', delta: streakBonus, streak: daily.streak });
    }
  }
  const room = Math.max(0, C.ECONOMY.dailyEarnCap - num(daily.earned));
  const paid = Math.min(raw, room);
  daily.earned = num(daily.earned) + paid;
  w.daily = daily;
  if (paid) {
    await move(db, w, paid, 'solve', null, { lines: d.solved, ege: d.ege, duelWins: d.duelWins });
    events.push({ reason: 'solve', delta: paid, lines: d.solved, ege: d.ege, duelWins: d.duelWins });
  }
  if (paid < raw) events.push({ reason: 'cap', delta: 0, lost: raw - paid });

  // Решение радует питомца само по себе: +1 настроения за каждые 5 строк.
  if (d.solved) w.pet = { ...w.pet, mood: round2(clamp(Number(w.pet.mood) + d.solved / 5)) };
  return events;
}

// ── Вид для клиента ───────────────────────────────────────────────────────
function nameStyleView(style, now) {
  if (!style || !style.color || Number(style.until) <= now) return null;
  return { color: style.color, until: Number(style.until), crown: !!style.crown };
}

function view(w, inv, now, extra = {}) {
  const pet = w.pet ? { ...w.pet } : null;
  if (pet) {
    for (const key of ['sat', 'mood', 'health']) pet[key] = Math.round(Number(pet[key]) || 0);
    pet.state = petMoodState(w.pet, now);
    pet.night = isNight(now);
  }
  return {
    // view() зовут только для вылупившегося питомца — признак в каждом ответе,
    // иначе клиент по ответу /achievements решал, что питомца нет, и прятал виджет.
    hatched: !!w.pet,
    balance: Number(w.balance) || 0,
    earnedTotal: Number(w.earned_total) || 0,
    pet,
    equipped: w.equipped || {},
    inventory: inv,
    nameStyle: nameStyleView(w.name_style, now),
    pity: w.pity || {},
    awards: w.awards || {},
    counters: w.counters || {},
    daily: { earned: num(w.daily?.earned), streak: num(w.daily?.streak), day: w.daily?.day || null,
      cap: C.ECONOMY.dailyEarnCap },
    catalogVersion: C.CATALOG_VERSION,
    now,
    ...extra,
  };
}

// ── Действия ──────────────────────────────────────────────────────────────

// Состояние + догоняющее начисление. Кошелёк заводится только при вылуплении:
// до него ученик просто не видит питомца, и строку в базе ради этого не пишем.
async function getState(db, userId, docIds, now = Date.now()) {
  const existing = await readWallet(db, userId);
  const counters = await profileCounters(db, userId, docIds);
  if (!existing || !existing.pet) {
    return {
      hatched: false,
      canHatch: counters.solved >= C.ECONOMY.hatchMinSolved,
      solved: counters.solved,
      balance: Number(existing?.balance) || 0,
      nameStyle: nameStyleView(existing?.name_style, now),
      awards: existing?.awards || {},
      catalogVersion: C.CATALOG_VERSION,
      now,
    };
  }
  const w = await lockWallet(db, userId);
  w.pet = decayPet(w.pet, now);
  const events = await credit(db, w, counters, now);
  await saveWallet(db, w);
  return { hatched: true, ...view(w, await inventory(db, userId), now, { events }) };
}

function cleanName(raw) {
  const name = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return name || 'Летописчик';
}

// Вылупление. Отметки ставятся на ТЕКУЩИЕ счётчики: задним числом монеты за
// прошлые строки не начисляем, иначе ветеран с 5000 строк скупил бы лавку в
// первый же день. Вместо этого — подарок по стажу коробками.
// knownAchievements — ачивки, уже полученные ДО питомца: они оплачиваются нулём,
// чтобы потом не «доплатились» тысячами разом.
async function hatch(db, userId, docIds, { species, name, knownAchievements = [] }, now = Date.now()) {
  if (!C.SPECIES.some(s => s.id === species)) throw httpError(400, 'bad_species');
  const counters = await profileCounters(db, userId, docIds);
  if (counters.solved < C.ECONOMY.hatchMinSolved) throw httpError(403, 'too_early', { need: C.ECONOMY.hatchMinSolved });
  const w = await lockWallet(db, userId);
  if (w.pet) throw httpError(409, 'already_hatched');
  w.pet = { species, name: cleanName(name), sat: 80, mood: 90, health: 100, sick: false, starvingH: 0,
    at: now, hatchedAt: now, toys: {} };
  w.marks = { ...counters };
  w.daily = { day: mskDay(now), earned: 0, streak: 1, lastDay: mskDay(now) };
  await move(db, w, C.ECONOMY.welcomeCoins, 'welcome');
  const boxes = Math.min(C.ECONOMY.veteranBoxMax, Math.floor(counters.solved / C.ECONOMY.veteranBoxPerLines));
  if (boxes) await addItem(db, userId, 'box_chest', boxes, 'veteran');
  for (const [food, qty] of C.ECONOMY.starterFood) await addItem(db, userId, food, qty, 'welcome');
  for (const id of new Set((knownAchievements || []).map(String).slice(0, 200))) {
    if (C.ACHIEVEMENTS[id]) await move(db, w, 0, 'achievement', id, { preHatch: true });
  }
  await saveWallet(db, w);
  return { hatched: true, ...view(w, await inventory(db, userId), now, { gift: { coins: C.ECONOMY.welcomeCoins, boxes } }) };
}

async function withPet(db, userId, now) {
  const w = await lockWallet(db, userId);
  if (!w.pet) throw httpError(409, 'no_pet');
  w.pet = decayPet(w.pet, now);
  return w;
}

function applyFx(pet, fx) {
  const next = { ...pet };
  if (fx.sat) { next.sat = clamp(Number(next.sat) + fx.sat); if (next.sat > 0) next.starvingH = 0; }
  if (fx.mood) next.mood = clamp(Number(next.mood) + fx.mood);
  if (fx.health) {
    next.health = clamp(Number(next.health) + fx.health);
    if (next.health >= 60) next.sick = false;
  }
  return next;
}

// Покупка: еда, лекарства и коробки копятся в кладовой; одежда и игрушки — по
// одной навсегда (повторная покупка — 409, а не молчаливое списание).
async function buy(db, userId, itemId, qty = 1, now = Date.now()) {
  const item = C.BY_ID.get(itemId);
  if (!item || !item.price) throw httpError(400, 'not_for_sale');
  const w = await withPet(db, userId, now);
  const inv = await inventory(db, userId);
  const unique = item.kind === 'wear' || item.kind === 'toy';
  const count = unique ? 1 : Math.max(1, Math.min(20, num(qty) || 1));
  if (unique && inv[itemId]) throw httpError(409, 'already_owned');
  await move(db, w, -item.price * count, 'buy', itemId, { qty: count });
  if (unique) {
    // Вторая линия к FOR UPDATE: уникальную вещь база не положит дважды, и
    // исключение откатит списание вместе со всей транзакцией.
    const { rowCount } = await db.query(`INSERT INTO pet_inventory(user_id, item_id, qty, source)
      VALUES($1,$2,1,'shop') ON CONFLICT (user_id, item_id) DO UPDATE SET qty=1
      WHERE pet_inventory.qty=0`, [userId, itemId]);
    if (!rowCount) throw httpError(409, 'already_owned');
  } else {
    await addItem(db, userId, itemId, count, 'shop');
  }
  await bumpCollectionCounters(db, w, userId);
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { bought: { id: itemId, qty: count } });
}

// Кормить / лечить / играть. buy:true — «купить и сразу дать» одним нажатием.
async function use(db, userId, itemId, { buyNow = false } = {}, now = Date.now()) {
  const item = C.BY_ID.get(itemId);
  if (!item || !['food', 'med', 'toy'].includes(item.kind)) throw httpError(400, 'bad_item');
  const w = await withPet(db, userId, now);
  if (item.kind === 'toy') {
    const inv = await inventory(db, userId);
    if (!inv[itemId]) throw httpError(409, 'not_owned');
    if (isNight(now)) throw httpError(409, 'pet_sleeping');
    const last = Number(w.pet.toys?.[itemId]) || 0;
    if (now - last < C.TOY_COOLDOWN_MS) throw httpError(429, 'toy_cooldown', { readyAt: last + C.TOY_COOLDOWN_MS });
    w.pet = applyFx({ ...w.pet, toys: { ...(w.pet.toys || {}), [itemId]: now } }, item.fx);
  } else {
    if (!(await takeItem(db, userId, itemId))) {
      if (!buyNow) throw httpError(409, 'not_owned');
      await move(db, w, -item.price, 'buy', itemId, { qty: 1, used: true });
    }
    w.pet = applyFx(w.pet, item.fx);
    if (item.kind === 'food') {
      const counters = { ...(w.counters || {}) };
      const today = mskDay(now);
      if (counters.lastFedDay !== today) {
        counters.fedStreak = counters.lastFedDay === prevDay(today) ? num(counters.fedStreak) + 1 : 1;
        counters.lastFedDay = today;
      }
      w.counters = counters;
    }
  }
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { used: itemId });
}

// Надеть. null — снять. Надеть можно только своё и только в свой слот.
async function equip(db, userId, changes, now = Date.now()) {
  const w = await withPet(db, userId, now);
  const inv = await inventory(db, userId);
  const equipped = { ...(w.equipped || {}) };
  for (const [slot, itemId] of Object.entries(changes || {})) {
    if (!C.SLOTS.includes(slot)) throw httpError(400, 'bad_slot');
    if (itemId === null || itemId === '') { delete equipped[slot]; continue; }
    const item = C.BY_ID.get(String(itemId));
    if (!item || item.kind !== 'wear' || item.slot !== slot) throw httpError(400, 'bad_item');
    if (!inv[item.id]) throw httpError(409, 'not_owned');
    equipped[slot] = item.id;
  }
  w.equipped = equipped;
  await saveWallet(db, w);
  return view(w, inv, now);
}

async function rename(db, userId, name, now = Date.now()) {
  const w = await withPet(db, userId, now);
  w.pet = { ...w.pet, name: cleanName(name) };
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now);
}

// ── Коробки ───────────────────────────────────────────────────────────────
const RANK = Object.fromEntries(C.RARITIES.map((r, i) => [r, i]));

function rollRarity(box, pityCount, rand = crypto.randomInt) {
  // Броски в десятитысячных процента — чтобы 0,1% был честным целым числом.
  const table = C.RARITIES.map(r => [r, Math.round((box.odds[r] || 0) * 10000)]);
  const total = table.reduce((s, [, v]) => s + v, 0);
  let pick = rand(total);
  let rarity = table[table.length - 1][0];
  for (const [r, weight] of table) {
    if (pick < weight) { rarity = r; break; }
    pick -= weight;
  }
  // Гарант: каждая N-я коробка не ниже заявленной редкости.
  if (box.pity && pityCount + 1 >= box.pity.every && RANK[rarity] < RANK[box.pity.atLeast]) {
    rarity = box.pity.atLeast;
  }
  return rarity;
}

async function openBox(db, userId, boxId, now = Date.now(), rand = crypto.randomInt) {
  const box = C.BOXES.find(b => b.id === boxId);
  if (!box) throw httpError(400, 'bad_box');
  const w = await withPet(db, userId, now);
  if (!(await takeItem(db, userId, box.id))) {
    if (!box.price) throw httpError(409, 'not_owned');
    await move(db, w, -box.price, 'box', box.id);
  }
  const pity = { ...(w.pity || {}) };
  const pityCount = num(pity[box.id]);
  const rarity = rollRarity(box, pityCount, rand);
  if (box.pity) pity[box.id] = RANK[rarity] >= RANK[box.pity.atLeast] ? 0 : pityCount + 1;
  w.pity = pity;

  const pool = C.ITEMS.filter(item => item.rarity === rarity);
  const item = pool[rand(pool.length)];
  const inv = await inventory(db, userId);
  let shards = 0;
  if (inv[item.id]) {
    // Повтор не пропадает: превращается в монеты — 40% цены вещи.
    shards = Math.max(1, Math.round(C.itemValue(item) * C.DUPLICATE_SHARE));
    await move(db, w, shards, 'duplicate', item.id);
  } else {
    await addItem(db, userId, item.id, 1, box.id);
  }
  w.counters = { ...(w.counters || {}), boxes: num(w.counters?.boxes) + 1 };
  await bumpCollectionCounters(db, w, userId);
  await saveWallet(db, w);
  let owners = null;
  if (rarity === 'mythic' || rarity === 'legendary') owners = await ownersOf(db, item.id);
  return view(w, await inventory(db, userId), now, {
    drop: { id: item.id, rarity, duplicate: !!shards, shards, owners },
  });
}

async function ownersOf(db, itemId) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM pet_inventory WHERE item_id=$1 AND qty>0', [itemId]);
  return rows[0]?.n || 0;
}

// Сколько людей владеет каждой мифической вещью — витрина редкости.
async function rarityShowcase(db) {
  const ids = C.ITEMS.filter(i => i.rarity === 'mythic' || i.rarity === 'legendary').map(i => i.id);
  const { rows } = await db.query(
    'SELECT item_id, count(*)::int AS n FROM pet_inventory WHERE item_id=ANY($1::text[]) AND qty>0 GROUP BY item_id', [ids]);
  const out = {};
  for (const row of rows) out[row.item_id] = row.n;
  return out;
}

// Для ачивок коллекции: лучшая редкость, собранные эпохи.
async function bumpCollectionCounters(db, w, userId) {
  const inv = await inventory(db, userId);
  let best = -1;
  const byEra = {};
  for (const item of C.ITEMS) {
    if (!inv[item.id]) continue;
    best = Math.max(best, RANK[item.rarity]);
    byEra[item.era] = (byEra[item.era] || 0) + 1;
  }
  const eraTotals = {};
  for (const item of C.ITEMS) eraTotals[item.era] = (eraTotals[item.era] || 0) + 1;
  const fullEras = Object.keys(byEra).filter(era => eraTotals[era] >= 4 && byEra[era] >= 4);
  w.counters = { ...(w.counters || {}), bestRarity: best >= 0 ? C.RARITIES[best] : null,
    wearOwned: C.ITEMS.filter(i => inv[i.id]).length, erasOf4: fullEras.length };
}

// ── Ачивки ────────────────────────────────────────────────────────────────
// Сумма берётся ИЗ КАТАЛОГА по id, а не из запроса; повтор отсекает уникальный
// индекс журнала. Неизвестная ачивка не оплачивается.
async function rewardAchievements(db, userId, ids, now = Date.now()) {
  const w = await withPet(db, userId, now);
  const paid = [];
  for (const id of new Set((ids || []).map(String).slice(0, 50))) {
    const rarity = C.ACHIEVEMENTS[id];
    if (!rarity) continue;
    const amount = C.ACHIEVEMENT_REWARD[rarity];
    if (await move(db, w, amount, 'achievement', id, { rarity })) paid.push({ id, rarity, delta: amount });
  }
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { paid });
}

// Краска для ника на 7 дней. Цвета за топ купить нельзя.
async function paintNick(db, userId, color, now = Date.now()) {
  if (!C.NICK_COLORS[color]) throw httpError(400, 'bad_color');
  const w = await withPet(db, userId, now);
  const current = w.name_style;
  if (current && Number(current.until) > now && C.TOP_NICK_COLORS.includes(current.color)) {
    // Не даём случайно закрасить заслуженное золото купленной краской.
    throw httpError(409, 'top_color_active', { until: Number(current.until) });
  }
  await move(db, w, -C.NICK_PAINT.price, 'paint', color);
  const base = current && Number(current.until) > now && current.color === color ? Number(current.until) : now;
  w.name_style = { color, until: base + C.NICK_PAINT.days * DAY, crown: false, source: 'shop' };
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now);
}

// Слияние аккаунтов (гость → Telegram и т.п.): деньги и вещи переходят к
// основному пользователю. Питомец — тот, у кого он старше; у второго он просто
// исчезает вместе с аккаунтом, но монеты и гардероб складываются.
async function mergeUserData(client, primaryId, secondaryId) {
  const { rows } = await client.query('SELECT * FROM pet_wallets WHERE user_id=$1 FOR UPDATE', [secondaryId]);
  const second = rows[0];
  if (second) {
    const first = await lockWallet(client, primaryId);
    const keepSecondPet = second.pet && (!first.pet || Number(second.pet.hatchedAt) < Number(first.pet.hatchedAt));
    first.balance = Number(first.balance) + Number(second.balance);
    first.earned_total = Number(first.earned_total) + Number(second.earned_total);
    first.spent_total = Number(first.spent_total) + Number(second.spent_total);
    if (keepSecondPet) {
      first.pet = second.pet;
      first.equipped = second.equipped;
    }
    const m1 = first.marks || {};
    const m2 = second.marks || {};
    if (m2.solved !== undefined) {
      first.marks = {
        solved: Math.max(num(m1.solved), num(m2.solved)),
        ege: Math.max(num(m1.ege), num(m2.ege)),
        duelWins: Math.max(num(m1.duelWins), num(m2.duelWins)),
      };
    }
    const s1 = first.name_style;
    const s2 = second.name_style;
    if (s2 && (!s1 || Number(s2.until) > Number(s1.until))) first.name_style = s2;
    const a1 = first.awards || {};
    const a2 = second.awards || {};
    first.awards = { ...a1 };
    for (const key of ['top1', 'top3', 'top10', 'top50']) first.awards[key] = num(a1[key]) + num(a2[key]);
    await saveWallet(client, first);
    await client.query('DELETE FROM pet_wallets WHERE user_id=$1', [secondaryId]);
  }
  await client.query(`INSERT INTO pet_inventory(user_id, item_id, qty, source, acquired_at)
      SELECT $1, item_id, qty, source, acquired_at FROM pet_inventory WHERE user_id=$2
    ON CONFLICT (user_id, item_id) DO UPDATE SET qty=pet_inventory.qty+EXCLUDED.qty`, [primaryId, secondaryId]);
  await client.query('DELETE FROM pet_inventory WHERE user_id=$1', [secondaryId]);
  // Журнал переносим целиком — сумма журнала обязана сходиться с балансом.
  // Разовое начисление, которое было у обоих (оба в топе одной недели), не
  // удаляем, а переименовываем: деньги-то уже сложены в баланс выше.
  await client.query(`UPDATE pet_ledger s SET ref = s.ref || ':merged:' || s.id
    WHERE s.user_id=$2 AND s.reason IN ('achievement','weekly')
      AND EXISTS (SELECT 1 FROM pet_ledger p WHERE p.user_id=$1 AND p.reason=s.reason AND p.ref=s.ref)`,
  [primaryId, secondaryId]);
  await client.query('UPDATE pet_ledger SET user_id=$1 WHERE user_id=$2', [primaryId, secondaryId]);
}

module.exports = {
  mskDay, prevDay, isNight, decayPet, petMoodState, profileCounters, credit, view, getState, hatch,
  buy, use, equip, rename, openBox, rollRarity, rewardAchievements, paintNick, rarityShowcase,
  mergeUserData, lockWallet, saveWallet, addItem, move, readWallet, inventory, nameStyleView, httpError,
};
