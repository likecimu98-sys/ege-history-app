// state.js — управление состоянием, сохранение, SRS, пулы данных, ачивки
'use strict';

// --- Инициализация глобальных данных из data.js ---
window.task1Data = typeof task1Data !== 'undefined' ? task1Data : [];
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
        solvedByTask: { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 },
        flashcardsSolved: 0,
        eraStats: {},
        factStreaks: {},
        totalTimeSpent: 0,
        timeByTask: { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 }, // секунды в игре по заданиям
        bestSpeedrunScore: 0,
        egePoints: 0,
        dailyStats: {},
        hwFlashcardsToSolve: 0,
        hwTask1: 0, hwTask3: 0, hwTask4: 0, hwTask5: 0, hwTask7: 0,
        assignments: [],
        duelElo: 1000, duelGames: 0, duelWins: 0, duelLosses: 0, duelDraws: 0,
        matchBestMs: 0, matchGames: 0,   // режим «Подбор» (Quizlet Match): рекорд-время и число раундов
        vovLearned: {},                  // режим «ВОВ» (задание 8, старый образец): id задания → true (выучено)
        mockExams: { active: null, history: [] }, // пробник 1–12: незавершённая попытка + история
        mockExamMistakes: [],            // долговечная история ошибок в пробниках и цельных заданиях ФИПИ
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
const precomputed = { task1: {}, task3: {}, task4: {}, task5: {}, task7: {} };
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

// ── Согласование appliesToIds задания 7 (защита от двойных ответов) ──
// 1) Один и тот же (нормализованный) текст характеристики может принадлежать
//    нескольким строкам с РАЗНЫМИ appliesToIds (век-генерики, «Автор — …»
//    с разным набором пробелов) — движок проверяет только свою строку.
//    Объединяем appliesToIds всех владельцев текста.
// 2) Тематические группы: авторские трейты и «посвящено Гражданской войне»
//    применимы ко всем культурам группы (база не знает о новых строках ФИПИ).
function unifyTask7Applies(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const tnorm = s => String(s || '').toLowerCase().replace(/ё/g, 'е')
        .replace(/[«»„“”"']/g, '').replace(/[—–]/g, '-')
        .replace(/\.\s+/g, '.').replace(/\s+/g, ' ').trim();
    const variantsOf = r => (Array.isArray(r.traitVariants) && r.traitVariants.length ? r.traitVariants : [r.trait]).filter(Boolean);
    const addAll = (r, ids) => {
        const cur = new Set((Array.isArray(r.appliesToIds) ? r.appliesToIds : [r.id])
            .map(x => parseInt(x, 10)).filter(Number.isFinite));
        ids.forEach(i => cur.add(i));
        r.appliesToIds = [...cur].sort((a, b) => a - b);
    };
    // (1) текст-двойники
    const byText = {};
    rows.forEach(r => variantsOf(r).forEach(v => (byText[tnorm(v)] = byText[tnorm(v)] || []).push(r)));
    for (const owners of Object.values(byText)) {
        if (owners.length < 2) continue;
        const uni = new Set();
        owners.forEach(r => (Array.isArray(r.appliesToIds) ? r.appliesToIds : [r.id])
            .forEach(i => { const n = parseInt(i, 10); if (Number.isFinite(n)) uni.add(n); }));
        owners.forEach(r => addAll(r, uni));
    }
    // (2) тематические группы
    const GROUPS = [
        [/солженицын/i, [130, 157]],
        [/нобелевск\w+ преми/i, [104, 106, 130, 133, 157]],
        [/м\.\s*а\.\s*булгаков/i, [110, 177, 178]],
        [/п\.\s*и\.\s*чайковский/i, [70, 169]],
        [/римский-корсаков/i, [97, 154]],
        [/э\.\s*а\.\s*рязанов/i, [129, 164]],
        [/ф\.\s*м\.\s*достоевский/i, [149, 150, 151]],
        [/л\.\s*н\.\s*толстой/i, [155, 156]],
        [/(посвящен\w+|речь ид[её]т|повествует)[^.]*гражданск\w+ войн/i, [104, 106, 108, 110, 163, 178]],
        // Обобщающая характеристика «участник/учредитель Товарищества передвижников»
        // истинна для ЛЮБОГО передвижника → в одной таблице не должно быть двух
        // передвижников, если ответ одного — эта групповая характеристика (иначе она
        // подходит и ко второму). Даём всем групповым трейтам полный список id, чтобы
        // сработал гейт _task7CanUseAsTarget. Авторские трейты («Автор — Суриков»)
        // остаются узкими — две АВТОРСКИЕ строки соседствовать могут (двойного ответа нет).
        [/передвижник|передвижных художественных/i, [71, 72, 74, 90, 93, 94, 95, 96, 158]],
    ];
    const idSet = new Set(rows.map(r => parseInt(r.id, 10)));
    rows.forEach(r => {
        variantsOf(r).forEach(v => {
            for (const [re, ids] of GROUPS) {
                if (re.test(v)) addAll(r, ids.filter(i => idSet.has(i)));
            }
        });
    });
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
    window.task1Data = typeof task1Data !== 'undefined' ? task1Data : (window.task1Data || []);
    window.task3Data = typeof task3Data !== 'undefined' ? task3Data : (window.task3Data || []);
    window.task5Data = typeof task5Data !== 'undefined' ? task5Data : (window.task5Data || []);
    window.task7Data = typeof task7Data !== 'undefined' ? task7Data : (window.task7Data || []);
    normalizeCultureCenturyLabels(window.task7Data);
    unifyTask7Applies(window.task7Data);
    // window.visualArchitectureData / visualPaintingData / visualStudyData нормализуются
    // в window.normalizeVisualData() — они грузятся в фоне после открытия приложения.

    const totalItems = (window.bigData?.length || 0) + (window.task1Data?.length || 0) + (window.task3Data?.length || 0) +
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
        precomputed.task1[p] = filterData(window.task1Data, p);
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

// Засчитать норму дня от свайпа/подбора (решение Q2: считаются как обычные строки —
// и в дневную норму, и в лимит). Лёгкая функция без побочек ДЗ/ЕГЭ-баллов; сохранение
// и обновление UI делают вызывающие при закрытии режима.
window.creditNorm = function (n, task) {
    n = Number(n) || 0; if (n <= 0) return;
    const s = window.state.stats;
    const today = getTodayString();
    if (!s.dailyStats[today]) s.dailyStats[today] = { timeSpent: 0, solved: 0 };
    s.dailyStats[today].solved += n;
    s.totalSolvedEver = (s.totalSolvedEver || 0) + n;
    if (task && s.solvedByTask) s.solvedByTask[task] = (s.solvedByTask[task] || 0) + n;
};

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
        // Фокус зависит от кнопки:
        //  • «Разбор ошибок» (mistakeFocus) → только ошибки (добираем просроченными, если мало);
        //  • «Повторить N фактов» (reviewFocus) → только просроченные, если хватает на таблицу;
        //  • иначе — ошибки + просроченные вместе.
        if (window.state.mistakeFocus && mistakes.length >= 1) {
            pool = mistakes.length >= (limit || 1) ? [...mistakes] : [...mistakes, ...expired];
        } else if (window.state.reviewFocus && expired.length >= (limit || 1)) {
            pool = [...expired];
        } else {
            pool = [...mistakes, ...expired];
        }
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
        // Скрываем выученные-и-не-просроченные факты. Из оставшихся («свежих» =
        // не тронутые + в процессе + просроченные) приоритет НОВОМУ: если совсем
        // невиданных хватает на таблицу — показываем только их, иначе весь свежий набор.
        const fs = window.state.stats.factStreaks;

        // БЛЕНДИНГ (Q1): каждая 3-я таблица обычного потока — целиком повтор/ошибки того
        // же задания, если их хватает на таблицу. Так «новое» естественно перемежается
        // разбором, а таблица остаётся внутренне корректной (проходит валидатор и гейты
        // анти-двойных-ответов, как любая другая). Не трогает ДЗ и явные режимы ошибок/повтора.
        if (window.state.currentMode === 'normal' && !window.state.isHomeworkMode
            && !window.state.mistakeFocus && !window.state.reviewFocus) {
            window.state._normalTableTick = (window.state._normalTableTick || 0) + 1;
            if (window.state._normalTableTick % 3 === 0) {
                const task = window.state.currentTask;
                const cfg = TASK_CONFIG[task] || TASK_CONFIG.task4;
                const mist = (window.state.mistakesPool || []).filter(m => m.task === task).map(m => m.fact);
                const exp = pool.filter(f => { const d = fs[factKey(f)]; return d && d.level > 0 && d.nextReview <= now; });
                const seen = new Set(); const blend = [];
                for (const f of [...mist, ...exp]) { const k = cfg.dedupeKey(f); if (!seen.has(k)) { seen.add(k); blend.push(f); } }
                if (blend.length >= (limit || 1)) { window.state._blendTable = true; return blend; }
            }
            window.state._blendTable = false;
        }

        const isFresh = f => { const d = fs[factKey(f)]; return !(d && d.level > 0 && d.nextReview > now); };
        const fresh = pool.filter(isFresh);
        if (fresh.length >= (limit || 1)) {
            // «Новое» = ещё НЕ выученное (level<1): и невиданное, и начатое-но-не-освоенное.
            // Если такого хватает на таблицу — показываем только его (просроченные-выученные
            // пойдут в отдельную ветку «Повторить»), иначе весь свежий набор.
            const unlearned = fresh.filter(f => { const d = fs[factKey(f)]; return !(d && d.level >= 1); });
            pool = unlearned.length >= (limit || 1) ? unlearned : fresh;
        } else if (fresh.length > 0) {
            // Свежего мало (период почти пройден) — показываем его и добираем немного
            // выученными, чтобы таблица заполнилась. Раньше здесь перезапускался ВЕСЬ пул —
            // из-за этого выученные факты крутились по кругу («одни и те же задания»).
            const learned = pool.filter(f => !isFresh(f));
            pool = fresh.concat(learned.slice(0, Math.max((limit || 1), 6)));
        }
        // else: совсем ничего свежего — оставляем полный пул (умная кнопка сюда уже не ведёт)
    }
    return pool;
}

// --- SRS (Spaced Repetition System) ---
// Интервалы повторения заданы в ДНЯХ и рассчитаны под реальный ритм
// 3-4 захода в неделю. Раньше первые шаги были в часах (12ч/1д/3д) — при
// таком ритме они не работали: всё выученное всегда оказывалось «просрочено».
// Лесенка по уровням: 1→2д, 2→5д, 3→12д, 4→30д, 5→60д (фон).
// ±10% разброса — чтобы выученные факты не всплывали все в один день.
const SRS_DAY = 24 * 3600000;
const SRS_REVIEW_DAYS = { 1: 2, 2: 5, 3: 12, 4: 30, 5: 60 };
const SRS_MAX_LEVEL = 5;
const SRS_HARD_LAPSES = 4; // столько «слётов» выученного факта — и он «трудный»
function _srsNext(level) {
    const days = SRS_REVIEW_DAYS[level] || SRS_REVIEW_DAYS[SRS_MAX_LEVEL];
    return Math.round(days * SRS_DAY * (0.9 + Math.random() * 0.2));
}

function updateFactSRS(fKey, isCorrect, isSure) {
    const now = Date.now();
    let data = window.state.stats.factStreaks[fKey] ||
        { points: 0, level: 0, nextReview: 0, lastUpdated: now };

    // Миграция старых форматов
    if (typeof data === 'number') {
        data = { points: data >= 3 ? 3 : data, level: data >= 3 ? 1 : 0,
                 nextReview: data >= 3 ? now + SRS_REVIEW_DAYS[1] * SRS_DAY : 0, lastUpdated: now };
    }
    if (data.streak !== undefined) {
        data = { points: data.streak >= 3 ? 3 : data.streak, level: data.streak >= 3 ? 1 : 0,
                 nextReview: data.streak >= 3 ? now + SRS_REVIEW_DAYS[1] * SRS_DAY : 0, lastUpdated: now };
    }

    if (!isCorrect) {
        if (data.level === 0) {
            // Ещё заучиваем — сбрасываем счётчик очков, факт сразу обратно в пул
            data.points = 0; data.nextReview = 0;
        } else {
            // Выученный факт «слетел» — мягкий откат на пару ступеней, НЕ в ноль
            data.lapses = (data.lapses || 0) + 1;
            data.level = Math.max(1, data.level - 2);
            data.points = 3;
            data.nextReview = now + SRS_DAY; // вернём на ближайший заход
            if (data.lapses >= SRS_HARD_LAPSES) data.hard = true;
        }
    } else if (data.level === 0) {
        data.points += isSure ? 1 : 0.7;
        if (data.points >= 3) {
            data.points = 3; data.level = 1;
            data.nextReview = now + _srsNext(1);
        }
    } else if (isSure) {
        data.level = Math.min(data.level + 1, SRS_MAX_LEVEL);
        data.nextReview = now + _srsNext(data.level);
    } else {
        // Верно, но «сомневаюсь» — уровень не растёт, закрепим на ближайшем заходе
        data.nextReview = now + SRS_DAY;
    }
    data.lastUpdated = now;
    window.state.stats.factStreaks[fKey] = data;
    return data;
}

// --- Сохранение ---
const STORAGE_KEY = 'ege_final_storage_v4';
const SAVE_FIELDS = [
    'streak', 'totalSolvedEver', 'solvedByTask', 'flashcardsSolved',
    'eraStats', 'factStreaks', 'hwFlashcardsToSolve', 'totalTimeSpent', 'timeByTask',
    'egePoints', 'hwTask1', 'hwTask3', 'hwTask4', 'hwTask5', 'hwTask7', 'assignments',
    'visualArchitectureProgress', 'visualArchitectureSolved',
    'visualPaintingProgress', 'visualPaintingSolved',
    'bestSpeedrunScore', 'dailyStats', 'achievements', 'achievementsData',
    'duelElo', 'duelGames', 'duelWins', 'duelLosses', 'duelDraws',
    'matchBestMs', 'matchGames', 'vovLearned', 'mockExams', 'mockExamMistakes'
];

const MAX_MISTAKES_POOL = 200;

// Убираем из пула ошибок факты, которые уже ВЫУЧЕНЫ (SRS level≥1). Ошибка = то, что
// ещё не освоено; как только факт выучен, он больше не «ошибка». Это единая точка
// правды с factStreaks и лекарство от «воскрешения»: облачный merge объединяет
// mistakesPool союзом (см. mergeCloudStates), и выученные ошибки возвращались из
// устаревших копий — теперь их отсекает эта чистка. Возвращает, сколько удалено.
window.pruneLearnedMistakes = function() {
    const fs = (window.state.stats && window.state.stats.factStreaks) || {};
    const pool = window.state.mistakesPool;
    if (!Array.isArray(pool) || !pool.length) return 0;
    const before = pool.length;
    window.state.mistakesPool = pool.filter(m => {
        if (!m || !m.fact) return false;
        const d = fs[factKey(m.fact, m.task)];
        return !window.isFactLearned(d);   // держим только НЕ выученные ошибки
    });
    return before - window.state.mistakesPool.length;
};

function buildSavePayload() {
    const s = window.state.stats;
    const payload = {};
    SAVE_FIELDS.forEach(k => { payload[k] = s[k]; });
    // Чистим выученные ошибки перед сохранением — чтобы и локально, и в облаке
    // пул ошибок не тащил уже освоенные факты.
    window.pruneLearnedMistakes();
    // FIX #5: обрезаем пул ошибок — оставляем последние
    if (window.state.mistakesPool.length > MAX_MISTAKES_POOL) {
        window.state.mistakesPool = window.state.mistakesPool.slice(-MAX_MISTAKES_POOL);
    }
    payload.mistakesPool = window.state.mistakesPool;
    payload.hideLearned = window.state.hideLearned;
    return payload;
}

function saveLocal() {
    // Во время смены аккаунта (см. cloud-sync.js) localStorage уже зачищен —
    // запись старого состояния воскресила бы прогресс прежнего человека в новом аккаунте.
    if (window._identitySwitching) return;
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

// Отдельные полноэкранные режимы сохраняют состояние через стабильный публичный API.
window.saveLocal = saveLocal;
window.saveProgress = saveProgress;
window.syncNow = syncNow;

// ─── Дневной лимит строк (настройки грузит refreshDailyLimit в cloud-sync.js) ───
// 0/отсутствие лимита = безлимит. Считаем по dailyStats[today].solved — тому же
// счётчику, что и вся статистика, поэтому лимит един для таблиц и карточек.
window.canSolveMore = function() {
    const info = window._dailyLimitInfo || { limit: 0 };
    const limit = Number(info.limit) || 0;
    if (limit <= 0) return { ok: true, left: Infinity, limit: 0 };
    const today = getTodayString();
    const solved = (window.state.stats.dailyStats[today] || {}).solved || 0;
    return { ok: solved < limit, left: Math.max(0, limit - solved), limit };
};

// --- Статистика ---
function updateScoreAndStats(linesCount, isPerfectHw, egePointsToAdd) {
    isPerfectHw = isPerfectHw || false;
    egePointsToAdd = egePointsToAdd || 0;
    const s = window.state.stats;
    const curTask = window.state.currentTask || 'task4';
    s.totalSolvedEver += linesCount;
    if (!s.solvedByTask) s.solvedByTask = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
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
    if (item.task === 'cram') return Math.min(item.goal || 0, (window.cramLearnedCount ? window.cramLearnedCount(item.yearStart, item.yearEnd) : 0));
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
    const per = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
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
    s.hwTask1 = per.task1; s.hwTask3 = per.task3; s.hwTask4 = per.task4; s.hwTask5 = per.task5; s.hwTask7 = per.task7;
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
    // Уведомление учителю через TG-бота (firebase-sync может ещё не загрузиться — тогда пропускаем)
    try { window._notifyHwDone && window._notifyHwDone(a); } catch (e) {}
}

// Пересчитать статусы этапов/ДЗ (learned-этапы — живьём), обновить зеркало, проверить ачивки.
function refreshHwState() {
    const s = window.state.stats;
    if (!Array.isArray(s.assignments)) { s.assignments = []; return; }
    // Фантомы старой модели (id legacy_*): активные копии больше не поддерживаем —
    // они «воскресали» из зеркала/облака и висели неудаляемым долгом. Сданные оставляем.
    s.assignments = s.assignments.filter(a => a && !(a.status === 'active' && String(a.id || '').indexOf('legacy_') === 0));
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
    // ДЗ не осталось (снято учителем/выполнено) → выходим из «режима ДЗ».
    // Раньше isHomeworkMode оставался true навсегда — настройки блокировались
    // с текстом «режим ДЗ», хотя никакого ДЗ уже не было.
    if (window.state.isHomeworkMode
        && !window.state.activeHw
        && !(window.state.hwTargetIndices && window.state.hwTargetIndices.length)
        && !s.assignments.some(a => a && a.status === 'active')) {
        window.state.isHomeworkMode = false;
    }
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
    try { window.HwNotify && window.HwNotify.onIngest(rec); } catch (e) {}
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

// ── Звук «пришла домашка» ──
// Живое поступление ДЗ (пока ученик в приложении) → звук сразу.
// ДЗ, которое ждало ученика на момент входа → звук через 30 секунд после входа.
// Озвучиваем каждое задание один раз (id запоминаем в localStorage.seenHwIds).
window.HwNotify = (function () {
    const ENTRY = Date.now();
    const INIT_WINDOW = 5000;   // окно первичной гидратации (load + первый снапшот)
    const DELAY = 30000;        // 30 c после входа для «ждавшего» ДЗ
    let live = false, initialUnseen = false, scheduled = false, lastDing = 0;

    function seen() { try { return new Set(JSON.parse(localStorage.getItem('seenHwIds') || '[]')); } catch (e) { return new Set(); } }
    function save(set) { try { localStorage.setItem('seenHwIds', JSON.stringify([...set].slice(-300))); } catch (e) {} }
    function mark(ids) { const s = seen(); ids.forEach(id => s.add(id)); save(s); }
    function ding() { const now = Date.now(); if (now - lastDing < 3000) return; lastDing = now; try { window.Sfx && window.Sfx.play('dun'); } catch (e) {} }

    function onIngest(rec) {
        if (!rec || !rec.id || rec.status === 'done') return;
        if (seen().has(rec.id)) return;
        if (live) { ding(); mark([rec.id]); }   // прилетело вживую → звук сразу
        else { initialUnseen = true; }          // ждало ученика → отложенный звук в _arm()
    }
    function _arm() {
        if (!scheduled && initialUnseen) {
            scheduled = true;
            setTimeout(ding, Math.max(0, DELAY - (Date.now() - ENTRY)));
            const ids = ((window.state && window.state.stats && window.state.stats.assignments) || [])
                .filter(a => a && a.status !== 'done').map(a => a.id);
            mark(ids);
        }
        live = true;
    }
    setTimeout(_arm, INIT_WINDOW);
    return { onIngest };
})();

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
        if (!window.state.stats.mockExams || typeof window.state.stats.mockExams !== 'object') {
            window.state.stats.mockExams = { active: null, history: [] };
        }
        if (!Array.isArray(window.state.stats.mockExams.history)) window.state.stats.mockExams.history = [];
        if (!window.state.stats.mockExams.active || typeof window.state.stats.mockExams.active !== 'object') {
            window.state.stats.mockExams.active = null;
        }
        if (!Array.isArray(window.state.stats.mockExamMistakes)) window.state.stats.mockExamMistakes = [];
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

        // Миграция со старой модели ДЗ (единый счётчик hwFlashcardsToSolve → legacy_*-задания)
        // УДАЛЕНА: все живые ученики давно на новой модели, а миграция пересоздавала фантомное
        // ДЗ из устаревшего зеркала (баннер «200 строк долга» при пустой вкладке ДЗ).
        // Зеркало теперь всегда пересчитывается из assignments в refreshHwState ниже.
        if (typeof refreshHwState === 'function') refreshHwState();
        if (!window.state.stats.solvedByTask) window.state.stats.solvedByTask = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
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
            const migrated = { task1: {}, task3: {}, task4: {}, task5: {}, task7: {} };
            for (const era of TASK_EPOCHS) {
                if (eras[era]) {
                    migrated.task4[era] = { ...eras[era] };
                    ['task1', 'task3', 'task5', 'task7'].forEach(tk => { migrated[tk][era] = { correct: 0, total: 0 }; });
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

    let d1 = 0, d4 = 0, d5 = 0, d3 = 0, d7 = 0;
    Object.entries(streaks).forEach(([k, v]) => {
        if (!v || typeof v !== 'object') return;
        const learned = v.level >= 1 || (v.level === 0 && (v.streak || 0) >= 3);
        if (!learned) return;
        if (k.startsWith('t1_'))      d1++;
        else if (k.startsWith('t5_')) d5++;
        else if (k.startsWith('t7_')) d7++;
        else if (k.startsWith('t3_')) d3++;
        else                          d4++;
    });

    const s4 = 20 * Math.min(d4 / 500, 1);
    const s1 = 10 * Math.min(d1 / 110, 1);
    const s3 = 17 * Math.min(d3 / 150, 1);
    const s5 = 16 * Math.min(d5 / 250, 1);
    const s7 = 12 * Math.min(d7 / 180, 1);
    const factBase = s1 + s4 + s5 + s3 + s7;

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
        d1, d4, d5, d3, d7, s1, s4, s5, s3, s7,
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
            : (!key.startsWith('t1_') && !key.startsWith('t5_') && !key.startsWith('t7_') && !key.startsWith('t3_') &&
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

// Заглушки для облачных функций (cloud-sync.js перезапишет)
window.loadProgressFromCloud = async function() {};
window.syncProgressToCloud = async function() {};
window.loadClassProgress = function() {};
