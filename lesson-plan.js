// lesson-plan.js — «Урок»: путь по 23 главам истории для главной кнопки.
//
// Зачем (владелец 30.09.2026: «главную кнопку сделать ультимативной для обучения»).
// Раньше «Учим новое» брала невыученное из ВСЕГО периода вразброс: у топ-учеников
// ни одна глава не была закрыта (≈50% встречено и ≈45% выучено в каждой), и кнопка
// не могла сказать, где ученик находится. Теперь история разбита на главы, и урок
// ведёт по порядку: первая незакрытая глава — это и есть «сегодняшняя тема».
//
// Правила (проверены на живых учениках, см. AGENTS.md, журнал 30.09):
//  • Глава ЗАКРЫТА, когда встречено ≥90% её фактов и выучено ≥50% (уровень SRS ≥1).
//    Порог 50%, а не 80%: невыученный остаток закрытой главы не пропадает — он
//    приходит в таблицах повтора (каждая 2-я–3-я таблица урока), так что ученик
//    не застревает на одной главе неделями.
//  • Знающий главу (онлайн-школа, репетитор) закрывает её ЗА ОДИН ПРОХОД: если факты
//    главы с первого раза решены уверенно и верно (≥90% из встреченных впервые, а
//    таких ≥70% главы). Отметку «первого раза» пишет updateFactSRS (поле f).
//  • Порядок глав: сначала рамки ученика/класса по порядку, затем то, что после них
//    («забегаем вперёд»), и только потом то, что до них (если ученик сам выбрал,
//    например, XVIII век, — к Руси он придёт, когда закроет всё остальное).
//  • Ничего не хранится: путь каждый раз считается из factStreaks, поэтому он
//    одинаков на всех устройствах и сам подстраивается под смену класса и границы.
(function () {
    'use strict';

    const CHAPTERS = [
        ['Русь IX–X вв.', 862, 999], ['Русь XI–XII вв.', 1000, 1199], ['Русь XIII–XIV вв.', 1200, 1399],
        ['Иван III и Василий III', 1400, 1549], ['Иван Грозный', 1550, 1599], ['Смута и первые Романовы', 1600, 1649],
        ['Вторая половина XVII в.', 1650, 1699], ['Пётр I', 1700, 1725], ['Дворцовые перевороты', 1726, 1761],
        ['Екатерина II и Павел I', 1762, 1800], ['Александр I', 1801, 1825], ['Николай I', 1826, 1855],
        ['Александр II', 1856, 1881], ['Александр III и начало XX в.', 1882, 1904], ['1905 год и Первая мировая', 1905, 1916],
        ['Революция и Гражданская война', 1917, 1921], ['НЭП', 1922, 1929], ['СССР в 1930-е', 1930, 1940],
        ['Война: 1941–1942', 1941, 1942], ['Война: 1943–1945', 1943, 1945], ['СССР в 1946–1964', 1946, 1964],
        ['СССР в 1965–1991', 1965, 1991], ['Россия после 1991', 1992, 2026]
    ].map(function (c, i) { return { i: i, name: c[0], from: c[1], to: c[2] }; });

    const TASKS = ['task1', 'task3', 'task4', 'task5', 'task7'];
    const SEEN_SHARE = 0.9;       // встречено — чтобы закрыть главу
    const LEARNED_SHARE = 0.5;    // выучено — чтобы закрыть главу
    const FIRST_COVER = 0.7;      // «знаю главу»: столько её фактов решено впервые…
    const FIRST_ACC = 0.9;        // …и из них верно с первого раза
    const MIN_POOL = 8;           // меньше фактов типа в главе — окно расширяется соседями
    const MIN_YEAR = 862, MAX_YEAR = 2026;

    function _data(t) {
        if (t === 'task7') return window.task7Data || [];
        const cfg = (typeof TASK_CONFIG !== 'undefined') && TASK_CONFIG[t];
        return (cfg && cfg.data && cfg.data()) || [];
    }
    function _year(f) {
        if (typeof getYearFromFact === 'function') return getYearFromFact(f);
        const m = String((f && f.year) || '').match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
    }
    function chapterOf(y) {
        for (let i = 0; i < CHAPTERS.length; i++) if (y >= CHAPTERS[i].from && y <= CHAPTERS[i].to) return i;
        return -1;
    }

    // Индекс: по каждому заданию — уникальные ключи фактов с годом. Пересобирается,
    // если данные догрузились (сравниваем длины массивов).
    let _idx = null, _sig = '';
    function index() {
        const sig = TASKS.map(function (t) { return _data(t).length; }).join(',');
        if (_idx && sig === _sig) return _idx;
        const byTask = {}, all = new Map();
        TASKS.forEach(function (t) {
            const m = new Map();
            _data(t).forEach(function (f) {
                const y = _year(f);
                if (!(y >= MIN_YEAR && y <= MAX_YEAR)) return;
                let k;
                try { k = factKey(f, t); } catch (e) { return; }
                if (!k || m.has(k)) return;
                m.set(k, y);
                if (!all.has(k)) all.set(k, { y: y, t: t });
            });
            byTask[t] = m;
        });
        _idx = { byTask: byTask, all: all };
        _sig = sig;
        _probeCache.clear(); // данные поменялись — пробы сборки таблиц устарели
        return _idx;
    }

    // Счёт по окну лет [a, b]: сколько фактов, встречено, выучено, «первый раз».
    function windowStats(fs, a, b) {
        const s = { n: 0, seen: 0, learned: 0, firstN: 0, firstOk: 0, unseen: 0 };
        index().all.forEach(function (v, k) {
            if (v.y < a || v.y > b) return;
            s.n++;
            const d = fs[k];
            if (!d || typeof d !== 'object') { s.unseen++; return; }
            s.seen++;
            if ((d.level || 0) >= 1) s.learned++;
            if (d.f === 1 || d.f === 0) { s.firstN++; if (d.f === 1) s.firstOk++; }
        });
        s.closed = isClosed(s);
        s.knewIt = s.closed && s.learned < Math.ceil(LEARNED_SHARE * s.n);
        return s;
    }
    function isClosed(s) {
        if (!s.n) return true;
        if (s.seen < Math.ceil(SEEN_SHARE * s.n)) return false;
        if (s.learned >= Math.ceil(LEARNED_SHARE * s.n)) return true;
        return s.firstN >= Math.ceil(FIRST_COVER * s.n) && s.firstOk >= Math.ceil(FIRST_ACC * s.firstN);
    }

    // Отрезки пути. Рамки [from, to] режут главы по границе: часть главы до границы —
    // «в рамках», остаток — «впереди». Порядок: в рамках → после → до.
    function segments(from, to) {
        const inR = [], after = [], before = [];
        CHAPTERS.forEach(function (c) {
            const lo = Math.max(c.from, from), hi = Math.min(c.to, to);
            if (lo <= hi) {
                inR.push({ ch: c.i, from: lo, to: hi, zone: 'in' });
                if (hi < c.to) after.push({ ch: c.i, from: hi + 1, to: c.to, zone: 'after' });
                if (lo > c.from) before.push({ ch: c.i, from: c.from, to: lo - 1, zone: 'before' });
            } else if (c.from > to) after.push({ ch: c.i, from: c.from, to: c.to, zone: 'after' });
            else before.push({ ch: c.i, from: c.from, to: c.to, zone: 'before' });
        });
        return inR.concat(after, before);
    }

    // Главный расчёт. opts: { fs, from, to, pin } — pin: номер главы, выбранной
    // учеником вручную в «Пути» (действует на одно занятие).
    function plan(opts) {
        const fs = (opts && opts.fs) || {};
        const from = Math.max(MIN_YEAR, Number(opts && opts.from) || MIN_YEAR);
        const to = Math.min(MAX_YEAR, Number(opts && opts.to) || MAX_YEAR);
        const chapters = CHAPTERS.map(function (c) {
            const s = windowStats(fs, c.from, c.to);
            s.i = c.i; s.name = c.name; s.from = c.from; s.to = c.to;
            s.inRange = c.to >= from && c.from <= to;
            return s;
        });
        const segs = segments(from, to).map(function (g) {
            const s = windowStats(fs, g.from, g.to);
            s.ch = g.ch; s.from = g.from; s.to = g.to; s.zone = g.zone;
            s.name = CHAPTERS[g.ch].name;
            s.key = g.ch + ':' + g.from + '-' + g.to;
            return s;
        });
        let cur = null;
        const pin = opts && opts.pin;
        if (pin != null && CHAPTERS[pin]) {
            const c = CHAPTERS[pin], s = windowStats(fs, c.from, c.to);
            s.ch = pin; s.from = c.from; s.to = c.to; s.zone = 'pin'; s.name = c.name; s.key = pin + ':pin';
            cur = s;
        }
        if (!cur) cur = segs.find(function (s) { return !s.closed; }) || null;
        const inRange = chapters.filter(function (c) { return c.inRange; });
        return {
            chapters: chapters,
            cur: cur,
            from: from, to: to,
            closed: chapters.filter(function (c) { return c.closed; }).length,
            inRangeTotal: inRange.length,
            inRangeClosed: inRange.filter(function (c) { return c.closed; }).length,
            total: CHAPTERS.length
        };
    }

    // Невыученное (уровень <1, включая невиданное) по заданиям в окне лет.
    function unlearnedByTask(fs, a, b) {
        const by = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
        let total = 0;
        const idx = index();
        TASKS.forEach(function (t) {
            idx.byTask[t].forEach(function (y, k) {
                if (y < a || y > b) return;
                const d = fs[k];
                if (!(d && d.level >= 1)) { by[t]++; total++; }
            });
        });
        let bestTask = 'task4', bestN = -1;
        for (const t in by) if (by[t] > bestN) { bestN = by[t]; bestTask = t; }
        return { by: by, total: total, bestTask: bestTask };
    }

    function _countTask(t, a, b) {
        let n = 0;
        index().byTask[t].forEach(function (y) { if (y >= a && y <= b) n++; });
        return n;
    }
    // Хватит ли окна на честную таблицу из 4 строк. Минимумы подобраны прогоном
    // генератора по всем 23 главам × 5 заданиям (браузер, 30.09.2026):
    //  • задание 5: защита от двусмысленности (_task5GateOk) бракует строки, где
    //    деятель — правитель в годы другой строки или события взаимозаменяемы; в
    //    главе одного царствования это почти всегда — нужно ≥20 фактов и проба
    //    сборки (см. ниже);
    //  • задания 1 и 4: ответ — год, в строках нужны разные годы (у «Войны 1941–1942»
    //    их всего два);
    //  • задание 7: совместимость признаков культуры — ≥14 фактов.
    const TASK_MIN = { task1: MIN_POOL, task3: MIN_POOL, task4: MIN_POOL, task5: 20, task7: 14 };
    const TASK_MIN_YEARS = { task1: 6, task4: 6 };
    // Проба сборки (ставит ui.js — теми же проверками, что у генератора таблиц): окно
    // «Революция и Гражданская война» по заданию 5 проходит счёт фактов, но почти
    // каждая пара деятелей там взаимозаменяема — таблица не собиралась ни разу из 60.
    let _probe = null;
    const _probeCache = new Map();
    function setProbe(fn) { _probe = typeof fn === 'function' ? fn : null; _probeCache.clear(); }
    function _enough(t, a, b) {
        if (_countTask(t, a, b) < (TASK_MIN[t] || MIN_POOL)) return false;
        const needY = TASK_MIN_YEARS[t];
        if (needY) {
            const ys = new Set();
            index().byTask[t].forEach(function (y) { if (y >= a && y <= b) ys.add(y); });
            if (ys.size < needY) return false;
        }
        if (!_probe) return true;
        const key = t + ':' + a + '-' + b;
        if (!_probeCache.has(key)) {
            let ok = true;
            try { ok = !!_probe(t, a, b); } catch (e) { ok = true; }
            _probeCache.set(key, ok);
        }
        return _probeCache.get(key);
    }
    // Окно лет для таблиц задания t в главе: если фактов этого типа в главе мало
    // (у «Руси IX–X» по культуре — один), таблица не соберётся. Тогда окно растёт
    // сначала НАЗАД по главам (пройденное — полезный повтор, не ниже рамок ученика),
    // потом вперёд, и только в крайнем случае назад за рамки.
    function taskWindow(seg, t, floor) {
        let a = seg.from, b = seg.to;
        floor = Math.max(MIN_YEAR, Number(floor) || MIN_YEAR);
        let ci = chapterOf(a), cj = chapterOf(b);
        while (!_enough(t, a, b) && ci > 0 && CHAPTERS[ci - 1].to >= floor) { ci--; a = Math.max(floor, CHAPTERS[ci].from); }
        while (!_enough(t, a, b) && cj < CHAPTERS.length - 1) { cj++; b = CHAPTERS[cj].to; }
        while (!_enough(t, a, b) && ci > 0) { ci--; a = CHAPTERS[ci].from; }
        return { from: a, to: b };
    }

    // Оценка «сколько строк до закрытия главы»: невиданное до 90% + доучить до 50%
    // (факт в процессе — примерно ещё 2 верных ответа). Показывается на кнопке, чтобы
    // давний ученик видел: «Русь IX–X» у него не с нуля, а на 5 строк.
    function linesToClose(s) {
        if (!s || s.closed) return 0;
        return Math.max(0, Math.ceil(SEEN_SHARE * s.n) - s.seen) + Math.max(0, Math.ceil(LEARNED_SHARE * s.n) - s.learned) * 2;
    }

    // Сколько «долга» в окне: к повтору (выучено, срок прошёл) + ошибки. От этого
    // зависит, как часто в уроке идут таблицы повтора (каждая 2-я или 3-я).
    function backlog(fs, a, b, mistakesPool, now) {
        now = now || Date.now();
        let n = 0;
        index().all.forEach(function (v, k) {
            if (v.y < a || v.y > b) return;
            const d = fs[k];
            if (d && d.level > 0 && d.nextReview <= now) n++;
        });
        (mistakesPool || []).forEach(function (m) {
            const y = m && m.fact ? _year(m.fact) : 0;
            if (y >= a && y <= b) n++;
        });
        return n;
    }

    // ── «Путь по истории»: полоска под главной кнопкой и окно со списком глав ──
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function _pct(x, n) { return n ? Math.round(100 * x / n) : 0; }

    function _ensureCss() {
        if (document.getElementById('lp-css')) return;
        const st = document.createElement('style');
        st.id = 'lp-css';
        st.textContent = [
            '.lp-strip{display:flex;gap:2px;margin-top:10px;cursor:pointer;padding:4px 0}',
            '.lp-strip i{flex:1;height:6px;border-radius:999px;background:var(--c-border);display:block}',
            '.lp-strip i.is-out{opacity:.45}',
            '.lp-cap{display:flex;justify-content:space-between;gap:8px;font-size:var(--t-caption);font-weight:600;color:var(--c-muted);margin-top:2px;cursor:pointer}',
            '.lp-cap b{color:var(--c-text);font-weight:750}',
            '.lp-ov{position:fixed;inset:0;z-index:10050;background:var(--c-scrim, rgba(0,0,0,.55));display:flex;align-items:flex-end;justify-content:center}',
            '.lp-sheet{background:var(--c-card);color:var(--c-text);width:100%;max-width:560px;max-height:88vh;border-radius:14px 14px 0 0;box-shadow:var(--e-3);display:flex;flex-direction:column}',
            '@media (min-width:700px){.lp-ov{align-items:center}.lp-sheet{border-radius:14px}}',
            '.lp-head{padding:18px 16px 10px;border-bottom:1px solid var(--c-border-soft, var(--c-border))}',
            '.lp-head h2{margin:0;font-size:var(--t-title);font-weight:800}',
            '.lp-head p{margin:6px 0 0;font-size:var(--t-caption);color:var(--c-muted);line-height:1.4}',
            '.lp-list{overflow-y:auto;padding:6px 8px 8px;-webkit-overflow-scrolling:touch}',
            '.lp-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;color:inherit;padding:10px 8px;border-radius:8px;cursor:pointer;font:inherit}',
            '.lp-row:hover{background:var(--c-card-2)}',
            '.lp-row.is-cur{background:var(--c-card-2);outline:2px solid var(--c-brand);outline-offset:-2px}',
            '.lp-row.is-out{opacity:.6}',
            '.lp-num{width:28px;height:28px;flex-shrink:0;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:var(--t-micro);font-weight:800;background:var(--c-border);color:var(--c-text)}',
            '.lp-row.is-closed .lp-num{background:var(--c-success);color:#fff}',
            '.lp-row.is-cur .lp-num{background:var(--c-brand);color:#fff}',
            '.lp-mid{flex:1;min-width:0;display:block}',
            '.lp-name{display:block;font-size:var(--t-label);font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
            '.lp-sub{display:block;font-size:var(--t-micro);font-weight:600;color:var(--c-muted);margin-top:2px}',
            '.lp-bar{display:block;height:6px;border-radius:999px;background:var(--c-border);margin-top:6px;overflow:hidden;position:relative}',
            '.lp-bar s,.lp-bar u{text-decoration:none}',
            '.lp-bar s{position:absolute;left:0;top:0;bottom:0;background:var(--c-success-soft, rgba(16,185,129,.3));border-radius:999px}',
            '.lp-bar u{position:absolute;left:0;top:0;bottom:0;background:var(--c-success);border-radius:999px}',
            '.lp-go{flex-shrink:0;font-size:var(--t-caption);font-weight:750;color:var(--c-brand)}',
            '.lp-foot{padding:10px 16px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--c-border-soft, var(--c-border))}',
            '.lp-btn{flex:1;min-height:44px;border-radius:8px;border:0;font:inherit;font-size:var(--t-label);font-weight:750;cursor:pointer;background:var(--c-card-2);color:var(--c-text)}',
            '.lp-btn.is-main{background:var(--c-brand);color:#fff}'
        ].join('\n');
        document.head.appendChild(st);
    }

    // Полоска из 23 делений: закрытая глава — зелёная, текущая — синяя с долей
    // выученного, остальные — серые с бледной долей выученного; за рамками — тусклее.
    function stripHtml(p) {
        _ensureCss();
        const curCh = p.cur ? p.cur.ch : -1;
        return '<div class="lp-strip" data-lp-open="1" role="button" aria-label="Путь по истории: закрыто глав ' + p.closed + ' из ' + p.total + '">' +
            p.chapters.map(function (c) {
                const lp = _pct(c.learned, c.n);
                let bg;
                if (c.closed) bg = 'var(--c-success)';
                else if (c.i === curCh) bg = 'linear-gradient(90deg,var(--c-brand) ' + Math.max(12, lp) + '%,var(--c-border) ' + Math.max(12, lp) + '%)';
                else if (lp > 0) bg = 'linear-gradient(90deg,var(--c-success-soft, rgba(16,185,129,.35)) ' + lp + '%,var(--c-border) ' + lp + '%)';
                else bg = '';
                return '<i class="' + (c.inRange ? '' : 'is-out') + '"' + (bg ? ' style="background:' + bg + '"' : '') + ' title="' + esc(c.name) + '"></i>';
            }).join('') + '</div>';
    }

    // opts: { plan, rangeLabel, onChapter(i), onResetRange (или null) }
    function openPath(opts) {
        _ensureCss();
        const p = opts.plan;
        const old = document.getElementById('lp-ov');
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'lp-ov';
        ov.className = 'lp-ov';
        const curCh = p.cur ? p.cur.ch : -1;
        const rows = p.chapters.map(function (c) {
            const cls = ['lp-row', c.closed ? 'is-closed' : '', c.i === curCh ? 'is-cur' : '', c.inRange ? '' : 'is-out'].join(' ');
            let sub;
            if (c.closed) sub = c.knewIt ? '✓ закрыта — знал с первого раза' : '✓ закрыта · выучено ' + c.learned + ' из ' + c.n;
            else if (!c.seen) sub = c.n + ' фактов · ещё не начата';
            else sub = 'выучено ' + c.learned + ' из ' + c.n + ' · встречено ' + c.seen;
            return '<button type="button" class="' + cls + '" data-lp-ch="' + c.i + '">' +
                '<span class="lp-num">' + (c.closed ? '✓' : (c.i + 1)) + '</span>' +
                '<span class="lp-mid"><span class="lp-name">' + esc(c.name) + '</span>' +
                '<span class="lp-sub">' + c.from + '–' + (c.to === MAX_YEAR ? 'наши дни' : c.to) + ' · ' + esc(sub) + '</span>' +
                '<span class="lp-bar"><s style="width:' + _pct(c.seen, c.n) + '%"></s><u style="width:' + _pct(c.learned, c.n) + '%"></u></span></span>' +
                '<span class="lp-go">' + (c.i === curCh ? 'сейчас' : 'решать') + '</span></button>';
        }).join('');
        ov.innerHTML = '<div class="lp-sheet" role="dialog" aria-modal="true" aria-label="Путь по истории">' +
            '<div class="lp-head"><h2>Путь по истории · ' + p.closed + ' из ' + p.total + '</h2>' +
            '<p>Главная кнопка ведёт по главам по порядку. Глава закрыта, когда все её факты встречены и половина выучена. ' +
            'Уже знаешь главу — просто реши её: если отвечаешь верно с первого раза, она закроется за один проход. ' +
            'Невыученное из закрытых глав вернётся в таблицах повтора.' +
            (opts.rangeLabel ? '<br><b>' + esc(opts.rangeLabel) + '</b>' : '') + '</p></div>' +
            '<div class="lp-list">' + rows + '</div>' +
            '<div class="lp-foot">' +
            (opts.onResetRange ? '<button type="button" class="lp-btn" data-lp-reset="1">Сбросить свой период</button>' : '') +
            '<button type="button" class="lp-btn is-main" data-lp-close="1">Закрыть</button></div></div>';
        const close = function () { ov.remove(); document.removeEventListener('keydown', onKey, true); };
        const onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('[data-lp-close]')) return close();
            const r = e.target.closest('[data-lp-reset]');
            if (r) { close(); if (opts.onResetRange) opts.onResetRange(); return; }
            const b = e.target.closest('[data-lp-ch]');
            if (b) { close(); if (opts.onChapter) opts.onChapter(Number(b.dataset.lpCh)); }
        });
        document.body.appendChild(ov);
        const cur = ov.querySelector('.is-cur');
        if (cur && cur.scrollIntoView) try { cur.scrollIntoView({ block: 'center' }); } catch (e) {}
    }

    window.LessonPlan = {
        CHAPTERS: CHAPTERS,
        chapterOf: chapterOf,
        index: index,
        plan: plan,
        windowStats: windowStats,
        unlearnedByTask: unlearnedByTask,
        taskWindow: taskWindow,
        backlog: backlog,
        linesToClose: linesToClose,
        setProbe: setProbe,
        stripHtml: stripHtml,
        openPath: openPath,
        RULES: { SEEN_SHARE: SEEN_SHARE, LEARNED_SHARE: LEARNED_SHARE, FIRST_COVER: FIRST_COVER, FIRST_ACC: FIRST_ACC, MIN_POOL: MIN_POOL }
    };
})();
