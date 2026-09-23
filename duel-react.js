// duel-react.js — реакции-эмодзи в дуэлях (все режимы: свайп, подбор, «Кто раньше»,
// «Датрис», классика). Пять готовых эмодзи и никакого текста: писать сопернику
// нельзя, значит и модерировать нечего.
//
// Кнопка 😊 видна, пока идёт матч (state.duel.active), и не зависит от режима:
// каждый режим рисует свой экран, а реакции — одни на всех. Отправка —
// window.sendDuelReaction (cloud-sync.js): эмодзи едет в объекте игрока вместе с
// последним счётом режима; приём — window.onDuelReaction из слушателя матча.
'use strict';

(function () {
    const EMOJI = ['😎', '🔥', '😱', '👏', '🤝'];
    const COOLDOWN_MS = 1200;
    const Z = 10008;
    let seen = { match: null, n: 0 }, lastSent = 0, open = false;

    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _pop() { try { const s = window.OrderSfx; if (s && s.tone) { s.tone(988, 0, 0.06, 'sine', 0.1); s.tone(1318.5, 0.05, 0.1, 'sine', 0.08); } } catch (e) {} }

    function _ui() {
        let el = document.getElementById('duel-react');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'duel-react';
        el.innerHTML = `<div class="dr-list">${EMOJI.map(e => `<button class="dr-e" data-e="${e}">${e}</button>`).join('')}</div><button class="dr-toggle" aria-label="Реакция">😊</button>`;
        document.body.appendChild(el);
        el.querySelector('.dr-toggle').onclick = () => { open = !open; el.classList.toggle('dr-open', open); _h('light'); };
        el.querySelectorAll('.dr-e').forEach(b => { b.onclick = () => _send(b.dataset.e, b); });
        return el;
    }

    function _send(e, btn) {
        const now = Date.now();
        if (now - lastSent < COOLDOWN_MS) return;
        if (!window.sendDuelReaction || !window.sendDuelReaction(e)) return;
        lastSent = now;
        _h('light');
        const r = btn.getBoundingClientRect();
        _float(e, r.left, r.top, 'dr-mine');
        open = false;
        const el = document.getElementById('duel-react');
        if (el) el.classList.remove('dr-open');
    }

    function _float(e, x, y, cls) {
        const f = document.createElement('div');
        f.className = 'dr-float ' + cls;
        f.textContent = e;
        f.style.left = x + 'px'; f.style.top = y + 'px';
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 1400);
    }

    // Приём: новая реакция соперника — крупно сверху с его именем.
    window.onDuelReaction = function (emo, name) {
        const d = window.state && window.state.duel;
        if (!emo || !d || !d.active) return;
        if (seen.match !== d.matchId) seen = { match: d.matchId, n: 0 };
        const n = Number(emo.n) || 0;
        if (n <= seen.n) return;
        seen.n = n;
        if (EMOJI.indexOf(emo.e) === -1) return; // только наши пять — чужое не рисуем
        const b = document.createElement('div');
        b.className = 'dr-in';
        b.innerHTML = `<span class="dr-in-e"></span><span class="dr-in-n"></span>`;
        b.querySelector('.dr-in-e').textContent = emo.e;
        b.querySelector('.dr-in-n').textContent = name || 'Соперник';
        document.body.appendChild(b);
        _pop(); _h('light');
        setTimeout(() => b.remove(), 1900);
    };

    // Видимость — по состоянию матча, раз в полсекунды: так кнопка сама появляется
    // в любом режиме и сама уходит на экране итога, без правок в каждом режиме.
    setInterval(() => {
        const active = !!(window.state && window.state.duel && window.state.duel.active);
        const el = document.getElementById('duel-react');
        if (active) _ui().classList.add('dr-on');
        else if (el) { el.classList.remove('dr-on', 'dr-open'); open = false; }
    }, 500);

    try {
        const st = document.createElement('style');
        st.textContent = `
#duel-react{position:fixed;right:6px;top:44%;z-index:${Z};display:none;flex-direction:column;align-items:center;gap:6px}
#duel-react.dr-on{display:flex}
.dr-toggle{width:42px;height:42px;border-radius:var(--r-full);border:2px solid #e5e7eb;background:rgba(255,255,255,.92);font-size:22px;line-height:1;cursor:pointer;box-shadow:var(--e-2)}
html.dark .dr-toggle{background:rgba(30,30,30,.92);border-color:#3f3f46}
.dr-list{display:none;flex-direction:column;gap:4px;padding:5px;border-radius:var(--r-full);background:rgba(255,255,255,.96);border:2px solid #e5e7eb;box-shadow:var(--e-2)}
html.dark .dr-list{background:rgba(30,30,30,.96);border-color:#3f3f46}
#duel-react.dr-open .dr-list{display:flex;animation:drIn .2s cubic-bezier(.2,.9,.3,1.3)}
.dr-e{width:40px;height:40px;border:none;background:none;font-size:24px;line-height:1;cursor:pointer;border-radius:var(--r-full)}
.dr-e:active{transform:scale(1.25)}
.dr-float{position:fixed;z-index:${Z};font-size:30px;pointer-events:none;animation:drUp 1.4s ease-out forwards}
.dr-in{position:fixed;left:50%;top:calc(96px + env(safe-area-inset-top));z-index:${Z};display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:drBig 1.9s cubic-bezier(.2,.9,.3,1.3) forwards}
.dr-in-e{font-size:64px;line-height:1}
.dr-in-n{margin-top:2px;padding:2px 10px;border-radius:var(--r-full);background:#f59e0b;color:#fff;font-size:12px;font-weight:900;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@keyframes drIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes drUp{0%{opacity:1;transform:none}100%{opacity:0;transform:translate(-40px,-160px) scale(1.4)}}
@keyframes drBig{0%{opacity:0;transform:translateX(-50%) scale(.3)}15%{opacity:1;transform:translateX(-50%) scale(1.15)}25%{transform:translateX(-50%) scale(1)}80%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-30px) scale(.9)}}
`;
        document.head.appendChild(st);
    } catch (e) {}
})();
