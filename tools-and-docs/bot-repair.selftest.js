'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'server', 'bot', 'src', 'bot.js'),
    'utf8'
);

assert.match(
    source,
    /const RECOVERY_URL = process\.env\.RECOVERY_URL \|\| 'https:\/\/reshay-istoriyu\.ru\/sw-recover';/
);
assert.match(
    source,
    /const RECOVERY_APP_URL = process\.env\.RECOVERY_APP_URL \|\| 'https:\/\/www\.reshay-istoriyu\.ru\/\?recovery=1';/
);
assert.match(
    source,
    /new InlineKeyboard\(\)[\s\S]*?\.webApp\('1\. 🛟 Исправить загрузку', RECOVERY_URL\)[\s\S]*?\.row\(\)[\s\S]*?\.webApp\('2\. 🚀 Открыть тренажёр заново', RECOVERY_APP_URL\)/
);

const menuEntries = source.match(/\{ command: 'repair', description: '🛟 Исправить загрузку' \}/g) || [];
assert.equal(menuEntries.length, 4, 'Repair command must be visible to students, teachers, owners and admins');

const commandAt = source.indexOf("bot.command('repair'");
const catchAllAt = source.indexOf("bot.on('message'");
assert.ok(commandAt >= 0, 'Missing /repair handler');
assert.ok(catchAllAt > commandAt, '/repair must be registered before the catch-all message handler');
assert.match(source.slice(commandAt, catchAllAt), /reply_markup: repairKb\(\)/);
assert.match(source.slice(commandAt, catchAllAt), /Если окно не закрылось само — закрой его крестиком/);
assert.match(source.slice(commandAt, catchAllAt), /Затем нажми «Открыть тренажёр заново»/);
assert.match(source.slice(commandAt, catchAllAt), /Аккаунт и прогресс сохранятся/);

console.log('Bot repair command self-test passed');
