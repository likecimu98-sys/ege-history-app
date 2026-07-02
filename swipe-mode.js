// swipe-mode.js — режим «Свайп»: факт по центру, два правителя слева/справа.
// Два правителя ФИКСИРОВАНЫ, пока не закончатся их карточки, потом — следующая пара.
// Имя правителя можно сменить тапом (выпадающий список). Со звуками и забавностями.
'use strict';

(function () {
    let _sw = null;
    let _muted = false;
    try { _muted = localStorage.getItem('swipeMuted') === '1'; } catch (e) {}

    function _h(type) { try { if (typeof haptic === 'function') haptic(type); } catch (e) {} }
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _byId(id) {
        // В дуэли правители берутся из снапшота матча — работает даже при разных версиях данных.
        if (_sw && _sw.duel) {
            for (const s of _sw.duel.sections) { if (s.a.id === id) return s.a; if (s.b.id === id) return s.b; }
        }
        return (window.swipeRulersData || []).find(r => r.id === id);
    }

    function _preload() { try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {} }
    function _play(ok) { if (_muted) return; if (window.Sfx) window.Sfx.play(ok ? 'wow' : 'fah'); }
    function _muteIcon() { return _muted ? '🔇' : '🔊'; }
    function _toggleMute() {
        _muted = !_muted;
        try { localStorage.setItem('swipeMuted', _muted ? '1' : '0'); } catch (e) {}
        const b = document.getElementById('sw-mute');
        if (b) { b.textContent = _muteIcon(); b.style.opacity = _muted ? '0.55' : '1'; }
    }

    const WIN = ['Точно!', 'Красава!', 'Знаток!', 'В яблочко!', 'Чистая работа!', 'Историк от бога!', 'Не подкопаться!', 'Лёгко!'];
    const FAIL = ['Мимо!', 'Эх...', 'Не он!', 'Перепутал!', 'Бывает.', 'Учи дальше!', 'Почти...', 'Совсем не туда!'];
    const pick = a => a[Math.floor(Math.random() * a.length)];

    const THRESH = 80;   // порог свайпа для засчёта
    const STAMP_FULL = 55; // на какой дистанции штамп «ТУДА/СЮДА» становится полностью видимым

    // Колода пары: стороны уравнены по числу карточек и перемешаны с ограничением
    // «не больше 2 одной стороны подряд». Чистый шафл здесь плох: при неравных
    // пулах фактов хвост колоды — сплошь один правитель, и игрок это чувствует
    // как «много лево подряд, потом много право».
    function _buildPairDeck(a, b) {
        const A = _shuffle((a.facts || []).slice()).map(f => ({ fact: f, correctId: a.id }));
        const B = _shuffle((b.facts || []).slice()).map(f => ({ fact: f, correctId: b.id }));
        const n = Math.min(A.length, B.length);
        A.length = n; B.length = n;
        const cards = [];
        let run = 0, last = null;
        while (A.length || B.length) {
            let side;
            if (!A.length) side = 'b';
            else if (!B.length) side = 'a';
            else if (run >= 2) side = last === 'a' ? 'b' : 'a';
            // вероятность пропорциональна остатку — стороны кончаются одновременно
            else side = Math.random() < A.length / (A.length + B.length) ? 'a' : 'b';
            cards.push(side === 'a' ? A.pop() : B.pop());
            run = side === last ? run + 1 : 1;
            last = side;
        }
        return cards;
    }

    // ─── Дуэль-свайп: у обоих игроков ОДИНАКОВЫЕ карточки ───
    // Колоду генерирует создатель матча и кладёт в документ матча (снапшоты правителей
    // включены) — рассинхрон при разных версиях приложения исключён.
    // 45 секунд на матч: побеждает тот, кто наберёт больше очков до конца таймера.
    // Пары — современники (разница начал правлений ≤100 лет), чтобы было честно-сложно;
    // исключение: Алексей Михайлович — «джокер», можно с любым до Николая II включительно.
    const DUEL_SECTIONS = 4, DUEL_CARDS_PER_SECTION = 10, DUEL_MS = 45000;
    window.SWIPE_DUEL_MS = DUEL_MS;
    const PAIR_MAX_GAP = 100;
    const WILDCARD_ID = 'aleksey';
    const WILDCARD_PARTNER_MAX_START = 1894; // начало правления Николая II

    function _startYear(r) {
        const m = String((r && r.years) || '').match(/\d{3,4}/);
        return m ? parseInt(m[0], 10) : null;
    }
    function _pairCompatible(a, b) {
        const ya = _startYear(a), yb = _startYear(b);
        if (ya == null || yb == null) return false;
        if (a.id === WILDCARD_ID) return yb <= WILDCARD_PARTNER_MAX_START;
        if (b.id === WILDCARD_ID) return ya <= WILDCARD_PARTNER_MAX_START;
        return Math.abs(ya - yb) <= PAIR_MAX_GAP;
    }

    window.buildSwipeDuelSections = function () {
        const pool = _shuffle((window.swipeRulersData || []).slice());
        if (pool.length < DUEL_SECTIONS * 2) return null;
        const snap = r => ({ id: r.id, name: r.name, years: r.years || '', emoji: r.emoji || '👑' });
        const used = new Set();
        const pairs = [];
        for (const r of pool) {
            if (pairs.length >= DUEL_SECTIONS) break;
            if (used.has(r.id)) continue;
            const partners = pool.filter(o => !used.has(o.id) && o.id !== r.id && _pairCompatible(r, o));
            if (!partners.length) continue;
            const p = partners[Math.floor(Math.random() * partners.length)];
            used.add(r.id); used.add(p.id);
            pairs.push([r, p]);
        }
        // Страховка: если совместимых пар не хватило — добираем соседей по хронологии.
        if (pairs.length < DUEL_SECTIONS) {
            const rest = pool.filter(r => !used.has(r.id)).sort((x, y) => (_startYear(x) || 0) - (_startYear(y) || 0));
            for (let i = 0; i + 1 < rest.length && pairs.length < DUEL_SECTIONS; i += 2) {
                pairs.push([rest[i], rest[i + 1]]);
            }
        }
        if (pairs.length < DUEL_SECTIONS) return null;
        return pairs.map(([a, b]) => ({
            a: snap(a), b: snap(b),
            cards: _buildPairDeck(a, b).slice(0, DUEL_CARDS_PER_SECTION).map(c => ({ f: c.fact, c: c.correctId }))
        }));
    };

    window.openSwipeDuel = function (opts) {
        const sections = (opts && opts.sections) || [];
        const total = sections.reduce((n, s) => n + ((s && s.cards) || []).length, 0);
        if (!total) {
            if (typeof showToast === 'function') showToast('⚠️', 'Не удалось получить колоду дуэли', 'bg-rose-500', 'border-rose-700');
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
            return;
        }
        _h('medium');
        _preload();
        _sw = {
            pool: [], used: new Set(), left: null, right: null,
            deck: [], i: 0, lapses: [], reviewStart: null, reviewAdded: true, // без повтора ошибок — прогресс должен совпадать у обоих
            score: 0, streak: 0, best: 0, correct: 0, seen: 0,
            lock: false, cur: null, picking: false,
            duel: {
                sections, secIdx: -1, total, done: 0,
                oppName: (opts && opts.oppName) || 'Соперник',
                oppScore: 0, oppDone: 0, oppCorrect: 0,
                endsAt: (opts && opts.endsAt) || (Date.now() + DUEL_MS),
                finishedMine: false, over: false, timerIv: null
            }
        };
        let ov = document.getElementById('swipe-overlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'swipe-overlay'; document.body.appendChild(ov); }
        ov.className = 'no-print';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;background:radial-gradient(circle at 50% 0%,#1e293b,#0b1120);overscroll-behavior:contain;touch-action:none;overflow:hidden';
        _renderShell();
        _duelNextSection();
        document.addEventListener('keydown', _onKey);
        _sw.duel.timerIv = setInterval(_duelTick, 500);
        _duelTick();
    };

    function _duelNextSection() {
        const d = _sw && _sw.duel; if (!d) return;
        d.secIdx++;
        const sec = d.sections[d.secIdx];
        if (!sec) return _duelMineDone();
        _sw.left = sec.a; _sw.right = sec.b;
        _sw.deck = (sec.cards || []).map(c => ({ fact: c.f, correctId: c.c }));
        _sw.i = 0;
        _renderPanels();
        _nextCard();
    }

    function _duelReport() {
        const d = _sw && _sw.duel; if (!d) return;
        try { window.updateDuelScoreDb && window.updateDuelScoreDb(_sw.score, _sw.streak, { done: d.done, correct: _sw.correct }); } catch (e) {}
    }

    function _updateDuelBar() {
        const d = _sw && _sw.duel; if (!d) return;
        const me = document.getElementById('sw-d-me'), op = document.getElementById('sw-d-opp');
        const meB = document.getElementById('sw-d-me-bar'), opB = document.getElementById('sw-d-opp-bar');
        if (me) me.textContent = `${d.done}/${d.total} · ✓${_sw.correct} · ${_sw.score}`;
        if (op) op.textContent = `${d.oppDone}/${d.total} · ✓${d.oppCorrect} · ${d.oppScore}`;
        if (meB) meB.style.width = Math.round(d.done / d.total * 100) + '%';
        if (opB) opB.style.width = Math.round(d.oppDone / d.total * 100) + '%';
    }

    window.updateSwipeDuelOpp = function (opp) {
        const d = _sw && _sw.duel; if (!d || !opp) return;
        d.oppScore = opp.score || 0;
        d.oppDone = opp.done || 0;
        d.oppCorrect = opp.correct || 0;
        _updateDuelBar();
        if (d.finishedMine && d.oppDone >= d.total && !d.over) _duelFinish();
    };

    function _duelTick() {
        const d = _sw && _sw.duel; if (!d) return;
        const left = Math.max(0, d.endsAt - Date.now());
        const t = document.getElementById('sw-timer');
        if (t) t.textContent = Math.floor(left / 60000) + ':' + String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
        if (left <= 0 && !d.over) _duelFinish();
    }

    function _duelMineDone() {
        const d = _sw && _sw.duel; if (!d || d.over) return;
        d.finishedMine = true;
        _duelReport();
        _updateDuelBar();
        if (d.oppDone >= d.total) return _duelFinish(); // оба прошли всё — не ждём таймер
        const zone = document.getElementById('sw-cardzone');
        if (zone) zone.innerHTML = `
            <div style="color:#e2e8f0;text-align:center">
                <div style="font-size:44px">🚀</div>
                <div style="font-size:16px;font-weight:900;margin-top:6px">Все карточки! ✓${_sw.correct} из ${d.total}</div>
                <div style="font-size:12.5px;opacity:.75;margin-top:4px">Жди конца таймера — соперник ещё играет</div>
            </div>`;
    }

    // Конец матча (таймер/оба закончили): блокируем свайпы, шлём финальный счёт
    // и даём 1.2 с на прилёт последних очков соперника, потом — вердикт.
    function _duelFinish() {
        const d = _sw && _sw.duel; if (!d || d.over) return;
        d.over = true;
        _sw.lock = true;
        if (d.timerIv) { clearInterval(d.timerIv); d.timerIv = null; }
        _duelReport();
        const zone = document.getElementById('sw-cardzone');
        if (zone) zone.innerHTML = `
            <div style="color:#e2e8f0;text-align:center">
                <div style="font-size:44px">⏱</div>
                <div style="font-size:17px;font-weight:1000;margin-top:6px">Время!</div>
                <div style="font-size:12.5px;opacity:.75;margin-top:4px">Считаем очки…</div>
            </div>`;
        setTimeout(_duelVerdict, 1200);
    }

    function _duelVerdict() {
        const d = _sw && _sw.duel; if (!d) return;
        try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
        try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        const my = _sw.score, opp = d.oppScore;
        const win = my > opp, draw = my === opp;
        _h(win ? 'success' : 'error');
        _play(win);
        const panels = document.getElementById('sw-panels'); if (panels) panels.innerHTML = '';
        const zone = document.getElementById('sw-cardzone'); if (!zone) return;
        zone.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e2e8f0;text-align:center;gap:8px">
            <div style="font-size:54px">${win ? '🏆' : draw ? '🤝' : '💔'}</div>
            <div style="font-size:22px;font-weight:1000;color:${win ? '#4ade80' : draw ? '#e2e8f0' : '#f87171'}">${win ? 'ПОБЕДА!' : draw ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ'}</div>
            <div style="font-size:20px;font-weight:900">${my} <span style="opacity:.5">:</span> ${opp}</div>
            <div style="font-size:12.5px;opacity:.75">Ты: ✓${_sw.correct} из ${d.done} · ${_esc(d.oppName)}: ✓${d.oppCorrect} из ${d.oppDone}</div>
            <div style="display:flex;gap:10px;margin-top:14px">
                <button id="sw-d-rematch" style="background:#6366f1;color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">⚔️ Ещё раз</button>
                <button id="sw-d-exit" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">Выход</button>
            </div>
        </div>`;
        zone.querySelector('#sw-d-rematch').onclick = () => { window.closeSwipeMode(); if (window.startDuelSearch) window.startDuelSearch('swipe'); };
        zone.querySelector('#sw-d-exit').onclick = window.closeSwipeMode;
        _updateDuelBar();
    }

    window.openSwipeMode = function () {
        const pool = (window.swipeRulersData || []).slice();
        if (pool.length < 2) {
            if (typeof showToast === 'function') showToast('⚠️', 'Нет данных для свайпа', 'bg-rose-500', 'border-rose-700');
            return;
        }
        _h('light');
        _preload();
        _sw = {
            pool, used: new Set(), left: null, right: null,
            deck: [], i: 0, lapses: [], reviewStart: null, reviewAdded: false,
            score: 0, streak: 0, best: 0, correct: 0, seen: 0,
            lock: false, cur: null, picking: false,
        };
        let ov = document.getElementById('swipe-overlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'swipe-overlay'; document.body.appendChild(ov); }
        ov.className = 'no-print';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;background:radial-gradient(circle at 50% 0%,#1e293b,#0b1120);overscroll-behavior:contain;touch-action:none;overflow:hidden';
        _renderShell();
        _setPair(pool[0], pool[1]);
        document.addEventListener('keydown', _onKey);
    };

    window.closeSwipeMode = function () {
        // Выход из дуэли: чистим таймер и закрываем матч (cancelDuelDb идемпотентен).
        if (_sw && _sw.duel) {
            if (_sw.duel.timerIv) { clearInterval(_sw.duel.timerIv); _sw.duel.timerIv = null; }
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        document.removeEventListener('keydown', _onKey);
        const ov = document.getElementById('swipe-overlay');
        if (ov) ov.remove();
        _sw = null;
        if (window.updateProgressBars) window.updateProgressBars();
    };

    function _onKey(e) {
        if (!_sw) return;
        if (e.key === 'Escape') { if (_sw.picking) return _closePicker(); return window.closeSwipeMode(); }
        if (_sw.picking) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); _commit('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); _commit('right'); }
    }

    function _renderShell() {
        const ov = document.getElementById('swipe-overlay'); if (!ov) return;
        const duel = _sw && _sw.duel;
        ov.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;color:#e2e8f0;flex-shrink:0">
            <button id="sw-close" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:34px;height:34px;border-radius:11px;font-size:17px;cursor:pointer">✕</button>
            <div style="display:flex;gap:11px;align-items:center;font-weight:900">
                <span style="font-size:12.5px">Счёт: <span id="sw-score" style="color:#fbbf24">0</span></span>
                <span style="font-size:12.5px">🔥 <span id="sw-streak">0</span></span>
                ${duel
                    ? '<span style="font-size:12.5px;color:#f87171">⏱ <span id="sw-timer">0:45</span></span>'
                    : '<span style="font-size:12.5px;opacity:.7">осталось: <span id="sw-left">0</span></span>'}
                <button id="sw-mute" title="Звук вкл/выкл" style="background:rgba(255,255,255,0.1);border:none;width:30px;height:30px;border-radius:9px;font-size:14px;cursor:pointer;opacity:${_muted ? '0.55' : '1'}">${_muteIcon()}</button>
            </div>
        </div>
        ${duel ? `
        <div style="padding:0 14px 6px;flex-shrink:0;color:#e2e8f0;max-width:560px;width:100%;margin:0 auto">
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:900">
                <span style="width:64px;flex-shrink:0;color:#60a5fa">ТЫ</span>
                <div style="flex:1;height:7px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden"><div id="sw-d-me-bar" style="width:0%;height:100%;background:#60a5fa;border-radius:999px;transition:width .3s"></div></div>
                <span id="sw-d-me" style="flex-shrink:0;opacity:.9">0/0 · ✓0 · 0</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:900;margin-top:4px">
                <span style="width:64px;flex-shrink:0;color:#fbbf24;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(duel.oppName).toUpperCase()}</span>
                <div style="flex:1;height:7px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden"><div id="sw-d-opp-bar" style="width:0%;height:100%;background:#fbbf24;border-radius:999px;transition:width .3s"></div></div>
                <span id="sw-d-opp" style="flex-shrink:0;opacity:.9">0/0 · ✓0 · 0</span>
            </div>
        </div>` : ''}
        <div id="sw-arena" style="flex:1;position:relative;display:flex;flex-direction:column;min-height:0;padding:0 12px 6px;width:100%;max-width:560px;margin:0 auto">
            <div id="sw-panels" style="display:flex;gap:8px;align-items:stretch;margin-bottom:8px;flex-shrink:0"></div>
            <div id="sw-cardzone" style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0"></div>
            <div id="sw-verdict" style="height:24px;text-align:center;font-weight:900;font-size:13.5px;margin-top:4px;flex-shrink:0"></div>
        </div>
        <div style="text-align:center;color:#94a3b8;font-size:11.5px;font-weight:800;padding:6px 0 14px;flex-shrink:0">
            ${duel ? '⚔️ одинаковые карточки у обоих — кто наберёт больше очков' : '← свайпни карточку · тап по имени — сменить правителя'}
        </div>`;
        ov.querySelector('#sw-close').onclick = () => {
            if (_sw && _sw.duel && !_sw.duel.over && !confirm('Выйти из дуэли? Это засчитается как сдача.')) return;
            window.closeSwipeMode();
        };
        const mb = ov.querySelector('#sw-mute'); if (mb) mb.onclick = _toggleMute;
        _updateHeader();
        if (duel) _updateDuelBar();
    }

    function _updateHeader() {
        if (!_sw) return;
        const s = document.getElementById('sw-score'); if (s) s.textContent = _sw.score;
        const st = document.getElementById('sw-streak'); if (st) st.textContent = _sw.streak;
        const l = document.getElementById('sw-left'); if (l) l.textContent = Math.max(0, _sw.deck.length - _sw.i);
    }

    function _panel(side, ruler) {
        const accent = side === 'left' ? '#60a5fa' : '#fbbf24';
        const tint = side === 'left' ? 'rgba(96,165,250,0.12)' : 'rgba(251,191,36,0.12)';
        return `<button id="sw-panel-${side}" data-side="${side}" title="Сменить правителя" style="flex:1;min-width:0;background:${tint};border:2px solid ${accent}55;border-radius:16px;padding:8px 6px;color:#e2e8f0;cursor:pointer;transition:transform .12s,box-shadow .12s;display:flex;flex-direction:column;align-items:center;gap:1px;text-align:center">
            <div style="font-size:22px;line-height:1">${ruler.emoji || '👑'}</div>
            <div style="font-size:13px;font-weight:900;line-height:1.05">${_esc(ruler.name)}</div>
            <div style="font-size:9px;opacity:.7;font-weight:700">${_esc(ruler.years || '')}</div>
            ${_sw && _sw.duel ? '' : '<div style="font-size:9px;opacity:.55;font-weight:800;margin-top:1px">▾ сменить</div>'}
        </button>`;
    }

    function _renderPanels() {
        const box = document.getElementById('sw-panels'); if (!box || !_sw) return;
        box.innerHTML = `${_panel('left', _sw.left)}
            <div style="display:flex;align-items:center;color:#64748b;font-weight:900;font-size:12px">VS</div>
            ${_panel('right', _sw.right)}`;
        box.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => _openPicker(b.dataset.side)));
    }

    function _setPair(a, b) {
        if (!_sw || !a || !b) return;
        _sw.left = a; _sw.right = b;
        _sw.used.add(a.id); _sw.used.add(b.id);
        _sw.deck = _buildPairDeck(a, b);
        _sw.i = 0; _sw.lapses = []; _sw.reviewStart = null; _sw.reviewAdded = false;
        _renderPanels();
        _nextCard();
    }

    function _advancePair() {
        if (!_sw) return;
        if (_sw.duel) return _duelNextSection(); // дуэль идёт по фиксированным секциям матча
        const rest = _sw.pool.filter(r => !_sw.used.has(r.id));
        if (rest.length >= 2) { _setPair(rest[0], rest[1]); }
        else { _renderEnd(); }
    }

    function _chooseRuler(side, ruler) {
        if (!_sw || !ruler) return;
        const other = side === 'left' ? _sw.right : _sw.left;
        if (other && other.id === ruler.id) return;   // нельзя одного и того же с двух сторон
        if (side === 'left') _sw.left = ruler; else _sw.right = ruler;
        _sw.used.add(ruler.id);
        _sw.deck = _buildPairDeck(_sw.left, _sw.right);
        _sw.i = 0; _sw.lapses = []; _sw.reviewStart = null; _sw.reviewAdded = false;
        _renderPanels();
        _nextCard();
    }

    function _openPicker(side) {
        if (!_sw) return;
        if (_sw.duel) return; // в дуэли пары фиксированы — колода должна совпадать у обоих
        _sw.picking = true;
        const ov = document.getElementById('swipe-overlay'); if (!ov) return;
        _closePicker();
        const cur = side === 'left' ? _sw.left : _sw.right;
        const other = side === 'left' ? _sw.right : _sw.left;
        const items = _sw.pool.map(r => {
            const disabled = other && r.id === other.id;
            const active = cur && r.id === cur.id;
            const bg = active ? 'rgba(99,102,241,0.22)' : 'rgba(255,255,255,0.04)';
            return `<button class="sw-pick-item" data-id="${r.id}" ${disabled ? 'disabled' : ''} style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:${bg};border:1px solid ${active ? '#6366f1' : '#1e293b'};border-radius:12px;padding:9px 11px;color:#e2e8f0;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.4' : '1'};font-weight:800">
                <span style="font-size:20px">${r.emoji || '👑'}</span>
                <span style="flex:1;min-width:0"><span style="font-size:13.5px">${_esc(r.name)}</span> <span style="font-size:10px;opacity:.6">${_esc(r.years || '')}</span></span>
                ${active ? '<span style="color:#a5b4fc;font-size:14px">✓</span>' : (disabled ? '<span style="font-size:10px;opacity:.7">занят</span>' : '')}
            </button>`;
        }).join('');
        const p = document.createElement('div');
        p.id = 'sw-picker';
        p.style.cssText = 'position:absolute;inset:0;z-index:10060;background:rgba(2,6,23,0.72);display:flex;align-items:center;justify-content:center;padding:18px';
        p.innerHTML = `<div style="background:#0b1120;border:1px solid #334155;border-radius:18px;max-width:360px;width:100%;max-height:82%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 14px;color:#e2e8f0;font-weight:900;font-size:14px;border-bottom:1px solid #1e293b">
                <span>Кто ${side === 'left' ? '◀ слева' : 'справа ▶'}?</span>
                <button id="sw-pick-close" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:28px;height:28px;border-radius:9px;font-size:14px;cursor:pointer">✕</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:7px;padding:12px;overflow:auto">${items}</div>
        </div>`;
        ov.appendChild(p);
        p.addEventListener('click', e => { if (e.target === p) _closePicker(); });
        p.querySelector('#sw-pick-close').onclick = _closePicker;
        p.querySelectorAll('.sw-pick-item').forEach(b => b.addEventListener('click', () => {
            if (b.hasAttribute('disabled')) return;
            _closePicker();
            _chooseRuler(side, _byId(b.dataset.id));
        }));
    }
    function _closePicker() {
        if (_sw) _sw.picking = false;
        const p = document.getElementById('sw-picker'); if (p) p.remove();
    }

    function _nextCard() {
        if (!_sw) return;
        _sw.lock = false;
        // Карточки пары пройдены — один раз возвращаем те, в которых ошибся.
        if (_sw.i >= _sw.deck.length && !_sw.reviewAdded && _sw.lapses.length) {
            _sw.reviewAdded = true;
            _sw.reviewStart = _sw.deck.length;
            _sw.deck = _sw.deck.concat(_shuffle(_sw.lapses.slice()));
            if (typeof showToast === 'function') showToast('🔁', 'Повтори то, в чём ошибся', 'bg-indigo-500', 'border-indigo-700');
        }
        const card = _sw.deck[_sw.i];
        if (!card) return _advancePair();   // пара (с повтором) пройдена → следующая пара
        _sw.cur = { card };
        _renderCard();
    }

    function _renderCard() {
        const zone = document.getElementById('sw-cardzone'); if (!zone || !_sw) return;
        const c = _sw.cur;
        zone.innerHTML = `
            <div id="sw-card" style="position:relative;width:min(88vw,330px);min-height:128px;max-height:46vh;background:#fff;border:3px solid #e2e8f0;border-radius:22px;box-shadow:0 14px 40px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:18px 16px;cursor:grab;touch-action:none;user-select:none;overflow:hidden">
                <div id="sw-stamp-left"  style="position:absolute;top:12px;left:12px;transform:rotate(-13deg);border:3px solid #60a5fa;color:#2563eb;font-weight:1000;font-size:19px;letter-spacing:1px;padding:4px 11px;border-radius:9px;opacity:0;pointer-events:none;background:rgba(96,165,250,0.14)">← ТУДА</div>
                <div id="sw-stamp-right" style="position:absolute;top:12px;right:12px;transform:rotate(13deg);border:3px solid #f59e0b;color:#b45309;font-weight:1000;font-size:19px;letter-spacing:1px;padding:4px 11px;border-radius:9px;opacity:0;pointer-events:none;background:rgba(251,191,36,0.14)">СЮДА →</div>
                <div style="font-size:clamp(15px,4.2vw,19px);font-weight:900;color:#0f172a;text-align:center;line-height:1.3">${_esc(c.card.fact)}</div>
            </div>`;
        _attachDrag(document.getElementById('sw-card'));
        _updateHeader();
    }

    function _attachDrag(cardEl) {
        if (!cardEl) return;
        let startX = 0, dx = 0, dragging = false;
        const down = e => { if (!_sw || _sw.lock) return; dragging = true; startX = e.clientX; dx = 0; cardEl.style.transition = 'none'; cardEl.style.cursor = 'grabbing'; try { cardEl.setPointerCapture(e.pointerId); } catch (er) {} };
        const move = e => { if (!dragging) return; dx = e.clientX - startX; _dragUpdate(dx); };
        const up = () => {
            if (!dragging) return; dragging = false; cardEl.style.cursor = 'grab';
            cardEl.style.transition = 'transform .25s ease';
            if (Math.abs(dx) > THRESH) { _commit(dx < 0 ? 'left' : 'right'); }
            else { cardEl.style.transform = 'translate(0,0) rotate(0)'; _dragUpdate(0); }
            dx = 0;
        };
        cardEl.addEventListener('pointerdown', down);
        cardEl.addEventListener('pointermove', move);
        cardEl.addEventListener('pointerup', up);
        cardEl.addEventListener('pointercancel', up);
    }

    function _dragUpdate(dx) {
        const cardEl = document.getElementById('sw-card'); if (!cardEl) return;
        const rot = Math.max(-16, Math.min(16, dx * 0.06));
        cardEl.style.transform = `translate(${dx}px,0) rotate(${rot}deg)`;
        const ps = Math.min(1, Math.abs(dx) / STAMP_FULL);   // штамп виден раньше — успеваешь прочитать
        const pp = Math.min(1, Math.abs(dx) / THRESH);
        const ls = document.getElementById('sw-stamp-left'), rs = document.getElementById('sw-stamp-right');
        if (ls) ls.style.opacity = dx < 0 ? ps : 0;
        if (rs) rs.style.opacity = dx > 0 ? ps : 0;
        const lp = document.getElementById('sw-panel-left'), rp = document.getElementById('sw-panel-right');
        if (lp) { lp.style.transform = dx < 0 ? `scale(${1 + 0.05 * pp})` : 'scale(1)'; lp.style.boxShadow = dx < 0 ? `0 0 0 3px rgba(96,165,250,${0.7 * pp})` : 'none'; }
        if (rp) { rp.style.transform = dx > 0 ? `scale(${1 + 0.05 * pp})` : 'scale(1)'; rp.style.boxShadow = dx > 0 ? `0 0 0 3px rgba(251,191,36,${0.7 * pp})` : 'none'; }
    }

    function _commit(dir) {
        if (!_sw || _sw.lock || !_sw.cur || _sw.picking) return;
        _sw.lock = true;
        const chosen = dir === 'left' ? _sw.left : _sw.right;
        const ok = chosen.id === _sw.cur.card.correctId;
        _play(ok);
        _h(ok ? 'success' : 'error');
        // показать выбранный штамп «ТУДА/СЮДА» полностью — он улетит вместе с карточкой, успеешь увидеть
        const st = document.getElementById(dir === 'left' ? 'sw-stamp-left' : 'sw-stamp-right');
        if (st) st.style.opacity = '1';
        const cardEl = document.getElementById('sw-card');
        if (cardEl) {
            const off = (dir === 'left' ? -1 : 1) * Math.round(window.innerWidth * 0.85 + 120);
            cardEl.style.transition = 'transform .36s ease, opacity .36s';
            cardEl.style.transform = `translate(${off}px,30px) rotate(${dir === 'left' ? -26 : 26}deg)`;
            cardEl.style.opacity = '0';
            cardEl.style.borderColor = ok ? '#22c55e' : '#ef4444';
        }
        const isReview = _sw.reviewStart != null && _sw.i >= _sw.reviewStart;
        if (ok) {
            _sw.streak++; _sw.best = Math.max(_sw.best, _sw.streak); _sw.score += 10 + Math.min(20, (_sw.streak - 1) * 2);
            if (!isReview) { _sw.correct++; _sw.seen++; }
        } else {
            _sw.streak = 0;
            // Дуэль: ошибка снимает очки — наугад свайпать невыгодно
            if (_sw.duel) _sw.score = Math.max(0, _sw.score - 5);
            if (!isReview) { _sw.seen++; if (!_sw.duel) _sw.lapses.push(_sw.cur.card); }
        }
        if (_sw.duel && !_sw.duel.over) { _sw.duel.done++; _duelReport(); _updateDuelBar(); }
        _flash(ok);
        const v = document.getElementById('sw-verdict');
        if (v) {
            if (ok) { v.style.color = '#4ade80'; v.textContent = pick(WIN) + (_sw.streak >= 3 ? ` 🔥×${_sw.streak}` : ' ✅'); }
            else { const correct = _byId(_sw.cur.card.correctId); v.style.color = '#f87171'; v.textContent = pick(FAIL) + ' Это ' + (correct ? correct.name : '') + (_sw.duel ? ' · −5 очков ❌' : ' ❌'); }
        }
        _sw.i++;
        _updateHeader();
        setTimeout(_nextCard, ok ? 460 : 850);
    }

    function _flash(ok) {
        const ov = document.getElementById('swipe-overlay'); if (!ov) return;
        const f = document.createElement('div');
        f.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:5;background:${ok ? 'radial-gradient(circle,rgba(34,197,94,0.25),transparent 60%)' : 'radial-gradient(circle,rgba(239,68,68,0.22),transparent 60%)'};opacity:1;transition:opacity .5s`;
        ov.appendChild(f);
        if (!ok) { ov.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 220 }); }
        requestAnimationFrame(() => { f.style.opacity = '0'; });
        setTimeout(() => f.remove(), 520);
    }

    function _renderEnd() {
        const zone = document.getElementById('sw-cardzone'); if (!zone || !_sw) return;
        const panels = document.getElementById('sw-panels'); if (panels) panels.innerHTML = '';
        const acc = _sw.seen ? Math.round(_sw.correct / _sw.seen * 100) : 0;
        zone.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e2e8f0;text-align:center;gap:8px">
            <div style="font-size:54px">${acc >= 80 ? '🏆' : acc >= 50 ? '👍' : '📚'}</div>
            <div style="font-size:20px;font-weight:1000">Готово!</div>
            <div style="font-size:14px;opacity:.85">Верно ${_sw.correct} из ${_sw.seen} · точность ${acc}%</div>
            <div style="font-size:13px;opacity:.7">Лучшая серия: 🔥 ${_sw.best} · очки: ${_sw.score}</div>
            <div style="display:flex;gap:10px;margin-top:14px">
                <button id="sw-again" style="background:#6366f1;color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">Заново</button>
                <button id="sw-exit" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">Выход</button>
            </div>
        </div>`;
        zone.querySelector('#sw-again').onclick = () => { window.closeSwipeMode(); window.openSwipeMode(); };
        zone.querySelector('#sw-exit').onclick = window.closeSwipeMode;
        _updateHeader();
    }
})();
