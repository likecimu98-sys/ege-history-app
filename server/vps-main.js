'use strict';

// ── Самодостаточный процесс эндпоинта токенов для VPS ─────────────────────────
// НЕ трогает bot.js. Запускается отдельным pm2-приложением рядом с ботом:
//   scp server/{initdata,token-endpoint,vps-main}.js root@VPS:/root/bot/
//   ssh VPS 'cd /root/bot && pm2 start vps-main.js --name hist-token && pm2 save'
// Читает тот же serviceAccount.json и .env, что и бот. Слушает только localhost;
// наружу — только через nginx location /auth/ (см. server/README.md).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { createTokenServer } = require('./token-endpoint');

const BOT_DIR = __dirname;

// .env бота (KEY=VALUE построчно) — берём токен бота отсюда, имя ключа угадываем.
function loadEnv(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return env;
}

const env = loadEnv(path.join(BOT_DIR, '.env'));
const BOT_TOKEN =
  env.BOT_TOKEN || env.TELEGRAM_TOKEN || env.TG_TOKEN || env.TOKEN ||
  process.env.BOT_TOKEN || process.env.TELEGRAM_TOKEN;
if (!BOT_TOKEN) {
  console.error('[token] Не нашёл токен бота в /root/bot/.env (ключ BOT_TOKEN/TELEGRAM_TOKEN/…).');
  console.error('[token] Задай TOKEN_ENV_NAME или переименуй ключ и перезапусти.');
  process.exit(1);
}

const SA = process.env.SERVICE_ACCOUNT || path.join(BOT_DIR, 'serviceAccount.json');
try {
  admin.initializeApp({ credential: admin.credential.cert(require(SA)) });
} catch (e) {
  console.error('[token] Не удалось инициализировать firebase-admin:', e && e.message);
  process.exit(1);
}

const APP_ID = process.env.APP_ID || 'ege-history-bot';

// Учитель? — читаем teachers/{tgId} тем же admin (правила на Admin SDK не действуют).
async function isTeacher(tgId) {
  try {
    const snap = await admin.firestore()
      .doc(`artifacts/${APP_ID}/public/data/teachers/${tgId}`).get();
    if (!snap.exists) return { teacher: false };
    const d = snap.data() || {};
    const classes = (Array.isArray(d.classes) ? d.classes : [])
      .map(c => (typeof c === 'string' ? c : (c && c.code))).filter(Boolean);
    return { teacher: true, classes };
  } catch (e) {
    console.warn('[token] isTeacher error:', e && e.message);
    return { teacher: false };
  }
}

// ── Авто-premium по подписке на группы клуба ─────────────────────────────────
// Список чатов — config/limits.premiumChats: [{ id, title }] (управление в боте:
// /premiumgroup в самой группе или /premiumgroup <chatId> в личке админа).
// При каждом входе в приложение: состоит хоть в одном чате → premiumAuto=true,
// не состоит нигде → premiumAuto=false. Ручной флаг premium (команда /premium)
// живёт отдельным полем и НЕ трогается; клиент считает подписчиком по OR.
const https = require('https');

let _chatsCache = { at: 0, list: [] };
async function getPremiumChats() {
  if (Date.now() - _chatsCache.at < 60000) return _chatsCache.list;
  const snap = await admin.firestore()
    .doc(`artifacts/${APP_ID}/public/data/config/limits`).get();
  const raw = (snap.exists && snap.data().premiumChats) || [];
  const list = (Array.isArray(raw) ? raw : [])
    .map(c => Number(c && c.id)).filter(Boolean);
  _chatsCache = { at: Date.now(), list };
  return list;
}

function tgGetChatMember(chatId, userId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, user_id: Number(userId) });
    const req = https.request({
      host: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/getChatMember`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('tg timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function refreshAutoPremium(tgId) {
  const chats = await getPremiumChats();
  const ref = admin.firestore().doc(`artifacts/${APP_ID}/public/data/students/${tgId}`);

  let member = false;
  for (const chatId of chats) {
    let r;
    try { r = await tgGetChatMember(chatId, tgId); }
    catch (e) {
      // Сеть/таймаут TG — статус неизвестен, флаг не трогаем (не отбираем по ошибке).
      console.warn('[premium] getChatMember network fail:', chatId, e && e.message);
      return;
    }
    if (!r.ok) {
      // user not found в этом чате — это честное «не состоит», идём к следующему.
      if (/not found|user_not_participant/i.test(r.description || '')) continue;
      // Бот не в чате / чат удалён — конфиг битый, статус неизвестен: не трогаем.
      console.warn('[premium] getChatMember api fail:', chatId, r.description);
      return;
    }
    const st = (r.result && r.result.status) || '';
    if (st === 'creator' || st === 'administrator' || st === 'member'
        || (st === 'restricted' && r.result.is_member)) { member = true; break; }
  }

  const snap = await ref.get();
  const cur = !!(snap.exists && snap.data().premiumAuto);
  if (cur === member) return;
  await ref.set({ premiumAuto: member, premiumAutoAt: Date.now() }, { merge: true });
  console.log(`[premium] ${tgId}: premiumAuto → ${member}`);
}

const PORT = Number(process.env.TOKEN_PORT) || 8791;
createTokenServer({
  admin,
  botToken: BOT_TOKEN,
  isTeacher,
  onAuth: refreshAutoPremium,
  origin: process.env.TOKEN_ORIGIN || 'https://reshay-istoriyu.ru',
  log: console,
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[token] эндпоинт слушает 127.0.0.1:${PORT} (POST /auth/telegram)`);
});
