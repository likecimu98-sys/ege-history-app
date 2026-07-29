// match-mode.js — режим «Подбор» (механика Match из Quizlet): 12 карточек (6 пар
// «событие ↔ дата» из задания №1), тапаешь две подходящие — исчезают. Таймер идёт
// вверх, промах = +1 секунда штрафа. Цель — собрать все пары быстрее рекорда.
// Самодостаточный оверлей (как swipe-mode.js): не трогает currentMode/таблицу.
//
// ДУЭЛЬ-ПОДБОР (openMatchDuel) живёт в этом же файле и делит с одиночным режимом
// сетку, выбор карточек и звуки. Отличия ровно три: таймер идёт ВНИЗ (45 с, как в
// свайп-дуэли), промах стоит очков, а не секунд, и наверху появляется полоса счёта
// с соперником. Очки считаются по ТОЙ ЖЕ формуле, что и в свайп-дуэли, иначе Elo
// в двух режимах означал бы разное и общий топ дуэлей потерял бы смысл.
'use strict';

(function () {
    let _m = null;

    const PAIRS = 6;            // пар в раунде (12 карточек, как в Quizlet)
    const PENALTY_MS = 1000;    // штраф за промах
    const Z = 10006;

    // Дуэль: 4 раунда по 6 пар — заведомо больше, чем успевают за 45 секунд.
    // Матч всегда обрывает таймер, а не «закончились карточки» у быстрого игрока.
    const DUEL_ROUNDS = 4;
    const DUEL_MS = 45000;
    window.MATCH_DUEL_MS = DUEL_MS;

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

    function _rowYear(r) { const m = String(r && r.year).match(/\d+/); return m ? parseInt(m[0], 10) : NaN; }

    // Явные рамки (ДЗ учителя) сильнее глобального селектора периода: в ДЗ диапазон
    // задан преподавателем и подстраиваться под то, что ученик выбрал в лобби, нельзя.
    function _pickRows(range) {
        const base = (window.task1Data || []).filter(r => r && r.event && r.year);
        const scoped = range
            ? base.filter(r => { const y = _rowYear(r); return y >= range[0] && y <= range[1]; })
            : _periodFilterTask1(base);
        let out = _sixUniqueDates(scoped);
        // Узкий период не набрал 6 уникальных дат — тихо расширяемся до всей базы,
        // чтобы раунд всегда собирался (лучше сыграть по всей истории, чем показать ошибку).
        if (out.length < PAIRS) out = _sixUniqueDates(base);
        return out;
    }

    // Сколько дат задания №1 попадает в диапазон. Раунд собирается из УНИКАЛЬНЫХ дат
    // (два события одного года сделали бы неверную пару внешне верной), поэтому
    // составителю ДЗ важно именно второе число — по нему видно, наберётся ли раунд.
    window.matchDatesInRange = function (ys, ye) {
        const base = (window.task1Data || []).filter(r => r && r.event && r.year);
        if (!base.length) return null;
        const a = Number(ys), b = Number(ye);
        const rows = (isFinite(a) && isFinite(b))
            ? base.filter(r => { const y = _rowYear(r); return y >= Math.min(a, b) && y <= Math.max(a, b); })
            : base;
        return { total: rows.length, unique: new Set(rows.map(r => String(r.year).trim())).size, pairsNeeded: PAIRS };
    };

    function _best() { return Number(window.state && window.state.stats && window.state.stats.matchBestMs) || 0; }

    // ─── Дуэль-подбор: у обоих игроков ОДИНАКОВЫЕ карточки ──────────────────────
    // Колоду строит создатель матча и кладёт в документ матча — как в свайп-дуэли.
    // Период НЕ применяем: у соперника он свой, а колода обязана совпасть до карточки.
    // Уникальность дат — в пределах ВСЕГО матча, а не раунда: одна и та же дата в
    // разных раундах превратила бы неверную пару в внешне верную при быстром темпе.
    window.buildMatchDuelRounds = function () {
        const base = (window.task1Data || []).filter(r => r && r.event && r.year);
        const need = PAIRS * DUEL_ROUNDS;
        const picked = [], seen = new Set();
        for (const r of _shuffle(base.slice())) {
            const y = String(r.year).trim();
            if (seen.has(y)) continue;
            seen.add(y);
            picked.push(r);
            if (picked.length === need) break;
        }
        if (picked.length < need) return null;
        const rounds = [];
        for (let i = 0; i < DUEL_ROUNDS; i++) {
            rounds.push({ pairs: picked.slice(i * PAIRS, (i + 1) * PAIRS).map(r => ({ e: r.event, y: String(r.year) })) });
        }
        return rounds;
    };

    function _fmtLeft(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    // plural живёт в ui.js; здесь страхуемся на случай другого порядка загрузки.
    function _pairs(n) { return typeof plural === 'function' ? plural(n, 'пара', 'пары', 'пар') : 'пар'; }

    window.openMatchDuel = function (opts) {
        const rounds = ((opts && opts.rounds) || []).filter(r => r && (r.pairs || []).length);
        const total = rounds.reduce((n, r) => n + r.pairs.length, 0);
        if (!total) {
            if (typeof showToast === 'function') showToast('⚠️', 'Не удалось получить колоду дуэли', 'bg-rose-500', 'border-rose-700');
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
            return;
        }
        if (_m) window.closeMatchMode();
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        _m = {
            cards: [], sel: -1, lock: false, done: 0, penalty: 0, t0: Date.now(), int: null, over: false,
            score: 0, streak: 0, best: 0,
            duel: {
                rounds, roundIdx: -1, total, done: 0,
                oppName: (opts && opts.oppName) || 'Соперник',
                oppScore: 0, oppDone: 0,
                endsAt: (opts && opts.endsAt) || (Date.now() + DUEL_MS),
                finishedMine: false, over: false, timerIv: null
            }
        };
        _render();
        _duelNextRound();
        _m.duel.timerIv = setInterval(_duelTick, 250);
        _duelTick();
        _h('medium');
    };

    function _duelNextRound() {
        const d = _m && _m.duel; if (!d) return;
        d.roundIdx++;
        const round = d.rounds[d.roundIdx];
        if (!round) return _duelMineDone();
        const cards = [];
        round.pairs.forEach((p, i) => {
            cards.push({ pair: i, kind: 'e', text: p.e });
            cards.push({ pair: i, kind: 'y', text: p.y });
        });
        _shuffle(cards);
        _m.cards = cards; _m.sel = -1; _m.done = 0; _m.lock = false;
        _renderGrid();
    }

    function _duelReport() {
        const d = _m && _m.duel; if (!d) return;
        try { window.updateDuelScoreDb && window.updateDuelScoreDb(_m.score, _m.streak, { done: d.done, correct: d.done }); } catch (e) {}
    }

    function _updateDuelBar() {
        const d = _m && _m.duel; if (!d) return;
        const me = document.getElementById('mm-d-me'), op = document.getElementById('mm-d-opp');
        const meB = document.getElementById('mm-d-me-bar'), opB = document.getElementById('mm-d-opp-bar');
        if (me) me.textContent = `${d.done}/${d.total} · ${_m.score}`;
        if (op) op.textContent = `${d.oppDone}/${d.total} · ${d.oppScore}`;
        if (meB) meB.style.width = Math.round(d.done / d.total * 100) + '%';
        if (opB) opB.style.width = Math.round(d.oppDone / d.total * 100) + '%';
        const sc = document.getElementById('mm-score'); if (sc) sc.textContent = _m.score;
        const st = document.getElementById('mm-streak'); if (st) st.textContent = _m.streak;
    }

    window.updateMatchDuelOpp = function (opp) {
        const d = _m && _m.duel; if (!d || !opp) return;
        d.oppScore = opp.score || 0;
        d.oppDone = opp.done || 0;
        _updateDuelBar();
        if (d.finishedMine && d.oppDone >= d.total && !d.over) _duelFinish();
    };

    function _duelTick() {
        const d = _m && _m.duel; if (!d) return;
        const el = document.getElementById('mm-timer');
        if (el) el.textContent = _fmtLeft(d.endsAt - Date.now());
        if (d.endsAt - Date.now() <= 0 && !d.over) _duelFinish();
    }

    function _duelMineDone() {
        const d = _m && _m.duel; if (!d || d.over) return;
        d.finishedMine = true;
        _duelReport();
        _updateDuelBar();
        if (d.oppDone >= d.total) return _duelFinish();
        const grid = document.getElementById('mm-grid');
        if (grid) grid.innerHTML = `
            <div style="grid-column:1/-1;align-self:center;text-align:center;color:#64748b">
                <div style="font-size:44px">🚀</div>
                <div style="font-size:16px;font-weight:900;margin-top:6px">Все пары собраны!</div>
                <div style="font-size:12.5px;opacity:.8;margin-top:4px">Жди конца таймера — соперник ещё играет</div>
            </div>`;
    }

    function _duelFinish() {
        const d = _m && _m.duel; if (!d || d.over) return;
        d.over = true; _m.over = true; _m.lock = true;
        if (d.timerIv) { clearInterval(d.timerIv); d.timerIv = null; }
        _duelReport();
        const grid = document.getElementById('mm-grid');
        if (grid) grid.innerHTML = `
            <div style="grid-column:1/-1;align-self:center;text-align:center;color:#64748b">
                <div style="font-size:44px">⏱</div>
                <div style="font-size:17px;font-weight:1000;margin-top:6px">Время!</div>
                <div style="font-size:12.5px;opacity:.8;margin-top:4px">Считаем очки…</div>
            </div>`;
        setTimeout(_duelVerdict, 400);
    }

    // Финал — той же процедурой, что и свайп-дуэль: авторитетные числа из документа
    // матча (иначе у одного «победа», у другого «ничья»), затем Elo и только потом
    // cancelDuelDb, который стирает рейтинг соперника из window.state.duel.
    async function _duelVerdict() {
        const d = _m && _m.duel; if (!d) return;
        let my = _m.score, opp = d.oppScore, oppEloDoc = null;
        try {
            const fin = window.finalizeDuelScores
                ? await window.finalizeDuelScores(_m.score, _m.streak, { done: d.done, correct: d.done })
                : null;
            if (fin) { my = fin.mine; opp = fin.opp; oppEloDoc = fin.oppElo; d.oppScore = opp; }
        } catch (e) { console.warn('[Duel] finalize:', e); }
        let rate = null;
        try {
            const oppElo = oppEloDoc || (window.state && window.state.duel && window.state.duel.oppElo) || 1000;
            rate = window.applyDuelResult ? window.applyDuelResult(my, opp, oppElo) : null;
            if (rate) {
                if (window.saveProgress) window.saveProgress();
                if (window.syncNow) window.syncNow();
            }
        } catch (e) { console.warn('[Duel] Elo не применён:', e); }
        try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
        try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        const win = my > opp, draw = my === opp;
        _h(win ? 'success' : 'error');
        _play(win);
        _updateDuelBar();
        const ov = document.getElementById('match-overlay'); if (!ov) return;
        const panel = document.createElement('div');
        panel.id = 'mm-duel-end';
        panel.className = 'fixed inset-0 flex items-center justify-center';
        panel.style.cssText = `z-index:${Z + 1};background:rgba(0,0,0,0.55);backdrop-filter:blur(3px)`;
        panel.innerHTML = `
            <div class="bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-2xl text-center" style="padding:24px 22px;width:88%;max-width:340px">
                <div style="font-size:52px;line-height:1">${win ? '🏆' : draw ? '🤝' : '💔'}</div>
                <div class="font-black uppercase tracking-widest" style="font-size:15px;margin-top:8px;color:${win ? '#16a34a' : draw ? '#64748b' : '#e11d48'}">${win ? 'Победа!' : draw ? 'Ничья' : 'Поражение'}</div>
                <div class="font-black tabular-nums text-gray-800 dark:text-gray-200" style="font-size:34px;margin-top:6px">${my} <span style="opacity:.4">:</span> ${opp}</div>
                <div class="text-[11px] font-bold text-gray-400" style="margin-top:2px">Ты: ${d.done} ${_pairs(d.done)} · ${_esc(d.oppName)}: ${d.oppDone} ${_pairs(d.oppDone)}</div>
                ${rate ? `<div class="font-black" style="font-size:13px;margin-top:6px;color:${rate.delta >= 0 ? '#16a34a' : '#e11d48'}">🏅 Рейтинг: ${rate.elo} (${rate.delta >= 0 ? '+' : ''}${rate.delta})</div>` : ''}
                <button id="mm-d-rematch" class="w-full bg-blue-600 text-white rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:13px;margin-top:16px;font-size:13px">⚔️ Ещё раз</button>
                <button id="mm-d-exit" class="w-full bg-gray-100 dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:11px;margin-top:8px;font-size:12px">✕ Выйти</button>
                <button id="mm-d-top" class="font-black text-blue-500 underline" style="background:none;border:none;font-size:12px;margin-top:10px;cursor:pointer">🏆 Топ дуэлей</button>
            </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#mm-d-rematch').onclick = () => { panel.remove(); window.closeMatchMode(); if (window.startDuelSearch) window.startDuelSearch(); };
        panel.querySelector('#mm-d-exit').onclick = () => { panel.remove(); window.closeMatchMode(); };
        panel.querySelector('#mm-d-top').onclick = () => { panel.remove(); window.closeMatchMode(); if (window.openGlobalTopModal) window.openGlobalTopModal('duel'); };
    }

    // opts.yearStart/yearEnd — хронологические рамки (из ДЗ учителя или явного вызова).
    // opts.hw — раунд идёт внутри ДЗ: собранные пары идут в прогресс этапа, а после
    // раунда мы не показываем экран рекорда, а сразу раздаём следующий, пока цель не взята.
    window.openMatchMode = function (opts) {
        if (_m) return;
        opts = opts || {};
        const ys = parseInt(opts.yearStart, 10), ye = parseInt(opts.yearEnd, 10);
        const range = (isFinite(ys) && isFinite(ye)) ? [Math.min(ys, ye), Math.max(ys, ye)] : null;
        // Норма/лимит (Q2): подбор считается как обычные строки → упирается в дневной лимит.
        // ДЗ от лимита освобождено (см. _isExemptFromDailyLimit), но проверку всё равно
        // зовём: она сама знает про activeHw и вернёт ok.
        if (window.canSolveMore) {
            const lim = window.canSolveMore();
            if (!lim.ok) { if (window.showDailyLimitModal) window.showDailyLimitModal(); return; }
        }
        const rows = _pickRows(range);
        if (rows.length < PAIRS) { if (typeof showToast === 'function') showToast('⚠️', 'Данные задания №1 ещё загружаются — попробуй через секунду', 'bg-amber-500', 'border-amber-700'); return; }
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        const cards = [];
        rows.forEach((r, i) => {
            cards.push({ pair: i, kind: 'e', text: r.event });
            cards.push({ pair: i, kind: 'y', text: r.year });
        });
        _shuffle(cards);
        _m = { cards, sel: -1, lock: false, done: 0, penalty: 0, t0: Date.now(), int: null, over: false,
               range, hw: !!opts.hw };
        _render();
        _renderGrid();
        _m.int = setInterval(_tick, 100);
        _h('light');
    };

    // Сколько пар осталось до цели этапа ДЗ. 0 — цель взята, null — этапа подбора нет.
    // ⚠️ Задание ищем БЕЗ фильтра по статусу: как только цель взята, refreshHwState
    // переводит ДЗ в 'done', и фильтр `status === 'active'` возвращал бы null —
    // то есть «сколько осталось, неизвестно». _finish принимал это за «играем дальше»
    // и запускал раунды бесконечно, не давая сдать домашку.
    function _hwLeft() {
        const ah = window.state && window.state.activeHw;
        if (!ah || !window.state.stats) return null;
        const a = (window.state.stats.assignments || []).find(x => x.id === ah.id);
        const it = a && (a.items || [])[ah.itemIndex];
        if (!it || it.task !== 'match') return null;
        return Math.max(0, (it.goal || 0) - (it.progress || 0));
    }

    window.closeMatchMode = function () {
        if (!_m) return;
        clearInterval(_m.int);
        // Выход из дуэли: гасим таймер и закрываем матч (cancelDuelDb идемпотентен),
        // иначе соперник до конца таймера играет с «замороженным» счётом ушедшего.
        if (_m.duel) {
            if (_m.duel.timerIv) { clearInterval(_m.duel.timerIv); _m.duel.timerIv = null; }
            try { if (window.state && window.state.duel) window.state.duel.active = false; } catch (e) {}
            try { window.cancelDuelDb && window.cancelDuelDb(); } catch (e) {}
        }
        const ov = document.getElementById('match-overlay');
        if (ov) ov.remove();
        const end = document.getElementById('mm-duel-end');
        if (end) end.remove();
        _m = null;
        if (window.updateProgressBars) window.updateProgressBars();
    };

    function _requestExit() {
        _h('light');
        if (_m && _m.duel && !_m.duel.over && window.uiConfirm) {
            return window.uiConfirm('Выйти из дуэли? Это засчитается как сдача.', window.closeMatchMode);
        }
        window.closeMatchMode();
    }

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
        const d = _m && _m.duel;
        const hwLeft = (_m && _m.hw) ? _hwLeft() : null;
        const ov = document.createElement('div');
        ov.id = 'match-overlay';
        ov.className = 'fixed inset-0 flex flex-col bg-gray-50 dark:bg-[#121212]';
        ov.style.cssText = `z-index:${Z};padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))`;
        // Дуэльная шапка занимает место у сетки, а не наезжает на неё: обе части —
        // flex-shrink:0 в той же колонке, сетка остаётся flex-grow. На 3 колонках
        // 12 карточек — 4 ряда по 84px минимум, помещаются и на 568px экране.
        ov.innerHTML = `
            <div style="width:100%;max-width:840px;margin:0 auto;display:flex;flex-direction:column;flex-grow:1;min-height:0">
            <div class="flex items-center justify-between shrink-0" style="gap:8px;margin-bottom:${d ? '6px' : '8px'}">
                <div class="text-left" style="min-width:86px">
                    <div class="text-[9px] font-black uppercase tracking-widest text-gray-400">${d ? '⚔️ Подбор · дуэль' : hwLeft !== null ? '🧩 Подбор · ДЗ' : '🧩 Подбор · №1'}${!d && _m.range ? ` · ${_m.range[0]}–${_m.range[1]}` : ''}</div>
                    ${d
                        ? `<div class="text-[11px] font-black text-gray-500 dark:text-gray-300" style="margin-top:1px">Счёт: <span id="mm-score" class="text-blue-600 dark:text-blue-400">0</span> · 🔥<span id="mm-streak">0</span></div>`
                        : hwLeft !== null
                            ? `<div id="mm-hw-left" class="text-[11px] font-black" style="margin-top:1px;color:#4f46e5">Осталось ${hwLeft} ${_pairs(hwLeft)}</div>`
                            : `<div class="text-[10px] font-bold text-gray-400">${best ? '🏆 ' + _fmt(best) : 'первый раунд!'}</div>`}
                </div>
                <div class="text-center">
                    <div id="mm-timer" class="font-black text-2xl tabular-nums ${d ? 'text-rose-500' : 'text-gray-800 dark:text-gray-200'}">${d ? _fmtLeft(DUEL_MS) : '0.0 сек'}</div>
                    <div id="mm-penalty" class="text-[10px] font-black text-rose-500" style="visibility:hidden">${d ? '−5 очков!' : '+1 сек штрафа!'}</div>
                </div>
                <button id="mm-exit" class="font-black text-xs bg-white dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-[#3f3f46] shadow-sm active:scale-95 transition-transform" style="padding:8px 12px">✕ Выйти</button>
            </div>
            ${d ? `
            <div class="shrink-0" style="display:flex;flex-direction:column;gap:3px;margin-bottom:7px;font-size:11px;font-weight:900">
                <div style="display:flex;align-items:center;gap:7px">
                    <span style="width:58px;flex-shrink:0;color:#3b82f6">ТЫ</span>
                    <div style="flex:1;height:6px;background:rgba(120,120,140,0.22);border-radius:999px;overflow:hidden"><div id="mm-d-me-bar" style="width:0%;height:100%;background:#3b82f6;border-radius:999px;transition:width .3s"></div></div>
                    <span id="mm-d-me" class="text-gray-500 dark:text-gray-300 tabular-nums" style="flex-shrink:0">0/${d.total} · 0</span>
                </div>
                <div style="display:flex;align-items:center;gap:7px">
                    <span style="width:58px;flex-shrink:0;color:#f59e0b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(d.oppName).toUpperCase()}</span>
                    <div style="flex:1;height:6px;background:rgba(120,120,140,0.22);border-radius:999px;overflow:hidden"><div id="mm-d-opp-bar" style="width:0%;height:100%;background:#f59e0b;border-radius:999px;transition:width .3s"></div></div>
                    <span id="mm-d-opp" class="text-gray-500 dark:text-gray-300 tabular-nums" style="flex-shrink:0">0/${d.total} · 0</span>
                </div>
            </div>` : ''}
            <!-- max-высота карточек + align-content:center: на ПК плитки не раздуваются во весь экран.
                 padding у грида — чтобы scale(1.04) выбранной карточки не обрезался краем overflow -->
            <div id="mm-grid" class="flex-grow" style="display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:minmax(84px,156px);align-content:center;gap:9px;overflow-y:auto;padding:6px"></div>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#mm-exit').onclick = _requestExit;
    }

    function _renderGrid() {
        const grid = document.getElementById('mm-grid');
        if (!grid || !_m) return;
        grid.innerHTML = '';
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
            // Дуэль в норму дня и в дневной лимит не идёт (как и свайп-дуэль):
            // норма — про самостоятельную работу, а не про матч с соперником.
            if (_m.duel) {
                // Та же формула, что в свайп-дуэли: 10 очков + растущий бонус за серию
                // (максимум +20). Менять её здесь нельзя — Elo общий на оба режима.
                _m.streak++; _m.best = Math.max(_m.best, _m.streak);
                _m.score += 10 + Math.min(20, (_m.streak - 1) * 2);
                _m.duel.done++;
                if (!_m.duel.over) { _duelReport(); _updateDuelBar(); }
            } else {
                if (window.creditNorm) window.creditNorm(1, 'task1'); // Q2: подбор идёт в норму дня
                // ДЗ «подбор»: пара = единица прогресса этапа. Считаем ТУТ, а не в
                // checkAnswers: подбор не проходит через решение таблицы, и без этого
                // вызова этап никогда бы не сдвинулся.
                if (_m.hw && window.creditActiveHwItem) {
                    window.creditActiveHwItem('match', 1, 0);
                    if (window.refreshHwState) window.refreshHwState();
                    if (window.saveLocal) window.saveLocal();
                    const left = _hwLeft(), el = document.getElementById('mm-hw-left');
                    if (el && left !== null) el.textContent = left > 0 ? `Осталось ${left} ${_pairs(left)}` : 'Этап выполнен ✓';
                }
            }
            [j, i].forEach(k => { const el = _cardEl(k); if (el) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.style.transform = 'scale(0.8)'; } });
            _play(true); _h('medium');
            if (_m.done === PAIRS) {
                // Даём доиграть анимации исчезновения последней пары, иначе новый раунд
                // подменяет сетку мгновенно и выглядит как сбой.
                if (_m.duel) { _m.lock = true; setTimeout(() => { if (_m && _m.duel && !_m.duel.over) _duelNextRound(); }, 320); }
                else _finish();
            }
        } else {
            // ── промах: в одиночном режиме +1 секунда, в дуэли −5 очков ──
            if (_m.duel) {
                _m.streak = 0;
                _m.score = Math.max(0, _m.score - 5);
                if (!_m.duel.over) { _duelReport(); _updateDuelBar(); }
            } else {
                _m.penalty += PENALTY_MS;
            }
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

        // ДЗ: раунд — это 6 пар, а цель учителя обычно больше. Экран рекорда посреди
        // домашки только сбивает: молча раздаём следующий раунд в тех же рамках, пока
        // цель не взята. Взята — отдаём управление потоку ДЗ (он сам покажет итог
        // и перейдёт к следующему этапу).
        if (_m.hw) {
            const left = _hwLeft();
            const range = _m.range;
            // null (этап пропал/сменился) трактуем как «дальше не играем»: зациклиться
            // на раундах хуже, чем лишний раз выйти в список ДЗ.
            if (left !== null && left > 0) {
                if (typeof showToast === 'function') showToast('🧩', `Раунд собран! Осталось ${left} ${_pairs(left)}`, 'bg-indigo-500', 'border-indigo-700');
                window.closeMatchMode();
                setTimeout(() => window.openMatchMode({ hw: true, yearStart: range && range[0], yearEnd: range && range[1] }), 450);
                return;
            }
            window.closeMatchMode();
            if (window.maybeAdvanceHw) window.maybeAdvanceHw();
            return;
        }
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
        // «Ещё раз» сохраняет хронологические рамки текущего раунда — иначе игрок,
        // тренировавший XX век, следующим раундом получал бы всю историю.
        const againRange = _m.range;
        panel.querySelector('#mm-again').onclick = () => {
            panel.remove(); window.closeMatchMode();
            window.openMatchMode(againRange ? { yearStart: againRange[0], yearEnd: againRange[1] } : undefined);
        };
        panel.querySelector('#mm-close').onclick = () => { panel.remove(); window.closeMatchMode(); };
    }

    // встряска промаха
    try {
        const st = document.createElement('style');
        st.textContent = '@keyframes mmshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}';
        document.head.appendChild(st);
    } catch (e) {}
})();
