// order-mode.js — «Кто раньше»: из двух событий тапнуть более раннее. Два режима
// на одном движке:
//  • ДУЭЛЬ (openOrderDuel) — колода из документа матча, 45 секунд, соперник;
//  • ТРЕНИРОВКА (openOrderMode) — «Тренажёры» в лобби: три жизни, колода растёт
//    по ходу, рекорд в stats.orderBest.
//
// События — order-data.js (хронологическая таблица владельца + задание №1), у
// каждого ИНТЕРВАЛ, а не год: длительное событие не сравнивается с тем, что
// случилось в ходе него (см. _ordered).
//
// Что делает режим не «угадай из двух»:
//  • РАЗРЫВ СУЖАЕТСЯ — от веков к «фотофинишу» (меньше 5 лет, очки ×2, объявляется
//    до ответа; бывает и «один и тот же год» — тогда решают месяцы);
//  • «ТРОЙКА» — каждый седьмой ход три события расставить по порядку;
//  • ЛЕНТА ВРЕМЕНИ — угаданное падает точкой на шкалу; в конце — разбор ошибок.
//
// Звуки синтезируются Web Audio на лету, файлов нет: верный ответ звучит ВЫШЕ с
// каждым шагом серии, промах — низкий «бвомп», последние пять секунд дуэли тикают
// часы. Выключатель — общий Sfx.isMuted.
//
// Колоду дуэли строит создатель матча и кладёт в документ матча (поле orderDeck).
// Поле обязано быть в MATCH_CREATE_FIELDS на сервере — иначе создание матча молча
// получает 403 (так 01.08.2026 выпал «подбор», см. match-fields-contract.selftest.js).
'use strict';

(function () {
    const DUEL_MS = 45000;
    window.ORDER_DUEL_MS = DUEL_MS;
    const Z = 10006;
    const Y_MIN = 850, Y_MAX = 2025;           // шкала ленты времени
    const PHOTO_GAP_YEARS = 5;                  // разрыв меньше 5 лет — фотофиниш, очки ×2
    const REVEAL_OK_MS = 560, REVEAL_BAD_MS = 1000; // промах стоит ещё и времени
    const SOLO_LIVES = 3;

    // Ступени сложности по разрыву между событиями, лет: [от, до). Разрыв — от
    // КОНЦА раннего до НАЧАЛА позднего, так что «правление Николая I» и «отмена
    // крепостного права» разнесены на 5 лет, а не на 36.
    const TIERS = [[150, Infinity], [50, 150], [15, 50], [5, 15], [0, PHOTO_GAP_YEARS]];
    // Дуэль: сколько пар на каждой ступени. За 45 секунд успевают ~20–25 ходов,
    // поэтому лёгкие ступени короткие: до фотофиниша доходит каждый.
    const DUEL_LADDER = [4, 4, 5, 6, 14];
    const TRIO_EVERY = 7;                        // каждый седьмой ход — тройка
    // Разрывы между соседями внутри тройки по ступеням: [мин, макс]. Без потолка
    // поздняя тройка выходила «1598 / 1924 / 1944» — легче любой пары вокруг неё.
    const TRIO_GAPS = [[60, 400], [25, 150], [10, 60], [4, 30], [1, 15]];

    let _o = null;

    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function _cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function _years(n) { return typeof plural === 'function' ? plural(n, 'год', 'года', 'лет') : 'лет'; }
    function _fmtLeft(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    // ─── Звук ────────────────────────────────────────────────────────────────
    // AudioContext, созданный вне жеста, на телефонах стоит «suspended»; будим его
    // на каждом касании оверлея (касание и есть жест) и только потом играем.
    let _ac = null;
    function _ctx() {
        try {
            if (window.Sfx && window.Sfx.isMuted && window.Sfx.isMuted()) return null;
            if (!_ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; _ac = new AC(); }
            return _ac;
        } catch (e) { return null; }
    }
    function _wake() { const c = _ctx(); if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} } }
    function _tone(freq, at, dur, type, vol, slideTo) {
        const c = _ctx(); if (!c) return;
        try {
            const t0 = c.currentTime + (at || 0);
            const o = c.createOscillator(), g = c.createGain();
            o.type = type || 'triangle';
            o.frequency.setValueAtTime(freq, t0);
            if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
            o.connect(g); g.connect(c.destination);
            o.start(t0); o.stop(t0 + dur + 0.02);
        } catch (e) {}
    }
    // Пентатоника: серия поднимается по ней и никогда не звучит фальшиво.
    const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0];
    const Snd = {
        ok(streak) {
            const f = PENTA[Math.min(PENTA.length - 1, Math.max(0, streak - 1))];
            _tone(f, 0, 0.13, 'triangle', 0.22);
            _tone(f * 1.5, 0.07, 0.18, 'sine', 0.16);
        },
        photo() {            // фотофиниш угадан — искристое арпеджио
            [1046.5, 1318.51, 1567.98, 2093.0].forEach((f, i) => _tone(f, i * 0.055, 0.16, 'sine', 0.15));
        },
        step(i) { _tone([659.25, 783.99, 987.77][i] || 880, 0, 0.09, 'triangle', 0.16); },
        bad() {              // «бвомп»: пила вниз + глухой квадрат
            _tone(190, 0, 0.32, 'sawtooth', 0.12, 70);
            _tone(95, 0, 0.26, 'square', 0.07, 55);
        },
        tick(last) { _tone(last ? 1500 : 1150, 0, 0.035, 'square', 0.06); },
        win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => _tone(f, i * 0.11, i === 3 ? 0.45 : 0.14, 'triangle', 0.2)); },
        lose() { _tone(392, 0, 0.28, 'triangle', 0.18, 370); _tone(349.23, 0.3, 0.28, 'triangle', 0.18, 330); _tone(293.66, 0.6, 0.55, 'triangle', 0.18, 220); },
        draw() { _tone(523.25, 0, 0.18, 'triangle', 0.18); _tone(523.25, 0.2, 0.3, 'triangle', 0.18); }
    };
    window.OrderSfx = Snd; // для ручной проверки звуков из консоли

    // ─── События и сравнимость ───────────────────────────────────────────────
    // order-data.js: [текст, начало ГГГГММДД, конец ГГГГММДД, подпись, точн.начала, точн.конца].
    // У события есть ДЛИТЕЛЬНОСТЬ: «Северная война» — это 1700–1721, а не 1700.
    // «Раньше» значит «целиком закончилось до начала другого». Пересекающиеся
    // события несравнимы и в одну пару не попадают никогда: «Северная война» и
    // «Полтавская битва» — не вопрос «кто раньше», а ловушка без ответа.
    function _dayNo(n) { const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100; return Date.UTC(y, m - 1, d) / 86400000; }
    function _ev(r) { return { t: r[0], s: r[1], e: r[2], l: r[3], sp: r[4], ep: r[5], y: Math.floor(r[1] / 10000) }; }

    let _allCache = null;
    function _all() {
        if (_allCache) return _allCache;
        const src = window.orderEventsData;
        if (Array.isArray(src) && src.length) return (_allCache = src.map(_ev));
        // Запасной путь, пока order-data.js не подъехал: задание №1, только годы.
        return (window.task1Data || []).filter(r => r && r.event).map(r => {
            const y = Number(r.yearNum) || parseInt(String(r.year).match(/\d+/) || '', 10);
            return isFinite(y) ? { t: _cap(String(r.event).trim()), s: y * 10000 + 101, e: y * 10000 + 1231, l: String(y), sp: 0, ep: 0, y } : null;
        }).filter(Boolean);
    }

    // Упорядоченная пара [раньше, позже] или null, если сравнивать нельзя.
    // Обе границы точные (месяц/день) — нужен зазор ≥ 45 дней: разницу в неделю
    // («конституция 10 июля или расстрел 17 июля») помнить никто не обязан.
    const MIN_FINE_GAP_DAYS = 45;
    function _ordered(a, b) {
        let x = a, z = b;
        if (!(x.e < z.s)) { if (b.e < a.s) { x = b; z = a; } else return null; }
        if (x.ep > 0 && z.sp > 0 && _dayNo(z.s) - _dayNo(x.e) < MIN_FINE_GAP_DAYS) return null;
        return [x, z];
    }
    function _gapYears(a, b) { const o = _ordered(a, b); return o ? (_dayNo(o[1].s) - _dayNo(o[0].e)) / 365.25 : -1; }
    // Разница «как видит человек»: год начала позднего минус год конца раннего.
    // Точный зазор для «1849 / 1851» — ровно год (от 31.12.1849 до 01.01.1851), но
    // игрок видит на карточках два года разницы и счёл бы «↕ 1 год» ошибкой.
    function _yearGap(a, b) { const o = _ordered(a, b); return o ? Math.floor(o[1].s / 10000) - Math.floor(o[0].e / 10000) : -1; }
    function _sameYear(a, b) { return _yearGap(a, b) === 0; }

    function _takePair(pool, lo, hi) {
        const idx = _shuffle(pool.map((_, i) => i));
        for (const i of idx.slice(0, 80)) {
            const a = pool[i];
            const cands = pool.filter(b => { if (b === a) return false; const g = _gapYears(a, b); return g >= lo && g < hi; });
            if (cands.length) { const b = cands[Math.floor(Math.random() * cands.length)]; _drop(pool, [a, b]); return [a, b]; }
        }
        return null;
    }
    // Тройка: x < y < z, соседи сравнимы и разнесены на [lo, hi] лет.
    function _takeTrio(pool, lo, hi) {
        const ok = (a, b) => { const g = _gapYears(a, b); return g >= lo && g <= hi && a.s < b.s; };
        for (const a of _shuffle(pool.slice()).slice(0, 120)) {
            for (const b of _shuffle(pool.filter(x => ok(a, x))).slice(0, 12)) {
                const c = _shuffle(pool.filter(x => ok(b, x) && _ordered(a, x)))[0];
                if (c) { _drop(pool, [a, b, c]); return [a, b, c]; }
            }
        }
        return null;
    }
    function _drop(pool, items) { for (const it of items) { const k = pool.indexOf(it); if (k >= 0) pool.splice(k, 1); } }

    // В колоду матча уходит только то, что нужно на экране: текст, подпись даты,
    // границы (для ответа и разрыва) и год — год оставлен для клиентов vps-120,
    // которые сравнивают только по нему.
    function _snap(ev) { return { t: ev.t, l: ev.l, s: ev.s, e: ev.e, y: ev.y }; }
    function _item(tier, pool) {
        if (tier.trio) { const tr = _takeTrio(pool, tier.trio[0], tier.trio[1]); return tr ? { k: 't', e: _shuffle(tr.map(_snap)) } : null; }
        const p = _takePair(pool, tier.lo, tier.hi) || _takePair(pool, 0, Infinity);
        return p ? { k: 'p', e: _shuffle(p.map(_snap)) } : null;
    }
    function _tier(i) { const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, i))]; return { lo: t[0], hi: t[1] }; }
    function _trioTier(i) { return { trio: TRIO_GAPS[Math.max(0, Math.min(TRIO_GAPS.length - 1, i))] }; }

    window.buildOrderDuelDeck = function () {
        const pool = _shuffle(_all().slice());
        if (pool.length < 60) return null;
        const deck = [];
        DUEL_LADDER.forEach((n, tier) => {
            for (let k = 0; k < n; k++) {
                if ((deck.length + 1) % TRIO_EVERY === 0) { const t = _item(_trioTier(tier), pool); if (t) deck.push(t); }
                const p = _item(_tier(tier), pool);
                if (!p) break;
                deck.push(p);
            }
        });
        return deck.length >= 12 ? deck : null;
    };

    // Период из лобби — как в «Подборе»: #filter-period и «свои годы». «Дошли до N»
    // ученика класса приходит сюда же как custom 862–N. Событие берём, если оно
    // целиком внутри рамок.
    function _soloPool() {
        const all = _all();
        const g = id => document.getElementById(id);
        const sel = g('filter-period');
        const period = (sel && sel.value) || 'all';
        let a = -Infinity, b = Infinity;
        if (period === 'custom') {
            a = parseInt(g('custom-year-start') && g('custom-year-start').value, 10) || -Infinity;
            b = parseInt(g('custom-year-end') && g('custom-year-end').value, 10) || Infinity;
        } else if (period === 'early') { b = 1699; }
        else if (period === '18th') { a = 1700; b = 1799; }
        else if (period === '19th') { a = 1800; b = 1899; }
        else if (period === '20th') { a = 1900; }
        const inRange = all.filter(ev => ev.y >= a && Math.floor(ev.e / 10000) <= b);
        // Узкие рамки не набирают игры — лучше вся история, чем пустой экран.
        const narrow = inRange.length >= 30 && (isFinite(a) || isFinite(b));
        return { pool: inRange.length >= 30 ? inRange : all, range: narrow ? [a, b] : null };
    }

    // ─── Общий движок ────────────────────────────────────────────────────────
    // Один экран на два режима: дуэль (колода из матча, таймер, соперник) и
    // тренировка (колода растёт по ходу, три жизни, рекорд).
    function _start(o) {
        if (_o) window.closeOrderMode();
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        _o = Object.assign({
            deck: [], idx: -1, lock: false, over: false, finishedMine: false,
            score: 0, streak: 0, best: 0, done: 0, correct: 0,
            trioPicked: [], placed: [], misses: [],
            oppName: 'Соперник', oppScore: 0, oppCorrect: 0, oppDone: 0,
            endsAt: 0, lastTickSec: null, timerIv: null, test: false, solo: false, lives: 0
        }, o);
        _render();
        _next();
        if (!_o.solo) { _o.timerIv = setInterval(_tick, 100); _tick(); }
        _h('medium');
    }

    window.openOrderDuel = function (opts) {
        const deck = ((opts && opts.deck) || []).filter(it => it && Array.isArray(it.e) && it.e.length >= 2);
        if (!deck.length) {
            if (typeof showToast === 'function') showToast('⚠️', 'Не удалось получить колоду дуэли', 'bg-rose-500', 'border-rose-700');
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
            return;
        }
        _start({ deck, oppName: (opts && opts.oppName) || 'Соперник', endsAt: (opts && opts.endsAt) || (Date.now() + DUEL_MS), test: !!(opts && opts.test) });
    };

    // Тренировка «Кто раньше» — отдельный режим в разделе «Тренажёры».
    window.openOrderMode = function () {
        if (window.canSolveMore) {
            const lim = window.canSolveMore();
            if (!lim.ok) { if (window.showDailyLimitModal) window.showDailyLimitModal(); return; }
        }
        const { pool, range } = _soloPool();
        if (pool.length < 30) { if (typeof showToast === 'function') showToast('⚠️', 'События ещё загружаются — попробуй через секунду', 'bg-amber-500', 'border-amber-700'); return; }
        _start({ solo: true, lives: SOLO_LIVES, soloPool: _shuffle(pool.slice()), soloFull: pool, range, test: true });
    };

    // Тренировка: следующий ход строится на лету. Ступень растёт каждые 5 верных,
    // так что сильный игрок быстро доходит до фотофиниша, а слабый не тонет сразу.
    function _soloItem() {
        if (_o.soloPool.length < 12) _o.soloPool = _shuffle(_o.soloFull.slice());
        const tier = Math.floor(_o.correct / 5);
        return ((_o.idx + 1) % TRIO_EVERY === 0 ? _item(_trioTier(tier), _o.soloPool) : null) || _item(_tier(tier), _o.soloPool);
    }

    window.closeOrderMode = function () {
        if (!_o) return;
        if (_o.timerIv) clearInterval(_o.timerIv);
        if (!_o.test) {
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        ['order-overlay', 'om-end'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
        _o = null;
        if (window.updateProgressBars) window.updateProgressBars();
    };

    window.updateOrderDuelOpp = function (opp) {
        if (!_o || !opp) return;
        _o.oppScore = opp.score || 0;
        _o.oppCorrect = opp.correct || 0;
        _o.oppDone = opp.done || 0;
        _bar();
    };

    function _report() {
        if (!_o || _o.test) return;
        try { window.updateDuelScoreDb && window.updateDuelScoreDb(_o.score, _o.streak, { done: _o.done, correct: _o.correct }); } catch (e) {}
    }

    function _tick() {
        if (!_o) return;
        const left = _o.endsAt - Date.now();
        const el = document.getElementById('om-timer');
        if (el) {
            el.textContent = _fmtLeft(left);
            el.classList.toggle('om-hurry', left <= 5000 && left > 0);
        }
        const sec = Math.ceil(left / 1000);
        if (!_o.over && sec <= 5 && sec >= 1 && sec !== _o.lastTickSec) { _o.lastTickSec = sec; Snd.tick(sec === 1); }
        if (left <= 0 && !_o.over) _finish();
    }

    function _hearts() { return '❤️'.repeat(Math.max(0, _o.lives)) + '🤍'.repeat(Math.max(0, SOLO_LIVES - _o.lives)); }
    function _soloBest() { return Number(window.state && window.state.stats && window.state.stats.orderBest) || 0; }
    function _rangeText(r) { return r ? ` · ${isFinite(r[0]) ? r[0] : '…'}–${isFinite(r[1]) ? r[1] : '…'}` : ''; }

    function _render() {
        const old = document.getElementById('order-overlay'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'order-overlay';
        ov.addEventListener('pointerdown', _wake, { passive: true });
        const muted = !!(window.Sfx && window.Sfx.isMuted && window.Sfx.isMuted());
        const solo = _o.solo;
        const best = _soloBest();
        ov.innerHTML = `
          <div class="om-wrap">
            <div class="om-head">
              <div class="om-title">
                <div class="om-kicker">⏳ Кто раньше${solo ? _rangeText(_o.range) : ' · дуэль'}</div>
                <div class="om-sub">Счёт <b id="om-score">0</b> · <span id="om-streak" class="om-streak">🔥0</span></div>
              </div>
              ${solo
                ? `<div class="om-lives-box"><div id="om-lives" class="om-lives">${_hearts()}</div><div class="om-rec">${best ? '🏆 рекорд ' + best : 'первая игра!'}</div></div>`
                : `<div id="om-timer" class="om-timer">${_fmtLeft(DUEL_MS)}</div>`}
              <div class="om-btns">
                <button id="om-mute" class="om-btn" aria-label="Звук">${muted ? '🔇' : '🔊'}</button>
                <button id="om-exit" class="om-btn">✕</button>
              </div>
            </div>
            ${solo ? '' : `
            <div class="om-bars">
              <div class="om-row"><span class="om-who om-me">ТЫ</span><div class="om-track"><div id="om-me-bar" class="om-fill om-fill-me"></div></div><span id="om-me-txt" class="om-num">✓0 · 0</span></div>
              <div class="om-row"><span class="om-who om-op">${_esc(_o.oppName).toUpperCase()}</span><div class="om-track"><div id="om-op-bar" class="om-fill om-fill-op"></div></div><span id="om-op-txt" class="om-num">✓0 · 0</span></div>
            </div>`}
            <div id="om-ask" class="om-ask"></div>
            <div id="om-stage" class="om-stage"></div>
            <div class="om-line-box">
              <div class="om-line-cap"><span>Лента времени</span><span id="om-line-n">0 событий</span></div>
              <div id="om-line" class="om-line">
                <span class="om-tickmark" style="left:${_pos(1000)}%">1000</span>
                <span class="om-tickmark" style="left:${_pos(1500)}%">1500</span>
                <span class="om-tickmark" style="left:${_pos(1800)}%">1800</span>
                <span class="om-tickmark" style="left:${_pos(1917)}%">1917</span>
              </div>
            </div>
          </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#om-exit').onclick = _requestExit;
        ov.querySelector('#om-mute').onclick = e => {
            const m = !(window.Sfx && window.Sfx.isMuted());
            if (window.Sfx) window.Sfx.setMuted(m);
            e.currentTarget.textContent = m ? '🔇' : '🔊';
            if (!m) { _wake(); Snd.ok(1); }
        };
        _bar();
    }

    function _pos(y) { return Math.max(0, Math.min(100, (y - Y_MIN) / (Y_MAX - Y_MIN) * 100)); }

    function _requestExit() {
        _h('light');
        // Тренировку «Выйти» не обрывает молча: показываем итог и сохраняем рекорд.
        if (_o && _o.solo && !_o.over && _o.done > 0) return _soloEnd(true);
        if (_o && !_o.over && !_o.test && window.uiConfirm) return window.uiConfirm('Выйти из дуэли? Это засчитается как сдача.', window.closeOrderMode);
        window.closeOrderMode();
    }

    function _bar() {
        if (!_o) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('om-score', _o.score);
        set('om-me-txt', `✓${_o.correct} · ${_o.score}`);
        set('om-op-txt', `✓${_o.oppCorrect} · ${_o.oppScore}`);
        if (_o.solo) set('om-lives', _hearts());
        const st = document.getElementById('om-streak');
        if (st) { st.textContent = '🔥' + _o.streak; st.classList.toggle('om-hot', _o.streak >= 5); }
        const top = Math.max(1, _o.score, _o.oppScore);
        const mb = document.getElementById('om-me-bar'), ob = document.getElementById('om-op-bar');
        if (mb) mb.style.width = Math.round(_o.score / top * 100) + '%';
        if (ob) ob.style.width = Math.round(_o.oppScore / top * 100) + '%';
        const ov = document.getElementById('order-overlay');
        if (ov) ov.classList.toggle('om-onfire', _o.streak >= 5);
    }

    // Колоды vps-120 несут только {t, y}: достраиваем границы из года.
    function _norm(ev) {
        if (ev.s) return ev;
        return Object.assign({}, ev, { s: ev.y * 10000 + 101, e: ev.y * 10000 + 1231, l: String(ev.y) });
    }

    function _next() {
        if (!_o || _o.over) return;
        _o.idx++;
        const it = _o.solo ? _soloItem() : _o.deck[_o.idx];
        if (_o.solo && it) _o.deck[_o.idx] = it;
        if (!it) return _mineDone();
        it.e = it.e.map(_norm);
        _o.lock = false;
        _o.trioPicked = [];
        const trio = it.k === 't';
        const gap = trio ? 99 : _yearGap(it.e[0], it.e[1]);
        _o.photo = !trio && gap >= 0 && gap < PHOTO_GAP_YEARS;
        const oneYear = _o.photo && _sameYear(it.e[0], it.e[1]);
        const ask = document.getElementById('om-ask');
        if (ask) ask.innerHTML = trio
            ? `<span class="om-badge om-badge-trio">🎲 Тройка</span> Расставь по порядку — тапни от <b>самого раннего</b>`
            : _o.photo
                ? `<span class="om-badge om-badge-photo">⚡ Фотофиниш · ×2</span> ${oneYear ? 'Один и тот же год!' : 'Разница меньше 5 лет.'} Что <b>раньше</b>?`
                : `Что было <b>раньше</b>?`;
        const stage = document.getElementById('om-stage');
        if (!stage) return;
        stage.className = 'om-stage ' + (trio ? 'om-stage-trio' : 'om-stage-pair');
        stage.innerHTML = '';
        it.e.forEach((ev, i) => {
            if (!trio && i === 1) {
                const vs = document.createElement('div');
                vs.className = 'om-vs'; vs.id = 'om-vs'; vs.textContent = '⌛';
                stage.appendChild(vs);
            }
            const b = document.createElement('button');
            b.className = 'om-card om-in';
            b.style.animationDelay = (i * 60) + 'ms';
            b.dataset.i = String(i);
            const txt = document.createElement('span'); txt.className = 'om-text'; txt.textContent = ev.t;
            const yr = document.createElement('span'); yr.className = 'om-year'; yr.textContent = ev.l;
            if (String(ev.l).length > 12) yr.classList.add('om-year-long');
            const num = document.createElement('span'); num.className = 'om-num-badge';
            b.append(num, txt, yr);
            if (ev.t.length > 80) b.classList.add('om-long');
            b.onclick = () => (trio ? _pickTrio(i) : _pickPair(i));
            stage.appendChild(b);
        });
    }

    function _cards() { return Array.from(document.querySelectorAll('#om-stage .om-card')); }
    function _reveal() { _cards().forEach(c => c.classList.add('om-revealed')); }

    function _award(base) {
        _o.streak++; _o.best = Math.max(_o.best, _o.streak);
        // Та же основа, что в свайпе и подборе: 10 + бонус серии (до +20).
        const gain = Math.round((base + Math.min(20, (_o.streak - 1) * 2)) * (_o.photo ? 2 : 1));
        _o.score += gain;
        _o.correct++;
        // Тренировка идёт в норму дня, как «Подбор»; дуэль — нет.
        if (_o.solo && window.creditNorm) window.creditNorm(1, 'task1');
        return gain;
    }
    function _miss(it) {
        _o.streak = 0;
        if (_o.solo) _o.lives--;
        else _o.score = Math.max(0, _o.score - 5);
        _o.misses.push(it);
    }
    // После хода: в тренировке кончились жизни — итог, иначе следующий ход.
    function _after(ms) {
        setTimeout(() => {
            if (!_o || _o.over) return;
            if (_o.solo && _o.lives <= 0) return _soloEnd(false);
            _next();
        }, ms);
    }

    function _gapText(a, b) {
        const n = _yearGap(a, b);
        if (n >= 1) return `↕ ${n} ${_years(n)}`;
        const m = Math.max(1, Math.round(_gapYears(a, b) * 12));
        return `↕ ${m} ${typeof plural === 'function' ? plural(m, 'месяц', 'месяца', 'месяцев') : 'мес.'}`;
    }

    function _pickPair(i) {
        if (!_o || _o.lock || _o.over) return;
        _o.lock = true;
        _wake();
        const it = _o.deck[_o.idx];
        const early = it.e[0].s < it.e[1].s ? 0 : 1;
        const ok = i === early;
        _o.done++;
        const cards = _cards();
        _reveal();
        cards[early].classList.add('om-right');
        const vs = document.getElementById('om-vs');
        if (vs) { vs.textContent = _gapText(it.e[0], it.e[1]); vs.classList.add('om-vs-gap'); }
        if (ok) {
            const gain = _award(10);
            if (_o.photo) Snd.photo(); else Snd.ok(_o.streak);
            _h('success');
            _floatPts(cards[i], gain);
            _drop2line(it.e[early]); _drop2line(it.e[1 - early]);
        } else {
            _miss(it);
            cards[i].classList.add('om-wrong');
            Snd.bad(); _h('error');
        }
        _report(); _bar();
        // В тренировке на ошибке дольше: прочитать даты — и есть смысл режима.
        _after(ok ? REVEAL_OK_MS : REVEAL_BAD_MS + (_o.solo ? 900 : 0));
    }

    function _pickTrio(i) {
        if (!_o || _o.lock || _o.over) return;
        if (_o.trioPicked.indexOf(i) !== -1) return;
        _wake();
        const it = _o.deck[_o.idx];
        const order = it.e.map((e, k) => k).sort((a, b) => it.e[a].s - it.e[b].s);
        const want = order[_o.trioPicked.length];
        const cards = _cards();
        if (i === want) {
            _o.trioPicked.push(i);
            const n = _o.trioPicked.length;
            cards[i].classList.add('om-picked');
            cards[i].querySelector('.om-num-badge').textContent = String(n);
            _h('light');
            if (n < 3) { Snd.step(n - 1); return; }
            _o.lock = true;
            _o.done++;
            _reveal();
            const gain = _award(30);
            Snd.photo(); _h('success');
            _floatPts(cards[i], gain);
            it.e.forEach(_drop2line);
            _report(); _bar();
            _after(REVEAL_OK_MS + 200);
            return;
        }
        // Ошибка в порядке — ход проигран: показываем правильный порядок и даты.
        _o.lock = true;
        _o.done++;
        cards[i].classList.add('om-wrong');
        order.forEach((k, pos) => { cards[k].querySelector('.om-num-badge').textContent = String(pos + 1); cards[k].classList.add('om-shown'); });
        _reveal();
        _miss(it);
        Snd.bad(); _h('error');
        _report(); _bar();
        _after(REVEAL_BAD_MS + (_o.solo ? 1200 : 500));
    }

    function _floatPts(card, gain) {
        if (!card) return;
        const f = document.createElement('div');
        f.className = 'om-float';
        f.textContent = (_o.photo ? '⚡ ' : '') + '+' + gain;
        card.appendChild(f);
        setTimeout(() => f.remove(), 800);
    }

    function _drop2line(ev) {
        if (!_o || !ev) return;
        _o.placed.push(ev);
        const line = document.getElementById('om-line');
        if (line) {
            const y = Math.floor(ev.s / 10000);
            const d = document.createElement('span');
            d.className = 'om-dot';
            d.style.left = _pos(y) + '%';
            d.style.background = y < 1700 ? '#a16207' : y < 1800 ? '#0891b2' : y < 1900 ? '#7c3aed' : '#e11d48';
            d.title = ev.l + ' — ' + ev.t;
            line.appendChild(d);
        }
        const n = document.getElementById('om-line-n');
        if (n) n.textContent = _o.placed.length + ' ' + (typeof plural === 'function' ? plural(_o.placed.length, 'событие', 'события', 'событий') : 'событий');
    }

    function _mineDone() {
        if (!_o || _o.over) return;
        _o.finishedMine = true;
        const stage = document.getElementById('om-stage');
        if (stage) stage.innerHTML = `<div class="om-msg"><div style="font-size:44px">🚀</div><b>Колода пройдена!</b><div>Жди конца таймера</div></div>`;
        const ask = document.getElementById('om-ask'); if (ask) ask.textContent = '';
    }

    function _finish() {
        if (!_o || _o.over) return;
        _o.over = true; _o.lock = true;
        if (_o.timerIv) { clearInterval(_o.timerIv); _o.timerIv = null; }
        _report();
        const stage = document.getElementById('om-stage');
        if (stage) stage.innerHTML = `<div class="om-msg"><div style="font-size:44px">⏱</div><b>Время!</b><div>Считаем очки…</div></div>`;
        const ask = document.getElementById('om-ask'); if (ask) ask.textContent = '';
        setTimeout(_verdict, 400);
    }

    function _missesHtml(list) {
        return list.map(it => {
            const s = it.e.slice().sort((a, b) => a.s - b.s);
            return `<li>${s.map(e => `<span class="om-mis-y">${_esc(e.l)}</span> ${_esc(e.t)}`).join('<span class="om-mis-arrow">→</span>')}</li>`;
        }).join('');
    }

    // Конец тренировки: жизни кончились или игрок вышел сам.
    function _soloEnd(quit) {
        if (!_o || _o.over) return;
        _o.over = true; _o.lock = true;
        const s = window.state && window.state.stats;
        const prev = _soloBest();
        const record = _o.score > prev;
        if (s && _o.done > 0) {
            s.orderGames = (Number(s.orderGames) || 0) + 1;
            if (record) s.orderBest = _o.score;
            try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {}
        }
        _h(record ? 'success' : 'warning');
        (record ? Snd.win : Snd.lose)();
        const misses = _missesHtml(_o.misses.slice(-5));
        const panel = document.createElement('div');
        panel.id = 'om-end';
        panel.innerHTML = `
          <div class="om-end-card">
            <div style="font-size:52px;line-height:1">${record ? '🏆' : quit ? '⏳' : '💔'}</div>
            <div class="om-end-title" style="color:${record ? '#16a34a' : '#64748b'}">${record ? 'Новый рекорд!' : quit ? 'Игра окончена' : 'Жизни кончились'}</div>
            <div class="om-end-score">${_o.score}</div>
            <div class="om-end-sub">Верно ${_o.correct} из ${_o.done} · лучшая серия 🔥${_o.best}${record || !prev ? '' : ` · рекорд ${prev}`}</div>
            ${misses ? `<div class="om-mis"><div class="om-mis-cap">Как было на самом деле</div><ul>${misses}</ul></div>` : ''}
            <button id="om-rematch" class="om-big om-big-main">🔁 Ещё раз</button>
            <button id="om-leave" class="om-big">✕ Выйти</button>
          </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#om-rematch').onclick = () => { window.closeOrderMode(); window.openOrderMode(); };
        panel.querySelector('#om-leave').onclick = () => window.closeOrderMode();
    }

    // Финал дуэли — той же процедурой, что свайп и подбор: авторитетные числа из
    // документа матча, затем Elo, и только потом cancelDuelDb (он стирает рейтинг соперника).
    async function _verdict() {
        if (!_o) return;
        let my = _o.score, opp = _o.oppScore, oppEloDoc = null, rate = null;
        if (!_o.test) {
            try {
                const fin = window.finalizeDuelScores
                    ? await window.finalizeDuelScores(_o.score, _o.streak, { done: _o.done, correct: _o.correct })
                    : null;
                if (fin) { my = fin.mine; opp = fin.opp; oppEloDoc = fin.oppElo; _o.oppScore = opp; }
            } catch (e) { console.warn('[Duel] finalize:', e); }
            try {
                const oppElo = oppEloDoc || (window.state && window.state.duel && window.state.duel.oppElo) || 1000;
                rate = window.applyDuelResult ? window.applyDuelResult(my, opp, oppElo) : null;
                if (rate) { if (window.saveProgress) window.saveProgress(); if (window.syncNow) window.syncNow(); }
            } catch (e) { console.warn('[Duel] Elo не применён:', e); }
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        if (!_o) return;
        const win = my > opp, draw = my === opp;
        _h(win ? 'success' : 'error');
        (win ? Snd.win : draw ? Snd.draw : Snd.lose)();
        _bar();
        const misses = _missesHtml(_o.misses.slice(-4));
        const panel = document.createElement('div');
        panel.id = 'om-end';
        panel.innerHTML = `
          <div class="om-end-card">
            <div style="font-size:52px;line-height:1">${win ? '🏆' : draw ? '🤝' : '💔'}</div>
            <div class="om-end-title" style="color:${win ? '#16a34a' : draw ? '#64748b' : '#e11d48'}">${win ? 'Победа!' : draw ? 'Ничья' : 'Поражение'}</div>
            <div class="om-end-score">${my} <span style="opacity:.4">:</span> ${opp}</div>
            <div class="om-end-sub">Верно ${_o.correct} из ${_o.done} · лучшая серия 🔥${_o.best}</div>
            ${rate ? `<div class="om-end-rate" style="color:${rate.delta >= 0 ? '#16a34a' : '#e11d48'}">🏅 Рейтинг: ${rate.elo} (${rate.delta >= 0 ? '+' : ''}${rate.delta})</div>` : ''}
            ${misses ? `<div class="om-mis"><div class="om-mis-cap">Как было на самом деле</div><ul>${misses}</ul></div>` : `<div class="om-end-sub" style="margin-top:8px">Без единой ошибки! 🎯</div>`}
            <button id="om-rematch" class="om-big om-big-main">⚔️ Ещё раз</button>
            <button id="om-leave" class="om-big">✕ Выйти</button>
            ${_o.test ? '' : '<button id="om-top" class="om-link">🏆 Топ дуэлей</button>'}
          </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#om-rematch').onclick = () => { const t = _o && _o.test; window.closeOrderMode(); if (t) window.openOrderDuel({ deck: window.buildOrderDuelDeck(), oppName: 'Тест', test: true }); else if (window.startDuelSearch) window.startDuelSearch(); };
        panel.querySelector('#om-leave').onclick = () => window.closeOrderMode();
        const top = panel.querySelector('#om-top');
        if (top) top.onclick = () => { window.closeOrderMode(); if (window.openGlobalTopModal) window.openGlobalTopModal('duel'); };
    }

    // ─── Стили ───────────────────────────────────────────────────────────────
    // Свои классы, а не Tailwind: output.css собирается сборкой и новых утилит
    // в нём нет. Тёмная тема — через html.dark, как во всём приложении.
    try {
        const st = document.createElement('style');
        st.textContent = `
#order-overlay{position:fixed;inset:0;z-index:${Z};display:flex;flex-direction:column;background:#f8fafc;color:#1f2937;padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom));transition:background .4s}
html.dark #order-overlay{background:#121212;color:#e5e7eb}
#order-overlay.om-onfire{background:radial-gradient(120% 80% at 50% 110%,rgba(249,115,22,.18),transparent 60%),#f8fafc}
html.dark #order-overlay.om-onfire{background:radial-gradient(120% 80% at 50% 110%,rgba(249,115,22,.22),transparent 60%),#121212}
.om-wrap{width:100%;max-width:720px;margin:0 auto;display:flex;flex-direction:column;flex:1;min-height:0}
.om-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0}
.om-title{min-width:96px}.om-kicker{font-size:var(--t-micro);font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af}
.om-sub{font-size:11px;font-weight:900;color:#6b7280;margin-top:1px}.om-sub b{color:#2563eb}html.dark .om-sub b{color:#60a5fa}
.om-streak{display:inline-block;transition:transform .2s}.om-streak.om-hot{color:#ea580c;animation:omPulse .8s ease-in-out infinite}
.om-timer{font-size:26px;font-weight:1000;font-variant-numeric:tabular-nums;color:#f43f5e}
.om-timer.om-hurry{animation:omPulse .5s ease-in-out infinite}
.om-lives-box{text-align:center}
.om-lives{font-size:20px;letter-spacing:2px;line-height:1.1}
.om-rec{font-size:var(--t-micro);font-weight:900;color:#9ca3af;margin-top:2px}
.om-year.om-year-long{font-size:17px}
.om-btns{display:flex;gap:6px}
.om-btn{font-size:13px;font-weight:900;background:#fff;color:#4b5563;border:1px solid #e5e7eb;border-radius:var(--r-sm);padding:7px 11px;cursor:pointer}
html.dark .om-btn{background:#2c2c2c;color:#d1d5db;border-color:#3f3f46}
.om-bars{display:flex;flex-direction:column;gap:3px;margin:8px 0 4px;font-size:11px;font-weight:900;flex-shrink:0}
.om-row{display:flex;align-items:center;gap:7px}
.om-who{width:58px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.om-me{color:#3b82f6}.om-op{color:#f59e0b}
.om-track{flex:1;height:6px;background:rgba(120,120,140,.22);border-radius:999px;overflow:hidden}
.om-fill{height:100%;width:0;border-radius:999px;transition:width .3s}.om-fill-me{background:#3b82f6}.om-fill-op{background:#f59e0b}
.om-num{flex-shrink:0;color:#6b7280;font-variant-numeric:tabular-nums}html.dark .om-num{color:#d1d5db}
.om-ask{text-align:center;font-size:15px;font-weight:800;margin:8px 0 6px;min-height:22px;flex-shrink:0;line-height:1.35}
.om-ask b{color:#2563eb}html.dark .om-ask b{color:#60a5fa}
.om-badge{display:inline-block;font-size:11px;font-weight:1000;padding:2px 8px;border-radius:999px;margin-right:4px;vertical-align:1px}
.om-badge-photo{background:#fef3c7;color:#b45309;animation:omPulse 1s ease-in-out infinite}
.om-badge-trio{background:#ede9fe;color:#6d28d9}
html.dark .om-badge-photo{background:#78350f;color:#fde68a}html.dark .om-badge-trio{background:#4c1d95;color:#ddd6fe}
.om-stage{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:4px}
.om-card{position:relative;flex:1;max-height:190px;min-height:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;padding:14px 16px;border-radius:var(--r-md);border:2px solid #e5e7eb;border-bottom-width:6px;background:#fff;color:inherit;font-size:16px;font-weight:800;line-height:1.3;cursor:pointer;box-shadow:var(--e-1);transition:transform .12s,border-color .15s,border-bottom-width .08s,background .2s;-webkit-tap-highlight-color:transparent}
.om-card:active{transform:translateY(3px);border-bottom-width:3px}
html.dark .om-card{background:#1e1e1e;border-color:#3f3f46}
.om-card.om-long{font-size:13.5px}
.om-stage-trio .om-card{max-height:140px;min-height:74px;font-size:14.5px}
.om-in{animation:omIn .28s cubic-bezier(.2,.9,.3,1.25) both}
.om-year{display:block;max-height:0;opacity:0;overflow:hidden;font-size:26px;font-weight:1000;font-variant-numeric:tabular-nums;transition:max-height .2s,opacity .2s}
.om-revealed .om-year{max-height:40px;opacity:1;animation:omStamp .3s cubic-bezier(.2,.9,.3,1.5)}
.om-right{border-color:#22c55e!important;background:#f0fdf4!important}
.om-right .om-year{color:#16a34a}
html.dark .om-right{background:#052e16!important}
.om-wrong{border-color:#f43f5e!important;background:#fff1f2!important;animation:omShake .32s}
.om-wrong .om-year{color:#e11d48}
html.dark .om-wrong{background:#3b0a14!important}
.om-picked{border-color:#8b5cf6}
.om-num-badge{position:absolute;top:8px;left:10px;min-width:24px;height:24px;border-radius:999px;background:#8b5cf6;color:#fff;font-size:13px;font-weight:1000;display:none;align-items:center;justify-content:center;padding:0 6px}
.om-picked .om-num-badge,.om-shown .om-num-badge{display:flex}
.om-shown:not(.om-picked):not(.om-wrong) .om-num-badge{background:#22c55e}
.om-vs{align-self:center;flex-shrink:0;font-size:22px;line-height:1;padding:5px 12px;border-radius:999px;background:#fff;border:2px solid #e5e7eb;margin:-18px 0;z-index:1;animation:omSpin 2.4s linear infinite}
html.dark .om-vs{background:#1e1e1e;border-color:#3f3f46}
.om-vs-gap{animation:omPop .3s cubic-bezier(.2,.9,.3,1.5);font-size:13px;font-weight:1000;color:#4f46e5;padding:6px 12px}
html.dark .om-vs-gap{color:#a5b4fc}
.om-float{position:absolute;right:12px;top:8px;font-size:15px;font-weight:1000;color:#ea580c;pointer-events:none;animation:omFloat .8s ease-out forwards}
.om-msg{text-align:center;color:#64748b;font-size:15px;display:flex;flex-direction:column;gap:4px;align-items:center}
.om-line-box{flex-shrink:0;margin-top:8px;padding-bottom:14px}
.om-line-cap{display:flex;justify-content:space-between;font-size:var(--t-micro);font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:4px}
.om-line{position:relative;height:22px;border-radius:999px;background:linear-gradient(90deg,#fde68a 0%,#fde68a ${_pos(1700)}%,#a5f3fc ${_pos(1700)}%,#a5f3fc ${_pos(1800)}%,#ddd6fe ${_pos(1800)}%,#ddd6fe ${_pos(1900)}%,#fecdd3 ${_pos(1900)}%);overflow:visible}
html.dark .om-line{opacity:.85}
.om-tickmark{position:absolute;top:100%;transform:translateX(-50%);font-size:var(--t-micro);font-weight:800;color:#9ca3af;margin-top:1px}
.om-dot{position:absolute;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:999px;border:2px solid #fff;box-shadow:var(--e-1);animation:omDrop .45s cubic-bezier(.2,.9,.3,1.4)}
#om-end{position:fixed;inset:0;z-index:${Z + 1};display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);padding:16px}
.om-end-card{background:#fff;color:#1f2937;border-radius:var(--r-md);box-shadow:var(--e-3);text-align:center;padding:22px 20px;width:100%;max-width:380px;max-height:100%;overflow-y:auto;animation:omIn .3s cubic-bezier(.2,.9,.3,1.25)}
html.dark .om-end-card{background:#1e1e1e;color:#e5e7eb}
.om-end-title{font-size:15px;font-weight:1000;letter-spacing:.12em;text-transform:uppercase;margin-top:8px}
.om-end-score{font-size:34px;font-weight:1000;font-variant-numeric:tabular-nums;margin-top:4px}
.om-end-sub{font-size:11.5px;font-weight:800;color:#9ca3af;margin-top:2px}
.om-end-rate{font-size:13px;font-weight:1000;margin-top:6px}
.om-mis{margin-top:12px;text-align:left;background:#f8fafc;border-radius:var(--r-md);padding:10px 12px}
html.dark .om-mis{background:#2a2a2a}
.om-mis-cap{font-size:var(--t-micro);font-weight:1000;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px}
.om-mis ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.om-mis li{font-size:12px;font-weight:700;line-height:1.35}
.om-mis-y{display:inline-block;font-weight:1000;color:#4f46e5;font-variant-numeric:tabular-nums;margin-right:2px}
html.dark .om-mis-y{color:#a5b4fc}
.om-mis-arrow{color:#9ca3af;margin:0 6px;font-weight:1000}
.om-big{display:block;width:100%;border:none;border-radius:var(--r-md);font-weight:1000;text-transform:uppercase;letter-spacing:.06em;padding:12px;margin-top:8px;font-size:12px;cursor:pointer;background:#f3f4f6;color:#4b5563}
html.dark .om-big{background:#2c2c2c;color:#d1d5db}
.om-big-main{background:#2563eb!important;color:#fff!important;font-size:13px;padding:13px;margin-top:14px}
.om-link{background:none;border:none;color:#3b82f6;font-weight:1000;font-size:12px;text-decoration:underline;margin-top:10px;cursor:pointer}
@media (min-width:640px){
  .om-stage-pair{flex-direction:row;align-items:stretch}
  .om-stage-pair .om-card{max-height:none;min-height:200px;font-size:18px}
  .om-stage-pair .om-vs{align-self:center;margin:0 -22px}
}
@media (max-height:600px){.om-card{min-height:72px;font-size:14px;padding:10px 12px}.om-year{font-size:21px}}
@keyframes omIn{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
@keyframes omStamp{0%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes omShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
@keyframes omPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes omPop{0%{transform:scale(.4)}100%{transform:scale(1)}}
@keyframes omSpin{0%,40%{transform:rotate(0)}50%,90%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}
@keyframes omFloat{0%{opacity:0;transform:translateY(6px)}20%{opacity:1}100%{opacity:0;transform:translateY(-26px)}}
@keyframes omDrop{0%{transform:translateY(-22px) scale(1.6);opacity:0}100%{transform:none;opacity:1}}
`;
        document.head.appendChild(st);
    } catch (e) {}
})();
