'use strict';

const TEXT_TASK_KEYS = ['task1', 'task3', 'task4', 'task5', 'task7'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const stats = { ...(raw.stats || raw) };
  const mistakesPool = Array.isArray(raw.mistakesPool)
    ? raw.mistakesPool : (Array.isArray(stats.mistakesPool) ? stats.mistakesPool : []);
  delete stats.mistakesPool;
  return { stats, mistakesPool, hideLearned: raw.hideLearned ?? stats.hideLearned ?? true };
}

function parse(value) {
  if (!value) return null;
  if (typeof value === 'object') return normalize(value);
  try { return normalize(JSON.parse(value)); } catch (_) { return null; }
}

// Дословный близнец mergeVisualProgress из cloud-sync.js — расходиться им нельзя:
// клиент и сервер сливают одно и то же состояние, и разные правила означают, что
// прогресс «мигает» в зависимости от того, кто слил последним.
//
// 🔴 `resetAt` делает работающей кнопку «Начать заново». Слияние — ОБЪЕДИНЕНИЕ по id:
// чего нет в одной копии, берётся из другой, поэтому «стало пусто» неотличимо от
// «ещё не приходило». Без метки серверная копия возвращала ученику весь выученный
// раздел: он жал «заново», решал один памятник и снова видел «раздел выучен»
// (разбор 08.08.2026). Удаление выражаем временем: запись, выученная ДО последнего
// сброса, в слияние не попадает.
function mergeProgress(states, key, resetAt) {
  const out = {};
  const score = value => value && typeof value === 'object'
    ? (value.learned ? 1000000 : 0) + (value.streak || 0) * 10000 + (value.correct || 0) * 100 + (value.attempts || 0)
    : 0;
  const stampOf = value => Number(value && (value.lastUpdated || value.learnedAt)) || 0;
  for (const state of states) {
    for (const [id, value] of Object.entries(state.stats[key] || {})) {
      if (resetAt && stampOf(value) < resetAt) continue; // выучено до сброса — не воскрешаем
      if (!out[id] || score(value) >= score(out[id])) out[id] = clone(value);
    }
  }
  return out;
}

// Разделы визуала: прогресс, счётчик решённых и метка сброса — неразделимая тройка.
const VISUAL_GROUPS = [
  ['visualArchitectureProgress', 'visualArchitectureSolved', 'visualArchitectureResetAt'],
  ['visualPaintingProgress', 'visualPaintingSolved', 'visualPaintingResetAt'],
];

function mergeStateValues(values) {
  const states = values.map(parse).filter(Boolean);
  if (!states.length) return null;
  const merged = { stats: {}, mistakesPool: [], hideLearned: !states.some(s => s.hideLearned === false) };
  const st = merged.stats;

  const maxFields = [
    'totalSolvedEver', 'streak', 'bestSpeedrunScore', 'flashcardsSolved', 'totalTimeSpent',
    // ⚠️ visualArchitectureSolved / visualPaintingSolved отсюда убраны намеренно: они
    // обнуляются кнопкой «Начать заново», а Math.max вернул бы старое число с копии,
    // которая о сбросе ещё не знает. Их считает блок разделов визуала — с оглядкой
    // на метку сброса.
    'egePoints', 'duelGames', 'duelWins',
    'duelLosses', 'duelDraws', 'matchGames'
  ];
  for (const key of maxFields) {
    if (states.some(s => s.stats[key] !== undefined)) st[key] = Math.max(...states.map(s => Number(s.stats[key]) || 0));
  }

  const bestTimes = states.map(s => Number(s.stats.matchBestMs) || 0).filter(Boolean);
  if (bestTimes.length) st.matchBestMs = Math.min(...bestTimes);

  let duelGames = -1;
  for (const state of states) {
    if (state.stats.duelElo === undefined) continue;
    const games = Number(state.stats.duelGames) || 0;
    if (games > duelGames) { duelGames = games; st.duelElo = Number(state.stats.duelElo) || 1000; }
  }

  st.solvedByTask = Object.fromEntries(TEXT_TASK_KEYS.map(k => [k, 0]));
  for (const state of states) for (const key of TEXT_TASK_KEYS) {
    st.solvedByTask[key] = Math.max(st.solvedByTask[key], Number(state.stats.solvedByTask?.[key]) || 0);
  }

  st.factStreaks = {};
  for (const state of states) for (const [key, value] of Object.entries(state.stats.factStreaks || {})) {
    const current = st.factStreaks[key];
    if (!current || (value.level || 0) > (current.level || 0)
      || ((value.level || 0) === (current.level || 0) && (value.points || value.streak || 0) > (current.points || current.streak || 0))) {
      st.factStreaks[key] = clone(value);
    }
  }

  st.eraStats = {};
  for (const state of states) for (const [task, eras] of Object.entries(state.stats.eraStats || {})) {
    st.eraStats[task] ||= {};
    for (const [era, value] of Object.entries(eras || {})) {
      st.eraStats[task][era] ||= { correct: 0, total: 0 };
      st.eraStats[task][era].correct = Math.max(st.eraStats[task][era].correct, Number(value.correct) || 0);
      st.eraStats[task][era].total = Math.max(st.eraStats[task][era].total, Number(value.total) || 0);
    }
  }

  st.dailyStats = {};
  for (const state of states) for (const [date, value] of Object.entries(state.stats.dailyStats || {})) {
    st.dailyStats[date] ||= {};
    for (const [key, n] of Object.entries(value || {})) {
      st.dailyStats[date][key] = Math.max(Number(st.dailyStats[date][key]) || 0, Number(n) || 0);
    }
  }

  for (const [progressKey, solvedKey, resetKey] of VISUAL_GROUPS) {
    const resetAt = Math.max(0, ...states.map(s => Number(s.stats[resetKey]) || 0));
    if (resetAt) st[resetKey] = resetAt;
    st[progressKey] = mergeProgress(states, progressKey, resetAt);
    // Счётчик берём только у копий, знающих о ПОСЛЕДНЕМ сбросе: у остальных он от
    // прошлого круга и вернул бы «выучено» задним числом.
    const aware = states.filter(s => (Number(s.stats[resetKey]) || 0) === resetAt);
    const counts = (aware.length ? aware : states).map(s => Number(s.stats[solvedKey]) || 0);
    st[solvedKey] = counts.length ? Math.max(...counts) : 0;
  }
  st.vovLearned = {};
  for (const state of states) for (const [id, learned] of Object.entries(state.stats.vovLearned || {})) {
    if (learned) st.vovLearned[id] = true;
  }

  const history = new Map();
  for (const state of states) for (const item of state.stats.mockExams?.history || []) {
    if (!item || !item.id) continue;
    const current = history.get(item.id);
    if (!current || Number(item.completedAt || item.updatedAt) >= Number(current.completedAt || current.updatedAt)) history.set(item.id, clone(item));
  }
  const completed = new Set(history.keys());
  let active = null;
  for (const state of states) {
    const candidate = state.stats.mockExams?.active;
    if (candidate && candidate.id && !completed.has(candidate.id)
      && (!active || Number(candidate.updatedAt) >= Number(active.updatedAt))) active = clone(candidate);
  }
  st.mockExams = {
    active,
    history: [...history.values()].sort((a, b) => Number(a.completedAt) - Number(b.completedAt)).slice(-50),
  };

  const examMistakes = new Map();
  for (const state of states) for (const item of state.stats.mockExamMistakes || []) {
    if (!item) continue;
    const key = item.id || `legacy:${JSON.stringify([item.taskNumber, item.sourceId, item.createdAt, item.prompt])}`;
    const current = examMistakes.get(key);
    if (!current || Number(item.createdAt) >= Number(current.createdAt)) examMistakes.set(key, clone(item));
  }
  st.mockExamMistakes = [...examMistakes.values()].sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).slice(-1000);

  st.achievements = [...new Set(states.flatMap(s => s.stats.achievements || []))];
  st.achievementsData = {};
  for (const state of states) for (const [key, value] of Object.entries(state.stats.achievementsData || {})) {
    if (typeof value === 'number') st.achievementsData[key] = Math.max(st.achievementsData[key] || 0, value);
  }

  // 🔴 Снятое ДЗ обязано умирать НАВСЕГДА. Слияние идёт объединением по id, поэтому
  // удаление на клиенте не помогало: облачная копия возвращала запись при следующей
  // загрузке. Со стороны это выглядело так — цифры домашки пару секунд «моргают» и
  // пропадают (клиент вычистил), а по «обновить» задание снова тут (сервер вернул).
  // Клиент не удаляет, а помечает status:'revoked' — надгробие. Приоритет статусов:
  // done > revoked > active. Сданное — история, её не отнимает даже отзыв.
  // ⚠️ Надгробие обязано ОСТАТЬСЯ в результате слияния. Первая версия выкидывала
  // запись целиком — надгробие защищало ровно одно слияние, а следующее (с другим
  // устройством, где копия ещё active) воскрешало задание заново. Во всех
  // счётчиках ниже участвуют только active — надгробие невидимо, но живёт.
  const assignments = new Map();
  for (const state of states) for (const assignment of state.stats.assignments || []) {
    if (!assignment || !assignment.id) continue;
    // Active legacy_* records belonged to the removed homework model. Never let
    // a stale device resurrect their false lobby badge during server-side merge.
    if (assignment.status === 'active' && String(assignment.id).startsWith('legacy_')) continue;
    const current = assignments.get(assignment.id);
    if (!current) { assignments.set(assignment.id, clone(assignment)); continue; }
    if (current.status === 'done') continue;
    if (assignment.status === 'done') { assignments.set(assignment.id, clone(assignment)); continue; }
    if (current.status === 'revoked') continue;
    if (assignment.status === 'revoked') { assignments.set(assignment.id, clone(assignment)); continue; }
    if (Number(assignment.updatedAt) >= Number(current.updatedAt)) {
      assignments.set(assignment.id, clone(assignment));
      continue;
    }
    for (let i = 0; i < (assignment.items || []).length; i++) {
      const other = assignment.items[i];
      current.items ||= [];
      if (!current.items[i]) current.items[i] = clone(other);
      else if (other && Number(other.progress) > Number(current.items[i].progress)) current.items[i].progress = Number(other.progress) || 0;
    }
  }
  st.assignments = [...assignments.values()];
  // Потолок на надгробия: старейшие уже отработали своё во всех слияниях.
  const tombstones = st.assignments.filter(a => a.status === 'revoked');
  if (tombstones.length > 100) {
    const keep = new Set(tombstones.sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0)).slice(-100).map(a => a.id));
    st.assignments = st.assignments.filter(a => a.status !== 'revoked' || keep.has(a.id));
  }
  const perTask = Object.fromEntries(TEXT_TASK_KEYS.map(k => [k, 0]));
  let remainingTotal = 0;
  for (const assignment of st.assignments) if (assignment.status === 'active') for (const item of assignment.items || []) {
    const remaining = Math.max(0, (Number(item.goal) || 0) - (Number(item.progress) || 0));
    if (perTask[item.task] !== undefined) perTask[item.task] += remaining;
    remainingTotal += remaining;
  }
  st.hwFlashcardsToSolve = remainingTotal;
  for (const key of TEXT_TASK_KEYS) st[`hw${key[0].toUpperCase()}${key.slice(1)}`] = perTask[key];

  // 🔴 Поля, которые слияние РАНЬШЕ МОЛЧА ТЕРЯЛО. Список полей собирается здесь
  // вручную, и всё, что в него не попало, исчезает при каждой записи в облако.
  //
  // consent — согласие на обработку данных. Его потеря дороже всех: на устройстве,
  // где localStorage не пережил перезапуск (Telegram Desktop), человека спрашивали
  // имя и галочку ПРИ КАЖДОМ входе, потому что в облаке согласия не было ни у кого.
  // На 30.07 — 0 записей из 1345. Держим САМОЕ РАННЕЕ: это юридический факт «когда
  // человек согласился», и переписывать его свежей датой нельзя.
  let consent = null;
  for (const state of states) {
    const candidate = state.stats.consent;
    if (!candidate || !candidate.acceptedAt) continue;
    if (!consent || Number(candidate.acceptedAt) < Number(consent.acceptedAt)) consent = clone(candidate);
  }
  if (consent) st.consent = consent;

  // examSolved — круг по банку ФИПИ: id уже верно решённых заданий. Без переноса
  // ротация обнулялась при каждом слиянии, и банк шёл по второму кругу.
  const examSolved = new Set();
  for (const state of states) for (const id of state.stats.examSolved || []) if (id) examSolved.add(id);
  if (examSolved.size) st.examSolved = [...examSolved];

  // timeByTask — время по заданиям; берём максимум, как и общее время.
  const timeByTask = {};
  for (const state of states) for (const [key, value] of Object.entries(state.stats.timeByTask || {})) {
    timeByTask[key] = Math.max(Number(timeByTask[key]) || 0, Number(value) || 0);
  }
  if (Object.keys(timeByTask).length) st.timeByTask = timeByTask;

  const mistakeKeys = new Set();
  for (const state of states) for (const mistake of state.mistakesPool || []) {
    const key = JSON.stringify({ task: mistake && mistake.task, fact: mistake && mistake.fact });
    if (!mistakeKeys.has(key)) { mistakeKeys.add(key); merged.mistakesPool.push(clone(mistake)); }
  }
  return merged;
}

function mergeStateJson(left, right) {
  const result = mergeStateValues([left, right]);
  return result ? JSON.stringify(result) : (right || left || '{}');
}

module.exports = { normalize, parse, mergeStateValues, mergeStateJson };
