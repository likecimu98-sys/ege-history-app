#!/usr/bin/env node
/**
 * design-lint.js — храповик дизайн-системы.
 *
 * ЗАЧЕМ. tokens.css существует с 2025 года. В его шапке написано, что дальше
 * «Фаза 2»: захардкоженные значения заменяются на var(--…). Фаза 2 не начиналась
 * год. Аудит 25.07.2026 нашёл в одном лобби 7 радиусов (999px и 9999px рядом),
 * 15 теней и 13 размеров шрифта. Система, которую никто не проверяет, разваливается
 * не от злого умысла, а сама собой — с каждой новой фичей, написанной в спешке.
 *
 * КАК. Это не «запретить всё», иначе линтер снесут на первой же правке. Это
 * ХРАПОВИК: он считает нарушения и падает, только если их стало БОЛЬШЕ, чем в
 * зафиксированном baseline. Легаси спокойно живёт, новый код тянуть его не может.
 * Починил старое — обнови baseline и планка опустится навсегда.
 *
 *   node tools-and-docs/design-lint.js            проверить
 *   node tools-and-docs/design-lint.js --update   пересобрать baseline
 *   node tools-and-docs/design-lint.js --list     показать сами нарушения
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'design-lint.baseline.json');

// Разрешённые значения — ровно те, что объявлены в tokens.css.
const OK_RADIUS = new Set([0, 8, 14, 999]);
const MIN_FONT_PX = 11;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
// Файлы, которые линтить бессмысленно: сгенерированные банки данных, сборка
// Tailwind и сам линтер. output.css — машинный вывод, его правит не человек.
const SKIP_FILES = [
    /\.generated\.js$/,
    /(^|[\\/])output\.css$/,
    /(^|[\\/])design-lint\.js$/,
    /(^|[\\/])tokens\.css$/,         // здесь значения объявляются — это их дом
];

const RULES = [
    {
        id: 'radius',
        title: 'Радиус вне трёх разрешённых (8 / 14 / 999)',
        re: /border-radius\s*:\s*([0-9.]+)px|rounded-\[([0-9.]+)px\]/g,
        pick: m => Number(m[1] || m[2]),
        bad: v => !OK_RADIUS.has(v),
        hint: 'используй var(--r-sm) · var(--r-md) · var(--r-full)',
    },
    {
        id: 'font-too-small',
        title: 'Кегль меньше 11px — на телефоне нечитаемо',
        re: /font-size\s*:\s*([0-9.]+)px|text-\[([0-9.]+)px\]/g,
        pick: m => Number(m[1] || m[2]),
        bad: v => v < MIN_FONT_PX,
        hint: 'минимум var(--t-micro) = 11px',
    },
    {
        id: 'shadow-literal',
        title: 'Тень записана значением, а не ступенью',
        // Отбор делаем в bad(), а НЕ негативным lookahead внутри регулярки.
        // Была ровно эта ошибка: `box-shadow\s*:\s*(?!var\(--e-|none|…)` —
        // `\s*` жадный, но откатывается, и lookahead проверялся на позиции
        // пробела, где «var(» действительно не начинается. В итоге линтер ругался
        // на КОРРЕКТНОЕ `box-shadow: var(--e-1)` (с пробелом), а `box-shadow:var(--e-2)`
        // (без пробела) пропускал. Линтер, ругающийся на правильный код, за неделю
        // приучает себя игнорировать — это хуже, чем его отсутствие.
        re: /box-shadow\s*:\s*([^;"'`}]+)/g,
        pick: m => m[1].trim().slice(0, 60),
        bad: v => !/^(var\(--e-|none|inset|initial|inherit|unset)/.test(v),
        hint: 'используй var(--e-1) · var(--e-2) · var(--e-3)',
    },
];

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p, out);
        else if (/\.(js|html|css)$/.test(entry.name)) out.push(p);
    }
    return out;
}

function scan() {
    const files = walk(ROOT, []).filter(p => !SKIP_FILES.some(re => re.test(p)));
    const found = {};
    for (const rule of RULES) found[rule.id] = [];

    for (const file of files) {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const text = fs.readFileSync(file, 'utf8');
        const lineStarts = [];
        for (let i = 0, n = 0; n !== -1; i = n + 1) {
            lineStarts.push(i);
            n = text.indexOf('\n', i);
        }
        const lineOf = idx => {
            let lo = 0, hi = lineStarts.length - 1;
            while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
            return lo + 1;
        };

        for (const rule of RULES) {
            rule.re.lastIndex = 0;
            let m;
            while ((m = rule.re.exec(text)) !== null) {
                const value = rule.pick(m);
                if (value === undefined || (typeof value === 'number' && Number.isNaN(value))) continue;
                if (!rule.bad(value)) continue;
                found[rule.id].push({ file: rel, line: lineOf(m.index), value: String(value) });
            }
        }
    }
    return found;
}

// ── Запуск ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const found = scan();
// Считаем не только итог, но и разбивку по файлам. Номера строк в baseline не
// храним: они плывут от любой правки выше по файлу, и baseline будет конфликтовать
// в каждом merge. Счётчик по файлу стабилен и при этом точно показывает, КУДА
// приехало новое нарушение — иначе линтер ругается, тыкая в случайное место.
const counts = {};
const byFile = {};
for (const rule of RULES) {
    counts[rule.id] = found[rule.id].length;
    byFile[rule.id] = found[rule.id].reduce((acc, h) => {
        acc[h.file] = (acc[h.file] || 0) + 1;
        return acc;
    }, {});
}

if (args.includes('--list')) {
    for (const rule of RULES) {
        const hits = found[rule.id];
        console.log(`\n── ${rule.title} — ${hits.length}`);
        console.log(`   ${rule.hint}`);
        for (const h of hits.slice(0, 40)) console.log(`   ${h.file}:${h.line}  ${h.value}`);
        if (hits.length > 40) console.log(`   … и ещё ${hits.length - 40}`);
    }
    process.exit(0);
}

if (args.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), counts, byFile }, null, 2) + '\n');
    console.log('design-lint: baseline обновлён →', JSON.stringify(counts));
    process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
    console.error('design-lint: нет baseline. Создай его: node tools-and-docs/design-lint.js --update');
    process.exit(1);
}

const saved = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const base = saved.counts || {};
const baseByFile = saved.byFile || {};
let failed = false;
const lines = [];
for (const rule of RULES) {
    const now = counts[rule.id];
    const was = base[rule.id] != null ? base[rule.id] : 0;
    if (now > was) {
        failed = true;
        lines.push(`  ✗ ${rule.title}: было ${was}, стало ${now} (+${now - was})`);
        lines.push(`    ${rule.hint}`);
        // Показываем файлы, где счётчик вырос, и конкретные строки в них.
        const oldF = baseByFile[rule.id] || {};
        for (const [file, n] of Object.entries(byFile[rule.id])) {
            const before = oldF[file] || 0;
            if (n <= before) continue;
            lines.push(`    ${file}: было ${before}, стало ${n}`);
            for (const h of found[rule.id].filter(h => h.file === file)) {
                lines.push(`      ${file}:${h.line}  ${h.value}`);
            }
        }
    } else if (now < was) {
        lines.push(`  ↓ ${rule.title}: ${was} → ${now}. Стало лучше — зафиксируй: --update`);
    }
}

if (failed) {
    console.error('design-lint: система поехала назад\n' + lines.join('\n'));
    process.exit(1);
}
console.log('design-lint: ok' + (lines.length ? '\n' + lines.join('\n') : ''));
