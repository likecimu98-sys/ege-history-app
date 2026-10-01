// tsar-mode.js — «Тиндер правителей»: годы правления и события по правителям.
//
// Перенесено 01.10.2026 из отдельного приложения «ЕГЭ-Тиндер Pro» (React-сборка без
// исходников; механика восстановлена по бандлу и сохранена как есть):
//   • колода: 4 правителя в работе, остальные ждут; правитель усвоен после трёх
//     удачных кругов подряд (ошибка в годах обнуляет его счёт);
//   • круг: сначала годы правления (4 варианта; со второго закрепления — «похожие»
//     даты ±8 лет), потом 2–4 события «это при нём?» — вперёд те, где ошибался, и
//     1–3 чужих события под видом ловушки;
//   • ошибка в годах — скример и «наказание»: трижды набрать верные годы по памяти,
//     после первого раза подсказка размывается;
//   • очки и комбо: годы 5 (+комбо/3), годы по памяти 10 (+комбо/2), событие 2 (+комбо/5);
//   • «Режим Смерть» после прохождения курса — годы только вводом по памяти.
// Отличия от оригинала: прогресс в state.stats.tsarTinder (синхронизируется как
// остальной прогресс), рейтинга нет (был в старом Firebase-проекте), вид — в стиле
// приложения, скример страшнее (звук и картинка), учтены «звук выкл.» и «меньше
// движения». Данные — tsar-data.js, грузятся при первом открытии.
'use strict';

(function () {
    const Z = 10006;
    const RELEASE = (() => { try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; } })();
    // Одно и то же событие у двух правителей: чужое из группы не подставляем ловушкой
    // тому, у кого есть своё (Судебник был и у Ивана III, и у Ивана IV).
    const SHARED = [
        ['Издание Судебника', 'Принятие Судебника'],
        ['Успешный поход на Византию', 'Поход на Византию (греческий огонь)'],
        ['Первый договор с Византией', 'Договор с Византией'],
    ];

    let _g = null;          // текущая сессия
    let _dataLoading = null;
    let _timer = null;
    let _lastAct = 0;

    // ── мелочи ──────────────────────────────────────────────────────────
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function shuffle(a) { const t = a.slice(); for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; } return t; }
    function sample(a, n) { return shuffle(a).slice(0, n); }
    function digits(s) { return String(s || '').replace(/[^0-9]/g, ''); }
    function fmtTime(sec) { const m = Math.floor(sec / 60), s = sec % 60; return m + ' мин ' + (s < 10 ? '0' : '') + s + ' с'; }
    function haptic(t) { try { if (typeof window.haptic === 'function') window.haptic(t); } catch (e) {} }
    function sfx(name) { try { if (window.Sfx && window.Sfx.play) window.Sfx.play(name); } catch (e) {} }
    function rulers() { return window.TSAR_DATA || []; }
    function byId(id) { return rulers().find(r => r.id === id); }
    // «Похожие» годы: та же длина, концы сдвинуты на ±8 (оригинальная cI).
    function closeYears(correct) {
        const m = String(correct).match(/(\d+)\s*-\s*(\d+)/);
        if (!m) return ['1000 - 1010', '1500 - 1510', '1800 - 1810'];
        const a = +m[1], b = +m[2], out = new Set();
        let guard = 0;
        while (out.size < 3 && guard++ < 200) {
            const c = a + Math.floor(Math.random() * 17) - 8, d = b + Math.floor(Math.random() * 17) - 8;
            if ((c === a && d === b) || c >= d) continue;
            out.add(c + ' - ' + d);
        }
        return [...out];
    }

    // ── прогресс ────────────────────────────────────────────────────────
    function prog() {
        const s = window.state && window.state.stats;
        if (!s) return { score: 0, cnt: {}, mastered: [], wrong: {}, attempts: 0, time: 0, death: false, at: 0 };
        const p = s.tsarTinder && typeof s.tsarTinder === 'object' ? s.tsarTinder : {};
        p.score = Number(p.score) || 0; p.cnt = p.cnt || {}; p.mastered = Array.isArray(p.mastered) ? p.mastered : [];
        p.wrong = p.wrong || {}; p.attempts = Number(p.attempts) || 0; p.time = Number(p.time) || 0; p.death = !!p.death;
        s.tsarTinder = p;
        return p;
    }
    let _saveT = null;
    function save() {
        const p = prog(); p.at = Date.now();
        clearTimeout(_saveT);
        _saveT = setTimeout(() => { try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {} }, 400);
    }
    function percent() {
        const p = prog(), n = rulers().length || 1;
        const sum = Object.values(p.cnt).reduce((x, v) => x + Math.min(Number(v) || 0, 3), 0);
        return Math.min(100, Math.round(sum / (n * 3) * 100));
    }

    // ── звук скримера ───────────────────────────────────────────────────
    // Оригинал — три пилы с падением тона. Здесь страшнее: удар, низкий гул с
    // перегрузом, «крик» — шум через узкий фильтр с рваной огибающей, и визг двух
    // расстроенных пил с вибрато, сползающий вниз. Всё через сатурацию и компрессор.
    let _ac = null;
    function screamSound() {
        try {
            if (window.Sfx && window.Sfx.isMuted && window.Sfx.isMuted()) return;
            if (localStorage.getItem('tt_scream_sound') === '0') return;
            const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
            _ac = _ac || new AC();
            const ac = _ac; if (ac.state === 'suspended') ac.resume();
            const t = ac.currentTime + 0.01, D = 1.6;
            const comp = ac.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6;
            const out = ac.createGain(); out.gain.value = 0.95; comp.connect(out); out.connect(ac.destination);
            const shaper = ac.createWaveShaper();
            const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 4); }
            shaper.curve = curve; shaper.connect(comp);
            const noiseBuf = (() => { const b = ac.createBuffer(1, ac.sampleRate * D, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
            // 1) удар
            const hit = ac.createBufferSource(); hit.buffer = noiseBuf;
            const hitLp = ac.createBiquadFilter(); hitLp.type = 'lowpass'; hitLp.frequency.value = 500;
            const hitG = ac.createGain(); hitG.gain.setValueAtTime(1.4, t); hitG.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            hit.connect(hitLp); hitLp.connect(hitG); hitG.connect(shaper); hit.start(t); hit.stop(t + 0.2);
            // 2) гул: падающий саб
            const sub = ac.createOscillator(); sub.type = 'sawtooth';
            sub.frequency.setValueAtTime(90, t); sub.frequency.exponentialRampToValueAtTime(28, t + D);
            const subG = ac.createGain(); subG.gain.setValueAtTime(0.0001, t); subG.gain.exponentialRampToValueAtTime(0.9, t + 0.05); subG.gain.exponentialRampToValueAtTime(0.001, t + D);
            sub.connect(subG); subG.connect(shaper); sub.start(t); sub.stop(t + D);
            // 3) крик: шум через узкий полосовой с «воплем» тона и дрожанием громкости
            const cry = ac.createBufferSource(); cry.buffer = noiseBuf;
            const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9;
            bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2900, t + 0.35); bp.frequency.exponentialRampToValueAtTime(650, t + D);
            const cryG = ac.createGain(); cryG.gain.setValueAtTime(0.0001, t); cryG.gain.exponentialRampToValueAtTime(2.2, t + 0.04); cryG.gain.exponentialRampToValueAtTime(0.001, t + D);
            const trem = ac.createOscillator(); trem.frequency.value = 31; const tremG = ac.createGain(); tremG.gain.value = 0.9;
            trem.connect(tremG); tremG.connect(cryG.gain);
            cry.connect(bp); bp.connect(cryG); cryG.connect(shaper); cry.start(t); cry.stop(t + D); trem.start(t); trem.stop(t + D);
            // 4) визг: две расстроенные пилы с вибрато, сползают вниз
            [1180, 1247].forEach(f0 => {
                const o = ac.createOscillator(); o.type = 'sawtooth';
                o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.22, t + D);
                const vib = ac.createOscillator(); vib.frequency.value = 11; const vibG = ac.createGain(); vibG.gain.value = 70;
                vib.connect(vibG); vibG.connect(o.frequency);
                const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
                const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + D);
                o.connect(hp); hp.connect(g); g.connect(shaper); o.start(t); o.stop(t + D); vib.start(t); vib.stop(t + D);
            });
        } catch (e) { console.warn('[tsar] scream sound', e); }
    }

    // ── картинка скримера ───────────────────────────────────────────────
    // Лицо во весь экран: бледный вытянутый череп, пустые глазницы с красными
    // зрачками, разорванный рот; рывок навстречу, тряска, помехи, две вспышки.
    // Вспышек ровно две и не чаще 3 в секунду — без стробоскопа; при «меньше
    // движения» — только неподвижная картинка.
    const FACE = '<svg class="tt-face" viewBox="0 0 200 250" aria-hidden="true">' +
        '<defs><radialGradient id="ttSkin" cx="50%" cy="36%" r="68%"><stop offset="0" stop-color="#d6cdb9"/><stop offset=".5" stop-color="#8f8270"/><stop offset=".85" stop-color="#3a2f27"/><stop offset="1" stop-color="#0d0806"/></radialGradient>' +
        '<filter id="ttBlur"><feGaussianBlur stdDeviation="4"/></filter><filter id="ttGlow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>' +
        '<path d="M100 4C52 4 26 46 26 100c0 32 8 50 18 70 12 26 28 66 56 76 28-10 44-50 56-76 10-20 18-38 18-70C174 46 148 4 100 4z" fill="url(#ttSkin)"/>' +
        '<g filter="url(#ttBlur)" opacity=".55"><ellipse cx="52" cy="156" rx="14" ry="30" fill="#1d140f"/><ellipse cx="148" cy="156" rx="14" ry="30" fill="#1d140f"/><ellipse cx="100" cy="40" rx="40" ry="14" fill="#fff" opacity=".25"/></g>' +
        '<path d="M60 34l12 20-5 16 9 10M146 40l-9 18 7 14M100 6v18l-7 12 5 9" stroke="#2a1f19" stroke-width="1.4" fill="none" opacity=".8"/>' +
        '<path d="M40 94c4-22 38-26 52-6 6 12-2 36-22 38-20 2-32-14-30-32z" fill="#050202"/>' +
        '<path d="M108 88c10-20 46-18 54 4 4 20-10 36-30 34-18-2-28-20-24-38z" fill="#050202"/>' +
        '<g filter="url(#ttGlow)"><circle cx="66" cy="104" r="5" fill="#ff1010"/><circle cx="136" cy="104" r="5" fill="#ff1010"/></g>' +
        '<circle class="tt-pupil" cx="66" cy="104" r="2.2" fill="#fff3d6"/><circle class="tt-pupil" cx="136" cy="104" r="2.2" fill="#fff3d6"/>' +
        '<path d="M62 126c-2 14 4 22 0 40 M70 125c2 10-2 18 1 28 M134 126c2 16-4 24 0 44 M142 124c-1 10 3 16 0 26" stroke="#6e0000" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<circle cx="62" cy="168" r="2.6" fill="#6e0000"/><circle cx="134" cy="172" r="2.6" fill="#6e0000"/>' +
        '<path d="M93 136l-4 13M107 136l4 13" stroke="#140906" stroke-width="3.4" stroke-linecap="round"/>' +
        '<path d="M58 176c22-10 62-10 84 0-4 34-20 56-42 58-22-2-38-24-42-58z" fill="#090202" stroke="#4a0000" stroke-width="2.4"/>' +
        '<path d="M66 178 L70 192 L74 179ZM74 178 L78 200 L82 179ZM82 178 L86 190 L90 179ZM90 178 L94 204 L98 179ZM98 178 L102 196 L106 179ZM106 178 L110 202 L114 179ZM114 178 L118 189 L122 179ZM122 178 L126 198 L130 179ZM130 178 L134 193 L138 179Z" fill="#d8ceb6" stroke="#2a1f19" stroke-width=".8"/>' +
        '<path d="M72 229 L76 219 L80 228ZM80 229 L84 213 L88 228ZM88 229 L92 220 L96 228ZM96 229 L100 211 L104 228ZM104 229 L108 217 L112 228ZM112 229 L116 212 L120 228ZM120 229 L124 220 L128 228ZM128 229 L132 216 L136 228Z" fill="#cfc4aa" stroke="#2a1f19" stroke-width=".8"/>' +
        '<path d="M96 190c-3 14 2 24-1 36" stroke="#5a0000" stroke-width="2.4" fill="none"/>' +
        '</svg>';
    function scream() {
        screamSound();
        haptic('error');
        try { if (navigator.vibrate) navigator.vibrate([260, 70, 380]); } catch (e) {}
        const old = document.getElementById('tt-scream'); if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'tt-scream';
        el.innerHTML = '<div class="tt-noise"></div>' + FACE + '<div class="tt-scream-txt">' + esc(_g && _g.explain ? _g.explain.title : 'Неверно') + '</div>';
        document.body.appendChild(el);
        setTimeout(() => { el.classList.add('is-out'); }, 1250);
        setTimeout(() => { el.remove(); }, 1650);
    }

    // ── игра ────────────────────────────────────────────────────────────
    function startDeck(reset) {
        const p = prog();
        if (reset) { p.score = 0; p.cnt = {}; p.mastered = []; p.wrong = {}; p.attempts = 0; p.time = 0; }
        p.death = false;
        const left = shuffle(rulers().filter(r => !p.mastered.includes(r.id)));
        _g.active = left.slice(0, 4); _g.queue = left.slice(4); _g.combo = 0; _g.cur = null;
        save();
        nextRuler();
    }
    function startDeath() {
        const p = prog();
        p.score = 0; p.cnt = {}; p.mastered = []; p.wrong = {}; p.death = true;
        const all = shuffle(rulers());
        _g.active = all.slice(0, 4); _g.queue = all.slice(4); _g.combo = 0; _g.cur = null;
        save();
        nextRuler();
    }
    function nextRuler() {
        const p = prog();
        if (!_g.active.length) {
            if (!_g.queue.length) { _g.screen = 'result'; return render(); }
            _g.active = _g.queue.slice(0, 4); _g.queue = _g.queue.slice(4);
        }
        let r = _g.active[Math.floor(Math.random() * _g.active.length)];
        if (_g.active.length > 1 && _g.cur && r.id === _g.cur.id) r = _g.active.find(x => x.id !== _g.cur.id) || r;
        _g.cur = r; _g.yearFail = false; _g.typed = ''; _g.penance = 0; _g.penanceInput = '';
        _g.yearOpts = ((Number(p.cnt[r.id]) || 0) >= 2 && !p.death)
            ? shuffle([r.correctYears, ...closeYears(r.correctYears)])
            : shuffle([r.correctYears, ...sample(r.wrongYears, 3)]);
        // события: сперва те, где ошибался, затем 2–4 случайных своих, затем 1–3 чужих-ловушки
        const own = r.events, wrongBefore = p.wrong[r.id] || [], picked = [], used = new Set();
        wrongBefore.forEach(text => { const e = own.find(x => x.text === text); if (e && !used.has(e.text)) { picked.push(e); used.add(e.text); } });
        sample(own.filter(e => !used.has(e.text)), Math.floor(Math.random() * 3) + 2).forEach(e => { picked.push(e); used.add(e.text); });
        const blocked = new Set();
        SHARED.forEach(group => { if (group.some(t => own.some(e => e.isTrue && e.text === t))) group.forEach(t => blocked.add(t)); });
        let need = Math.floor(Math.random() * 3) + 1, guard = 0;
        const all = rulers();
        while (need > 0 && guard++ < 60) {
            const o = all[Math.floor(Math.random() * all.length)];
            if (o.id === r.id) continue;
            const trues = o.events.filter(e => e.isTrue && !blocked.has(e.text) && !used.has(e.text));
            if (!trues.length) continue;
            const e = trues[Math.floor(Math.random() * trues.length)];
            picked.push({ text: e.text, isTrue: false, explanation: 'Нет, это было в другое время. Правитель: ' + o.name + ' (' + o.correctYears + ').' });
            used.add(e.text); need--;
        }
        _g.events = shuffle(picked); _g.ei = 0;
        _g.screen = 'years';
        render();
    }
    function yearWrong(title, text) {
        const p = prog();
        _g.yearFail = true; _g.combo = 0; _g.penance = 0; _g.penanceInput = '';
        _g.explain = { title, text, isYear: true };
        _g.screen = 'penance';
        p.attempts++; save();
        render();
        scream();
    }
    function chooseYear(opt) {
        const p = prog();
        if (opt === _g.cur.correctYears) {
            p.attempts++; p.score += 5 + Math.floor(_g.combo / 3); _g.combo++; save();
            sfx('wow'); haptic('success');
            _g.screen = 'events'; render();
        } else yearWrong('Неверный год', 'Правильно: ' + _g.cur.correctYears);
    }
    function typedYear() {
        const p = prog();
        const a = digits(_g.typed), b = digits(_g.cur.correctYears);
        if (a && a === b) {
            p.attempts++; p.score += 10 + Math.floor(_g.combo / 2); _g.combo++; save();
            sfx('wow'); haptic('success');
            _g.screen = 'events'; render();
        } else yearWrong('Фатальная ошибка', 'Ты забыл: ' + _g.cur.correctYears);
    }
    function penanceSubmit() {
        const a = digits(_g.penanceInput), b = digits(_g.cur.correctYears);
        if (a && a === b) {
            if (_g.penance >= 2) { _g.penance = 0; _g.penanceInput = ''; _g.screen = 'events'; return render(); }
            _g.penance++; _g.penanceInput = ''; haptic('success'); render();
        } else {
            _g.penance = 0; _g.penanceInput = ''; render(); scream();
        }
    }
    function answerEvent(guess) {
        const p = prog(), e = _g.events[_g.ei];
        p.attempts++;
        if (e.isTrue === guess) {
            p.score += 2 + Math.floor(_g.combo / 5); _g.combo++; save();
            haptic('light');
            nextEvent();
        } else {
            _g.combo = 0;
            const list = p.wrong[_g.cur.id] || [];
            if (!list.includes(e.text)) p.wrong[_g.cur.id] = list.concat(e.text);
            save();
            sfx('fah'); haptic('error');
            _g.explain = { title: e.isTrue ? 'Это было при нём' : 'Это не при нём', text: e.explanation, isYear: false };
            _g.screen = 'explain'; render();
        }
    }
    function nextEvent() {
        if (_g.ei < _g.events.length - 1) { _g.ei++; _g.screen = 'events'; render(); }
        else finishRuler();
    }
    function finishRuler() {
        const p = prog(), id = _g.cur.id;
        if (_g.yearFail) p.cnt[id] = 0;
        else {
            const n = (Number(p.cnt[id]) || 0) + 1; p.cnt[id] = n;
            if (n >= 3) {
                _g.active = _g.active.filter(r => r.id !== id);
                if (!p.mastered.includes(id)) p.mastered.push(id);
                if (_g.queue.length) { _g.active.push(_g.queue[0]); _g.queue = _g.queue.slice(1); }
            }
        }
        save();
        _g.screen = 'summary'; render();
    }

    // ── отрисовка ───────────────────────────────────────────────────────
    function dots(n) { return '<span class="tt-dots">' + [1, 2, 3].map(i => '<i class="' + (n >= i ? 'on' : '') + '"></i>').join('') + '</span>'; }
    const ICO = {
        x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
        ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
        back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
        heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12.57L12 20l-7.5-7.43A5 5 0 1 1 12 6.01a5 5 0 1 1 7.5 6.56z"/></svg>',
        bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3v7h6l-8 11v-7H5l8-11"/></svg>',
        eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M21 12c-2.4 4-5.4 6-9 6s-6.6-2-9-6c2.4-4 5.4-6 9-6s6.6 2 9 6"/></svg>',
        repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12V9a3 3 0 0 1 3-3h13l-3-3M20 12v3a3 3 0 0 1-3 3H4l3 3"/></svg>',
    };
    function shell(inner, opts) {
        const o = opts || {};
        return '<div class="tt-top"><button class="tt-back" data-tt="' + (o.back || 'close') + '">' + ICO.back + (o.backLabel || 'Выйти') + '</button><div class="tt-title">Тиндер правителей</div><span class="tt-sp"></span></div>' +
            '<div class="tt-body' + (o.dark ? ' is-dark' : '') + '"><div class="tt-col">' + inner + '</div></div>';
    }
    function homeHtml() {
        const p = prog(), total = rulers().length, started = p.mastered.length > 0 || p.score > 0;
        const tabs = '<div class="tt-tabs"><button class="tt-tab" aria-selected="' + (_g.tab !== 'progress') + '" data-tt="tab" data-v="main">Главная</button><button class="tt-tab" aria-selected="' + (_g.tab === 'progress') + '" data-tt="tab" data-v="progress">Прогресс</button></div>';
        if (_g.tab === 'progress') {
            const list = rulers().map(r => {
                const n = Number(p.cnt[r.id]) || 0, done = p.mastered.includes(r.id);
                return '<div class="tt-row' + (done ? ' is-done' : '') + '"><span class="tt-ava">' + esc(r.avatar) + '</span><span class="tt-row-t"><b>' + esc(r.name) + '</b><i>' + esc(r.correctYears) + '</i></span>' + dots(done ? 3 : n) + '</div>';
            }).join('');
            return tabs + '<div class="tt-stats"><div><b>' + p.mastered.length + '<small> из ' + total + '</small></b><span>выучено</span></div><div><b>' + p.score + '</b><span>очков</span></div><div><b>' + fmtTime(p.time) + '</b><span>в тренажёре</span></div></div><div class="tt-list">' + list + '</div>';
        }
        const sound = localStorage.getItem('tt_scream_sound') !== '0';
        return tabs +
            '<div class="tt-hero"><div class="tt-hero-ava">👑</div><h2>Тиндер правителей</h2><p>Знакомься с правителями: угадай годы правления и реши, что было при нём, а что — нет.</p></div>' +
            '<div class="tt-rules">' +
            '<div>' + ICO.repeat + '<span><b>Трижды каждого.</b> После трёх верных кругов правитель выучен.</span></div>' +
            '<div>' + ICO.bolt + '<span><b>Дальше хитрее.</b> Похожие даты вместо явных и чужие события-ловушки.</span></div>' +
            '<div>' + ICO.eye + '<span><b>Ошибся в годах — скример.</b> И трижды напишешь годы по памяти.</span></div>' +
            '</div>' +
            '<label class="tt-check"><input type="checkbox" data-tt="sound"' + (sound ? ' checked' : '') + '> Звук скримера</label>' +
            (p.mastered.length >= total
                ? '<button class="tt-btn is-primary" data-tt="result">Курс пройден — что дальше</button>'
                : started
                    ? '<button class="tt-btn is-primary" data-tt="start">Продолжить · ' + p.score + ' очков</button><button class="tt-btn" data-tt="reset">Сбросить прогресс</button>'
                    : '<button class="tt-btn is-primary" data-tt="start">Начать</button>');
    }
    function cardHead() {
        const p = prog(), r = _g.cur, n = Number(p.cnt[r.id]) || 0;
        const bar = p.death
            ? '<div class="tt-meta"><span class="tt-death">Режим Смерть</span>'
            : '<div class="tt-meta"><span>Прогресс ' + percent() + '%</span>';
        return bar + '<span class="tt-chip' + (_g.combo > 2 ? ' is-hot' : '') + '">' + ICO.bolt + 'Комбо ×' + _g.combo + '</span><span class="tt-chip">' + p.score + '</span></div>' +
            '<div class="tt-bar"><i style="width:' + (p.death ? 100 : percent()) + '%"' + (p.death ? ' class="is-death"' : '') + '></i></div>' +
            '<div class="tt-profile' + (p.death ? ' is-death' : '') + '"><div class="tt-big-ava">' + esc(r.avatar) + '</div><h2>' + esc(r.name) + '</h2><p>«' + esc(r.status) + '»</p>' + dots(n) + '</div>';
    }
    function gameHtml() {
        const p = prog();
        if (_g.screen === 'years') {
            if (p.death) return cardHead() + '<div class="tt-phase"><h3>Напиши годы правления по памяти</h3><p class="tt-hint">например: 1894 - 1917</p>' +
                '<input class="tt-input" id="tt-typed" inputmode="numeric" autocomplete="off" placeholder="ГГГГ - ГГГГ" value="' + esc(_g.typed) + '"><button class="tt-btn is-danger" data-tt="typed">Ответить</button></div>';
            return cardHead() + '<div class="tt-phase"><h3>Годы правления</h3><div class="tt-opts">' +
                _g.yearOpts.map((o, i) => '<button class="tt-opt" data-tt="year" data-v="' + esc(o) + '"><span class="k">' + (i + 1) + '</span>' + esc(o) + '</button>').join('') + '</div></div>';
        }
        if (_g.screen === 'events') {
            const e = _g.events[_g.ei];
            return cardHead() + '<div class="tt-phase"><div class="tt-count">Факт ' + (_g.ei + 1) + ' из ' + _g.events.length + '</div>' +
                '<div class="tt-fact" id="tt-fact"><span>' + esc(e.text) + '</span><em class="tt-stamp no">Не при нём</em><em class="tt-stamp yes">При нём</em></div>' +
                '<div class="tt-swipe"><button class="tt-round no" data-tt="ev" data-v="0" aria-label="Не при нём">' + ICO.x + '</button><span>Это при нём?<br><small>свайпни карточку</small></span><button class="tt-round yes" data-tt="ev" data-v="1" aria-label="При нём">' + ICO.heart + '</button></div></div>';
        }
        if (_g.screen === 'explain') {
            return '<div class="tt-explain"><h2>' + esc(_g.explain.title) + '</h2><p>' + esc(_g.explain.text) + '</p><button class="tt-btn is-primary" data-tt="explained">Понял, дальше</button></div>';
        }
        if (_g.screen === 'summary') {
            const r = _g.cur, n = Number(p.cnt[r.id]) || 0, ok = !_g.yearFail;
            const msg = ok ? (n >= 3 ? 'Идеально, 3 из 3 — правитель выучен.' : n === 2 ? 'Закреплено 2 из 3. Впереди проверка похожими датами.' : 'Закреплено 1 из 3. Правитель вернётся на повтор.')
                : 'Ошибка в годах — счёт этого правителя обнулён. Он вернётся на пересдачу.';
            return '<div class="tt-summary ' + (ok ? 'is-ok' : 'is-bad') + '"><div class="tt-big-ava">' + esc(r.avatar) + '</div><h2>' + esc(r.name) + '</h2>' +
                '<b>' + (ok ? 'Годы верны' : 'Память стёрта') + '</b><p>' + msg + '</p>' + dots(n) +
                '<div class="tt-row-btns"><button class="tt-btn is-primary" data-tt="next">Дальше</button><button class="tt-btn" data-tt="home">Меню</button></div></div>';
        }
        return '';
    }
    function penanceHtml() {
        const left = 3 - _g.penance;
        return '<div class="tt-pen"><div class="tt-pen-eye">' + FACE + '</div><h2 class="tt-glitch" data-t="' + esc(_g.explain.title) + '">' + esc(_g.explain.title) + '</h2>' +
            '<div class="tt-pen-ans' + (_g.penance > 0 ? ' is-hidden' : '') + '">' + esc(_g.explain.text) + (_g.penance > 0 ? '<span>введи по памяти</span>' : '') + '</div>' +
            '<p>Напиши верные годы ещё ' + left + ' ' + (left === 1 ? 'раз' : 'раза') + ', чтобы выжить</p>' +
            '<div class="tt-pen-dots">' + [0, 1, 2].map(i => '<i class="' + (i < _g.penance ? 'on' : '') + '"></i>').join('') + '</div>' +
            '<input class="tt-input is-blood" id="tt-pen" inputmode="numeric" autocomplete="off" placeholder="ГГГГ - ГГГГ" value="' + esc(_g.penanceInput) + '">' +
            '<button class="tt-btn is-blood" data-tt="penance">Ввести</button></div>';
    }
    function resultHtml() {
        const p = prog();
        if (p.death) return '<div class="tt-explain is-gold"><div class="tt-big-ava">👑</div><h2>Абсолютный чемпион</h2><p>Ты прошёл Режим Смерть: годы всех правителей — по памяти.</p><b class="tt-score">' + p.score + ' очков</b><button class="tt-btn" data-tt="home">В меню</button></div>';
        return '<div class="tt-explain"><div class="tt-big-ava">🎓</div><h2>Курс пройден</h2><p>Все правители закреплены трижды. Готов к настоящему испытанию? В Режиме Смерть годы правления вводятся только по памяти.</p>' +
            '<button class="tt-btn is-danger" data-tt="death">Включить Режим Смерть</button><button class="tt-btn" data-tt="home">В меню</button></div>';
    }
    function render() {
        const ov = document.getElementById('tt-overlay'); if (!ov || !_g) return;
        let inner, dark = false, back = 'home', backLabel = 'Меню';
        if (_g.screen === 'home') { inner = homeHtml(); back = 'close'; backLabel = 'Выйти'; }
        else if (_g.screen === 'penance') { inner = penanceHtml(); dark = true; }
        else if (_g.screen === 'result') inner = resultHtml();
        else inner = gameHtml();
        ov.className = dark ? 'is-dark' : '';
        ov.innerHTML = shell(inner, { back, backLabel, dark });
        const focusId = _g.screen === 'penance' ? 'tt-pen' : (_g.screen === 'years' && prog().death ? 'tt-typed' : null);
        if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }
        if (_g.screen === 'events') wireSwipe();
    }

    // Свайп карточки факта: вправо — «при нём», влево — «не при нём» (как в Тиндере).
    function wireSwipe() {
        const card = document.getElementById('tt-fact'); if (!card) return;
        let x0 = null, dx = 0, id = null;
        card.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; id = e.pointerId; card.setPointerCapture(id); card.classList.add('is-drag'); });
        card.addEventListener('pointermove', e => {
            if (x0 == null || e.pointerId !== id) return;
            dx = e.clientX - x0;
            card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 18) + 'deg)';
            card.classList.toggle('lean-yes', dx > 40); card.classList.toggle('lean-no', dx < -40);
        });
        const end = () => {
            if (x0 == null) return;
            card.classList.remove('is-drag');
            if (Math.abs(dx) > 90) { card.classList.add(dx > 0 ? 'fly-yes' : 'fly-no'); const g = dx > 0; setTimeout(() => answerEvent(g), 160); }
            else { card.style.transform = ''; card.classList.remove('lean-yes', 'lean-no'); }
            x0 = null;
        };
        card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
    }

    function onClick(e) {
        const b = e.target.closest('[data-tt]'); if (!b || !_g) return;
        _lastAct = Date.now();
        const a = b.dataset.tt, v = b.dataset.v;
        if (a === 'sound') { try { localStorage.setItem('tt_scream_sound', b.checked ? '1' : '0'); } catch (x) {} return; }
        if (a === 'close') return window.closeTsarMode();
        if (a === 'home') { _g.screen = 'home'; return render(); }
        if (a === 'tab') { _g.tab = v; return render(); }
        if (a === 'start') return startDeck(false);
        if (a === 'reset') {
            const go = () => startDeck(true);
            if (typeof uiConfirm === 'function') uiConfirm('Сбросить весь прогресс «Тиндера правителей»? Очки и выученные правители обнулятся.', go);
            else if (confirm('Сбросить весь прогресс?')) go();
            return;
        }
        if (a === 'result') { _g.screen = 'result'; return render(); }
        if (a === 'death') return startDeath();
        if (a === 'year') return chooseYear(v);
        if (a === 'typed') { const i = document.getElementById('tt-typed'); _g.typed = i ? i.value : ''; return typedYear(); }
        if (a === 'penance') { const i = document.getElementById('tt-pen'); _g.penanceInput = i ? i.value : ''; return penanceSubmit(); }
        if (a === 'ev') return answerEvent(v === '1');
        if (a === 'explained') return nextEvent();
        if (a === 'next') return nextRuler();
    }
    function onKey(e) {
        if (!_g) return;
        _lastAct = Date.now();
        if (e.key === 'Escape') { e.preventDefault(); return _g.screen === 'home' ? window.closeTsarMode() : (_g.screen = 'home', render()); }
        if (_g.screen === 'years' && !prog().death && /^[1-4]$/.test(e.key)) { e.preventDefault(); return chooseYear(_g.yearOpts[+e.key - 1]); }
        if (_g.screen === 'events' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); return answerEvent(e.key === 'ArrowRight'); }
        if (e.key === 'Enter') {
            if (_g.screen === 'penance') { e.preventDefault(); const i = document.getElementById('tt-pen'); _g.penanceInput = i ? i.value : ''; return penanceSubmit(); }
            if (_g.screen === 'years' && prog().death) { e.preventDefault(); const i = document.getElementById('tt-typed'); _g.typed = i ? i.value : ''; return typedYear(); }
            if (_g.screen === 'explain') { e.preventDefault(); return nextEvent(); }
            if (_g.screen === 'summary') { e.preventDefault(); return nextRuler(); }
        }
    }
    // Годы по памяти — без вставки: иначе «наказание» и Режим Смерть проходятся копипастой.
    function noPaste(e) { if (e.target && (e.target.id === 'tt-pen' || e.target.id === 'tt-typed')) e.preventDefault(); }

    function loadData() {
        if (window.TSAR_DATA) return Promise.resolve(true);
        if (_dataLoading) return _dataLoading;
        _dataLoading = new Promise(resolve => {
            const s = document.createElement('script');
            s.src = 'tsar-data.js' + (RELEASE ? '?v=' + encodeURIComponent(RELEASE) : '');
            s.onload = () => resolve(!!window.TSAR_DATA);
            s.onerror = () => { s.remove(); _dataLoading = null; resolve(false); };
            document.body.appendChild(s);
        });
        return _dataLoading;
    }

    window.openTsarMode = async function () {
        if (window.canSolveMore) {
            const lim = window.canSolveMore();
            if (!lim.ok) { if (window.showDailyLimitModal) window.showDailyLimitModal(); return; }
        }
        const ok = await loadData();
        if (!ok || !rulers().length) {
            if (typeof showToast === 'function') showToast('👑', 'Тренажёр не загрузился — проверь интернет', 'bg-amber-500', 'border-amber-700');
            return;
        }
        _css();
        let ov = document.getElementById('tt-overlay');
        if (!ov) {
            ov = document.createElement('div'); ov.id = 'tt-overlay';
            ov.addEventListener('click', onClick);
            ov.addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.tt === 'sound') onClick(e); });
            ov.addEventListener('paste', noPaste, true); ov.addEventListener('drop', noPaste, true);
            ov.addEventListener('input', e => { if (e.target.id === 'tt-pen' && _g) _g.penanceInput = e.target.value; if (e.target.id === 'tt-typed' && _g) _g.typed = e.target.value; });
            document.body.appendChild(ov);
        }
        _g = { screen: 'home', tab: 'main', active: [], queue: [], combo: 0 };
        _lastAct = Date.now();
        document.addEventListener('keydown', onKey, true);
        clearInterval(_timer);
        // Время в тренажёре — только пока ученик что-то делает (как в оригинале: 30 с тишины — пауза).
        _timer = setInterval(() => { if (_g && Date.now() - _lastAct < 30000 && _g.screen !== 'home') { prog().time++; } }, 1000);
        ov.addEventListener('pointerdown', () => { _lastAct = Date.now(); });
        try { if (window.pushBackHandler) window.pushBackHandler('tsar-mode', () => window.closeTsarMode()); } catch (e) {}
        render();
    };
    window.closeTsarMode = function () {
        const ov = document.getElementById('tt-overlay'); if (ov) ov.remove();
        const sc = document.getElementById('tt-scream'); if (sc) sc.remove();
        document.removeEventListener('keydown', onKey, true);
        clearInterval(_timer); _timer = null;
        if (_g) save();
        _g = null;
        try { if (window.popBackHandler) window.popBackHandler('tsar-mode'); } catch (e) {}
    };

    function _css() {
        if (document.getElementById('tt-style')) return;
        const st = document.createElement('style'); st.id = 'tt-style';
        st.textContent = `
#tt-overlay{position:fixed;inset:0;z-index:${Z};display:flex;flex-direction:column;background:var(--c-bg);color:var(--c-text);font-family:inherit}
#tt-overlay *{box-sizing:border-box}
#tt-overlay svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
#tt-overlay.is-dark{background:#070303;color:#f5d0d0}
.tt-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;border-bottom:1px solid var(--c-border);background:var(--c-card)}
#tt-overlay.is-dark .tt-top{background:#0c0505;border-color:#3a0d0d}
.tt-back{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:var(--c-muted-2);font-weight:650;font-size:var(--t-label);cursor:pointer;padding:8px 6px;border-radius:var(--r-sm)}
.tt-title{font-weight:750;font-size:var(--t-label)}
.tt-sp{flex:1}
.tt-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.tt-col{max-width:480px;margin:0 auto;padding:16px 16px calc(28px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:12px}
.tt-tabs{display:flex;gap:20px;border-bottom:1px solid var(--c-border)}
.tt-tab{border:0;background:none;padding:10px 0;border-bottom:2px solid transparent;font-weight:650;font-size:var(--t-label);color:var(--c-muted-2);cursor:pointer}
.tt-tab[aria-selected="true"]{color:var(--c-text);border-bottom-color:var(--c-brand)}
.tt-hero{text-align:center;padding:12px 0 4px}
.tt-hero-ava{font-size:52px;line-height:1}
.tt-hero h2{margin:8px 0 4px;font-size:22px;font-weight:800;letter-spacing:-.01em}
.tt-hero p{margin:0;color:var(--c-muted-2);font-size:var(--t-label)}
.tt-rules{display:flex;flex-direction:column;gap:10px;background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);padding:14px}
.tt-rules>div{display:flex;gap:10px;align-items:flex-start;font-size:var(--t-label);line-height:1.4;color:var(--c-text-soft)}
.tt-rules svg{color:var(--c-brand);margin-top:1px}
.tt-rules b{color:var(--c-text)}
.tt-check{display:flex;align-items:center;gap:8px;font-size:var(--t-label);color:var(--c-muted-2);cursor:pointer}
.tt-btn{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:var(--r-sm);border:1px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);font-size:var(--t-body);font-weight:700;cursor:pointer;transition:transform .12s ease;width:100%}
.tt-btn:active{transform:scale(.98)}
.tt-btn.is-primary{background:var(--c-brand);border-color:var(--c-brand);color:#fff}
.tt-btn.is-danger{background:#b91c1c;border-color:#b91c1c;color:#fff}
.tt-btn.is-blood{background:#8b0000;border-color:#ff1f1f;color:#fff;letter-spacing:.06em;text-transform:uppercase;font-weight:800}
.tt-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tt-stats>div{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-sm);padding:10px;text-align:center}
.tt-stats b{display:block;font-size:var(--t-title);font-weight:800;font-variant-numeric:tabular-nums}
.tt-stats small{font-size:var(--t-caption);color:var(--c-muted-2);font-weight:600}
.tt-stats span{font-size:var(--t-caption);color:var(--c-muted-2)}
.tt-list{display:flex;flex-direction:column;background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);overflow:hidden}
.tt-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--c-border)}
.tt-row:first-child{border-top:0}
.tt-row.is-done{background:color-mix(in srgb,var(--c-success) 8%,var(--c-card))}
.tt-ava{font-size:26px;width:44px;text-align:center;flex:0 0 auto}
.tt-row-t{flex:1;min-width:0;display:flex;flex-direction:column}
.tt-row-t b{font-weight:650;font-size:var(--t-label)}
.tt-row-t i{font-style:normal;font-size:var(--t-caption);color:var(--c-muted-2);font-variant-numeric:tabular-nums}
.tt-dots{display:inline-flex;gap:5px}
.tt-dots i{width:10px;height:10px;border-radius:var(--r-full);background:var(--c-border-2)}
.tt-dots i.on{background:var(--c-success)}
.tt-meta{display:flex;align-items:center;gap:8px;font-size:var(--t-caption);font-weight:650;color:var(--c-muted-2)}
.tt-meta>span:first-child{flex:1}
.tt-death{color:#b91c1c;font-weight:800}
.tt-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:var(--r-full);background:var(--c-card);border:1px solid var(--c-border);color:var(--c-text);font-variant-numeric:tabular-nums}
.tt-chip svg{width:14px;height:14px}
.tt-chip.is-hot{background:#fff7ed;border-color:#fdba74;color:#c2410c}
.dark .tt-chip.is-hot{background:rgba(245,158,11,.16);color:#fdba74;border-color:rgba(245,158,11,.4)}
.tt-bar{height:6px;background:var(--c-card-2);border-radius:var(--r-full);overflow:hidden}
.dark .tt-bar{background:var(--c-border)}
.tt-bar i{display:block;height:100%;background:var(--c-brand);border-radius:var(--r-full);transition:width .4s ease}
.tt-bar i.is-death{background:#b91c1c}
.tt-profile{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);padding:18px 16px 14px;text-align:center;box-shadow:var(--e-1)}
.tt-profile.is-death{border-color:#b91c1c}
.tt-big-ava{font-size:60px;line-height:1.05}
.tt-profile h2,.tt-summary h2,.tt-explain h2{margin:6px 0 4px;font-size:var(--t-title);font-weight:800}
.tt-profile p{margin:0 0 10px;font-size:var(--t-label);font-style:italic;color:var(--c-muted-2);line-height:1.4}
.tt-phase{display:flex;flex-direction:column;gap:10px}
.tt-phase h3{margin:4px 0 0;text-align:center;font-size:var(--t-label);font-weight:700;color:var(--c-muted-2)}
.tt-hint{margin:-6px 0 0;text-align:center;font-size:var(--t-caption);color:var(--c-muted-2)}
.tt-opts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tt-opt{position:relative;min-height:58px;border:1px solid var(--c-border-2);border-radius:var(--r-md);background:var(--c-card);color:var(--c-text);font-size:18px;font-weight:750;font-variant-numeric:tabular-nums;cursor:pointer;transition:border-color .15s ease,transform .1s ease}
.tt-opt:hover{border-color:var(--c-brand)}
.tt-opt:active{transform:scale(.97)}
.tt-opt .k{position:absolute;top:5px;left:8px;font-size:11px;font-weight:700;color:var(--c-muted-2)}
.tt-input{width:100%;min-height:54px;border:1px solid var(--c-border-2);border-radius:var(--r-md);background:var(--c-card);color:var(--c-text);text-align:center;font-size:22px;font-weight:800;letter-spacing:.04em;outline:none}
.tt-input:focus{border-color:var(--c-brand)}
.tt-count{text-align:center;font-size:var(--t-micro);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--c-muted-2)}
.tt-fact{position:relative;min-height:130px;display:flex;align-items:center;justify-content:center;text-align:center;padding:22px 18px;background:var(--c-card);border:1px solid var(--c-border-2);border-radius:var(--r-md);font-size:20px;font-weight:750;line-height:1.3;touch-action:pan-y;user-select:none;cursor:grab;transition:transform .2s ease,opacity .2s ease,border-color .15s ease}
.tt-fact.is-drag{transition:none;cursor:grabbing}
.tt-fact.lean-yes{border-color:#10b981}.tt-fact.lean-no{border-color:#ef4444}
.tt-fact.fly-yes{transform:translateX(130%) rotate(18deg)!important;opacity:0}
.tt-fact.fly-no{transform:translateX(-130%) rotate(-18deg)!important;opacity:0}
.tt-stamp{position:absolute;top:10px;font-style:normal;font-size:var(--t-label);font-weight:800;padding:2px 8px;border:2px solid;border-radius:var(--r-sm);opacity:0;transition:opacity .1s ease;text-transform:uppercase;letter-spacing:.04em}
.tt-stamp.no{right:12px;color:#ef4444;transform:rotate(10deg)}.tt-stamp.yes{left:12px;color:#10b981;transform:rotate(-10deg)}
.tt-fact.lean-yes .tt-stamp.yes,.tt-fact.lean-no .tt-stamp.no{opacity:1}
.tt-swipe{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 6px}
.tt-swipe>span{text-align:center;font-size:var(--t-caption);font-weight:650;color:var(--c-muted-2);line-height:1.3}
.tt-swipe small{font-weight:500}
.tt-round{width:68px;height:68px;border-radius:var(--r-full);border:2px solid;background:var(--c-card);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .12s ease,background .15s ease}
#tt-overlay .tt-round svg{width:30px;height:30px;stroke-width:2.4}
.tt-round.no{border-color:#ef4444;color:#ef4444}.tt-round.yes{border-color:#10b981;color:#10b981}
.tt-round:active{transform:scale(.92)}
.tt-round.no:hover{background:#fef2f2}.tt-round.yes:hover{background:#ecfdf5}
.tt-explain,.tt-summary{background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r-md);padding:22px 18px;text-align:center;display:flex;flex-direction:column;gap:12px;margin-top:20px}
.tt-explain p,.tt-summary p{margin:0;font-size:var(--t-body);line-height:1.45;color:var(--c-text-soft)}
.tt-explain.is-gold{border-color:#f59e0b}
.tt-score{font-size:28px;font-weight:800;color:#d97706}
.tt-summary.is-ok{border-color:#10b981}.tt-summary.is-ok>b{color:var(--c-success-text);font-size:var(--t-title)}
.tt-summary.is-bad{border-color:#ef4444}.tt-summary.is-bad>b{color:#dc2626;font-size:var(--t-title)}
.tt-summary .tt-dots{justify-content:center}
.tt-row-btns{display:grid;grid-template-columns:2fr 1fr;gap:8px}
/* ── наказание после скримера: тёмная красная сцена (единственный «тёмный» экран) ── */
.tt-pen{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding-top:6px}
.tt-pen-eye{width:120px;height:150px;filter:drop-shadow(0 0 22px rgba(255,0,0,.45))}
#tt-overlay .tt-pen-eye .tt-face{width:100%;height:100%;stroke:none}
.tt-glitch{position:relative;margin:0;font-size:26px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#ff2a2a;text-shadow:2px 0 #00e5ff,-2px 0 #ff00c8;animation:tt-glitch 1.4s infinite steps(2)}
@keyframes tt-glitch{0%,86%,100%{transform:none}88%{transform:translate(-3px,1px) skewX(8deg)}92%{transform:translate(3px,-1px) skewX(-6deg)}96%{transform:translate(-1px,2px)}}
.tt-pen-ans{position:relative;width:100%;padding:14px;border:1px solid #7f1d1d;border-radius:var(--r-md);background:#1a0606;color:#ff6b6b;font-size:22px;font-weight:900;user-select:none;-webkit-user-select:none}
.tt-pen-ans.is-hidden{filter:blur(7px);opacity:.45}
.tt-pen-ans span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;filter:none;font-size:var(--t-label);color:#ff4d4d;letter-spacing:.1em;text-transform:uppercase}
.tt-pen-ans.is-hidden span{filter:blur(0)}
.tt-pen p{margin:0;color:#fca5a5;font-size:var(--t-label);font-weight:650}
.tt-pen-dots{display:flex;gap:10px}
.tt-pen-dots i{width:30px;height:30px;border-radius:var(--r-full);border:2px solid #7f1d1d}
.tt-pen-dots i.on{background:#dc2626;border-color:#ff4d4d;outline:4px solid rgba(255,0,0,.18)}
.tt-input.is-blood{background:#0d0303;border-color:#b91c1c;color:#ff4d4d}
.tt-input.is-blood::placeholder{color:#5a1010}
/* ── скример ── */
#tt-scream{position:fixed;inset:0;z-index:2147483000;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;animation:tt-shake .12s infinite,tt-flash 1.25s steps(1) 1}
#tt-scream.is-out{opacity:0;transition:opacity .4s ease}
#tt-scream .tt-face{width:min(118vw,780px);height:auto;animation:tt-lunge 1.25s cubic-bezier(.2,1.4,.3,1) 1 both;filter:contrast(1.3) saturate(1.2)}
#tt-scream .tt-pupil{animation:tt-pupil .18s infinite alternate}
#tt-scream::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 35%,rgba(0,0,0,.85) 80%),linear-gradient(rgba(120,0,0,.18),rgba(120,0,0,.18));pointer-events:none;z-index:1}
.tt-noise{position:absolute;inset:-50%;background:repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(255,0,0,.05) 0 2px,transparent 2px 5px);animation:tt-noise .08s infinite steps(2);pointer-events:none;z-index:1}
.tt-scream-txt{position:absolute;bottom:5%;left:0;right:0;text-align:center;font-size:clamp(20px,5.5vw,40px);font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#ff1a1a;text-shadow:3px 0 #00e5ff,-3px 0 #ff00c8,0 0 30px #f00;z-index:2;animation:tt-glitch .5s infinite steps(2)}
@keyframes tt-lunge{0%{transform:scale(.25);opacity:0}12%{transform:scale(1.35);opacity:1}20%{transform:scale(1.1) rotate(-2deg)}60%{transform:scale(1.18) rotate(1deg)}100%{transform:scale(1.24)}}
@keyframes tt-shake{0%{transform:translate(0,0)}25%{transform:translate(-9px,6px)}50%{transform:translate(8px,-7px)}75%{transform:translate(-6px,-5px)}100%{transform:translate(7px,8px)}}
@keyframes tt-flash{0%{background:#fff}6%{background:#000}40%{background:#5a0000}46%{background:#000}100%{background:#000}}
@keyframes tt-pupil{from{transform:scale(1);transform-box:fill-box;transform-origin:center}to{transform:scale(1.5);transform-box:fill-box;transform-origin:center}}
@keyframes tt-noise{0%{transform:translate(0,0)}100%{transform:translate(-12px,9px)}}
@media (prefers-reduced-motion:reduce){
  #tt-scream,#tt-scream .tt-face,#tt-scream .tt-pupil,.tt-noise,.tt-scream-txt,.tt-glitch{animation:none!important}
}
@media (max-width:380px){.tt-opt{font-size:16px}.tt-big-ava{font-size:52px}}
`;
        document.head.appendChild(st);
    }

    // Для самотеста: сборка круга без экрана (render без оверлея ничего не делает).
    window.TsarMode = {
        closeYears: closeYears, shared: SHARED,
        buildRound: function (rulerId, progress) {
            const st = window.state && window.state.stats, keep = st ? st.tsarTinder : undefined;
            if (st && progress) st.tsarTinder = progress;
            const saved = _g;
            _g = { active: [byId(rulerId)], queue: [], combo: 0, screen: 'x' };
            nextRuler();
            const out = { years: _g.yearOpts.slice(), events: _g.events.slice(), cur: _g.cur };
            _g = saved;
            if (st) st.tsarTinder = keep;
            return out;
        }
    };
})();
