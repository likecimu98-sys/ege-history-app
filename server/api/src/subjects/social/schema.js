'use strict';

// Контракт обществознания: что сервер СОГЛАСЕН принять от клиента.
//
// 🔴 Поле `subject` здесь не существует ни в одном запросе — и это не упущение.
// Предмет определяется маршрутом /api/v1/subjects/social/... и серверной
// настройкой origin. Если бы предмет приходил в теле, ученик обществознания
// одним лишним ключом писал бы в данные истории.
//
// Все перечни БЕЛЫЕ: неизвестное поле не вырезается молча, а отвергает запрос
// целиком. В истории обратное решение уже стоило потерянных дуэлей — «лишнее
// поле молча выкинули» невозможно заметить, а «запрос отклонён» видно сразу.

const { mondayStr, moscowDayStr } = require('../../moscow-time');

// Типы заданий предмета. Ровно пять, они непересекающиеся и зафиксированы
// манифестом банка (80 + 51 + 49 + 169 + 709 = 1058).
const TASK_TYPES = Object.freeze(['task1', 'task12', 'task13', 'matching', 'choice']);
// Пять блоков КЭС. Темы имеют вид «2.7» — первая цифра и есть блок.
const BLOCK_IDS = Object.freeze(['1', '2', '3', '4', '5']);
const TOPIC_RE = /^[1-5]\.\d{1,2}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{4,80}$/;
// UUID любой версии либо совместимый по форме идентификатор из очереди клиента.
const EVENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

const ATTEMPT_KINDS = Object.freeze(['practice', 'exam', 'topic', 'mistakes', 'review', 'lab', 'homework']);
const MAX_EVENTS_PER_REQUEST = 50;
const MAX_STATE_BYTES = 1024 * 1024;

// Настройки предмета, которые ученик вправе менять сам. Роли, класса, премиума и
// безлимита здесь нет и быть не может: это серверные факты (проверка плана
// «ученик не может назначить себе роль учителя, класс, premium или безлимит»).
const ALLOWED_SETTING_KEYS = Object.freeze(['includeImages', 'count', 'mode', 'sound', 'theme']);

function fail(message, statusCode = 400, details) {
  throw Object.assign(new Error(message), { statusCode, ...(details ? { details } : {}) });
}

function text(value, { max = 200, field = 'value', required = false } = {}) {
  const out = String(value == null ? '' : value).trim().slice(0, max);
  if (required && !out) fail(`${field}_required`);
  return out;
}

function integer(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

// Списки фильтров всегда приводятся к уникальному отсортированному набору:
// «ДЗ по нескольким темам дедуплицирует задания» начинается уже здесь, иначе
// одна и та же тема, присланная дважды, удваивала бы вес в пересчёте.
function enumList(value, allowed, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`${field}_must_be_array`);
  const set = new Set();
  for (const item of value) {
    const one = String(item == null ? '' : item).trim();
    if (!one) continue;
    if (!allowed(one)) fail(`${field}_unknown_value`, 400, { value: one.slice(0, 40) });
    set.add(one);
  }
  return [...set].sort();
}

function typeList(value) {
  return enumList(value, item => TASK_TYPES.includes(item), 'types');
}

function blockList(value) {
  return enumList(value, item => BLOCK_IDS.includes(item), 'blocks');
}

function topicList(value) {
  return enumList(value, item => TOPIC_RE.test(item), 'topics');
}

function settings(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail('settings_must_be_object');
  const unknown = Object.keys(value).filter(key => !ALLOWED_SETTING_KEYS.includes(key));
  if (unknown.length) fail('settings_unknown_field', 400, { fields: unknown.slice(0, 5) });
  const out = {};
  if ('includeImages' in value) out.includeImages = Boolean(value.includeImages);
  if ('sound' in value) out.sound = Boolean(value.sound);
  if ('count' in value) out.count = [5, 10, 20].includes(Number(value.count)) ? Number(value.count) : 10;
  if ('mode' in value) out.mode = ['new', 'mixed', 'mistakes', 'review'].includes(String(value.mode)) ? String(value.mode) : 'mixed';
  if ('theme' in value) out.theme = String(value.theme) === 'dark' ? 'dark' : 'light';
  return out;
}

function profilePatch(body) {
  const source = body && typeof body === 'object' ? body : {};
  const unknown = Object.keys(source).filter(key => !['displayName', 'settings'].includes(key));
  if (unknown.length) fail('profile_unknown_field', 400, { fields: unknown.slice(0, 5) });
  return {
    displayName: 'displayName' in source ? text(source.displayName, { max: 80, field: 'displayName' }) : null,
    settings: 'settings' in source ? settings(source.settings) : null,
  };
}

// Снимок прогресса. Принимаем и объект, и уже сериализованную строку: клиент
// хранит прогресс строкой в localStorage, и лишний разбор-сборка на телефоне —
// это потерянные миллисекунды на каждом сохранении.
function statePut(body) {
  const source = body && typeof body === 'object' ? body : {};
  if (!('state' in source)) fail('state_required');
  let value = source.state;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { fail('state_invalid_json'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('state_must_be_object');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) fail('state_too_large', 413);
  // baseRevision обязателен: запись «поверх всего» — это способ потерять работу
  // второго устройства, и разрешать её нельзя даже как «первый раз».
  if (!('baseRevision' in source)) fail('base_revision_required');
  return { state: value, baseRevision: integer(source.baseRevision, { min: 0, max: Number.MAX_SAFE_INTEGER }) };
}

// Одно событие попытки. attemptedAt клиент прислать может (он мог решать
// офлайн), но день и неделю по нему считает СЕРВЕР: и то и другое — основание
// для квоты и рейтинга, а часы телефона под контролем ученика.
function attemptEvent(raw, { now = Date.now() } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const eventId = text(source.eventId, { max: 64, field: 'eventId', required: true });
  if (!EVENT_ID_RE.test(eventId)) fail('event_id_invalid');
  const taskId = text(source.taskId, { max: 80, field: 'taskId', required: true });
  if (!TASK_ID_RE.test(taskId)) fail('task_id_invalid');
  const taskType = text(source.taskType, { max: 20, field: 'taskType' });
  if (taskType && !TASK_TYPES.includes(taskType)) fail('task_type_unknown');

  const possible = integer(source.possible, { min: 1, max: 30, fallback: 1 });
  const earned = integer(source.earned, { min: 0, max: possible, fallback: 0 });
  // Момент попытки не может быть в будущем: иначе часы телефона переносили бы
  // работу в следующую неделю рейтинга. Слишком старое тоже отсекаем — очередь
  // офлайна живёт днями, а не годами.
  const attemptedAtRaw = Number(source.attemptedAt);
  const attemptedAt = Number.isFinite(attemptedAtRaw) && attemptedAtRaw > 0
    ? Math.min(now, Math.max(now - 30 * 24 * 60 * 60 * 1000, attemptedAtRaw))
    : now;

  return {
    eventId,
    taskId,
    taskType,
    blockIds: blockList(source.blockIds),
    topicCodes: topicList(source.topicCodes),
    hasImages: Boolean(source.hasImages),
    correct: Boolean(source.correct),
    earned,
    possible,
    elapsedMs: integer(source.elapsedMs, { min: 0, max: 60 * 60 * 1000, fallback: 0 }),
    kind: ATTEMPT_KINDS.includes(String(source.kind)) ? String(source.kind) : 'practice',
    examLine: integer(source.examLine, { min: 0, max: 16, fallback: 0 }),
    attemptedAt,
    mskDay: moscowDayStr(attemptedAt),
    weekStart: mondayStr(attemptedAt),
  };
}

function attemptBatch(body, { now = Date.now() } = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const list = Array.isArray(source.events) ? source.events : (source.event ? [source.event] : null);
  if (!list || !list.length) fail('events_required');
  if (list.length > MAX_EVENTS_PER_REQUEST) fail('too_many_events', 413, { max: MAX_EVENTS_PER_REQUEST });
  const events = list.map(item => attemptEvent(item, { now }));
  // Дубли внутри одной пачки: клиент мог склеить две очереди. База отсекла бы их
  // по PRIMARY KEY, но тогда пачка ушла бы в конфликт целиком.
  const seen = new Set();
  return events.filter(event => {
    if (seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });
}

function classCreate(body) {
  const source = body && typeof body === 'object' ? body : {};
  return { title: text(source.title, { max: 80, field: 'title', required: true }) };
}

function classPatch(body) {
  const source = body && typeof body === 'object' ? body : {};
  const unknown = Object.keys(source).filter(key => !['title', 'status'].includes(key));
  if (unknown.length) fail('class_unknown_field', 400, { fields: unknown.slice(0, 5) });
  const out = {};
  if ('title' in source) out.title = text(source.title, { max: 80, field: 'title', required: true });
  if ('status' in source) {
    const status = text(source.status, { max: 16, field: 'status' });
    if (!['active', 'archived'].includes(status)) fail('class_status_unknown');
    out.status = status;
  }
  if (!Object.keys(out).length) fail('nothing_to_update');
  return out;
}

// Конструктор ДЗ. Ровно то, что есть в предмете: типы, блоки, темы, цель в
// вопросах, срок и №9. Исторических периодов и генераторов строк тут нет — это
// граница, зафиксированная планом этапа.
function assignmentCreate(body, { now = Date.now() } = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const unknown = Object.keys(source).filter(key => ![
    'classId', 'title', 'types', 'blocks', 'topics', 'questionGoal', 'includeImages', 'dueAt',
  ].includes(key));
  if (unknown.length) fail('assignment_unknown_field', 400, { fields: unknown.slice(0, 5) });

  const classId = text(source.classId, { max: 64, field: 'classId', required: true });
  const types = typeList(source.types);
  const blocks = blockList(source.blocks);
  const topics = topicList(source.topics);
  // Пустой фильтр означает «весь банк» — это законное ДЗ «порешай что угодно».
  // А вот срок в прошлом законным не бывает: ученик увидит задание уже
  // просроченным и не поймёт, что делать.
  const dueAt = source.dueAt == null || source.dueAt === '' ? null : Number(new Date(source.dueAt));
  if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= now)) fail('due_at_must_be_future');

  return {
    classId,
    title: text(source.title, { max: 120, field: 'title' }),
    types,
    blocks,
    topics,
    questionGoal: integer(source.questionGoal, { min: 1, max: 200, fallback: 10 }),
    // 🔴 №9 выключено по умолчанию и включается ТОЛЬКО явной настройкой.
    // Boolean(undefined) === false, поэтому забытое поле не может включить
    // графики случайно.
    includeImages: Boolean(source.includeImages),
    dueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
  };
}

function assignmentPatch(body, { now = Date.now() } = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const unknown = Object.keys(source).filter(key => !['title', 'questionGoal', 'dueAt', 'status'].includes(key));
  if (unknown.length) fail('assignment_unknown_field', 400, { fields: unknown.slice(0, 5) });
  const out = {};
  if ('title' in source) out.title = text(source.title, { max: 120, field: 'title' });
  if ('questionGoal' in source) out.questionGoal = integer(source.questionGoal, { min: 1, max: 200, fallback: 10 });
  if ('dueAt' in source) {
    if (source.dueAt == null || source.dueAt === '') out.dueAt = null;
    else {
      const dueAt = Number(new Date(source.dueAt));
      if (!Number.isFinite(dueAt) || dueAt <= now) fail('due_at_must_be_future');
      out.dueAt = new Date(dueAt).toISOString();
    }
  }
  if ('status' in source) {
    const status = text(source.status, { max: 16, field: 'status' });
    if (!['active', 'cancelled'].includes(status)) fail('assignment_status_unknown');
    out.status = status;
  }
  // Фильтры выданного ДЗ не меняются намеренно: смена условий задним числом
  // переписала бы уже засчитанное выполнение. Нужно другое — отмени и выдай новое.
  if (!Object.keys(out).length) fail('nothing_to_update');
  return out;
}

// Код приглашения набирают руками с доски, поэтому из алфавита убраны символы,
// которые путаются: 0/O, 1/I/L. Восемь знаков — это 32^8 вариантов.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

function joinCode(value) {
  const code = String(value == null ? '' : value).trim().toUpperCase().replace(/[\s-]/g, '');
  if (!JOIN_CODE_RE.test(code)) fail('join_code_invalid');
  return code;
}

module.exports = {
  TASK_TYPES, BLOCK_IDS, ATTEMPT_KINDS, ALLOWED_SETTING_KEYS,
  MAX_EVENTS_PER_REQUEST, MAX_STATE_BYTES, JOIN_CODE_ALPHABET, JOIN_CODE_RE,
  fail, text, integer, typeList, blockList, topicList, settings,
  profilePatch, statePut, attemptEvent, attemptBatch,
  classCreate, classPatch, assignmentCreate, assignmentPatch, joinCode,
};
