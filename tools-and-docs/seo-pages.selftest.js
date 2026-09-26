'use strict';
// Страницы банка ФИПИ для поисковиков (tools-and-docs/build-seo-pages.js).
// Проверяем, что они не разъехались с банком и не сломали приложение.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const bank = require(path.join(ROOT, 'exam-bank.generated.js'));
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

// Каждое задание банка — своя страница и строка в карте сайта. Поменяли банк и
// не пересобрали — страницы устарели: node tools-and-docs/build-seo-pages.js
for (const t of bank.tasks) {
  const rel = `ege/zadanie-${t.kim}/${String(t.id).toLowerCase()}.html`;
  assert.ok(fs.existsSync(path.join(ROOT, rel)), `нет страницы ${rel} — пересобери build-seo-pages.js`);
  assert.ok(sitemap.includes(`/${rel}<`), `страницы ${rel} нет в sitemap.xml`);
}
const sample = bank.tasks.find(t => t.kim === 1);
const html = fs.readFileSync(path.join(ROOT, `ege/zadanie-1/${String(sample.id).toLowerCase()}.html`), 'utf8');
assert.match(html, /<details class="answer">/, 'ответ должен быть спрятан под «Показать ответ»');
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
assert.ok(html.includes(esc(sample.targets[0].text)),
  'строка задания должна быть в разметке — иначе поисковик её не найдёт');
assert.match(html, /open=task1/, 'кнопка должна открывать тот же номер в тренажёре');
assert.doesNotMatch(html, /<script src=/, 'страница банка не грузит скрипты приложения');

// Сервис-воркер: «корень» — только корень области, иначе /ege/zadanie-N/
// подменили бы собой закэшированное приложение.
const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
assert.doesNotMatch(sw, /isRootNav = url\.pathname\.endsWith\('\/'\)/, 'SW считал бы любой «/…/» главной страницей');
assert.match(sw, /isRootNav = url\.pathname === scopePath/);

// Тренажёр понимает ?open= и не принимает его за ссылку «с делом».
const ui = fs.readFileSync(path.join(ROOT, 'ui.js'), 'utf8');
assert.match(ui, /utm_\.\*\|yclid\|gclid\|fbclid\|_boot\|v\|open/);
assert.match(ui, /quickStartGame\(want \|\| 'task4', 'normal'\)/);
console.log(`seo-pages: ok (${bank.tasks.length} заданий)`);
