'use strict';
// Кнопка «Начать заново» в визуале (архитектура/живопись) обязана ПЕРЕЖИВАТЬ
// слияние с облаком.
//
// 🔴 Разбор 08.08.2026. Жалоба: ученица закончила раздел памятников, нажала
// «Начать заново», решила ОДИН памятник — и тренажёр сразу объявил раздел
// выученным.
// Причина не в тренажёре, а в слиянии. mergeVisualProgress объединяет копии ПО ID
// и берёт запись с бо́льшим «весом», где learned:true весит миллион. После сброса
// локально пусто, а в облаке всё ещё «выучено» — и первое же слияние возвращает
// весь прогресс. Объединение не умеет выражать удаление: «стало пусто»
// неотличимо от «ещё не приходило».
// Лечение: сброс ставит метку времени, и записи, выученные ДО неё, в слияние не
// попадают.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const cloud = read('cloud-sync.js');
const trainer = read('visual-trainer.js');
const state = read('state.js');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ── Достаём настоящую mergeVisualProgress из cloud-sync.js ──────────────────
const start = cloud.indexOf('function mergeVisualProgress(');
assert.ok(start > 0, 'mergeVisualProgress не найдена в cloud-sync.js');
const end = cloud.indexOf('\n        }', start);
assert.ok(end > start, 'не видно конца mergeVisualProgress');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${cloud.slice(start, end + 10)}; this.merge = mergeVisualProgress;`, sandbox);
const mergeVisualProgress = sandbox.merge;

const learnedAt = (ts) => ({ learned: true, streak: 2, attempts: 4, correct: 4, learnedAt: ts, lastUpdated: ts });
const asState = (progress, resetAt) => ({ stats: { p: progress, r: resetAt } });
const resetOf = states => Math.max(0, ...states.map(s => Number(s.stats.r) || 0));
const run = states => mergeVisualProgress(states, 'p', resetOf(states));

// ── 1. САМ БАГ: без сброса всё сливается как раньше ─────────────────────────
{
  const cloudCopy = asState({ a: learnedAt(1000), b: learnedAt(1000) }, 0);
  const local = asState({}, 0);
  const out = run([cloudCopy, local]);
  assert.equal(Object.keys(out).length, 2,
    'без сброса прогресс с другого устройства обязан подхватываться — это не баг, а фича');
}

// ── 2. ПОЧИНКА: после сброса выученное до него не воскресает ────────────────
{
  const cloudCopy = asState({ a: learnedAt(1000), b: learnedAt(1000) }, 0);   // облако: всё выучено
  const local = asState({}, 5000);                                            // локально: сброшено
  const out = run([cloudCopy, local]);
  assert.deepEqual(out, {},
    'после сброса облачная копия не имеет права вернуть выученное — это и есть жалоба ученицы');
}

// ── 3. Ровно тот сценарий: сброс → решён ОДИН памятник ──────────────────────
{
  const cloudCopy = asState({ a: learnedAt(1000), b: learnedAt(1000), c: learnedAt(1000) }, 0);
  const local = asState({ a: learnedAt(6000) }, 5000); // после сброса выучен только «a»
  const out = run([cloudCopy, local]);
  assert.deepEqual(Object.keys(out).sort(), ['a'],
    'после сброса должен остаться ровно один выученный памятник, а не весь раздел');
  assert.equal(out.a.learned, true);
}

// ── 4. Прогресс, добытый ПОСЛЕ сброса на другом устройстве, сохраняется ─────
{
  const other = asState({ b: learnedAt(7000) }, 5000);
  const local = asState({ a: learnedAt(6000) }, 5000);
  const out = run([other, local]);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b'],
    'новый прогресс с обоих устройств обязан сложиться');
}

// ── 5. Устройство, не знающее о сбросе, не тащит старое обратно ─────────────
{
  const stale = asState({ a: learnedAt(1000), b: learnedAt(1000) }, 0); // не синхронизировалось
  const fresh = asState({ c: learnedAt(6000) }, 5000);
  const out = run([stale, fresh]);
  assert.deepEqual(Object.keys(out).sort(), ['c'],
    'копия без метки сброса не имеет права воскресить прошлый круг');
}

// ── 6. Записи без отметки времени после сброса отбрасываются ────────────────
{
  const legacy = asState({ a: { learned: true, streak: 2 } }, 0); // старый формат, без дат
  const local = asState({}, 5000);
  assert.deepEqual(run([legacy, local]), {},
    'запись без отметки времени после сброса считается дореформенной');
  // ...но БЕЗ сброса она обязана сохраниться, иначе потеряем чужой прогресс.
  assert.deepEqual(Object.keys(run([legacy, asState({}, 0)])), ['a'],
    'без сброса старый формат терять нельзя');
}

// ── 7. Метка сброса реально ставится и сохраняется ──────────────────────────
{
  const t = strip(trainer);
  assert.match(t, /resetKey: 'visualArchitectureResetAt'/, 'у архитектуры нет ключа сброса');
  assert.match(t, /resetKey: 'visualPaintingResetAt'/, 'у живописи нет ключа сброса');
  assert.match(t, /window\.state\.stats\[entry\.resetKey\] = stampedAt/,
    'сброс не проставляет метку времени — починка не сработает');

  const s = strip(state);
  for (const key of ['visualArchitectureResetAt', 'visualPaintingResetAt']) {
    assert.ok(s.includes(`'${key}'`), `${key} нет в SAVE_FIELDS — сброс не переживёт перезагрузку`);
    assert.ok(s.includes(`${key}: 0`), `${key} нет в начальном состоянии`);
  }
  const c = strip(cloud);
  // ⚠️ Искать ключ по всему файлу нельзя: он там есть в VISUAL_MERGE_GROUPS, и
  // проверка проходила бы даже с пустым списком полей облака (поймано саботажем).
  // Смотрим ИМЕННО список CLOUD_STATE_FIELDS.
  const fieldsFrom = c.indexOf('const CLOUD_STATE_FIELDS = [');
  assert.ok(fieldsFrom > 0, 'CLOUD_STATE_FIELDS не найден');
  const cloudFields = c.slice(fieldsFrom, c.indexOf('];', fieldsFrom));
  for (const key of ['visualArchitectureResetAt', 'visualPaintingResetAt']) {
    assert.ok(cloudFields.includes(`'${key}'`),
      `${key} нет в CLOUD_STATE_FIELDS — метка не уедет в облако, и на втором устройстве сброса не будет`);
  }
}

// ── 8. Счётчик решённых не воскресает мимо сброса ───────────────────────────
{
  const c = strip(cloud);
  // ⚠️ Конец блока обязательно ищем ПОСЛЕ его начала: `].forEach(k => {` есть в файле
  // и раньше, срез получался пустым, и проверка проходила всегда (поймано саботажем).
  const maxFrom = c.indexOf("['totalSolvedEver'");
  assert.ok(maxFrom > 0, 'блок общего Math.max не найден');
  const maxTo = c.indexOf('].forEach(k => {', maxFrom);
  assert.ok(maxTo > maxFrom, 'не видно конца блока общего Math.max');
  const maxBlock = c.slice(maxFrom, maxTo);
  assert.ok(!maxBlock.includes('visualArchitectureSolved') && !maxBlock.includes('visualPaintingSolved'),
    'счётчики визуала снова в общем Math.max — он вернёт старое число мимо сброса');
  assert.match(c, /const aware = states\.filter\(s => \(Number\(s\.stats\?\.\[resetKey\]\) \|\| 0\) === resetAt\)/,
    'счётчик решённых не сверяется с меткой сброса');
}

// ── 9. Сервер обязан сливать ТАК ЖЕ, как клиент ─────────────────────────────
// Копии две и обе нужны: клиент сливает у себя, сервер — при каждой записи в
// student_states. Разойдутся — прогресс начнёт «мигать» в зависимости от того, кто
// слил последним, а сброс будет держаться ровно до следующего сохранения.
{
  const merge = read('server/api/src/state-merge.js');
  const from = merge.indexOf('function mergeProgress(');
  assert.ok(from > 0, 'mergeProgress не найдена в state-merge.js');
  const box = {};
  vm.createContext(box);
  vm.runInContext(
    `const clone = v => JSON.parse(JSON.stringify(v));
     ${merge.slice(from, merge.indexOf('\n}', from) + 2)}
     this.merge = mergeProgress;`, box);
  const serverMerge = box.merge;

  const cases = [
    [[asState({ a: learnedAt(1000), b: learnedAt(1000) }, 0), asState({}, 5000)], 'сброс без нового прогресса'],
    [[asState({ a: learnedAt(1000), b: learnedAt(1000) }, 0), asState({ a: learnedAt(6000) }, 5000)], 'сброс и один выученный'],
    [[asState({ a: learnedAt(1000) }, 0), asState({ b: learnedAt(1000) }, 0)], 'без сброса — объединение'],
    [[asState({ a: { learned: true } }, 0), asState({}, 5000)], 'запись без отметки времени'],
  ];
  for (const [states, label] of cases) {
    const resetAt = resetOf(states);
    assert.deepEqual(serverMerge(states, 'p', resetAt), mergeVisualProgress(states, 'p', resetAt),
      `клиент и сервер разошлись: ${label}`);
  }

  // И счётчик на сервере тоже обязан уважать сброс.
  const ms = strip(merge);
  assert.match(ms, /const aware = states\.filter\(s => \(Number\(s\.stats\[resetKey\]\) \|\| 0\) === resetAt\)/,
    'на сервере счётчик решённых не сверяется с меткой сброса');
  const maxFrom = ms.indexOf('const maxFields = [');
  const maxBlock = ms.slice(maxFrom, ms.indexOf('];', maxFrom));
  assert.ok(!maxBlock.includes('visualArchitectureSolved') && !maxBlock.includes('visualPaintingSolved'),
    'на сервере счётчики визуала снова в общем Math.max — вернут старое число мимо сброса');
}

console.log('visual-reset.selftest: ok');
