// utils.js — общие утилиты
'use strict';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Не const: если Telegram SDK инициализируется чуть позже скрипта (медленная сеть/VPN),
// переснимаем ссылку на DOMContentLoaded, чтобы tg не «залип» в null
// (иначе haptic/ready/expand и считывание tg-id молча отваливаются).
let tg = (window.Telegram && window.Telegram.WebApp) || null;
window.tgApp = tg;
if (!tg && typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
        if (!tg && window.Telegram && window.Telegram.WebApp) { tg = window.Telegram.WebApp; window.tgApp = tg; }
    });
}

// ── Подтверждение действия ──
// window.confirm в Telegram WebView на iOS ЗАБЛОКИРОВАН (молча возвращает false) —
// кнопки с confirm() там просто «не нажимались». Используем нативный tg.showConfirm,
// в обычном браузере — старый confirm.
window.uiConfirm = function (message, onOk) {
    try {
        const t = window.tgApp || (window.Telegram && window.Telegram.WebApp);
        if (t && t.showConfirm && t.isVersionAtLeast && t.isVersionAtLeast('6.2')) {
            t.showConfirm(message, function (ok) { if (ok && onOk) onOk(); });
            return;
        }
    } catch (e) {}
    if (window.confirm(message) && onOk) onOk();
};

// ── Elo-рейтинг дуэлей ──
// Классическая формула Elo: ожидание E = 1/(1+10^((R_opp−R_my)/400)), дельта = K·(S−E).
// Старт 1000, пол 100. K=40 первые 10 матчей (быстрый разгон новичка), дальше 24.
// Каждый игрок считает и пишет ТОЛЬКО свой рейтинг (рейтинг соперника берём из документа матча) —
// никто не трогает чужие данные, а результат у обеих сторон сходится, т.к. входные одинаковые.
window.applyDuelResult = function (myScore, oppScore, oppEloRaw) {
    const s = window.state && window.state.stats;
    if (!s) return null;
    const my = Number(myScore) || 0, op = Number(oppScore) || 0;
    const oppElo = Number(oppEloRaw) || 1000;
    const elo = Number(s.duelElo) || 1000;
    const S = my > op ? 1 : (my < op ? 0 : 0.5);
    const E = 1 / (1 + Math.pow(10, (oppElo - elo) / 400));
    const games = Number(s.duelGames) || 0;
    const K = games < 10 ? 40 : 24;
    const delta = Math.round(K * (S - E));
    s.duelElo = Math.max(100, elo + delta);
    s.duelGames = games + 1;
    if (S === 1) s.duelWins = (Number(s.duelWins) || 0) + 1;
    else if (S === 0) s.duelLosses = (Number(s.duelLosses) || 0) + 1;
    else s.duelDraws = (Number(s.duelDraws) || 0) + 1;
    return { delta, elo: s.duelElo };
};

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
        duel: 'assets/sounds/duel.mp3', // legacy-файл; входящий вызов теперь без звука
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
        // Нет файла — синтезированный звук с тем же именем (win, achievement…).
        if (!FILES[name] && window.PetSfx && window.PetSfx.has(name)) { window.PetSfx.play(name); return; }
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
    // Универсальный API циклического звука. Вызов на дуэль его больше не использует:
    // ученику остаются только визуальная плашка и короткая вибрация.
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

// 🔊 Синтезированные звуки (28.09.2026): WebAudio без файлов — мгновенно, ничего
// не качается, одинаково в Telegram WebView и браузере. Подчиняются тому же
// выключателю, что и Sfx (localStorage sfxMuted). Каждый звук — маленькая
// «партитура» из тонов, шумов и огибающих; мастер-шина идёт через компрессор,
// чтобы наложения (тиканье рулетки + фанфары) не хрипели.
window.PetSfx = (function () {
    let ctx = null, master = null, verb = null;
    function ac() {
        if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
        master = ctx.createGain(); master.gain.value = 0.55;
        master.connect(comp); comp.connect(ctx.destination);
        // Простая «комната»: две задержки с обратной связью — хвост у колоколов и фанфар.
        verb = ctx.createGain(); verb.gain.value = 0.22;
        [0.083, 0.127].forEach(t => {
            const d = ctx.createDelay(1); d.delayTime.value = t;
            const fb = ctx.createGain(); fb.gain.value = 0.38;
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
            verb.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
        });
        return ctx;
    }
    function muted() { try { return localStorage.getItem('sfxMuted') === '1'; } catch (e) { return false; } }
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Гц

    // Тон: тип волны, частота (или [от, до]), начало, длительность, громкость.
    function tone(o) {
        const c = ctx, t0 = c.currentTime + (o.at || 0), dur = o.dur || 0.2;
        const osc = c.createOscillator(); osc.type = o.type || 'sine';
        const f = Array.isArray(o.f) ? o.f : [o.f, o.f];
        osc.frequency.setValueAtTime(f[0], t0);
        if (f[1] !== f[0]) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f[1]), t0 + (o.glide || dur));
        if (o.detune) osc.detune.value = o.detune;
        const g = c.createGain(), v = o.vol == null ? 0.3 : o.vol, a = o.attack || 0.005;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(v, t0 + a);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        let node = osc;
        if (o.lp) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp; lp.Q.value = o.q || 0.7; node.connect(lp); node = lp; }
        if (o.trem) { const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = o.trem; lg.gain.value = v * 0.6; lfo.connect(lg); lg.connect(g.gain); lfo.start(t0); lfo.stop(t0 + dur + 0.05); }
        node.connect(g); g.connect(master);
        if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(verb); }
        osc.start(t0); osc.stop(t0 + dur + 0.05);
    }
    let noiseBuf = null;
    function noise(o) {
        const c = ctx, t0 = c.currentTime + (o.at || 0), dur = o.dur || 0.1;
        if (!noiseBuf) {
            noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = c.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = c.createBiquadFilter(); bp.type = o.filter || 'bandpass'; bp.Q.value = o.q || 1.2;
        const f = Array.isArray(o.f) ? o.f : [o.f || 1500, o.f || 1500];
        bp.frequency.setValueAtTime(f[0], t0);
        if (f[1] !== f[0]) bp.frequency.exponentialRampToValueAtTime(f[1], t0 + dur);
        const g = c.createGain(), v = o.vol == null ? 0.3 : o.vol;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.004));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(bp); bp.connect(g); g.connect(master);
        if (o.wet) { const w = c.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(verb); }
        src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
    }
    const bell = (n, at, vol, dur) => { tone({ f: N(n), at, dur: dur || 0.9, vol: vol || 0.22, type: 'sine', wet: 0.5 }); tone({ f: N(n + 12) * 1.004, at, dur: (dur || 0.9) * 0.6, vol: (vol || 0.22) * 0.35, type: 'sine', wet: 0.4 }); tone({ f: N(n + 19), at, dur: (dur || 0.9) * 0.3, vol: (vol || 0.22) * 0.15, type: 'sine' }); };
    const pluck = (n, at, vol) => tone({ f: N(n), at, dur: 0.28, vol: vol || 0.2, type: 'triangle', wet: 0.3 });
    const brass = (n, at, dur, vol) => { [0, 7, -5].forEach((d, i) => tone({ f: N(n), detune: d, at, dur: dur || 0.6, vol: (vol || 0.12) * (i ? 0.7 : 1), type: 'sawtooth', lp: 1800, attack: 0.04, wet: 0.35 })); };
    const sparkle = (at, n0, count, step) => { for (let i = 0; i < (count || 6); i++) tone({ f: N((n0 || 84) + i * (step || 3)), at: at + i * 0.05, dur: 0.25, vol: 0.07, type: 'sine', wet: 0.6 }); };

    const S = {
        // ── Интерфейс
        tab: () => { noise({ f: 3200, dur: 0.03, vol: 0.12, q: 3 }); tone({ f: 1400, dur: 0.04, vol: 0.05 }); },
        pop: () => tone({ f: [520, 1100], dur: 0.12, glide: 0.08, vol: 0.2, type: 'sine' }),
        open: () => { tone({ f: [300, 700], dur: 0.18, glide: 0.15, vol: 0.12, type: 'triangle' }); sparkle(0.08, 88, 3, 4); },
        error: () => { tone({ f: 150, dur: 0.18, vol: 0.14, type: 'sawtooth', lp: 700 }); tone({ f: 110, at: 0.12, dur: 0.22, vol: 0.14, type: 'sawtooth', lp: 600 }); },
        // ── Питомец
        purr: () => tone({ f: 95, dur: 0.7, vol: 0.22, type: 'sawtooth', lp: 380, trem: 26, attack: 0.08 }),
        chirp: () => { tone({ f: [900, 1500], dur: 0.1, glide: 0.07, vol: 0.15 }); tone({ f: [1100, 1800], at: 0.11, dur: 0.1, glide: 0.07, vol: 0.13 }); },
        munch: () => { for (let i = 0; i < 3; i++) { noise({ f: 700, at: i * 0.17, dur: 0.09, vol: 0.28, filter: 'lowpass' }); tone({ f: 180, at: i * 0.17, dur: 0.07, vol: 0.12, type: 'triangle' }); } },
        heal: () => { [72, 76, 79, 84, 88].forEach((n, i) => tone({ f: N(n), at: i * 0.07, dur: 0.5, vol: 0.1, type: 'triangle', wet: 0.5 })); },
        play: () => { tone({ f: [400, 900], dur: 0.15, glide: 0.1, vol: 0.14, type: 'square', lp: 2000 }); tone({ f: [500, 1200], at: 0.16, dur: 0.15, glide: 0.1, vol: 0.14, type: 'square', lp: 2000 }); },
        coin: () => { tone({ f: N(83), dur: 0.08, vol: 0.13, type: 'square', lp: 4000 }); tone({ f: N(88), at: 0.07, dur: 0.35, vol: 0.13, type: 'square', lp: 4000, wet: 0.2 }); },
        buy: () => { noise({ f: 5000, dur: 0.06, vol: 0.18, q: 2 }); bell(88, 0.03, 0.14, 0.5); bell(93, 0.12, 0.14, 0.7); },
        equip: () => { noise({ f: [600, 3000], dur: 0.22, vol: 0.14, q: 0.8 }); bell(84, 0.16, 0.12, 0.5); },
        levelup: () => { [60, 64, 67, 72].forEach((n, i) => pluck(n + 12, i * 0.08, 0.16)); brass(72, 0.34, 0.8, 0.1); sparkle(0.4, 91, 5, 2); },
        stageup: () => { brass(60, 0, 0.35, 0.12); brass(64, 0.18, 0.35, 0.12); brass(67, 0.36, 0.9, 0.14); tone({ f: N(36), at: 0.36, dur: 1.2, vol: 0.2, type: 'sine' }); sparkle(0.5, 84, 8, 2); },
        quest: () => { bell(79, 0, 0.14, 0.4); bell(84, 0.1, 0.14, 0.6); },
        warn: () => { for (let i = 0; i < 3; i++) { tone({ f: N(57), at: i * 0.42, dur: 0.2, vol: 0.14, type: 'square', lp: 1200 }); tone({ f: N(52), at: i * 0.42 + 0.2, dur: 0.2, vol: 0.14, type: 'square', lp: 1200 }); } },
        death: () => { tone({ f: N(38), dur: 3.2, vol: 0.14, type: 'sine', attack: 0.5 }); [69, 67, 64, 62, 57].forEach((n, i) => bell(n, 0.3 + i * 0.55, 0.16, 1.6)); },
        streak: () => { noise({ f: [300, 2600], dur: 0.6, vol: 0.2, q: 0.7, attack: 0.25 }); [72, 76, 79, 84].forEach((n, i) => bell(n, 0.45 + i * 0.09, 0.14, 0.8)); sparkle(0.8, 91, 6, 2); },
        lose: () => { [62, 61, 60].forEach((n, i) => brass(n - 12, i * 0.32, 0.3, 0.1)); brass(59 - 12, 0.96, 0.9, 0.1); tone({ f: N(47), at: 0.96, dur: 0.9, vol: 0.1, type: 'sine', trem: 7 }); },
        win: () => { brass(67, 0, 0.18, 0.12); brass(67, 0.16, 0.18, 0.12); brass(72, 0.32, 0.7, 0.14); sparkle(0.4, 88, 6, 2); },
        achievement: () => { bell(76, 0, 0.14, 0.5); bell(83, 0.1, 0.14, 0.5); bell(88, 0.2, 0.16, 0.9); sparkle(0.3, 93, 4, 2); },
        // ── Рулетка сундука и колесо
        tick: (o) => { const p = (o && o.pitch) || 1; noise({ f: 2600 * p, dur: 0.025, vol: 0.22, q: 4 }); tone({ f: 1250 * p, dur: 0.03, vol: 0.08, type: 'triangle' }); },
        peg: (o) => { const p = (o && o.pitch) || 1; noise({ f: 3800 * p, dur: 0.02, vol: 0.2, q: 6 }); tone({ f: 2100 * p, dur: 0.025, vol: 0.06, type: 'square', lp: 5000 }); },
        spinStart: () => { noise({ f: [200, 2400], dur: 0.5, vol: 0.2, q: 0.8, attack: 0.05 }); for (let i = 0; i < 6; i++) noise({ f: 3000, at: i * 0.04, dur: 0.02, vol: 0.1, q: 5 }); },
        drum: () => { for (let i = 0; i < 18; i++) noise({ f: 900, at: i * 0.045, dur: 0.05, vol: 0.05 + i * 0.006, filter: 'lowpass' }); },
        stop: () => { noise({ f: 300, dur: 0.12, vol: 0.3, filter: 'lowpass' }); tone({ f: 90, dur: 0.2, vol: 0.25, type: 'sine' }); },
        reveal_common: () => bell(79, 0, 0.16, 0.6),
        reveal_rare: () => { bell(76, 0, 0.16, 0.6); bell(83, 0.1, 0.16, 0.9); },
        reveal_epic: () => { [72, 76, 79, 84].forEach((n, i) => pluck(n, i * 0.07, 0.18)); bell(88, 0.3, 0.14, 1); sparkle(0.35, 91, 5, 2); },
        reveal_legendary: () => {
            tone({ f: N(36), dur: 1.4, vol: 0.22, type: 'sine' });
            brass(60, 0, 0.25, 0.12); brass(64, 0.12, 0.25, 0.12); brass(67, 0.24, 0.25, 0.12); brass(72, 0.36, 1.2, 0.15);
            [84, 88, 91, 96].forEach((n, i) => bell(n, 0.45 + i * 0.08, 0.1, 1.1)); sparkle(0.8, 96, 8, 1);
        },
        reveal_mythic: () => {
            noise({ f: [200, 6000], dur: 0.9, vol: 0.25, q: 0.6, attack: 0.8 });          // «обратная тарелка»
            tone({ f: [110, 40], at: 0.85, dur: 1.6, glide: 0.6, vol: 0.35, type: 'sine' }); // удар-бум
            noise({ f: 180, at: 0.85, dur: 0.5, vol: 0.35, filter: 'lowpass' });
            [48, 55, 60, 64, 67].forEach(n => brass(n + 12, 0.9, 1.8, 0.09));
            [84, 88, 91, 96, 100, 103].forEach((n, i) => bell(n, 1.0 + i * 0.07, 0.1, 1.4));
            sparkle(1.4, 96, 10, 1);
        },
        wheel_small: () => { bell(79, 0, 0.14, 0.5); bell(84, 0.08, 0.14, 0.7); },
        wheel_big: () => { brass(67, 0, 0.18, 0.12); brass(72, 0.16, 0.9, 0.14); sparkle(0.2, 88, 8, 2); },
    };
    function play(name, opts) {
        if (muted() || !S[name]) return false;
        if (!ac() || ctx.state === 'closed') return false;
        try { S[name](opts); } catch (e) { return false; }
        return true;
    }
    function has(name) { return !!S[name]; }
    // Разблокировка в жесте — иначе iOS и Telegram WebView держат контекст «на паузе».
    ['pointerdown', 'touchstart', 'keydown'].forEach(ev => window.addEventListener(ev, function once() {
        ac(); window.removeEventListener(ev, once, true);
    }, { capture: true, passive: true }));
    return { play, has };
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

// Единственная формула границы недели во всём проекте. Её обязан повторять
// mondayStr() в server/api/src/server.js — по weekStartStr сервер отбирает строки
// недельного топа, и разъехавшись, эти двое ломают топ молча.
//
// 🔴 Считаем ПО МОСКВЕ, а не по часам устройства. Раньше обе стороны брали
// локальное время: VPS живёт в Etc/UTC, ученики — в MSK, и каждое воскресенье
// с 00:00 до 03:00 понедельника по Москве сервер был ещё в прошлой неделе, а
// клиенты уже в новой. Ученик, открывший приложение в этом окне, писал себе
// weekStartStr следующей недели и пропадал из топа, а сам топ продолжал
// показывать прошлонедельные числа — «игроки поменялись, топ не обнулился».
// Москва круглый год UTC+3 (перевода часов нет с 2014-го), поэтому хватает
// фиксированного сдвига без tzdata.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
function getMondayOfCurrentWeek(now = new Date()) {
    const msk = new Date(now.getTime() + MSK_OFFSET_MS);
    const day = msk.getUTCDay() || 7; // Воскресенье = 7, не 0
    const monday = new Date(msk.getTime() - (day - 1) * 86400000);
    const pad = value => String(value).padStart(2, '0');
    return monday.getUTCFullYear() + '-' +
        pad(monday.getUTCMonth() + 1) + '-' +
        pad(monday.getUTCDate());
}
window.getMondayOfCurrentWeek = getMondayOfCurrentWeek;

// ✅ FIX: Единая функция подсчёта weeklyScore
// Исправлена проблема двойного подсчёта: solved НЕ суммируется с solvedTaskX
function computeWeeklyScore(dailyStats) {
    const monStr = getMondayOfCurrentWeek();
    let total = 0;
    for (const d in dailyStats) {
        if (d >= monStr) {
            const day = dailyStats[d];
            const perTask = (day.solvedTask1 || 0) + (day.solvedTask3 || 0) + (day.solvedTask4 || 0) +
                            (day.solvedTask5 || 0) + (day.solvedTask7 || 0);
            // Используем per-task если есть, иначе fallback на старый solved
            total += perTask > 0 ? perTask : (day.solved || 0);
        }
    }
    return total;
}

// Дневной стрик: сколько дней ПОДРЯД решали хотя бы одну строку.
// Если сегодня ещё не решал — серия не сгорает в ноль, считаем от вчера.
// НЕ путать со stats.streak — это серия верных ответов подряд внутри игры.
// День засчитывается в стрик, если решено ≥ нормы (30 строк) — из любого источника
// (ДЗ / повторение / новое). Раньше хватало любой одной строки.
window.STREAK_DAILY_MIN = 30;
window.computeDayStreak = function(dailyStats) {
    const ds = dailyStats || (window.state && window.state.stats && window.state.stats.dailyStats) || {};
    const key = dt => {
        const t = new Date(dt);
        t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
        return t.toISOString().split('T')[0];
    };
    const solvedOn = d => { const x = ds[d]; return !!(x && (x.solved || 0) >= window.STREAK_DAILY_MIN); };
    const day = new Date();
    if (!solvedOn(key(day))) day.setDate(day.getDate() - 1);
    let streak = 0;
    while (solvedOn(key(day))) { streak++; day.setDate(day.getDate() - 1); }
    return streak;
};

// Хелперы для SRS-ключей
function factKey(f, task) {
    if (f?._fipiKey) return f._fipiKey;
    const t = task || window.state.currentTask;
    return (TASK_CONFIG[t] || TASK_CONFIG.task4).keyFn(f);
}

function mistakeMatchesFact(m, fact, task) {
    const t = task || window.state.currentTask;
    if (fact?._fipiKey || m?.fact?._fipiKey) {
        return m.task === t && m.fact?._fipiKey === fact?._fipiKey;
    }
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
            : (!k.startsWith('t1_') && !k.startsWith('t5_') && !k.startsWith('t7_') && !k.startsWith('t3_') &&
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
        'pg-sort-year-container', 'check-btn-sure'
    ].forEach(id => { DOM[id] = document.getElementById(id); });
}

// ── Слой 2: множество ДОПУСТИМЫХ ответов для строки (task3/5/7) ──
// Если в базе у одного отображаемого значения (процесс/событие/памятник)
// есть несколько связанных скрытых значений, любой из них — верный ответ.
// Это защищает от ситуации «у Смуты два валидных имени»: оба засчитываются.
// Для task4 (множественные поля) и детектива возвращаем null → точное сравнение.
const _ACCEPT_PAIRS = { task3: ['process', 'fact'], task5: ['event', 'person'], task7: ['culture', 'trait'] };
window.acceptableAnswerSet = function(row, task) {
    // Official bank tasks are self-contained: similarly worded author questions
    // must not silently widen the accepted answer.
    if (row?._fipiExpected !== undefined) return new Set([String(row._fipiExpected)]);
    if (task === 'task1' && row?.year) return new Set([String(row.year)]);
    const pair = _ACCEPT_PAIRS[task];
    if (!pair || !row) return null;
    const [disp, hid] = pair;
    const cfg = TASK_CONFIG[task];
    if (!cfg || typeof cfg.data !== 'function') return null;
    const target = row[disp];
    if (target === undefined) return null;
    const set = new Set();
    const addVals = (d) => {
        if (d[hid] !== undefined) set.add(String(d[hid]));
        // task7: у записи может быть несколько равноправных формулировок характеристики —
        // раунд показывает одну из traitVariants, засчитываем любую.
        if (task === 'task7' && Array.isArray(d.traitVariants)) d.traitVariants.forEach(v => set.add(String(v)));
    };
    // КРИТИЧНО: сама строка — всегда валидный ответ. Без этого, если текст строки
    // «уехал» от базы (снимок из mistakesPool после правки данных) или показан
    // вариант из traitVariants, множество получалось ПУСТЫМ — и даже верная
    // карточка помечалась ошибкой (slot.expected генерится из этой же строки).
    addVals(row);
    cfg.data().forEach(d => { if (d[disp] === target) addVals(d); });
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
