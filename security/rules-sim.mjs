// rules-sim.mjs — симуляция ЛОГИКИ строгого ruleset (security/firestore.rules.strict)
// на сценариях, выведенных из реального кода firebase-sync.js.
//
// ВАЖНО ЧЕСТНО: это НЕ движок Firebase. Это перенос предикатов правил в JS, чтобы
// проверить ЗАМЫСЕЛ и увидеть, какие места ТЕКУЩЕГО клиента строгие правила ломают.
// Авторитетный прогон (настоящий CEL-движок) требует Firestore-эмулятора = Java.
// Здесь Java не нужна. Запуск:  node security/rules-sim.mjs
//
// Модель: request = { auth: {uid, token:{teacher}} | null, resource:{data} }
// Возвращаем allow/deny по тем же формулам, что в .strict.

const APP = 'ege-history-bot';

// ── предикаты из firestore.rules.strict ─────────────────────────────────────
const authed = (req) => req.auth != null;
const isOwner = (req, id) =>
  authed(req) && (req.auth.uid === id || ('google_' + req.auth.uid) === id);
const isTeacher = (req) => authed(req) && req.auth.token?.teacher === true;
const blobOk = (req) => {
  const d = req.resource?.data || {};
  return !('fullStateJson' in d) || String(d.fullStateJson).length < 950000;
};
const hasBlob = (req) => 'fullStateJson' in (req.resource?.data || {});

// маршрутизация пути → решение (op: 'get'|'list'|'create'|'update'|'delete')
function decide(path, op, req) {
  const isWrite = ['create', 'update', 'delete'].includes(op);
  const isRead = ['get', 'list'].includes(op);

  // public/data/students/{id}
  let m = path.match(/^artifacts\/[^/]+\/public\/data\/students\/([^/]+)$/);
  if (m) {
    if (isRead) return authed(req);
    return (isOwner(req, m[1]) || isTeacher(req)) && !hasBlob(req);
  }
  // private/data/state/{id}
  m = path.match(/^artifacts\/[^/]+\/private\/data\/state\/([^/]+)$/);
  if (m) {
    if (isRead) return isOwner(req, m[1]) || isTeacher(req);
    return isOwner(req, m[1]) && blobOk(req);
  }
  // classes
  if (/^artifacts\/[^/]+\/public\/data\/classes\/[^/]+$/.test(path)) {
    if (isRead) return authed(req);
    return isTeacher(req);
  }
  // matches
  if (/^artifacts\/[^/]+\/public\/data\/matches\/[^/]+$/.test(path)) {
    return authed(req);
  }
  // leaderboards
  if (/^artifacts\/[^/]+\/public\/data\/leaderboards\/[^/]+$/.test(path)) {
    return isRead ? authed(req) : false;
  }
  // loginTokens
  if (/^artifacts\/[^/]+\/public\/data\/loginTokens\/[^/]+$/.test(path)) {
    if (op === 'get') return authed(req);
    return false;
  }
  // loginSessions
  if (/^artifacts\/[^/]+\/public\/data\/loginSessions\/[^/]+$/.test(path)) {
    if (op === 'get' || op === 'create' || op === 'update') return authed(req);
    return false;
  }
  // notifyJobs
  if (/^artifacts\/[^/]+\/public\/data\/notifyJobs\/[^/]+$/.test(path)) {
    return op === 'create' ? authed(req) : false;
  }
  // config / teachers / orgs
  if (/^artifacts\/[^/]+\/public\/data\/(config|teachers|orgs)\/[^/]+$/.test(path)) {
    return isRead ? authed(req) : false;
  }
  // всё прочее — deny
  return false;
}

// ── акторы ──────────────────────────────────────────────────────────────────
const anon      = { auth: { uid: 'rand_anon_9f2', token: {} } };          // аноним (эксплойт)
const noauth    = { auth: null };                                          // вообще без входа
const tg        = { auth: { uid: '352253483', token: {} } };              // TG-ученик, uid=tgId
const tgOther   = { auth: { uid: '7009819968', token: {} } };             // другой TG-ученик
const google    = { auth: { uid: 'PVx8abc', token: {} } };                // Google-ученик
const teacher   = { auth: { uid: '352253483', token: { teacher: true } } };// учитель

const withData = (actor, data) => ({ ...actor, resource: { data } });

// ── сценарии: [описание, путь, операция, req, ОЖИДАНИЕ] ─────────────────────
const S = [
  // --- ЭКСПЛОЙТ, который надо закрыть ---
  ['Аноним читает чужой ПУБЛИЧНЫЙ профиль (имя/лидерборд) — допустимо',
    `artifacts/${APP}/public/data/students/352253483`, 'get', anon, true],
  ['Аноним читает чужой ПРИВАТНЫЙ прогресс (fullStateJson) — ДОЛЖНО БЛОКИРОВАТЬСЯ',
    `artifacts/${APP}/private/data/state/352253483`, 'get', anon, false],
  ['Аноним листает всех учеников приватно — блок',
    `artifacts/${APP}/private/data/state/352253483`, 'list', anon, false],
  ['Совсем без auth — читать нельзя ничего',
    `artifacts/${APP}/public/data/students/352253483`, 'get', noauth, false],
  ['Аноним пишет в чужой приватный прогресс — блок',
    `artifacts/${APP}/private/data/state/352253483`, 'update',
    withData(anon, { fullStateJson: '{"cheat":1}' }), false],

  // --- ВЛАДЕЛЕЦ (целевое состояние: пишет только свой док) ---
  ['TG-ученик пишет свой публичный профиль (без блоба) — ок',
    `artifacts/${APP}/public/data/students/352253483`, 'update',
    withData(tg, { name: 'Саша', duelRating: 1200, classCode: '0377' }), true],
  ['TG-ученик кладёт fullStateJson в ПУБЛИЧНЫЙ док — блок (блоб только в private)',
    `artifacts/${APP}/public/data/students/352253483`, 'update',
    withData(tg, { fullStateJson: '{"x":1}' }), false],
  ['TG-ученик пишет свой приватный прогресс — ок',
    `artifacts/${APP}/private/data/state/352253483`, 'update',
    withData(tg, { fullStateJson: '{"stats":{}}' }), true],
  ['TG-ученик пишет в ЧУЖОЙ приватный прогресс — блок',
    `artifacts/${APP}/private/data/state/7009819968`, 'update',
    withData(tg, { fullStateJson: '{"x":1}' }), false],
  ['Google-ученик пишет свой приватный прогресс (docId=google_<uid>) — ок',
    `artifacts/${APP}/private/data/state/google_PVx8abc`, 'update',
    withData(google, { fullStateJson: '{}' }), true],
  ['Блоб больше 950КБ — блок (backstop)',
    `artifacts/${APP}/private/data/state/352253483`, 'update',
    withData(tg, { fullStateJson: 'x'.repeat(960000) }), false],

  // --- УЧИТЕЛЬ ---
  ['Учитель читает приватный прогресс ученика (кабинет) — ок',
    `artifacts/${APP}/private/data/state/7009819968`, 'get', teacher, true],
  ['Учитель пишет журнал класса — ок',
    `artifacts/${APP}/public/data/classes/0377`, 'update',
    withData(teacher, { assignments: [] }), true],
  ['НЕ-учитель пишет журнал класса — блок',
    `artifacts/${APP}/public/data/classes/0377`, 'update',
    withData(tg, { assignments: [] }), false],
  ['Учитель пишет ДЗ в публичный профиль ученика (top-level, без блоба) — ок',
    `artifacts/${APP}/public/data/students/7009819968`, 'update',
    withData(teacher, { pendingAssignments: [], revokedAssignments: [] }), true],
  ['Учитель НЕ может класть fullStateJson в ученика (блоб только владелец в private) — блок',
    `artifacts/${APP}/public/data/students/7009819968`, 'update',
    withData(teacher, { fullStateJson: '{}' }), false],
  ['Ученик пишет в ЧУЖОЙ публичный профиль (не владелец, не учитель) — блок',
    `artifacts/${APP}/public/data/students/7009819968`, 'update',
    withData(tg, { pendingAssignments: [] }), false],

  // --- ДУЭЛИ / ЛИДЕРБОРД ---
  ['Игрок правит документ матча — ок',
    `artifacts/${APP}/public/data/matches/m1`, 'update',
    withData(tg, { player1: {} }), true],
  ['Клиент пишет кэш лидерборда — блок (только бот)',
    `artifacts/${APP}/public/data/leaderboards/global`, 'update',
    withData(tg, { top: [] }), false],
  ['Клиент читает кэш лидерборда — ок',
    `artifacts/${APP}/public/data/leaderboards/global`, 'get', tg, true],

  // --- loginTokens / notifyJobs ---
  ['Забрать свой loginToken по прямому id — ок',
    `artifacts/${APP}/public/data/loginTokens/abc`, 'get', tg, true],
  ['Перечислить loginTokens (угон чужого tgId) — блок',
    `artifacts/${APP}/public/data/loginTokens/abc`, 'list', tg, false],
  ['Клиент кладёт notifyJob — ок',
    `artifacts/${APP}/public/data/notifyJobs/j1`, 'create',
    withData(tg, { type: 'hw_done' }), true],
  ['Клиент читает чужие notifyJobs — блок',
    `artifacts/${APP}/public/data/notifyJobs/j1`, 'get', tgOther, false],
];

// ── прогон ──────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
console.log('\n  РЕЗУЛЬТАТ ПО ЦЕЛЕВЫМ ПРАВИЛАМ (strict) — замысел:\n');
for (const [desc, path, op, req, expect] of S) {
  const got = decide(path, op, req);
  const ok = got === expect;
  ok ? pass++ : fail++;
  console.log(`   ${ok ? '✅' : '❌'} [${op.padEnd(6)}] ${got ? 'ALLOW' : 'DENY '}  ${desc}`);
}
console.log(`\n  Итог замысла: ${pass} ok, ${fail} расхождений.\n`);

// ── что строгие правила ЛОМАЮТ в ТЕКУЩЕМ клиенте (список рефакторинга) ───────
// Эти вызовы есть в firebase-sync.js СЕЙЧАС и после строгих правил упадут.
// После claim-упрощения P2 учительские записи РАЗРЕШЕНЫ (см. сценарии выше) —
// переносить их в бота НЕ нужно. Осталось два реальных изменения клиента:
const BREAKS = [
  ['Владелец пишет tombstone _mergedInto в ЧУЖОЙ legacy-док',
    'firebase-sync.js:3583 — при uid=tgId новая фрагментация не возникает; старую чистит '
    + '/root/bot/_repair-merged.js (Admin SDK). Провал tombstone у клиента ловится и безвреден.',
    `artifacts/${APP}/public/data/students/google_PVx8abc`, 'update',
    withData(tg, { _mergedInto: '352253483' })],
  ['Старый путь: fullStateJson лежит в public/students (утечка при read:authed)',
    'firebase-sync.js:3570 payload с fullStateJson → писать в private/state/{id} (предпосылка 4)',
    `artifacts/${APP}/public/data/students/352253483`, 'update',
    withData(tg, { fullStateJson: '{"stats":{}}', name: 'Саша' })],
];
console.log('  ЧТО СТРОГИЕ ПРАВИЛА ЛОМАЮТ В ТЕКУЩЕМ КЛИЕНТЕ (→ список работ):\n');
for (const [desc, fix, path, op, req] of BREAKS) {
  const allowed = decide(path, op, req);
  console.log(`   ${allowed ? '⚠️  всё ещё ALLOW?!' : '⛔ DENY'}  ${desc}`);
  console.log(`        → ${fix}`);
}
console.log('');
process.exit(fail === 0 ? 0 : 1);
