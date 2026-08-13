'use strict';
// Скрипт выката бота обязан везти ВСЁ, без чего бот не стартует.
//
// 🔴 13.08.2026 выяснилось, что vps-firestore-compat.js — модуль, который bot.js
// require-ит первой же строкой и без которого процесс не поднимается, — не лежал в
// репозитории ВООБЩЕ. Восстановить бота из гита было нельзя. Заодно живой engage.js
// оказался от 20.07: правку «не напоминать о снятом ДЗ» три недели никто не выкатил,
// потому что бот возили руками, а расхождение никто не сверял.
//
// Тест держит связь между тем, что бот require-ит, и тем, что скрипт везёт.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ps1 = fs.readFileSync(path.join(root, 'deploy-bot.ps1'), 'utf8');

// ── Разбираем карту «путь в репозитории -> имя на сервере» ───────────────────
function block(name) {
  const from = ps1.indexOf(`$${name} = `);
  assert.ok(from > 0, `в deploy-bot.ps1 нет $${name}`);
  const open = ps1.indexOf('{', from);
  const close = ps1.indexOf('}', open);
  assert.ok(close > open, `не вижу конца $${name}`);
  return ps1.slice(open + 1, close);
}
const files = new Map();
for (const line of block('FILES').split('\n')) {
  const m = line.match(/'([^']+)'\s*=\s*'([^']+)'/);
  if (m) files.set(m[2], m[1]);          // имя на сервере -> путь в репозитории
}
assert.ok(files.size >= 8, `в карте выката подозрительно мало файлов: ${files.size}`);

const owner = new Map();
for (const m of block('OWNER').matchAll(/'([^']+)'\s*=\s*'([^']+)'/g)) owner.set(m[1], m[2]);

// ── 1. Каждый везомый файл действительно лежит в репозитории ─────────────────
for (const [name, repoPath] of files) {
  assert.ok(fs.existsSync(path.join(root, repoPath)),
    `скрипт везёт ${name} из ${repoPath}, а такого файла в репозитории нет`);
}

// ── 2. Каждый require('./…') из везомого кода тоже везётся ───────────────────
// Ровно эта проверка и поймала бы пропажу vps-firestore-compat.js.
for (const [name, repoPath] of files) {
  if (!name.endsWith('.js')) continue;
  const src = fs.readFileSync(path.join(root, repoPath), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  for (const m of src.matchAll(/require\(\s*'\.\/([^']+)'\s*\)/g)) {
    const dep = m[1].endsWith('.js') ? m[1] : m[1] + '.js';
    assert.ok(files.has(dep),
      `${name} требует ./${m[1]}, но скрипт выката его не везёт — бот не поднимется`);
  }
}

// ── 3. У каждого файла назван хозяин-процесс ─────────────────────────────────
// Иначе изменённый файл поедет на сервер, а перезапускать будет некого.
for (const name of files.keys()) {
  assert.ok(owner.has(name), `для ${name} не указано, какой процесс его перезапускает`);
  assert.ok(['hist-bot', 'hist-token', 'none'].includes(owner.get(name)),
    `неизвестный процесс-хозяин у ${name}: ${owner.get(name)}`);
}
// Точки входа обоих процессов обязаны везтись.
assert.equal(owner.get('bot.js'), 'hist-bot', 'bot.js должен перезапускать hist-bot');
assert.equal(owner.get('vps-main.js'), 'hist-token', 'vps-main.js должен перезапускать hist-token');

// ── 4. Секреты и данные не везём никогда ─────────────────────────────────────
for (const forbidden of ['.env', 'users.db', 'serviceAccount.json', 'node_modules']) {
  assert.ok(!files.has(forbidden), `${forbidden} попал в список выката — это секрет или данные`);
}

// ── 5. Защиты, ради которых скрипт и написан ────────────────────────────────
assert.match(ps1, /RELEASE-MANIFEST/, 'нет манифеста — расхождение с прод-версией снова станет незаметным');
assert.match(ps1, /node --check/, 'нет проверки синтаксиса перед подменой');
assert.match(ps1, /rollback/, 'нет отката');
assert.match(ps1, /status --porcelain/, 'выкат не требует чистого дерева');
// PowerShell 5.1 читает скрипты как ANSI, BOM у наших скриптов нет: кириллица тут
// превратится в мусор. Русский — только в комментариях .js и .sh, но не здесь.
const cyr = ps1.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /[\u0400-\u04FF]/.test(l));
assert.deepEqual(cyr, [], `в deploy-bot.ps1 есть кириллица (строки ${cyr.map(c => c[0]).join(', ')}) — PowerShell 5.1 прочтёт её как мусор`);

console.log('bot-deploy-manifest.selftest: ok');
