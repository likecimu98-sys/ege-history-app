'use strict';

// Офлайн-тест HTTP-эндпоинта с МОКАМИ (без Firebase, без сети наружу).
// Поднимает сервер на 127.0.0.1:0, шлёт запросы, проверяет ответы.
// Запуск:  node server/endpoint.selftest.js

const crypto = require('crypto');
const http = require('http');
const { createTokenServer } = require('./token-endpoint');

const TOKEN = '123456:AA-TEST-BOT-TOKEN';
const now = () => Math.floor(Date.now() / 1000);

function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

// мок firebase-admin: createCustomToken возвращает предсказуемую строку с claims
const adminMock = {
  auth: () => ({
    createCustomToken: async (uid, claims) => `TOKEN(${uid}|${JSON.stringify(claims)})`,
  }),
};
const teacherIds = new Set(['352253483']);
const isTeacher = async (tgId) => ({ teacher: teacherIds.has(tgId), classes: teacherIds.has(tgId) ? ['0377'] : [] });

const server = createTokenServer({
  admin: adminMock, botToken: TOKEN, isTeacher,
  log: { warn() {}, error() {} },
});

function post(port, path, bodyObj) {
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyObj);
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.write(body); req.end();
  });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let pass = 0, fail = 0;
  const check = (n, c) => { c ? pass++ : fail++; console.log(`  ${c ? '✅' : '❌'} ${n}`); };

  // ученик (не учитель) → токен без claim teacher
  let init = signInitData({ user: { id: 7009819968, first_name: 'Илья' }, auth_date: String(now()) }, TOKEN);
  let r = await post(port, '/auth/telegram', { initData: init });
  let j = JSON.parse(r.body || '{}');
  check('валидный ученик → 200 + токен с uid=tgId', r.status === 200 && j.token && j.token.includes('7009819968'));
  check('у ученика НЕТ claim teacher', j.token && !j.token.includes('"teacher"'));

  // учитель → claim teacher:true + classes
  init = signInitData({ user: { id: 352253483, first_name: 'Саша' }, auth_date: String(now()) }, TOKEN);
  r = await post(port, '/auth/telegram', { initData: init });
  j = JSON.parse(r.body || '{}');
  check('учитель → claim teacher:true', j.token && j.token.includes('"teacher":true'));
  check('учитель → claim classes', j.token && j.token.includes('0377'));

  // подделка → 401
  r = await post(port, '/auth/telegram', { initData: init.replace(/hash=[0-9a-f]+/i, 'hash=' + 'a'.repeat(64)) });
  check('подделанный initData → 401', r.status === 401);

  // пустой → 401
  r = await post(port, '/auth/telegram', { initData: '' });
  check('пустой initData → 401', r.status === 401);

  // неверный путь → 404
  r = await post(port, '/nope', { initData: init });
  check('чужой путь → 404', r.status === 404);

  server.close();
  console.log(`\n  ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
