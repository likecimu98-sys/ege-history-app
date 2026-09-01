'use strict';
// Раздел «Вторая часть» во вкладке «Домашка»: рамка с чужим приложением.
//
// Развёрнутые ответы живут в «Проверочной» — там фото до восьми страниц с
// автоповоротом, разбор по критериям, очередь кураторов. Переписывать это на
// ванильном JS незачем, поэтому открываем рамкой. Ученику — одно приложение.
//
// 🔴 Через эту рамку уходит initData, а это учётные данные. Две ошибки здесь
// не видны на экране вообще: подпись в адресе (осядет в логах и реферерах) и
// postMessage с '*' (достанется кому угодно, если адрес подменят).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const modes = strip(fs.readFileSync(path.join(root, 'modes.js'), 'utf8'));
const ui = strip(fs.readFileSync(path.join(root, 'ui.js'), 'utf8'));
const cloud = strip(fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8'));

// ── 1. Признак доезжает от документа класса до клиента ──────────────────────
assert.match(cloud, /data\.secondPart === true\) localStorage\.setItem\('class_second_part', '1'\)/,
  'Признак второй части не сохраняется из документа класса — раздел никогда не появится');
assert.match(cloud, /else localStorage\.removeItem\('class_second_part'\)/,
  'Выключение второй части не убирает признак — у класса её отключат, а раздел останется');
assert.match(modes, /localStorage\.getItem\('class_second_part'\) === '1'/,
  'Доступность читается не из того места, куда её кладут');

// ── 2. Раздел показывается только включённым классам ───────────────────────
const row = modes.slice(modes.indexOf('window.secondPartRow = function'), modes.indexOf('window.openSecondPart = async function'));
assert.ok(row.length > 100, 'secondPartRow не найдена');
assert.match(row, /if \(!window\.secondPartAvailable\(\)\) return '';/,
  'Раздел рисуется всем — классы без второй части увидят чужой инструмент');
assert.match(ui, /window\.secondPartRow \? window\.secondPartRow\(\) : ''/,
  'Раздел не вставлен во вкладку «Домашка»');

// ── 3. «Заданий нет» не спорит с открытой второй частью ─────────────────────
assert.match(ui, /&& !\(window\.secondPartAvailable && window\.secondPartAvailable\(\)\)\)/,
  'При пустой первой части экран скажет «домашних заданий нет» над разделом второй части');

// ── 4. Подпись уходит сообщением, а не адресом ──────────────────────────────
const open = modes.slice(modes.indexOf('window.openSecondPart = async function'));
assert.ok(open.length > 400, 'openSecondPart не найдена');
assert.doesNotMatch(open, /SECOND_PART_SRC \+.*initData|initData.*\+ SECOND_PART_SRC|\?initData=|&initData=/,
  'Подпись подставляется в адрес — она осядет в логах, истории и реферерах');
assert.match(open, /postMessage\(\s*\{ type: 'proverochnaya:init', initData/,
  'Подпись не передаётся рукопожатием');

// ── 5. Ни отправка, ни приём не работают со звёздочкой ─────────────────────
assert.doesNotMatch(open, /postMessage\([^)]*,\s*'\*'\)/,
  "postMessage со '*': подпись достанется любому, кто окажется в рамке");
assert.match(open, /if \(e\.origin !== SECOND_PART_ORIGIN\) return;/,
  'Входящие сообщения не проверяются по origin — рукопожатие подделает кто угодно');
const posts = (open.match(/postMessage\([\s\S]{0,200}?SECOND_PART_ORIGIN\)/g) || []).length;
assert.strictEqual(posts, 2, `Отправок с точным адресом ${posts}, а должно быть две (подпись и тема)`);

// ── 6. Компьютер работает: билет вместо подписи ────────────────────────────
// initData существует ТОЛЬКО внутри мини-аппа Telegram. Ученик, вошедший на ПК
// по QR-коду, тренажёру известен, и упираться в «откройте из Telegram» он не
// должен. Поэтому просим ещё и билет, а тупик оставляем лишь тому, у кого нет
// вообще ничего.
assert.match(modes, /async function _secondPartTicket\(\)/, 'Функции запроса билета нет');
// Существования функции мало: вырезав ВЫЗОВ, объявление оставляют на месте, и
// проверка «функция есть» остаётся зелёной, пока компьютер не работает.
assert.match(open, /const ticket = await _secondPartTicket\(\);/,
  'Билет не запрашивается при открытии — на компьютере раздел не откроется');
assert.match(modes, /X-CSRF-Token/, 'Запрос билета уйдёт без CSRF и получит отказ');
assert.match(open, /\{ type: 'proverochnaya:init', initData, ticket, theme:/,
  'Билет не передаётся в рукопожатии — их сторона о нём не узнает');
assert.match(open, /if \(!initData && !ticket\) \{/,
  'Тупик показывается при одной лишь нехватке подписи — компьютер отвалится, хотя билет есть');
assert.match(open, /Нужен привязанный Telegram/, 'Тупик ничего не объясняет');

// ── 7. Закрытие убирает за собой ────────────────────────────────────────────
// Слушатель окна и наблюдатель темы переживают снятие узла: без снятия они
// копятся по одному на каждое открытие и продолжают слать в мёртвую рамку.
assert.match(open, /window\.removeEventListener\('message', onMessage\)/,
  'Слушатель сообщений не снимается — накопится по одному на каждое открытие');
assert.match(open, /themeObserver\.disconnect\(\)/,
  'Наблюдатель темы не отключается — будет слать в закрытую рамку');

console.log('second-part-embed.selftest: ok');
