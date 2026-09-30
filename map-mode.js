// map-mode.js — «Карты»: тренажёр по картам ЕГЭ (владелец 30.09.2026:
// «по 3 случайных вопроса по карте, чтобы карты запоминались»).
//
// Два раздела:
//  • «Карты ЕГЭ» — 64 карты открытого банка ФИПИ (задания 9–12 пробника).
//    Вопросы — по ЦИФРАМ на самой карте, с ответами ФИПИ: два суждения из
//    задания 12 («Цифрой „4" обозначен…» — верно или нет) и один вопрос с
//    вариантами из заданий 9–11 («какой город обозначен цифрой N», «город,
//    пропущенный в тексте», «в каком веке»). Вопрос про конкретную цифру
//    однозначен, даже если обманка где-то ещё есть на карте.
//  • «Атлас» — наши 81 карта: узнать карту целиком — когда, кто правил, что
//    изображено.
//
// 🔴 Вопроса «что из этого отмечено на карте» больше НЕТ (владелец, 30.09.2026):
// список ориентиров в описании карты не совпадает с надписями на картинке —
// верный «Фили» на карте не подписан, а обманка «Рига» написана крупно.
//
// Раунд = одна карта и три вопроса, затем разгадка: что верно про эту карту.
// Карты — по интервальному повторению (factStreaks, ключ карты): пора повторить →
// новые → с ошибками. Карта без ошибок = выучена.
'use strict';

(function () {
    const Z = 10006;
    const PER_SESSION = 5;
    const ERAS = [['all', 'Вся история'], ['early', 'Русь — XVII век'], ['18th', 'XVIII век'], ['19th', 'XIX век'], ['20th', 'XX век']];
    const VAGUE_RULER = /руководител|князья|правительств|командован|—|;|периода|эпохи|советское/i;
    const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
    const ORD = [['двадцать перв', 21], ['девятнадцат', 19], ['восемнадцат', 18], ['семнадцат', 17], ['шестнадцат', 16], ['пятнадцат', 15],
        ['четырнадцат', 14], ['тринадцат', 13], ['двенадцат', 12], ['одиннадцат', 11], ['двадцат', 20], ['десят', 10], ['девят', 9]];

    let _m = null;   // состояние сессии

    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function _pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _sfx(k) { try { if (window.Sfx && window.Sfx.play) window.Sfx.play(k); } catch (e) {} }
    function _norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function _cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

    // ─── Атлас: 81 наша карта ────────────────────────────────────────────────
    function _detail(m, label) { const d = (m.details || []).find(x => x.label === label); return d ? String(d.value || '') : ''; }
    function _years(m) {
        const a = Number(m.year), b = Number(m.endYear);
        if (!a) return String(m.years || '');
        return !b || b === a ? a + ' г.' : a + '–' + b + ' гг.';
    }
    function _span(m) { const a = Number(m.year) || 0, b = Number(m.endYear) || a; return [Math.min(a, b), Math.max(a, b)]; }

    let _atlas = null;
    function _prepAtlas() {
        if (_atlas) return _atlas;
        const maps = ((window.visualStudyData && window.visualStudyData.maps) || []).filter(m => m && m.image && m.culture);
        maps.forEach(m => {
            m.key = m.id; m._span = _span(m); m._yearsText = _years(m);
            const r = String(m.ruler || '').trim(); m._ruler = r && !VAGUE_RULER.test(r) ? r : '';
        });
        return (_atlas = maps);
    }
    function _qWhen(m, all) {
        const [a, b] = m._span;
        // Обманки — из БЛИЖАЙШИХ по времени карт (иначе «1242 или 1942» решается не
        // глядя), но интервалы не пересекаются и разнесены хотя бы на 10 лет.
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
        const near = all.filter(x => x !== m && x._ruler).sort((x, y) => Math.abs(x._span[0] - m._span[0]) - Math.abs(y._span[0] - m._span[0]));
        const pool = [];
        _shuffle(near.slice(0, 10)).concat(near.slice(10)).forEach(x => {
            if (pool.length >= 3) return;
            if (_norm(x._ruler).split(' ').some(w => mineWords.includes(w))) return;   // общее имя — два верных ответа
            if (pool.some(p => _norm(p) === _norm(x._ruler))) return;
            pool.push(x._ruler);
        });
        if (pool.length < 3) return null;
        return { kind: 'ruler', q: 'Кто правил или руководил страной в эти события?', answer: m._ruler, options: _shuffle([m._ruler].concat(pool)) };
    }
    function _qTitle(m, all) {
        const [a, b] = m._span;
        // Соседние карты делят одну географию: на «Правлении Ивана III» подписаны
        // Казанское и Астраханское ханства и походы на Казань, и обманка «Казанское,
        // Астраханское и Азовское направления» (1552, разрыв 47 лет) выглядела верной
        // (владелец 30.09). В древности карты гуще — разрыв 60 лет, дальше — 15.
        const gap = m.c === 'early' ? 60 : 15;
        const same = _shuffle(all.filter(x => x !== m && x.c === m.c && (x._span[0] > b + gap || x._span[1] < a - gap)));
        const other = _shuffle(all.filter(x => x !== m && x.c !== m.c));
        const pool = [];
        same.concat(other).forEach(x => { if (pool.length < 3 && !pool.includes(x.culture) && x.culture !== m.culture) pool.push(x.culture); });
        return { kind: 'title', q: 'Что изображено на этой карте?', answer: m.culture, options: _shuffle([m.culture].concat(pool)) };
    }
    function _atlasQuestions(m, all) {
        return _shuffle([_qWhen(m, all), _qRuler(m, all)].filter(Boolean)).concat([_qTitle(m, all)]);
    }

    // ─── Карты ЕГЭ: 64 карты ФИПИ ────────────────────────────────────────────
    // Вид вопроса — по тому, ЧТО спрашивают, а не по любому упоминанию в тексте:
    // «укажите название реки» → река, но «назовите предводителя, погибшего в реке» —
    // человек (так «Пугачев» попадал в обманки к рекам). \b в JS не знает кириллицу.
    function _kindOf(q) {
        q = String(q || '').replace(/\s+/g, ' ');
        if (/(укажите|назовите|напишите) век/i.test(q)) return 'century';
        // Сначала «кого»: «назовите короля, … взявшего город, обозначенный цифрой» — про человека.
        if (/(имя|фамилию|(назовите|укажите|напишите) [а-яё]* ?(князя|короля|царя|полководца|правителя|предводителя|командующего|императора|государя|руководителя|хана|военачальника))/i.test(q)) return 'person';
        if (/название (города|населённого пункта|населенного пункта)|(назовите|укажите|напишите) (город|населённый пункт|населенный пункт)/i.test(q)) return 'city';
        if (/название реки|(назовите|укажите|напишите) реку/i.test(q)) return 'river';
        return '';
    }
    function _century(ans) {
        const a = _norm(ans);
        for (const [stem, n] of ORD) if (a.startsWith(stem) || a.includes(stem)) return n;
        return 0;
    }
    let _fipi = null;
    function _prepFipi() {
        if (_fipi) return _fipi;
        const bank = window.EGE_EXAM_BANK;
        if (!bank || !bank.tasks) return null;
        const byGroup = {};
        bank.tasks.filter(t => t.kim >= 9 && t.kim <= 12 && t.groupId).forEach(t => (byGroup[t.groupId] = byGroup[t.groupId] || []).push(t));
        const groups = [];
        Object.keys(byGroup).forEach(id => {
            const ts = byGroup[id].sort((a, b) => a.kim - b.kim);
            const k12 = ts.find(t => t.kim === 12);
            if (!k12 || !(k12.elements || []).length) return;
            const truth = new Set(String(k12.answer || '').replace(/\D/g, '').split(''));
            const judgments = k12.elements.map(e => ({ text: String(e.text || '').replace(/\s*\n\s*/g, ' ').trim(), ok: truth.has(String(e.n)) }));
            const asks = [];
            ts.filter(t => t.kim >= 9 && t.kim <= 11).forEach(t => {
                const kind = _kindOf(t.question);
                if (kind === 'century') { const n = _century(t.answer); if (n) asks.push({ kind, n, answer: ROMAN[n] + ' век', text: t.question }); }
                // Ответ в косвенном падеже («Галичу», «Салониках» — пропуск в тексте) среди
                // обманок в именительном выдаёт себя сам — такой вопрос не берём.
                else if (kind && !(kind !== 'person' && /(у|ю|ах|ях|ом|ем|ого|его|ой|ей)$/i.test(String(t.answer).trim())))
                    asks.push({ kind, answer: _cap(t.answer), text: String(t.question || '').trim() });
            });
            groups.push({ key: 'fipimap:' + id, id, image: ts[0].image, judgments, asks });
        });
        return (_fipi = groups);
    }
    function _fipiAsk(g, all) {
        const asks = _shuffle(g.asks.slice());
        for (const a of asks) {
            if (a.kind === 'century') {
                const opts = new Set([a.n]);
                _shuffle([-2, -1, 1, 2]).forEach(d => { if (opts.size < 4 && a.n + d >= 9 && a.n + d <= 21) opts.add(a.n + d); });
                if (opts.size < 4) continue;
                const options = _shuffle([...opts]).map(n => ROMAN[n] + ' век');
                return { kind: 'century', q: 'В каком веке произошли события, отражённые на карте?', answer: a.answer, options };
            }
            // Обманки — ответы того же вида (город к городу, река к реке) с ДРУГИХ карт ФИПИ.
            const pool = [];
            _shuffle(all.slice()).forEach(x => x !== g && x.asks.forEach(b => {
                if (b.kind === a.kind && _norm(b.answer) !== _norm(a.answer) && !pool.some(p => _norm(p) === _norm(b.answer))) pool.push(b.answer);
            }));
            if (pool.length < 3) continue;
            // Текст ФИПИ целиком: «Укажите название города, обозначенного цифрой 2» и
            // отрывки с пропуском — так вопрос остаётся ровно тем, что на экзамене.
            const q = a.text.replace(/\s*Ответ запишите[^.]*\.?/i, '');
            return { kind: a.kind, q, answer: a.answer, options: _shuffle([a.answer].concat(_shuffle(pool).slice(0, 3))), long: q.length > 160 };
        }
        return null;
    }
    function _fipiQuestions(g, all) {
        const t = _shuffle(g.judgments.filter(j => j.ok)), f = _shuffle(g.judgments.filter(j => !j.ok));
        const tf = j => ({ kind: 'tf', q: 'Верно ли это?', statement: j.text, answer: j.ok ? 'Верно' : 'Неверно', options: ['Верно', 'Неверно'] });
        const ask = _fipiAsk(g, all);
        const pair = [t[0], f[0]].filter(Boolean).map(tf);
        const qs = _shuffle(pair);
        if (ask) qs.push(ask);
        else if (t[1] || f[1]) qs.push(tf(t[1] || f[1]));
        return qs;
    }

    // ─── Общее: выбор карт, экран ────────────────────────────────────────────
    function _list() {
        if (_m.src === 'fipi') return _prepFipi() || [];
        const all = _prepAtlas();
        return all.filter(m => _m.era === 'all' || m.c === _m.era);
    }
    function _allOf(src) { return src === 'fipi' ? (_prepFipi() || []) : _prepAtlas(); }
    function _questions(item) { return _m.src === 'fipi' ? _fipiQuestions(item, _allOf('fipi')) : _atlasQuestions(item, _allOf('atlas')); }
    function _streak(item) { return (window.state && window.state.stats && window.state.stats.factStreaks || {})[item.key]; }
    function _chooseMaps() {
        const now = Date.now(), due = [], fresh = [], wrong = [], rest = [];
        _list().forEach(m => {
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
    function _learned(list) { return list.filter(m => ((_streak(m) || {}).level >= 1)).length; }

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
.mm-map{position:relative;flex:1 1 62%;min-width:0;background:#fff;border:1px solid var(--c-border);border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:zoom-in}
.mm-map img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.mm-map .mm-hint{position:absolute;left:50%;bottom:10px;translate:-50% 0;padding:6px 10px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;font-size:11px;font-weight:800;pointer-events:none}
.mm-side{flex:1 1 38%;min-width:280px;max-width:480px;display:flex;flex-direction:column;gap:12px;overflow:auto}
.mm-card{background:var(--c-card);border:1px solid var(--c-border);border-radius:14px;padding:16px;box-shadow:var(--e-1)}
.mm-qn{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:var(--c-muted-2);margin-bottom:6px}
.mm-q{font-size:18px;font-weight:900;line-height:1.3;margin-bottom:14px;white-space:pre-line}
.mm-q.long{font-size:14px;font-weight:700;line-height:1.45}
.mm-stmt{font-size:16px;font-weight:700;line-height:1.45;margin:-4px 0 14px;padding:12px 14px;border-radius:14px;background:var(--c-card-2);border:1px solid var(--c-border)}
.mm-opts{display:grid;gap:8px}
.mm-opts.tf{grid-template-columns:1fr 1fr}
.mm-opt{text-align:left;border:1.5px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);border-radius:14px;padding:12px 14px;font-size:15px;font-weight:700;line-height:1.3;cursor:pointer;transition:transform .12s,border-color .15s,background .15s}
.mm-opts.tf .mm-opt{text-align:center;font-size:16px;font-weight:900;padding:14px}
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
.mm-facts{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px}
.mm-facts li{font-size:13px;line-height:1.45;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--c-success) 9%,var(--c-card));border:1px solid color-mix(in srgb,var(--c-success) 30%,var(--c-border))}
.mm-chip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--c-card-2);border:1px solid var(--c-border)}
.mm-go{width:100%;border:0;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;background:linear-gradient(135deg,#0d9488,#14b8a6);cursor:pointer;box-shadow:var(--e-2)}
.mm-go:active{transform:scale(.98)}
.mm-verdict{font-size:13px;font-weight:900;margin-bottom:8px}
.mm-verdict.ok{color:var(--c-success-text)}.mm-verdict.bad{color:var(--c-danger)}
.mm-start{max-width:720px;margin:auto;padding:24px 16px;text-align:center}
.mm-start h2{font-size:26px;font-weight:900;margin:8px 0}
.mm-start p{color:var(--c-muted-2);font-size:14px;line-height:1.5;margin:0 0 16px}
.mm-srcs{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 16px;text-align:left}
.mm-src{border:2px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);border-radius:14px;padding:14px;cursor:pointer}
.mm-src b{display:block;font-size:16px;font-weight:900;margin-bottom:4px}
.mm-src span{display:block;font-size:13px;color:var(--c-muted-2);line-height:1.4}
.mm-src i{display:block;font-style:normal;font-size:12px;font-weight:800;color:#0d9488;margin-top:8px}
.mm-src.on{border-color:#14b8a6;background:color-mix(in srgb,#14b8a6 10%,var(--c-card))}
.mm-eras{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 18px}
.mm-era{border:1.5px solid var(--c-border-2);background:var(--c-card);color:var(--c-text);padding:9px 14px;border-radius:999px;font-weight:800;font-size:13px;cursor:pointer}
.mm-era.on{border-color:#14b8a6;background:color-mix(in srgb,#14b8a6 14%,var(--c-card))}
.mm-era small{color:var(--c-muted-2);font-weight:700;margin-left:4px}
.mm-big{font-size:54px;line-height:1}
.mm-zoom{position:fixed;inset:0;z-index:${Z + 2};background:rgba(0,0,0,.92);overflow:hidden;cursor:grab;touch-action:none}
.mm-zoom img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;user-select:none;-webkit-user-drag:none;background:#fff}
.mm-zoom button{position:absolute;right:16px;top:calc(16px + env(safe-area-inset-top,0px));width:44px;height:44px;border:0;border-radius:999px;background:#fff;color:#111;font-size:22px;font-weight:900;cursor:pointer}
@keyframes mm-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@media (max-width:820px){.mm-body{flex-direction:column;padding:10px;gap:10px}.mm-map{flex:0 0 42vh}.mm-side{max-width:none;min-width:0}.mm-q{font-size:16px}.mm-srcs{grid-template-columns:1fr}}
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
        ov.onclick = _click;
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
        _m.maps = null;
        const fipi = _prepFipi() || [], atlas = _prepAtlas();
        const src = (id, name, text, list) => '<button type="button" class="mm-src' + (_m.src === id ? ' on' : '') + '" data-mm-src="' + id + '"><b>' + name + '</b><span>' + text + '</span><i>выучено ' + _learned(list) + ' из ' + list.length + '</i></button>';
        const eras = _m.src === 'atlas' ? '<div class="mm-eras">' + ERAS.map(([id, name]) => {
            const list = atlas.filter(m => id === 'all' || m.c === id);
            return '<button type="button" class="mm-era' + (id === _m.era ? ' on' : '') + '" data-mm-era="' + id + '">' + _esc(name) + '<small>' + _learned(list) + '/' + list.length + '</small></button>';
        }).join('') + '</div>' : '';
        _shell(_top('Карты') +
            '<div class="mm-start"><div class="mm-big">🗺️</div><h2>Карты ЕГЭ</h2>' +
            '<p>По каждой карте — три вопроса, потом разгадка: что важно на этой карте. Ошибся — карта вернётся скоро, ответил без ошибок — позже.</p>' +
            '<div class="mm-srcs">' +
            (fipi.length ? src('fipi', 'Карты ЕГЭ', 'Карты из банка ФИПИ. Вопросы по цифрам на карте — как в заданиях 9–12.', fipi) : '') +
            src('atlas', 'Атлас', 'Учебные карты: узнай карту — что на ней, когда это было, кто правил.', atlas) +
            '</div>' + eras +
            '<button type="button" class="mm-go" data-mm="go">Начать · ' + PER_SESSION + ' карт</button></div>');
    }

    function _renderRound() {
        const m = _m.maps[_m.i], q = _m.qs[_m.qi];
        const tf = q.kind === 'tf';
        _shell(_top('Карта ' + (_m.i + 1) + ' из ' + _m.maps.length) +
            '<div class="mm-body"><div class="mm-map" data-mm="zoom"><img src="' + _esc(m.image) + '" alt="Историческая карта"><span class="mm-hint">Нажми, чтобы увеличить</span></div>' +
            '<div class="mm-side"><div class="mm-card"><div class="mm-qn">Вопрос ' + (_m.qi + 1) + ' из ' + _m.qs.length + '</div>' +
            '<div class="mm-q' + (q.long ? ' long' : '') + '">' + _esc(q.q) + '</div>' +
            (tf ? '<div class="mm-stmt">' + _esc(q.statement) + '</div>' : '') +
            '<div class="mm-opts' + (tf ? ' tf' : '') + '">' +
            q.options.map((o, i) => '<button type="button" class="mm-opt" data-mm-opt="' + i + '">' + (tf ? '' : '<span class="k">' + (i + 1) + '</span>') + _esc(o) + '</button>').join('') +
            '</div></div><div id="mm-after"></div></div></div>');
    }

    function _answer(idx) {
        const m = _m.maps[_m.i], q = _m.qs[_m.qi];
        if (q.done) return;
        q.done = true;
        const ok = q.options[idx] === q.answer;
        q.ok = ok;
        if (!ok) _m.roundOk = false;
        document.querySelectorAll('.mm-opt').forEach((b, i) => { b.disabled = true; if (q.options[i] === q.answer) b.classList.add('ok'); else if (i === idx) b.classList.add('bad'); });
        _h(ok ? 'success' : 'error'); _sfx(ok ? 'quest' : 'error');
        // Верный ответ — строка в норму дня; повтор той же карты сверх нормы — +0 (как в тренажёре).
        if (ok && window.creditNorm && (!window.countFreshLine || window.countFreshLine(m.key + ':' + q.kind + ':' + (q.statement || q.answer)))) window.creditNorm(1);
        const last = _m.qi === _m.qs.length - 1;
        if (!last) {
            document.getElementById('mm-after').innerHTML = '<div class="mm-card mm-reveal"><div class="mm-verdict ' + (ok ? 'ok">✓ Верно' : 'bad">✗ Правильно: ' + _esc(q.answer)) + '</div>' +
                '<button type="button" class="mm-go" data-mm="next-q">Следующий вопрос →</button></div>';
        } else _reveal(ok);
    }

    // Разгадка — то, что должно остаться в памяти.
    function _reveal(lastOk) {
        const m = _m.maps[_m.i], all = _m.roundOk;
        _m.results[_m.i] = all;
        try { if (typeof updateFactSRS === 'function') updateFactSRS(m.key, all, true); } catch (e) {}
        try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {}
        const head = '<div class="mm-verdict ' + (lastOk ? 'ok">✓ Верно' : 'bad">✗ Правильно: ' + _esc(_m.qs[_m.qi].answer)) + '</div>' +
            '<div class="mm-row" style="margin-bottom:8px">' + (all ? 'Карта пройдена без ошибок 🎉' : 'В этой карте была ошибка — она вернётся скоро.') + '</div>';
        let body;
        if (_m.src === 'fipi') {
            const facts = m.judgments.filter(j => j.ok).map(j => '<li>' + _esc(j.text) + '</li>').join('');
            const asks = m.asks.map(a => '<div class="mm-row"><b>' + _esc(a.kind === 'century' ? 'Век:' : a.kind === 'river' ? 'Река:' : a.kind === 'person' ? 'Личность:' : 'Город:') + '</b> ' + _esc(a.answer) + '</div>').join('');
            body = '<h3>Что верно про эту карту</h3><ul class="mm-facts">' + facts + '</ul>' + (asks ? '<div style="height:8px"></div>' + asks : '');
        } else {
            const section = _detail(m, 'Раздел'), type = _detail(m, 'Тип');
            body = '<h3>' + _esc(m.culture) + '</h3><div class="yr">' + _esc(m._yearsText) + '</div>' +
                (m.ruler ? '<div class="mm-row"><b>Правитель:</b> ' + _esc(m.ruler) + '</div>' : '') +
                (section || type ? '<div class="mm-row"><b>' + _esc(section) + '</b>' + (type ? ' · ' + _esc(type) : '') + '</div>' : '');
        }
        document.getElementById('mm-after').innerHTML = '<div class="mm-card mm-reveal">' + head + body +
            '<div style="height:12px"></div><button type="button" class="mm-go" data-mm="next-map">' + (_m.i + 1 < _m.maps.length ? 'Следующая карта →' : 'Итоги') + '</button></div>';
        if (all) _sfx('levelup');
    }

    function _summary() {
        const okN = _m.results.filter(r => r === true).length;
        _shell(_top('Итоги') +
            '<div class="mm-start mm-reveal"><div class="mm-big">' + (okN === _m.maps.length ? '🏆' : okN >= 3 ? '🗺️' : '🧭') + '</div>' +
            '<h2>' + okN + ' из ' + _m.maps.length + ' карт без ошибок</h2>' +
            '<p>' + (okN === _m.maps.length ? 'Идеально! Эти карты вернутся на повторение через несколько дней.' : 'Карты с ошибками вернутся в следующих сессиях — так они и запоминаются.') + '</p>' +
            '<button type="button" class="mm-go" data-mm="again">Ещё ' + PER_SESSION + ' карт</button>' +
            '<div style="height:10px"></div><button type="button" class="mm-back" data-mm="menu">К выбору карт</button></div>');
        try { if (window.updateProgressBars) window.updateProgressBars(); } catch (e) {}
    }

    function _begin() {
        const maps = _chooseMaps();
        if (!maps.length) { if (typeof showToast === 'function') showToast('🗺️', 'Карты ещё загружаются', 'bg-amber-500', 'border-amber-700'); return; }
        _m.maps = maps; _m.i = 0; _m.results = maps.map(() => null);
        _nextMap();
    }
    function _nextMap() {
        _m.qs = _questions(_m.maps[_m.i]); _m.qi = 0; _m.roundOk = true;
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
        const srcBtn = e.target.closest('[data-mm-src]');
        if (srcBtn) { _m.src = srcBtn.dataset.mmSrc; try { localStorage.setItem('map_mode_src', _m.src); } catch (er) {} _startScreen(); return; }
        const eraBtn = e.target.closest('[data-mm-era]');
        if (eraBtn) { _m.era = eraBtn.dataset.mmEra; try { localStorage.setItem('map_mode_era', _m.era); } catch (er) {} _startScreen(); return; }
        const opt = e.target.closest('[data-mm-opt]');
        if (opt) { _answer(+opt.dataset.mmOpt); return; }
        const a = e.target.closest('[data-mm]');
        if (!a) return;
        const act = a.dataset.mm;
        if (act === 'close') window.closeMapMode();
        else if (act === 'menu') _startScreen();
        else if (act === 'go' || act === 'again') _begin();
        else if (act === 'next-q') { _m.qi++; _renderRound(); }
        else if (act === 'next-map') { _m.i++; if (_m.i < _m.maps.length) _nextMap(); else _summary(); }
        else if (act === 'zoom') { const img = a.querySelector('img'); if (img) _zoom(img.getAttribute('src')); }
    }
    // Цифры 1–4 выбирают ответ (в «верно/неверно» — 1 и 2), Enter — «дальше».
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
        // Оба источника ленивые: учебные карты и банк ФИПИ. Ждём оба, но без одного из
        // них режим всё равно откроется — со вторым.
        await Promise.all([
            (async () => { try { if (!window.visualStudyData && typeof window.ensureVisualDataLoaded === 'function') await window.ensureVisualDataLoaded(); } catch (e) {} })(),
            (async () => { try { if (!window.EGE_EXAM_BANK && window.EgeExamMode && window.EgeExamMode.preload) await window.EgeExamMode.preload(); } catch (e) {} })(),
        ]);
        const hasAtlas = !!(window.visualStudyData && (window.visualStudyData.maps || []).length), hasFipi = !!(_prepFipi() || []).length;
        if (!hasAtlas && !hasFipi) {
            if (typeof showToast === 'function') showToast('🗺️', 'Карты не загрузились — проверь интернет', 'bg-amber-500', 'border-amber-700');
            return;
        }
        _css();
        let src = 'fipi', era = 'all';
        try { src = localStorage.getItem('map_mode_src') || 'fipi'; era = localStorage.getItem('map_mode_era') || 'all'; } catch (e) {}
        if (src === 'fipi' && !hasFipi) src = 'atlas';
        if (src === 'atlas' && !hasAtlas) src = 'fipi';
        if (!ERAS.some(x => x[0] === era)) era = 'all';
        _m = { src, era };
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
    window.MapMode = {
        atlas: () => _prepAtlas(), fipi: () => _prepFipi(),
        atlasQuestions: m => _atlasQuestions(m, _prepAtlas()), fipiQuestions: g => _fipiQuestions(g, _prepFipi()),
    };
})();
