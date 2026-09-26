#!/usr/bin/env node
'use strict';
// Страницы открытого банка ФИПИ для поисковиков: /ege/, /ege/zadanie-N/, /ege/zadanie-N/<id>.html.
//
// ЗАЧЕМ. Ученик ищет в Google или Яндексе строку из задания («созыв Стоглавого
// собора 1551») — и должен попасть на страницу, где это задание есть целиком,
// с ответом и кнопкой «решать такие же в тренажёре». Само приложение — одна
// страница, собираемая скриптом: поисковику в нём читать нечего (лог 11–25.09:
// ~12 заходов из поиска в день, и все на главную).
//
// Страницы — чистый HTML без скриптов приложения: открываются мгновенно, и
// поисковик видит текст сразу. Ответ спрятан под «Показать ответ» (<details>):
// текст в разметке есть — поисковик его читает, — а ученик сначала думает сам.
//
//   node tools-and-docs/build-seo-pages.js     # пересобрать ege/ и sitemap.xml
//
// 🔴 Сгенерированное лежит в git: deploy-static.ps1 выкладывает `git archive HEAD`.
// Поменял банк (build-exam-bank.js) — пересобери и закоммить заодно.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'ege');
const SITE = 'https://reshay-istoriyu.ru';
const bank = require(path.join(ROOT, 'exam-bank.generated.js'));
const CSS_V = '1';

// Формулировки заданий — как в КИМ: без них страница — набор строк, и по
// запросу «установите соответствие между событиями и годами» её не найти.
const KIM = {
    1: { name: 'события и годы', ask: 'Установите соответствие между событиями и годами: к каждой позиции первого столбца подберите соответствующую позицию из второго столбца.', left: 'События', right: 'Годы' },
    2: { name: 'хронологическая последовательность', ask: 'Расположите в хронологической последовательности исторические события. Запишите цифры, которыми обозначены исторические события, в правильной последовательности.' },
    3: { name: 'процессы и факты', ask: 'Установите соответствие между процессами (явлениями, событиями) и фактами, относящимися к этим процессам (явлениям, событиям): к каждой позиции первого столбца подберите соответствующую позицию из второго столбца.', left: 'Процессы (явления, события)', right: 'Факты' },
    4: { name: 'таблица с пропусками', ask: 'Заполните пустые ячейки таблицы, используя представленные в приведённом ниже списке данные. Для каждой ячейки, обозначенной буквой, выберите номер нужного элемента.' },
    5: { name: 'события и участники', ask: 'Установите соответствие между событиями и участниками этих событий: к каждой позиции первого столбца подберите соответствующую позицию из второго столбца.', left: 'События', right: 'Участники' },
    6: { name: 'работа с историческим источником', ask: 'Прочтите отрывок и выберите два суждения, верных для этого отрывка.' },
    7: { name: 'памятники культуры', ask: 'Установите соответствие между памятниками культуры и их характеристиками: к каждой позиции первого столбца подберите соответствующую позицию из второго столбца.', left: 'Памятники культуры', right: 'Характеристики' },
    8: { name: 'изображение', ask: 'Рассмотрите изображение и выполните задание.' },
    9: { name: 'историческая карта (схема)', ask: 'Рассмотрите схему и выполните задание.' },
    10: { name: 'историческая карта (схема)', ask: 'Рассмотрите схему и выполните задание.' },
    11: { name: 'историческая карта (схема)', ask: 'Рассмотрите схему и выполните задание.' },
    12: { name: 'суждения по карте (схеме)', ask: 'Какие суждения, относящиеся к схеме, являются верными? Выберите три суждения из шести предложенных.' },
};
// У табличных заданий есть такой же режим в тренажёре — туда и ведёт кнопка.
const TRAINER = { 1: 'task1', 3: 'task3', 4: 'task4', 5: 'task5', 7: 'task7' };
const LETTERS = 'АБВГДЕЖЗ';

const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
const slug = t => String(t.id).toLowerCase();
const url = (k, t) => t ? `/ege/zadanie-${k}/${slug(t)}.html` : (k ? `/ege/zadanie-${k}/` : '/ege/');

function lead(t) {
    // Самая «искомая» строка задания: то, что ученик вобьёт в поиск.
    if (t.targets && t.targets.length) return t.targets.map(x => x.text).join('; ');
    // Таблица задания 4: ищут по её известным клеткам («Торжок», «Основание города»).
    if (t.grid) return t.grid.flat().filter(c => c.text).map(c => c.text).join('; ');
    if (t.question) return t.question.replace(/^Рассмотрите[^\n]*\n+/, '');
    return (t.elements || []).map(e => e.text).join('; ');
}

function trainerHref(k) {
    const open = TRAINER[k];
    return `/?utm_source=seo&utm_content=kim${k}${open ? `&open=${open}` : ''}`;
}

function page({ title, description, canonical, crumbs, body }) {
    const ld = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.href })),
    };
    return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:locale" content="ru_RU">
<link rel="icon" href="/assets/icons/icon-192.png">
<script>try{var t=localStorage.getItem('ege_theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}</script>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/ege/seo.css?v=${CSS_V}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header class="top"><a class="brand" href="/">🏛️ Решай Историю</a><a class="btn" href="/?utm_source=seo">Открыть тренажёр</a></header>
<main>
<nav class="crumbs">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span>${esc(c.name)}</span>` : `<a href="${c.href}">${esc(c.name)}</a>`).join(' › ')}</nav>
${body}
</main>
<footer class="foot">Задания — из открытого банка ФИПИ. Разобрать и выучить — в бесплатном тренажёре <a href="/">«Решай Историю»</a>.</footer>
</body>
</html>
`;
}

function listBlock(title, items, lettered) {
    return `<div class="col"><h3>${esc(title)}</h3><ol class="${lettered ? 'abc' : 'num'}">${items.map(x => `<li><b>${esc(x.mark)})</b> ${esc(x.text)}</li>`).join('')}</ol></div>`;
}

function taskBody(t) {
    const k = t.kim, info = KIM[k];
    const parts = [`<p class="ask">${esc(info.ask)}</p>`];
    if (t.image) parts.push(`<figure><img src="/${esc(t.image)}" alt="Изображение к заданию ${k} ЕГЭ по истории" loading="lazy"></figure>`);
    if (t.question && k === 6) {
        parts.push(`<div class="source">${esc(t.question).replace(/\n/g, '<br>')}</div>`);
    } else if (t.question) {
        parts.push(`<p class="ask">${esc(t.question.replace(/^Рассмотрите[^\n]*\n+/, '')).replace(/\n/g, '<br>')}</p>`);
    }
    if (t.grid) {
        parts.push('<table class="grid">' + t.grid.map(row => '<tr>' + row.map(cell =>
            cell.slot != null ? `<td class="slot">${LETTERS[cell.slot]}</td>` : `<td>${esc(cell.text)}</td>`).join('') + '</tr>').join('') + '</table>');
    }
    if (t.targets && t.targets.length) {
        parts.push('<div class="cols">'
            + listBlock(info.left || 'Позиции', t.targets.map(x => ({ mark: x.label, text: x.text })), true)
            + listBlock(info.right || 'Варианты', t.elements.map(e => ({ mark: e.n, text: e.text })), false)
            + '</div>');
    } else if (t.elements && t.elements.length) {
        parts.push(listBlock(t.grid ? 'Элементы' : 'Варианты', t.elements.map(e => ({ mark: e.n, text: e.text })), false));
    }
    parts.push(`<details class="answer"><summary>Показать ответ</summary>${answerHtml(t)}</details>`);
    return parts.join('\n');
}

function answerHtml(t) {
    const a = String(t.answer || '');
    const byN = new Map((t.elements || []).map(e => [String(e.n), e.text]));
    let rows = '';
    if (t.targets && t.targets.length) {
        rows = t.targets.map((x, i) => `<li><b>${esc(x.label)}</b> — ${esc(a[i])}${byN.has(a[i]) ? ` (${esc(byN.get(a[i]))})` : ''}</li>`).join('');
    } else if (t.grid) {
        rows = [...a].map((d, i) => `<li><b>${LETTERS[i]}</b> — ${esc(d)}${byN.has(d) ? ` (${esc(byN.get(d))})` : ''}</li>`).join('');
    } else if (t.elements && t.elements.length && /^\d+$/.test(a)) {
        rows = [...a].map(d => `<li><b>${esc(d)}</b>${byN.has(d) ? ` — ${esc(byN.get(d))}` : ''}</li>`).join('');
    }
    return `<p class="ans">Ответ: <b>${esc(a)}</b></p>${rows ? `<ol class="plain">${rows}</ol>` : ''}`;
}

function build() {
    const byKim = new Map();
    for (const t of bank.tasks) {
        if (!KIM[t.kim]) continue;
        if (!byKim.has(t.kim)) byKim.set(t.kim, []);
        byKim.get(t.kim).push(t);
    }
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'seo.css'), path.join(OUT, 'seo.css'));
    const sitemap = ['/ege/'];
    const home = { name: 'Главная', href: '/' };
    const hub = { name: 'ЕГЭ по истории: банк ФИПИ', href: '/ege/' };

    for (const [k, tasks] of [...byKim.entries()].sort((a, b) => a[0] - b[0])) {
        const info = KIM[k];
        const dir = path.join(OUT, `zadanie-${k}`);
        fs.mkdirSync(dir, { recursive: true });
        const numCrumb = { name: `Задание ${k}`, href: url(k) };

        tasks.forEach((t, i) => {
            const prev = tasks[i - 1], next = tasks[i + 1];
            const leadText = lead(t);
            const title = `Задание ${k} ЕГЭ по истории: ${clip(leadText, 70)} — ответ`;
            const body = `<h1>Задание ${k} ЕГЭ по истории <small>· ${esc(info.name)} · № ${esc(t.id)}</small></h1>
${taskBody(t)}
<div class="cta"><a class="btn big" href="${trainerHref(k)}">Решать такие задания в тренажёре →</a><p>Бесплатно, без регистрации: тренажёр запомнит, что ты уже выучил.</p></div>
<nav class="pager">${prev ? `<a href="${url(k, prev)}">← предыдущее</a>` : '<span></span>'}<a href="${url(k)}">все задания ${k}</a>${next ? `<a href="${url(k, next)}">следующее →</a>` : '<span></span>'}</nav>`;
            fs.writeFileSync(path.join(dir, `${slug(t)}.html`), page({
                title,
                description: clip(`${info.ask.split(':')[0]}. ${leadText}`, 158),
                canonical: url(k, t),
                crumbs: [home, hub, numCrumb, { name: `№ ${t.id}`, href: url(k, t) }],
                body,
            }));
            sitemap.push(url(k, t));
        });

        const cards = tasks.map(t => `<li><a href="${url(k, t)}"><b>№ ${esc(t.id)}</b> ${esc(clip(lead(t), 220))}</a></li>`).join('\n');
        fs.writeFileSync(path.join(dir, 'index.html'), page({
            title: `Задание ${k} ЕГЭ по истории — ${info.name}: ${tasks.length} заданий ФИПИ с ответами`,
            description: `Все задания ${k} ЕГЭ по истории из открытого банка ФИПИ (${info.name}) с ответами и разбором по элементам. Решай онлайн бесплатно.`,
            canonical: url(k),
            crumbs: [home, hub, numCrumb],
            body: `<h1>Задание ${k} ЕГЭ по истории <small>· ${esc(info.name)}</small></h1>
<p class="ask">${esc(info.ask)}</p>
<div class="cta"><a class="btn big" href="${trainerHref(k)}">Тренировать задание ${k} →</a></div>
<h2>${tasks.length} заданий открытого банка ФИПИ</h2>
<ul class="cards">${cards}</ul>`,
        }));
        sitemap.push(url(k));
    }

    const hubList = [...byKim.entries()].sort((a, b) => a[0] - b[0])
        .map(([k, tasks]) => `<li><a href="${url(k)}"><b>Задание ${k}</b> — ${esc(KIM[k].name)} <span class="muted">(${tasks.length})</span></a></li>`).join('\n');
    fs.writeFileSync(path.join(OUT, 'index.html'), page({
        title: 'Задания 1–12 ЕГЭ по истории: открытый банк ФИПИ с ответами',
        description: `Все ${bank.tasks.length} заданий первой части ЕГЭ по истории из открытого банка ФИПИ — с ответами. Найди своё задание или тренируйся в бесплатном тренажёре.`,
        canonical: '/ege/',
        crumbs: [home, hub],
        body: `<h1>ЕГЭ по истории: задания 1–12 из банка ФИПИ</h1>
<p class="ask">Все задания первой части из открытого банка ФИПИ — с ответами. Выбери номер задания или сразу тренируйся в тренажёре.</p>
<div class="cta"><a class="btn big" href="/?utm_source=seo">Открыть тренажёр →</a></div>
<ul class="cards">${hubList}</ul>`,
    }));

    // Карта сайта: страницы банка дописываются к ручной части файла.
    const smPath = path.join(ROOT, 'sitemap.xml');
    const manual = fs.readFileSync(smPath, 'utf8').split('<!-- seo:begin')[0].replace(/<\/urlset>\s*$/, '').trimEnd();
    const seo = sitemap.map(u => `  <url><loc>${SITE}${u}</loc><changefreq>monthly</changefreq><priority>${u === '/ege/' ? '0.8' : (u.endsWith('/') ? '0.7' : '0.5')}</priority></url>`).join('\n');
    fs.writeFileSync(smPath, `${manual}\n  <!-- seo:begin — генерирует tools-and-docs/build-seo-pages.js, руками не править -->\n${seo}\n</urlset>\n`);
    console.log(`seo: ${sitemap.length} страниц в ege/ и sitemap.xml`);
}

build();
