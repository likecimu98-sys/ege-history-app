'use strict';

// Чистая логика «Летописчика»: шкалы питомца, броски коробок, каталог, призы
// недели. Без базы — то, что держится на SQL, проверяет pet-live.test.js.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/pet/catalog');
const W = require('../src/pet/wallet');

const HOUR = 3600e3;
const noonMsk = Date.parse('2026-09-28T09:00:00Z');

test('в каталоге не меньше сотни вещей и id уникальны', () => {
  assert.ok(C.ITEMS.length >= 126, `вещей ${C.ITEMS.length}`);
  const ids = [...C.ITEMS, ...C.CONSUMABLES, ...C.BOXES].map(x => x.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('в каждой редкости коробки есть из чего выбирать', () => {
  for (const r of C.RARITIES) assert.ok(C.ITEMS.some(i => i.rarity === r), r);
});

test('шансы каждой коробки в сумме дают ровно 100%', () => {
  for (const box of C.BOXES) {
    const sum = Object.values(box.odds).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9, `${box.id}: ${sum}`);
  }
});

test('цены держатся в полосах редкости — дорогое действительно дорогое', () => {
  const band = { common: [50, 150], rare: [300, 700], epic: [1500, 3000], legendary: [6000, 15000] };
  for (const item of C.ITEMS) {
    if (item.rarity === 'mythic') {
      assert.ok(item.price === null || item.price >= 50000, `${item.id}: миф. только из коробки или от 50 000`);
      continue;
    }
    const [lo, hi] = band[item.rarity];
    assert.ok(item.price >= lo && item.price <= hi, `${item.id}: ${item.price} вне ${lo}–${hi}`);
  }
});

test('гарант: десятый «невезучий» сундук даёт эпическое, девятый — нет', () => {
  const box = C.BOXES.find(b => b.id === 'box_chest');
  assert.equal(W.rollRarity(box, 8, () => 0), 'common');
  assert.equal(W.rollRarity(box, 9, () => 0), 'epic');
  // Удачный бросок гарантом не портится.
  assert.equal(W.rollRarity(box, 9, n => n - 1), 'mythic');
});

test('броски распределяются по заявленным шансам', () => {
  const box = C.BOXES.find(b => b.id === 'box_tsar');
  const seen = {};
  let x = 0;
  const step = n => { x = (x + 7919) % n; return x; };
  for (let i = 0; i < 100000; i++) seen[W.rollRarity(box, 0, step)] = (seen[W.rollRarity(box, 0, step)] || 0) + 1;
  assert.equal(seen.common, undefined, 'в ларце нет обычных');
  assert.ok(seen.rare > seen.epic && seen.epic > seen.legendary && seen.legendary > seen.mythic);
});

test('питомец голодает около суток, ночью вдвое медленнее, не умирает', () => {
  const pet = { sat: 100, mood: 100, health: 100, at: noonMsk };
  const day = W.decayPet(pet, noonMsk + 12 * HOUR); // 12:00 → 00:00, из них час ночи
  assert.ok(day.sat > 50 && day.sat < 55, String(day.sat));
  const week = W.decayPet(pet, noonMsk + 7 * 24 * HOUR);
  assert.equal(week.sat, 0);
  assert.equal(week.sick, true);
  assert.ok(week.health >= 5, 'здоровье не падает ниже 5 — питомец не умирает');
});

test('сытый питомец выздоравливает только лекарством, но здоровье восстанавливает сам', () => {
  const pet = { sat: 90, mood: 50, health: 60, sick: false, at: noonMsk };
  const later = W.decayPet(pet, noonMsk + 5 * HOUR);
  assert.ok(later.health > 60);
});

test('состояние: ночью спит, голодный — hungry, больной — sick', () => {
  const night = Date.parse('2026-09-28T21:00:00Z'); // 00:00 МСК
  assert.equal(W.petMoodState({ sat: 50, mood: 50 }, night), 'sleep');
  assert.equal(W.petMoodState({ sat: 10, mood: 50 }, noonMsk), 'hungry');
  assert.equal(W.petMoodState({ sat: 90, mood: 90, sick: true }, noonMsk), 'sick');
});

test('призы недели: первое место — золото на 30 дней, 11–50 — сундук, дальше ничего', () => {
  assert.equal(C.prizeFor(1).nick, 'gold');
  assert.equal(C.prizeFor(1).days, 30);
  assert.equal(C.prizeFor(7).nick, 'violet');
  assert.equal(C.prizeFor(40).box, 'box_chest');
  assert.equal(C.prizeFor(51), null);
});

test('ник за топ не продаётся за монеты', () => {
  for (const color of C.TOP_NICK_COLORS) assert.equal(C.NICK_COLORS[color], undefined, color);
});

test('ни одна вещь, коробка или краска не продаётся за настоящие деньги', () => {
  // Смотрим на КЛЮЧИ, а не на текст: «ruby» и «рубашка» — не деньги.
  const keys = new Set();
  const walk = v => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(C.publicCatalog());
  for (const key of keys) assert.ok(!/^(price_?)?(rub|rubles?|money|payment|currency|stars)$/i.test(key), `подозрительное поле ${key}`);
});

test('московский день и граница суток', () => {
  assert.equal(W.mskDay(Date.parse('2026-09-28T20:59:59Z')), '2026-09-28');
  assert.equal(W.mskDay(Date.parse('2026-09-28T21:00:00Z')), '2026-09-29');
  assert.equal(W.prevDay('2026-10-01'), '2026-09-30');
});

test('уровни: 2-й за 100 опыта, шаг растёт на 40, стадии 1/5/15/30', () => {
  assert.equal(W.xpForLevel(1), 0);
  assert.equal(W.xpForLevel(2), 100);
  assert.equal(W.xpForLevel(3), 240);
  assert.equal(W.levelOf(99), 1);
  assert.equal(W.levelOf(100), 2);
  assert.equal(W.levelOf(W.xpForLevel(15)), 15);
  assert.equal(W.stageOf(4).id, 'baby');
  assert.equal(W.stageOf(5).id, 'teen');
  assert.equal(W.stageOf(15).id, 'adult');
  assert.equal(W.stageOf(30).id, 'sage');
});

test('награда за уровень: сундук на 5-м, ларец на 10-м', () => {
  assert.equal(W.levelReward(5).box, 'box_chest');
  assert.equal(W.levelReward(10).box, 'box_tsar');
  assert.equal(W.levelReward(7).box, null);
  assert.ok(W.levelReward(7).coins > 0);
});

test('напоминание: голод, болезнь и тоска — повод, сытость — нет', () => {
  const { reasonFor } = require('../src/pet/nudge');
  assert.equal(reasonFor({ sat: 10, mood: 80 }), 'hungry');
  assert.equal(reasonFor({ sat: 90, mood: 80, sick: true }), 'sick');
  assert.equal(reasonFor({ sat: 90, mood: 10 }), 'sad');
  assert.equal(reasonFor({ sat: 90, mood: 90 }), null);
});
