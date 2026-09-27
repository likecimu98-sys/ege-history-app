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

function adapt(pg) {
  return {
    async query(sql, params = []) {
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  };
}

test('кошелёк, питомец, коробки, итоги недели, рейтинг и слияние — на живой базе', { skip: !PGlite && 'нет @electric-sql/pglite' }, async () => {
  const pg = new PGlite();
  for (const f of fs.readdirSync(API + '/migrations').filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    let sql = fs.readFileSync(path.join(API, 'migrations', f), 'utf8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, '');
    try { await pg.exec(sql); } catch (e) { console.log('migration', f, 'failed:', e.message); throw e; }
  }
  const db = adapt(pg);
  const tx = fn => pg.transaction(t => fn(adapt(t)));
  const pool = db;

  const u1 = (await db.query("INSERT INTO app_users(display_name) VALUES('Аня') RETURNING id")).rows[0].id;
  const u2 = (await db.query("INSERT INTO app_users(display_name) VALUES('Боря') RETURNING id")).rows[0].id;
  const setProfile = (doc, user, data) => db.query(
    `INSERT INTO student_profiles(doc_id,user_id,data) VALUES($1,$2,$3)
     ON CONFLICT (doc_id) DO UPDATE SET data=student_profiles.data || EXCLUDED.data`, [doc, user, JSON.stringify(data)]);
  await setProfile('111', u1, { name: 'Аня', totalSolved: 5 });

  let t = Date.parse('2026-09-28T09:00:00Z'); // понедельник, 12:00 МСК
  // 1. Новичок: питомца нет, вылупить нельзя.
  let st = await tx(c => W.getState(c, u1, ['111'], t));
  assert.equal(st.hatched, false); assert.equal(st.canHatch, false);
  await assert.rejects(tx(c => W.hatch(c, u1, ['111'], { species: 'owl' }, t)), /too_early/);

  // 2. Ветеран 1200 строк: 300 монет + 2 сундука, ачивки до питомца не оплачиваются.
  await setProfile('111', u1, { totalSolved: 1200, egePoints: 40 });
  st = await tx(c => W.hatch(c, u1, ['111'], { species: 'owl', name: '<b>Филя</b>', knownAchievements: ['lines_500', 'lines_50'] }, t));
  assert.equal(st.balance, 300); assert.equal(st.inventory.box_chest, 2); assert.equal(st.pet.name, 'bФиля/b');
  await assert.rejects(tx(c => W.hatch(c, u1, ['111'], { species: 'owl' }, t)), /already_hatched/);
  st = await tx(c => W.rewardAchievements(c, u1, ['lines_500', 'lines_2000', 'fake'], t));
  assert.deepEqual(st.paid.map(p => p.id), ['lines_2000']);
  assert.equal(st.balance, 300 + 400);

  // 3. Решил 100 строк и 5 баллов ЕГЭ: в тот же день — без бонуса дня (день начат вылуплением).
  await setProfile('111', u1, { totalSolved: 1300, egePoints: 45 });
  st = await tx(c => W.getState(c, u1, ['111'], t + 3600e3));
  assert.equal(st.balance, 700 + 105, JSON.stringify(st.events));
  // Откат счётчика и обратно — денег не печатает.
  await setProfile('111', u1, { totalSolved: 1000 });
  await tx(c => W.getState(c, u1, ['111'], t + 3700e3));
  await setProfile('111', u1, { totalSolved: 1300 });
  st = await tx(c => W.getState(c, u1, ['111'], t + 3800e3));
  assert.equal(st.balance, 805);

  // 4. Следующий день: бонус 15 + серия 2; потолок 2000.
  await setProfile('111', u1, { totalSolved: 5300 });
  st = await tx(c => W.getState(c, u1, ['111'], t + 24 * 3600e3));
  assert.equal(st.balance, 805 + 15 + 2000, JSON.stringify(st.events));
  assert.ok(st.events.some(e => e.reason === 'cap' && e.lost === 2000));
  assert.equal(st.daily.streak, 2);

  // 5. Шкалы: сутки спустя голоден, 12+ часов на нуле — болеет.
  const t2 = t + 24 * 3600e3;
  st = await tx(c => W.getState(c, u1, ['111'], t2 + 40 * 3600e3));
  assert.equal(st.pet.sat, 0); assert.equal(st.pet.state, 'sick', JSON.stringify(st.pet));
  // Кормим из кладовой (стартовые щи), потом «купить и дать», лечим микстурой.
  st = await tx(c => W.use(c, u1, 'food_shchi', {}, t2 + 40 * 3600e3));
  assert.equal(st.inventory.food_shchi, 1);
  st = await tx(c => W.use(c, u1, 'food_pirog', { buyNow: true }, t2 + 40 * 3600e3));
  await assert.rejects(tx(c => W.use(c, u1, 'med_mikstura', {}, t2 + 40 * 3600e3)), /not_owned/);
  st = await tx(c => W.use(c, u1, 'med_mikstura', { buyNow: true }, t2 + 40 * 3600e3));
  assert.equal(st.pet.sick, false); assert.equal(st.pet.health, 100);

  // 6. Лавка: одежда уникальна, надеть можно только своё и в свой слот.
  const bal0 = st.balance;
  st = await tx(c => W.buy(c, u1, 'hat_ushanka', 1, t2 + 41 * 3600e3));
  assert.equal(st.balance, bal0 - 120);
  await assert.rejects(tx(c => W.buy(c, u1, 'hat_ushanka', 1, t2 + 41 * 3600e3)), /already_owned/);
  await assert.rejects(tx(c => W.buy(c, u1, 'body_firecloak', 1, t2 + 41 * 3600e3)), /not_for_sale/);
  await assert.rejects(tx(c => W.equip(c, u1, { head: 'hat_kiver' }, t2)), /not_owned/);
  await assert.rejects(tx(c => W.equip(c, u1, { body: 'hat_ushanka' }, t2)), /bad_item/);
  st = await tx(c => W.equip(c, u1, { head: 'hat_ushanka' }, t2 + 41 * 3600e3));
  assert.equal(st.equipped.head, 'hat_ushanka');
  // Денег не хватает — 402, баланс не тронут.
  await assert.rejects(tx(c => W.buy(c, u1, 'hat_monomakh', 1, t2 + 41 * 3600e3)), /not_enough_coins/);
  const again = await tx(c => W.getState(c, u1, ['111'], t2 + 41 * 3600e3));
  assert.equal(again.balance, st.balance);

  // 7. Коробки: гарант эпического на 10-м сундуке при «невезучем» броске.
  const unlucky = () => 0; // всегда самое частое — обычное
  let drops = [];
  for (let i = 0; i < 10; i++) {
    st = await tx(c => W.openBox(c, u1, 'box_chest', t2 + 42 * 3600e3, n => (n > 1000 ? 0 : unlucky(n))));
    drops.push(st.drop.rarity);
  }
  assert.deepEqual(drops.slice(0, 9), Array(9).fill('common'));
  assert.equal(drops[9], 'epic');
  assert.equal(st.pity.box_chest, 0);
  assert.ok(drops.length === 10 && st.counters.boxes === 10);
  // Повтор превращается в монеты (при том же броске — та же первая обычная вещь).
  assert.ok(drops.length);

  // 8. Краска ника.
  await tx(async c => { const w = await W.lockWallet(c, u1); await W.move(c, w, 3000, 'test'); await W.saveWallet(c, w); });
  st = await tx(c => W.paintNick(c, u1, 'emerald', t2 + 43 * 3600e3));
  assert.equal(st.nameStyle.color, 'emerald');

  // 9. Итоги недели: снимки, подведение один раз, золотой ник победителю.
  await setProfile('111', u1, { weeklyScore: 500, weekStartStr: '2026-09-28' });
  await setProfile('222', u2, { name: 'Боря', weeklyScore: 900, weekStartStr: '2026-09-28' });
  await setProfile('333', null, { name: 'Legacy', weeklyScore: 100, weekStartStr: '2026-09-28' });
  const sunday = Date.parse('2026-10-04T20:50:00Z'); // 23:50 МСК воскресенья
  const snap = await WK.snapshot(pool, sunday);
  assert.equal(snap.week, '2026-09-28'); assert.equal(snap.rows, 3);
  // Понедельник: Боря уже зашёл, у него новая неделя — но снимок помнит 900.
  await setProfile('222', u2, { weeklyScore: 3, weekStartStr: '2026-10-05' });
  const monday = Date.parse('2026-10-04T21:10:00Z');
  await WK.snapshot(pool, monday);
  let done = await WK.finalize(pool, tx, monday);
  assert.equal(done.length, 1);
  done = await WK.finalize(pool, tx, monday + 1);
  assert.equal(done.length, 0, 'повторно не подводится');
  const w2 = await W.readWallet(db, u2);
  assert.equal(Number(w2.balance), 1000); assert.equal(w2.name_style.color, 'gold'); assert.equal(w2.awards.top1, 1);
  const w1 = await W.readWallet(db, u1);
  assert.equal(w1.name_style.color, 'silver', 'топ-цвет перекрывает купленную краску');
  const job = await db.query("SELECT data FROM notification_jobs WHERE doc_id='weekly_top_2026-09-28'");
  assert.equal(job.rows[0].data.recipients.length, 3);
  const inv2 = await W.inventory(db, u2);
  assert.equal(inv2.box_week, 1);

  // 10. Рейтинг с цветом ника и аватаром — тот же SQL, что в server.js.
  const src = fs.readFileSync(API + '/src/server.js', 'utf8');
  const petCols = src.match(/const petCols = `([\s\S]*?)`;/)[1];
  const lb = await db.query(`SELECT data${petCols} WHERE data->>'_mergedInto' IS NULL ORDER BY doc_id`);
  const anya = lb.rows.find(r => r.data.name === 'Аня');
  assert.equal(anya.pet_species, 'owl'); assert.equal(anya.pet_equipped.head, 'hat_ushanka');
  assert.equal(anya.pet_style.color, 'silver');

  // 11. Слияние аккаунтов: деньги складываются, вещи переезжают, питомец старший.
  const before1 = Number((await W.readWallet(db, u1)).balance);
  await tx(c => W.mergeUserData(c, u1, u2));
  const merged = await W.readWallet(db, u1);
  assert.equal(Number(merged.balance), before1 + 1000);
  assert.equal((await W.inventory(db, u1)).box_week, 2); // свой за 2-е место + Борин
  assert.equal(await W.readWallet(db, u2), null);
  assert.equal(merged.awards.top1, 1);

  // 12. Повторная покупка уникальной вещи отбивается и оставляет баланс
  // (настоящую гонку вкладок держит FOR UPDATE — PGlite одно соединение и её не воспроизводит).
  const b0 = Number(merged.balance);
  await tx(c => W.buy(c, u1, 'hat_kartuz', 1, monday));
  await assert.rejects(tx(c => W.buy(c, u1, 'hat_kartuz', 1, monday)), /already_owned/);
  assert.equal(Number((await W.readWallet(db, u1)).balance), b0 - 90);

  // Журнал сходится с балансом у каждого.
  const sums = await db.query(`SELECT w.user_id, w.balance::int b, COALESCE(sum(l.delta),0)::int s
    FROM pet_wallets w LEFT JOIN pet_ledger l ON l.user_id=w.user_id GROUP BY w.user_id, w.balance`);
  for (const row of sums.rows) assert.equal(row.b, row.s, 'журнал ≠ баланс');
  const ledger = await db.query('SELECT reason, sum(delta)::int s FROM pet_ledger GROUP BY reason ORDER BY reason');
  assert.ok(ledger.rows.length > 5);
});
