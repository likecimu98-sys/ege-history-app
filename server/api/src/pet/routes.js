'use strict';

// Маршруты «Летописчика»: /api/v1/pet/*. Только для учеников тренажёра; у
// кураторов «Проверочной» ни питомца, ни монет нет (решение владельца 27.09.2026).

const { tx, pool } = require('../db');
const C = require('./catalog');
const W = require('./wallet');
const S = require('./social');

const PREFIX = '/api/v1/pet';

// Каталог отдаём с долгим кэшем по версии: клиент просит его с ?v=<версия>,
// и смена каталога сама сбрасывает кэш.
let showcaseCache = { at: 0, data: {} };
async function showcase() {
  if (Date.now() - showcaseCache.at < 5 * 60 * 1000) return showcaseCache.data;
  showcaseCache = { at: Date.now(), data: { ...(await W.rarityShowcase(pool)), ...(await W.speciesShowcase(pool)) } };
  return showcaseCache.data;
}

const CARE_PATHS = new Set(['/buy', '/use', '/equip', '/spin', '/tap', '/rename', '/open-box', '/react', '/battle', '/round', '/craft', '/switch', '/paint-nick']);

async function handlePet(req, res, url, session, deps) {
  const { json, readJson, requireMutationAuth, requireSession, accessContext, limiter, scope } = deps;
  const path = url.pathname.slice(PREFIX.length) || '/';

  if (req.method === 'GET' && path === '/catalog') {
    return json(res, 200, { ...C.publicCatalog(), owners: await showcase() },
      { 'Cache-Control': 'public, max-age=300' });
  }

  if (req.method === 'GET' && path === '/') {
    requireSession(session);
    const ctx = await accessContext(session);
    const state = await tx(client => W.getState(client, session.userId, ctx.docIds));
    return json(res, 200, state);
  }

  // Профиль чужого питомца, «Кто круче?» и новости — только для вошедших.
  if (req.method === 'GET' && path.startsWith('/profile/')) {
    requireSession(session);
    return json(res, 200, await S.profile(pool, session.userId, decodeURIComponent(path.slice('/profile/'.length))));
  }
  if (req.method === 'GET' && path === '/battle') {
    requireSession(session);
    return json(res, 200, await tx(client => S.battle(client, session.userId)));
  }
  if (req.method === 'GET' && path === '/news') {
    requireSession(session);
    return json(res, 200, await S.news(pool));
  }

  if (req.method !== 'POST') {
    throw Object.assign(new Error('not_found'), { statusCode: 404 });
  }
  requireMutationAuth(req, session);
  if (!limiter.take(`${scope}:pet`, 120).ok) return json(res, 429, { error: 'rate_limited' });
  const body = await readJson(req, 8192);
  const userId = session.userId;
  // Любое действие ученика с питомцем — забота: сбрасывает счёт забытых дней
  // (смерть от забвения, wallet.js). Отметка ставится ДО действия, чтобы ответ
  // уже не показывал предупреждение. Синхронизация ачивок — автоматическая,
  // её клиент шлёт сам, поэтому заботой не считается.
  const run = fn => tx(async client => {
    if (CARE_PATHS.has(path)) await W.markCare(client, userId);
    return fn(client);
  });

  switch (path) {
    case '/hatch': {
      const ctx = await accessContext(session);
      return json(res, 200, await run(c => W.hatch(c, userId, ctx.docIds, {
        species: String(body.species || ''), name: body.name,
        knownAchievements: Array.isArray(body.knownAchievements) ? body.knownAchievements : [],
        ref: body.ref ? String(body.ref) : null,
      })));
    }
    case '/buy':
      return json(res, 200, await run(c => W.buy(c, userId, String(body.item || ''), body.qty)));
    case '/use':
      return json(res, 200, await run(c => W.use(c, userId, String(body.item || ''), { buyNow: !!body.buy })));
    case '/equip':
      return json(res, 200, await run(c => W.equip(c, userId, body.changes && typeof body.changes === 'object' ? body.changes : {})));
    case '/spin':
      return json(res, 200, await run(c => W.spin(c, userId)));
    case '/tap':
      return json(res, 200, await run(c => W.tap(c, userId)));
    case '/rename':
      return json(res, 200, await run(c => W.rename(c, userId, body.name)));
    case '/open-box':
      if (!limiter.take(`${scope}:pet-box`, 30).ok) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await run(c => W.openBox(c, userId, String(body.box || ''))));
    case '/react':
      if (!limiter.take(`${scope}:pet-react`, 60).ok) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await run(c => S.react(c, userId, String(body.publicId || ''), String(body.emoji || ''))));
    case '/battle':
      return json(res, 200, await run(c => S.vote(c, userId, String(body.pick || ''))));
    case '/round':
      return json(res, 200, await run(c => W.claimRound(c, userId)));
    case '/craft':
      return json(res, 200, await run(c => W.craft(c, userId, String(body.species || ''))));
    case '/switch':
      return json(res, 200, await run(c => W.switchPet(c, userId, body.index)));
    case '/achievements':
      return json(res, 200, await run(c => W.rewardAchievements(c, userId, Array.isArray(body.ids) ? body.ids : [])));
    case '/ack-death':
      return json(res, 200, await run(c => W.ackDeath(c, userId)));
    case '/referral': {
      const ctx = await accessContext(session);
      return json(res, 200, await run(c => W.claimReferral(c, userId, ctx.docIds, String(body.ref || ''))));
    }
    case '/paint-nick':
      return json(res, 200, await run(c => W.paintNick(c, userId, String(body.color || ''))));
    default:
      throw Object.assign(new Error('not_found'), { statusCode: 404 });
  }
}

module.exports = { handlePet, PREFIX };
