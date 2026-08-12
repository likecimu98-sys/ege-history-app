'use strict';

const crypto = require('crypto');

function verifyInitData(initData, botToken, opts = {}) {
  const maxAgeSec = opts.maxAgeSec || 86400;
  if (!initData || typeof initData !== 'string') return { ok: false, reason: 'empty' };
  if (!botToken) return { ok: false, reason: 'no_bot_token' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'no_hash' };
  params.delete('hash');
  const pairs = [...params].map(([key, value]) => `${key}=${value}`).sort();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const left = Buffer.from(computed, 'hex');
  const right = Buffer.from(hash, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return { ok: false, reason: 'bad_hash' };
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate) return { ok: false, reason: 'no_auth_date' };
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > maxAgeSec) return { ok: false, reason: 'expired', age };
  if (age < -300) return { ok: false, reason: 'future', age };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (_) {}
  if (!user?.id) return { ok: false, reason: 'no_user' };
  return { ok: true, user, authDate, tgId: String(user.id) };
}

// У обществознания свой бот, а значит и свой токен: подпись initData у него
// другая. Telegram ID при этом ГЛОБАЛЬНЫЙ — один и тот же человек в обоих ботах
// имеет один id, поэтому вход через любой из них ведёт в один аккаунт
// (provider='telegram', subject=tgId). Именно так и выполняется обещание
// «ученик входит в тот же аккаунт, что и в приложении истории».
//
// Проверяем по очереди и возвращаем первый успех. Токенов два-три, каждая
// проверка — один HMAC; перебирать безопасно: подпись чужим токеном валидной не
// станет.
function verifyInitDataAny(initData, botTokens, opts = {}) {
  const tokens = (Array.isArray(botTokens) ? botTokens : [botTokens]).filter(Boolean);
  if (!tokens.length) return { ok: false, reason: 'no_bot_token' };
  let last = { ok: false, reason: 'bad_hash' };
  for (const token of tokens) {
    const result = verifyInitData(initData, token, opts);
    if (result.ok) return result;
    // Причина «просрочено» или «нет пользователя» относится к самим данным, а
    // не к токену: перебирать дальше бессмысленно и только запутает лог.
    if (result.reason !== 'bad_hash' && result.reason !== 'no_bot_token') return result;
    last = result;
  }
  return last;
}

module.exports = { verifyInitData, verifyInitDataAny };
