'use strict';
// Лог бота — единственное место, где видно, что он вообще делал. Если туда сыплет
// периодическая служебная строка, настоящие события в ней тонут.
//
// 🔴 Замер 07.08.2026 на боевом: /root/.pm2/logs/hist-bot-out.log — 290 998 строк,
// из них 290 954 повторяющиеся «teachers cache» и «orgs cache», по паре каждые
// 4 секунды. Настоящих событий — 44 строки. Поиск по логу перестал работать:
// грепом по «duel» не находилось ничего, хотя дуэли в эти дни шли.
//
// Причина: onSnapshot остался от Firestore, где колбэк звали ПРИ ИЗМЕНЕНИИ. Под
// PostgreSQL под ним слой совместимости, который просто опрашивает базу по таймеру
// и зовёт колбэк на каждый опрос. Значит, любая печать внутри такого колбэка
// обязана быть условной.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'bot', 'src', 'bot.js'), 'utf8');
const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

// ── 1. Сторожа кэшей печатают только при смене состава ──────────────────────
for (const watcher of ['watchTeachers', 'watchOrgs']) {
  const start = code.indexOf(`function ${watcher}(`);
  assert.ok(start > 0, `${watcher} не найдена в bot.js`);
  const body = code.slice(start, code.indexOf('\n}', start) + 2);

  assert.match(body, /cacheSignature\(/,
    `${watcher}: подпись кэша не считается — печатать будет на каждый опрос`);
  assert.match(body, /if \(sig === logged\) return;/,
    `${watcher}: нет раннего выхода при неизменившемся кэше`);

  // Печать обязана стоять ПОСЛЕ проверки, иначе условие ничего не даёт.
  const guardAt = body.indexOf('if (sig === logged) return;');
  const logAt = body.indexOf('console.log(');
  assert.ok(logAt > guardAt,
    `${watcher}: console.log стоит до проверки — спам никуда не делся`);
}

// ── 2. Подпись считается по составу, а не по размеру ────────────────────────
// Замена одного учителя на другого размер не меняет, но знать о ней надо.
const sigStart = code.indexOf('function cacheSignature(');
assert.ok(sigStart > 0, 'cacheSignature не найдена');
const sigBody = code.slice(sigStart, code.indexOf('\n}', sigStart) + 2);
assert.match(sigBody, /keys\(\)/,
  'подпись не смотрит на ключи — замена элемента один-в-один останется незамеченной');

// ── 3. Поведение самой подписи ──────────────────────────────────────────────
const cacheSignature = new Function(`${sigBody}; return cacheSignature;`)();
const a = new Map([['1', {}], ['2', {}]]);
const b = new Map([['2', {}], ['1', {}]]);
const c = new Map([['1', {}], ['3', {}]]);
assert.equal(cacheSignature(a), cacheSignature(b), 'порядок ключей не должен менять подпись');
assert.notEqual(cacheSignature(a), cacheSignature(c), 'замена ключа обязана менять подпись');
assert.notEqual(cacheSignature(a), cacheSignature(new Map([['1', {}]])), 'размер обязан влиять');

console.log('bot-log-noise.selftest: ok');
