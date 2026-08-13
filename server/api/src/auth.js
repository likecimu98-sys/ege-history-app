'use strict';

const { OAuth2Client } = require('google-auth-library');
const { env, originAllowed, allowedOrigins } = require('./env');
const { pool, tx } = require('./db');
const { randomToken, sha256, base64url } = require('./crypto');
const { parseCookies, cookie, requestIp } = require('./http');

const SESSION_SECONDS = env.sessionDays * 24 * 60 * 60;

function canonicalFor(provider, subject) {
  if (provider === 'telegram') return String(subject);
  if (provider === 'google') return `google_${subject}`;
  if (provider === 'guest') return String(subject).startsWith('guest_') ? String(subject) : `guest_${subject}`;
  return String(subject);
}

// Модуль предмета подключается лениво: auth.js грузится раньше него, и обычный
// require наверху файла замкнул бы зависимости в кольцо.
function socialStore() {
  return require('./subjects/social/store');
}

async function mergeUsers(client, primaryId, secondaryId) {
  if (!secondaryId || primaryId === secondaryId) return primaryId;
  const primary = await client.query('SELECT * FROM app_users WHERE id=$1 FOR UPDATE', [primaryId]);
  const secondary = await client.query('SELECT * FROM app_users WHERE id=$1 FOR UPDATE', [secondaryId]);
  if (!primary.rowCount || !secondary.rowCount) return primaryId;

  for (const table of ['student_profiles', 'student_states', 'teacher_profiles']) {
    await client.query(`UPDATE ${table} SET user_id=$1 WHERE user_id=$2`, [primaryId, secondaryId]);
  }
  await client.query('UPDATE user_sessions SET user_id=$1 WHERE user_id=$2', [primaryId, secondaryId]);
  await client.query('UPDATE assignments SET teacher_user_id=$1 WHERE teacher_user_id=$2', [primaryId, secondaryId]);
  await client.query(`INSERT INTO student_assignments(assignment_id,student_user_id,status,progress,updated_at)
    SELECT assignment_id,$1,status,progress,updated_at FROM student_assignments WHERE student_user_id=$2
    ON CONFLICT (assignment_id,student_user_id) DO UPDATE SET
      status=CASE WHEN EXCLUDED.status='done' THEN 'done' ELSE student_assignments.status END,
      progress=student_assignments.progress || EXCLUDED.progress,
      updated_at=GREATEST(student_assignments.updated_at,EXCLUDED.updated_at)`, [primaryId, secondaryId]);
  await client.query('DELETE FROM student_assignments WHERE student_user_id=$1', [secondaryId]);
  // 🔴 Предметные данные переносит сам предмет. До 13.08.2026 их здесь не было
  // вовсе — mergeUsers написан до появления обществознания, и любое слияние
  // молча оставляло на отключаемом аккаунте прогресс, роль учителя, классы,
  // домашки и свои задания. Весь SQL предмета живёт в одном файле намеренно:
  // перечисляя таблицы здесь, следующую забудут.
  await socialStore().mergeUserData(client, primaryId, secondaryId);
  await client.query('UPDATE user_identities SET user_id=$1 WHERE user_id=$2', [primaryId, secondaryId]);
  await client.query(`UPDATE app_users SET
      display_name=CASE WHEN length(display_name) >= length($2) THEN display_name ELSE $2 END,
      email=CASE WHEN email<>'' THEN email ELSE $3 END,
      updated_at=now()
    WHERE id=$1`, [primaryId, secondary.rows[0].display_name || '', secondary.rows[0].email || '']);
  await client.query('UPDATE app_users SET disabled_at=now(), canonical_doc_id=NULL, updated_at=now() WHERE id=$1', [secondaryId]);
  await client.query('INSERT INTO audit_events(actor_user_id,action,target,details) VALUES($1,$2,$3,$4)',
    [primaryId, 'identity.merge', secondaryId, JSON.stringify({ primaryId, secondaryId })]);
  return primaryId;
}

async function claimLegacyDocument(currentUserId, docId) {
  docId = String(docId || '').trim();
  if (!docId) throw new Error('legacy_document_missing');
  return tx(async client => {
    const existing = await client.query(
      "SELECT user_id FROM user_identities WHERE provider='legacy' AND subject=$1 FOR UPDATE", [docId]
    );
    let userId = currentUserId;
    if (existing.rowCount && existing.rows[0].user_id !== currentUserId) {
      userId = await mergeUsers(client, existing.rows[0].user_id, currentUserId);
    } else if (!existing.rowCount) {
      await client.query("INSERT INTO user_identities(user_id,provider,subject) VALUES($1,'legacy',$2)", [currentUserId, docId]);
    }
    await client.query('UPDATE student_profiles SET user_id=$1 WHERE doc_id=$2', [userId, docId]);
    await client.query('UPDATE student_states SET user_id=$1 WHERE doc_id=$2', [userId, docId]);
    return userId;
  });
}

// 🔴 Аккаунт из эпохи Firebase узнаётся по ПОЧТЕ, а не по subject.
//
// При переезде с Firebase google-личности импортировались с firebase uid в
// поле subject (`JLYb4xm6…`), а настоящий Google присылает числовой `sub`
// (`10830…`). Совпадения нет — и первый же вход через Google заводил человеку
// ВТОРОЙ, пустой аккаунт: весь прогресс, роль учителя и классы оставались на
// старом. На 13.08.2026 таких личностей 14 из 15, и один человек уже попался.
//
// Условия связывания намеренно узкие, потому что ошибка здесь означает выдачу
// чужих данных:
//   * почта подтверждена самим Google (`email_verified` проверяется выше);
//   * у кандидата УЖЕ есть google-личность — то есть этой почтой он входил и
//     раньше, просто под старым идентификатором;
//   * кандидат ровно один. Двое — значит, мы не знаем, кто из них тот самый,
//     и заводим новый аккаунт, как раньше.
async function findLegacyAccountByEmail(client, email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return null;
  const result = await client.query(
    `SELECT u.id FROM app_users u
     WHERE u.disabled_at IS NULL AND lower(u.email) = $1
       AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'google')
     FOR UPDATE`,
    [address]);
  return result.rowCount === 1 ? result.rows[0].id : null;
}

async function resolveIdentity({ provider, subject, displayName = '', email = '', profile = {}, linkUserId = null, linkByVerifiedEmail = false }) {
  subject = String(subject || '').trim();
  if (!subject) throw new Error('identity_subject_missing');
  return tx(async client => {
    const found = await client.query(
      'SELECT i.user_id,u.disabled_at FROM user_identities i JOIN app_users u ON u.id=i.user_id WHERE i.provider=$1 AND i.subject=$2 FOR UPDATE',
      [provider, subject]
    );
    let userId;
    if (found.rowCount) {
      userId = found.rows[0].user_id;
      if (linkUserId && linkUserId !== userId) userId = await mergeUsers(client, userId, linkUserId);
    } else if (linkUserId) {
      const link = await client.query('SELECT id FROM app_users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [linkUserId]);
      userId = link.rowCount ? linkUserId : null;
    }
    if (!userId && linkByVerifiedEmail) {
      const legacyId = await findLegacyAccountByEmail(client, email);
      if (legacyId) {
        userId = legacyId;
        await client.query('INSERT INTO audit_events(actor_user_id,action,target,details) VALUES($1,$2,$3,$4)',
          [userId, 'identity.link.email', subject, JSON.stringify({ provider })]);
      }
    }
    if (!userId) {
      const created = await client.query(
        'INSERT INTO app_users(canonical_doc_id,display_name,email) VALUES($1,$2,$3) RETURNING id',
        [canonicalFor(provider, subject), displayName, email]
      );
      userId = created.rows[0].id;
    }
    await client.query(`INSERT INTO user_identities(user_id,provider,subject,email,profile)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(provider,subject) DO UPDATE SET
        user_id=EXCLUDED.user_id,email=EXCLUDED.email,profile=EXCLUDED.profile,last_seen_at=now()`,
      [userId, provider, subject, email, JSON.stringify(profile || {})]);

    const preferred = canonicalFor(provider, subject);
    await client.query(`UPDATE app_users SET
      canonical_doc_id=CASE
        WHEN $2='telegram' THEN $3
        WHEN canonical_doc_id IS NULL OR canonical_doc_id LIKE 'guest_%' THEN $3
        ELSE canonical_doc_id END,
      display_name=CASE WHEN $4<>'' THEN $4 ELSE display_name END,
      email=CASE WHEN $5<>'' THEN $5 ELSE email END,
      disabled_at=NULL,updated_at=now()
      WHERE id=$1`, [userId, provider, preferred, displayName, email]);
    return userId;
  });
}

async function loadUser(userId, client = pool) {
  const userResult = await client.query('SELECT * FROM app_users WHERE id=$1 AND disabled_at IS NULL', [userId]);
  if (!userResult.rowCount) return null;
  const identitiesResult = await client.query(
    'SELECT provider,subject,email,profile FROM user_identities WHERE user_id=$1 ORDER BY CASE provider WHEN \'telegram\' THEN 1 WHEN \'google\' THEN 2 WHEN \'guest\' THEN 3 ELSE 4 END',
    [userId]
  );
  const user = userResult.rows[0];
  const identities = identitiesResult.rows;
  const primary = identities.find(i => i.provider === 'telegram') || identities.find(i => i.provider === 'google') || identities[0];
  const uid = primary ? canonicalFor(primary.provider, primary.subject).replace(/^google_/, '') : user.id;
  return {
    id: user.id,
    uid,
    canonicalDocId: user.canonical_doc_id || (primary && canonicalFor(primary.provider, primary.subject)) || '',
    displayName: user.display_name || (primary && primary.profile && primary.profile.first_name) || '',
    email: user.email || (primary && primary.email) || '',
    isAnonymous: !identities.some(i => i.provider === 'telegram' || i.provider === 'google'),
    identities,
    providerData: identities.filter(i => i.provider === 'google').map(i => ({
      providerId: 'google.com', uid: i.subject, email: i.email || '', displayName: (i.profile && i.profile.name) || ''
    })),
  };
}

async function createSession(userId, req) {
  const token = randomToken(40);
  const csrf = randomToken(24);
  const ua = String(req.headers['user-agent'] || '').slice(0, 500);
  const ip = requestIp(req);
  await pool.query(`INSERT INTO user_sessions(user_id,token_hash,csrf_hash,user_agent,ip_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,now()+($6 || ' days')::interval)`,
    [userId, sha256(token), sha256(csrf), ua, sha256(ip), String(env.sessionDays)]);
  return { token, csrf };
}

// ВНИМАНИЕ: 'None', а не 'Lax'. В браузерном Telegram мини-апп живёт в iframe на
// web.telegram.org, то есть запросы к нашему API — кросс-сайтовые. При 'Lax' браузер
// НЕ сохраняет куку сессии -> /auth/session отдаёт 401 -> клиент падает в гостя ->
// у гостя нет telegram-identity -> /api/v1/teacher/classes = 403 -> кабинет учителя
// не открывается вообще. Это разбиралось по логам 25.07.2026 (8x200/8x401 на
// auth/session, 20/20 отказов на teacher/classes) и правилось руками на бою.
// НЕ возвращай 'Lax' — сломается браузерный Telegram.
//
// Почему 'None' здесь безопасен: кука не является единственным доказательством
// намерения. Мутации требуют CSRF double-submit (ege_csrf читается JS и повторяется
// заголовком, см. requireCsrf) плюс проверка Origin. Чужой сайт может отправить
// куку, но не может прочитать её значение из-за same-origin policy, поэтому
// заголовок подделать не сможет.
const SESSION_SAME_SITE = 'None';

function sessionCookies(session) {
  return [
    cookie(env.sessionCookie, session.token, { maxAge: SESSION_SECONDS, httpOnly: true, secure: true, sameSite: SESSION_SAME_SITE }),
    cookie(env.csrfCookie, session.csrf, { maxAge: SESSION_SECONDS, httpOnly: false, secure: true, sameSite: SESSION_SAME_SITE }),
  ];
}

function clearSessionCookies() {
  return [
    cookie(env.sessionCookie, '', { maxAge: 0, httpOnly: true, secure: true, sameSite: SESSION_SAME_SITE }),
    cookie(env.csrfCookie, '', { maxAge: 0, httpOnly: false, secure: true, sameSite: SESSION_SAME_SITE }),
  ];
}

async function getSession(req, { touch = true } = {}) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[env.sessionCookie];
  if (!raw) return null;
  const result = await pool.query(`SELECT s.id,s.user_id,s.csrf_hash,s.expires_at
    FROM user_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.disabled_at IS NULL`, [sha256(raw)]);
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (touch) pool.query('UPDATE user_sessions SET last_seen_at=now() WHERE id=$1', [row.id]).catch(() => {});
  const user = await loadUser(row.user_id);
  if (!user) return null;
  return { id: row.id, userId: row.user_id, csrfHash: row.csrf_hash, user, cookies };
}

// 🔴 Продление живой сессии вместо выдачи новой. Клиент дёргает /auth/telegram при
// КАЖДОМ запуске приложения, а тот всегда звал replaceSession: старая сессия
// отзывалась, создавалась новая. В базе за неделю накопилось 1180 сессий, у одного
// ученика — 248 (норма 1–3). Беда не в объёме таблицы, а в ОКНЕ между «отозвали
// старую» и «браузер принял новую куку»: попавшие в него запросы получают 401/403,
// а на айфонах, где куки живут по более жёстким правилам, лишний цикл входа — это
// лишний шанс остаться вообще без сессии. Тому же человеку продлеваем то, что есть.
async function extendSession(sessionId) {
  await pool.query(
    `UPDATE user_sessions SET expires_at = now()+($2 || ' days')::interval, last_seen_at = now()
     WHERE id = $1`,
    [sessionId, String(env.sessionDays)]);
}

async function revokeSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[env.sessionCookie];
  if (raw) await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1', [sha256(raw)]);
}

function csrfValid(req, session) {
  if (!session) return false;
  const origin = String(req.headers.origin || '');
  if (!originAllowed(origin)) return false;
  const raw = String(req.headers['x-csrf-token'] || '');
  return !!raw && sha256(raw) === session.csrfHash && raw === session.cookies[env.csrfCookie];
}

function userForClient(user) {
  return {
    uid: user.uid,
    canonicalDocId: user.canonicalDocId,
    displayName: user.displayName,
    email: user.email,
    isAnonymous: user.isAnonymous,
    providerData: user.providerData,
  };
}

async function createGuest(req, existingSession = null) {
  if (existingSession) return { session: null, user: existingSession.user };
  const subject = `guest_${randomToken(18)}`;
  const userId = await resolveIdentity({ provider: 'guest', subject });
  const session = await createSession(userId, req);
  return { session, user: await loadUser(userId) };
}

// 🔴 Google-вход обязан вернуться НА ТОТ ЖЕ ХОСТ, с которого ушёл.
// Кука сессии принадлежит хосту, который её выдал. Пока приложение было одно,
// адрес можно было держать константой; с появлением обществознания на отдельном
// поддомене константа стала ошибкой: ученик уходит с obschestvo.*, callback
// приходит на reshay-istoriyu.ru, кука ложится туда — и человек возвращается на
// обществознание по-прежнему не вошедшим, без единого сообщения об ошибке.
//
// Хост берётся из запроса, но только если он есть в закрытом списке
// разрешённых: Host приходит от клиента, и доверять ему без проверки нельзя —
// иначе чужой Host увёл бы OAuth-callback на чужой адрес.
function originForRequest(req) {
  const host = String((req && req.headers && req.headers.host) || '').trim();
  const candidate = `https://${host}`;
  return host && allowedOrigins.has(candidate) ? candidate : env.publicOrigin;
}

function googleRedirectUri(req) {
  const origin = originForRequest(req);
  // Основной адрес истории оставляем ровно таким, каким он настроен в консоли
  // Google: там может быть указан путь, отличный от нашего шаблона.
  if (origin === env.publicOrigin) return env.googleRedirectUri;
  return `${origin}/api/v1/auth/google/callback`;
}

async function createGoogleStart(currentSession, returnTo, redirectUri) {
  if (!env.googleClientId || !env.googleClientSecret) throw new Error('google_not_configured');
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = base64url(require('crypto').createHash('sha256').update(verifier).digest());
  await pool.query(`INSERT INTO oauth_states(state_hash,user_id,verifier,return_to,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
    [sha256(state), currentSession ? currentSession.userId : null, verifier, returnTo]);
  const oauth = new OAuth2Client(env.googleClientId, env.googleClientSecret, redirectUri || env.googleRedirectUri);
  return oauth.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
}

async function finishGoogle(req, code, state, redirectUri) {
  const stateResult = await pool.query('DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING *', [sha256(state)]);
  if (!stateResult.rowCount) throw new Error('oauth_state_invalid');
  const oauthState = stateResult.rows[0];
  // redirect_uri при обмене кода обязан ДОСЛОВНО совпадать с тем, что уходил в
  // запросе авторизации, иначе Google отвечает redirect_uri_mismatch. Callback
  // приходит на тот же хост, поэтому вычисляем его из запроса тем же способом.
  const uri = redirectUri || env.googleRedirectUri;
  const oauth = new OAuth2Client(env.googleClientId, env.googleClientSecret, uri);
  const tokenResult = await oauth.getToken({ code, codeVerifier: oauthState.verifier, redirect_uri: uri });
  const idToken = tokenResult.tokens.id_token;
  if (!idToken) throw new Error('google_id_token_missing');
  const ticket = await oauth.verifyIdToken({ idToken, audience: env.googleClientId });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email_verified) throw new Error('google_identity_invalid');
  const userId = await resolveIdentity({
    provider: 'google', subject: payload.sub, displayName: payload.name || '', email: payload.email || '',
    profile: { name: payload.name || '', picture: payload.picture || '' }, linkUserId: oauthState.user_id,
    // Почту подтвердил сам Google (проверка `email_verified` строкой выше),
    // поэтому по ней можно найти аккаунт эпохи Firebase — см. комментарий
    // у findLegacyAccountByEmail. Для остальных провайдеров этого делать нельзя.
    linkByVerifiedEmail: true,
  });
  const session = await createSession(userId, req);
  return { session, user: await loadUser(userId), returnTo: oauthState.return_to || '/' };
}

module.exports = {
  canonicalFor, mergeUsers, resolveIdentity, loadUser, createSession, sessionCookies, clearSessionCookies,
  getSession, revokeSession, extendSession, csrfValid, userForClient, createGuest, createGoogleStart, finishGoogle,
  claimLegacyDocument, originForRequest, googleRedirectUri,
};
