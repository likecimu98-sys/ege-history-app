'use strict';
// Сборка order-data.js — событий режима «Кто раньше».
//   node tools-and-docs/build-order-data.js
//
// Источники:
//  1. tools-and-docs/order-events.txt — хронологическая таблица владельца с
//     интервалами и точными датами (главный источник, правится руками);
//  2. task1Data из data.js — события задания №1 (только год). Берутся лишь те,
//     которых нет в таблице: одно событие дважды с разной формулировкой в одной
//     колоде выглядит как баг, а с разными годами — как ложь.
//
// Формат записи в order-data.js: [текст, начало, конец, подпись, точн.начала, точн.конца]
// начало/конец — ГГГГММДД; точность 0 = год, 1 = месяц, 2 = день.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(__dirname, 'order-events.txt');
// ORDER_DATA_OUT — куда писать (страж order-mode.selftest.js сверяет свежесть файла).
const OUT = process.env.ORDER_DATA_OUT || path.join(ROOT, 'order-data.js');

const MONTH_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Год в тексте выдаёт ответ до хода.
const YEAR_IN_TEXT = /(^|[^\d№])(8\d\d|9\d\d|1\d\d\d|20\d\d)(?!\d)/;

function point(raw, isEnd) {
    const m = String(raw).trim().match(/^(\d{3,4})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/);
    if (!m) throw new Error('Не разобрать дату: ' + raw);
    const y = +m[1], mo = m[2] ? +m[2] : 0, d = m[3] ? +m[3] : 0;
    if (mo && (mo < 1 || mo > 12)) throw new Error('Месяц вне 1–12: ' + raw);
    if (d && (d < 1 || d > LAST_DAY[mo - 1])) throw new Error('День вне месяца: ' + raw);
    const prec = d ? 2 : mo ? 1 : 0;
    const mm = mo || (isEnd ? 12 : 1);
    const dd = d || (isEnd ? LAST_DAY[mm - 1] : 1);
    return { y, mo, d, prec, num: y * 10000 + mm * 100 + dd };
}

function fmtPoint(p, withYear) {
    const y = withYear ? ' ' + p.y : '';
    if (p.prec === 2) return `${p.d} ${MONTH_GEN[p.mo - 1]}${y}`;
    if (p.prec === 1) return `${MONTH_NOM[p.mo - 1]}${y}`;
    return String(p.y);
}

function label(a, b) {
    if (!b || a.num === b.num && a.prec === b.prec) return fmtPoint(a, true);
    if (a.prec === 0 && b.prec === 0) return `${a.y}–${b.y}`;
    if (a.y === b.y && a.prec === b.prec) {
        if (a.prec === 1) return `${MONTH_NOM[a.mo - 1]}–${MONTH_NOM[b.mo - 1]} ${a.y}`;
        if (a.mo === b.mo) return `${a.d}–${b.d} ${MONTH_GEN[a.mo - 1]} ${a.y}`;
        return `${a.d} ${MONTH_GEN[a.mo - 1]} – ${b.d} ${MONTH_GEN[b.mo - 1]} ${a.y}`;
    }
    return `${fmtPoint(a, true)} – ${fmtPoint(b, true)}`;
}

function parseSpec() {
    const out = [];
    fs.readFileSync(SRC, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        const bar = line.indexOf('|');
        if (bar < 0) throw new Error(`Строка ${i + 1}: нет «|»`);
        let date = line.slice(0, bar).trim();
        const text = line.slice(bar + 1).trim();
        let custom = null;
        const at = date.indexOf('@');
        if (at >= 0) { custom = date.slice(at + 1).trim(); date = date.slice(0, at).trim(); }
        const parts = date.split('-');
        if (parts.length > 2) throw new Error(`Строка ${i + 1}: больше одного «-» в дате`);
        const a = point(parts[0], false);
        const b = parts[1] ? point(parts[1], true) : point(parts[0], true);
        if (b.num < a.num) throw new Error(`Строка ${i + 1}: конец раньше начала`);
        if (YEAR_IN_TEXT.test(text)) throw new Error(`Строка ${i + 1}: год в тексте выдаёт ответ — «${text}»`);
        out.push({ t: text, s: a.num, e: b.num, l: custom || label(a, parts[1] ? b : null), sp: a.prec, ep: b.prec, src: 'table' });
    });
    return out;
}

// «Похожее событие»: доля общих основ слов (первые 5 букв слов от 4 букв).
function stems(t) {
    return new Set(String(t).toLowerCase().replace(/ё/g, 'е').match(/[а-я]{4,}/g)?.map(w => w.slice(0, 5)) || []);
}
function similar(a, b) {
    const A = stems(a), B = stems(b);
    if (!A.size || !B.size) return false;
    let common = 0;
    for (const x of A) if (B.has(x)) common++;
    return common / Math.min(A.size, B.size) >= 0.5;
}

function task1Rows() {
    const ctx = { window: {} }; ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8') + ';window.__t1 = task1Data;', ctx);
    return ctx.__t1 || [];
}

const table = parseSpec();
const result = table.slice();
let dropped = 0, yearHidden = 0;
const seenT1 = new Set();
for (const r of task1Rows()) {
    const y = Number(r.yearNum) || parseInt(String(r.year).match(/\d+/) || '', 10);
    if (!isFinite(y) || !r.event) continue;
    const text = String(r.event).trim().replace(/^./, c => c.toUpperCase());
    const key = text.toLowerCase();
    if (seenT1.has(key)) continue;
    seenT1.add(key);
    if (YEAR_IN_TEXT.test(text)) { yearHidden++; continue; }
    const twin = table.find(ev => Math.abs(Math.floor(ev.s / 10000) - y) <= 1 && similar(ev.t, text));
    if (twin) { dropped++; continue; }
    result.push({ t: text, s: y * 10000 + 101, e: y * 10000 + 1231, l: String(y), sp: 0, ep: 0, src: 'task1' });
}

result.sort((a, b) => a.s - b.s || a.e - b.e);
const rows = result.map(ev => [ev.t, ev.s, ev.e, ev.l, ev.sp, ev.ep]);
const body = '// СГЕНЕРИРОВАНО tools-and-docs/build-order-data.js — руками не править.\n'
    + '// Источник: tools-and-docs/order-events.txt + задание №1 (data.js) без дублей.\n'
    + '// [текст, начало ГГГГММДД, конец ГГГГММДД, подпись даты, точность начала, точность конца]\n'
    + '// точность: 0 — год, 1 — месяц, 2 — день.\n'
    + 'window.orderEventsData = [\n'
    + rows.map(r => '  ' + JSON.stringify(r)).join(',\n')
    + '\n];\n';
fs.writeFileSync(OUT, body);
console.log(`order-data.js: ${rows.length} событий (таблица ${table.length}, из №1 +${rows.length - table.length}; дублей №1 отброшено ${dropped}, с годом в тексте ${yearHidden}), ${Math.round(body.length / 1024)} КБ`);
