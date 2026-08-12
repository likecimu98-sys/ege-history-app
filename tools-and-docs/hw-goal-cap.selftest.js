'use strict';
// Цель этапа ДЗ не может превышать число строк, которые вообще существуют в его
// рамках.
//
// 🔴 Жалобы 12.08.2026: Андрей — «24 из 25, жму Решать, пишет что всё решено, а
// второй этап не нажимается»; на боевых нашёлся второй такой же — «аська», 9 из 10,
// задание №5, период 862–1054.
// Причина: учитель ставит цель больше, чем подходящих строк в выбранных годах. После
// июльской правки строки вне периода выбрасываются из пула насовсем, поэтому взять
// недостающую неоткуда — и этап не закрыть НИКОГДА. А следующий этап ждёт закрытия
// этого, так что ученик заперт целиком.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'state.js'), 'utf8');
const strip = s => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// Собираем песочницу из настоящих функций state.js.
function build(total) {
  const clean = strip(src);
  const grab = (header) => {
    const from = clean.indexOf(header);
    assert.ok(from > 0, `${header} не найдена`);
    return clean.slice(from, clean.indexOf('\n}', from) + 2);
  };
  const box = {
    window: { state: { stats: {} } },
    // Подменяем счётчик строк периода: сколько их есть — задаёт тест.
    learnedCountInPeriod: () => ({ learned: 0, total }),
  };
  vm.createContext(box);
  vm.runInContext(`
    ${grab('function hwItemAvailable(')}
    ${grab('function hwItemGoal(')}
    ${grab('function hwItemProgress(')}
    ${grab('function hwItemDone(')}
    ${grab('function hwItemRemaining(')}
    this.goal = hwItemGoal; this.done = hwItemDone;
    this.remaining = hwItemRemaining; this.progress = hwItemProgress;
  `, box);
  return box;
}

const item = (over = {}) => ({ task: 'task5', metric: 'lines', period: 'custom',
  yearStart: 862, yearEnd: 1054, goal: 25, progress: 24, ...over });

// ── 1. САМ БАГ: строк 24, цель 25 — этап обязан закрыться ───────────────────
{
  const b = build(24);
  assert.equal(b.goal(item()), 24, 'цель обязана урезаться до числа доступных строк');
  assert.equal(b.done(item()), true, 'этап с недостижимой целью обязан закрываться');
  assert.equal(b.remaining(item()), 0, 'остаток не может быть больше нуля у закрытого этапа');
  assert.equal(b.progress(item()), 24, 'на экране должно быть 24 из 24, а не 24 из 25');
}

// ── 2. Второй боевой случай: 9 из 10 ────────────────────────────────────────
{
  const b = build(9);
  const it = item({ goal: 10, progress: 9 });
  assert.equal(b.done(it), true, '«аська»: 9 из 10 при девяти доступных строках — этап сделан');
}

// ── 3. Обычный этап НЕ закрывается досрочно ─────────────────────────────────
{
  const b = build(100);
  assert.equal(b.goal(item()), 25, 'при достатке строк цель не трогаем');
  assert.equal(b.done(item()), false, 'нельзя закрывать этап, который реально не доделан');
  assert.equal(b.remaining(item()), 1, 'остаток обязан считаться честно');
  assert.equal(b.done(item({ progress: 25 })), true, 'доделанный этап закрывается как обычно');
}

// ── 4. Данные не загрузились (total = 0) — цель не трогаем ──────────────────
{
  const b = build(0);
  assert.equal(b.goal(item()), 25,
    'ноль означает «строк ещё не видно», а не «строк нет» — цель урезать нельзя');
  assert.equal(b.done(item()), false, 'иначе этап закрылся бы сам от неполной загрузки');
}

// ── 5. Зубрёжка считается по своим ключам, её цель не урезаем ───────────────
{
  // ⚠️ Строк периода даём НЕ ноль: при нуле цель не урезается и без защиты, и
  // проверка ничего бы не проверяла (поймано саботажем). При трёх доступных
  // «строках» цель зубрёжки без защиты урезалась бы до 3, и этап 3/6 закрылся бы сам.
  const b = build(3);
  assert.equal(b.goal(item({ task: 'cram', goal: 6, progress: 3 })), 6,
    'зубрёжка считается по своим ключам, строки периода к ней не относятся');
  assert.equal(b.done(item({ task: 'cram', goal: 6, progress: 3 })), false,
    'недоученную зубрёжку нельзя закрывать чужим счётчиком');
}

// ── 6. Экран показывает урезанную цель ──────────────────────────────────────
{
  const ui = strip(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'));
  const spots = ui.match(/goal = window\.hwItemGoal\(it\)/g) || [];
  assert.equal(spots.length, 2,
    `урезанная цель подставлена в ${spots.length} местах из двух — где-то останется «24 из 25»`);
  assert.doesNotMatch(ui, /window\.hwItemProgress\(it\), goal = it\.goal/,
    'вернулся показ сырой цели рядом с прогрессом');
}

console.log('hw-goal-cap.selftest: ok');
