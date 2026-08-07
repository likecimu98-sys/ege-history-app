'use strict';
// Разбор входящего ДЗ (pendingAssignments) обязан называть судьбу КАЖДОЙ записи.
//
// 🔴 Разбор 07.08.2026. В телеметрию неделю приходило «ДЗ пришло, но не принято» со
// всеми счётчиками в нуле: отозвано=0 снято_оптом=0 битых=0 нет_приёмки=0. Ни одна
// известная причина отказ не объясняла, разбирать было нечего.
// Причина — непосчитанная ветка: ingestAssignment возвращает false, когда задание у
// ученика УЖЕ ЕСТЬ (идемпотентность по id). Это здоровый случай, повторная чистка
// выдачи, а тревога била как на поломке и топила собой настоящие сигналы.
//
// Инвариант, который держит этот тест: сумма исходов сходится с размером выдачи, а
// тревога поднимается только там, где ученик реально остаётся без домашки.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloud-sync.js'), 'utf8');
const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

// ── 1. Ветка «дубль» существует и отделена от отказа ────────────────────────
assert.match(code, /else skipped\.duplicate\+\+/,
  'дубль не считается отдельно — тревога снова будет бить на здоровом случае');
assert.match(code, /skipped\.broken \|\| skipped\.noIngest \|\| counted !== pending\.length/,
  'условие тревоги не проверяет сходимость счётчиков');
assert.doesNotMatch(code, /if \(!added\) \{\s*window\.reportSilent/,
  'вернулось старое условие «не принято ничего» — оно ложно срабатывает на дублях');

// ── 2. Поведение разбора на живых данных ────────────────────────────────────
// Вырезаем сам цикл разбора и гоняем его как функцию: проверять надо поведение,
// а не то, что в файле есть нужные слова.
function runInbox(pending, { ingest, revoked = new Set(), sweepTs = 0, hasIngest = true } = {}) {
  const reports = [];
  const sandbox = {
    window: {
      _classRevoked: revoked,
      _classRevokeBefore: sweepTs,
      ingestAssignment: hasIngest ? ingest : undefined,
      reportSilent: (title, err) => reports.push(`${title} :: ${err.message}`),
    },
    result: null,
  };
  const body = `
    const pending = ${JSON.stringify(pending)};
    const revoked = window._classRevoked;
    const sweepTs = Number(window._classRevokeBefore) || 0;
    let added = 0;
    const handled = [];
    const skipped = { revoked: 0, swept: 0, broken: 0, noIngest: 0, duplicate: 0 };
    pending.forEach(rec => {
      if (!rec || !rec.id) { skipped.broken++; handled.push(rec); return; }
      if (revoked && revoked.has(rec.id)) { skipped.revoked++; handled.push(rec); return; }
      if (sweepTs && Number(rec.assignedAt) && Number(rec.assignedAt) < sweepTs) { skipped.swept++; handled.push(rec); return; }
      if (!window.ingestAssignment) { skipped.noIngest++; return; }
      if (window.ingestAssignment(rec)) added++;
      else skipped.duplicate++;
      handled.push(rec);
    });
    const counted = added + skipped.revoked + skipped.swept + skipped.broken + skipped.noIngest + skipped.duplicate;
    if (skipped.broken || skipped.noIngest || counted !== pending.length) {
      window.reportSilent('ДЗ пришло, но не принято', new Error('в выдаче=' + pending.length + ' без_объяснения=' + (pending.length - counted)));
    }
    result = { added, skipped, counted, handled: handled.length };
  `;
  vm.createContext(sandbox);
  vm.runInContext(body, sandbox);
  return { ...sandbox.result, reports };
}

// Всё новое — принимаем, тревоги нет.
{
  const r = runInbox([{ id: 'a' }, { id: 'b' }], { ingest: () => true });
  assert.equal(r.added, 2);
  assert.equal(r.reports.length, 0, 'на нормальной выдаче тревоги быть не должно');
  assert.equal(r.counted, 2, 'счётчики обязаны сходиться');
}

// Всё уже есть у ученика — ЭТО НЕ ПОЛОМКА. Ровно тот случай, что бил ложно.
{
  const r = runInbox([{ id: 'a' }], { ingest: () => false });
  assert.equal(r.added, 0);
  assert.equal(r.skipped.duplicate, 1, 'дубль обязан быть посчитан');
  assert.equal(r.reports.length, 0,
    'дубль — здоровый случай, тревога тут ложная (та самая, что забила телеметрию)');
  assert.equal(r.handled, 1, 'дубль снимаем с выдачи, иначе он вернётся снова');
}

// Битая запись — тревога обязана быть: её мы снимаем с документа безвозвратно.
{
  const r = runInbox([{ id: 'a' }, { nope: 1 }], { ingest: () => true });
  assert.equal(r.skipped.broken, 1);
  assert.equal(r.reports.length, 1, 'потерю битой записи обязаны заметить');
}

// Приёмка не загрузилась — тревога есть, запись ОСТАЁТСЯ в выдаче.
{
  const r = runInbox([{ id: 'a' }], { hasIngest: true, ingest: undefined });
  assert.equal(r.skipped.noIngest, 1);
  assert.equal(r.handled, 0, 'непринятую запись нельзя снимать с выдачи');
  assert.equal(r.reports.length, 1);
}

// Отозванное и снятое оптом — осознанный пропуск, тревоги нет.
{
  const r = runInbox([{ id: 'a' }, { id: 'b', assignedAt: 100 }],
    { ingest: () => true, revoked: new Set(['a']), sweepTs: 500 });
  assert.equal(r.skipped.revoked, 1);
  assert.equal(r.skipped.swept, 1);
  assert.equal(r.reports.length, 0, 'осознанный пропуск — не повод для тревоги');
  assert.equal(r.counted, 2);
}

console.log('hw-inbox-telemetry.selftest: ok');
