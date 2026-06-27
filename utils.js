// utils.js — общие утилиты
'use strict';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const tg = window.Telegram ? window.Telegram.WebApp : null;
window.tgApp = tg;

function haptic(type) {
    if (!tg || !tg.HapticFeedback) return;
    if (['light', 'medium', 'heavy', 'rigid', 'soft'].includes(type)) {
        tg.HapticFeedback.impactOccurred(type);
    } else {
        tg.HapticFeedback.notificationOccurred(type);
    }
}

// ── Звуковые эффекты ──
// Единый набор Audio с «разблокировкой» по первому жесту пользователя.
// Без этого new Audio().play() не срабатывает в мобильных браузерах и Telegram WebView
// (autoplay блокируется, пока звук хотя бы раз не запущен внутри обработчика жеста).
window.Sfx = (function () {
    const FILES = {
        wow: 'assets/sounds/wow.mp3',  // верный ответ
        fah: 'assets/sounds/fah.mp3',  // неверный ответ
        dun: 'assets/sounds/dun.mp3',  // пришла домашка
        duel: 'assets/sounds/duel.mp3', // зов на дуэль (зацикленный)
    };
    const cache = {};
    let unlocked = false;

    function get(name) {
        if (cache[name]) return cache[name];
        const src = FILES[name] || name;
        try { const a = new Audio(src); a.preload = 'auto'; return (cache[name] = a); }
        catch (e) { return null; }
    }
    function isMuted() { try { return localStorage.getItem('sfxMuted') === '1'; } catch (e) { return false; } }
    function setMuted(m) { try { localStorage.setItem('sfxMuted', m ? '1' : '0'); } catch (e) {} }

    function play(name, vol) {
        if (isMuted()) return;
        const a = get(name); if (!a) return;
        try {
            a.muted = false;
            a.currentTime = 0;
            if (vol != null) a.volume = vol;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }

    function unlock() {
        if (unlocked) return;
        unlocked = true;
        Object.keys(FILES).forEach(n => {
            const a = get(n); if (!a) return;
            try {
                a.muted = true;
                const p = a.play();
                if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
                else { a.pause(); a.muted = false; }
            } catch (e) {}
        });
        ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev =>
            window.removeEventListener(ev, unlock, true));
    }
    // Зацикленное воспроизведение (для зова на дуэль) — без проверки isMuted,
    // глушением управляет вызывающий код (свой ключ duel_challenge_muted).
    function loop(name, vol) {
        const a = get(name); if (!a) return;
        try {
            a.loop = true; a.muted = false; a.currentTime = 0;
            if (vol != null) a.volume = vol;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    }
    function stop(name) {
        const a = cache[name]; if (!a) return;
        try { a.pause(); a.loop = false; a.currentTime = 0; } catch (e) {}
    }

    ['pointerdown', 'touchstart', 'keydown', 'click'].forEach(ev =>
        window.addEventListener(ev, unlock, { capture: true, passive: true }));

    return { play, loop, stop, unlock, isMuted, setMuted };
})();

function shuffleArray(array) {
    let c = array.length, r;
    while (c !== 0) {
        r = Math.floor(Math.random() * c);
        c--;
        [array[c], array[r]] = [array[r], array[c]];
    }
    return array;
}

function getTodayString() {
    const t = new Date();
    t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
    return t.toISOString().split('T')[0];
}

function updateText(el, text) {
    if (el && el.innerText !== String(text)) el.innerText = text;
}

function getYearFromFact(d) {
    if (!d) return 0;
    if (d.year) {
        const m = String(d.year).match(/\d+/);
        return m ? parseInt(m[0]) : 0;
    }
    return 0;
}

function getEraFromFact(fact, task) {
    if (task === 'task5') {
        const y = parseInt(fact.year, 10) || 0;
        if (y < 1700) return 'early';
        if (y < 1800) return '18th';
        if (y < 1900) return '19th';
        return '20th';
    }
    return fact.c || null;
}

// ✅ FIX: Единая функция вычисления понедельника текущей недели
// Корректно обрабатывает воскресенье (getDay() === 0)
function getMondayOfCurrentWeek() {
    const now = new Date();
    const day = now.getDay() || 7; // Воскресенье = 7, не 0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
    return monday.getFullYear() + '-' +
        String(monday.getMonth() + 1).padStart(2, '0') + '-' +
        String(monday.getDate()).padStart(2, '0');
}

// ✅ FIX: Единая функция подсчёта weeklyScore
// Исправлена проблема двойного подсчёта: solved НЕ суммируется с solvedTaskX
function computeWeeklyScore(dailyStats) {
    const monStr = getMondayOfCurrentWeek();
    let total = 0;
    for (const d in dailyStats) {
        if (d >= monStr) {
            const day = dailyStats[d];
            const perTask = (day.solvedTask3 || 0) + (day.solvedTask4 || 0) +
                            (day.solvedTask5 || 0) + (day.solvedTask7 || 0);
            // Используем per-task если есть, иначе fallback на старый solved
            total += perTask > 0 ? perTask : (day.solved || 0);
        }
    }
    return total;
}

// Хелперы для SRS-ключей
function factKey(f, task) {
    const t = task || window.state.currentTask;
    return (TASK_CONFIG[t] || TASK_CONFIG.task4).keyFn(f);
}

function mistakeMatchesFact(m, fact, task) {
    const t = task || window.state.currentTask;
    return m.task === t && (TASK_CONFIG[t] || TASK_CONFIG.task4).matchFn(m.fact, fact);
}

window.isFactLearned = function(val) {
    if (typeof val === 'number') return val >= 3;
    if (val && val.level !== undefined) return val.level > 0;
    if (val && val.streak !== undefined) return val.streak >= 3;
    return false;
};

function countLearnedForTask(taskKey, streaks) {
    let count = 0;
    const src = streaks || window.state.stats.factStreaks || {};
    const cfg = TASK_CONFIG[taskKey];
    const prefix = cfg ? (cfg.prefix || null) : null;
    Object.entries(src).forEach(([k, v]) => {
        const match = prefix
            ? k.startsWith(prefix)
            : (!k.startsWith('t5_') && !k.startsWith('t7_') && !k.startsWith('t3_') &&
               !k.startsWith('vp_') && !k.startsWith('va_') && !k.startsWith('vm_'));
        if (match && window.isFactLearned(v)) count++;
    });
    return count;
}

// Кэш DOM-элементов
const DOM = {};
function cacheDOM() {
    [
        'filter-period', 'filter-task', 'filter-mode', 'filter-rows', 'filter-case',
        'pool-container', 'task-table-body', 'table-head',
        'game-container', 'lobby-area', 'bottom-nav', 'check-buttons',
        'reveal-btn', 'next-btn', 'game-timer-display', 'pool-title',
        'toggle-hide-learned', 'pg-hide-learned', 'detective-stamp',
        'pg-sort-year-container', 'check-btn-sure', 'check-btn-doubt'
    ].forEach(id => { DOM[id] = document.getElementById(id); });
}

// ── Слой 2: множество ДОПУСТИМЫХ ответов для строки (task3/5/7) ──
// Если в базе у одного отображаемого значения (процесс/событие/памятник)
// есть несколько связанных скрытых значений, любой из них — верный ответ.
// Это защищает от ситуации «у Смуты два валидных имени»: оба засчитываются.
// Для task4 (множественные поля) и детектива возвращаем null → точное сравнение.
const _ACCEPT_PAIRS = { task3: ['process', 'fact'], task5: ['event', 'person'], task7: ['culture', 'trait'] };
window.acceptableAnswerSet = function(row, task) {
    const pair = _ACCEPT_PAIRS[task];
    if (!pair || !row) return null;
    const [disp, hid] = pair;
    const cfg = TASK_CONFIG[task];
    if (!cfg || typeof cfg.data !== 'function') return null;
    const target = row[disp];
    if (target === undefined) return null;
    const set = new Set();
    cfg.data().forEach(d => { if (d[disp] === target) set.add(String(d[hid])); });
    return set;
};

window.getJokePhrase = function(isCorrect) {
    if (isCorrect) {
        window.state.errorStreak = 0;
        let idx = Math.max((window.state.stats.streak || 0) - 1, 0);
        if (idx >= JOKE_PHRASES.correct.length) {
            idx = JOKE_PHRASES.correct.length - 1 - Math.floor(Math.random() * 5);
        }
        return JOKE_PHRASES.correct[idx];
    } else {
        window.state.errorStreak = (window.state.errorStreak || 0) + 1;
        let idx = window.state.errorStreak - 1;
        if (idx >= JOKE_PHRASES.error.length) {
            idx = JOKE_PHRASES.error.length - 1 - Math.floor(Math.random() * 5);
        }
        return JOKE_PHRASES.error[idx];
    }
};
