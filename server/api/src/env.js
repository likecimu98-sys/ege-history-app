'use strict';

const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const pos = line.indexOf('=');
      if (pos < 1) continue;
      const key = line.slice(0, pos).trim();
      let value = line.slice(pos + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch (_) {}
  return out;
}

const localFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
const local = readEnvFile(localFile);
const bot = readEnvFile('/root/bot/.env');

function value(name, fallback = '') {
  return process.env[name] ?? local[name] ?? bot[name] ?? fallback;
}

function integer(name, fallback) {
  const n = Number(value(name, String(fallback)));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function bool(name, fallback = false) {
  const v = String(value(name, fallback ? '1' : '0')).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function csv(name) {
  return String(value(name, '')).split(',').map(v => v.trim()).filter(Boolean);
}

const env = {
  host: value('API_HOST', '127.0.0.1'),
  port: integer('API_PORT', 8792),
  publicOrigin: value('PUBLIC_ORIGIN', 'https://reshay-istoriyu.ru').replace(/\/$/, ''),
  databaseUrl: value('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL'),
  dbPoolMax: Math.min(50, Math.max(2, integer('DB_POOL_MAX', 10))),
  botToken: value('BOT_TOKEN') || value('TELEGRAM_TOKEN') || value('TG_TOKEN') || value('TOKEN'),
  adminTelegramIds: new Set(csv('ADMIN_TELEGRAM_IDS').length ? csv('ADMIN_TELEGRAM_IDS') : ['352253483']),
  internalApiToken: value('INTERNAL_API_TOKEN'),
  googleClientId: value('GOOGLE_CLIENT_ID'),
  googleClientSecret: value('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: value('GOOGLE_REDIRECT_URI', 'https://reshay-istoriyu.ru/api/v1/auth/google/callback'),
  sessionDays: Math.max(1, integer('SESSION_DAYS', 90)),
  sessionCookie: value('SESSION_COOKIE', 'ege_session'),
  csrfCookie: value('CSRF_COOKIE', 'ege_csrf'),
  maxBodyBytes: Math.max(65536, integer('MAX_BODY_BYTES', 8 * 1024 * 1024)),
  trustProxy: bool('TRUST_PROXY', true),
  firebaseServiceAccount: value('FIREBASE_SERVICE_ACCOUNT', '/root/bot/serviceAccount.json'),
  firebaseAppId: value('FIREBASE_APP_ID', 'ege-history-bot'),
  mirrorFirebase: bool('MIRROR_FIREBASE'),
};

module.exports = { env, readEnvFile };
