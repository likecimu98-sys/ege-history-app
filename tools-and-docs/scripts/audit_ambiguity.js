'use strict';
// audit_ambiguity.js — оффлайн-аудит потенциально неоднозначных дистракторов.
// Запуск: node scripts/audit_ambiguity.js
//
// Чего код в рантайме не видит: личность-дистрактор может быть исторически
// валидным ответом для события, даже если в БД эта пара описана ДРУГОЙ строкой.
// Скрипт ловит два класса подозрений в данных task5/task3:
//   1) reign  — дистрактор является правителем эпохи целевого события (Слой 3);
//   2) year   — у дистрактора в БД есть год в пределах ±2 от целевого события.
// Это кандидаты на ручную проверку/чистку данных, а не однозначные баги.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadData() {
    const src = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
    const capture = `\n;globalThis.__D = {
        task5Data: typeof task5Data !== 'undefined' ? task5Data : [],
        task3Data: typeof task3Data !== 'undefined' ? task3Data : [],
        task7Data: (typeof window !== 'undefined' && window.task7Data) || [],
    };`;
    const sandbox = { window: {}, console, globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src + capture, sandbox, { filename: 'data.js' });
    return sandbox.__D;
}

// Карта правлений — синхронизировать с config.js REIGNS при изменениях.
const REIGNS = [
    [/иван iii\b/i, 1462, 1505], [/василий iii\b/i, 1505, 1533],
    [/иван iv|иван грозн/i, 1533, 1584], [/борис годунов/i, 1598, 1605],
    [/михаил ф[её]дорович|михаил романов/i, 1613, 1645], [/алексей михайлович/i, 1645, 1676],
    [/п[её]тр i\b|п[её]тр велик/i, 1682, 1725], [/екатерина i\b/i, 1725, 1727],
    [/анн\w* иоанновн/i, 1730, 1740], [/елизавет\w* петровн/i, 1741, 1761],
    [/п[её]тр iii\b/i, 1761, 1762], [/екатерина ii\b|екатерина велик/i, 1762, 1796],
    [/павел i\b/i, 1796, 1801], [/александр i\b/i, 1801, 1825], [/николай i\b/i, 1825, 1855],
    [/александр ii\b/i, 1855, 1881], [/александр iii\b/i, 1881, 1894], [/николай ii\b/i, 1894, 1917],
    [/ленин/i, 1917, 1924], [/сталин/i, 1924, 1953], [/хрущ[её]в/i, 1953, 1964], [/брежнев/i, 1964, 1982],
];
const reignOf = name => REIGNS.find(([re]) => re.test(String(name)));
const yr = v => { const m = String(v || '').match(/\d{3,4}/); return m ? parseInt(m[0], 10) : null; };

function audit(data, dispField, hidField, label) {
    // hidden-значение -> множество лет, в которые оно встречается в БД
    const hidYears = {};
    data.forEach(d => { const y = yr(d.year); if (y == null) return; (hidYears[d[hidField]] = hidYears[d[hidField]] || new Set()).add(y); });

    const reignHits = [], yearHits = [];
    data.forEach(target => {
        const ty = yr(target.year);
        if (ty == null) return;
        // правильные ответы для этого display (их исключать из подозрений)
        const valid = new Set(data.filter(d => d[dispField] === target[dispField]).map(d => d[hidField]));
        data.forEach(cand => {
            const c = cand[hidField];
            if (valid.has(c)) return;
            // reign-подозрение
            if (reignOf(c) && reignOf(c)[1] <= ty && ty <= reignOf(c)[2] && !reignOf(target[hidField])) {
                reignHits.push({ event: target[dispField], year: ty, correct: target[hidField], suspect: c });
            }
            // year-подозрение
            const ys = hidYears[c];
            if (ys && [...ys].some(y => Math.abs(y - ty) <= 2)) {
                yearHits.push({ event: target[dispField], year: ty, correct: target[hidField], suspect: c });
            }
        });
    });
    const uniq = arr => { const seen = new Set(); return arr.filter(h => { const k = h.event + '|' + h.suspect; if (seen.has(k)) return false; seen.add(k); return true; }); };
    return { label, reign: uniq(reignHits), year: uniq(yearHits) };
}

const D = loadData();
const reports = [
    audit(D.task5Data, 'event', 'person', 'task5 (событие → личность)'),
    audit(D.task3Data, 'process', 'fact', 'task3 (процесс → факт)'),
];

for (const r of reports) {
    console.log('\n=== ' + r.label + ' ===');
    console.log(`  reign-подозрений (правитель эпохи): ${r.reign.length} (отсекаются Слоем 3 в рантайме)`);
    r.reign.slice(0, 15).forEach(h => console.log(`    [${h.year}] "${h.event}" → ${h.correct} | подозрительный: ${h.suspect}`));
    console.log(`  year-подозрений (±2 года, ручная проверка): ${r.year.length}`);
    r.year.slice(0, 25).forEach(h => console.log(`    [${h.year}] "${h.event}" → ${h.correct} | подозрительный: ${h.suspect}`));
}
console.log('\nГотово. reign-подозрения уже подавляются Слоем 3; year-подозрения — кандидаты на ручную чистку данных.');
