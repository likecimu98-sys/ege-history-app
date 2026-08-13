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
    'source', 'taskIds',
  ].includes(key));
  if (unknown.length) fail('assignment_unknown_field', 400, { fields: unknown.slice(0, 5) });

  const classId = text(source.classId, { max: 64, field: 'classId', required: true });
  // Вариант учителя. Фильтры банка при этом не имеют смысла и обнуляются: иначе
  // в пересчёт выполнения попали бы посторонние задания, решённые в это же время.
  const origin = String(source.source || 'bank') === 'custom' ? 'custom' : 'bank';
  if (origin === 'custom') {
    const taskIds = customTaskIds(source.taskIds);
    return {
      classId,
      source: 'custom',
      taskIds,
      title: text(source.title, { max: 120, field: 'title' }),
      types: [], blocks: [], topics: [],
      // Цель варианта — все его задания: «сдал вариант» означает «решил всё».
      questionGoal: taskIds.length,
      includeImages: false,
      dueAt: dueAtOf(source, now),
    };
  }
  const types = typeList(source.types);
  const blocks = blockList(source.blocks);
  const topics = topicList(source.topics);
  return {
    classId,
    source: 'bank',
    taskIds: [],
    title: text(source.title, { max: 120, field: 'title' }),
    types,
    blocks,
    topics,
    questionGoal: integer(source.questionGoal, { min: 1, max: 200, fallback: 10 }),
    // 🔴 №9 выключено по умолчанию и включается ТОЛЬКО явной настройкой.
    // Boolean(undefined) === false, поэтому забытое поле не может включить
    // графики случайно.
    includeImages: Boolean(source.includeImages),
    dueAt: dueAtOf(source, now),
  };
}

// Пустой фильтр означает «весь банк» — это законное ДЗ «порешай что угодно».
// А вот срок в прошлом законным не бывает: ученик увидит задание уже
// просроченным и не поймёт, что делать.
function dueAtOf(source, now) {
  if (source.dueAt == null || source.dueAt === '') return null;
  const dueAt = Number(new Date(source.dueAt));
  if (!Number.isFinite(dueAt) || dueAt <= now) fail('due_at_must_be_future');
  return new Date(dueAt).toISOString();
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

// ---------------------------------------------------------------------------
// Свои задания учителя
// ---------------------------------------------------------------------------

// Метки строк соответствия — те же, что в банке ФИПИ и в приложении. Латиница
// сюда попадать не должна: «A» и «А» на экране неразличимы, а ответ по ним
// сравнивается строкой.
const TARGET_LABELS = Object.freeze(['А', 'Б', 'В', 'Г', 'Д', 'Е']);
const MATCHING_TYPES = Object.freeze(['matching', 'task13']);

function optionList(value) {
  if (!Array.isArray(value)) fail('options_must_be_array');
  const list = value
    .map(item => (item && typeof item === 'object' ? item : { text: item }))
    .map((item, index) => ({
      n: integer(item.n, { min: 1, max: 9, fallback: index + 1 }),
      text: text(item.text, { max: 400, field: 'option_text' }),
    }))
    .filter(item => item.text);
  if (list.length < 2) fail('options_need_two');
  if (list.length > 9) fail('options_too_many');
  // Номера — это и есть ответ. Повтор номера означал бы, что ответ «1» указывает
  // сразу на два разных варианта, и проверить такое задание нельзя.
  const numbers = new Set(list.map(item => item.n));
  if (numbers.size !== list.length) fail('options_numbers_must_differ');
  return list;
}

function targetList(value) {
  if (!Array.isArray(value)) fail('targets_must_be_array');
  const list = value
    .map(item => (item && typeof item === 'object' ? item : { text: item }))
    .map((item, index) => ({
      label: TARGET_LABELS.includes(String(item.label || '').trim())
        ? String(item.label).trim()
        : TARGET_LABELS[index] || '',
      text: text(item.text, { max: 400, field: 'target_text' }),
    }))
    .filter(item => item.text && item.label);
  if (list.length < 2) fail('targets_need_two');
  if (list.length > TARGET_LABELS.length) fail('targets_too_many');
  const labels = new Set(list.map(item => item.label));
  if (labels.size !== list.length) fail('targets_labels_must_differ');
  return list;
}

// 🔴 Ответ проверяется против вариантов ЗДЕСЬ, а не в кабинете. Задание с
// ответом «5» при четырёх вариантах невозможно решить правильно: ученик увидит
// его как неберущееся, а учитель — как «все ошиблись». Такую опечатку нельзя
// поймать глазами в таблице результатов, поэтому она отвергается на входе.
function customAnswer(raw, type, options, targets) {
  const answer = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
  if (!answer) fail('answer_required');
  const numbers = new Set(options.map(option => String(option.n)));
  for (const digit of answer) {
    if (!numbers.has(digit)) fail('answer_out_of_options', 400, { digit });
  }
  if (MATCHING_TYPES.includes(type)) {
    // По цифре на строку и ровно в том же порядке, в каком идут строки.
    if (answer.length !== targets.length) fail('answer_length_must_match_targets');
    return answer;
  }
  if (answer.length < 1 || answer.length > 6) fail('answer_length_invalid');
  // Порядок в ответе выбора не значим: «13» и «31» — один и тот же ответ.
  // Приводим к одному виду, иначе проверка зависела бы от того, как учитель
  // набрал цифры.
  return [...new Set(answer)].sort().join('');
}

function customTask(body) {
  const source = body && typeof body === 'object' ? body : {};
  const unknown = Object.keys(source).filter(key => ![
    'type', 'prompt', 'options', 'targets', 'answer', 'blocks', 'topics',
  ].includes(key));
  if (unknown.length) fail('task_unknown_field', 400, { fields: unknown.slice(0, 5) });

  const type = text(source.type, { max: 20, field: 'type', required: true });
  if (!TASK_TYPES.includes(type)) fail('task_type_unknown');
  const options = optionList(source.options);
  const targets = MATCHING_TYPES.includes(type) ? targetList(source.targets) : [];
  return {
    type,
    prompt: text(source.prompt, { max: 2000, field: 'prompt', required: true }),
    options,
    targets,
    answer: customAnswer(source.answer, type, options, targets),
    blocks: blockList(source.blocks),
    topics: topicList(source.topics),
  };
}

// Список заданий варианта. Пустой список — это ДЗ, которое нельзя выполнить,
// поэтому он отвергается, а не сохраняется «пока пустым».
function customTaskIds(value) {
  if (!Array.isArray(value) || !value.length) fail('task_ids_required');
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item == null ? '' : item).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) fail('task_ids_required');
  if (ids.length > 100) fail('task_ids_too_many');
  return ids;
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
  TASK_TYPES, BLOCK_IDS, ATTEMPT_KINDS, ALLOWED_SETTING_KEYS, TARGET_LABELS, MATCHING_TYPES,
  MAX_EVENTS_PER_REQUEST, MAX_STATE_BYTES, JOIN_CODE_ALPHABET, JOIN_CODE_RE,
  fail, text, integer, typeList, blockList, topicList, settings,
  profilePatch, statePut, attemptEvent, attemptBatch,
  classCreate, classPatch, assignmentCreate, assignmentPatch, joinCode,
  customTask, customTaskIds, optionList, targetList,
};
