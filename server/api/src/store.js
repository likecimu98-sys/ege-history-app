'use strict';

const { EventEmitter } = require('events');
const { pool, tx } = require('./db');
const { canonicalFor } = require('./auth');
const { mergeStateJson } = require('./state-merge');
const { sha256 } = require('./crypto');

const COLLECTIONS = Object.freeze({
  students: 'student_profiles',
  state: 'student_states',
  teachers: 'teacher_profiles',
  orgs: 'organizations',
  classes: 'classes',
  matches: 'duel_matches',
  loginTokens: 'login_tokens',
  loginSessions: 'login_sessions',
  notifyJobs: 'notification_jobs',
  config: 'app_config',
  leaderboards: 'leaderboards',
});

// ⚠️ ИСТОРИЧЕСКОЕ. Этот перечень назывался «публичным», но публичным он быть не
// может: name + username + classCode — это персональные данные несовершеннолетних.
// До 26.07.2026 любая гостевая сессия одним query получала по нему весь реестр
// учеников. Теперь посторонний не получает строку НИ В КАКОМ режиме (см.
// authorizeRead, case 'students'), а перечень остался только как проекция для
// внутренних нужд. Публичный рейтинг отдаёт отдельный серверный эндпоинт
// GET /api/v1/leaderboards со своей, более узкой проекцией — без username и
// без classCode. Не расширяй этот набор и не возвращай его в открытое чтение.
const PUBLIC_STUDENT_FIELDS = new Set([
  'name', 'username', 'classCode', 'totalSolved', 'egePoints', 'weeklyScore', 'weeklyEgePoints',
  'weekStartStr', 'duelRating', 'duelElo', 'duelGames', 'duelWins', 'duelLosses', 'duelDraws', 'lastActive'
]);

// Матч в списке ожидания виден всем — иначе некого вызывать на дуэль. Но uid
// игрока — это Telegram ID, и раздавать его посторонним нельзя. Клиенту от чужого
// матча нужны только имя, рейтинг и ответ на вопрос «это мой собственный вызов?»,
// который сервер считает сам (поле self) — см. publicMatch.
// aliveAt — отметка «ищущий ещё здесь». Поиск соперника стал фоновым и
// бесконечным (решение владельца 14.08.2026): человек продолжает заниматься, а
// вызов висит, пока он сам не отменит. Без этой отметки отличить ждущего от
// закрывшего вкладку нечем — клиент считал брошенным всё старше 45 секунд и
// удалял, поэтому «бесконечный» поиск умирал бы через минуту.
const PUBLIC_MATCH_FIELDS = ['status', 'mode', 'createdAt', 'startTime', 'swipeSections', 'aliveAt'];

// 🔴 Поля, с которыми ученик имеет право СОЗДАТЬ матч. Перечень белый и строгий:
// лишнее поле отвергает запрос ЦЕЛИКОМ, а не вырезается.
//
// Ровно поэтому он ломает дуэли молча. 01.08.2026 в логах — 12 отказов за день
// на `matches/<id> [status,mode,matchRounds,...] mode=create`: клиент научился
// режиму «подбор» (task #25) и стал слать `matchRounds` с колодой раундов, а
// здесь этого поля не было. Итог: выпал режим «подбор» — дуэль не создаётся
// вообще, ученик жмёт «Дуэли» и не получает ничего. Никакой ошибки на экране,
// в логе безымянное `forbidden` — заметили только по расшифровке отказов.
//
// ⚠️ Добавляешь поле в создание матча на клиенте (cloud-sync.js, объект нового
// матча) — добавь его и сюда. Договор закреплён тестом store-match-fields.
const MATCH_CREATE_FIELDS = new Set([
  'status', 'mode', 'swipeSections', 'matchRounds', 'createdAt', 'player1', 'player2', 'startTime',
]);

// Сколько длится матч в каждом режиме — держать в согласии с клиентом:
// SWIPE_DUEL_MS (swipe-mode.js), MATCH_DUEL_MS (match-mode.js),
// CLASSIC_DUEL_MS (modes.js). Незнакомый режим получает самый долгий срок:
// ошибиться в сторону «дали доиграть» безопаснее, чем оборвать живой матч.
const DUEL_DURATION_MS = Object.freeze({ swipe: 45000, match: 45000, classic: 60000 });
const DUEL_MAX_DURATION_MS = 60000;
// Запас поверх длительности. Закрывающая запись идёт уже после таймера:
// 400 мс на «Считаем очки…», до шести попыток finalizeDuelScores по 400 мс,
// плюс сеть. Минуты хватает с большим избытком, и при этом она не позволяет
// «доигрывать» — ровно та жалоба, с которой начался этот замок.
const DUEL_WRITE_GRACE_MS = 60000;
function duelWriteWindowOver(before) {
  const startedAt = Number(before?.playingAt);
  // Матч не начинался или это старая запись без серверной отметки — не мешаем.
  if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
  const dur = DUEL_DURATION_MS[String(before?.mode || '')] || DUEL_MAX_DURATION_MS;
  return Date.now() > startedAt + dur + DUEL_WRITE_GRACE_MS;
}

// Документ класса читает и учитель, и УЧЕНИК этого класса: в нём лежит журнал ДЗ
// (pullClassAssignments), граница «дошли до года» и признак безлимита. Поэтому
// «читать может только учитель» было бы тихой поломкой всей выдачи домашних
// заданий. Ученику отдаём только эти поля, всё остальное — учителю класса.
const STUDENT_VISIBLE_CLASS_FIELDS = new Set([
  'assignments', 'revokedAssignments', 'revokeBefore', 'currentUpto', 'currentPeriod', 'unlimited', 'updatedAt',
  // secondPart — включена ли у класса вторая часть ЕГЭ («Проверочная»).
  // 🔴 Поле обязано быть в ЭТОМ списке, иначе до ученика оно не доедет: не с
  // ошибкой, а молча, и вкладка «Домашка» просто никогда не покажет раздел.
  'secondPart'
]);

// Совпадает с _classDocId в cloud-sync.js: код класса и есть id документа.
function classDocId(raw) {
  return String(raw == null ? '' : raw).trim().replace(/[/#?%]/g, '_');
}
const TEACHER_STUDENT_WRITE_FIELDS = new Set([
  'pendingAssignments', 'revokedAssignments', 'inviteClassCode', 'inviteAt', 'leftClassAt', 'classCode',
  '_mergedInto', '_mergedAt', '_mergedFrom'
]);

function parsePath(raw) {
  const path = String(raw || '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  if (parts.length !== 6 || parts[0] !== 'artifacts' || parts[2] !== 'public' && parts[2] !== 'private' || parts[3] !== 'data') {
    const error = new Error('invalid_document_path');
    error.statusCode = 400;
    throw error;
  }
  const collection = parts[4];
  const table = COLLECTIONS[collection];
  if (!table) {
    const error = new Error('unknown_collection');
    error.statusCode = 400;
    throw error;
  }
  if (collection === 'state' && parts[2] !== 'private') throw Object.assign(new Error('invalid_state_path'), { statusCode: 400 });
  if (collection !== 'state' && parts[2] !== 'public') throw Object.assign(new Error('invalid_visibility'), { statusCode: 400 });
  if (!parts[5] || parts[5].length > 500) throw Object.assign(new Error('invalid_document_id'), { statusCode: 400 });
  return { path, appId: parts[1], visibility: parts[2], collection, table, docId: parts[5] };
}

function collectionFromPath(raw) {
  const path = String(raw || '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/');
  if (parts.length !== 5) throw Object.assign(new Error('invalid_collection_path'), { statusCode: 400 });
  return parsePath(`${path}/_query_`);
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function opKind(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value.__vpsOp : null;
}

function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function protectTeacherClassAssignment(currentData, patch, isSelfWrite) {
  const next = { ...(patch || {}) };
  if (!isSelfWrite) return next;

  // The class invite is teacher-owned state. A student's normal progress sync
  // must not clear or replace it, even if the first device save races the
  // initial profile load. Internal bot and teacher writes bypass this helper.
  delete next.inviteClassCode;
  delete next.inviteAt;
  delete next.leftClassAt;
  if (currentData && Object.prototype.hasOwnProperty.call(currentData, 'inviteClassCode')
      && Object.prototype.hasOwnProperty.call(next, 'classCode')) {
    next.classCode = String(currentData.inviteClassCode || '');
  }
  return next;
}

// Поля документа ученика, которые ДАЮТ ПРАВА, а не описывают прогресс. Ставить их
// имеет право только бот (`internal`) или админ.
//
// ⚠️ Зачем это существует. `authorizeWrite`, case 'students' на свой документ
// отвечает безусловным `true` — то есть до этой правки ученик мог одним запросом
// PUT со своим же docId записать себе `premium: true`, а `quota.js` читает премиум
// ровно оттуда (`student_profiles.data.premium || premiumAuto`). Дневной лимит
// обходился без DevTools и без правки JS, а любая будущая биллинг-интеграция,
// сверяющаяся с этим же флагом, обходилась бы вместе с ним.
//
// Почему СПИСОК ЗАПРЕЩЁННЫХ, а не разрешённых: клиент пишет в свой профиль
// открытый и растущий набор полей (`syncProgressToCloud`, слияние личностей,
// tombstone `_mergedInto`, `syncPin` для входа с компьютера). Белый список,
// отставший от клиента на одно поле, молча перестал бы сохранять прогресс — а это
// та самая тихая потеря данных, которая дороже самой дыры. Запрет узкий и точный.
//
// Поля не отвергаются с 403, а ВЫРЕЗАЮТСЯ из патча: обычный клиент их не шлёт
// вовсе, так что 403 означал бы подделку, но ценой был бы отказ всей записи
// прогресса. Молча выкинуть лишнее — безопаснее для честного пользователя.
const PRIVILEGED_STUDENT_FIELDS = ['premium', 'premiumAuto', 'unlimited', 'role', 'isAdmin'];

function stripPrivilegedFields(patch, isSelfWrite) {
  if (!isSelfWrite || !patch) return patch;
  let next = null;
  for (const field of PRIVILEGED_STUDENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (!next) next = { ...patch };
    delete next[field];
  }
  return next || patch;
}

function applyPatch(current, patch, merge) {
  const target = merge ? { ...(current || {}) } : {};
  for (const [key, raw] of Object.entries(patch || {})) {
    const kind = opKind(raw);
    if (kind === 'delete') { delete target[key]; continue; }
    if (kind === 'arrayUnion') {
      const arr = Array.isArray(target[key]) ? [...target[key]] : [];
      for (const value of raw.values || []) if (!arr.some(item => sameValue(item, value))) arr.push(clone(value));
      target[key] = arr;
      continue;
    }
    if (kind === 'arrayRemove') {
      const remove = raw.values || [];
      target[key] = (Array.isArray(target[key]) ? target[key] : []).filter(item => !remove.some(value => sameValue(item, value)));
      continue;
    }
    target[key] = clone(raw);
  }
  return target;
}

function publicStudent(data) {
  const out = {};
  for (const key of PUBLIC_STUDENT_FIELDS) if (data && data[key] !== undefined) out[key] = data[key];
  return out;
}

function publicMatch(data, ctx) {
  const out = {};
  for (const key of PUBLIC_MATCH_FIELDS) if (data && data[key] !== undefined) out[key] = data[key];
  for (const key of ['player1', 'player2']) {
    if (!data || data[key] === undefined) continue;
    const player = data[key];
    // null сохраняем как null: клиент по «player2 === null» понимает, что слот свободен.
    if (!player) { out[key] = null; continue; }
    out[key] = {
      name: String(player.name || ''),
      elo: Number(player.elo) || 1000,
      // Раньше клиент отличал свой вызов сравнением player1.uid с собственным uid.
      // Ответ на этот вопрос сервер знает и без выдачи чужого Telegram ID.
      self: ownMatchActor(ctx, player),
    };
  }
  return out;
}

function studentClassView(data) {
  const out = {};
  for (const key of STUDENT_VISIBLE_CLASS_FIELDS) if (data && data[key] !== undefined) out[key] = data[key];
  return out;
}

// Проекция по коллекции. Возвращает null там, где урезанного вида не существует —
// такой документ посторонний не получает вовсе.
function projectDocument(collection, data, ctx) {
  if (collection === 'students') return publicStudent(data);
  if (collection === 'matches') return publicMatch(data, ctx);
  if (collection === 'classes') return studentClassView(data);
  return null;
}

function classCodes(raw) {
  return (Array.isArray(raw) ? raw : []).map(value => typeof value === 'string' ? value : value && value.code).filter(Boolean).map(String);
}

async function accessContext(session, client = pool) {
  if (!session || !session.user) return null;
  const docIds = new Set();
  for (const identity of session.user.identities || []) docIds.add(canonicalFor(identity.provider, identity.subject));
  if (session.user.canonicalDocId) docIds.add(session.user.canonicalDocId);
  const owned = await client.query('SELECT doc_id FROM student_profiles WHERE user_id=$1 UNION SELECT doc_id FROM student_states WHERE user_id=$1', [session.userId]);
  for (const row of owned.rows) docIds.add(row.doc_id);

  const telegramIds = (session.user.identities || []).filter(i => i.provider === 'telegram').map(i => String(i.subject));
  let teacher = null;
  if (telegramIds.length) {
    const result = await client.query('SELECT doc_id,data FROM teacher_profiles WHERE doc_id=ANY($1::text[]) LIMIT 1', [telegramIds]);
    if (result.rowCount) teacher = { docId: result.rows[0].doc_id, data: result.rows[0].data || {} };
  }
  const admin = telegramIds.some(id => require('./env').env.adminTelegramIds.has(id)) || teacher?.data?.role === 'admin';
  const role = admin ? 'admin' : (teacher?.data?.role || (teacher ? 'solo' : 'student'));
  let classes = new Set(classCodes(teacher?.data?.classes));
  const orgId = teacher?.data?.orgId ? String(teacher.data.orgId) : '';
  if (role === 'org_owner' && orgId) {
    const peers = await client.query("SELECT data FROM teacher_profiles WHERE data->>'orgId'=$1", [orgId]);
    for (const peer of peers.rows) for (const code of classCodes(peer.data.classes)) classes.add(code);
  }

  // Классы, в которых состоит сам пользователь как УЧЕНИК. Нужны, чтобы он мог
  // прочитать журнал ДЗ своего класса и не мог — чужого. inviteClassCode учитываем
  // наравне с classCode: между приглашением учителя и первой синхронизацией
  // ученика код живёт именно там, и без этого первый вход остался бы без домашки.
  const ownClasses = new Set();
  if (docIds.size) {
    const profiles = await client.query(
      `SELECT data->>'classCode' AS code, data->>'inviteClassCode' AS invite
       FROM student_profiles WHERE user_id=$1 OR doc_id=ANY($2::text[])`,
      [session.userId, [...docIds]]);
    for (const row of profiles.rows) {
      if (row.code) ownClasses.add(classDocId(row.code));
      if (row.invite) ownClasses.add(classDocId(row.invite));
    }
  }
  ownClasses.delete('');

  return { userId: session.userId, user: session.user, docIds, telegramIds, teacher, admin, role, classes, ownClasses, orgId };
}

async function targetStudent(client, docId) {
  const result = await client.query('SELECT doc_id,user_id,data,version FROM student_profiles WHERE doc_id=$1', [docId]);
  return result.rows[0] || null;
}

function teacherCanSeeStudent(ctx, student) {
  if (!ctx || !student) return false;
  if (ctx.admin) return true;
  return !!ctx.teacher && ctx.classes.has(String(student.data?.classCode || ''));
}

async function authorizeRead(client, ref, ctx, row, { query = false } = {}) {
  if (!ctx) return { ok: false };
  if (ctx.admin) return { ok: true, full: true };
  switch (ref.collection) {
    case 'students':
      if (ctx.docIds.has(ref.docId) || row?.user_id === ctx.userId) return { ok: true, full: true };
      if (teacherCanSeeStudent(ctx, row)) return { ok: true, full: true };
      // ⚠️ Здесь стояло `return query ? { ok: true, full: false } : { ok: false }`.
      // То есть в режиме query посторонняя строка отдавалась как «публичная», и
      // любой гость одним запросом получал весь реестр учеников с ФИО, @username
      // и кодом класса. Посторонний не получает строку НИ В КАКОМ режиме.
      // Публичный рейтинг живёт в GET /api/v1/leaderboards, а не здесь.
      return { ok: false };
    case 'state': {
      if (ctx.docIds.has(ref.docId) || row?.user_id === ctx.userId) return { ok: true, full: true };
      return { ok: teacherCanSeeStudent(ctx, await targetStudent(client, ref.docId)), full: true };
    }
    case 'teachers':
      if (ctx.telegramIds.includes(ref.docId)) return { ok: true, full: true };
      if (ctx.role === 'org_owner' && ctx.orgId && row?.data?.orgId === ctx.orgId) return { ok: true, full: true };
      return { ok: false };
    case 'orgs':
      return { ok: !!ctx.teacher && (ctx.orgId === ref.docId || ctx.role === 'org_owner'), full: true };
    case 'notifyJobs':
      return { ok: false };
    case 'loginTokens':
      return { ok: false };
    case 'loginSessions':
      return { ok: row?.user_id === ctx.userId, full: true };
    case 'classes': {
      // Полный документ — учителю этого класса (условие как в authorizeWrite).
      if (!!ctx.teacher && (ctx.classes.has(ref.docId) || ctx.role === 'org_owner')) return { ok: true, full: true };
      // Ученику своего класса — только журнал ДЗ и границы потока (studentClassView).
      if (ctx.ownClasses.has(ref.docId)) return { ok: true, full: false };
      return { ok: false };
    }
    case 'matches': {
      // Полный документ (с uid игроков) — только участникам матча.
      const data = row?.data || {};
      if (ownMatchActor(ctx, data.player1) || ownMatchActor(ctx, data.player2)) return { ok: true, full: true };
      // Остальным — карточка вызова без uid, чтобы было кого вызвать на дуэль.
      return { ok: true, full: false };
    }
    case 'config':
      // Настройки приложения: лимиты, ссылка на клуб, тексты. ПД не содержат,
      // запись запрещена всем (authorizeWrite) — читать может кто угодно.
      return { ok: true, full: true };
    case 'leaderboards':
      // Пишет только сервер (authorizeWrite запрещает запись всем).
      return { ok: true, full: true };
    default:
      return { ok: false };
  }
}

// Право ПЕРЕЧИСЛИТЬ коллекцию — отдельно от права прочитать строку. Построчная
// фильтрация вернула бы постороннему пустой список, и это выглядело бы как «просто
// нет данных»; для реестра детей честнее ответить отказом. Ученику перечисление
// не нужно ни для чего: рейтинг отдаёт GET /api/v1/leaderboards, свои документы
// читаются по id, связывание аккаунтов — GET /api/v1/me/linked-documents.
function authorizeCollectionQuery(ref, ctx) {
  if (!ctx) return false;
  if (ctx.admin) return true;
  if (ref.collection === 'students') return !!ctx.teacher;
  return true;
}

function ownMatchActor(ctx, player) {
  return !!player && ctx.docIds.has(String(player.uid || ''));
}

function mergeMatchData(current, next, patch) {
  if (!current) return next;
  const statusRank = { waiting: 1, playing: 2, finished: 3 };
  if ((statusRank[current.status] || 0) > (statusRank[next.status] || 0)) next.status = current.status;
  if (Number(current.startTime) > 0 && Number(next.startTime) !== Number(current.startTime)) next.startTime = current.startTime;
  // 🔴 Момент начала матча ПО ЧАСАМ СЕРВЕРА, а не по startTime.
  //
  // startTime приходит от клиента, который присоединился к матчу, и сверять с ним
  // конец дуэли нельзя: у школьника со сбитыми часами (а таких хватает) сервер
  // рвал бы концовку собственных матчей — законные записи счёта улетали бы в 403.
  // Поэтому отметку ставит сервер, один раз, при переходе в playing; дальше она
  // переживает любые merge и служит единственной точкой отсчёта для DUEL_MAX_MS.
  if (Number(current.playingAt) > 0) next.playingAt = current.playingAt;
  else if (next.status === 'playing' && current.status !== 'playing') next.playingAt = Date.now();
  for (const key of ['player1', 'player2']) {
    if (!patch?.[key] || !current[key] || !next[key] || String(current[key].uid || '') !== String(next[key].uid || '')) continue;
    const before = current[key];
    const candidate = { ...next[key] };
    const beforeSeq = Number(before.seq);
    const candidateSeq = Number(candidate.seq);
    if (Number.isFinite(beforeSeq) && Number.isFinite(candidateSeq) && candidateSeq <= beforeSeq) {
      next[key] = before;
      continue;
    }
    if (!Number.isFinite(candidateSeq) && Number(candidate.score) < Number(before.score)) candidate.score = before.score;
    if (before.final) candidate.final = true;
    for (const counter of ['done', 'correct']) {
      if (Number(before[counter]) > Number(candidate[counter])) candidate[counter] = before[counter];
    }
    next[key] = candidate;
  }
  return next;
}

// 🔴 ЗАМОК НА ОЧИСТКУ ВЫДАЧИ ДЗ.
//
// Ученик забирает домашку из `pendingAssignments` и сразу просит сервер снять её с
// документа. Если между «забрал» и «сохранил состояние» что-то пошло не так —
// задание исчезает НАВСЕГДА: в выдаче пусто, в состоянии пусто, повторить нечем.
// Ровно так 01.08.2026 терялись задания у Султана, Веры и Тушинского Вора.
//
// Клиентские причины (безусловная очистка, затирание списка при слиянии) починены,
// но этого мало: в тот же день по логам работали ШЕСТЬ разных версий клиента —
// кэш обновляется не у всех и не сразу, и старая версия продолжает уничтожать
// выдачу. Поэтому правило переносится на сервер, где версия клиента не важна.
//
// Правило: снять запись из выдачи можно, только если это же задание УЖЕ лежит в
// сохранённом состоянии ученика. Не доехало — остаётся в выдаче и придёт снова.
// Повторная выдача безопасна: ingestAssignment на клиенте идемпотентен по id.
//
// ⚠️ Побочный эффект: отозванное учителем задание ученик пропускает при приёмке, в
// состояние оно не попадает — и остаётся висеть в выдаче. Это безвредно (клиент
// его каждый раз отсеивает), и это осознанный размен: лишняя строка в выдаче
// дешевле потерянной домашки.
async function guardPendingAssignments(client, ref, patch, selfStudentWrite) {
  if (!selfStudentWrite || !patch || ref.collection !== 'students') return patch;
  const op = patch.pendingAssignments;
  if (opKind(op) !== 'arrayRemove') return patch;
  const removing = Array.isArray(op.values) ? op.values : [];
  if (!removing.length) return patch;

  let landed = new Set();
  try {
    const state = await client.query('SELECT data FROM student_states WHERE doc_id=$1', [ref.docId]);
    const raw = state.rows[0]?.data?.fullStateJson;
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const a of (parsed?.stats?.assignments || [])) if (a && a.id) landed.add(String(a.id));
    }
  } catch (error) {
    // Состояние не прочиталось/битый JSON — очистку НЕ разрешаем. Ошибаться надо в
    // сторону лишней записи в выдаче, а не потерянного задания.
    console.warn(JSON.stringify({ level: 'warn', event: 'pending.guard.state_unreadable', doc: ref.docId, message: error.message }));
    // Именно delete, а не присваивание undefined: applyPatch обходит ключи объекта и
    // записал бы undefined ЗНАЧЕНИЕМ, стерев выдачу — то есть сделал бы ровно то,
    // от чего этот замок защищает.
    const safe = { ...patch };
    delete safe.pendingAssignments;
    return safe;
  }

  const allowed = removing.filter(rec => rec && rec.id && landed.has(String(rec.id)));
  if (allowed.length === removing.length) return patch;
  console.warn(JSON.stringify({
    level: 'warn', event: 'pending.guard.blocked', doc: ref.docId,
    asked: removing.length, allowed: allowed.length,
  }));
  const next = { ...patch };
  if (allowed.length) next.pendingAssignments = { ...op, values: allowed };
  else delete next.pendingAssignments;
  return next;
}

// Почему отказали, а не только что отказали. Строка `denied` называла коллекцию,
// документ и поля — но по ней всё равно нельзя было понять, кто ломился и какое
// правило сработало.
// 🔴 Разбор 07.08.2026: 44 отказа подряд на `students/8618432261
// [_mergedInto,_mergedAt,knownTgId,googleEmail,knownGoogleId] mode=merge` — и
// определить, чей это был запрос и на каком из двух условий он упал (не свой
// документ / поля вне учительского списка), было нечем. Дописываем ровно то,
// что отвечает на «почему»: владелец ли пишущий, учитель ли он и какие поля
// вышли за учительский белый список. Значений полей по-прежнему НЕ логируем — в
// патче едут ФИО, код класса и кусок состояния ученика.
// ⚠️ Эта функция живёт В ПУТИ ОШИБКИ. Упадёт она — и честный 403 превратится в
// 500: клиент вместо «нельзя» получит «сервер сломался», ученик увидит заставку,
// а в логе окажется stack вместо причины отказа. Поэтому здесь ничего не берётся
// на веру: ни что ctx полный, ни что docIds — это Set. Диагностика не имеет права
// быть опаснее того, что она диагностирует.
function denyContext(ref, ctx, current, patch) {
  try {
    const ids = ctx && ctx.docIds;
    const own = !!ctx && (
      (ids && typeof ids.has === 'function' && ids.has(ref.docId))
      || (!!current?.user_id && current.user_id === ctx.userId));
    const parts = [`актор=${ctx?.userId || 'гость'}`, `свой=${own ? 'да' : 'нет'}`];
    if (ref.collection === 'students') {
      parts.push(`учитель=${ctx?.teacher ? 'да' : 'нет'}`);
      if (!own) {
        const extra = Object.keys(patch || {}).filter(key => !TEACHER_STUDENT_WRITE_FIELDS.has(key));
        if (extra.length) parts.push(`вне_списка_учителя=[${extra.join(',')}]`);
      }
    }
    return parts.join(' ');
  } catch (error) {
    return `контекст отказа не собрался: ${error.message}`;
  }
}

async function authorizeWrite(client, ref, ctx, current, patch, mode, { internal = false } = {}) {
  if (internal || ctx?.admin) return true;
  if (!ctx) return false;
  switch (ref.collection) {
    case 'students': {
      if (ctx.docIds.has(ref.docId) || current?.user_id === ctx.userId) return true;
      if (!teacherCanSeeStudent(ctx, current)) return false;
      return Object.keys(patch || {}).every(key => TEACHER_STUDENT_WRITE_FIELDS.has(key));
    }
    case 'state':
      return ctx.docIds.has(ref.docId) || current?.user_id === ctx.userId;
    case 'classes':
      return !!ctx.teacher && (ctx.classes.has(ref.docId) || ctx.role === 'org_owner');
    case 'matches': {
      const before = current?.data || {};
      if (mode === 'create') {
        const fields = Object.keys(patch || {});
        return patch?.status === 'waiting' && patch?.player2 == null && ownMatchActor(ctx, patch?.player1)
          && fields.every(key => MATCH_CREATE_FIELDS.has(key));
      }
      const player1Own = ownMatchActor(ctx, before.player1);
      const player2Own = ownMatchActor(ctx, before.player2);
      if (mode === 'delete') return player1Own || player2Own;
      if (!player1Own && !player2Own) {
        const fields = Object.keys(patch || {});
        return before.status === 'waiting' && before.player2 == null && patch?.status === 'playing'
          && ownMatchActor(ctx, patch?.player2)
          && fields.every(key => ['status', 'player2', 'startTime'].includes(key));
      }
      const actorKey = player1Own ? 'player1' : 'player2';
      // aliveAt правит только сам ждущий и только у своего матча — это его
      // сердцебиение во время фонового поиска. Ничего, кроме времени, оно не несёт.
      if (!Object.keys(patch || {}).every(key => key === actorKey || key === 'status' || key === 'aliveAt')) return false;
      if (patch?.aliveAt !== undefined && !Number.isFinite(Number(patch.aliveAt))) return false;
      if (patch?.[actorKey] && String(patch[actorKey].uid || '') !== String(before[actorKey]?.uid || '')) return false;
      if (patch?.status && patch.status !== 'finished') return false;
      // ⏱ Очки после конца матча не принимаем. Клиентский таймер — просьба, а не
      // гарантия: он замирает в фоне, его можно остановить отладчиком, и до этого
      // замка ничто не мешало доигрывать матч сколько угодно долго, дописывая счёт
      // уже проигранной дуэли. Закрытие матча (status:'finished') и сердцебиение
      // поиска пропускаем ВСЕГДА: иначе доигранный матч навсегда застрянет в
      // playing — ровно та поломка, которую чинили 12.08.2026.
      if (patch?.[actorKey] !== undefined && duelWriteWindowOver(before)) return false;
      return true;
    }
    case 'loginSessions':
      if (mode === 'delete') return current?.user_id === ctx.userId;
      if (mode !== 'create') return false;
      return patch?.status === 'pending'
        && Number(patch?.exp) > Date.now()
        && Number(patch?.exp) <= Date.now() + 20 * 60 * 1000
        && Object.keys(patch || {}).every(key => ['status', 'createdAt', 'exp'].includes(key));
    case 'loginTokens':
      return false;
    case 'notifyJobs': {
      // 🔴 hw_assigned_bulk ОБЯЗАН быть в списке.
      //
      // Клиент давно рассылает одним заданием на весь класс (так чинили «уведомление
      // зависит от того, дошёл ли цикл по ученикам»), и бот этот тип умеет. А сервер —
      // нет: тип не проходил проверку, запись падала с 403, и уведомлений о новой
      // домашке не получал НИКТО. Разбор 11.08.2026: в тот день ДЗ летней школы легло
      // во входящие 107 ученикам, а заданий рассылки за пять дней — ноль, и ровно один
      // отказ `notifyJobs/... [type,studentIds,...] mode=create`. Учитель при этом
      // видел уведомления и думал, что всё работает: до него доходили hw_done,
      // которые разрешены.
      if (mode !== 'create' || !['hw_assigned', 'hw_assigned_bulk', 'hw_done'].includes(patch?.type)) return false;
      // Массовому заданию нужен запас: в нём список id всего класса.
      const sizeLimit = patch.type === 'hw_assigned_bulk' ? 65536 : 8192;
      if (JSON.stringify(patch || {}).length > sizeLimit) return false;
      if (patch.type === 'hw_assigned') {
        const student = await targetStudent(client, String(patch.studentId || ''));
        return !!ctx.teacher && teacherCanSeeStudent(ctx, student);
      }
      if (patch.type === 'hw_assigned_bulk') {
        if (!ctx.teacher) return false;
        const ids = Array.isArray(patch.studentIds) ? patch.studentIds.map(String) : [];
        if (!ids.length || ids.length > 1000) return false;
        // Одним запросом, а не по ученику в цикле: класс бывает и в полтораста человек.
        const rows = await client.query('SELECT doc_id,user_id,data FROM student_profiles WHERE doc_id=ANY($1::text[])', [ids]);
        const found = new Map(rows.rows.map(row => [String(row.doc_id), row]));
        // Учитель обязан видеть КАЖДОГО адресата: иначе через список чужих id можно
        // было бы разослать что угодно вне своего класса.
        return ids.every(id => teacherCanSeeStudent(ctx, found.get(id)));
      }
      const profiles = await client.query('SELECT doc_id,data FROM student_profiles WHERE user_id=$1 OR doc_id=ANY($2::text[])',
        [ctx.userId, [...ctx.docIds]]);
      const ownClass = profiles.rows.some(row => String(row.data?.classCode || '') === String(patch.classCode || ''));
      const claimedId = String(patch.studentId || '');
      return ownClass && (!claimedId || ctx.telegramIds.includes(claimedId) || ctx.docIds.has(claimedId));
    }
    case 'teachers':
    case 'orgs':
    case 'config':
    case 'leaderboards':
      return false;
    default:
      return false;
  }
}

// ── Трансляция ограничений в SQL ────────────────────────────────────────────
//
// Раньше query() делал `SELECT * FROM <table>` БЕЗ WHERE и LIMIT, тянул все
// строки в Node, проверял права по каждой и только потом фильтровал и резал.
// Замер на проде: 1201 профиль — 928 мс, из них ~500 мс работы в однопоточном
// event loop, то есть на это время сервер не отвечал никому. Индексы
// student_profiles_class_idx и student_profiles_total_idx не использовались ни разу.
//
// ⚠️ ГЛАВНЫЙ ИНВАРИАНТ, не нарушай его при правках:
// SQL-условие здесь — это ПРЕДФИЛЬТР, а не проверка прав. Оно обязано быть
// НЕ СТРОЖЕ, чем authorizeRead, который по-прежнему выполняется для каждой
// вернувшейся строки. Пока это так, ошибка в трансляции может стоить лишнего
// чтения из базы, но не может отдать лишние данные. Сделаешь предфильтр строже
// — молча потеряешь строки, и никакой тест этого не заметит.
//
// По той же причине applyConstraints НЕ убран: он прогоняется поверх результата
// и остаётся источником правды по семантике. Всё, что не переводится точно,
// просто не переводится — и отрабатывает по-старому, в JS.

// Поля, о которых точно известно, что они числовые. Нужны для ORDER BY:
// data->>'field' — это ТЕКСТ, и сортировка по нему лексикографическая, где '9'
// больше '10'. Приводить к numeric вслепую нельзя — на нечисловом значении
// запрос упадёт целиком. Поэтому перечень закрытый, остальное сортируется в JS.
const NUMERIC_SORT_FIELDS = new Set([
  'totalSolved', 'egePoints', 'weeklyScore', 'weeklyEgePoints', 'lastActive',
  'duelRating', 'duelElo', 'duelGames', 'duelWins', 'duelLosses', 'duelDraws',
  'createdAt', 'updatedAt', 'startTime', 'revokeBefore', 'currentUpto',
]);

// Переводим только скаляры. null и undefined исключены намеренно: `data->>'f'`
// для JSON-null даёт SQL NULL, а `NULL = 'null'` — это NULL, то есть строка
// выпала бы, тогда как sameValue(null, null) её оставляет. Предфильтр стал бы
// строже проверки — ровно то, чего нельзя.
function translatableValue(value) {
  const type = typeof value;
  return value !== null && (type === 'string' || type === 'number' || type === 'boolean');
}

// Предфильтр по правам. Повторяет ветки authorizeRead, но в виде SQL и
// заведомо шире: точную проверку всё равно делает authorizeRead построчно.
function rightsPrefilter(ref, ctx, params) {
  if (!ctx || ctx.admin) return null;

  // ⚠️ Параметры попадают в params ТОЛЬКО если мы действительно вернём условие.
  // Раньше они добавлялись сразу, а для коллекций, где сужать права нечем
  // (матчи, конфиг), функция возвращала null — и запрос уезжал в PostgreSQL с
  // параметрами, которых нет в тексте запроса. Вывести их тип база не может и
  // отвечает 42P18 «could not determine data type of parameter $1», роняя запрос
  // целиком. Так поиск соперника в дуэлях пролежал шесть часов 27.07.2026.
  const staged = [];
  const bind = value => { staged.push(value); return `$${params.length + staged.length}`; };

  const own = [];
  if (ctx.docIds.size) own.push(`doc_id = ANY(${bind([...ctx.docIds])}::text[])`);
  own.push(`user_id = ${bind(ctx.userId)}`);

  let predicate = null;
  if (ref.collection === 'students') {
    // Учитель видит свой класс И свои собственные документы — второе легко
    // потерять, если оставить только фильтр по классу.
    if (ctx.classes && ctx.classes.size) {
      own.push(`data->>'classCode' = ANY(${bind([...ctx.classes])}::text[])`);
    }
    predicate = `(${own.join(' OR ')})`;
  } else if (ref.collection === 'state') {
    predicate = `(${own.join(' OR ')})`;
  }
  // Матчи и конфиг читаются всеми (с проекцией) — сужать нечем.

  if (!predicate) return null;
  params.push(...staged);
  return predicate;
}

function buildQueryPlan(ref, ctx, constraints, internal) {
  const params = [];
  const where = [];

  if (!internal) {
    const rights = rightsPrefilter(ref, ctx, params);
    if (rights) where.push(rights);
  }

  for (const constraint of constraints || []) {
    if (constraint.type !== 'where' || constraint.op !== '==') continue;
    if (!constraint.field || !translatableValue(constraint.value)) continue;
    params.push(String(constraint.field));
    const field = `$${params.length}`;
    params.push(String(constraint.value));
    // Имя поля тоже параметр — в SQL из запроса клиента не попадает ни байта.
    where.push(`data->>${field} = $${params.length}`);
  }

  const order = (constraints || []).find(c => c.type === 'orderBy');
  const limit = Math.min(5000, Math.max(0, Number((constraints || []).find(c => c.type === 'limit')?.count) || 500));

  let orderSql = '';
  let limitSql = '';
  if (order && NUMERIC_SORT_FIELDS.has(order.field)) {
    params.push(String(order.field));
    // NULLS LAST в обе стороны — так же, как сортирует applyConstraints.
    orderSql = ` ORDER BY (data->>$${params.length})::numeric ${order.direction === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
    limitSql = ` LIMIT ${limit}`;
  } else if (!order) {
    limitSql = ` LIMIT ${limit}`;
  }
  // Есть orderBy по нетабличному полю — сортировать и резать будет JS, иначе
  // LIMIT отрезал бы не те строки.

  const sql = `SELECT doc_id,user_id,data,version FROM ${ref.table}`
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + orderSql + limitSql;
  return { sql, params };
}

function filterValue(value, op, expected) {
  if (op === '==') return sameValue(value, expected);
  if (op === '>=') return value >= expected;
  if (op === '<=') return value <= expected;
  if (op === '>') return value > expected;
  if (op === '<') return value < expected;
  return false;
}

function applyConstraints(rows, constraints) {
  let out = rows;
  for (const c of constraints || []) {
    if (c.type === 'where') out = out.filter(row => filterValue(row.data?.[c.field], c.op, c.value));
  }
  const order = (constraints || []).find(c => c.type === 'orderBy');
  if (order) {
    const dir = order.direction === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a.data?.[order.field], bv = b.data?.[order.field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }
  const cap = Math.min(5000, Math.max(0, Number((constraints || []).find(c => c.type === 'limit')?.count) || 500));
  return out.slice(0, cap);
}

class DocumentStore extends EventEmitter {
  async get(path, session, options = {}) {
    const ref = parsePath(path);
    const client = options.client || pool;
    const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1`, [ref.docId]);
    if (!result.rowCount) return { exists: false, id: ref.docId, data: null, version: 0 };
    const row = result.rows[0];
    const ctx = options.context || await accessContext(session, client);
    const access = options.internal ? { ok: true, full: true } : await authorizeRead(client, ref, ctx, row);
    if (!access.ok) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    if (access.full) return { exists: true, id: ref.docId, data: row.data, version: Number(row.version) };
    // Проекция была жёстко зашита на publicStudent, поэтому урезанное чтение любой
    // другой коллекции молча отдавало бы студенческие поля. Теперь вид выбирается
    // по коллекции, а её отсутствие — это отказ, а не пустой объект.
    const projected = projectDocument(ref.collection, row.data, ctx);
    if (!projected) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    return { exists: true, id: ref.docId, data: projected, version: Number(row.version) };
  }

  async query(path, constraints, session, options = {}) {
    const ref = collectionFromPath(path);
    const client = options.client || pool;
    const ctx = options.context || await accessContext(session, client);
    if (!ctx && !options.internal) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    if (!options.internal && !authorizeCollectionQuery(ref, ctx)) {
      throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    }
    const plan = buildQueryPlan(ref, ctx, constraints, options.internal);
    const result = await client.query(plan.sql, plan.params);
    const rows = [];
    for (const row of result.rows) {
      const rowRef = { ...ref, docId: row.doc_id };
      const access = options.internal ? { ok: true, full: true } : await authorizeRead(client, rowRef, ctx, row, { query: true });
      if (!access.ok) continue;
      if (access.full) { rows.push(row); continue; }
      const projected = projectDocument(ref.collection, row.data, ctx);
      if (!projected) continue;
      // id матча нужен, чтобы к нему присоединиться, и сам по себе он случайный.
      // А вот id ученика — это Telegram ID, его подменяем на непрослеживаемый.
      const docId = ref.collection === 'students' ? `public_${sha256(row.doc_id).slice(0, 20)}` : row.doc_id;
      rows.push({ ...row, doc_id: docId, data: projected });
    }
    return applyConstraints(rows, constraints).map(row => ({ id: row.doc_id, data: row.data, version: Number(row.version) }));
  }

  async write(path, patch, mode, session, options = {}) {
    const ref = parsePath(path);
    const execute = async client => {
      const ctx = options.context || await accessContext(session, client);
      const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1 FOR UPDATE`, [ref.docId]);
      const current = result.rows[0] || null;
      const actualMode = current ? mode : 'create';
      const selfStudentWrite = ref.collection === 'students' && !options.internal && !ctx?.admin && !!ctx
        && (ctx.docIds.has(ref.docId) || (!!current?.user_id && current.user_id === ctx.userId));
      const effectivePatch = await guardPendingAssignments(client, ref, stripPrivilegedFields(
        protectTeacherClassAssignment(current?.data || null, patch, selfStudentWrite), selfStudentWrite),
        selfStudentWrite);
      if (!await authorizeWrite(client, ref, ctx, current, effectivePatch, actualMode, options)) {
        // 🔴 Говорим, ЧТО именно запретили. Раньше в лог уходило голое `forbidden`
        // без коллекции и документа: 01.08.2026 в логах висело 47 таких отказов за
        // день, и понять, теряет ли из-за них ученик прогресс или это безобидная
        // попытка записи чужого документа, было НЕЧЕМ. Разбор пришлось вести
        // гаданием по коду.
        // ⚠️ Только коллекция, id документа и имена полей — без значений: в патче
        // едут ФИО, код класса и кусок состояния ученика.
        const denied = `${ref.collection}/${ref.docId} [${Object.keys(effectivePatch || {}).join(',') || 'без полей'}] mode=${actualMode}`
          + ` ${denyContext(ref, ctx, current, effectivePatch)}`;
        throw Object.assign(new Error('forbidden'), { statusCode: 403, deniedRef: denied });
      }
      if (mode === 'update' && !current) throw Object.assign(new Error('not_found'), { statusCode: 404 });
      const conflictMerged = options.expectedVersion !== undefined
        && Number(options.expectedVersion) !== Number(current?.version || 0);
      if (conflictMerged && ref.collection !== 'state') {
        throw Object.assign(new Error('version_conflict'), { statusCode: 409 });
      }
      const merge = mode === 'update' || mode === 'merge';
      let next = applyPatch(current?.data || {}, effectivePatch, merge);
      if (ref.collection === 'matches') next = mergeMatchData(current?.data || null, next, effectivePatch);
      if (!options.replaceState
          && (ref.collection === 'state' || ref.collection === 'students')
          && effectivePatch?.fullStateJson && current?.data?.fullStateJson) {
        next.fullStateJson = mergeStateJson(current.data.fullStateJson, effectivePatch.fullStateJson);
      }
      let userId = current?.user_id || null;
      if ((ref.collection === 'students' || ref.collection === 'state') && ctx
          && (ctx.docIds.has(ref.docId) || (!!current?.user_id && current.user_id === ctx.userId))) userId = ctx.userId;
      if (!current && ['loginSessions', 'notifyJobs', 'matches'].includes(ref.collection)) userId = ctx?.userId || null;
      if (current && sameValue(current.data, next)) {
        return { id: ref.docId, data: current.data, version: Number(current.version), conflictMerged, unchanged: true };
      }
      const saved = await client.query(`INSERT INTO ${ref.table}(doc_id,user_id,data,version)
        VALUES($1,$2,$3,1)
        ON CONFLICT(doc_id) DO UPDATE SET
          user_id=COALESCE(${ref.table}.user_id,EXCLUDED.user_id),data=EXCLUDED.data,
          version=${ref.table}.version+1,updated_at=now()
        RETURNING doc_id,data,version`, [ref.docId, userId, JSON.stringify(next)]);
      if (options.auditAction) await client.query(
        'INSERT INTO audit_events(actor_user_id,action,target,details) VALUES($1,$2,$3,$4)',
        [ctx?.userId || null, options.auditAction, ref.path, JSON.stringify({ fields: Object.keys(effectivePatch) })]
      );
      return { id: ref.docId, data: saved.rows[0].data, version: Number(saved.rows[0].version), conflictMerged };
    };
    const saved = options.client ? await execute(options.client) : await tx(execute);
    if (!options.client) this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'write', version: saved.version });
    return saved;
  }

  async delete(path, session, options = {}) {
    const ref = parsePath(path);
    const execute = async client => {
      const ctx = options.context || await accessContext(session, client);
      const result = await client.query(`SELECT doc_id,user_id,data,version FROM ${ref.table} WHERE doc_id=$1 FOR UPDATE`, [ref.docId]);
      const current = result.rows[0] || null;
      if (!current) return false;
      if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== Number(current.version || 0)) {
        throw Object.assign(new Error('version_conflict'), { statusCode: 409 });
      }
      if (!await authorizeWrite(client, ref, ctx, current, {}, 'delete', options)) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      await client.query(`DELETE FROM ${ref.table} WHERE doc_id=$1`, [ref.docId]);
      return true;
    };
    const deleted = options.client ? await execute(options.client) : await tx(execute);
    if (deleted && !options.client) this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'delete', version: 0 });
    return deleted;
  }

  async transaction(mutations, session) {
    if (!Array.isArray(mutations) || mutations.length > 50) throw Object.assign(new Error('invalid_transaction'), { statusCode: 400 });
    const changes = [];
    const result = await tx(async client => {
      const ctx = await accessContext(session, client);
      for (const mutation of mutations) {
        if (mutation.type === 'delete') {
          await this.delete(mutation.path, session, { client, context: ctx, expectedVersion: mutation.expectedVersion });
          changes.push(mutation.path);
        } else {
          await this.write(mutation.path, mutation.data || {}, mutation.mode || 'update', session,
            { client, context: ctx, expectedVersion: mutation.expectedVersion, auditAction: 'store.transaction' });
          changes.push(mutation.path);
        }
      }
      return { ok: true };
    });
    for (const path of changes) {
      const ref = parsePath(path);
      this.emit('change', { path: ref.path, collectionPath: ref.path.split('/').slice(0, -1).join('/'), type: 'transaction' });
    }
    return result;
  }
}

module.exports = {
  DocumentStore, parsePath, collectionFromPath, applyPatch, mergeMatchData,
  protectTeacherClassAssignment, stripPrivilegedFields, PRIVILEGED_STUDENT_FIELDS,
  accessContext, publicStudent, COLLECTIONS,
  // Экспортируются ради регрессионных тестов доступа (test/store-access.test.js):
  // права на чтение — самая дорогая ошибка в этом файле, они обязаны быть покрыты.
  authorizeRead, authorizeWrite, authorizeCollectionQuery, publicMatch, studentClassView, projectDocument, classDocId,
  buildQueryPlan, applyConstraints,
  // Замок на очистку выдачи ДЗ — из-за него домашка перестаёт теряться независимо
  // от версии клиента, поэтому он обязан быть покрыт тестом.
  guardPendingAssignments,
  // Объяснение отказа: единственное, по чему потом разбирают инцидент в логах.
  denyContext
};
