// Страж ручной таблицы «какие чужие факты подходят к процессу» задания 3
// (_T3_ALSO_FITS в table.js, владелец 01.10.2026: «прогнать, вчитываясь в каждое
// слово»). Таблица живёт строками: переименовали процесс или факт в data.js — и
// запись молча перестала бы работать. Здесь каждая строка таблицы сверяется с базой.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('data.js').replace(/\b(const|let)\s+(bigData|task\w*Data)\b/g, 'var $2'), ctx);
const table = read('table.js');
const a = table.indexOf('const _T3_ALSO_FITS = new Map([');
const b = table.indexOf('function _task3AlsoFits(');
assert.ok(a > 0 && b > a, 'таблица _T3_ALSO_FITS не найдена в table.js');
vm.runInContext(table.slice(a, b).replace('const _T3_ALSO_FITS', 'var _T3_ALSO_FITS'), ctx);

const data = ctx.task3Data;
const procs = new Set(data.map(f => f.process));
const factProc = new Map(data.map(f => [f.fact, f.process]));
let pairs = 0;
for (const [p, facts] of ctx._T3_ALSO_FITS) {
  assert.ok(procs.has(p), 'в таблице процесс, которого нет в базе: ' + p);
  for (const f of facts) {
    assert.ok(factProc.has(f), 'в таблице факт, которого нет в базе: ' + f);
    assert.notStrictEqual(factProc.get(f), p, 'факт записан к своему же процессу: ' + f);
    pairs++;
  }
}
assert.ok(ctx._T3_ALSO_FITS.size >= 45 && pairs >= 300, 'таблица сократилась: ' + ctx._T3_ALSO_FITS.size + ' процессов, ' + pairs + ' пар');
assert.match(table, /if \(_task3AlsoFits\(b\.fact, a\.process\) \|\| _task3AlsoFits\(a\.fact, b\.process\)\) return true;/,
  'проверка конфликтов перестала читать ручную таблицу');
console.log('task3-overlaps: ok — ' + ctx._T3_ALSO_FITS.size + ' процессов, ' + pairs + ' пар');
