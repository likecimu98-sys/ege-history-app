'use strict';

// Живой прогон «Летописчика» на НАСТОЯЩЕМ PostgreSQL — встроенном (PGlite).
//
// Остальные тесты API ходят в подставное соединение и проверяют, какой SQL
// отправлен. Здесь этого мало: деньги держатся на ON CONFLICT, CHECK и
// уникальных индексах, и проверять их надо в живой базе. PGlite — dev-зависимость,
// на сервере при деплое (npm ci --omit=dev) её нет, и тест честно пропускается.
// Локально: npm i --no-save @electric-sql/pglite && node --test test/pet-live.test.js
//
// ⚠️ PGlite — одно соединение, настоящую гонку двух вкладок он не воспроизводит.
// Её держит SELECT … FOR UPDATE на строке кошелька плюс уникальность вещи в базе.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

let PGlite = null;
try { ({ PGlite } = require('@electric-sql/pglite')); } catch (_) { /* нет — пропускаем */ }

const API = path.join(__dirname, '..');
const W = require('../src/pet/wallet');
const WK = require('../src/pet/weekly');
const C = require('../src/pet/catalog');

function adapt(pg) {
  return {
    async query(sql, params = []) {
      const r = await pg.query(sql, params);
      // PGlite для SELECT отдаёт affectedRows = 0 — число строк берём из самих строк.
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
  };
}

const H = 3600e3;
const D = 24 * H;

test('экономика v3, питомец, коробки, итоги, рейтинг, слияние, пересчёт — на живой базе', { skip: !PGlite && 'нет @electric-sql/pglite' }, async () => {
  const pg = new PGlite();
  for (const f of fs.readdirSync(path.join(API, 'migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    await pg.exec(fs.readFileSync(path.join(API, 'migrations', f), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, ''));
  }
  const db = adapt(pg);
  const tx = fn => pg.transaction(t => fn(adapt(t)));
  const pool = db;
  const newUser = async name => (await db.query('INSERT INTO app_users(display_name) VALUES($1) RETURNING id', [name])).rows[0].id;
  const setProfile = (doc, user, data) => db.query(
    `INSERT INTO student_profiles(doc_id,user_id,data) VALUES($1,$2,$3)
     ON CONFLICT (doc_id) DO UPDATE SET data=student_profiles.data || EXCLUDED.data`, [doc, user, JSON.stringify(data)]);
  const allEvents = [];
  const state = async (u, doc, t) => { const r = await tx(c => W.getState(c, u, [doc], t)); if (r.events) allEvents.push(...r.events); return r; };

  const u1 = await newUser('Аня');
  const u2 = await newUser('Боря');
  await setProfile('111', u1, { name: 'Аня', totalSolved: 5 });
  const t = Date.parse('2026-09-28T09:00:00Z'); // понедельник, 12:00 МСК

  // 1. Новичок: питомца нет, вылупить нельзя.
  let st = await state(u1, '111', t);
  assert.equal(st.hatched, false); assert.equal(st.canHatch, false);
  await assert.rejects(tx(c => W.hatch(c, u1, ['111'], { species: 'owl' }, t)), /too_early/);

  // 2. Ветеран 1200 строк: 150 монет + 2 сундука + щи; ачивки до питомца — нулём;
  //    серия входов 1 и три задания дня.
  await setProfile('111', u1, { totalSolved: 1200, egePoints: 40 });
  st = await tx(c => W.hatch(c, u1, ['111'], { species: 'owl', name: '<b>Филя</b>', knownAchievements: ['lines_500', 'lines_50'] }, t));
  assert.equal(st.balance, 150); assert.equal(st.inventory.box_chest, 2); assert.equal(st.inventory.food_shchi, 2);
  assert.equal(st.pet.name, 'bФиля/b');
  assert.equal(st.daily.loginStreak, 1); assert.equal(st.daily.spinReady, true);
  await assert.rejects(tx(c => W.hatch(c, u1, ['111'], { species: 'owl' }, t)), /already_hatched/);
  st = await tx(c => W.rewardAchievements(c, u1, ['lines_500', 'lines_2000', 'fake'], t));
  assert.deepEqual(st.paid.map(p => p.id), ['lines_2000']);
  assert.equal(st.balance, 150 + C.ACHIEVEMENT_REWARD.epic);

  // 3. Решение: 100 строк × 2 + 2 факта × 10 = 220. Баллы ЕГЭ за таблицы не платятся.
  //    Сытость растёт сама — питается знаниями.
  await db.query("UPDATE pet_wallets SET pet = pet || '{\"sat\": 30}'::jsonb WHERE user_id=$1", [u1]);
  await setProfile('111', u1, { totalSolved: 1300, egePoints: 45, factsLearned: 2 });
  const before3 = st.balance;
  st = await state(u1, '111', t + H);
  const solve = st.events.find(e => e.reason === 'solve');
  assert.equal(solve.delta, 220, JSON.stringify(st.events));
  assert.equal(solve.parts.ege, undefined, 'баллы ЕГЭ за таблицы не оплачиваются');
  assert.ok(st.pet.sat >= 30 + 40 - 5, 'знания кормят: +40 сытости за 100 строк, ' + st.pet.sat);
  const gained3 = st.events.reduce((a, e) => a + (e.delta || 0), 0);
  assert.equal(st.balance, before3 + gained3);
  assert.ok(st.quests && st.quests.list.length === 3, 'три задания дня');
  let bal = st.balance;

  // Откат счётчика и обратно — денег не печатает.
  await setProfile('111', u1, { totalSolved: 1000 });
  await state(u1, '111', t + 1.1 * H);
  await setProfile('111', u1, { totalSolved: 1300 });
  st = await state(u1, '111', t + 1.2 * H);
  assert.equal(st.balance, bal);

  // 4. Пробник и дуэли: 15 баллов × 10 + пробник 50 + 3 игры × 5 + 2 победы × 30.
  await setProfile('111', u1, { mockPoints: 15, mocksDone: 1, duelGames: 3, duelWins: 2 });
  st = await state(u1, '111', t + 2 * H);
  assert.equal(st.events.find(e => e.reason === 'solve').delta, 150 + 50 + 15 + 60, JSON.stringify(st.events));
  bal = st.balance;

  // 5. Колесо: раз в сутки, бросок на сервере.
  st = await tx(c => W.spin(c, u1, t + 2 * H, () => 0)); // первый сектор — 20 монет
  assert.equal(st.spin.coins, 20); assert.equal(st.balance, bal + 20);
  await assert.rejects(tx(c => W.spin(c, u1, t + 3 * H)), /already_spun/);
  bal = st.balance;

  // 6. Ускоритель: ×1,5 монет, ×2 опыта на 30 минут; второй поверх — нельзя.
  st = await tx(c => W.use(c, u1, 'boost_elixir', { buyNow: true }, t + 3 * H));
  assert.ok(st.boostUntil > t + 3 * H); bal -= 250; assert.equal(st.balance, bal);
  await assert.rejects(tx(c => W.use(c, u1, 'boost_elixir', { buyNow: true }, t + 3 * H + 1000)), /boost_active/);
  const xpBefore = st.pet.xp;
  await setProfile('111', u1, { totalSolved: 1340 }); // 40 строк → 80 × 1,5 = 120
  st = await state(u1, '111', t + 3 * H + 10 * 60e3);
  const boostedSolve = st.events.find(e => e.reason === 'solve');
  assert.equal(boostedSolve.delta, 120); assert.equal(boostedSolve.boosted, true);
  assert.ok(st.pet.xp - xpBefore >= 240, 'опыт ×2 под ускорителем');

  // 7. Задания дня: докручиваем все три — монеты за каждое и сундук за все.
  const map = { solved: 'totalSolved', facts: 'factsLearned', perfect: 'perfectTables', duelGames: 'duelGames', duelWins: 'duelWins', fipiPoints: 'fipiPoints', mocksDone: 'mocksDone' };
  const cur = { totalSolved: 1340, factsLearned: 2, perfectTables: 0, duelGames: 3, duelWins: 2, fipiPoints: 0, mocksDone: 1 };
  const patch = {};
  for (const q of st.quests.list) patch[map[q.kind] || q.kind] = (cur[map[q.kind]] || 0) + q.target + 1;
  await setProfile('111', u1, patch);
  st = await state(u1, '111', t + 5 * H);
  // Часть заданий закрылась ещё на шагах 3–4 (строки, дуэли) — считаем за весь день.
  assert.equal(allEvents.filter(e => e.reason === 'quest').length, 3, JSON.stringify(allEvents.filter(e => e.reason.startsWith('quest'))));
  assert.equal(allEvents.filter(e => e.reason === 'quests_all').length, 1);
  assert.ok(st.quests.allDone);
  assert.ok(st.quests.list.every(q => q.done && q.progress === q.target));

  // 8. Потолок дня — 5000 за решение.
  await setProfile('111', u1, { totalSolved: 9000 });
  st = await state(u1, '111', t + 6 * H);
  assert.ok(st.events.some(e => e.reason === 'cap'));
  assert.equal(st.daily.earned, C.ECONOMY.dailyEarnCap);

  // 9. Серия входов: 3-й день — сундук; пропуск с заморозкой не сбрасывает серию.
  st = await state(u1, '111', t + D);
  assert.equal(st.daily.loginStreak, 2); assert.equal(st.daily.spinReady, true);
  const chestsDay3 = (await W.inventory(db, u1)).box_chest || 0;
  st = await state(u1, '111', t + 2 * D);
  assert.equal(st.daily.loginStreak, 3);
  assert.ok(st.events.some(e => e.reason === 'login'));
  assert.equal(st.inventory.box_chest, chestsDay3 + 1);
  await tx(c => W.buy(c, u1, 'streak_freeze', 1, t + 2 * D));
  await assert.rejects(tx(c => W.buy(c, u1, 'streak_freeze', 1, t + 2 * D)), /already_owned/);
  st = await state(u1, '111', t + 4 * D); // один день пропущен
  assert.equal(st.daily.loginStreak, 4, 'заморозка спасла серию');
  assert.ok(st.events.some(e => e.reason === 'freeze'));
  st = await state(u1, '111', t + 7 * D); // пропуск без заморозки
  assert.equal(st.daily.loginStreak, 1);

  // 10. Шкалы: голодает, болеет; лечим микстурой.
  const t2 = t + 7 * D;
  st = await state(u1, '111', t2 + 40 * H);
  assert.equal(st.pet.state, 'sick', JSON.stringify(st.pet));
  st = await tx(c => W.use(c, u1, 'med_mikstura', { buyNow: true }, t2 + 40 * H));
  assert.equal(st.pet.sick, false); assert.equal(st.pet.health, 100);

  // 11. Лавка: одежда уникальна, надеть можно только своё и в свой слот.
  await tx(async c => { const w = await W.lockWallet(c, u1); await W.move(c, w, 20000, 'test'); await W.saveWallet(c, w); });
  await tx(c => W.buy(c, u1, 'hat_ushanka', 1, t2 + 41 * H));
  await assert.rejects(tx(c => W.buy(c, u1, 'hat_ushanka', 1, t2 + 41 * H)), /already_owned/);
  await assert.rejects(tx(c => W.buy(c, u1, 'body_firecloak', 1, t2 + 41 * H)), /not_for_sale/);
  await assert.rejects(tx(c => W.equip(c, u1, { head: 'hat_kiver' }, t2)), /not_owned/);
  await assert.rejects(tx(c => W.equip(c, u1, { body: 'hat_ushanka' }, t2)), /bad_item/);
  st = await tx(c => W.equip(c, u1, { head: 'hat_ushanka' }, t2 + 41 * H));
  assert.equal(st.equipped.head, 'hat_ushanka');

  // 12. Коробки: гарант эпического на 10-м сундуке при «невезучем» броске.
  await db.query("UPDATE pet_wallets SET pity='{}'::jsonb WHERE user_id=$1", [u1]);
  const drops = [];
  for (let i = 0; i < 10; i++) {
    st = await tx(c => W.openBox(c, u1, 'box_chest', t2 + 42 * H, () => 0));
    drops.push(st.drop.rarity);
  }
  assert.deepEqual(drops.slice(0, 9), Array(9).fill('common'));
  assert.equal(drops[9], 'epic');

  // 13. Краска ника.
  st = await tx(c => W.paintNick(c, u1, 'emerald', t2 + 43 * H));
  assert.equal(st.nameStyle.color, 'emerald');

  // 14. Итоги недели: снимки, подведение один раз, золото и осколок победителю.
  await setProfile('111', u1, { weeklyScore: 500, weekStartStr: '2026-10-05' });
  await setProfile('222', u2, { name: 'Боря', weeklyScore: 900, weekStartStr: '2026-10-05' });
  await setProfile('333', null, { name: 'Legacy', weeklyScore: 100, weekStartStr: '2026-10-05' });
  const sunday = Date.parse('2026-10-11T20:50:00Z');
  const snap = await WK.snapshot(pool, sunday);
  assert.equal(snap.week, '2026-10-05'); assert.equal(snap.rows, 3);
  await setProfile('222', u2, { weeklyScore: 3, weekStartStr: '2026-10-12' });
  const monday = Date.parse('2026-10-11T21:10:00Z');
  await WK.snapshot(pool, monday);
  const done = await WK.finalize(pool, tx, monday);
  assert.ok(done.some(x => x.week === '2026-10-05'), JSON.stringify(done));
  assert.equal((await WK.finalize(pool, tx, monday + 1)).length, 0, 'повторно не подводится');
  const wB = await W.readWallet(db, u2);
  assert.equal(Number(wB.balance), 1000); assert.equal(wB.name_style.color, 'gold'); assert.equal(wB.awards.top1, 1);
  assert.equal(wB.counters.fragments.faberge, 1, 'осколок Фаберже за 1-е место');
  const wA = await W.readWallet(db, u1);
  assert.equal(wA.name_style.color, 'silver', 'топ-цвет перекрывает купленную краску');

  // 15. Топ месяца и дуэлей — по журналу, один раз.
  const nextMonth = new Date(); nextMonth.setUTCDate(1); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1); nextMonth.setUTCHours(10);
  const month = await WK.finalizeMonth(pool, tx, nextMonth.getTime());
  assert.ok(month && month.key === 'month:' + WK.monthKey(Date.now()), JSON.stringify(month));
  assert.equal(await WK.finalizeMonth(pool, tx, nextMonth.getTime() + H), null);
  const mres = (await db.query('SELECT results FROM weekly_awards WHERE week=$1', [month.key])).rows[0].results;
  assert.equal(mres[0].prize.coins, 1000, 'первое место месяца — 1000');
  // Журнал пишет created_at часами базы — берём неделю, в которую идёт прогон.
  const { mondayStr } = require('../src/moscow-time');
  const thisWeek = mondayStr(new Date());
  const duel = await WK.finalizeDuelWeek(pool, tx, Date.now() + 7 * D);
  assert.ok(duel && duel.key === 'duel:' + thisWeek, JSON.stringify(duel));
  const aw = await db.query('SELECT results FROM weekly_awards WHERE week=$1', ['duel:' + thisWeek]);
  assert.equal(aw.rows[0].results[0].place, 1, JSON.stringify(aw.rows));
  assert.ok(aw.rows[0].results[0].score >= 2, 'победы в дуэлях за неделю посчитаны');

  // 16. Рейтинг: тот же SQL, что в server.js.
  const src = fs.readFileSync(path.join(API, 'src/server.js'), 'utf8');
  const petCols = src.match(/const petCols = `([\s\S]*?)`;/)[1];
  const lb = await db.query(`SELECT data${petCols} WHERE data->>'_mergedInto' IS NULL ORDER BY doc_id`);
  const anya = lb.rows.find(r => r.data.name === 'Аня');
  assert.equal(anya.pet_species, 'owl'); assert.equal(anya.pet_equipped.head, 'hat_ushanka');

  // 17. Слияние аккаунтов: деньги складываются, вещи переезжают.
  const before1 = Number((await W.readWallet(db, u1)).balance);
  await tx(c => W.mergeUserData(c, u1, u2));
  const merged = await W.readWallet(db, u1);
  assert.equal(Number(merged.balance), before1 + 1000);
  assert.equal(await W.readWallet(db, u2), null);

  // 18. Погладить: раз в минуту даёт опыт, чаще — только реакция.
  const t3 = Date.parse('2026-10-13T09:00:00Z');
  const a1 = await tx(c => W.tap(c, u1, t3));
  const a2 = await tx(c => W.tap(c, u1, t3 + 1000));
  assert.equal(a1.tapped, true); assert.equal(a2.tapped, false);

  // 19. Напоминание «проголодался»: днём, не чаще раза в 48 часов.
  {
    const nudge = require('../src/pet/nudge').nudge;
    await db.query("INSERT INTO user_identities(user_id, provider, subject) VALUES($1,'telegram','5550001')", [u1]);
    await db.query("UPDATE pet_wallets SET pet = pet || jsonb_build_object('sat', 0, 'at', $2::bigint) WHERE user_id=$1",
      [u1, Date.parse('2026-10-14T02:00:00Z')]);
    const noon = Date.parse('2026-10-14T10:00:00Z');
    assert.equal(await nudge(pool, tx, noon), 1);
    assert.equal(await nudge(pool, tx, noon + H), 0);
  }

  // 20. Пересчёт v3: кошелёк «по старым правилам» — ачивка по 400, подарок 300,
  //     строки по 1. Разница одной строкой, в минус не уводит, второй раз не идёт.
  {
    const u3 = await newUser('Старичок');
    await db.query("INSERT INTO pet_wallets(user_id, balance, earned_total, pet, marks) VALUES($1, 1000, 1000, '{\"species\":\"kitten\"}', '{\"solved\":0}')", [u3]);
    await db.query(`INSERT INTO pet_ledger(user_id, delta, reason, ref, details) VALUES
      ($1, 300, 'welcome', NULL, '{}'), ($1, 400, 'achievement', 'lines_2000', '{"rarity":"epic"}'),
      ($1, 300, 'solve', NULL, '{"lines":250,"ege":50,"duelWins":0}')`, [u3]);
    const { rebalanceV3 } = require('../src/pet/rebalance');
    const report = await rebalanceV3(pool, tx);
    const mine = report.find(r => r.userId === u3);
    // ачивка 400→120 (−280), строки 300→500 (+200) = −80; подарок не трогаем
    assert.equal(mine.diff, -80, JSON.stringify(mine));
    assert.equal(Number((await W.readWallet(db, u3)).balance), 920);
    assert.equal(await rebalanceV3(pool, tx), null, 'пересчёт разовый');
  }

  // Журнал сходится с балансом у каждого (кроме старичка: его журнал — выдуманный v2).
  const sums = await db.query(`SELECT w.user_id, w.balance::int b, COALESCE(sum(l.delta),0)::int s
    FROM pet_wallets w LEFT JOIN pet_ledger l ON l.user_id=w.user_id GROUP BY w.user_id, w.balance`);
  for (const row of sums.rows) assert.equal(row.b, row.s, 'журнал ≠ баланс у ' + row.user_id);
});
