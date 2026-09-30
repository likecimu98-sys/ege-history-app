// map-mode.js — «Карты»: тренажёр по 81 учебной карте (владелец 30.09.2026:
// «по 3 случайных вопроса по карте, чтобы карты запоминались»).
//
// Раунд = одна карта и три вопроса разного вида; последний — «что изображено»
// (узнать карту целиком). После него — карточка-разгадка: название, годы,
// правитель, ориентиры. Так карта складывается в голове целиком, а не как
// набор угаданных вариантов. Сессия — 5 карт.
//
// Какие карты: интервальное повторение по ключу карты (тот же factStreaks, что у
// фактов): сначала те, что пора повторить, потом новые, потом с ошибками. Карта
// «решена», если все три ответа верны; с ошибкой — вернётся скоро.
//
// Данные — visualStudyData.maps (грузится лениво, ensureVisualDataLoaded).
// Вопросы строятся из полей карты. Обманки подбираются так, чтобы не было двух
// верных ответов: годы — без пересечения интервалов, ориентиры — только
// встречающиеся на ОДНОЙ карте и далёкой эпохи (крупные города вроде Москвы
// бывают почти на каждой карте — обманкой не годятся), правители — без общих имён.
'use strict';

(function () {
    const Z = 10006;
    const PER_SESSION = 5;
    const ERAS = [['all', 'Вся история'], ['early', 'Русь — XVII век'], ['18th', 'XVIII век'], ['19th', 'XIX век'], ['20th', 'XX век']];
    const ERA_ORDER = { early: 0, '18th': 1, '19th': 2, '20th': 3 };
    const VAGUE_RULER = /руководител|князья|правительств|командован|—|;|периода|эпохи|советское/i;
    // Обрывки фраз из описания (родительный падеж, «с юга» и т. п.) — не надписи на карте.
    const ODD_PLACE = ['Москвы', 'Багратиона', 'Деникин с юга', 'Заводы Урала', 'Северо-Кавказский ФО'];
    const NOT_EVENT = /перемири|(^|\s)мир(\s|$)|войн|договор|всадник|восстани|поход|сражени|битв|памятник|соглашени|конференци/i;
    const NOT_PLACE = /^(территори|действи|экономическ|разорени|направлени|поход|границ|район|лини|итог|осень|весна|зима|лето|основн|главн|восстани|присоединени|удар|наступлени|оборон|битв|сражени|путь|маршрут|ориентир)/i;

    let _m = null;   // состояние сессии

    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _sfx(k) { try { if (window.Sfx && window.Sfx.play) window.Sfx.play(k); } catch (e) {} }

    // ─── Данные ──────────────────────────────────────────────────────────────
    function _detail(m, label) { const d = (m.details || []).find(x => x.label === label); return d ? String(d.value || '') : ''; }
    function _years(m) {
        const a = Number(m.year), b = Number(m.endYear);
        if (!a) return String(m.years || '');
        return !b || b === a ? a + ' г.' : a + '–' + b + ' гг.';
    }
    function _span(m) { const a = Number(m.year) || 0, b = Number(m.endYear) || a; return [Math.min(a, b), Math.max(a, b)]; }
    function _places(m) {
        return _detail(m, 'Ориентиры').split(/[;,.]/).map(s => s.trim().replace(/\s+/g, ' '))
            .filter(s => s.length >= 3 && s.length <= 28 && !/\d/.test(s) && s.split(' ').length <= 3 && !NOT_PLACE.test(s) &&
                // Только собственные названия мест: с заглавной, без «и» (перечисления),
                // без событий и памятников («перемирие», «Медный всадник»), без фамилий в родительном.
                /^[А-ЯЁA-Z]/.test(s) && !/\sи\s/.test(s) && !NOT_EVENT.test(s) && !/^[А-ЯЁ][а-яё]+(ова|ева|ина|ого|ского)$/.test(s) && !ODD_PLACE.includes(s));
    }
    function _cleanRuler(m) { const r = String(m.ruler || '').trim(); return r && !VAGUE_RULER.test(r) ? r : ''; }
    function _norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

    let _cache = null;
    function _prepare() {
        if (_cache) return _cache;
        const maps = ((window.visualStudyData && window.visualStudyData.maps) || []).filter(m => m && m.image && m.culture);
        // Сколько карт упоминают каждый ориентир: частые (Москва, Киев…) обманкой не берём.
        const freq = {};
        maps.forEach(m => _places(m).forEach(p => { const k = _norm(p); freq[k] = (freq[k] || 0) + 1; }));
        maps.forEach(m => { m._places = _places(m); m._ruler = _cleanRuler(m); m._span = _span(m); m._yearsText = _years(m); });
        _cache = { maps, freq };
        return _cache;
    }

    // ─── Вопросы ─────────────────────────────────────────────────────────────
    function _qPlace(m, all) {
        const { freq } = _prepare();
        const mine = m._places.map(_norm);
        const good = m._places.filter(p => (freq[_norm(p)] || 0) <= 2);
        if (!good.length) return null;
        const answer = _pick(good);
        const far = all.filter(x => x !== m && Math.abs((ERA_ORDER[x.c] || 0) - (ERA_ORDER[m.c] || 0)) >= 2);
        const pool = [];
        far.forEach(x => x._places.forEach(p => {
            const k = _norm(p);
            if ((freq[k] || 0) === 1 && !mine.some(q => q === k || q.includes(k) || k.includes(q)) && !pool.includes(p)) pool.push(p);
        }));
        if (pool.length < 3) return null;
        return { kind: 'place', q: 'Что из этого отмечено на карте?', answer, options: _shuffle([answer].concat(_shuffle(pool).slice(0, 3))) };
    }
    function _qWhen(m, all) {
        const [a, b] = m._span;
        // Обманки — из БЛИЖАЙШИХ по времени карт (иначе «1242 или 1942» решается не
        // глядя), но интервалы не пересекаются и разнесены хотя бы на 10 лет — иначе
        // два верных ответа. Берём три случайных из восьми ближайших.
        const cand = all.filter(x => { if (x === m) return false; const [c, d] = x._span; return !(c <= b + 10 && d >= a - 10); })
            .sort((x, y) => Math.abs(x._span[0] - a) - Math.abs(y._span[0] - a));
        const pool = [];
        _shuffle(cand.slice(0, 8)).concat(cand.slice(8)).forEach(x => { if (pool.length < 3 && !pool.includes(x._yearsText) && x._yearsText !== m._yearsText) pool.push(x._yearsText); });
        if (pool.length < 3) return null;
        return { kind: 'when', q: 'Когда происходят события на карте?', answer: m._yearsText, options: _shuffle([m._yearsText].concat(pool)) };
    }
    function _qRuler(m, all) {
        if (!m._ruler) return null;
        const mineWords = _norm(m._ruler).split(' ').filter(w => w.length > 2);
        const pool = [];
        const near = all.filter(x => x !== m && x._ruler).sort((x, y) => Math.abs(x._span[0] - m._span[0]) - Math.abs(y._span[0] - m._span[0]));
        _shuffle(near.slice(0, 10)).concat(near.slice(10)).forEach(x => {
            if (pool.length >= 3) return;
            const words = _norm(x._ruler).split(' ');
            if (words.some(w => mineWords.includes(w))) return;        // общее имя — два верных ответа
            if (pool.some(p => _norm(p) === _norm(x._ruler))) return;
            pool.push(x._ruler);
        });
        if (pool.length < 3) return null;
        return { kind: 'ruler', q: 'Кто правил или руководил страной в эти события?', answer: m._ruler, options: _shuffle([m._ruler].concat(pool)) };
    }
    function _qTitle(m, all) {
        const [a, b] = m._span;
        // Обманки — из той же эпохи (так интереснее), но не соседние по времени карты.
        const same = _shuffle(all.filter(x => x !== m && x.c === m.c && (x._span[0] > b + 5 || x._span[1] < a - 5)));
        const other = _shuffle(all.filter(x => x !== m && x.c !== m.c));
        const pool = [];
        same.concat(other).forEach(x => { if (pool.length < 3 && !pool.includes(x.culture) && x.culture !== m.culture) pool.push(x.culture); });
        return { kind: 'title', q: 'Что изображено на этой карте?', answer: m.culture, options: _shuffle([m.culture].concat(pool)) };
    }
    function _questions(m, all) {
        const extra = _shuffle([_qPlace(m, all), _qWhen(m, all), _qRuler(m, all)].filter(Boolean)).slice(0, 2);
        return extra.concat([_qTitle(m, all)]);
    }

    // ─── Какие карты показать ────────────────────────────────────────────────
    function _streak(m) { return (window.state && window.state.stats && window.state.stats.factStreaks || {})[m.id]; }
    function _chooseMaps(era) {
        const { maps } = _prepare();
        const pool = maps.filter(m => era === 'all' || m.c === era);
        const now = Date.now();
        const due = [], fresh = [], wrong = [], rest = [];
        pool.forEach(m => {
            const d = _streak(m);
            if (!d) fresh.push(m);
            else if (d.level >= 1 && d.nextReview && d.nextReview <= now) due.push(m);
            else if (!(d.level >= 1)) wrong.push(m);
            else rest.push(m);
        });
        rest.sort((a, b) => ((_streak(a) || {}).nextReview || 0) - ((_streak(b) || {}).nextReview || 0));
        const out = _shuffle(due).concat(_shuffle(wrong).slice(0, 2), _shuffle(fresh), _shuffle(wrong), rest);
        return out.filter((m, i) => out.indexOf(m) === i).slice(0, PER_SESSION);
    }
    function _learnedCount(era) {
        const { maps } = _prepare();
        return maps.filter(m => (era === 'all' || m.c === era) && ((_streak(m) || {}).level >= 1)).length;
    }

    // ─── Экран ───────────────────────────────────────────────────────────────
    function _css() {
        if (document.getElementById('mm-style')) return;
        const st = document.createElement('style');
        st.id = 'mm-style';
        st.textContent = `
#mm-overlay{position:fixed;inset:0;z-index:${Z};display:flex;flex-direction:column;background:var(--c-bg);color:var(--c-text);font-family:inherit}
#mm-overlay *{box-sizing:border-box}
.mm-top{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;border-bottom:1px solid var(--c-border);background:var(--c-card)}
.mm-back{border:0;background:transparent;color:var(--c-muted-2);font-weight:800;font-size:13px;cursor:pointer;padding:8px 10px;border-radius:8px}
.mm-back:hover{background:var(--c-card-2)}
.mm-title{flex:1;font-weight:900;font-size:15px;letter-spacing:.02em}
.mm-dots{display:flex;gap:5px}
.mm-dot{width:22px;height:6px;border-radius:999px;background:var(--c-border-2)}
.mm-dot.ok{background:var(--c-success)}.mm-dot.bad{background:var(--c-danger)}.mm-dot.cur{background:var(--c-brand)}
.mm-body{flex:1;min-height:0;display:flex;gap:16px;padding:16px;max-width:1400px;width:100%;margin:0 auto}
.mm-map{position:relative;flex:1 1 62%;min-width:0;background:var(--c-card);border:1px solid var(--c-border);border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:zoom-in}
.mm-map img{max-width:100%;max-height:100%;object-fit:contain;display:block;transition:transform .25s ease}
.mm-map .mm-hint{position:absolute;left:50%;bottom:10px;translate:-50% 0;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;font-size:11px;font-weight:800;pointer-events:none}
.mm-side{flex:1 1 38%;min-width:280px;max-width:460px;display:flex;flex-direction:column;gap:12px;overflow:auto}
.mm-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:14px;padding:16px;box-shadow:var(--e-1)}
.mm-qn{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--c-muted-2);margin-bottom:6px}
.mm-q{font-size:18px;font-weight:900;line-height:1.3;margin-bottom:14px}
.mm-opts{display:grid;gap:8px}
.mm-opt{text-align:left;border:1.5px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);border-radius:14px;padding:12px 14px;font-size:15px;font-weight:700;line-height:1.3;cursor:pointer;transition:transform .12s,border-color .15s,background .15s}
.mm-opt:hover{border-color:var(--c-brand);transform:translateY(-1px)}
.mm-opt .k{display:inline-block;min-width:22px;color:var(--c-muted-2);font-weight:900}
.mm-opt.ok{border-color:var(--c-success);background:color-mix(in srgb,var(--c-success) 14%,var(--c-card))}
.mm-opt.bad{border-color:var(--c-danger);background:color-mix(in srgb,var(--c-danger) 12%,var(--c-card))}
.mm-opt:disabled{cursor:default;transform:none}
.mm-reveal{animation:mm-in .35s cubic-bezier(.2,1.3,.4,1)}
.mm-reveal h3{margin:0 0 4px;font-size:20px;font-weight:900;line-height:1.2}
.mm-reveal .yr{font-size:14px;font-weight:800;color:var(--c-brand);margin-bottom:10px}
.mm-row{font-size:13px;line-height:1.45;margin:4px 0;color:var(--c-text-soft)}
.mm-row b{color:var(--c-text)}
.mm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.mm-chip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--c-card-2);border:1px solid var(--c-border)}
.mm-go{width:100%;border:0;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;background:linear-gradient(135deg,#0d9488,#14b8a6);cursor:pointer;box-shadow:var(--e-2)}
.mm-go:active{transform:scale(.98)}
.mm-verdict{font-size:13px;font-weight:900;margin-bottom:8px}
.mm-verdict.ok{color:var(--c-success-text)}.mm-verdict.bad{color:var(--c-danger)}
.mm-start{max-width:640px;margin:auto;padding:24px 16px;text-align:center}
.mm-start h2{font-size:26px;font-weight:900;margin:8px 0}
.mm-start p{color:var(--c-muted-2);font-size:14px;line-height:1.5;margin:0 0 16px}
.mm-eras{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 18px}
.mm-era{border:1.5px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);padding:9px 14px;border-radius:999px;font-weight:800;font-size:13px;cursor:pointer}
.mm-era.on{border-color:#14b8a6;background:color-mix(in srgb,#14b8a6 14%,var(--c-card))}
.mm-era small{color:var(--c-muted-2);font-weight:700;margin-left:4px}
.mm-big{font-size:54px;line-height:1}
.mm-zoom{position:fixed;inset:0;z-index:${Z + 2};background:rgba(0,0,0,.92);overflow:hidden;cursor:grab;touch-action:none}
.mm-zoom img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;user-select:none;-webkit-user-drag:none}
.mm-zoom button{position:absolute;right:16px;top:calc(16px + env(safe-area-inset-top,0px));width:44px;height:44px;border:0;border-radius:999px;background:#fff;color:#111;font-size:22px;font-weight:900;cursor:pointer}
@keyframes mm-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (max-width:820px){.mm-body{flex-direction:column;padding:10px;gap:10px}.mm-map{flex:0 0 42vh}.mm-side{max-width:none;min-width:0}.mm-q{font-size:16px}}
@media (prefers-reduced-motion:reduce){.mm-reveal{animation:none}}
`;
        document.head.appendChild(st);
    }

    function _shell(inner) {
        let ov = document.getElementById('mm-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'mm-overlay';
            document.body.appendChild(ov);
            try { if (window.pushBackHandler) window.pushBackHandler('map-mode', () => window.closeMapMode()); } catch (e) {}
        }
        ov.innerHTML = inner;
        return ov;
    }
    function _top(title) {
        const dots = _m && _m.maps ? _m.maps.map((_, i) => {
            const r = _m.results[i];
            return '<span class="mm-dot' + (r === true ? ' ok' : r === false ? ' bad' : i === _m.i ? ' cur' : '') + '"></span>';
        }).join('') : '';
        return '<div class="mm-top"><button type="button" class="mm-back" data-mm="close">← Назад</button><div class="mm-title">🗺️ ' + _esc(title) + '</div><div class="mm-dots">' + dots + '</div></div>';
    }

    function _startScreen() {
        _prepare();
        const era = (_m && _m.era) || 'all';
        const chips = ERAS.map(([id, name]) => {
            const n = _prepare().maps.filter(m => id === 'all' || m.c === id).length;
            return '<button type="button" class="mm-era' + (id === era ? ' on' : '') + '" data-mm-era="' + id + '">' + _esc(name) + '<small>' + _learnedCount(id) + '/' + n + '</small></button>';
        }).join('');
        const ov = _shell(_top('Карты') +
            '<div class="mm-start"><div class="mm-big">🗺️</div><h2>Карты ЕГЭ</h2>' +
            '<p>По каждой карте — три вопроса: что на ней отмечено, когда это было, кто правил, и что это за карта. ' +
            'В конце открывается разгадка — так карта запоминается целиком. Ошибся — карта вернётся скоро, ответил верно — позже.</p>' +
            '<div class="mm-eras">' + chips + '</div>' +
            '<button type="button" class="mm-go" data-mm="go">Начать · ' + PER_SESSION + ' карт</button></div>');
        ov.onclick = _click;
    }

    function _renderRound() {
        const m = _m.maps[_m.i], q = _m.qs[_m.qi];
        const ov = _shell(_top('Карта ' + (_m.i + 1) + ' из ' + _m.maps.length) +
            '<div class="mm-body"><div class="mm-map" data-mm="zoom"><img src="' + _esc(m.image) + '" alt="Историческая карта"><span class="mm-hint">Нажми, чтобы увеличить</span></div>' +
            '<div class="mm-side"><div class="mm-card"><div class="mm-qn">Вопрос ' + (_m.qi + 1) + ' из ' + _m.qs.length + '</div>' +
            '<div class="mm-q">' + _esc(q.q) + '</div><div class="mm-opts">' +
            q.options.map((o, i) => '<button type="button" class="mm-opt" data-mm-opt="' + i + '"><span class="k">' + (i + 1) + '</span>' + _esc(o) + '</button>').join('') +
            '</div></div><div id="mm-after"></div></div></div>');
        ov.onclick = _click;
    }

    function _answer(idx) {
        const m = _m.maps[_m.i], q = _m.qs[_m.qi];
        if (q.done) return;
        q.done = true;
        const ok = q.options[idx] === q.answer;
        if (!ok) _m.roundOk = false;
        const btns = document.querySelectorAll('.mm-opt');
        btns.forEach((b, i) => { b.disabled = true; if (q.options[i] === q.answer) b.classList.add('ok'); else if (i === idx) b.classList.add('bad'); });
        _h(ok ? 'success' : 'error'); _sfx(ok ? 'quest' : 'error');
        // Верный ответ — строка в норму дня; повтор той же карты сверх нормы — +0 (как в тренажёре).
        if (ok && window.creditNorm && (!window.countFreshLine || window.countFreshLine(m.id + ':' + q.kind))) window.creditNorm(1);
        const last = _m.qi === _m.qs.length - 1;
        const after = document.getElementById('mm-after');
        if (!last) {
            after.innerHTML = '<div class="mm-card mm-reveal"><div class="mm-verdict ' + (ok ? 'ok">✓ Верно' : 'bad">✗ Правильно: ' + _esc(q.answer)) + '</div>' +
                '<button type="button" class="mm-go" data-mm="next-q">Следующий вопрос →</button></div>';
        } else _reveal(ok);
    }

    // Разгадка: название, годы, правитель, ориентиры — то, что должно остаться в памяти.
    function _reveal(lastOk) {
        const m = _m.maps[_m.i], all = _m.roundOk;
        _m.results[_m.i] = all;
        try { if (typeof updateFactSRS === 'function') updateFactSRS(m.id, all, true); } catch (e) {}
        try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {}
        const places = m._places.slice(0, 8).map(p => '<span class="mm-chip">' + _esc(p) + '</span>').join('');
        const section = _detail(m, 'Раздел'), type = _detail(m, 'Тип');
        document.getElementById('mm-after').innerHTML =
            '<div class="mm-card mm-reveal">' +
            '<div class="mm-verdict ' + (lastOk ? 'ok">✓ Верно' : 'bad">✗ Это другая карта') + (all ? ' · карта пройдена без ошибок 🎉' : ' · в этой карте была ошибка — она вернётся скоро') + '</div>' +
            '<h3>' + _esc(m.culture) + '</h3><div class="yr">' + _esc(m._yearsText) + '</div>' +
            (m.ruler ? '<div class="mm-row"><b>Правитель:</b> ' + _esc(m.ruler) + '</div>' : '') +
            (section || type ? '<div class="mm-row"><b>' + _esc(section) + '</b>' + (type ? ' · ' + _esc(type) : '') + '</div>' : '') +
            (places ? '<div class="mm-row" style="margin-top:8px"><b>Ориентиры на карте:</b></div><div class="mm-chips">' + places + '</div>' : '') +
            '<div style="height:12px"></div><button type="button" class="mm-go" data-mm="next-map">' + (_m.i + 1 < _m.maps.length ? 'Следующая карта →' : 'Итоги') + '</button></div>';
        if (all) _sfx('levelup');
    }

    function _summary() {
        const okN = _m.results.filter(r => r === true).length;
        const ov = _shell(_top('Итоги') +
            '<div class="mm-start mm-reveal"><div class="mm-big">' + (okN === _m.maps.length ? '🏆' : okN >= 3 ? '🗺️' : '🧭') + '</div>' +
            '<h2>' + okN + ' из ' + _m.maps.length + ' карт без ошибок</h2>' +
            '<p>' + (okN === _m.maps.length ? 'Идеально! Эти карты вернутся на повторение через несколько дней.' : 'Карты с ошибками вернутся в следующих сессиях — так они и запоминаются.') + '</p>' +
            '<div class="mm-eras">' + _m.maps.map((m, i) => '<span class="mm-chip" style="border-color:' + (_m.results[i] ? 'var(--c-success)' : 'var(--c-danger)') + '">' + (_m.results[i] ? '✓ ' : '↻ ') + _esc(m.culture) + '</span>').join('') + '</div>' +
            '<button type="button" class="mm-go" data-mm="again">Ещё ' + PER_SESSION + ' карт</button></div>');
        ov.onclick = _click;
        try { if (window.updateProgressBars) window.updateProgressBars(); } catch (e) {}
    }

    function _begin() {
        const all = _prepare().maps;
        const maps = _chooseMaps(_m.era);
        if (!maps.length) { if (typeof showToast === 'function') showToast('🗺️', 'Карты ещё загружаются', 'bg-amber-500', 'border-amber-700'); return; }
        _m.maps = maps; _m.i = 0; _m.results = maps.map(() => null);
        _nextMap(all);
    }
    function _nextMap(all) {
        const m = _m.maps[_m.i];
        _m.qs = _questions(m, all || _prepare().maps); _m.qi = 0; _m.roundOk = true;
        _renderRound();
    }

    // Увеличение карты: колесо, щипок и перетаскивание. Рисование (draw-mode.js)
    // привязывается к самой картинке — рисунок едет вместе с зумом.
    function _zoom(src) {
        const z = document.createElement('div');
        z.className = 'mm-zoom';
        z.innerHTML = '<img alt="Карта крупно" src="' + _esc(src) + '"><button type="button" aria-label="Закрыть">×</button>';
        document.body.appendChild(z);
        const img = z.querySelector('img');
        const t = { x: 0, y: 0, k: 1 };
        const apply = () => { img.style.transform = 'translate(' + t.x + 'px,' + t.y + 'px) scale(' + t.k + ')'; };
        const fit = () => {
            const W = window.innerWidth, H = window.innerHeight, w = img.naturalWidth || W, h = img.naturalHeight || H;
            const k = Math.min(W / w, H / h) * 0.96;
            img.style.width = w + 'px'; img.style.height = h + 'px';
            t.k = k; t.x = (W - w * k) / 2; t.y = (H - h * k) / 2; apply();
        };
        if (img.complete) fit(); else img.onload = fit;
        const zoomAt = (cx, cy, nk) => { nk = Math.max(0.2, Math.min(8, nk)); t.x = cx - (cx - t.x) * nk / t.k; t.y = cy - (cy - t.y) * nk / t.k; t.k = nk; apply(); };
        z.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, t.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)); }, { passive: false });
        const pts = new Map(); let drag = null, pinch = null;
        z.addEventListener('pointerdown', e => {
            if (e.target.tagName === 'BUTTON') return;
            z.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
            if (pts.size === 1) drag = { x: e.clientX - t.x, y: e.clientY - t.y };
            if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: t.k }; drag = null; }
        });
        z.addEventListener('pointermove', e => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, [e.clientX, e.clientY]);
            if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d); }
            else if (drag) { t.x = e.clientX - drag.x; t.y = e.clientY - drag.y; apply(); }
        });
        const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
        z.addEventListener('pointerup', end); z.addEventListener('pointercancel', end);
        z.addEventListener('dblclick', e => zoomAt(e.clientX, e.clientY, t.k * 2));
        const close = () => { z.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        z.querySelector('button').onclick = close;
    }

    function _click(e) {
        const eraBtn = e.target.closest('[data-mm-era]');
        if (eraBtn) { _m.era = eraBtn.dataset.mmEra; try { localStorage.setItem('map_mode_era', _m.era); } catch (er) {} _startScreen(); return; }
        const opt = e.target.closest('[data-mm-opt]');
        if (opt) { _answer(+opt.dataset.mmOpt); return; }
        const a = e.target.closest('[data-mm]');
        if (!a) return;
        const act = a.dataset.mm;
        if (act === 'close') window.closeMapMode();
        else if (act === 'go' || act === 'again') _begin();
        else if (act === 'next-q') { _m.qi++; _renderRound(); }
        else if (act === 'next-map') { _m.i++; if (_m.i < _m.maps.length) _nextMap(); else _summary(); }
        else if (act === 'zoom') { const img = a.querySelector('img'); if (img) _zoom(img.getAttribute('src')); }
    }
    // Цифры 1–4 выбирают ответ, Enter — «дальше», как в остальных тренажёрах.
    function _key(e) {
        if (!_m || document.querySelector('.mm-zoom')) return;
        const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
        if (/^[1-4]$/.test(e.key) && !e.shiftKey && !e.ctrlKey) {
            const b = document.querySelector('[data-mm-opt="' + (Number(e.key) - 1) + '"]');
            if (b && !b.disabled) { e.preventDefault(); e.stopPropagation(); b.click(); }
        } else if (e.key === 'Enter') {
            const b = document.querySelector('#mm-after .mm-go, .mm-start .mm-go');
            if (b) { e.preventDefault(); e.stopPropagation(); b.click(); }
        } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); window.closeMapMode(); }
    }

    window.openMapMode = async function () {
        if (window.canSolveMore) {
            const lim = window.canSolveMore();
            if (!lim.ok) { if (window.showDailyLimitModal) window.showDailyLimitModal(); return; }
        }
        try { if (!window.visualStudyData && typeof window.ensureVisualDataLoaded === 'function') await window.ensureVisualDataLoaded(); } catch (e) {}
        if (!window.visualStudyData || !(window.visualStudyData.maps || []).length) {
            if (typeof showToast === 'function') showToast('🗺️', 'Карты не загрузились — проверь интернет', 'bg-amber-500', 'border-amber-700');
            return;
        }
        _css();
        let era = 'all';
        try { era = localStorage.getItem('map_mode_era') || 'all'; } catch (e) {}
        if (!ERAS.some(x => x[0] === era)) era = 'all';
        _m = { era };
        document.addEventListener('keydown', _key, true);
        _startScreen();
    };
    window.closeMapMode = function () {
        const ov = document.getElementById('mm-overlay');
        if (ov) ov.remove();
        document.removeEventListener('keydown', _key, true);
        try { if (window.popBackHandler) window.popBackHandler('map-mode'); } catch (e) {}
        _m = null;
        try { if (window.updateProgressBars) window.updateProgressBars(); } catch (e) {}
    };
    // Для самотеста и отладки: вопросы по карте без экрана.
    window.MapMode = { questions: function (m) { const all = _prepare().maps; return _questions(m, all); }, prepare: _prepare };
})();
