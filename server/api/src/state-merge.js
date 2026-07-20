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

function mergeProgress(states, key) {
  const out = {};
  const score = value => value && typeof value === 'object'
    ? (value.learned ? 1000000 : 0) + (value.streak || 0) * 10000 + (value.correct || 0) * 100 + (value.attempts || 0)
    : 0;
  for (const state of states) {
    for (const [id, value] of Object.entries(state.stats[key] || {})) {
      if (!out[id] || score(value) >= score(out[id])) out[id] = clone(value);
    }
  }
  return out;
}

function mergeStateValues(values) {
  const states = values.map(parse).filter(Boolean);
  if (!states.length) return null;
  const merged = { stats: {}, mistakesPool: [], hideLearned: !states.some(s => s.hideLearned === false) };
  const st = merged.stats;

  const maxFields = [
    'totalSolvedEver', 'streak', 'bestSpeedrunScore', 'flashcardsSolved', 'totalTimeSpent',
    'egePoints', 'visualArchitectureSolved', 'visualPaintingSolved', 'duelGames', 'duelWins',
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

  st.visualArchitectureProgress = mergeProgress(states, 'visualArchitectureProgress');
  st.visualPaintingProgress = mergeProgress(states, 'visualPaintingProgress');
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

  const assignments = new Map();
  for (const state of states) for (const assignment of state.stats.assignments || []) {
    if (!assignment || !assignment.id) continue;
    const current = assignments.get(assignment.id);
    if (!current || assignment.status === 'done' || (current.status !== 'done' && Number(assignment.updatedAt) >= Number(current.updatedAt))) {
      assignments.set(assignment.id, clone(assignment));
      continue;
    }
    if (current.status !== 'done') for (let i = 0; i < (assignment.items || []).length; i++) {
      const other = assignment.items[i];
      current.items ||= [];
      if (!current.items[i]) current.items[i] = clone(other);
      else if (other && Number(other.progress) > Number(current.items[i].progress)) current.items[i].progress = Number(other.progress) || 0;
    }
  }
  st.assignments = [...assignments.values()];
  const perTask = Object.fromEntries(TEXT_TASK_KEYS.map(k => [k, 0]));
  let remainingTotal = 0;
  for (const assignment of st.assignments) if (assignment.status === 'active') for (const item of assignment.items || []) {
    const remaining = Math.max(0, (Number(item.goal) || 0) - (Number(item.progress) || 0));
    if (perTask[item.task] !== undefined) perTask[item.task] += remaining;
    remainingTotal += remaining;
  }
  st.hwFlashcardsToSolve = remainingTotal;
  for (const key of TEXT_TASK_KEYS) st[`hw${key[0].toUpperCase()}${key.slice(1)}`] = perTask[key];

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
