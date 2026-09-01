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
  // Дополнительные origin, с которых принимаются мутации. Список ЗАКРЫТЫЙ и
  // задаётся вручную: проверка Origin — половина защиты от CSRF, подстановочные
  // маски тут недопустимы.
  //
  // Зачем появился (27.07.2026): www.reshay-istoriyu.ru переведён в режим
  // DNS-only и ходит прямо на сервер мимо Cloudflare — это запасной адрес для
  // тех, у кого основной домен не открывается. Страница под ним грузилась, но
  // ЛЮБАЯ запись падала с csrf_failed: браузер шлёт Origin с www, а сверялись
  // мы ровно с одним значением. То есть человек занимался, а прогресс не
  // сохранялся — молча, потому что ошибка видна только в консоли.
  extraOrigins: value('EXTRA_ORIGINS', '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
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
  // Уборка брошенных гостевых аккаунтов. ВЫКЛЮЧЕНА по умолчанию намеренно:
  // это удаление данных, и включать его должен человек, посмотрев на число
  // затрагиваемых записей. Включается GUEST_CLEANUP=1 в /etc/ege-history/api.env.
  guestCleanup: bool('GUEST_CLEANUP'),
  guestCleanupDays: Math.max(7, integer('GUEST_CLEANUP_DAYS', 30)),

  // --- Предмет «обществознание» (этап 2) ------------------------------------
  // ВЫКЛЮЧЕН по умолчанию. Порядок выката из плана: сначала миграция и API с
  // погашенным флагом, затем включение тестовым аккаунтам, затем всем. Пока
  // SOCIAL_API=0, маршруты /api/v1/subjects/social/* отвечают 404 — то есть
  // выкатить код можно, ничего не включив.
  socialApi: bool('SOCIAL_API'),
  // Origin приложения обществознания. Список ЗАКРЫТЫЙ и задаётся вручную по той
  // же причине, что extraOrigins: проверка Origin — половина защиты от CSRF, и
  // это же второй замок предметной изоляции (см. subjects/social/routes.js).
  socialOrigins: csv('SOCIAL_ORIGINS').map(s => s.replace(/\/$/, '')),
  // Дневная квота предмета. 0 = безлимит; квота обществознания считается
  // отдельным счётчиком и не расходует лимит истории.
  socialFreeDaily: Math.max(0, integer('SOCIAL_FREE_DAILY', 0)),
  // Токен бота обществознания. Отдельный бот — отдельная подпись initData, но
  // Telegram ID у человека один на все боты, поэтому вход через любой из них
  // ведёт в ОДИН аккаунт. Пусто — значит мини-апп обществознания входит только
  // через Google или гостя.
  socialBotToken: value('SOCIAL_BOT_TOKEN'),
  // 🔴 УЗКИЙ ключ для «Проверочной» (вторая часть ЕГЭ, hw.reshay-istoriyu.ru).
  //
  // Отдельный, а НЕ INTERNAL_API_TOKEN. Тот открывает /internal/v1/store/write,
  // который обходит authorizeWrite целиком, то есть даёт право писать в документ
  // любого ученика. «Проверочная» принимает загрузку файлов от учеников (фото
  // работ) — это самая широкая поверхность атаки в контуре, и мастер-ключ там
  // лежать не должен. Этот ключ открывает РОВНО один маршрут и только на чтение.
  // Пусто — маршрут отвечает 404, как будто его нет.
  secondPartKey: value('SECOND_PART_KEY'),
};

// Единственное место, где решается «принимаем ли мутацию с этого origin».
// Раньше сравнение было рассыпано тремя копиями `origin !== env.publicOrigin`
// (auth.js и два места в server.js), и добавление запасного адреса требовало
// вспомнить про все три. Пропустишь одну — часть запросов молча отвергается.
// Origin обществознания входит сюда же: авторизация, куки и CSRF у двух
// предметов общие, и без этого вход в обществознании молча падал бы на
// csrf_failed. Список остаётся закрытым — адрес задаётся переменной SOCIAL_ORIGINS
// на сервере, а не приходит от клиента.
const allowedOrigins = new Set([env.publicOrigin, ...env.extraOrigins, ...env.socialOrigins]);
function originAllowed(origin) {
  // Пустой Origin пропускаем: его не шлют не-CORS запросы и часть WebView.
  // Защита от подделки держится на втором множителе — CSRF-токене из куки,
  // который чужой сайт прочитать не может.
  if (!origin) return true;
  return allowedOrigins.has(String(origin).replace(/\/$/, ''));
}

module.exports = { env, readEnvFile, originAllowed, allowedOrigins };
