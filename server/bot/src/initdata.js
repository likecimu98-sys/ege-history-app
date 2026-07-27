'use strict';

// ── Проверка подписи Telegram Mini App initData (HMAC-SHA256 по токену бота) ──
// Security-критично: тут решается, действительно ли запрос пришёл из Telegram от
// конкретного пользователя. Ошибка здесь = обход авторизации. Поэтому:
//   • сравнение хэша через timingSafeEqual (не === );
//   • обязательная свежесть auth_date (защита от replay);
//   • строки собираем ровно по алгоритму Telegram (сортировка, \n, без hash).
//
// Алгоритм (официальный Telegram):
//   data_check_string = отсортированные "key=value" (кроме hash), склеенные \n
//   secret_key        = HMAC_SHA256(key="WebAppData", msg=botToken)
//   ожидаемый hash    = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))

const crypto = require('crypto');

function verifyInitData(initData, botToken, opts = {}) {
  const maxAgeSec = opts.maxAgeSec || 86400; // 24ч
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'empty' };
  if (!botToken) return { ok: false, reason: 'no_bot_token' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'no_hash' };
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_hash' };

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate) return { ok: false, reason: 'no_auth_date' };
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > maxAgeSec) return { ok: false, reason: 'expired', age };
  if (age < -300) return { ok: false, reason: 'future', age }; // часы клиента ушли вперёд

  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) {}
  if (!user || !user.id) return { ok: false, reason: 'no_user' };

  return { ok: true, user, authDate, tgId: String(user.id) };
}

module.exports = { verifyInitData };
