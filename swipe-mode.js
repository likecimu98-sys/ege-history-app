// swipe-mode.js — режим «Свайп»: факт по центру, два правителя слева/справа.
// Свайпни карточку в сторону того, к кому относится факт. Со звуками и забавностями.
'use strict';

(function () {
    let _sw = null;
    let _yes = null, _fah = null;
    let _muted = false;
    try { _muted = localStorage.getItem('swipeMuted') === '1'; } catch (e) {}

    function _h(type) { try { if (typeof haptic === 'function') haptic(type); } catch (e) {} }
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

    function _preload() {
        try {
            if (!_yes) { _yes = new Audio('assets/sounds/yes.mp3'); _yes.preload = 'auto'; }
            if (!_fah) { _fah = new Audio('assets/sounds/fah.mp3'); _fah.preload = 'auto'; }
        } catch (e) {}
    }
    function _play(ok) { if (_muted) return; try { const a = ok ? _yes : _fah; if (a) { a.currentTime = 0; a.play().catch(() => {}); } } catch (e) {} }
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

    function _buildDeck() {
        const rulers = window.swipeRulersData || [];
        const cards = [];
        rulers.forEach(r => (r.facts || []).forEach(f => cards.push({ fact: f, correctId: r.id })));
        return _shuffle(cards);
    }

    window.openSwipeMode = function () {
        const rulers = window.swipeRulersData || [];
        if (rulers.length < 2) {
            if (typeof showToast === 'function') showToast('⚠️', 'Нет данных для свайпа', 'bg-rose-500', 'border-rose-700');
            return;
        }
        _h('light');
        _preload();
        const deck = _buildDeck();
        _sw = { deck, i: 0, score: 0, streak: 0, best: 0, correct: 0, wrong: 0, total: deck.length, lock: false, cur: null };
        let ov = document.getElementById('swipe-overlay');
        if (!ov) { ov = document.createElement('div'); ov.id = 'swipe-overlay'; document.body.appendChild(ov); }
        ov.className = 'no-print';
        ov.style.cssText = 'position:fixed;inset:0;z-index:10050;display:flex;flex-direction:column;background:radial-gradient(circle at 50% 0%,#1e293b,#0b1120);overscroll-behavior:contain;touch-action:none';
        _renderShell();
        _nextCard();
        document.addEventListener('keydown', _onKey);
    };

    window.closeSwipeMode = function () {
        document.removeEventListener('keydown', _onKey);
        const ov = document.getElementById('swipe-overlay');
        if (ov) ov.remove();
        _sw = null;
        if (window.updateProgressBars) window.updateProgressBars();
    };

    function _onKey(e) {
        if (!_sw) return;
        if (e.key === 'Escape') return window.closeSwipeMode();
        if (e.key === 'ArrowLeft') { e.preventDefault(); _commit('left'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); _commit('right'); }
    }

    function _renderShell() {
        const ov = document.getElementById('swipe-overlay'); if (!ov) return;
        ov.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;color:#e2e8f0;flex-shrink:0">
            <button id="sw-close" style="background:rgba(255,255,255,0.1);border:none;color:#fff;width:36px;height:36px;border-radius:12px;font-size:18px;cursor:pointer">✕</button>
            <div style="display:flex;gap:12px;align-items:center;font-weight:900">
                <span style="font-size:13px">Счёт: <span id="sw-score" style="color:#fbbf24">0</span></span>
                <span style="font-size:13px">🔥 <span id="sw-streak">0</span></span>
                <span style="font-size:13px;opacity:.7">осталось: <span id="sw-left">0</span></span>
                <button id="sw-mute" title="Звук вкл/выкл" style="background:rgba(255,255,255,0.1);border:none;width:32px;height:32px;border-radius:10px;font-size:15px;cursor:pointer;opacity:${_muted ? '0.55' : '1'}">${_muteIcon()}</button>
            </div>
        </div>
        <div id="sw-arena" style="flex:1;position:relative;display:flex;flex-direction:column;min-height:0;padding:0 12px 12px"></div>
        <div style="text-align:center;color:#94a3b8;font-size:12px;font-weight:800;padding:8px 0 16px;flex-shrink:0">
            ← свайпни карточку к нужному правителю →
        </div>`;
        ov.querySelector('#sw-close').onclick = window.closeSwipeMode;
        const mb = ov.querySelector('#sw-mute'); if (mb) mb.onclick = _toggleMute;
        _updateHeader();
    }

    function _updateHeader() {
        if (!_sw) return;
        const s = document.getElementById('sw-score'); if (s) s.textContent = _sw.score;
        const st = document.getElementById('sw-streak'); if (st) st.textContent = _sw.streak;
        const l = document.getElementById('sw-left'); if (l) l.textContent = Math.max(0, _sw.total - _sw.i);
    }

    function _panel(side, ruler) {
        const accent = side === 'left' ? '#60a5fa' : '#fbbf24';
        const tint = side === 'left' ? 'rgba(96,165,250,0.12)' : 'rgba(251,191,36,0.12)';
        return `<button id="sw-panel-${side}" data-side="${side}" style="flex:1;min-width:0;background:${tint};border:2px solid ${accent}55;border-radius:18px;padding:12px 8px;color:#e2e8f0;cursor:pointer;transition:transform .12s,box-shadow .12s;display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center">
            <div style="font-size:26px">${ruler.emoji || '👑'}</div>
            <div style="font-size:14px;font-weight:900;line-height:1.1">${_esc(ruler.name)}</div>
            <div style="font-size:10px;opacity:.7;font-weight:700">${_esc(ruler.years || '')}</div>
        </button>`;
    }

    function _nextCard() {
        if (!_sw) return;
        _sw.lock = false;
        const card = _sw.deck[_sw.i];
        if (!card) return _renderEnd();
        const rulers = window.swipeRulersData;
        const correct = rulers.find(r => r.id === card.correctId);
        const others = rulers.filter(r => r.id !== card.correctId);
        const distractor = others[Math.floor(Math.random() * others.length)];
        const leftFirst = Math.random() < 0.5;
        _sw.cur = {
            card, correctId: card.correctId,
            left: leftFirst ? correct : distractor,
            right: leftFirst ? distractor : correct
        };
        _renderCard();
    }

    function _renderCard() {
        const arena = document.getElementById('sw-arena'); if (!arena || !_sw) return;
        const c = _sw.cur;
        arena.innerHTML = `
        <div style="display:flex;gap:10px;align-items:stretch;margin-bottom:10px;flex-shrink:0">
            ${_panel('left', c.left)}
            <div style="display:flex;align-items:center;color:#64748b;font-weight:900;font-size:13px">VS</div>
            ${_panel('right', c.right)}
        </div>
        <div style="flex:1;position:relative;display:flex;align-items:center;justify-content:center;min-height:0">
            <div id="sw-card" style="position:relative;width:100%;max-width:420px;min-height:46%;background:#fff;border:3px solid #e2e8f0;border-radius:24px;box-shadow:0 18px 50px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;padding:26px 22px;cursor:grab;touch-action:none;user-select:none">
                <div id="sw-stamp-left"  style="position:absolute;top:14px;left:14px;transform:rotate(-14deg);border:3px solid #60a5fa;color:#2563eb;font-weight:1000;font-size:20px;letter-spacing:1px;padding:5px 12px;border-radius:10px;opacity:0;pointer-events:none;background:rgba(96,165,250,0.12)">← ТУДА</div>
                <div id="sw-stamp-right" style="position:absolute;top:14px;right:14px;transform:rotate(14deg);border:3px solid #f59e0b;color:#b45309;font-weight:1000;font-size:20px;letter-spacing:1px;padding:5px 12px;border-radius:10px;opacity:0;pointer-events:none;background:rgba(251,191,36,0.12)">СЮДА →</div>
                <div style="font-size:clamp(16px,4.6vw,22px);font-weight:900;color:#0f172a;text-align:center;line-height:1.3">${_esc(c.card.fact)}</div>
            </div>
        </div>
        <div id="sw-verdict" style="height:26px;text-align:center;font-weight:900;font-size:14px;margin-top:6px;flex-shrink:0"></div>`;
        const cardEl = document.getElementById('sw-card');
        _attachDrag(cardEl);
        arena.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => _commit(b.dataset.side)));
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
            if (Math.abs(dx) > 90) { _commit(dx < 0 ? 'left' : 'right'); }
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
        const rot = Math.max(-18, Math.min(18, dx * 0.06));
        cardEl.style.transform = `translate(${dx}px,0) rotate(${rot}deg)`;
        const p = Math.min(1, Math.abs(dx) / 90);
        const ls = document.getElementById('sw-stamp-left'), rs = document.getElementById('sw-stamp-right');
        if (ls) ls.style.opacity = dx < 0 ? p : 0;
        if (rs) rs.style.opacity = dx > 0 ? p : 0;
        const lp = document.getElementById('sw-panel-left'), rp = document.getElementById('sw-panel-right');
        if (lp) { lp.style.transform = dx < 0 ? `scale(${1 + 0.06 * p})` : 'scale(1)'; lp.style.boxShadow = dx < 0 ? `0 0 0 3px rgba(96,165,250,${0.7 * p})` : 'none'; }
        if (rp) { rp.style.transform = dx > 0 ? `scale(${1 + 0.06 * p})` : 'scale(1)'; rp.style.boxShadow = dx > 0 ? `0 0 0 3px rgba(251,191,36,${0.7 * p})` : 'none'; }
    }

    function _commit(dir) {
        if (!_sw || _sw.lock || !_sw.cur) return;
        _sw.lock = true;
        const chosen = dir === 'left' ? _sw.cur.left : _sw.cur.right;
        const ok = chosen.id === _sw.cur.correctId;
        _play(ok);
        _h(ok ? 'success' : 'error');
        const cardEl = document.getElementById('sw-card');
        if (cardEl) {
            const off = (dir === 'left' ? -1 : 1) * (window.innerWidth + 200);
            cardEl.style.transition = 'transform .3s ease, opacity .3s';
            cardEl.style.transform = `translate(${off}px,40px) rotate(${dir === 'left' ? -28 : 28}deg)`;
            cardEl.style.opacity = '0';
            cardEl.style.borderColor = ok ? '#22c55e' : '#ef4444';
        }
        if (ok) { _sw.correct++; _sw.streak++; _sw.best = Math.max(_sw.best, _sw.streak); _sw.score += 10 + Math.min(20, (_sw.streak - 1) * 2); }
        else { _sw.wrong++; _sw.streak = 0; }
        _flash(ok);
        const v = document.getElementById('sw-verdict');
        if (v) {
            if (ok) { v.style.color = '#4ade80'; v.textContent = pick(WIN) + (_sw.streak >= 3 ? ` 🔥×${_sw.streak}` : ' ✅'); }
            else { const correct = window.swipeRulersData.find(r => r.id === _sw.cur.correctId); v.style.color = '#f87171'; v.textContent = pick(FAIL) + ' Это ' + (correct ? correct.name : '') + ' ❌'; }
        }
        _sw.i++;
        _updateHeader();
        setTimeout(_nextCard, ok ? 430 : 820);
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
        const arena = document.getElementById('sw-arena'); if (!arena || !_sw) return;
        const acc = _sw.total ? Math.round(_sw.correct / _sw.total * 100) : 0;
        arena.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e2e8f0;text-align:center;gap:8px">
            <div style="font-size:54px">${acc >= 80 ? '🏆' : acc >= 50 ? '👍' : '📚'}</div>
            <div style="font-size:20px;font-weight:1000">Готово!</div>
            <div style="font-size:14px;opacity:.85">Верно ${_sw.correct} из ${_sw.total} · точность ${acc}%</div>
            <div style="font-size:13px;opacity:.7">Лучшая серия: 🔥 ${_sw.best} · очки: ${_sw.score}</div>
            <div style="display:flex;gap:10px;margin-top:14px">
                <button id="sw-again" style="background:#6366f1;color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">Заново</button>
                <button id="sw-exit" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:14px;padding:12px 22px;font-size:14px;font-weight:900;cursor:pointer">Выход</button>
            </div>
        </div>`;
        arena.querySelector('#sw-again').onclick = () => { window.closeSwipeMode(); window.openSwipeMode(); };
        arena.querySelector('#sw-exit').onclick = window.closeSwipeMode;
        _updateHeader();
    }
})();
