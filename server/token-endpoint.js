'use strict';

// ── HTTP-эндпоинт: Telegram initData → Firebase custom-token (uid = tgId) ─────
// Фабрика, чтобы можно было и подключить в bot.js (общий admin/токен), и гонять
// в тестах с моками. НЕ слушает порт сам по себе — возвращает http.Server;
// решение слушать/за каким nginx — в деплое (server/README.md).
//
// deps: {
//   admin,            // инициализированный firebase-admin
//   botToken,         // токен бота (для проверки подписи initData)
//   isTeacher,        // async (tgId) => { teacher:bool, classes?:[] }  (из Firestore/SQLite бота)
//   origin,           // CORS-origin, по умолчанию https://reshay-istoriyu.ru
//   maxAgeSec,        // срок годности initData, по умолчанию 24ч
//   log               // console-подобный
// }

const http = require('http');
const { verifyInitData } = require('./initdata');

function createTokenServer(deps) {
  const {
    admin,
    botToken,
    isTeacher = async () => ({ teacher: false }),
    origin = 'https://reshay-istoriyu.ru',
    maxAgeSec = 86400,
    log = console,
  } = deps;

  async function handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method !== 'POST' || !req.url.startsWith('/auth/telegram')) {
      res.writeHead(404); return res.end(JSON.stringify({ error: 'not_found' }));
    }

    let body = '';
    let tooBig = false;
    req.on('data', (c) => {
      body += c;
      if (body.length > 16384) { tooBig = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      try {
        let initData = '';
        try { initData = (JSON.parse(body || '{}').initData) || ''; } catch (e) {}
        const v = verifyInitData(initData, botToken, { maxAgeSec });
        if (!v.ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: v.reason }));
        }

        const claims = { tgId: v.tgId };
        try {
          const t = await isTeacher(v.tgId);
          if (t && t.teacher) {
            claims.teacher = true;
            if (Array.isArray(t.classes)) claims.classes = t.classes.slice(0, 40);
          }
        } catch (e) { log.warn && log.warn('[token] isTeacher fail:', e && e.message); }

        const token = await admin.auth().createCustomToken(v.tgId, claims);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } catch (e) {
        log.error && log.error('[token] endpoint error:', e && e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      }
    });
  }

  return http.createServer(handle);
}

module.exports = { createTokenServer };
