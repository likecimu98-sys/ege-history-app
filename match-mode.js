// match-mode.js — режим «Подбор» (механика Match из Quizlet): 12 карточек (6 пар
// «событие ↔ дата» из задания №1), тапаешь две подходящие — исчезают. Таймер идёт
// вверх, промах = +1 секунда штрафа. Цель — собрать все пары быстрее рекорда.
// Самодостаточный оверлей (как swipe-mode.js): не трогает currentMode/таблицу.
'use strict';

(function () {
    let _m = null;

    const PAIRS = 6;            // пар в раунде (12 карточек, как в Quizlet)
    const PENALTY_MS = 1000;    // штраф за промах
    const Z = 10006;

    function _h(type) { try { if (typeof haptic === 'function') haptic(type); } catch (e) {} }
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _play(ok) { try { if (window.Sfx) window.Sfx.play(ok ? 'wow' : 'fah'); } catch (e) {} }
    function _fmt(ms) { const s = ms / 1000; return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')},${Math.floor(ms % 1000 / 100)}` : `${s.toFixed(1)} сек`; }

    // Период применяем как в основных режимах: читаем глобальный селектор
    // #filter-period (+ #custom-year-start/end). «Дошли до N» ученика приходит сюда
    // как custom 862–N (см. ui.js pgApplyClassUpto → #custom-year-end).
    function _periodFilterTask1(rows) {
        const g = id => document.getElementById(id);
        const sel = g('filter-period');
        const period = (sel && sel.value) || 'all';
        if (period === 'all') return rows;
        if (period === 'custom') {
            const a = parseInt(g('custom-year-start') && g('custom-year-start').value, 10) || 0;
            const b = parseInt(g('custom-year-end') && g('custom-year-end').value, 10) || 3000;
            return rows.filter(r => { const m = String(r.year).match(/\d+/); const y = m ? parseInt(m[0], 10) : NaN; return y >= a && y <= b; });
        }
        return rows.filter(r => r.c === period); // эпоха: early/18th/19th/20th
    }

    // 6 строк с УНИКАЛЬНЫМИ датами: если в раунде два события одного года,
    // «неправильная» пара выглядела бы правильной — так нельзя.
    function _sixUniqueDates(rows) {
        const out = [], seen = new Set();
        for (const r of _shuffle(rows.slice())) {
            const y = String(r.year).trim();
            if (seen.has(y)) continue;
            seen.add(y);
            out.push(r);
            if (out.length === PAIRS) break;
        }
        return out;
    }

    function _pickRows() {
        const base = (window.task1Data || []).filter(r => r && r.event && r.year);
        let out = _sixUniqueDates(_periodFilterTask1(base));
        // Узкий период не набрал 6 уникальных дат — тихо расширяемся до всей базы,
        // чтобы раунд всегда собирался (лучше сыграть по всей истории, чем показать ошибку).
        if (out.length < PAIRS) out = _sixUniqueDates(base);
        return out;
    }

    function _best() { return Number(window.state && window.state.stats && window.state.stats.matchBestMs) || 0; }

    window.openMatchMode = function () {
        if (_m) return;
        const rows = _pickRows();
        if (rows.length < PAIRS) { if (typeof showToast === 'function') showToast('⚠️', 'Данные задания №1 ещё загружаются — попробуй через секунду', 'bg-amber-500', 'border-amber-700'); return; }
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        const cards = [];
        rows.forEach((r, i) => {
            cards.push({ pair: i, kind: 'e', text: r.event });
            cards.push({ pair: i, kind: 'y', text: r.year });
        });
        _shuffle(cards);
        _m = { cards, sel: -1, lock: false, done: 0, penalty: 0, t0: Date.now(), int: null, over: false };
        _render();
        _m.int = setInterval(_tick, 100);
        _h('light');
    };

    window.closeMatchMode = function () {
        if (!_m) return;
        clearInterval(_m.int);
        const ov = document.getElementById('match-overlay');
        if (ov) ov.remove();
        _m = null;
    };

    function _tick() {
        if (!_m || _m.over) return;
        const el = document.getElementById('mm-timer');
        if (el) el.textContent = _fmt(Date.now() - _m.t0 + _m.penalty);
    }

    function _render() {
        const old = document.getElementById('match-overlay');
        if (old) old.remove();
        const cols = (window.innerWidth || 360) >= 640 ? 4 : 3;
        const best = _best();
        const ov = document.createElement('div');
        ov.id = 'match-overlay';
        ov.className = 'fixed inset-0 flex flex-col bg-gray-50 dark:bg-[#121212]';
        ov.style.cssText = `z-index:${Z};padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))`;
        ov.innerHTML = `
            <div style="width:100%;max-width:840px;margin:0 auto;display:flex;flex-direction:column;flex-grow:1;min-height:0">
            <div class="flex items-center justify-between shrink-0 mb-2" style="gap:8px">
                <div class="text-left" style="min-width:86px">
                    <div class="text-[9px] font-black uppercase tracking-widest text-gray-400">🧩 Подбор · №1</div>
                    <div class="text-[10px] font-bold text-gray-400">${best ? '🏆 ' + _fmt(best) : 'первый раунд!'}</div>
                </div>
                <div class="text-center">
                    <div id="mm-timer" class="font-black text-2xl tabular-nums text-gray-800 dark:text-gray-200">0.0 сек</div>
                    <div id="mm-penalty" class="text-[10px] font-black text-rose-500" style="visibility:hidden">+1 сек штрафа!</div>
                </div>
                <button id="mm-exit" class="font-black text-xs bg-white dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-[#3f3f46] shadow-sm active:scale-95 transition-transform" style="padding:8px 12px">✕ Выйти</button>
            </div>
            <!-- max-высота карточек + align-content:center: на ПК плитки не раздуваются во весь экран.
                 padding у грида — чтобы scale(1.04) выбранной карточки не обрезался краем overflow -->
            <div id="mm-grid" class="flex-grow" style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:minmax(84px,156px);align-content:center;gap:9px;overflow-y:auto;padding:6px"></div>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#mm-exit').onclick = () => { _h('light'); window.closeMatchMode(); };
        const grid = ov.querySelector('#mm-grid');
        _m.cards.forEach((c, i) => {
            const b = document.createElement('button');
            b.dataset.idx = String(i);
            b.className = 'mm-card bg-white dark:bg-[#1e1e1e] border-2 border-gray-200 dark:border-[#3f3f46] rounded-2xl shadow-sm text-gray-800 dark:text-gray-200 active:scale-95';
            const big = (window.innerWidth || 360) >= 640; // на ПК шрифты крупнее
            b.style.cssText = 'display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;min-height:84px;cursor:pointer;transition:transform .12s,border-color .12s,opacity .25s;line-height:1.25;' +
                (c.kind === 'y' ? `font-weight:900;font-size:${big ? 21 : 17}px;font-variant-numeric:tabular-nums`
                    : `font-weight:700;font-size:${c.text.length > 70 ? (big ? 12 : 10) : (big ? 13.5 : 11.5)}px`);
            b.textContent = c.text; // textContent — экранирование не нужно
            b.onclick = () => _pick(i);
            grid.appendChild(b);
        });
    }

    function _cardEl(i) { return document.querySelector(`#mm-grid .mm-card[data-idx="${i}"]`); }
    function _setSel(i, on) {
        const el = _cardEl(i); if (!el) return;
        el.style.borderColor = on ? '#3b82f6' : '';
        el.style.transform = on ? 'scale(1.04)' : '';
        el.style.boxShadow = on ? '0 0 0 3px rgba(59,130,246,0.25)' : '';
    }

    function _pick(i) {
        if (!_m || _m.over || _m.lock) return;
        const c = _m.cards[i];
        if (!c || c.gone) return;
        _h('light');
        if (_m.sel === i) { _setSel(i, false); _m.sel = -1; return; }  // сняли выбор
        if (_m.sel < 0) { _m.sel = i; _setSel(i, true); return; }      // первая карточка
        const j = _m.sel; _m.sel = -1;
        const a = _m.cards[j];
        _setSel(j, false);
        if (a.pair === c.pair && a.kind !== c.kind) {
            // ── пара! обе исчезают ──
            a.gone = c.gone = true;
            _m.done++;
            [j, i].forEach(k => { const el = _cardEl(k); if (el) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.style.transform = 'scale(0.8)'; } });
            _play(true); _h('medium');
            if (_m.done === PAIRS) _finish();
        } else {
            // ── промах: +1с, красная встряска обеих ──
            _m.penalty += PENALTY_MS;
            _play(false); _h('heavy');
            const pen = document.getElementById('mm-penalty');
            if (pen) { pen.style.visibility = 'visible'; setTimeout(() => { if (pen) pen.style.visibility = 'hidden'; }, 700); }
            _m.lock = true;
            [j, i].forEach(k => { const el = _cardEl(k); if (el) { el.style.borderColor = '#f43f5e'; el.style.animation = 'mmshake .3s'; } });
            setTimeout(() => {
                [j, i].forEach(k => { const el = _cardEl(k); if (el && !_m0gone(k)) { el.style.borderColor = ''; el.style.animation = ''; } });
                if (_m) _m.lock = false;
            }, 340);
        }
    }
    function _m0gone(k) { return !_m || !_m.cards[k] || _m.cards[k].gone; }

    function _finish() {
        _m.over = true;
        clearInterval(_m.int);
        const ms = Date.now() - _m.t0 + _m.penalty;
        let newBest = false;
        const s = window.state && window.state.stats;
        if (s) {
            s.matchGames = (Number(s.matchGames) || 0) + 1;
            if (!s.matchBestMs || ms < s.matchBestMs) { s.matchBestMs = ms; newBest = true; }
            try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {}
        }
        _play(true); _h('medium');
        const ov = document.getElementById('match-overlay');
        if (!ov) return;
        const panel = document.createElement('div');
        panel.className = 'fixed inset-0 flex items-center justify-center';
        panel.style.cssText = `z-index:${Z + 1};background:rgba(0,0,0,0.55);backdrop-filter:blur(3px)`;
        panel.innerHTML = `
            <div class="bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-2xl text-center" style="padding:26px 22px;width:88%;max-width:340px">
                <div style="font-size:52px;line-height:1">${newBest ? '🏆' : '🧩'}</div>
                <div class="font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest" style="font-size:15px;margin-top:8px">${newBest ? 'Новый рекорд!' : 'Все пары собраны!'}</div>
                <div class="font-black tabular-nums text-blue-600 dark:text-blue-400" style="font-size:40px;margin-top:6px">${_fmt(ms)}</div>
                <div class="text-[11px] font-bold text-gray-400" style="margin-top:2px">${_m.penalty ? `в т.ч. штраф +${_m.penalty / 1000} сек · ` : ''}🏆 рекорд: ${_fmt(_best())}</div>
                <button id="mm-again" class="w-full bg-blue-600 text-white rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:13px;margin-top:16px;font-size:13px">🔁 Ещё раз</button>
                <button id="mm-close" class="w-full bg-gray-100 dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:11px;margin-top:8px;font-size:12px">✕ Выйти</button>
            </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#mm-again').onclick = () => { panel.remove(); window.closeMatchMode(); window.openMatchMode(); };
        panel.querySelector('#mm-close').onclick = () => { panel.remove(); window.closeMatchMode(); };
    }

    // встряска промаха
    try {
        const st = document.createElement('style');
        st.textContent = '@keyframes mmshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}';
        document.head.appendChild(st);
    } catch (e) {}
})();
