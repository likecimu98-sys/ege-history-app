// tetris-mode.js — «Датрис»: тетрис с датами. Внизу четыре «стакана» с событиями одной
// эпохи, сверху падает год. Двигаешь блок в стакан с нужным событием:
//  • попал — блок сгорает и выбивает один кирпич из этого стакана;
//  • промахнулся — год остаётся лежать кирпичом там, куда упал;
//  • стакан забит до верха — нокаут.
// После каждого броска использованное событие сменяется новым; падение ускоряется
// с каждым попаданием, быстрый сброс даёт бонус.
//
// Два режима на одном движке:
//  • ТРЕНИРОВКА (openTetrisMode) — плитка «Датрис» в «Тренажёрах», до нокаута,
//    рекорд в stats.tetrisBest;
//  • ДУЭЛЬ (openTetrisDuel) — 60 секунд, у обоих одна колода (поле tetrisDeck в
//    документе матча). Нокаут заканчивает матч сразу, выживший получает +50.
//    Мини-стаканы соперника видны в шапке.
//
// АТАКА (как в тетрис-баттлах, и так, чтобы её было ВИДНО):
//  • попадания заряжают шкалу ⚔️ из трёх делений, промах её обнуляет;
//  • полная шкала — кирпич видимо улетает сопернику;
//  • у соперника над полем повисает «туча» с отсчётом 3 с: попадание в это
//    время ОТБИВАЕТ кирпич (и не заряжает свою шкалу), не успел — кирпич падает
//    в самый высокий стакан. Отбил — атакующему показываем «Соперник отбил».
//
// 🔴 tetrisDeck обязан быть в MATCH_CREATE_FIELDS на сервере (store.js), а длительность
// 'tetris' — в DUEL_DURATION_MS. Без первого матч не создаётся (403), без второго
// сервер закроет запись в матч раньше конца игры.
'use strict';

(function () {
    const DUEL_MS = 60000;
    window.TETRIS_DUEL_MS = DUEL_MS;
    const Z = 10006;
    const ROWS = 6;                 // кирпичей в стакане до нокаута
    const FALL_START = 6500, FALL_MIN = 2300, FALL_STEP = 0.95; // мс на всё падение
    const MAX_TEXT = 60;            // длиннее не влезает в узкий стакан на телефоне
    const ATTACK_EVERY = 3;         // делений шкалы заряда на один кирпич сопернику
    const THREAT_MS = 3000;         // сколько «туча» висит до падения — время отбиться
    const TUT_KEY = 'dt_tutorial_v1', DUEL_TIP_KEY = 'dt_duel_tip_v1';
    const KO_BONUS = 50;
    const DUEL_STEPS = 80;          // бросков в колоде — заведомо больше, чем успевают
    const ERAS = [
        { id: 'early', t: 'IX–XVII век', a: 800, b: 1699 },
        { id: '18th', t: 'XVIII век', a: 1700, b: 1799 },
        { id: '19th', t: 'XIX век', a: 1800, b: 1899 },
        { id: '20th', t: 'XX–XXI век', a: 1900, b: 2100 }
    ];

    let _g = null;

    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function _fmtLeft(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    // ─── Звук: общий синтезатор «Кто раньше» (order-mode.js) ────────────────
    function _sfx(name) { try { const s = window.OrderSfx; if (s && s[name]) s[name].apply(null, [].slice.call(arguments, 1)); } catch (e) {} }
    function _tone() { try { const s = window.OrderSfx; if (s && s.tone) s.tone.apply(null, arguments); } catch (e) {} }
    const Snd = {
        move() { _tone(620, 0, 0.03, 'triangle', 0.05); },
        land() { _tone(150, 0, 0.12, 'square', 0.07, 90); },
        clear() { _tone(1318.5, 0.05, 0.12, 'sine', 0.12); _tone(1760, 0.11, 0.16, 'sine', 0.1); },
        junk() { _tone(120, 0, 0.3, 'sawtooth', 0.1, 55); _tone(95, 0.12, 0.3, 'square', 0.06, 50); },
        attack() { [784, 988, 1175, 1568].forEach((f, i) => _tone(f, i * 0.05, 0.1, 'square', 0.06)); },
        warn() { [880, 660, 880, 660].forEach((f, i) => _tone(f, i * 0.12, 0.1, 'triangle', 0.09)); },
        block() { _tone(523.25, 0, 0.08, 'square', 0.07); _tone(1046.5, 0.06, 0.18, 'triangle', 0.12); }
    };

    // ─── События ─────────────────────────────────────────────────────────────
    // Из order-data.js берём только события в пределах ОДНОГО года: падающий блок
    // несёт год, и «1700–1721» ему не соответствует ни одному правильно.
    function _all() {
        const out = [], seen = new Set();
        for (const r of (window.orderEventsData || [])) {
            const y = Math.floor(r[1] / 10000);
            if (y !== Math.floor(r[2] / 10000) || r[0].length > MAX_TEXT || seen.has(r[0])) continue;
            seen.add(r[0]);
            out.push({ t: r[0], y });
        }
        return out;
    }
    function _poolFor(a, b) { return _all().filter(e => e.y >= a && e.y <= b); }

    // Мешок событий: выдаёт событие, чей год не совпадает с годами стаканов (иначе
    // один год подходил бы к двум стаканам), и пересыпается, когда опустел.
    function _bag(pool) {
        let bag = [];
        return function take(busyYears, busyTexts) {
            for (let round = 0; round < 2; round++) {
                const i = bag.findIndex(e => busyYears.indexOf(e.y) === -1 && busyTexts.indexOf(e.t) === -1);
                if (i >= 0) return bag.splice(i, 1)[0];
                bag = _shuffle(pool.slice());
            }
            return null;
        };
    }
    // Следующий бросок: какой стакан «целевой» и чем его заменить после броска.
    // Замена — при любом исходе: событие отыграно, и оба игрока дуэли идут по
    // одной и той же цепочке независимо от своих промахов.
    function _nextStep(cups, take, last) {
        let ti;
        do { ti = Math.floor(Math.random() * 4); } while (ti === last && Math.random() < 0.75);
        const n = take(cups.map(c => c.y), cups.map(c => c.t));
        return n ? { t: ti, n: { t: n.t, y: n.y } } : null;
    }

    window.buildTetrisDuelDeck = function () {
        const eras = _shuffle(ERAS.slice());
        for (const era of eras) {
            const pool = _poolFor(era.a, era.b);
            if (pool.length < 30) continue;
            const take = _bag(pool);
            const cups = [];
            for (let i = 0; i < 4; i++) { const e = take(cups.map(c => c.y), cups.map(c => c.t)); if (!e) return null; cups.push({ t: e.t, y: e.y }); }
            const init = cups.map(c => ({ t: c.t, y: c.y }));
            const steps = [];
            let last = -1;
            for (let k = 0; k < DUEL_STEPS; k++) {
                const st = _nextStep(cups, take, last);
                if (!st) break;
                steps.push(st); last = st.t; cups[st.t] = st.n;
            }
            if (steps.length >= 30) return { era: era.id, init, steps };
        }
        return null;
    };

    // Рамки тренировки — из лобби (#filter-period / «свои годы»), как в «Кто раньше».
    // Вся история → эпоха по жребию: стаканы из разных веков угадываются без знания.
    function _soloEra() {
        const g = id => document.getElementById(id);
        const period = (g('filter-period') && g('filter-period').value) || 'all';
        let a = null, b = null, label = '';
        if (period === 'custom') {
            a = parseInt(g('custom-year-start') && g('custom-year-start').value, 10);
            b = parseInt(g('custom-year-end') && g('custom-year-end').value, 10);
            label = `${a}–${b}`;
        } else {
            const era = ERAS.find(e => e.id === period);
            if (era) { a = era.a; b = era.b; label = era.t; }
        }
        if (isFinite(a) && isFinite(b)) {
            const pool = _poolFor(Math.min(a, b), Math.max(a, b));
            if (pool.length >= 12) return { pool, label };
        }
        const era = _shuffle(ERAS.slice())[0];
        return { pool: _poolFor(era.a, era.b), label: era.t };
    }

    // ─── Запуск ──────────────────────────────────────────────────────────────
    function _start(o) {
        if (_g) window.closeTetrisMode();
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        _g = Object.assign({
            cups: [], stacks: [[], [], [], []], step: null, stepIdx: -1,
            block: null, score: 0, streak: 0, best: 0, hits: 0, drops: 0,
            atkSent: 0, oppAtkSeen: 0, ko: false, over: false, busy: false,
            charge: 0, incoming: [], blkSent: 0, oppBlkSeen: 0, paused: false, pausedAt: 0,
            oppScore: 0, oppHits: 0, oppHs: [0, 0, 0, 0], oppKo: false, oppName: 'Соперник',
            misses: [], raf: 0, timerIv: null, lastTickSec: null, hiddenAt: 0, test: false
        }, o);
        _render();
        _g.raf = requestAnimationFrame(_frame);
        if (_g.duel) { _g.timerIv = setInterval(_tick, 100); _tick(); }
        document.addEventListener('keydown', _onKey);
        document.addEventListener('visibilitychange', _onVis);
        _nextBlock();
        _h('medium');
        if (!_g.duel && !_seen(TUT_KEY)) _tutorial();
        else if (_g.duel && !_seen(DUEL_TIP_KEY)) _duelTip();
    }

    window.openTetrisDuel = function (opts) {
        const deck = opts && opts.deck;
        if (!deck || !Array.isArray(deck.init) || deck.init.length !== 4 || !Array.isArray(deck.steps) || !deck.steps.length) {
            if (typeof showToast === 'function') showToast('⚠️', 'Не удалось получить колоду дуэли', 'bg-rose-500', 'border-rose-700');
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
            return;
        }
        const era = ERAS.find(e => e.id === deck.era);
        _start({
            duel: true, deck, cups: deck.init.map(c => ({ t: c.t, y: c.y })),
            label: era ? era.t : '', oppName: (opts && opts.oppName) || 'Соперник',
            endsAt: (opts && opts.endsAt) || (Date.now() + DUEL_MS), test: !!(opts && opts.test)
        });
    };

    window.openTetrisMode = function () {
        if (window.canSolveMore) {
            const lim = window.canSolveMore();
            if (!lim.ok) { if (window.showDailyLimitModal) window.showDailyLimitModal(); return; }
        }
        const { pool, label } = _soloEra();
        if (pool.length < 8) { if (typeof showToast === 'function') showToast('⚠️', 'События ещё загружаются — попробуй через секунду', 'bg-amber-500', 'border-amber-700'); return; }
        const take = _bag(pool);
        const cups = [];
        for (let i = 0; i < 4; i++) cups.push(take(cups.map(c => c.y), cups.map(c => c.t)));
        _start({ duel: false, take, cups, label, test: true });
    };

    window.closeTetrisMode = function () {
        if (!_g) return;
        cancelAnimationFrame(_g.raf);
        if (_g.timerIv) clearInterval(_g.timerIv);
        document.removeEventListener('keydown', _onKey);
        document.removeEventListener('visibilitychange', _onVis);
        if (_g.duel && !_g.test) {
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        ['tetris-overlay', 'dt-end'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
        _g = null;
        if (window.updateProgressBars) window.updateProgressBars();
    };

    // ─── Дуэль: соперник ─────────────────────────────────────────────────────
    function _report() {
        if (!_g || !_g.duel || _g.test) return;
        try {
            window.updateDuelScoreDb && window.updateDuelScoreDb(_g.score, _g.streak, {
                done: _g.drops, correct: _g.hits, atk: _g.atkSent, blk: _g.blkSent, ko: _g.ko, hs: _g.stacks.map(s => s.length)
            });
        } catch (e) {}
    }

    window.updateTetrisDuelOpp = function (opp) {
        if (!_g || !opp || !_g.duel) return;
        _g.oppScore = opp.score || 0;
        _g.oppHits = opp.correct || 0;
        if (Array.isArray(opp.hs)) _g.oppHs = opp.hs.slice(0, 4).map(n => Number(n) || 0);
        const atk = Number(opp.atk) || 0;
        if (atk > _g.oppAtkSeen && !_g.over) {
            const n = atk - _g.oppAtkSeen;
            _g.oppAtkSeen = atk;
            _threat(n);
        }
        const blk = Number(opp.blk) || 0;
        if (blk > _g.oppBlkSeen && !_g.over) {
            _g.oppBlkSeen = blk;
            _toast('🛡 Соперник отбил твой кирпич', 'bad');
        }
        if (opp.ko && !_g.oppKo && !_g.over) {
            _g.oppKo = true;
            _g.score += KO_BONUS;
            _toast(`💥 Нокаут! +${KO_BONUS}`, 'ok');
            _report();
            setTimeout(_finish, 700);
        }
        _hud();
    };

    // Атака соперника: сначала «туча» с отсчётом — время отбиться попаданием.
    function _threat(n) {
        const at = Date.now() + THREAT_MS;
        for (let i = 0; i < n; i++) _g.incoming.push({ at: at + i * 400 });
        Snd.warn(); _h('warning');
        _toast('⚠️ Летит кирпич! Попади — отобьёшь', 'bad');
        _threatUi();
    }
    function _threatUi() {
        const el = document.getElementById('dt-threat');
        if (!el || !_g) return;
        const q = _g.incoming;
        if (!q.length) { el.classList.remove('dt-threat-on'); return; }
        const left = Math.max(0, q[0].at - Date.now());
        el.classList.add('dt-threat-on');
        el.innerHTML = `<span>🧱${q.length > 1 ? ' ×' + q.length : ''}</span><b>${Math.ceil(left / 1000)}</b><i style="width:${Math.round(left / THREAT_MS * 100)}%"></i>`;
    }

    // Кирпич от соперника — в самый высокий стакан: так нокаут достижим, и видно,
    // как соперник добивает, а не случайно сыплет куда попало.
    function _junk() {
        const top = Math.max(..._g.stacks.map(s => s.length));
        const cols = [0, 1, 2, 3].filter(c => _g.stacks[c].length === top);
        const col = cols[Math.floor(Math.random() * cols.length)];
        _g.stacks[col].push({ junk: true });
        Snd.junk(); _h('warning');
        _toast('🧱 Кирпич упал!', 'bad');
        _drawStacks(col);
        _checkKo();
        _report();
    }

    // ─── Цикл игры ───────────────────────────────────────────────────────────
    function _fallMs() { return Math.max(FALL_MIN, FALL_START * Math.pow(FALL_STEP, _g.hits)); }

    function _nextBlock() {
        if (!_g || _g.over) return;
        _g.stepIdx++;
        if (_g.duel) {
            _g.step = _g.deck.steps[_g.stepIdx];
            if (!_g.step) { _g.block = null; _toast('🚀 Колода пройдена — ждём конца', 'ok'); return; }
        } else {
            _g.step = _nextStep(_g.cups, _g.take, _g.step ? _g.step.t : -1);
            if (!_g.step) { _g.block = null; return; }
        }
        const y = _g.cups[_g.step.t].y;
        _g.block = { y, col: Math.floor(Math.random() * 4), t0: performance.now(), fall: _fallMs(), p: 0 };
        // Отсчёт кадров — с появления блока: иначе пауза до ПЕРВОГО кадра не
        // считалась бы остановкой, и новый блок проскакивал бы до дна сам.
        _g.lastFrame = _g.block.t0;
        _g.busy = false;
        const b = document.getElementById('dt-block');
        if (b) { b.textContent = y; b.classList.remove('dt-hide'); b.classList.add('dt-pop'); setTimeout(() => b && b.classList.remove('dt-pop'), 250); }
        _placeBlock(true);
    }

    function _frame(now) {
        if (!_g) return;
        _g.raf = requestAnimationFrame(_frame);
        const bl = _g.block;
        const gap = _g.lastFrame ? now - _g.lastFrame : 0;
        _g.lastFrame = now;
        if (!bl || _g.busy || _g.over || _g.paused) return;
        // Кадры встали (телефон подтормозил, Telegram свёрнут, вкладка в фоне) —
        // падение ставим на паузу, а не догоняем: иначе блок проскакивает до дна
        // сам и засчитывается туда, где случайно стоял.
        if (gap > 250) bl.t0 += gap - 16;
        bl.p = Math.min(1, (now - bl.t0) / bl.fall);
        _placeBlock(false);
        if (bl.p >= _floorP(bl.col)) _land(false);
    }

    // Доля пути, на которой блок встаёт на кирпичи стакана.
    function _floorP(col) { return 1 - _g.stacks[col].length / (ROWS + 1); }

    function _placeBlock(instant) {
        const b = document.getElementById('dt-block');
        const f = document.getElementById('dt-field');
        if (!b || !f || !_g.block) return;
        const bh = f.clientHeight / (ROWS + 1);
        const colW = f.clientWidth / 4;
        b.style.transition = instant ? 'none' : 'left .12s ease-out';
        b.style.width = (colW - 8) + 'px';
        b.style.height = (bh - 6) + 'px';
        b.style.left = (_g.block.col * colW + 4) + 'px';
        b.style.top = (_g.block.p * (f.clientHeight - bh) + 3) + 'px';
        const lane = document.getElementById('dt-lane');
        if (lane) { lane.style.left = (_g.block.col * colW) + 'px'; lane.style.width = colW + 'px'; }
    }

    function _move(col) {
        if (!_g || !_g.block || _g.busy || _g.over || _g.paused) return;
        col = Math.max(0, Math.min(3, col));
        if (col === _g.block.col) return;
        _g.block.col = col;
        Snd.move(); _h('light');
        _placeBlock(false);
        // Вдвинули в стакан, где кирпичи уже выше блока, — он там и встаёт.
        if (_g.block.p >= _floorP(col)) _land(false);
    }

    function _drop(col) {
        if (!_g || !_g.block || _g.busy || _g.over || _g.paused) return;
        if (col != null) _g.block.col = Math.max(0, Math.min(3, col));
        _land(true);
    }

    function _land(hard) {
        const bl = _g.block;
        if (!bl || _g.busy) return;
        _g.busy = true;
        try { window.OrderSfx && window.OrderSfx.wake && window.OrderSfx.wake(); } catch (e) {}
        const left = 1 - bl.p;               // сколько пути ещё оставалось — бонус за скорость
        bl.p = _floorP(bl.col);
        _placeBlock(false);
        const ti = _g.step.t;
        const ok = bl.col === ti;
        _g.drops++;
        const b = document.getElementById('dt-block');
        if (ok) {
            _g.hits++; _g.streak++; _g.best = Math.max(_g.best, _g.streak);
            // Основа — как в свайпе, подборе и «Кто раньше»: 10 + бонус серии (до +20).
            const gain = 10 + Math.min(20, (_g.streak - 1) * 2) + Math.round((hard ? left : 0) * 10);
            _g.score += gain;
            const cleared = _g.stacks[ti].length > 0;
            if (cleared) _g.stacks[ti].pop();
            _sfx('ok', _g.streak); if (cleared) Snd.clear();
            _h('success');
            _cupFlash(ti, 'ok', '+' + gain);
            if (b) b.classList.add('dt-burn');
            if (!_g.duel && window.creditNorm) window.creditNorm(1, 'task1');
            if (_g.duel) {
                if (_g.incoming.length) {
                    // Летит кирпич — попадание его отбивает, а шкалу не заряжает.
                    _g.incoming.shift();
                    _g.blkSent++;
                    Snd.block();
                    _toast('🛡 Отбито!', 'ok');
                    _threatUi();
                } else if (++_g.charge >= ATTACK_EVERY) {
                    _g.charge = 0;
                    _g.atkSent++;
                    Snd.attack();
                    _flyAttack();
                    _toast('⚔️ Кирпич летит сопернику!', 'ok');
                }
            }
            _drawStacks(ti);
        } else {
            _g.streak = 0;
            _g.charge = 0;
            _g.stacks[bl.col].push({ y: bl.y });
            _g.misses.push({ y: bl.y, right: _g.cups[ti].t, got: _g.cups[bl.col].t });
            Snd.land(); _sfx('bad'); _h('error');
            _cupFlash(bl.col, 'bad');
            _cupFlash(ti, 'hint', String(bl.y));
            if (b) b.classList.add('dt-hide');
            _drawStacks(bl.col);
        }
        _hud();
        _report();
        if (_checkKo()) return;
        // Промах — пауза длиннее: успеть увидеть, куда год был должен упасть.
        setTimeout(() => {
            if (!_g || _g.over) return;
            if (b) b.classList.remove('dt-burn', 'dt-hide');
            _g.cups[ti] = _g.step.n;
            _drawCup(ti, true);
            _nextBlock();
        }, ok ? 260 : 900);
    }

    function _checkKo() {
        if (!_g || _g.over || !_g.stacks.some(s => s.length >= ROWS)) return false;
        // over — сразу: кирпич соперника может переполнить стакан посреди паузы
        // после броска, и отложенный _nextBlock не должен выдать новый блок.
        _g.ko = true; _g.over = true;
        _g.block = null;
        const b = document.getElementById('dt-block'); if (b) b.classList.add('dt-hide');
        _sfx('lose'); _h('error');
        _toast('💥 Стакан переполнен!', 'bad');
        _report();
        setTimeout(() => (_g && _g.duel ? _finish() : _soloEnd(false)), 800);
        return true;
    }

    function _tick() {
        if (!_g) return;
        const left = _g.endsAt - Date.now();
        const el = document.getElementById('dt-timer');
        if (el) { el.textContent = _fmtLeft(left); el.classList.toggle('dt-hurry', left <= 5000 && left > 0); }
        const sec = Math.ceil(left / 1000);
        if (!_g.over && sec <= 5 && sec >= 1 && sec !== _g.lastTickSec) { _g.lastTickSec = sec; _sfx('tick', sec === 1); }
        if (left <= 0 && !_g.over) return _finish();
        // «Туча» дождалась — кирпич падает.
        while (!_g.over && _g.incoming.length && _g.incoming[0].at <= Date.now()) { _g.incoming.shift(); _junk(); }
        _threatUi();
    }

    function _flyAttack() {
        const f = document.getElementById('dt-field'), b = document.getElementById('dt-block');
        if (!f || !b) return;
        const d = document.createElement('div');
        d.className = 'dt-fly';
        d.textContent = '🧱';
        d.style.left = b.style.left; d.style.top = b.style.top;
        f.appendChild(d);
        setTimeout(() => d.remove(), 800);
    }

    // ─── Обучение ────────────────────────────────────────────────────────────
    function _seen(key) { try { return localStorage.getItem(key) === '1'; } catch (e) { return true; } }
    function _markSeen(key) { try { localStorage.setItem(key, '1'); } catch (e) {} }

    // Первая тренировка: три шага поверх поля, падение на паузе.
    const TUT = [
        { target: 'dt-block', text: 'Сверху падает <b>год</b>.' },
        { target: 'dt-cups', text: 'Тапни <b>стакан</b> с событием этого года — год полетит туда. Можно и двигать стрелками ← →, и ронять ↓.' },
        { target: 'dt-field', text: 'Промах оставляет <b>кирпич</b>, попадание выбивает кирпич из стакана. Стакан из 6 кирпичей — конец игры.' }
    ];
    function _tutorial() {
        _g.paused = true; _g.pausedAt = performance.now();
        const ov = document.getElementById('tetris-overlay');
        if (!ov) return;
        const box = document.createElement('div');
        box.id = 'dt-tut';
        ov.appendChild(box);
        let i = 0;
        const show = () => {
            document.querySelectorAll('.dt-spot').forEach(el => el.classList.remove('dt-spot'));
            const t = document.getElementById(TUT[i].target);
            if (t) t.classList.add('dt-spot');
            box.className = 'dt-tut-' + (i === 1 ? 'top' : 'bottom');
            box.innerHTML = `<div class="dt-tut-card"><div class="dt-tut-n">${i + 1} / ${TUT.length}</div><div class="dt-tut-t">${TUT[i].text}</div><button class="dt-tut-btn">${i < TUT.length - 1 ? 'Дальше' : 'Играть!'}</button></div>`;
            box.querySelector('.dt-tut-btn').onclick = () => {
                _h('light');
                if (++i < TUT.length) return show();
                box.remove();
                document.querySelectorAll('.dt-spot').forEach(el => el.classList.remove('dt-spot'));
                _markSeen(TUT_KEY);
                if (_g && _g.block) _g.block.t0 += performance.now() - _g.pausedAt;
                if (_g) { _g.paused = false; _g.lastFrame = performance.now(); }
            };
        };
        show();
    }

    // Первая дуэль: таймер общий, паузы нет — короткая подсказка поверх поля.
    function _duelTip() {
        const f = document.getElementById('dt-field');
        if (!f) return;
        const d = document.createElement('div');
        d.className = 'dt-coach';
        d.innerHTML = '👇 Тапни стакан с событием этого года.<br>⚔️ 3 попадания — кирпич сопернику.<br>🛡 Летит кирпич в тебя — попади, чтобы отбить.';
        f.appendChild(d);
        _markSeen(DUEL_TIP_KEY);
        setTimeout(() => { d.classList.add('dt-coach-out'); setTimeout(() => d.remove(), 400); }, 7000);
    }

    // Вкладка скрыта — блок не должен «упасть сам» за время отсутствия.
    function _onVis() {
        if (!_g || !_g.block) return;
        if (document.hidden) _g.hiddenAt = performance.now();
        else if (_g.hiddenAt) { _g.block.t0 += performance.now() - _g.hiddenAt; _g.hiddenAt = 0; }
    }

    function _onKey(e) {
        if (!_g || !_g.block) return;
        if (e.key === 'ArrowLeft') { _move(_g.block.col - 1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { _move(_g.block.col + 1); e.preventDefault(); }
        else if (e.key === 'ArrowDown' || e.key === ' ') { _drop(); e.preventDefault(); }
        else if (e.key >= '1' && e.key <= '4') { _drop(Number(e.key) - 1); e.preventDefault(); }
    }

    // ─── Отрисовка ───────────────────────────────────────────────────────────
    function _render() {
        const old = document.getElementById('tetris-overlay'); if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'tetris-overlay';
        const muted = !!(window.Sfx && window.Sfx.isMuted && window.Sfx.isMuted());
        const best = Number(window.state && window.state.stats && window.state.stats.tetrisBest) || 0;
        ov.innerHTML = `
          <div class="dt-wrap">
            <div class="dt-head">
              <div class="dt-title">
                <div class="dt-kicker">🧱 Датрис${_g.label ? ' · ' + _esc(_g.label) : ''}</div>
                <div class="dt-sub">Счёт <b id="dt-score">0</b> · <span id="dt-streak">🔥0</span>${_g.duel ? ' · <span class="dt-charge" id="dt-charge" title="3 попадания — кирпич сопернику">⚔️<i></i><i></i><i></i></span>' : ` · ${best ? '🏆 ' + best : 'первая игра!'}`}</div>
              </div>
              ${_g.duel ? `<div id="dt-timer" class="dt-timer">${_fmtLeft(DUEL_MS)}</div>` : ''}
              <div class="dt-btns">
                <button id="dt-mute" class="dt-btn" aria-label="Звук">${muted ? '🔇' : '🔊'}</button>
                <button id="dt-exit" class="dt-btn">✕</button>
              </div>
            </div>
            ${_g.duel ? `
            <div class="dt-opp">
              <span class="dt-opp-name">${_esc(_g.oppName)}</span>
              <span id="dt-opp-score" class="dt-opp-score">0</span>
              <span class="dt-mini" id="dt-mini"><i></i><i></i><i></i><i></i></span>
              <span class="dt-atk">⚔️ шкала полна — кирпич сопернику</span>
            </div>` : `<div class="dt-hint">Тапни стакан — год упадёт туда. Промах оставляет кирпич.</div>`}
            <div id="dt-field" class="dt-field">
              <div class="dt-cols"><i></i><i></i><i></i><i></i></div>
              <div id="dt-lane" class="dt-lane"></div>
              <div id="dt-stacks"></div>
              <div id="dt-block" class="dt-block"></div>
              <div id="dt-threat" class="dt-threat"></div>
              <div id="dt-toast" class="dt-toast"></div>
            </div>
            <div id="dt-cups" class="dt-cups"></div>
            <div class="dt-ctrl">
              <button class="dt-key" id="dt-l" aria-label="Влево">←</button>
              <button class="dt-key dt-key-main" id="dt-d" aria-label="Уронить">↓</button>
              <button class="dt-key" id="dt-r" aria-label="Вправо">→</button>
            </div>
          </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#dt-exit').onclick = _requestExit;
        ov.querySelector('#dt-mute').onclick = e => {
            const m = !(window.Sfx && window.Sfx.isMuted());
            if (window.Sfx) window.Sfx.setMuted(m);
            e.currentTarget.textContent = m ? '🔇' : '🔊';
        };
        ov.querySelector('#dt-l').onclick = () => _g && _g.block && _move(_g.block.col - 1);
        ov.querySelector('#dt-r').onclick = () => _g && _g.block && _move(_g.block.col + 1);
        ov.querySelector('#dt-d').onclick = () => _drop();
        // Поле: тап по колонке — сдвиг туда, свайп вниз — сброс.
        const field = ov.querySelector('#dt-field');
        let sy = 0, sx = 0;
        field.addEventListener('pointerdown', e => { sy = e.clientY; sx = e.clientX; try { window.OrderSfx && window.OrderSfx.wake && window.OrderSfx.wake(); } catch (er) {} });
        field.addEventListener('pointerup', e => {
            if (!_g || !_g.block) return;
            const r = field.getBoundingClientRect();
            if (e.clientY - sy > 40 && Math.abs(e.clientX - sx) < 60) return _drop();
            _move(Math.floor((e.clientX - r.left) / (r.width / 4)));
        });
        for (let i = 0; i < 4; i++) _drawCup(i, false);
        _drawStacks();
        _hud();
    }

    // Мягкие переносы по слогам для узких стаканов. Встроенных русских переносов
    // (hyphens:auto) нет в части браузеров, и overflow-wrap рвёт слово где попало:
    // «Петербург-а», «Составлени-е». Правила простые — V-CV и VC-CV, без
    // одиночных букв по краям и без разрыва перед ь/ъ/й; для стакана хватает.
    const VOW = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ', NOBREAK = 'ьъйЬЪЙ';
    function _hyWord(w) {
        if (w.length < 8) return w;
        const isV = ch => VOW.indexOf(ch) !== -1;
        const cut = [];
        for (let i = 2; i <= w.length - 2; i++) {
            const prev = w.slice(0, i), rest = w.slice(i);
            if (![...prev].some(isV) || ![...rest].some(isV) || NOBREAK.indexOf(w[i]) !== -1) continue;
            if (!/[а-яё]/i.test(w[i]) || !/[а-яё]/i.test(w[i - 1])) continue;
            const vcv = isV(w[i - 1]) && !isV(w[i]) && isV(w[i + 1]);          // по-ле
            const vccv = !isV(w[i - 1]) && isV(w[i - 2]) && !isV(w[i]) && isV(w[i + 1]); // пет-ро
            if ((vcv || vccv) && (!cut.length || i - cut[cut.length - 1] >= 2)) cut.push(i);
        }
        let out = '', from = 0;
        for (const c of cut) { out += w.slice(from, c) + '­'; from = c; }
        return out + w.slice(from);
    }
    function _hy(text) { return String(text).replace(/[А-Яа-яЁё]+/g, _hyWord); }

    function _drawCup(i, fresh) {
        const box = document.getElementById('dt-cups');
        if (!box) return;
        let el = box.children[i];
        if (!el) { el = document.createElement('button'); el.className = 'dt-cup'; el.lang = 'ru'; el.onclick = () => _drop(i); box.appendChild(el); }
        el.textContent = _hy(_g.cups[i].t);
        el.classList.toggle('dt-cup-small', _g.cups[i].t.length > 38);
        if (fresh) { el.classList.remove('dt-cup-new'); void el.offsetWidth; el.classList.add('dt-cup-new'); }
    }

    function _cupFlash(i, kind, txt) {
        const el = document.getElementById('dt-cups') && document.getElementById('dt-cups').children[i];
        if (!el) return;
        el.classList.remove('dt-cup-ok', 'dt-cup-bad', 'dt-cup-hint');
        void el.offsetWidth;
        el.classList.add('dt-cup-' + kind);
        if (txt) { const f = document.createElement('span'); f.className = 'dt-cup-float'; f.textContent = txt; el.appendChild(f); setTimeout(() => f.remove(), 900); }
        setTimeout(() => el && el.classList.remove('dt-cup-' + kind), 900);
    }

    function _drawStacks(bump) {
        const box = document.getElementById('dt-stacks');
        const f = document.getElementById('dt-field');
        if (!box || !f) return;
        const bh = f.clientHeight / (ROWS + 1), colW = f.clientWidth / 4;
        box.innerHTML = '';
        _g.stacks.forEach((st, c) => st.forEach((br, k) => {
            const d = document.createElement('div');
            d.className = 'dt-brick' + (br.junk ? ' dt-junk' : '') + (bump === c && k === st.length - 1 ? ' dt-drop' : '') + (k >= ROWS - 2 ? ' dt-danger' : '');
            d.style.cssText = `left:${c * colW + 4}px;width:${colW - 8}px;height:${bh - 6}px;top:${f.clientHeight - (k + 1) * bh + 3}px`;
            d.textContent = br.junk ? '🧱' : br.y;
            box.appendChild(d);
        }));
        f.classList.toggle('dt-field-danger', _g.stacks.some(s => s.length >= ROWS - 1));
    }

    function _hud() {
        if (!_g) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set('dt-score', _g.score);
        set('dt-streak', '🔥' + _g.streak);
        set('dt-opp-score', _g.oppScore);
        const ch = document.getElementById('dt-charge');
        if (ch) {
            Array.from(ch.querySelectorAll('i')).forEach((el, i) => el.classList.toggle('dt-on', i < _g.charge));
            ch.classList.toggle('dt-charge-hot', _g.charge === ATTACK_EVERY - 1);
        }
        const mini = document.getElementById('dt-mini');
        if (mini) Array.from(mini.children).forEach((el, i) => { el.style.height = Math.round(Math.min(ROWS, _g.oppHs[i] || 0) / ROWS * 100) + '%'; });
    }

    function _toast(text, kind) {
        const t = document.getElementById('dt-toast');
        if (!t) return;
        t.textContent = text;
        t.className = 'dt-toast dt-toast-' + kind + ' dt-toast-on';
        clearTimeout(_toast._t);
        _toast._t = setTimeout(() => { if (t) t.classList.remove('dt-toast-on'); }, 1300);
    }

    function _requestExit() {
        _h('light');
        if (_g && !_g.duel && !_g.over && _g.drops > 0) return _soloEnd(true);
        if (_g && _g.duel && !_g.over && !_g.test && window.uiConfirm) return window.uiConfirm('Выйти из дуэли? Это засчитается как сдача.', window.closeTetrisMode);
        window.closeTetrisMode();
    }

    function _missesHtml(list) {
        return list.map(m => `<li><span class="dt-mis-y">${m.y}</span> ${_esc(m.right)}${m.got !== m.right ? `<span class="dt-mis-got">а не «${_esc(m.got)}»</span>` : ''}</li>`).join('');
    }

    // ─── Финалы ──────────────────────────────────────────────────────────────
    function _stop() {
        _g.over = true; _g.block = null;
        if (_g.timerIv) { clearInterval(_g.timerIv); _g.timerIv = null; }
        const b = document.getElementById('dt-block'); if (b) b.classList.add('dt-hide');
    }

    function _soloEnd(quit) {
        if (!_g || _g.ended) return;
        _stop(); _g.ended = true;
        const s = window.state && window.state.stats;
        const prev = Number(s && s.tetrisBest) || 0;
        const record = _g.score > prev;
        if (s && _g.drops > 0) {
            s.tetrisGames = (Number(s.tetrisGames) || 0) + 1;
            if (record) s.tetrisBest = _g.score;
            try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {}
        }
        _sfx(record ? 'win' : 'lose');
        _panel(`
            <div style="font-size:52px;line-height:1">${record ? '🏆' : quit ? '🧱' : '💥'}</div>
            <div class="dt-end-title" style="color:${record ? '#16a34a' : '#64748b'}">${record ? 'Новый рекорд!' : quit ? 'Игра окончена' : 'Стакан переполнен'}</div>
            <div class="dt-end-score">${_g.score}</div>
            <div class="dt-end-sub">Попаданий ${_g.hits} из ${_g.drops} · лучшая серия 🔥${_g.best}${record || !prev ? '' : ` · рекорд ${prev}`}</div>`,
            '🔁 Ещё раз', () => { window.closeTetrisMode(); window.openTetrisMode(); });
    }

    function _finish() {
        if (!_g || _g.ended) return;
        _stop(); _g.ended = true;
        _report();
        _toast('⏱ Считаем очки…', 'ok');
        setTimeout(_verdict, 400);
    }

    // Финал дуэли — той же процедурой, что свайп, подбор и «Кто раньше»:
    // авторитетные числа из матча, затем Elo, и только потом cancelDuelDb.
    async function _verdict() {
        if (!_g) return;
        let my = _g.score, opp = _g.oppScore, oppEloDoc = null, rate = null;
        if (!_g.test) {
            try {
                const fin = window.finalizeDuelScores
                    ? await window.finalizeDuelScores(_g.score, _g.streak, { done: _g.drops, correct: _g.hits, atk: _g.atkSent, blk: _g.blkSent, ko: _g.ko, hs: _g.stacks.map(s => s.length) })
                    : null;
                if (fin) { my = fin.mine; opp = fin.opp; oppEloDoc = fin.oppElo; }
            } catch (e) { console.warn('[Duel] finalize:', e); }
            try {
                const oppElo = oppEloDoc || (window.state && window.state.duel && window.state.duel.oppElo) || 1000;
                rate = window.applyDuelResult ? window.applyDuelResult(my, opp, oppElo) : null;
                if (rate) { if (window.saveProgress) window.saveProgress(); if (window.syncNow) window.syncNow(); }
            } catch (e) { console.warn('[Duel] Elo не применён:', e); }
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        if (!_g) return;
        const win = my > opp, draw = my === opp;
        _h(win ? 'success' : 'error');
        _sfx(win ? 'win' : draw ? 'draw' : 'lose');
        _panel(`
            <div style="font-size:52px;line-height:1">${win ? '🏆' : draw ? '🤝' : '💔'}</div>
            <div class="dt-end-title" style="color:${win ? '#16a34a' : draw ? '#64748b' : '#e11d48'}">${win ? 'Победа!' : draw ? 'Ничья' : 'Поражение'}${_g.oppKo ? ' нокаутом' : _g.ko ? ' — нокаут' : ''}</div>
            <div class="dt-end-score">${my} <span style="opacity:.4">:</span> ${opp}</div>
            <div class="dt-end-sub">Попаданий ${_g.hits} из ${_g.drops} · лучшая серия 🔥${_g.best} · кирпичей отправлено ${_g.atkSent}, отбито ${_g.blkSent}</div>
            ${rate ? `<div class="dt-end-rate" style="color:${rate.delta >= 0 ? '#16a34a' : '#e11d48'}">🏅 Рейтинг: ${rate.elo} (${rate.delta >= 0 ? '+' : ''}${rate.delta})</div>` : ''}`,
            '⚔️ Ещё раз', () => {
                const t = _g && _g.test;
                window.closeTetrisMode();
                if (t) window.openTetrisDuel({ deck: window.buildTetrisDuelDeck(), oppName: 'Тест', test: true });
                else if (window.startDuelSearch) window.startDuelSearch();
            }, !_g.test);
    }

    function _panel(head, againText, again, withTop) {
        const misses = _missesHtml(_g.misses.slice(-5));
        const panel = document.createElement('div');
        panel.id = 'dt-end';
        panel.innerHTML = `
          <div class="dt-end-card">
            ${head}
            ${misses ? `<div class="dt-mis"><div class="dt-mis-cap">Куда надо было</div><ul>${misses}</ul></div>` : ''}
            <button id="dt-again" class="dt-big dt-big-main">${againText}</button>
            <button id="dt-leave" class="dt-big">✕ Выйти</button>
            ${withTop ? '<button id="dt-top" class="dt-link">🏆 Топ дуэлей</button>' : ''}
          </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#dt-again').onclick = again;
        panel.querySelector('#dt-leave').onclick = () => window.closeTetrisMode();
        const top = panel.querySelector('#dt-top');
        if (top) top.onclick = () => { window.closeTetrisMode(); if (window.openGlobalTopModal) window.openGlobalTopModal('duel'); };
    }

    // ─── Стили ───────────────────────────────────────────────────────────────
    // Свои классы, а не Tailwind (output.css собирается сборкой); радиусы, тени и
    // кегли — токенами проекта (design-lint). Тёмная тема — через html.dark.
    try {
        const st = document.createElement('style');
        st.textContent = `
#tetris-overlay{position:fixed;inset:0;z-index:${Z};display:flex;flex-direction:column;background:#f8fafc;color:#1f2937;padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom));touch-action:none;user-select:none;-webkit-user-select:none}
html.dark #tetris-overlay{background:#121212;color:#e5e7eb}
.dt-wrap{width:100%;max-width:560px;margin:0 auto;display:flex;flex-direction:column;flex:1;min-height:0;gap:6px}
.dt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0}
.dt-kicker{font-size:var(--t-micro);font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af}
.dt-sub{font-size:12px;font-weight:900;color:#6b7280;margin-top:1px}.dt-sub b{color:#ea580c}
.dt-timer{font-size:26px;font-weight:1000;font-variant-numeric:tabular-nums;color:#f43f5e}
.dt-timer.dt-hurry{animation:dtPulse .5s ease-in-out infinite}
.dt-btns{display:flex;gap:6px}
.dt-btn{font-size:13px;font-weight:900;background:#fff;color:#4b5563;border:1px solid #e5e7eb;border-radius:var(--r-sm);padding:7px 11px;cursor:pointer}
html.dark .dt-btn{background:#2c2c2c;color:#d1d5db;border-color:#3f3f46}
.dt-hint{font-size:12px;font-weight:700;color:#9ca3af;text-align:center;flex-shrink:0}
.dt-opp{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:900;flex-shrink:0}
.dt-opp-name{color:#f59e0b;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dt-opp-score{color:#6b7280;font-variant-numeric:tabular-nums}
.dt-mini{display:inline-flex;align-items:flex-end;gap:2px;height:22px;padding:2px;border:1px solid #e5e7eb;border-radius:var(--r-sm)}
.dt-mini i{display:block;width:6px;height:0;background:#f59e0b;border-radius:var(--r-full);transition:height .25s}
.dt-atk{margin-left:auto;font-size:var(--t-micro);color:#9ca3af;font-weight:800}
.dt-charge{display:inline-flex;align-items:center;gap:2px;vertical-align:-1px}
.dt-charge i{display:inline-block;width:12px;height:8px;border-radius:var(--r-full);background:#e5e7eb;transition:background .2s,transform .2s}
html.dark .dt-charge i{background:#3f3f46}
.dt-charge i.dt-on{background:#f97316;transform:scaleY(1.25)}
.dt-charge.dt-charge-hot i.dt-on{animation:dtPulse .5s ease-in-out infinite}
.dt-threat{position:absolute;left:8px;right:8px;top:8px;display:none;align-items:center;gap:8px;padding:6px 10px;border-radius:var(--r-md);background:#fee2e2;color:#b91c1c;border:2px solid #f87171;font-size:15px;font-weight:1000;overflow:hidden;z-index:2;animation:dtShake .4s}
.dt-threat.dt-threat-on{display:flex}
.dt-threat b{font-size:20px;font-variant-numeric:tabular-nums}
.dt-threat i{position:absolute;left:0;bottom:0;height:4px;background:#ef4444;transition:width .1s linear}
html.dark .dt-threat{background:#450a0a;color:#fca5a5;border-color:#b91c1c}
.dt-fly{position:absolute;font-size:30px;pointer-events:none;animation:dtFly .8s cubic-bezier(.3,0,.6,1) forwards;z-index:3}
.dt-coach{position:absolute;left:8px;right:8px;top:56px;padding:10px 12px;border-radius:var(--r-md);background:rgba(17,24,39,.88);color:#fff;font-size:13px;font-weight:700;line-height:1.45;text-align:center;z-index:3;pointer-events:none;transition:opacity .4s}
.dt-coach.dt-coach-out{opacity:0}
#dt-tut{position:absolute;inset:0;z-index:5;background:rgba(0,0,0,.5);display:flex;flex-direction:column;padding:16px;pointer-events:auto}
#dt-tut.dt-tut-top{justify-content:flex-start;padding-top:calc(90px + env(safe-area-inset-top))}
#dt-tut.dt-tut-bottom{justify-content:flex-end;padding-bottom:calc(150px + env(safe-area-inset-bottom))}
.dt-tut-card{max-width:360px;margin:0 auto;background:#fff;color:#1f2937;border-radius:var(--r-md);box-shadow:var(--e-3);padding:16px;text-align:center;animation:dtIn .3s cubic-bezier(.2,.9,.3,1.25)}
html.dark .dt-tut-card{background:#1e1e1e;color:#e5e7eb}
.dt-tut-n{font-size:var(--t-micro);font-weight:900;letter-spacing:.1em;color:#9ca3af}
.dt-tut-t{font-size:15px;font-weight:700;line-height:1.45;margin:6px 0 12px}
.dt-tut-t b{color:#ea580c}
.dt-tut-btn{width:100%;padding:11px;border:none;border-radius:var(--r-md);background:#f97316;color:#fff;font-size:13px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em;cursor:pointer}
.dt-spot{position:relative;z-index:6;outline:3px solid #f97316;outline-offset:3px;animation:dtPulse 1s ease-in-out infinite}
.dt-block.dt-spot{position:absolute}
.dt-field{position:relative;flex:1;min-height:200px;border-radius:var(--r-md);background:#fff;border:2px solid #e5e7eb;overflow:hidden;transition:border-color .3s}
html.dark .dt-field{background:#1a1a1a;border-color:#3f3f46}
.dt-field.dt-field-danger{border-color:#f43f5e;animation:dtDanger 1s ease-in-out infinite}
.dt-cols{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);pointer-events:none}
.dt-cols i{border-right:1px dashed #e5e7eb}.dt-cols i:last-child{border-right:none}
html.dark .dt-cols i{border-color:#2f2f35}
.dt-lane{position:absolute;top:0;bottom:0;background:rgba(249,115,22,.08);transition:left .12s ease-out;pointer-events:none}
.dt-block{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);background:#f97316;color:#fff;font-size:20px;font-weight:1000;font-variant-numeric:tabular-nums;box-shadow:var(--e-2);pointer-events:none;border-bottom:4px solid #c2410c;z-index:3}
.dt-block.dt-hide{opacity:0}
.dt-block.dt-pop{animation:dtPop .25s cubic-bezier(.2,.9,.3,1.5)}
.dt-block.dt-burn{animation:dtBurn .26s ease-out forwards;background:#22c55e;border-bottom-color:#15803d}
.dt-brick{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);background:#e5e7eb;color:#6b7280;font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;border-bottom:4px solid #cbd5e1}
html.dark .dt-brick{background:#2f2f35;color:#9ca3af;border-bottom-color:#3f3f46}
.dt-brick.dt-junk{background:#78716c;color:#fff;border-bottom-color:#57534e}
.dt-brick.dt-danger{background:#fecdd3;color:#be123c;border-bottom-color:#fda4af}
html.dark .dt-brick.dt-danger{background:#4c0519;color:#fda4af}
.dt-brick.dt-drop{animation:dtDrop .22s cubic-bezier(.2,.9,.3,1.4)}
.dt-toast{position:absolute;left:8px;right:8px;top:38%;text-align:center;font-size:15px;font-weight:1000;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}
.dt-toast.dt-toast-on{opacity:1;transform:none}.dt-toast-ok{color:#16a34a}.dt-toast-bad{color:#e11d48}
.dt-cups{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;flex-shrink:0}
.dt-cup{position:relative;min-height:74px;padding:8px 5px;border-radius:var(--r-md);background:#ede9fe;color:#4c1d95;border:2px solid #ddd6fe;border-bottom-width:5px;font-size:12px;font-weight:800;line-height:1.25;cursor:pointer;overflow:hidden;hyphens:auto;-webkit-hyphens:auto;overflow-wrap:anywhere;transition:background .2s,border-color .2s,transform .1s;-webkit-tap-highlight-color:transparent}
.dt-cup.dt-cup-small{font-size:11px}
.dt-cup:active{transform:translateY(2px)}
html.dark .dt-cup{background:#2e1065;color:#ddd6fe;border-color:#4c1d95}
.dt-cup-new{animation:dtIn .3s cubic-bezier(.2,.9,.3,1.25)}
.dt-cup-ok{background:#dcfce7!important;border-color:#22c55e!important;color:#166534!important}
.dt-cup-bad{background:#ffe4e6!important;border-color:#f43f5e!important;color:#9f1239!important;animation:dtShake .3s}
.dt-cup-hint{background:#dcfce7!important;border-color:#22c55e!important;color:#166534!important;animation:dtPulse .45s ease-in-out 2}
.dt-cup-float{position:absolute;left:0;right:0;top:4px;font-size:15px;font-weight:1000;color:#15803d;animation:dtFloat .9s ease-out forwards}
.dt-ctrl{display:flex;gap:8px;justify-content:center;flex-shrink:0}
.dt-key{flex:1;max-width:120px;font-size:20px;font-weight:1000;padding:10px 0;border-radius:var(--r-md);background:#fff;border:2px solid #e5e7eb;border-bottom-width:5px;color:#4b5563;cursor:pointer}
.dt-key:active{transform:translateY(2px)}
.dt-key-main{background:#f97316;border-color:#ea580c;color:#fff}
html.dark .dt-key{background:#2c2c2c;border-color:#3f3f46;color:#d1d5db}
html.dark .dt-key-main{background:#f97316;border-color:#ea580c;color:#fff}
#dt-end{position:fixed;inset:0;z-index:${Z + 1};display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:16px}
.dt-end-card{background:#fff;color:#1f2937;border-radius:var(--r-md);box-shadow:var(--e-3);text-align:center;padding:22px 20px;width:100%;max-width:380px;max-height:100%;overflow-y:auto;animation:dtIn .3s cubic-bezier(.2,.9,.3,1.25)}
html.dark .dt-end-card{background:#1e1e1e;color:#e5e7eb}
.dt-end-title{font-size:15px;font-weight:1000;letter-spacing:.12em;text-transform:uppercase;margin-top:8px}
.dt-end-score{font-size:34px;font-weight:1000;font-variant-numeric:tabular-nums;margin-top:4px}
.dt-end-sub{font-size:12px;font-weight:800;color:#9ca3af;margin-top:2px}
.dt-end-rate{font-size:13px;font-weight:1000;margin-top:6px}
.dt-mis{margin-top:12px;text-align:left;background:#f8fafc;border-radius:var(--r-md);padding:10px 12px}
html.dark .dt-mis{background:#2a2a2a}
.dt-mis-cap{font-size:var(--t-micro);font-weight:1000;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:6px}
.dt-mis ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.dt-mis li{font-size:12px;font-weight:700;line-height:1.35}
.dt-mis-y{display:inline-block;font-weight:1000;color:#ea580c;font-variant-numeric:tabular-nums;margin-right:4px}
.dt-mis-got{display:block;color:#9ca3af;font-weight:600;font-size:11px}
.dt-big{display:block;width:100%;border:none;border-radius:var(--r-md);font-weight:1000;text-transform:uppercase;letter-spacing:.06em;padding:12px;margin-top:8px;font-size:12px;cursor:pointer;background:#f3f4f6;color:#4b5563}
html.dark .dt-big{background:#2c2c2c;color:#d1d5db}
.dt-big-main{background:#f97316!important;color:#fff!important;font-size:13px;padding:13px;margin-top:14px}
.dt-link{background:none;border:none;color:#3b82f6;font-weight:1000;font-size:12px;text-decoration:underline;margin-top:10px;cursor:pointer}
@media (max-height:640px){.dt-cup{min-height:60px;font-size:11px}.dt-key{padding:7px 0}}
@keyframes dtPop{0%{transform:scale(.6)}100%{transform:scale(1)}}
@keyframes dtBurn{0%{transform:scale(1);opacity:1}100%{transform:scale(1.35);opacity:0}}
@keyframes dtDrop{0%{transform:translateY(-14px)}100%{transform:none}}
@keyframes dtIn{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}
@keyframes dtShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@keyframes dtPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes dtFloat{0%{opacity:0;transform:translateY(8px)}20%{opacity:1}100%{opacity:0;transform:translateY(-22px)}}
@keyframes dtFly{0%{transform:none;opacity:1}100%{transform:translateY(-420px) rotate(-25deg) scale(1.4);opacity:0}}
@keyframes dtDanger{0%,100%{border-color:#f43f5e}50%{border-color:#fecdd3}}
`;
        document.head.appendChild(st);
    } catch (e) {}
})();
