'use strict';

// Офлайн-самотест проверки подписи initData. Ничего живого не трогает.
// Запуск:  node server/initdata.selftest.js

const crypto = require('crypto');
const { verifyInitData } = require('./initdata');

// Подписываем initData так же, как это делает Telegram (для теста).
function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dcs = pairs.join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const TOKEN = '123456:AA-TEST-BOT-TOKEN';
const now = Math.floor(Date.now() / 1000);
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? '✅' : '❌'} ${name}`); };

// 1. валидный
let init = signInitData({ user: { id: 352253483, first_name: 'Саша' }, auth_date: String(now), query_id: 'AAH' }, TOKEN);
let v = verifyInitData(init, TOKEN);
check('валидный initData проходит, tgId извлечён', v.ok && v.tgId === '352253483');

// 2. подделка hash
v = verifyInitData(init.replace(/hash=[0-9a-f]+/i, 'hash=' + 'a'.repeat(64)), TOKEN);
check('подделанный hash отвергается (bad_hash)', !v.ok && v.reason === 'bad_hash');

// 3. подмена user.id без пересчёта подписи
v = verifyInitData(init.replace('352253483', '999999999'), TOKEN);
check('подмена user.id ломает подпись', !v.ok && v.reason === 'bad_hash');

// 4. чужой токен бота
v = verifyInitData(init, '654321:OTHER-BOT');
check('чужой bot token отвергается', !v.ok && v.reason === 'bad_hash');

// 5. протухший auth_date
let old = signInitData({ user: { id: 1 }, auth_date: String(now - 200000) }, TOKEN);
v = verifyInitData(old, TOKEN, { maxAgeSec: 86400 });
check('протухший auth_date отвергается (expired)', !v.ok && v.reason === 'expired');

// 6. без user
let nouser = signInitData({ auth_date: String(now) }, TOKEN);
v = verifyInitData(nouser, TOKEN);
check('без user отвергается (no_user)', !v.ok && v.reason === 'no_user');

// 7. пустой/мусор
check('пустая строка отвергается', !verifyInitData('', TOKEN).ok);
check('мусор без hash отвергается', !verifyInitData('foo=bar', TOKEN).ok);

// 8. кириллица в имени (URL-кодирование не должно ломать подпись)
let cyr = signInitData({ user: { id: 42, first_name: 'Ирэн', last_name: 'Ёлкина' }, auth_date: String(now) }, TOKEN);
v = verifyInitData(cyr, TOKEN);
check('кириллица в user не ломает проверку', v.ok && v.tgId === '42');

console.log(`\n  ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
