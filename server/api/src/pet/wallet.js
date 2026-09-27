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
// Какое поле профиля — какой счётчик кошелька. Все монотонные (клиент сливает
// их через max), поэтому дельта против отметки честно значит «сделано с прошлого раза».
const PROFILE_COUNTERS = {
  solved: 'totalSolved', ege: 'egePoints', duelWins: 'duelWins', duelGames: 'duelGames',
  facts: 'factsLearned', mockPoints: 'mockPoints', mocksDone: 'mocksDone', fipiPoints: 'fipiPoints',
  perfect: 'perfectTables', hwOnTime: 'hwOnTime',
};
async function profileCounters(db, userId, docIds) {
  const cols = Object.entries(PROFILE_COUNTERS).map(([key, field]) => `${NUMERIC(field)} AS "${key}"`).join(', ');
  const { rows } = await db.query(
    `SELECT ${cols} FROM student_profiles WHERE (user_id=$1 OR doc_id=ANY($2::text[])) AND data->>'_mergedInto' IS NULL`,
    [userId, [...(docIds || [])]]);
  const row = rows[0] || {};
  const out = {};
  for (const key of Object.keys(PROFILE_COUNTERS)) out[key] = num(row[key]);
  return out;
}

// ── Уровни и рост ─────────────────────────────────────────────────────────
// Питомец растёт от опыта: монеты за решение, бонусы дня и уход (кормить,
// лечить, играть, гладить). Опыт только растёт — питомец не «худеет» в уровнях,
// даже если его забросили: наказание за заброшенность — голод и болезнь, а не
// потеря того, что ученик уже вырастил.
// Шаг от уровня n к n+1 — 100 + 40·(n−1) опыта: 2-й уровень — за день занятий,
// 5-й — примерно за неделю, 15-й — за месяц-полтора, 30-й — за полгода.
const STAGES = [
  { id: 'baby', from: 1, name: 'Малыш' },
  { id: 'teen', from: 5, name: 'Подросток' },
  { id: 'adult', from: 15, name: 'Взрослый' },
  { id: 'sage', from: 30, name: 'Мудрец' },
];
function xpForLevel(level) {
  let sum = 0;
  for (let k = 1; k < level; k += 1) sum += 100 + 40 * (k - 1);
  return sum;
}
function levelOf(xp) {
  let level = 1;
  while (level < 99 && xpForLevel(level + 1) <= xp) level += 1;
  return level;
}
function stageOf(level) {
  let stage = STAGES[0];
  for (const s of STAGES) if (level >= s.from) stage = s;
  return stage;
}
// У редких видов у стадий свои имена: «Цесаревич», «Дед инсайд»…
function stageName(species, stageId) {
  const sp = C.SPECIES.find(x => x.id === species);
  return (sp && sp.stages && sp.stages[stageId]) || (STAGES.find(x => x.id === stageId) || STAGES[0]).name;
}
// Награда за уровень: немного монет всегда, сундук на каждом 5-м, ларец на каждом 10-м.
function levelReward(level) {
  return { coins: 20 + 5 * level, box: level % 10 === 0 ? 'box_tsar' : level % 5 === 0 ? 'box_chest' : null };
}
const XP = { feed: 5, heal: 5, play: 3, tap: 1 };

async function addXp(db, w, amount, events) {
  if (!amount || !w.pet) return;
  const before = levelOf(num(w.pet.xp));
  w.pet = { ...w.pet, xp: num(w.pet.xp) + Math.max(0, Math.round(amount)) };
  const after = levelOf(w.pet.xp);
  for (let level = before + 1; level <= after; level += 1) {
    const reward = levelReward(level);
    await move(db, w, reward.coins, 'level', String(level));
    if (reward.box) await addItem(db, w.user_id, reward.box, 1, `level:${level}`);
    const stage = stageOf(level);
    events.push({ reason: 'level', delta: reward.coins, level, box: reward.box,
      stage: stage.id, stageName: stageName(w.pet.species, stage.id), stageUp: stage.id !== stageOf(level - 1).id });
  }
}

// ── Начисление за решение ─────────────────────────────────────────────────
// Возвращает список событий для всплывашек клиента: [{reason, delta, ...}].
// Ставки — C.ECONOMY.rates по счётчикам профиля. Баллы ЕГЭ за таблицу в
// тренажёре (ege) не платятся: таблица уже оплачена строками.
function boostActive(w, now) {
  return now < num(w.counters?.boostUntil) + C.ECONOMY.boostGraceMs;
}

async function credit(db, w, counters, now) {
  const events = [];
  if (!w.pet || !w.marks || w.marks.solved === undefined) return events;
  const marks = { ...w.marks };
  const d = {};
  for (const key of Object.keys(PROFILE_COUNTERS)) {
    // Новый счётчик у старого кошелька: отметку ставим на текущее — задним числом не платим.
    if (marks[key] === undefined) marks[key] = counters[key];
    d[key] = Math.max(0, counters[key] - num(marks[key]));
    // Отметки только растут: откат счётчика (другое устройство прислало меньше)
    // не должен потом «доначислить» то же самое второй раз.
    marks[key] = Math.max(num(marks[key]), counters[key]);
  }
  w.marks = marks;

  let raw = 0;
  const parts = {};
  for (const [key, rate] of Object.entries(C.ECONOMY.rates)) {
    if (d[key]) { parts[key] = d[key]; raw += d[key] * rate; }
  }
  const boosted = boostActive(w, now);
  if (boosted) raw = Math.round(raw * 1.5);

  const today = mskDay(now);
  const daily = { ...(w.daily || {}) };
  if (daily.day !== today) { daily.day = today; daily.earned = 0; }
  const room = Math.max(0, C.ECONOMY.dailyEarnCap - num(daily.earned));
  const paid = Math.min(raw, room);
  daily.earned = num(daily.earned) + paid;
  w.daily = daily;
  if (paid) {
    await move(db, w, paid, 'solve', null, { ...parts, lines: d.solved, boosted });
    events.push({ reason: 'solve', delta: paid, parts, boosted });
  }
  if (paid < raw) events.push({ reason: 'cap', delta: 0, lost: raw - paid });

  if (d.solved) {
    // Питается знаниями: решение само кормит (+4 сытости за 10 строк) и радует.
    const fed = applyFx(w.pet, { sat: d.solved * C.ECONOMY.feedPerLine, mood: d.solved / 5 });
    w.pet = { ...w.pet, sat: round2(fed.sat), mood: round2(fed.mood), starvingH: fed.sat > 0 ? 0 : w.pet.starvingH };
  }
  await addXp(db, w, paid * (boosted ? 2 : 1), events);
  await progressQuests(db, w, counters, now, events);
  return events;
}

// ── День: серия входов, колесо, задания ───────────────────────────────────
// Первый GET /pet за московские сутки — это «вход». Серия растёт, если вчера
// тоже заходил; один пропущенный день спасает заморозка из кладовой.
async function dayTick(db, w, counters, now, events) {
  const today = mskDay(now);
  const c = { ...(w.counters || {}) };
  if (c.loginDay === today) return;
  const yesterday = prevDay(today);
  let streak = 1;
  if (c.loginDay === yesterday) streak = num(c.loginStreak) + 1;
  else if (c.loginDay === prevDay(yesterday) && (await takeItem(db, w.user_id, 'streak_freeze'))) {
    streak = num(c.loginStreak) + 1;
    events.push({ reason: 'freeze', delta: 0 });
  }
  c.loginDay = today;
  c.loginStreak = streak;
  w.counters = c;
  const step = C.LOGIN_STREAK.find(s => s.day === streak)
    || (streak > 30 && streak % 30 === 0 ? C.LOGIN_STREAK[C.LOGIN_STREAK.length - 1] : null);
  if (step) {
    for (const [item, qty] of step.items) await addItem(db, w.user_id, item, qty, `login:${streak}`);
    if (step.fragment) addFragment(w, step.fragment, 1);
    events.push({ reason: 'login', delta: 0, streak, items: step.items, fragment: step.fragment || null });
  }
  // Задания дня — от сегодняшних счётчиков.
  w.counters = { ...w.counters, quests: makeQuests(w.user_id, today, counters) };
}

function addFragment(w, kind, n) {
  const c = { ...(w.counters || {}) };
  c.fragments = { ...(c.fragments || {}), [kind]: num(c.fragments?.[kind]) + n };
  w.counters = c;
}

// Детерминированно по человеку и дню: перезагрузка не перебросит задания.
function seedRand(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
function makeQuests(userId, day, counters) {
  const r = seedRand(userId + ':' + day);
  const lines = C.QUESTS.lines[Math.floor(r() * C.QUESTS.lines.length)];
  const pool = C.QUESTS.other.slice();
  const picked = [];
  while (picked.length < 2 && pool.length) {
    const q = pool.splice(Math.floor(r() * pool.length), 1)[0];
    if (!picked.some(p => p.kind === q.kind)) picked.push(q);
  }
  const list = [{ kind: 'solved', target: lines.target, reward: lines.reward, text: 'Реши {n} строк' }, ...picked]
    .map((q, i) => ({ id: `${day}:${i}`, kind: q.kind, target: q.target, reward: q.reward,
      text: q.text.replace('{n}', q.target), base: counters[q.kind] || 0, done: false }));
  return { day, list, allDone: false };
}

async function progressQuests(db, w, counters, now, events) {
  const q = w.counters?.quests;
  if (!q || q.day !== mskDay(now)) return;
  let changed = false;
  for (const item of q.list) {
    const progress = Math.min(item.target, Math.max(0, (counters[item.kind] || 0) - item.base));
    if (progress !== item.progress) { item.progress = progress; changed = true; }
    if (item.done) continue;
    if (progress >= item.target) {
      item.done = true; changed = true;
      await move(db, w, item.reward, 'quest', item.id);
      events.push({ reason: 'quest', delta: item.reward, text: item.text });
    }
  }
  if (!q.allDone && q.list.every(i => i.done)) {
    q.allDone = true; changed = true;
    await addItem(db, w.user_id, C.QUESTS.allDoneBox, 1, `quests:${q.day}`);
    events.push({ reason: 'quests_all', delta: 0, box: C.QUESTS.allDoneBox });
  }
  if (changed) w.counters = { ...w.counters, quests: q };
}

function questsView(w, counters, now) {
  const q = w.counters?.quests;
  if (!q || q.day !== mskDay(now)) return null;
  return { allDone: q.allDone, list: q.list.map(i => ({ id: i.id, kind: i.kind, text: i.text, target: i.target, reward: i.reward, done: i.done,
    progress: counters ? Math.min(i.target, Math.max(0, (counters[i.kind] || 0) - i.base)) : num(i.progress) })) };
}

// Колесо удачи: одно вращение в московские сутки, бросок на сервере.
async function spin(db, userId, now = Date.now(), rand = crypto.randomInt) {
  const w = await withPet(db, userId, now);
  const today = mskDay(now);
  if (w.counters?.spinDay === today) throw httpError(409, 'already_spun');
  const total = C.WHEEL.reduce((a, x) => a + x.w, 0);
  let pick = rand(total), prize = C.WHEEL[0], index = 0;
  for (let i = 0; i < C.WHEEL.length; i += 1) {
    if (pick < C.WHEEL[i].w) { prize = C.WHEEL[i]; index = i; break; }
    pick -= C.WHEEL[i].w;
  }
  w.counters = { ...(w.counters || {}), spinDay: today };
  if (prize.coins) await move(db, w, prize.coins, 'spin', today, { prize: prize.id });
  if (prize.item) await addItem(db, userId, prize.item, 1, `spin:${today}`);
  if (prize.fragment) addFragment(w, prize.fragment, 1);
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { spin: { index, id: prize.id, coins: prize.coins || 0, item: prize.item || null, fragment: prize.fragment || null } });
}

// ── Вид для клиента ───────────────────────────────────────────────────────
function nameStyleView(style, now) {
  if (!style || !style.color || Number(style.until) <= now) return null;
  return { color: style.color, until: Number(style.until), crown: !!style.crown };
}

function view(w, inv, now, extraIn = {}) {
  // Счётчики профиля нужны только для прогресса заданий — наружу их не отдаём.
  const { counters: profileCountersNow, ...extra } = extraIn;
  const pet = w.pet ? { ...w.pet } : null;
  if (pet) {
    for (const key of ['sat', 'mood', 'health']) pet[key] = Math.round(Number(pet[key]) || 0);
    pet.state = petMoodState(w.pet, now);
    pet.night = isNight(now);
    pet.xp = num(w.pet.xp);
    pet.level = levelOf(pet.xp);
    pet.xpFrom = xpForLevel(pet.level);
    pet.xpTo = xpForLevel(pet.level + 1);
    const stage = stageOf(pet.level);
    pet.stage = stage.id;
    pet.stageName = stageName(pet.species, stage.id);
    const next = STAGES.find(s => s.from > pet.level);
    pet.nextStage = next ? { id: next.id, name: stageName(pet.species, next.id), level: next.from } : null;
    pet.tapReadyAt = num(w.counters?.lastTap) + TAP_COOLDOWN_MS;
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
    daily: { earned: w.daily?.day === mskDay(now) ? num(w.daily?.earned) : 0, cap: C.ECONOMY.dailyEarnCap,
      loginStreak: num(w.counters?.loginStreak), spinReady: w.counters?.spinDay !== mskDay(now),
      nextChest: (C.LOGIN_STREAK.find(s => s.day > num(w.counters?.loginStreak)) || { day: (Math.floor(num(w.counters?.loginStreak) / 30) + 1) * 30 }).day },
    quests: questsView(w, profileCountersNow, now),
    boostUntil: num(w.counters?.boostUntil) > now ? num(w.counters?.boostUntil) : 0,
    fragments: w.counters?.fragments || {},
    stable: stableView(w),
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
  const events = [];
  await dayTick(db, w, counters, now, events);
  events.push(...(await credit(db, w, counters, now)));
  await saveWallet(db, w);
  return { hatched: true, ...view(w, await inventory(db, userId), now, { events, counters }) };
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
  if (!C.SPECIES.some(s => s.id === species && !s.rare)) throw httpError(400, 'bad_species');
  const counters = await profileCounters(db, userId, docIds);
  if (counters.solved < C.ECONOMY.hatchMinSolved) throw httpError(403, 'too_early', { need: C.ECONOMY.hatchMinSolved });
  const w = await lockWallet(db, userId);
  if (w.pet) throw httpError(409, 'already_hatched');
  w.pet = { species, name: cleanName(name), sat: 80, mood: 90, health: 100, sick: false, starvingH: 0,
    at: now, hatchedAt: now, toys: {} };
  w.marks = { ...counters };
  w.daily = { day: mskDay(now), earned: 0 };
  w.counters = { ...(w.counters || {}), loginDay: mskDay(now), loginStreak: 1, quests: makeQuests(userId, mskDay(now), counters) };
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
  const count = unique || item.kind === 'freeze' ? 1 : Math.max(1, Math.min(20, num(qty) || 1));
  if (unique && inv[itemId]) throw httpError(409, 'already_owned');
  // Заморозка серии: в кладовой не больше одной — это страховка, а не запас.
  if (item.kind === 'freeze' && inv[itemId]) throw httpError(409, 'already_owned');
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
  if (!item || !['food', 'med', 'toy', 'boost'].includes(item.kind)) throw httpError(400, 'bad_item');
  const w = await withPet(db, userId, now);
  const events = [];
  if (item.kind === 'boost') {
    // Один ускоритель за раз: второй не продлевает первый, а ждёт в кладовой.
    if (num(w.counters?.boostUntil) > now) throw httpError(409, 'boost_active', { until: num(w.counters.boostUntil) });
    if (!(await takeItem(db, userId, itemId))) {
      if (!buyNow) throw httpError(409, 'not_owned');
      await move(db, w, -item.price, 'buy', itemId, { qty: 1, used: true });
    }
    w.counters = { ...(w.counters || {}), boostUntil: now + item.fx.minutes * 60 * 1000 };
    events.push({ reason: 'boost', delta: 0, until: w.counters.boostUntil });
  } else if (item.kind === 'toy') {
    const inv = await inventory(db, userId);
    if (!inv[itemId]) throw httpError(409, 'not_owned');
    if (isNight(now)) throw httpError(409, 'pet_sleeping');
    const last = Number(w.pet.toys?.[itemId]) || 0;
    if (now - last < C.TOY_COOLDOWN_MS) throw httpError(429, 'toy_cooldown', { readyAt: last + C.TOY_COOLDOWN_MS });
    w.pet = applyFx({ ...w.pet, toys: { ...(w.pet.toys || {}), [itemId]: now } }, item.fx);
    await addXp(db, w, XP.play, events);
  } else {
    if (!(await takeItem(db, userId, itemId))) {
      if (!buyNow) throw httpError(409, 'not_owned');
      await move(db, w, -item.price, 'buy', itemId, { qty: 1, used: true });
    }
    w.pet = applyFx(w.pet, item.fx);
    await addXp(db, w, item.kind === 'med' ? XP.heal : XP.feed, events);
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
  return view(w, await inventory(db, userId), now, { used: itemId, events });
}

// Погладить. Реакцию клиент рисует всегда, а настроение и опыт сервер даёт не
// чаще раза в минуту и не больше 30 раз в день: иначе автокликер вырастил бы
// питомца без единой решённой строки. Спящего погладить можно — но он спит.
const TAP_COOLDOWN_MS = 60 * 1000;
const TAPS_PER_DAY = 30;
async function tap(db, userId, now = Date.now()) {
  const w = await withPet(db, userId, now);
  const counters = { ...(w.counters || {}) };
  const today = mskDay(now);
  if (counters.tapDay !== today) { counters.tapDay = today; counters.taps = 0; }
  const events = [];
  let counted = false;
  if (!isNight(now) && now - num(counters.lastTap) >= TAP_COOLDOWN_MS && num(counters.taps) < TAPS_PER_DAY) {
    counters.lastTap = now;
    counters.taps = num(counters.taps) + 1;
    w.pet = applyFx(w.pet, { mood: 2 });
    counted = true;
  }
  w.counters = counters;
  if (counted) await addXp(db, w, XP.tap, events);
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { tapped: counted, events });
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

  // Редкий вид — отдельный бросок поверх вещи. Считаем «с верхнего края»
  // диапазона: подставной бросок () => 0 в тестах вида не даёт никогда.
  const fragments = rollFragments(box, rand);
  for (const [kind, n] of Object.entries(fragments)) addFragment(w, kind, n);
  const species = rollRareSpecies(w, box, rand);
  if (species) {
    addToStable(w, species, now);
    if (box.pity) pity[box.id] = 0;
    w.counters = { ...(w.counters || {}), boxes: num(w.counters?.boxes) + 1 };
    await saveWallet(db, w);
    return view(w, inv, now, {
      drop: { species, rarity: 'mythic', owners: await speciesOwners(db, species), fragments },
    });
  }
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
    drop: { id: item.id, rarity, duplicate: !!shards, shards, owners, fragments },
  });
}

// ── Питомник: редкие виды и смена питомца ─────────────────────────────────
const TOP = 1000000; // броски в десятитысячных процента
function hitTop(rand, pct) {
  const edge = Math.round(pct * 10000);
  return edge > 0 && rand(TOP) >= TOP - edge;
}
function ownedSpecies(w) {
  const set = new Set((w.counters?.stable || []).map(p => p.species));
  if (w.pet) set.add(w.pet.species);
  return set;
}
function rollRareSpecies(w, box, rand) {
  const table = C.RARE_SPECIES_DROPS[box.id];
  if (!table) return null;
  const owned = ownedSpecies(w);
  if ((w.counters?.stable || []).length >= C.STABLE_MAX) return null;
  // Сначала самый редкий: у кого нет Николая, бросок за него идёт первым.
  for (const [species, pct] of Object.entries(table).sort((a, b) => a[1] - b[1])) {
    if (hitTop(rand, pct) && !owned.has(species)) return species;
  }
  return null;
}
function rollFragments(box, rand) {
  const out = {};
  for (const [kind, pct] of Object.entries(C.FRAGMENT_DROPS[box.id] || {})) {
    if (hitTop(rand, pct)) out[kind] = 1;
  }
  return out;
}
function newPet(species, now) {
  const sp = C.SPECIES.find(x => x.id === species);
  return { species, name: sp?.petName || sp?.name || 'Летописчик', sat: 80, mood: 90, health: 100, sick: false,
    starvingH: 0, at: now, hatchedAt: now, toys: {}, xp: 0, equipped: {} };
}
function addToStable(w, species, now) {
  const stable = [...(w.counters?.stable || []), newPet(species, now)];
  w.counters = { ...(w.counters || {}), stable };
}
function stableView(w) {
  return (w.counters?.stable || []).map((p, index) => {
    const level = levelOf(num(p.xp));
    const stage = stageOf(level).id;
    return { index, species: p.species, name: p.name, level, stage, stageName: stageName(p.species, stage),
      equipped: p.equipped || {}, sick: !!p.sick };
  });
}
async function speciesOwners(db, species) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM pet_wallets WHERE pet->>'species'=$1 OR counters->'stable' @> $2::jsonb",
    [species, JSON.stringify([{ species }])]);
  return rows[0]?.n || 0;
}
async function speciesShowcase(db) {
  const out = {};
  for (const sp of C.SPECIES.filter(x => x.rare)) out[`species:${sp.id}`] = await speciesOwners(db, sp.id);
  return out;
}

// Собрать редкий вид из осколков.
async function craft(db, userId, species, now = Date.now()) {
  const sp = C.SPECIES.find(x => x.id === species && x.rare);
  if (!sp) throw httpError(400, 'bad_species');
  const w = await withPet(db, userId, now);
  const frag = C.FRAGMENTS[sp.fragment];
  const have = num(w.counters?.fragments?.[sp.fragment]);
  if (have < frag.need) throw httpError(409, 'not_enough_fragments', { need: frag.need, have });
  if (ownedSpecies(w).has(species)) throw httpError(409, 'already_owned');
  if ((w.counters?.stable || []).length >= C.STABLE_MAX) throw httpError(409, 'stable_full');
  w.counters = { ...(w.counters || {}), fragments: { ...(w.counters?.fragments || {}), [sp.fragment]: have - frag.need } };
  addToStable(w, species, now);
  await saveWallet(db, w);
  return view(w, await inventory(db, userId), now, { crafted: { species, owners: await speciesOwners(db, species) } });
}

// Сменить питомца: выбранный из питомника выходит, нынешний уходит отдыхать.
// В питомнике время стоит — голод и грусть не копятся, пока питомец отдыхает.
async function switchPet(db, userId, index, now = Date.now()) {
  const w = await withPet(db, userId, now);
  const stable = [...(w.counters?.stable || [])];
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= stable.length) throw httpError(400, 'bad_index');
  const incoming = { ...stable[i] };
  const equipped = incoming.equipped || {};
  delete incoming.equipped;
  stable[i] = { ...w.pet, equipped: w.equipped || {} };
  w.pet = { ...incoming, at: now };
  const inv = await inventory(db, userId);
  // Надетым остаётся только то, что по-прежнему есть в кладовой.
  w.equipped = Object.fromEntries(Object.entries(equipped).filter(([, id]) => inv[id]));
  w.counters = { ...(w.counters || {}), stable };
  await saveWallet(db, w);
  return view(w, inv, now);
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
    const loser = keepSecondPet ? (first.pet ? { ...first.pet, equipped: first.equipped || {} } : null)
      : (second.pet ? { ...second.pet, equipped: second.equipped || {} } : null);
    if (keepSecondPet) {
      first.pet = second.pet;
      first.equipped = second.equipped;
    }
    // Питомник и осколки обоих складываются; второй питомец уходит в питомник.
    const c1 = first.counters || {};
    const c2 = second.counters || {};
    const fragments = { ...(c1.fragments || {}) };
    for (const [k, v] of Object.entries(c2.fragments || {})) fragments[k] = num(fragments[k]) + num(v);
    const stable = [...(c1.stable || []), ...(c2.stable || []), ...(loser ? [loser] : [])].slice(0, C.STABLE_MAX);
    first.counters = { ...c2, ...c1, fragments, stable };
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
  spin, dayTick, makeQuests, progressQuests, boostActive, PROFILE_COUNTERS, addFragment,
  tap, levelOf, xpForLevel, stageOf, levelReward, addXp, STAGES, TAP_COOLDOWN_MS,
  craft, switchPet, speciesOwners, speciesShowcase, stageName,
  mskDay, prevDay, isNight, decayPet, petMoodState, profileCounters, credit, view, getState, hatch,
  buy, use, equip, rename, openBox, rollRarity, rewardAchievements, paintNick, rarityShowcase,
  mergeUserData, lockWallet, saveWallet, addItem, move, readWallet, inventory, nameStyleView, httpError,
};
