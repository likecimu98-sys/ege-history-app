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

const PORT = Number(process.env.TOKEN_PORT) || 8791;
createTokenServer({
  admin,
  botToken: BOT_TOKEN,
  isTeacher,
  origin: process.env.TOKEN_ORIGIN || 'https://reshay-istoriyu.ru',
  log: console,
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[token] эндпоинт слушает 127.0.0.1:${PORT} (POST /auth/telegram)`);
});
