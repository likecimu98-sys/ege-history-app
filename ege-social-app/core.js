(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SocialCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const REVIEW_INTERVALS = [0, DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS, 30 * DAY_MS];

  function digits(value) {
    const source = Array.isArray(value) ? value.join('') : String(value || '');
    return [...new Set(source.match(/\d/g) || [])].sort().join('');
  }

  function positionAnswer(task, response) {
    if (Array.isArray(response)) return response.map(value => String(value || ''));
    if (response && typeof response === 'object') {
      return task.targets.map(target => String(response[target.label] || ''));
    }
    return String(response || '').split('');
  }

  function evaluate(task, response) {
    const isMatching = task.type === 'matching' || task.type === 'task13';
    if (!isMatching) {
      const actual = digits(response);
      const expected = digits(task.answer);
      const correct = actual === expected;
      return {
        correct,
        earned: correct ? 1 : 0,
        total: 1,
        actual,
        expected,
        details: task.options.map(option => ({
          n: String(option.n),
          selected: actual.includes(String(option.n)),
          correct: expected.includes(String(option.n))
        }))
      };
    }

    const actual = positionAnswer(task, response);
    const expected = String(task.answer).split('');
    const details = task.targets.map((target, index) => ({
      label: target.label,
      actual: actual[index] || '',
      expected: expected[index] || '',
      correct: actual[index] === expected[index]
    }));
    const earned = details.filter(item => item.correct).length;
    return {
      correct: earned === details.length,
      earned,
      total: details.length,
      actual: actual.join(''),
      expected: expected.join(''),
      details
    };
  }

  function moscowDayKey(value) {
    const date = value instanceof Date ? value : new Date(value == null ? Date.now() : value);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function createProgress() {
    return {
      version: 1,
      tasks: {},
      daily: {},
      totals: { attempts: 0, exactCorrect: 0, earned: 0, possible: 0, timeMs: 0 },
      updatedAt: 0
    };
  }

  function sanitizeTaskProgress(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      attempts: Math.max(0, Number(source.attempts) || 0),
      correct: Math.max(0, Number(source.correct) || 0),
      wrong: Math.max(0, Number(source.wrong) || 0),
      earned: Math.max(0, Number(source.earned) || 0),
      possible: Math.max(0, Number(source.possible) || 0),
      mistakePending: Boolean(source.mistakePending),
      reviewLevel: Math.max(0, Math.min(REVIEW_INTERVALS.length - 1, Number(source.reviewLevel) || 0)),
      nextReviewAt: Math.max(0, Number(source.nextReviewAt) || 0),
      lastAttemptAt: Math.max(0, Number(source.lastAttemptAt) || 0),
      timeMs: Math.max(0, Number(source.timeMs) || 0)
    };
  }

  function sanitizeProgress(value) {
    const base = createProgress();
    if (!value || typeof value !== 'object') return base;
    for (const [id, item] of Object.entries(value.tasks || {})) base.tasks[id] = sanitizeTaskProgress(item);
    for (const [day, count] of Object.entries(value.daily || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) base.daily[day] = Math.max(0, Number(count) || 0);
    }
    const totals = value.totals || {};
    for (const key of Object.keys(base.totals)) base.totals[key] = Math.max(0, Number(totals[key]) || 0);
    base.updatedAt = Math.max(0, Number(value.updatedAt) || 0);
    return base;
  }

  function recordAttempt(progressValue, task, response, elapsedMs, nowValue) {
    const progress = sanitizeProgress(progressValue);
    const now = Number(nowValue) || Date.now();
    const elapsed = Math.max(0, Math.min(60 * 60 * 1000, Number(elapsedMs) || 0));
    const result = evaluate(task, response);
    const item = sanitizeTaskProgress(progress.tasks[task.id]);
    item.attempts += 1;
    item.correct += result.correct ? 1 : 0;
    item.wrong += result.correct ? 0 : 1;
    item.earned += result.earned;
    item.possible += result.total;
    item.timeMs += elapsed;
    item.lastAttemptAt = now;
    item.mistakePending = !result.correct;
    if (result.correct) {
      item.reviewLevel = Math.min(REVIEW_INTERVALS.length - 1, item.reviewLevel + 1);
      item.nextReviewAt = now + REVIEW_INTERVALS[item.reviewLevel];
    } else {
      item.reviewLevel = 0;
      item.nextReviewAt = now;
    }
    progress.tasks[task.id] = item;

    progress.totals.attempts += 1;
    progress.totals.exactCorrect += result.correct ? 1 : 0;
    progress.totals.earned += result.earned;
    progress.totals.possible += result.total;
    progress.totals.timeMs += elapsed;
    const day = moscowDayKey(now);
    progress.daily[day] = (progress.daily[day] || 0) + 1;
    progress.updatedAt = now;
    return { progress, result };
  }

  function intersects(values, selected) {
    if (!selected || !selected.length) return true;
    const set = selected instanceof Set ? selected : new Set(selected);
    return values.some(value => set.has(value));
  }

  function modeEligible(task, mode, progress, now) {
    const item = progress.tasks[task.id];
    if (mode === 'new') return !item || item.attempts === 0;
    if (mode === 'mistakes') return Boolean(item && item.mistakePending);
    if (mode === 'review') return Boolean(item && item.attempts > 0 && item.nextReviewAt <= now);
    return true;
  }

  function filterTasks(tasks, filtersValue, progressValue, nowValue) {
    const filters = filtersValue || {};
    const progress = sanitizeProgress(progressValue);
    const now = Number(nowValue) || Date.now();
    const typeSet = new Set(filters.types || []);
    const blockSet = new Set(filters.blocks || []);
    const topicSet = new Set(filters.topics || []);
    const output = [];
    const seen = new Set();
    for (const task of tasks || []) {
      if (seen.has(task.id)) continue;
      if (typeSet.size && !typeSet.has(task.type)) continue;
      if (blockSet.size && !intersects(task.blockIds, blockSet)) continue;
      if (topicSet.size && !intersects(task.topicCodes, topicSet)) continue;
      if (!modeEligible(task, filters.mode || 'mixed', progress, now)) continue;
      seen.add(task.id);
      output.push(task);
    }
    return output;
  }

  function shuffle(values, random) {
    const output = values.slice();
    const rng = typeof random === 'function' ? random : Math.random;
    for (let index = output.length - 1; index > 0; index -= 1) {
      const target = Math.floor(rng() * (index + 1));
      [output[index], output[target]] = [output[target], output[index]];
    }
    return output;
  }

  function buildSession(tasks, filters, progressValue, countValue, random, nowValue) {
    const progress = sanitizeProgress(progressValue);
    const count = [5, 10, 20].includes(Number(countValue)) ? Number(countValue) : 10;
    const eligible = filterTasks(tasks, filters, progress, nowValue);
    if ((filters && filters.mode) !== 'mixed') return shuffle(eligible, random).slice(0, count);

    const now = Number(nowValue) || Date.now();
    const scored = eligible.map(task => {
      const item = progress.tasks[task.id];
      let bucket = 3;
      if (!item || item.attempts === 0) bucket = 0;
      else if (item.mistakePending) bucket = 1;
      else if (item.nextReviewAt <= now) bucket = 2;
      return { task, bucket };
    });
    const ordered = [];
    for (let bucket = 0; bucket <= 3; bucket += 1) {
      ordered.push(...shuffle(scored.filter(item => item.bucket === bucket).map(item => item.task), random));
    }
    return ordered.slice(0, count);
  }

  function aggregate(tasks, progressValue, keyFn) {
    const progress = sanitizeProgress(progressValue);
    const map = new Map();
    for (const task of tasks || []) {
      const keys = [...new Set(keyFn(task))];
      const item = progress.tasks[task.id];
      for (const key of keys) {
        if (!map.has(key)) map.set(key, { key, available: 0, attempted: 0, exactCorrect: 0, earned: 0, possible: 0 });
        const stat = map.get(key);
        stat.available += 1;
        if (!item) continue;
        stat.attempted += item.attempts > 0 ? 1 : 0;
        stat.exactCorrect += item.correct;
        stat.earned += item.earned;
        stat.possible += item.possible;
      }
    }
    return [...map.values()];
  }

  function dueCount(tasks, progressValue, nowValue) {
    return filterTasks(tasks, { mode: 'review' }, progressValue, nowValue).length;
  }

  return Object.freeze({
    REVIEW_INTERVALS,
    digits,
    evaluate,
    moscowDayKey,
    createProgress,
    sanitizeProgress,
    recordAttempt,
    filterTasks,
    buildSession,
    aggregate,
    dueCount
  });
});
