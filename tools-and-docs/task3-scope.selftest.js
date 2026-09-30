// Страж «охвата лет» процессов задания 3 (table.js, _task3RangesFor).
// У 355 из 375 процессов в базе один факт, и охват был одним годом ±2: к «ордынскому
// владычеству» вариантом шёл ярлык Калите (1328), к «внешней политике первых русских
// князей» — основание Юрьева (1030). Оба подходят (жалобы 26.09 и 30.09.2026).
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ctx = { console };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('data.js').replace(/\b(const|let)\s+(bigData|task\w*Data)\b/g, 'var $2'), ctx);
const table = read('table.js');
const a = table.indexOf('let _t3ProcRanges = null;'), b = table.indexOf('function _task3SemanticConflict');
assert.ok(a > 0 && b > a, 'блок охвата процессов не найден в table.js');
vm.runInContext(table.slice(a, b).replace(/^const /gm, 'var ').replace(/^let /gm, 'var '), ctx);
const inP = (y, p) => ctx._task3YearInProcess(y, p);

// Жалобы владельца.
assert.ok(inP(1328, 'ордынское владычество на Руси'), 'ярлык Калите не попадает во «ордынское владычество»');
assert.ok(inP(1445, 'ордынское владычество на Руси'), 'плен Василия II не попадает во «ордынское владычество»');
assert.ok(inP(1030, 'внешнеполитическая деятельность первых русских князей'), 'Юрьев не попадает во «внешнюю политику первых князей»');
assert.ok(inP(988, 'внешнеполитическая деятельность первых русских князей'), 'крещение не попадает во «внешнюю политику первых князей»');
// \w не знает кириллицу — эпохи с ним молчали.
assert.ok(inP(1570, 'Ливонская война'), '«Ливонская война» не получила 1558–1583');
assert.ok(inP(1710, 'Северная война'), '«Северная война» не получила 1700–1721');
// Века и их части, кириллическая «Х».
assert.ok(inP(1350, 'борьба за первенство среди русских князей в XIV в.'), 'XIV в. не разобран');
assert.ok(inP(1432, 'междоусобная война второй четверти XV в.'), 'вторая четверть XV в. не разобрана');
assert.ok(!inP(1480, 'междоусобная война второй четверти XV в.'), 'вторая четверть XV в. расплылась');
const cyr = [...new Set(ctx.task3Data.map(d => d.process))].find(p => /начале ХХ в/.test(p));
if (cyr) assert.ok(inP(1905, cyr), 'кириллическое «ХХ в.» не разобрано');
// Правитель в любом падеже и правление для широких процессов.
assert.ok(inP(1480, 'споры о монастырском имуществе при Иване III'), '«при Иване III» не узнан');
assert.ok(inP(1000, 'внешняя политика князя Владимира Святославича'), 'правление Владимира не взято');
// Узкие события не раздуваются.
assert.ok(!inP(1250, 'нашествие Батыя на Русь'), 'конкретное событие раздулось');

let narrow = 0;
const procs = [...new Set(ctx.task3Data.map(d => d.process))];
for (const p of procs) { const r = ctx._task3RangesFor(p); if (Math.max(...r.map(x => x[1])) - Math.min(...r.map(x => x[0])) <= 5) narrow++; }
assert.ok(narrow < procs.length * 0.45, `узких процессов слишком много: ${narrow} из ${procs.length}`);
console.log(`task3-scope: ok (${procs.length} процессов, узких событий ${narrow})`);
