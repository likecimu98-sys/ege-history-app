// state.js — управление состоянием, сохранение, SRS, пулы данных, ачивки
'use strict';

// --- Инициализация глобальных данных из data.js ---
window.task7Data = typeof task7Data !== 'undefined' ? task7Data : [];

// --- Глобальное состояние ---
window.state = {
    selectedChip: null,
    currentTask: 'task4',
    pendingTask: 'task4',
    pendingMode: 'normal',
    stats: {
        streak: 0,
        totalSolvedEver: 0,
        solvedByTask: { task3: 0, task4: 0, task5: 0, task7: 0 },
        flashcardsSolved: 0,
        eraStats: {},
        factStreaks: {},
        totalTimeSpent: 0,
        bestSpeedrunScore: 0,
        egePoints: 0,
        dailyStats: {},
        hwFlashcardsToSolve: 0,
        hwTask3: 0, hwTask4: 0, hwTask5: 0, hwTask7: 0,
        assignments: [],
        visualArchitectureProgress: {},
        visualArchitectureSolved: 0,
        visualPaintingProgress: {},
        visualPaintingSolved: 0,
        achievements: [],
        achievementsData: { nightOwls: 0, earlyBirds: 0, hwDone: 0, hwPerfect: 0, maxMistakes: 0, hwOnTime: 0, hwLate: 0, hwStreak: 0, hwStreakMax: 0 }
    },
    mistakesPool: [],
    currentTargetData: [],
    currentMode: 'normal',
    timeLeft: 0,
    timerInterval: null,
    hideLearned: true,
    isHomeworkMode: false,
    activeHw: null,          // {id, itemIndex} — текущий этап ДЗ в потоке
    hwTargetIndices: [],
    hwCurrentPool: [],
    answersRevealed: false,
    isTeacherAdmin: false,
    focusMode: false,
    studyIndex: 0,
    cultureLearningTab: 'base',
    currentVisualQuestion: null,
    currentVisualId: null,
    currentVisualCategory: null,
    errorStreak: 0,
    duel: {
        active: false, matchId: null, isPlayer1: false,
        oppName: '', myScore: 0, myCombo: 0, oppScore: 0, oppCombo: 0, searching: false
    }
};

// --- Прекомпилированные пулы ---
const precomputed = { task3: {}, task4: {}, task5: {}, task7: {} };
const periodsList = ['all', 'early', '18th', '19th', '20th'];

function romanCenturyToNumber(value) {
    const map = {
        i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
        xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
        xix: 19, xx: 20, xxi: 21,
    };
    return map[String(value || '').toLowerCase()] || 0;
}

function normalizeCultureCenturyText(text) {
    return String(text ?? '').replace(/\b([IVXLCDM]{1,6})(?:\s*[-–]\s*([IVXLCDM]{1,6}))?\s*(вв?\.?|век(?:а|е|ов)?)/gi, (match, a, b, suffix) => {
        const first = romanCenturyToNumber(a);
        const second = b ? romanCenturyToNumber(b) : 0;
        if (!first) return match;
        const normalizedSuffix = /^вв/i.test(suffix) ? 'вв.' : suffix.toLowerCase();
        return second ? `${first}-${second} ${normalizedSuffix}` : `${first} ${normalizedSuffix}`;
    });
}

function normalizeCultureCenturyLabels(value, seen) {
    if (typeof value === 'string') return normalizeCultureCenturyText(value);
    if (!value || typeof value !== 'object') return value;
    seen = seen || new Set();
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach((item, idx) => { value[idx] = normalizeCultureCenturyLabels(item, seen); });
        return value;
    }
    Object.keys(value).forEach(key => {
        value[key] = normalizeCultureCenturyLabels(value[key], seen);
    });
    return value;
}

// Нормализация подписей в визуальных данных (архитектура/живопись/культура).
// Эти данные грузятся в ФОНЕ уже после открытия приложения (см. index.html),
// поэтому нормализуем их отдельно — сразу после загрузки, а не на старте.
window.normalizeVisualData = function normalizeVisualData() {
    normalizeCultureCenturyLabels(window.visualArchitectureData);
    normalizeCultureCenturyLabels(window.visualPaintingData);
    normalizeCultureCenturyLabels(window.visualStudyData);
};

function initPrecomputed() {
    window.bigData   = typeof bigData   !== 'undefined' ? bigData   : (window.bigData   || []);
    window.task3Data = typeof task3Data !== 'undefined' ? task3Data : (window.task3Data || []);
    window.task5Data = typeof task5Data !== 'undefined' ? task5Data : (window.task5Data || []);
    window.task7Data = typeof task7Data !== 'undefined' ? task7Data : (window.task7Data || []);
    normalizeCultureCenturyLabels(window.task7Data);
    // window.visualArchitectureData / visualPaintingData / visualStudyData нормализуются
    // в window.normalizeVisualData() — они грузятся в фоне после открытия приложения.

    const totalItems = (window.bigData?.length || 0) + (window.task3Data?.length || 0) +
                       (window.task5Data?.length || 0) + (window.task7Data?.length || 0);
    if (totalItems === 0) {
        console.error('[data.js] База данных не загружена!');
        const errBanner = document.createElement('div');
        errBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--c-danger);color:white;text-align:center;padding:12px;font-weight:900;font-size:14px';
        errBanner.textContent = '⚠️ База вопросов не загружена. Обновите страницу.';
        document.body.prepend(errBanner);
    }

    // task5Data: присваиваем поле c по году
    window.task5Data.forEach(d => {
        if (!d.c) {
            const y = parseInt(d.year, 10) || 0;
            d.c = y < 1700 ? 'early' : y < 1800 ? '18th' : y < 1900 ? '19th' : '20th';
        }
    });

    const filterData = (data, p) => p === 'all' ? [...(data || [])] : (data || []).filter(d => d.c === p);
    periodsList.forEach(p => {
        precomputed.task3[p] = filterData(window.task3Data, p);
        precomputed.task4[p] = filterData(window.bigData, p);
        precomputed.task5[p] = filterData(window.task5Data, p);
        precomputed.task7[p] = filterData(window.task7Data, p);
    });
}

// --- Пулы данных ---
function getBasePool(period) {
    period = period || 'all';
    const task = window.state.currentTask;

    if (task === 'task7') {
        const baseData = window.task7Data || [];
        if (period === 'custom') {
            const startY = parseInt($('custom-year-start').value) || 0;
            const endY = parseInt($('custom-year-end').value) || 3000;
            return baseData.filter(d => { const y = getYearFromFact(d); return y >= startY && y <= endY; });
        }
        return period === 'all' ? [...baseData] : baseData.filter(d => d.c === period);
    }

    const baseData = (TASK_CONFIG[task] || TASK_CONFIG.task4).data();
    if (period === 'custom') {
        const startY = parseInt($('custom-year-start').value) || 0;
        const endY = parseInt($('custom-year-end').value) || 3000;
        return baseData.filter(d => { const y = getYearFromFact(d); return y >= startY && y <= endY; });
    }
    if (task === 'task3') {
        return period === 'all' ? [...baseData] : baseData.filter(d => d.c === period);
    }
    return (precomputed[task] && precomputed[task][period]) ||
        (period === 'all' ? [...baseData] : baseData.filter(d => d.c === period));
}

function getFilteredPool(period, limit) {
    limit = limit || 0;
    const now = Date.now();
    let pool = getBasePool(period);

    if (window.state.currentMode === 'mistakes') {
        let mistakes = window.state.mistakesPool
            .filter(m => m.task === window.state.currentTask)
            .map(m => m.fact);
        let expired = pool.filter(f => {
            const d = window.state.stats.factStreaks[factKey(f)];
            return d && d.level > 0 && d.nextReview <= now;
        });
        pool = [...mistakes, ...expired];
        const cfg = TASK_CONFIG[window.state.currentTask] || TASK_CONFIG.task4;
        const uniqueEvents = new Set();
        const uniquePool = [];
        for (const f of pool) {
            const k = cfg.dedupeKey(f);
            if (!uniqueEvents.has(k)) { uniqueEvents.add(k); uniquePool.push(f); }
        }
        pool = uniquePool;
        if (pool.length === 0) {
            showToast('🎉', 'Ошибок и забытых фактов нет! Возврат в Обучение.', 'bg-emerald-500', 'border-emerald-700');
            setTimeout(() => backToLobby(), 1500);
            return null;
        }
    } else {
        // Всегда скрываем выученные факты автоматически для всех
        const filtered = pool.filter(f => {
            const d = window.state.stats.factStreaks[factKey(f)];
            return !(d && d.level > 0 && d.nextReview > now);
        });
        // Если всё выучено в текущем фильтре — показываем весь пул (не блокируем)
        pool = filtered.length >= (limit || 1) ? filtered : pool;
    }
    return pool;
}

// --- SRS (Spaced Repetition System) ---
function updateFactSRS(fKey, isCorrect, isSure) {
    const now = Date.now();
    let data = window.state.stats.factStreaks[fKey] ||
        { points: 0, level: 0, nextReview: 0, lastUpdated: now };

    // Миграция старых форматов
    if (typeof data === 'number') {
        data = { points: data >= 3 ? 3 : data, level: data >= 3 ? 1 : 0,
                 nextReview: data >= 3 ? now + 12*3600000 : 0, lastUpdated: now };
    }
    if (data.streak !== undefined) {
        data = { points: data.streak >= 3 ? 3 : data.streak, level: data.streak >= 3 ? 1 : 0,
                 nextReview: data.streak >= 3 ? now + 12*3600000 : 0, lastUpdated: now };
    }

    if (!isCorrect) {
        data.points = 0; data.level = 0; data.nextReview = 0;
    } else if (data.level === 0) {
        data.points += isSure ? 1 : 0.7;
        if (data.points >= 3) {
            data.points = 3; data.level = 1;
            data.nextReview = now + 12 * 3600000;
        }
    } else {
        if (isSure) {
            const intervals = { 1: 24*3600000, 2: 3*24*3600000, 3: 7*24*3600000 };
            const nextLevel = Math.min(data.level + 1, 4);
            data.level = nextLevel;
            data.nextReview = now + (intervals[data.level - 1] || 7*24*3600000);
        } else {
            data.nextReview = now + 12 * 3600000;
        }
    }
    data.lastUpdated = now;
    window.state.stats.factStreaks[fKey] = data;
    return data;
}

// --- Сохранение ---
const STORAGE_KEY = 'ege_final_storage_v4';
const SAVE_FIELDS = [
    'streak', 'totalSolvedEver', 'solvedByTask', 'flashcardsSolved',
    'eraStats', 'factStreaks', 'hwFlashcardsToSolve', 'totalTimeSpent',
    'egePoints', 'hwTask3', 'hwTask4', 'hwTask5', 'hwTask7', 'assignments',
    'visualArchitectureProgress', 'visualArchitectureSolved',
    'visualPaintingProgress', 'visualPaintingSolved',
    'bestSpeedrunScore', 'dailyStats', 'achievements', 'achievementsData'
];

const MAX_MISTAKES_POOL = 200;

function buildSavePayload() {
    const s = window.state.stats;
    const payload = {};
    SAVE_FIELDS.forEach(k => { payload[k] = s[k]; });
    // FIX #5: обрезаем пул ошибок — оставляем последние
    if (window.state.mistakesPool.length > MAX_MISTAKES_POOL) {
        window.state.mistakesPool = window.state.mistakesPool.slice(-MAX_MISTAKES_POOL);
    }
    payload.mistakesPool = window.state.mistakesPool;
    payload.hideLearned = window.state.hideLearned;
    return payload;
}

function saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSavePayload()));
    localStorage.setItem('ege_pending_cloud_sync', '1');
}

let _cloudSyncTimer = null;
function scheduleSyncToCloud() {
    if (_cloudSyncTimer) clearTimeout(_cloudSyncTimer);
    _cloudSyncTimer = setTimeout(() => {
        _cloudSyncTimer = null;
        if (navigator.onLine === false) return;
        if (window.syncProgressToCloud) window.syncProgressToCloud();
    }, 10 * 1000);
}

function syncNow() {
    if (_cloudSyncTimer) { clearTimeout(_cloudSyncTimer); _cloudSyncTimer = null; }
    if (navigator.onLine === false) return;
    if (window.syncProgressToCloud) return window.syncProgressToCloud();
}

function saveProgress() {
    saveLocal();
    scheduleSyncToCloud();
}

// --- Статистика ---
function updateScoreAndStats(linesCount, isPerfectHw, egePointsToAdd) {
    isPerfectHw = isPerfectHw || false;
    egePointsToAdd = egePointsToAdd || 0;
    const s = window.state.stats;
    const curTask = window.state.currentTask || 'task4';
    s.totalSolvedEver += linesCount;
    if (!s.solvedByTask) s.solvedByTask = { task3: 0, task4: 0, task5: 0, task7: 0 };
    s.solvedByTask[curTask] = (s.solvedByTask[curTask] || 0) + linesCount;

    // ── ЕГЭ-баллы ──────────────────────────────────────────────────────────
    if (!s.egePoints) s.egePoints = 0;
    s.egePoints += egePointsToAdd;

    const today = getTodayString();
    if (!s.dailyStats[today]) s.dailyStats[today] = { timeSpent: 0, solved: 0 };
    s.dailyStats[today].solved += linesCount;
    const dtKey = 'solved' + curTask.charAt(0).toUpperCase() + curTask.slice(1);
    s.dailyStats[today][dtKey] = (s.dailyStats[today][dtKey] || 0) + linesCount;
    // Ежедневные ЕГЭ-баллы
    if (egePointsToAdd > 0) {
        s.dailyStats[today].egePoints = (s.dailyStats[today].egePoints || 0) + egePointsToAdd;
    }

    const h = new Date().getHours();
    if (h >= 0 && h < 5) s.achievementsData.nightOwls += linesCount;
    if (h >= 5 && h < 8) s.achievementsData.earlyBirds += linesCount;

    // ── ДЗ: засчитываем прогресс ──
    // lines/points идут в активный этап (если ученик в потоке ДЗ); learned-этапы пересчитываются живьём.
    if (window.state.activeHw && (linesCount > 0 || egePointsToAdd > 0)) {
        creditActiveHwItem(curTask, linesCount, egePointsToAdd);
        if (isPerfectHw) s.achievementsData.hwPerfect = (s.achievementsData.hwPerfect || 0) + 1;
    }
    if (Array.isArray(s.assignments) && s.assignments.length) refreshHwState();
    saveLocal();
    updateGlobalUI();
}

// --- Домашние задания (модель «набор подзаданий») ---
// ДЗ — это запись {id, deadline, assignedAt, status, completedAt, onTime, title, items[]}.
// items[i] = {task, period, metric:'lines'|'points'|'learned', goal, progress, done}.
// Новое ДЗ НЕ затирает старое; просроченные остаются доступными до выполнения.
// Метрики: 'lines' (строки), 'points' (баллы ЕГЭ) — накапливаются при решении ИМЕННО этого этапа;
//          'learned' — считается живьём: сколько фактов периода уже выучено (SRS level>0).

const HW_EPOCHS = ['early', '18th', '19th', '20th'];

function hwIsOnTime(deadline, whenMs) {
    if (!deadline) return true;
    return whenMs <= new Date(deadline + 'T23:59:59').getTime();
}

// Сколько фактов выучено / всего в (задание, период). Дедуп по SRS-ключу.
function learnedCountInPeriod(task, period, yearStart, yearEnd) {
    const cfg = (typeof TASK_CONFIG !== 'undefined') ? TASK_CONFIG[task] : null;
    if (!cfg || !cfg.data) return { learned: 0, total: 0 };
    const data = cfg.data() || [];
    const streaks = window.state.stats.factStreaks || {};
    const seen = new Set();
    let learned = 0, total = 0;
    const isCustom = period === 'custom' && yearStart !== undefined;
    data.forEach(f => {
        if (isCustom) {
            const y = getYearFromFact(f);
            if (y < yearStart || y > yearEnd) return;
        } else if (period && period !== 'all' && f.c !== period) return;
        let k; try { k = cfg.keyFn(f); } catch (e) { return; }
        if (seen.has(k)) return;
        seen.add(k);
        total++;
        if (window.isFactLearned && window.isFactLearned(streaks[k])) learned++;
    });
    return { learned, total };
}
window.learnedCountInPeriod = learnedCountInPeriod;

// Текущее значение прогресса этапа (для learned — живой счёт выученных).
function hwItemProgress(item) {
    if (!item) return 0;
    // Зубрёжка: прогресс = число выученных в тренажёре фактов (cram:* в factStreaks).
    if (item.task === 'cram') return Math.min(item.goal || 0, (window.cramLearnedCount ? window.cramLearnedCount() : 0));
    // Выучивание = живой счёт выученных фактов периода по ОБЩЕЙ системе приложения (isFactLearned).
    // Уже выученные факты идут в автозачёт; прогресс в ДЗ и в обычной нарешке — один и тот же счётчик.
    if (item.metric === 'learned') return Math.min(item.goal || 0, learnedCountInPeriod(item.task, item.period, item.yearStart, item.yearEnd).learned);
    return Math.min(item.goal || 0, item.progress || 0);
}
window.hwItemProgress = hwItemProgress;
function hwItemDone(item) { return hwItemProgress(item) >= (item.goal || 0); }
window.hwItemDone = hwItemDone;
function hwItemRemaining(item) { return Math.max(0, (item.goal || 0) - hwItemProgress(item)); }
window.hwItemRemaining = hwItemRemaining;

// Нормализуем входящую запись в ДЗ с items (поддержка старого плоского формата {task,total}).
function normalizeAssignmentRec(rec) {
    let items = Array.isArray(rec.items) ? rec.items : null;
    if (!items) {
        // legacy/простой формат — один этап по строкам
        items = [{ task: rec.task || 'task4', period: rec.period || 'all', metric: 'lines', goal: Number(rec.total) || 0 }];
    }
    items = items.map(it => {
        const o = {
            task: it.task || 'task4',
            period: it.period || 'all',
            metric: (it.metric === 'points' || it.metric === 'learned') ? it.metric : 'lines',
            goal: Number(it.goal) || 0,
            progress: Number(it.progress) || 0,
            done: false
        };
        if (o.period === 'custom') { o.yearStart = Number(it.yearStart) || 862; o.yearEnd = Number(it.yearEnd) || 2026; }
        else if (o.task === 'cram' && it.yearStart && it.yearEnd) { o.yearStart = Number(it.yearStart); o.yearEnd = Number(it.yearEnd); } // диапазон зубрёжки не терять
        return o;
    });
    return {
        id: rec.id,
        title: rec.title || null,
        deadline: rec.deadline || null,
        assignedAt: rec.assignedAt || Date.now(),
        status: 'active',
        completedAt: null,
        onTime: null,
        items
    };
}

// Пересчёт legacy-зеркала (hwFlashcardsToSolve, hwTaskX, teacher_hw_deadline) из активных заданий —
// чтобы баннер/шапка/бейдж работали. total = сумма остатка по всем этапам активных ДЗ.
function recomputeHwMirror() {
    const s = window.state.stats;
    const per = { task3: 0, task4: 0, task5: 0, task7: 0 };
    let total = 0, nearest = null;
    (s.assignments || []).forEach(a => {
        if (a.status !== 'active') return;
        (a.items || []).forEach(it => {
            const rem = hwItemRemaining(it);
            if (rem > 0 && per[it.task] !== undefined) per[it.task] += rem;
            total += rem;
        });
        if (a.deadline && (!nearest || a.deadline < nearest)) nearest = a.deadline;
    });
    s.hwTask3 = per.task3; s.hwTask4 = per.task4; s.hwTask5 = per.task5; s.hwTask7 = per.task7;
    s.hwFlashcardsToSolve = total;
    try {
        if (nearest) localStorage.setItem('teacher_hw_deadline', nearest);
        else localStorage.removeItem('teacher_hw_deadline');
    } catch (e) {}
}
window.recomputeHwMirror = recomputeHwMirror;

// Завершить ДЗ (все этапы выполнены): статус, вовремя/опоздание, ачивки, тост.
function completeAssignment(a) {
    const s = window.state.stats;
    a.status = 'done';
    a.completedAt = Date.now();
    a.onTime = hwIsOnTime(a.deadline, a.completedAt);
    s.achievementsData.hwDone = (s.achievementsData.hwDone || 0) + 1;
    if (a.onTime) {
        s.achievementsData.hwOnTime = (s.achievementsData.hwOnTime || 0) + 1;
        s.achievementsData.hwStreak = (s.achievementsData.hwStreak || 0) + 1;
        s.achievementsData.hwStreakMax = Math.max(s.achievementsData.hwStreakMax || 0, s.achievementsData.hwStreak);
        setTimeout(() => showToast('✅', 'ДЗ сдано вовремя!', 'bg-emerald-500', 'border-emerald-700'), 1400);
    } else {
        s.achievementsData.hwLate = (s.achievementsData.hwLate || 0) + 1;
        s.achievementsData.hwStreak = 0;
        setTimeout(() => showToast('⌛', 'ДЗ сдано (с опозданием)', 'bg-amber-500', 'border-amber-700'), 1400);
    }
}

// Пересчитать статусы этапов/ДЗ (learned-этапы — живьём), обновить зеркало, проверить ачивки.
function refreshHwState() {
    const s = window.state.stats;
    if (!Array.isArray(s.assignments)) { s.assignments = []; return; }
    let anyCompleted = false;
    s.assignments.forEach(a => {
        if (a.status !== 'active') return;
        (a.items || []).forEach(it => { it.done = hwItemDone(it); });
        if ((a.items || []).length && a.items.every(it => it.done)) {
            completeAssignment(a);
            anyCompleted = true;
        }
    });
    recomputeHwMirror();
    if (anyCompleted && typeof checkAchievements === 'function') checkAchievements();
    return anyCompleted;
}
window.refreshHwState = refreshHwState;

// Добавить ДЗ от учителя (идемпотентно по id). Возвращает true, если запись новая.
function ingestAssignment(rec) {
    const s = window.state.stats;
    if (!rec || !rec.id) return false;
    if (!Array.isArray(s.assignments)) s.assignments = [];
    if (s.assignments.some(a => a.id === rec.id)) return false;
    s.assignments.push(normalizeAssignmentRec(rec));
    window.state.isHomeworkMode = true;
    // Ограничиваем историю выполненных, чтобы не раздувать сохранение
    const done = s.assignments.filter(a => a.status === 'done');
    if (done.length > 60) {
        const keep = new Set(done.slice(-60).map(a => a.id));
        s.assignments = s.assignments.filter(a => a.status !== 'done' || keep.has(a.id));
    }
    return true;
}
window.ingestAssignment = ingestAssignment;

// Отзыв ДЗ учителем (вариант А): убираем у себя только НЕвыполненные задания с отозванными id.
// Уже сданные (status==='done') оставляем — отметка и достижение сохраняются. Возвращает число убранных.
function reconcileRevokedAssignments(revokedIds) {
    const s = window.state && window.state.stats;
    if (!s || !Array.isArray(s.assignments)) return 0;
    const set = new Set(revokedIds || []);
    if (!set.size) return 0;
    const before = s.assignments.length;
    s.assignments = s.assignments.filter(a => !(a && set.has(a.id) && a.status !== 'done'));
    return before - s.assignments.length;
}
window.reconcileRevokedAssignments = reconcileRevokedAssignments;

// Засчитать прогресс активному этапу ДЗ (lines/points). learned-этапы обновляются сами в refreshHwState.
function creditActiveHwItem(task, lines, points) {
    const s = window.state.stats;
    const ah = window.state.activeHw;
    if (!ah) return;
    const a = (s.assignments || []).find(x => x.id === ah.id && x.status === 'active');
    if (!a) return;
    const it = (a.items || [])[ah.itemIndex];
    if (!it || it.task !== task) return;
    if (it.metric === 'lines') it.progress = (it.progress || 0) + (lines || 0);
    else if (it.metric === 'points') it.progress = (it.progress || 0) + (points || 0);
}
window.creditActiveHwItem = creditActiveHwItem;

// --- Ачивки ---
function checkAchievements() {
    if (!window.state.stats.achievements) window.state.stats.achievements = [];
    if (!window.state.stats.achievementsData) window.state.stats.achievementsData = { nightOwls: 0, earlyBirds: 0, hwDone: 0, hwPerfect: 0, maxMistakes: 0 };
    let unlockedAny = false;
    if (typeof achievementsList !== 'undefined') {
        achievementsList.forEach(ach => {
            if (!window.state.stats.achievements.includes(ach.id) && ach.check(window.state.stats)) {
                window.state.stats.achievements.push(ach.id);
                unlockedAny = true;
                showToast('🏆', `Ачивка открыта: ${ach.name}!`, 'bg-yellow-500', 'border-yellow-700');
            }
        });
    }
    if (unlockedAny) saveProgress();
}

// --- Загрузка из localStorage ---
function loadFromStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        const savedStats = parsed.stats || parsed;
        Object.assign(window.state.stats, savedStats);
        if (savedStats.streak !== undefined) window.state.stats.streak = savedStats.streak;
        const savedMistakes = parsed.mistakesPool || savedStats.mistakesPool;
        if (savedMistakes) {
            window.state.mistakesPool = savedMistakes;
            if (window.state.mistakesPool.length > MAX_MISTAKES_POOL) {
                window.state.mistakesPool = window.state.mistakesPool.slice(-MAX_MISTAKES_POOL);
            }
        }
        window.state.hideLearned = true; // всегда скрываем выученное автоматически

        // Гарантируем структуру
        if (!window.state.stats.dailyStats) window.state.stats.dailyStats = {};
        if (window.state.stats.flashcardsSolved === undefined) window.state.stats.flashcardsSolved = 0;
        if (window.state.stats.hwFlashcardsToSolve === undefined) window.state.stats.hwFlashcardsToSolve = 0;
        if (!Array.isArray(window.state.stats.assignments)) window.state.stats.assignments = [];
        if (!window.state.stats.achievements) window.state.stats.achievements = [];
        if (!window.state.stats.achievementsData) window.state.stats.achievementsData = {};
        {
            const ad = window.state.stats.achievementsData;
            ['nightOwls','earlyBirds','hwDone','hwPerfect','maxMistakes','hwOnTime','hwLate','hwStreak','hwStreakMax']
                .forEach(k => { if (ad[k] === undefined) ad[k] = 0; });
        }

        // Нормализуем ДЗ старого плоского формата ({task,total,remaining}) → формат с items.
        if (Array.isArray(window.state.stats.assignments)) {
            window.state.stats.assignments = window.state.stats.assignments.map(a => {
                if (a && Array.isArray(a.items)) return a;             // уже новый формат
                if (!a) return a;
                const total = Number(a.total) || 0;
                const remaining = (a.remaining === undefined) ? total : Number(a.remaining) || 0;
                const norm = normalizeAssignmentRec({ id: a.id, deadline: a.deadline, assignedAt: a.assignedAt, task: a.task, total });
                norm.items[0].progress = Math.max(0, total - remaining); // сохраняем уже сделанное
                norm.status = a.status || 'active';
                norm.completedAt = a.completedAt || null;
                norm.onTime = (a.onTime !== undefined) ? a.onTime : null;
                return norm;
            }).filter(Boolean);
        }

        // Миграция со старой модели ДЗ (единый счётчик) → отдельные задания.
        // Чтобы текущее непогашенное ДЗ у уже существующих учеников появилось в новой вкладке.
        if ((!window.state.stats.assignments || window.state.stats.assignments.length === 0)
            && (window.state.stats.hwFlashcardsToSolve || 0) > 0) {
            const dl = (() => { try { return localStorage.getItem('teacher_hw_deadline') || null; } catch (e) { return null; } })();
            const per = {
                task3: window.state.stats.hwTask3 || 0,
                task4: window.state.stats.hwTask4 || 0,
                task5: window.state.stats.hwTask5 || 0,
                task7: window.state.stats.hwTask7 || 0
            };
            const anyPer = per.task3 + per.task4 + per.task5 + per.task7;
            const mk = (task, n) => ingestAssignment({
                id: 'legacy_' + task + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                task, total: n, deadline: dl, assignedAt: Date.now()
            });
            if (anyPer > 0) {
                Object.keys(per).forEach(t => { if (per[t] > 0) mk(t, per[t]); });
            } else {
                mk('task4', window.state.stats.hwFlashcardsToSolve);
            }
        }
        if (typeof refreshHwState === 'function') refreshHwState();
        if (!window.state.stats.solvedByTask) window.state.stats.solvedByTask = { task3: 0, task4: 0, task5: 0, task7: 0 };
        if (!window.state.stats.egePoints) window.state.stats.egePoints = 0;
        if (!window.state.stats.visualArchitectureProgress) window.state.stats.visualArchitectureProgress = {};
        if (window.state.stats.visualArchitectureSolved === undefined) window.state.stats.visualArchitectureSolved = 0;
        if (!window.state.stats.visualPaintingProgress) window.state.stats.visualPaintingProgress = {};
        if (window.state.stats.visualPaintingSolved === undefined) window.state.stats.visualPaintingSolved = 0;

        // Миграция factStreaks
        const now = Date.now();
        for (const key in window.state.stats.factStreaks) {
            let data = window.state.stats.factStreaks[key];
            if (typeof data === 'number') {
                window.state.stats.factStreaks[key] = {
                    points: data >= 3 ? 3 : data, level: data >= 3 ? 1 : 0,
                    nextReview: data >= 3 ? now + 12*3600000 : 0, lastUpdated: now
                };
            } else if (data && data.streak !== undefined) {
                window.state.stats.factStreaks[key] = {
                    points: data.streak >= 3 ? 3 : data.streak, level: data.streak >= 3 ? 1 : 0,
                    nextReview: data.streak >= 3 ? now + 12*3600000 : 0, lastUpdated: data.lastUpdated || now
                };
            }
        }

        // Миграция eraStats
        const eras = window.state.stats.eraStats || {};
        const oldFormat = TASK_EPOCHS.some(k => eras[k] && typeof eras[k].correct === 'number');
        if (oldFormat) {
            const migrated = { task3: {}, task4: {}, task5: {}, task7: {} };
            for (const era of TASK_EPOCHS) {
                if (eras[era]) {
                    migrated.task4[era] = { ...eras[era] };
                    ['task3', 'task5', 'task7'].forEach(tk => { migrated[tk][era] = { correct: 0, total: 0 }; });
                }
            }
            window.state.stats.eraStats = migrated;
        }
        for (const tk of TASK_LIST) {
            if (!window.state.stats.eraStats[tk]) window.state.stats.eraStats[tk] = {};
            for (const era of TASK_EPOCHS) {
                if (!window.state.stats.eraStats[tk][era]) window.state.stats.eraStats[tk][era] = { correct: 0, total: 0 };
            }
        }
    } catch (e) {
        console.error('[loadFromStorage]', e);
    }
}

// --- Прогноз ЕГЭ ---
function estimateEGEScore(stats) {
    const streaks = stats.factStreaks || {};
    const es = stats.eraStats || {};
    const ERAS = TASK_EPOCHS;
    const W = ERA_WEIGHTS;

    let d4 = 0, d5 = 0, d3 = 0, d7 = 0;
    Object.entries(streaks).forEach(([k, v]) => {
        if (!v || typeof v !== 'object') return;
        const learned = v.level >= 1 || (v.level === 0 && (v.streak || 0) >= 3);
        if (!learned) return;
        if (k.startsWith('t5_'))      d5++;
        else if (k.startsWith('t7_')) d7++;
        else if (k.startsWith('t3_')) d3++;
        else                          d4++;
    });

    const s4 = 20 * Math.min(d4 / 500, 1);
    const s3 = 17 * Math.min(d3 / 150, 1);
    const s5 = 16 * Math.min(d5 / 250, 1);
    const s7 = 12 * Math.min(d7 / 180, 1);
    const factBase = s4 + s5 + s3 + s7;

    const isNew = !!(es.task4 || es.task3);
    const eTot = {};
    let sumT = 0;
    ERAS.forEach(era => {
        let t = 0;
        (isNew ? TASK_LIST : [null]).forEach(tk => {
            const e = tk ? (es[tk] || {})[era] : es[era];
            if (e) t += e.total || 0;
        });
        eTot[era] = t;
        sumT += t;
    });

    let pen = 0, minR = 1, weakEra = null;
    if (sumT >= 40) {
        ERAS.forEach(era => {
            const a = eTot[era] / sumT, ex = W[era];
            const r = a / ex;
            if (r < minR) { minR = r; weakEra = era; }
            if (a < ex * 0.5) pen += ((ex * 0.5 - a) / (ex * 0.5)) * W[era] * 25;
        });
    }
    pen = Math.min(pen, 25);

    let tc = 0, tt = 0;
    (isNew ? TASK_LIST : [null]).forEach(tk => {
        ERAS.forEach(era => {
            const e = tk ? (es[tk] || {})[era] : es[era];
            if (e) { tc += e.correct || 0; tt += e.total || 0; }
        });
    });
    const accAdj = tt >= 30 ? Math.max(-15, Math.min(15, (tc / tt - 0.87) * 200)) : 0;

    const ceil = sumT >= 40 ? Math.round(55 + 45 * Math.min(minR, 1)) : 100;
    const raw = 20 + factBase - pen + accAdj;
    const score = Math.max(20, Math.min(100, Math.min(ceil, Math.round(raw))));

    const ERA_NAMES = { early: 'До XVIII в.', '18th': 'XVIII в.', '19th': 'XIX в.', '20th': 'XX в.' };
    return {
        score, ceiling: ceil, factBase: Math.round(factBase),
        pen: Math.round(pen), accAdj: Math.round(accAdj),
        d4, d5, d3, d7, s4, s5, s3, s7,
        weakEra: weakEra ? ERA_NAMES[weakEra] : null,
        accuracy: tt >= 30 ? Math.round(tc / tt * 100) : null
    };
}

// --- Прогресс по заданиям ---
function getTaskProgress(task) {
    const streaks = window.state.stats.factStreaks || {};
    let learned = 0;
    const cfg = TASK_CONFIG[task];
    const prefix = cfg ? (cfg.prefix || null) : null;

    for (const [key, val] of Object.entries(streaks)) {
        const match = prefix
            ? key.startsWith(prefix)
            : (!key.startsWith('t5_') && !key.startsWith('t7_') && !key.startsWith('t3_') &&
               !key.startsWith('vp_') && !key.startsWith('va_') && !key.startsWith('vm_'));
        if (match && window.isFactLearned(val)) learned++;
    }

    let total = 0;
    try { total = (TASK_CONFIG[task] || TASK_CONFIG.task4).data().length; } catch (e) {}
    return { learned, total: total || 1 };
}

function updateProgressBars() {
    TASK_LIST.forEach(task => {
        const info = getTaskProgress(task);
        const pct = Math.min(100, Math.round((info.learned / info.total) * 100));
        const bar = $('progress-bar-' + task);
        const txt = $('progress-text-' + task);
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = info.learned + ' / ' + info.total + ' выучено';
    });
}

// Заглушки для облачных функций (firebase-sync.js перезапишет)
window.loadProgressFromCloud = async function() {};
window.syncProgressToCloud = async function() {};
window.loadClassProgress = function() {};
