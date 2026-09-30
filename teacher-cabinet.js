// teacher-cabinet.js — кабинет учителя: раскладка и отрисовка.
//
// Зачем (владелец 01.10.2026: «выглядит максимально костыльным, сложно найти
// ученика, чтобы посмотреть статистику»). Раньше каждый ученик был карточкой
// в экран высотой, 28 учеников = 28 экранов ленты, поиск — под блоком ДЗ, а
// над ним пять полей настроек. Теперь:
//   • «Ученики» — одна строка на человека, поиск и срезы сверху, нажатие
//     открывает карточку ученика со всей статистикой;
//   • «Домашние задания» — каждое выданное ДЗ со счётом «сдали X из Y» и
//     списком тех, кто не сдал;
//   • «Класс» — путь группы по 23 главам, где группа ошибается, топ недели.
//
// Данные не грузит: их собирает loadClassProgress (cloud-sync.js) и отдаёт
// сюда готовыми (computeStudentData). Здесь только раскладка, поэтому модуль
// обычный скрипт, а не часть модуля синхронизации.
(function () {
    'use strict';

    const TASKS = [
        ['task1', '№1', 'Хронология'], ['task3', '№3', 'Процессы'], ['task4', '№4', 'География'],
        ['task5', '№5', 'Личности'], ['task7', '№7', 'Культура']
    ];
    const TASK_SHORT = { task1: '№1', task3: '№3', task4: '№4', task5: '№5', task7: '№7', cram: 'Зубрёжка', match: 'Подбор' };
    const DAY = 86400000;

    const st = {
        students: [], code: '', upto: 0, note: '', status: 'idle', error: '',
        tab: 'students', seg: 'all', sort: 'week', q: '',
        openUid: null, listScroll: 0, hwOpen: null, showAllMistakes: false,
        contacts: {}, contactsFor: ''
    };
    const _pathCache = new Map();

    // ── мелочи ───────────────────────────────────────────────────────────
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function plural(n, one, few, many) {
        const a = Math.abs(n) % 100, b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b > 1 && b < 5) return few;
        if (b === 1) return one;
        return many;
    }
    function num(n) { return Number(n || 0).toLocaleString('ru-RU'); }
    function dateShort(iso) {
        if (!iso) return '';
        const d = typeof iso === 'number' ? new Date(iso) : new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
        return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
    }
    function hue(s) {
        let h = 2166136261;
        for (const c of String(s || 'x')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
        return h % 360;
    }
    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
        return esc(((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase());
    }
    function avatar(s, big) {
        const h = hue(s.uid || s.name);
        return `<span class="tcab-av${big ? ' is-big' : ''}" style="--h:${h}">${initials(s.name)}</span>`;
    }
    function seenText(s) {
        if (!s.lastActive) return 'ещё не заходил(а)';
        const d = new Date(s.lastActive);
        const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
        if (diff <= 0) return 'сегодня в ' + hm;
        if (diff === 1) return 'вчера в ' + hm;
        if (diff < 7) return diff + ' ' + plural(diff, 'день', 'дня', 'дней') + ' назад';
        return dateShort(s.lastActive);
    }
    function week(s) { return (s.last7 || []).reduce((n, d) => n + (d.val || 0), 0); }
    function accClass(a) { return a == null ? '' : a >= 80 ? 'is-good' : a >= 65 ? '' : 'is-bad'; }
    function isQuiet(s) { return (s.daysSinceActive || 0) >= 3; }
    function isNewbie(s) { return (s.totalSolved || 0) < 10; }
    function hasDebt(s) { return s.hwStatus === 'overdue' || s.hwStatus === 'pending'; }
    function isWeak(s) { return s.accuracy != null && s.accuracy < 70 && (s.totalAttempts || 0) >= 20; }

    // ── путь по главам (та же логика, что у главной кнопки ученика) ────────
    // Глава закрыта по правилам LessonPlan; «сейчас» — первая незакрытая в рамках
    // класса (862…«дошли до»), затем то, что после рамок. Рамки учителя, а не
    // личный период ученика: учителю важно, где ученик относительно программы.
    function path(s) {
        const LP = window.LessonPlan;
        if (!LP || !s.factStreaks) return null;
        const key = s.uid + '|' + st.upto + '|' + (s.lastActive || 0);
        if (_pathCache.has(key)) return _pathCache.get(key);
        const to = st.upto >= 862 ? st.upto : 2026;
        let chapters;
        try { chapters = LP.CHAPTERS.map(c => { const w = LP.windowStats(s.factStreaks, c.from, c.to); w.i = c.i; w.name = c.name; w.from = c.from; w.to = c.to; return w; }); }
        catch (e) { return null; }
        const order = chapters.filter(c => c.from <= to).concat(chapters.filter(c => c.from > to));
        const cur = order.find(c => !c.closed) || null;
        const inRange = chapters.filter(c => c.from <= to);
        const res = {
            chapters, cur,
            closed: chapters.filter(c => c.closed).length,
            closedInRange: inRange.filter(c => c.closed).length,
            inRange: inRange.length
        };
        _pathCache.set(key, res);
        return res;
    }

    // ── ДЗ: статус одним словом ─────────────────────────────────────────
    const HW = {
        overdue: ['просрочено', 'is-bad'],
        pending: ['не открыл(а)', 'is-warn'],
        active: ['в работе', 'is-info'],
        done: ['сдано', 'is-good'],
        none: ['нет ДЗ', 'is-mute']
    };
    function hwPill(s) {
        const m = HW[s.hwStatus] || HW.none;
        const sub = (s.hwStatus === 'active' || s.hwStatus === 'overdue' || s.hwStatus === 'pending') && s.hwRemaining
            ? `<span class="tcab-hwsub">осталось ${num(s.hwRemaining)}${s.hwDeadline ? ' · до ' + dateShort(s.hwDeadline) : ''}</span>` : '';
        return `<span class="tcab-pill ${m[1]}">${m[0]}</span>${sub}`;
    }
    function itemsText(items) {
        if (!Array.isArray(items) || !items.length) return '';
        return items.map(it => {
            const unit = it.task === 'match' ? 'пар' : it.metric === 'points' ? 'баллов' : it.metric === 'learned' ? 'фактов' : 'строк';
            return `${TASK_SHORT[it.task] || it.task} — ${num(it.goal)} ${unit}`;
        }).join(', ');
    }

    // ── каркас ──────────────────────────────────────────────────────────
    function root() { return document.getElementById('tcab-body'); }

    function render() {
        const el = root(); if (!el) return;
        document.querySelectorAll('#teacher-modal .tcab-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
        const note = document.getElementById('teacher-filter-mode-note');
        if (note) { note.textContent = st.note || ''; note.classList.toggle('hidden', !st.note); }
        if (st.status === 'loading' && !st.students.length) { el.innerHTML = skeleton(); return; }
        if (st.status === 'error') { el.innerHTML = `<div class="tcab-empty is-bad">${esc(st.error)}<br><button class="tcab-btn" data-act="reload">Обновить</button></div>`; return; }
        if (st.openUid) {
            const s = st.students.find(x => x.uid === st.openUid);
            if (s) { el.innerHTML = studentView(s); el.scrollTop = 0; return; }
            st.openUid = null;
        }
        if (!st.students.length) {
            el.innerHTML = `<div class="tcab-empty"><b>В группе пока никого</b>Отправьте ученикам ссылку-приглашение — они появятся здесь сразу после входа.<br><button class="tcab-btn is-primary" data-act="invite">Скопировать приглашение</button></div>`;
            return;
        }
        el.innerHTML = st.tab === 'hw' ? hwView() : st.tab === 'class' ? classView() : studentsView();
        if (st.tab === 'students') {
            el.scrollTop = st.listScroll || 0;
            const q = document.getElementById('tcab-q');
            if (q && st._focusQ) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); st._focusQ = false; }
        }
    }
    function skeleton() {
        return `<div class="tcab-loading" id="tcab-progress">${st.total ? `Загружаем прогресс учеников: ${st.loaded} из ${st.total}` : 'Загружаем учеников…'}</div><div class="tcab-metrics">${'<div class="tcab-m is-skel"></div>'.repeat(4)}</div>` +
            `<div class="tcab-list">${'<div class="tcab-row is-skel"></div>'.repeat(6)}</div>`;
    }

    // ── вкладка «Ученики» ───────────────────────────────────────────────
    const SEGS = [
        ['all', 'Все', () => true],
        ['quiet', 'Молчат 3+ дня', isQuiet],
        ['debt', 'Долги по ДЗ', hasDebt],
        ['weak', 'Точность ниже 70%', isWeak],
        ['new', 'Ещё не начали', isNewbie]
    ];
    const SORTS = [
        ['week', 'Больше решили за 7 дней'], ['name', 'По имени'], ['acc', 'Хуже точность'],
        ['path', 'Дальше по курсу'], ['seen', 'Дольше не заходили'], ['hw', 'Долги по ДЗ сверху'], ['total', 'Всего решено']
    ];
    function sorted(list) {
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        const hwRank = s => ({ overdue: 0, pending: 1, active: 2, done: 3, none: 4 }[s.hwStatus] ?? 4);
        const pathN = s => { const p = path(s); return p ? p.closed : -1; };
        const f = {
            week: (a, b) => week(b) - week(a) || byName(a, b),
            name: byName,
            acc: (a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || byName(a, b),
            path: (a, b) => pathN(b) - pathN(a) || byName(a, b),
            seen: (a, b) => (a.lastActive || 0) - (b.lastActive || 0),
            hw: (a, b) => hwRank(a) - hwRank(b) || (b.hwRemaining || 0) - (a.hwRemaining || 0) || byName(a, b),
            total: (a, b) => (b.totalSolved || 0) - (a.totalSolved || 0)
        }[st.sort] || byName;
        return list.slice().sort(f);
    }
    function studentsView() {
        const all = st.students, n = all.length;
        const today = all.filter(s => s.isToday).length;
        const active7 = all.filter(s => week(s) > 0).length;
        const quiet = all.filter(isQuiet).length;
        const withHw = all.filter(s => s.hwStatus && s.hwStatus !== 'none');
        const hwDone = withHw.filter(s => s.hwStatus === 'done').length;
        const q = st.q.trim().toLowerCase();
        const seg = SEGS.find(x => x[0] === st.seg) || SEGS[0];
        let list = all.filter(seg[2]);
        if (q) list = list.filter(s => String(s.name || '').toLowerCase().includes(q)
            || String(s.tgId || s.knownTgId || '').includes(q) || (st.contacts[s.uid] || '').toLowerCase().includes(q.replace(/^@/, '')));
        list = sorted(list);

        const metrics = `<div class="tcab-metrics">
            <div class="tcab-m"><b>${today}<small> из ${n}</small></b><span>занимались сегодня</span></div>
            <div class="tcab-m"><b>${active7}</b><span>активны за 7 дней</span></div>
            <button class="tcab-m${quiet ? ' is-alert' : ''}" data-act="seg" data-v="quiet"><b>${quiet}</b><span>молчат 3+ дня</span></button>
            <button class="tcab-m" data-act="tab" data-v="hw"><b>${withHw.length ? `${hwDone}<small> из ${withHw.length}</small>` : '—'}</b><span>${withHw.length ? 'сдали ДЗ' : 'ДЗ не выдано'}</span></button>
        </div>`;
        const chips = SEGS.map(([k, label, fn]) => {
            const c = all.filter(fn).length;
            if (k !== 'all' && !c && st.seg !== k) return '';
            return `<button class="tcab-chip" aria-pressed="${st.seg === k}" data-act="seg" data-v="${k}">${label} <span>${c}</span></button>`;
        }).join('');
        const tools = `<div class="tcab-tools">
            <label class="tcab-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
                <input id="tcab-q" type="search" placeholder="Поиск: имя или @ник" value="${esc(st.q)}" autocomplete="off"></label>
            <select id="tcab-sort" aria-label="Сортировка">${SORTS.map(([k, t]) => `<option value="${k}"${st.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div class="tcab-chips">${chips}</div>`;
        const head = `<div class="tcab-row is-head"><span>Ученик</span><span>7 дней</span><span class="c-num">Строк</span><span class="c-num">Точность</span><span>Путь по курсу</span><span>ДЗ</span></div>`;
        const rows = list.map(rowHtml).join('') || `<div class="tcab-empty">${q ? 'Никого не нашли по запросу «' + esc(st.q) + '»' : 'В этом срезе никого нет'}</div>`;
        return metrics + tools + `<div class="tcab-list">${head}${rows}</div>`;
    }
    function bars(days, cls) {
        const max = Math.max(1, ...days.map(d => d.val || 0));
        return `<span class="tcab-bars ${cls || ''}">${days.map((d, i) => `<i style="height:${d.val ? Math.max(12, Math.round(d.val / max * 100)) : 6}%" class="${d.val ? (i === days.length - 1 ? 'is-today' : 'is-on') : ''}" title="${esc(dateShort(d.date))}: ${d.val || 0} ${plural(d.val || 0, 'строка', 'строки', 'строк')}"></i>`).join('')}</span>`;
    }
    function pathCell(s) {
        const p = path(s);
        if (!p) return '<span class="tcab-mute">—</span>';
        const label = p.cur ? `гл. ${p.cur.i + 1} · ${esc(p.cur.name)}` : 'курс пройден';
        return `<span class="tcab-path"><span class="t" title="${esc(label)}">${label}</span><span class="tcab-bar"><i style="width:${Math.round(p.closed / p.chapters.length * 100)}%"></i></span></span>`;
    }
    function rowHtml(s) {
        const w = week(s);
        return `<button class="tcab-row" data-act="open" data-uid="${esc(s.uid)}" data-student-uid="${esc(s.uid)}">
            <span class="c-who">${avatar(s)}<span class="c-name"><b>${esc(s.name || 'Без имени')}</b><i class="${isQuiet(s) ? 'is-bad' : ''}">${esc(seenText(s))}</i></span></span>
            <span class="c-bars">${bars(s.last7 || [])}</span>
            <span class="c-num"><b>${num(w)}</b></span>
            <span class="c-num ${accClass(s.accuracy)}">${s.accuracy == null ? '—' : s.accuracy + '%'}</span>
            <span class="c-path">${pathCell(s)}</span>
            <span class="c-hw">${hwPill(s)}</span>
        </button>`;
    }

    // ── карточка ученика ────────────────────────────────────────────────
    function studentView(s) {
        const uname = st.contacts[s.uid];
        const isAdmin = !!window._isGlobalAdmin;
        const time = s.timeSpentMin >= 60 ? `${Math.floor(s.timeSpentMin / 60)} ч ${s.timeSpentMin % 60} мин` : `${s.timeSpentMin || 0} мин`;
        const p = path(s);
        const w = week(s);
        const meta = [seenText(s), uname ? '@' + esc(uname) : '', 'ID ' + esc(s.tgId || s.knownTgId || s.uid)].filter(Boolean).join(' · ');
        const write = uname
            ? `<button class="tcab-btn" data-act="write" data-v="${esc(uname)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/></svg>Написать</button>`
            : `<button class="tcab-btn" data-act="nowrite" title="У ученика нет @username в Telegram">Написать</button>`;
        const head = `<div class="tcab-sv-top">
            <button class="tcab-back" data-act="back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Все ученики</button>
        </div>
        <div class="tcab-sv-head">
            ${avatar(s, true)}
            <div class="c-name"><b>${esc(s.name || 'Без имени')}</b><i>${meta}</i></div>
            <div class="tcab-sv-actions">
                ${write}
                <button class="tcab-btn" data-act="pdf" data-uid="${esc(s.uid)}">Отчёт PDF</button>
                <button class="tcab-btn is-primary" data-act="assign" data-uid="${esc(s.uid)}">Выдать ДЗ</button>
                <details class="tcab-more"><summary class="tcab-btn" aria-label="Ещё">⋯</summary><div class="tcab-menu">
                    <button data-act="hwlist" data-uid="${esc(s.uid)}">Его ДЗ, отмена, убрать из группы</button>
                    ${isAdmin ? `<button data-act="merge" data-uid="${esc(s.uid)}">Объединить с другим аккаунтом</button>` : ''}
                    <button data-act="copyid" data-v="${esc(s.tgId || s.knownTgId || s.uid)}">Скопировать ID</button>
                </div></details>
            </div>
        </div>`;
        const kpis = `<div class="tcab-metrics is-5">
            <div class="tcab-m"><b>${num(w)}</b><span>строк за 7 дней</span></div>
            <div class="tcab-m"><b>${num(s.totalSolved)}</b><span>всего решено</span></div>
            <div class="tcab-m"><b class="${accClass(s.accuracy)}">${s.accuracy == null ? '—' : s.accuracy + '%'}</b><span>точность</span></div>
            <div class="tcab-m"><b>${num(s.learnedCount)}</b><span>фактов выучено</span></div>
            <div class="tcab-m"><b>${num(s.streak)}</b><span>${plural(s.streak || 0, 'день', 'дня', 'дней')} подряд</span></div>
        </div>`;
        const days = s.last14 || s.last7 || [];
        const activity = `<section class="tcab-sec"><h4>Активность за 14 дней <span>${esc(time)} в приложении всего</span></h4>
            ${bars(days, 'is-wide')}
            <div class="tcab-daylabels">${days.map((d, i) => `<span>${i % 2 ? '' : esc(dateShort(d.date))}</span>`).join('')}</div></section>`;
        const pathSec = p ? `<section class="tcab-sec"><h4>Путь по курсу <span>${p.cur ? `сейчас: глава ${p.cur.i + 1} «${esc(p.cur.name)}», ${p.cur.progress}%` : 'все главы закрыты'} · закрыто ${p.closed} из ${p.chapters.length}</span></h4>
            <div class="tcab-chapters">${p.chapters.map(c => `<i class="${c.closed ? 'is-done' : p.cur && c.i === p.cur.i ? 'is-cur' : ''}${st.upto && c.from > st.upto ? ' is-ahead' : ''}" title="${c.i + 1}. ${esc(c.name)} (${c.from}–${c.to}): ${c.closed ? 'закрыта' : c.progress + '%'}"></i>`).join('')}</div>
            <div class="tcab-legend"><span><i class="is-done"></i>закрыта</span><span><i class="is-cur"></i>сейчас</span><span><i></i>впереди</span>${st.upto ? `<span>рамка класса — до ${st.upto} г.</span>` : ''}</div></section>` : '';

        const sbt = s.solvedByTask || {}, mbt = s.mistakesByTask || {};
        const ts = {}; (s.taskStats || []).forEach(t => { ts[t.key] = t; });
        const taskRows = TASKS.map(([k, n, label]) => {
            const t = ts[k] || {};
            return `<tr><td><b>${n}</b> ${label}</td><td class="c-num">${num(sbt[k] || 0)}</td><td class="c-num ${accClass(t.pct)}">${t.pct == null ? '—' : t.pct + '%'}</td><td class="c-num">${num(t.learned || 0)}</td><td class="c-num ${mbt[k] ? 'is-bad' : 'tcab-mute'}">${mbt[k] || '—'}</td></tr>`;
        }).join('');
        const tasks = `<section class="tcab-sec"><h4>По номерам заданий</h4>
            <table class="tcab-table"><thead><tr><th></th><th>решено</th><th>точность</th><th>выучено</th><th>ошибок</th></tr></thead><tbody>${taskRows}</tbody></table></section>`;
        const eras = Object.values(s.eraData || {}).filter(e => e && e.total);
        const eraSec = eras.length ? `<section class="tcab-sec"><h4>Точность по эпохам</h4>${eras.map(e =>
            `<div class="tcab-era"><span>${esc(e.name)}</span><span class="tcab-bar"><i class="${accClass(e.pct)}" style="width:${e.pct}%"></i></span><b class="${accClass(e.pct)}">${e.pct}%</b></div>`).join('')}</section>` : '';

        const pool = Array.isArray(s.mistakes) ? s.mistakes.filter(m => m && m.fact) : [];
        const lines = window._studentMistakeLines;
        const shown = st.showAllMistakes ? pool : pool.slice(0, 6);
        const mist = `<section class="tcab-sec"><h4>Ошибается сейчас <span>${pool.length ? pool.length + ' ' + plural(pool.length, 'факт', 'факта', 'фактов') + ' в работе над ошибками' : ''}</span></h4>${pool.length ? shown.map(m => {
            const parts = lines ? lines(m) : [];
            const right = (parts.find(x => x.kind === 'correct') || {}).text || '';
            const wrong = parts.filter(x => x.kind !== 'correct').map(x => `<i class="${x.kind === 'chosen' ? '' : 'is-mute'}">${esc(x.text)}</i>`).join('');
            return `<div class="tcab-mistake"><span class="tcab-tag">${TASK_SHORT[m.task] || '№4'}</span><div><b>${esc(right.replace(/^Верная строка:\s*/, ''))}</b>${wrong}</div></div>`;
        }).join('') + (pool.length > 6 && !st.showAllMistakes ? `<button class="tcab-link" data-act="allmist">Показать все ${pool.length}</button>` : '')
            : '<div class="tcab-mute">Ошибок в работе нет</div>'}</section>`;

        const hwList = (s.hwPerAssignment || []).slice().sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
        const now = Date.now();
        const hw = `<section class="tcab-sec"><h4>Домашние задания ${s.hwOnTimeTotal || s.hwLateTotal ? `<span>вовремя сдано ${s.hwOnTimeTotal || 0}, с опозданием ${s.hwLateTotal || 0}</span>` : ''}</h4>${hwList.length ? hwList.map(a => {
            const late = a.state !== 'done' && a.deadline && new Date(a.deadline + 'T23:59:59').getTime() < now;
            const m = a.state === 'done' ? HW.done : late ? HW.overdue : a.state === 'pending' ? HW.pending : HW.active;
            return `<div class="tcab-hwrow"><div><b>${esc(a.title || itemsText(a.items) || 'Домашнее задание')}</b><i>${a.assignedAt ? 'выдано ' + dateShort(a.assignedAt) : ''}${a.deadline ? ' · срок ' + dateShort(a.deadline) : ''}${a.title && a.items ? ' · ' + esc(itemsText(a.items)) : ''}</i></div><span class="tcab-pill ${m[1]}">${m[0]}</span></div>`;
        }).join('') : '<div class="tcab-mute">ДЗ не выдавалось</div>'}</section>`;

        const sp = s.secondPart;
        const spSec = (sp && (sp.todo || sp.waiting || sp.reviewed)) ? `<section class="tcab-sec"><h4>Вторая часть</h4><div class="tcab-kv">
            <span>проверено <b>${sp.reviewed || 0}</b></span>${sp.waiting ? `<span>на проверке <b>${sp.waiting}</b></span>` : ''}${sp.todo ? `<span class="is-bad">не сдано <b>${sp.todo}</b></span>` : ''}${sp.maxScore ? `<span>баллы <b>${sp.score}/${sp.maxScore}</b></span>` : ''}</div></section>` : '';

        return head + kpis + activity + pathSec + `<div class="tcab-two">${tasks}${eraSec}</div>` + mist + hw + spSec;
    }

    // ── вкладка «Домашние задания» ──────────────────────────────────────
    function hwGroups() {
        const map = new Map(), now = Date.now();
        st.students.forEach(s => (s.hwPerAssignment || []).forEach(a => {
            const key = a.id || a.title || '?';
            let g = map.get(key);
            if (!g) { g = { id: key, title: a.title, items: a.items, deadline: a.deadline, assignedAt: a.assignedAt || 0, rows: [] }; map.set(key, g); }
            if ((a.assignedAt || 0) > g.assignedAt) g.assignedAt = a.assignedAt;
            if (!g.items && a.items) g.items = a.items;
            if (a.deadline && (!g.deadline || a.deadline > g.deadline)) g.deadline = a.deadline;
            const late = a.state !== 'done' && a.deadline && new Date(a.deadline + 'T23:59:59').getTime() < now;
            g.rows.push({ s, state: a.state === 'done' ? 'done' : late ? 'overdue' : a.state === 'pending' ? 'pending' : 'active' });
        }));
        return [...map.values()].sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
    }
    function hwView() {
        const groups = hwGroups();
        const late = st.students.filter(s => s.hwStatus === 'overdue');
        const top = `<div class="tcab-bar-actions">
            <button class="tcab-btn is-primary" data-act="assignclass">Выдать ДЗ группе</button>
            <button class="tcab-btn" data-act="hwjournal">Журнал и отмена ДЗ</button>
        </div>`;
        const lateSec = late.length ? `<section class="tcab-sec"><h4>Просрочили <span>${late.length} ${plural(late.length, 'ученик', 'ученика', 'учеников')}</span></h4>
            <div class="tcab-people">${late.map(s => `<button class="tcab-person" data-act="open" data-uid="${esc(s.uid)}">${avatar(s)}<span><b>${esc(s.name || 'Без имени')}</b><i>осталось ${num(s.hwRemaining)}${s.hwDeadline ? ' · срок ' + dateShort(s.hwDeadline) : ''}</i></span></button>`).join('')}</div></section>` : '';
        if (!groups.length) return top + `<div class="tcab-empty"><b>ДЗ пока не выдавали</b>Выданное задание появится здесь: кто сдал, кто в работе, кто ещё не открыл.</div>`;
        const cards = groups.map(g => {
            const done = g.rows.filter(r => r.state === 'done').length, total = g.rows.length;
            const pct = total ? Math.round(done / total * 100) : 0;
            const open = st.hwOpen === g.id;
            const order = { overdue: 0, pending: 1, active: 2, done: 3 };
            const people = open ? `<div class="tcab-people">${g.rows.slice().sort((a, b) => order[a.state] - order[b.state] || String(a.s.name).localeCompare(String(b.s.name), 'ru')).map(r =>
                `<button class="tcab-person" data-act="open" data-uid="${esc(r.s.uid)}">${avatar(r.s)}<span><b>${esc(r.s.name || 'Без имени')}</b></span><span class="tcab-pill ${HW[r.state][1]}">${HW[r.state][0]}</span></button>`).join('')}</div>` : '';
            const expired = g.deadline && new Date(g.deadline + 'T23:59:59').getTime() < Date.now();
            return `<div class="tcab-hwcard${open ? ' is-open' : ''}">
                <button class="tcab-hwhead" data-act="hwopen" data-v="${esc(g.id)}">
                    <span class="t"><b>${esc(g.title || itemsText(g.items) || 'Домашнее задание')}</b><i>${g.assignedAt ? 'выдано ' + dateShort(g.assignedAt) : ''}${g.deadline ? ` · срок ${dateShort(g.deadline)}${expired ? ' (прошёл)' : ''}` : ' · без срока'}${g.title && g.items ? ' · ' + esc(itemsText(g.items)) : ''}</i></span>
                    <span class="n"><b>${done}</b> из ${total} сдали</span>
                    <span class="tcab-bar"><i class="${pct >= 80 ? 'is-good' : pct >= 40 ? '' : 'is-bad'}" style="width:${pct}%"></i></span>
                </button>${people}</div>`;
        }).join('');
        return top + lateSec + `<section class="tcab-sec"><h4>Выданные задания <span>нажмите, чтобы увидеть, кто сдал</span></h4>${cards}</section>`;
    }

    // ── вкладка «Класс» ─────────────────────────────────────────────────
    function classView() {
        const all = st.students, n = all.length;
        let accN = 0, accD = 0, learned = 0, onTime = 0, lateN = 0, week7 = 0;
        all.forEach(s => { accN += s.totalCorrect || 0; accD += s.totalAttempts || 0; learned += s.learnedCount || 0; onTime += s.hwOnTimeTotal || 0; lateN += s.hwLateTotal || 0; week7 += week(s); });
        const acc = accD >= 20 ? Math.round(accN / accD * 100) : null;
        const onTimePct = onTime + lateN ? Math.round(onTime / (onTime + lateN) * 100) : null;
        const metrics = `<div class="tcab-metrics">
            <div class="tcab-m"><b>${num(week7)}</b><span>строк решено за 7 дней</span></div>
            <div class="tcab-m"><b class="${accClass(acc)}">${acc == null ? '—' : acc + '%'}</b><span>средняя точность</span></div>
            <div class="tcab-m"><b>${num(n ? Math.round(learned / n) : 0)}</b><span>выучено фактов в среднем</span></div>
            <div class="tcab-m"><b>${onTimePct == null ? '—' : onTimePct + '%'}</b><span>ДЗ сдают вовремя</span></div>
        </div>`;

        // Путь группы: по каждой главе — сколько закрыли и сколько сейчас на ней.
        const LP = window.LessonPlan;
        let pathSec = '';
        if (LP) {
            const paths = all.map(path).filter(Boolean);
            if (paths.length) {
                const rows = LP.CHAPTERS.map(c => {
                    const closed = paths.filter(p => p.chapters[c.i] && p.chapters[c.i].closed).length;
                    const here = paths.filter(p => p.cur && p.cur.i === c.i).length;
                    const pct = Math.round(closed / paths.length * 100);
                    const ahead = st.upto && c.from > st.upto;
                    return `<div class="tcab-ch${ahead ? ' is-ahead' : ''}"><span class="t"><b>${c.i + 1}.</b> ${esc(c.name)}</span><span class="tcab-bar"><i style="width:${pct}%"></i></span><span class="n">${closed} из ${paths.length}</span><span class="h">${here ? `сейчас ${here}` : ''}</span></div>`;
                }).join('');
                pathSec = `<section class="tcab-sec"><h4>Путь группы по главам <span>закрыли главу · сколько учеников сейчас на ней${st.upto ? ` · серым — после рамки «дошли до ${st.upto} г.»` : ''}</span></h4>${rows}</section>`;
            }
        }

        const byKey = {};
        all.forEach(s => (s.mistakeList || []).forEach(m => {
            const k = m.task + '|' + m.label;
            (byKey[k] = byKey[k] || { task: m.task, label: m.label, who: [] }).who.push(s.name || 'Без имени');
        }));
        // Только общие ошибки (у двух и больше): личные видны в карточке ученика,
        // а здесь учителю нужно понять, что разобрать со всей группой.
        const top = Object.values(byKey).filter(m => m.who.length >= 2).sort((a, b) => b.who.length - a.who.length).slice(0, 12);
        const mistSec = `<section class="tcab-sec"><h4>Где группа ошибается <span>факты, которые сейчас в работе над ошибками у нескольких учеников</span></h4>${top.length ? top.map(m =>
            `<div class="tcab-mistake"><span class="tcab-tag">${TASK_SHORT[m.task] || '№4'}</span><div><b>${esc(m.label)}</b><i class="is-mute" title="${esc(m.who.join(', '))}">${m.who.length} ${plural(m.who.length, 'ученик', 'ученика', 'учеников')}: ${esc(m.who.slice(0, 4).join(', '))}${m.who.length > 4 ? '…' : ''}</i></div></div>`).join('') : '<div class="tcab-mute">Общих ошибок нет: у каждого свои, они видны в карточке ученика</div>'}</section>`;

        const agg = {}; TASKS.forEach(([k]) => { agg[k] = { c: 0, t: 0, solved: 0 }; });
        all.forEach(s => { (s.taskStats || []).forEach(t => { if (agg[t.key]) { agg[t.key].c += t.correct || 0; agg[t.key].t += t.total || 0; } }); TASKS.forEach(([k]) => { agg[k].solved += (s.solvedByTask || {})[k] || 0; }); });
        const taskSec = `<section class="tcab-sec"><h4>Точность по номерам</h4>${TASKS.map(([k, nn, label]) => {
            const a = agg[k], pct = a.t ? Math.round(a.c / a.t * 100) : null;
            return `<div class="tcab-era"><span><b>${nn}</b> ${label}</span><span class="tcab-bar"><i class="${accClass(pct)}" style="width:${pct || 0}%"></i></span><b class="${accClass(pct)}">${pct == null ? '—' : pct + '%'}</b></div>`;
        }).join('')}</section>`;

        const leaders = all.filter(s => (s.wScore || 0) > 0).sort((a, b) => (b.wScore || 0) - (a.wScore || 0)).slice(0, 10);
        const topSec = `<section class="tcab-sec"><h4>Топ недели <span>строк с понедельника</span></h4>${leaders.length ? leaders.map((s, i) =>
            `<button class="tcab-person is-rank" data-act="open" data-uid="${esc(s.uid)}"><span class="r">${i + 1}</span>${avatar(s)}<span><b>${esc(s.name || 'Без имени')}</b></span><span class="n">${num(s.wScore)}</span></button>`).join('') : '<div class="tcab-mute">На этой неделе пока тихо</div>'}</section>`;

        return metrics + `<div class="tcab-bar-actions"><button class="tcab-btn" data-act="classpdf">Скачать PDF-сводку группы</button></div>`
            + pathSec + `<div class="tcab-two">${mistSec}<div>${taskSec}${topSec}</div></div>`;
    }

    // ── события ─────────────────────────────────────────────────────────
    function openStudent(uid) {
        const el = root();
        if (el && !st.openUid) st.listScroll = el.scrollTop;
        st.openUid = uid; st.showAllMistakes = false;
        render();
        if (window.pushBackHandler) window.pushBackHandler('tcab:student', () => { st.openUid = null; render(); });
    }
    function back() {
        st.openUid = null;
        if (window.popBackHandler) window.popBackHandler('tcab:student');
        render();
    }
    function toast(icon, text, ok) {
        if (typeof showToast === 'function') showToast(icon, text, ok ? 'bg-emerald-500' : 'bg-amber-500', ok ? 'border-emerald-700' : 'border-amber-700');
    }
    function openTelegram(username) {
        const url = 'https://t.me/' + encodeURIComponent(username);
        try {
            const tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.initData && tg.openTelegramLink) { tg.openTelegramLink(url); return; }
        } catch (e) {}
        window.open(url, '_blank', 'noopener');
    }
    function copy(text, done) {
        const ok = () => toast('📋', done, true);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(() => {});
        else ok();
    }
    function onClick(e) {
        const t = e.target.closest('[data-act]');
        if (!t || !t.closest('#teacher-modal')) return;
        const act = t.dataset.act, uid = t.dataset.uid, v = t.dataset.v;
        const s = uid ? st.students.find(x => x.uid === uid) : null;
        const name = s ? (s.name || 'Ученик') : '';
        if (act !== 'more' && t.closest('.tcab-menu')) { const d = t.closest('details'); if (d) d.open = false; }
        switch (act) {
            case 'tab': api.tab(v); break;
            case 'seg': st.seg = st.seg === v && v !== 'all' ? 'all' : v; st.tab = 'students'; st.openUid = null; st.listScroll = 0; render(); break;
            case 'open':
                if (window._mergeSelectionA && window._isGlobalAdmin) { window.selectStudentForMerge(uid, name); break; }
                openStudent(uid); break;
            case 'back': back(); break;
            case 'write': openTelegram(v); break;
            case 'nowrite': toast('✉️', 'У ученика нет @username в Telegram — написать по ссылке нельзя. Попросите его завести ник в настройках Telegram.'); break;
            case 'pdf': window.downloadStudentPDF && window.downloadStudentPDF(uid); break;
            case 'assign': window.promptAssignHw && window.promptAssignHw(uid, name); break;
            case 'hwlist': window.openStudentAssignmentsList && window.openStudentAssignmentsList(uid, name); break;
            case 'merge': window.selectStudentForMerge && window.selectStudentForMerge(uid, name); if (window._mergeSelectionA) back(); break;
            case 'copyid': copy(v, 'ID скопирован'); break;
            case 'allmist': st.showAllMistakes = true; render(); break;
            case 'hwopen': st.hwOpen = st.hwOpen === v ? null : v; render(); break;
            case 'assignclass': window.promptAssignHwClass && window.promptAssignHwClass(); break;
            case 'hwjournal': window.openClassAssignmentsList && window.openClassAssignmentsList(); break;
            case 'classpdf': window.downloadClassReportPDF && window.downloadClassReportPDF(); break;
            case 'invite': window.copyClassInvite && window.copyClassInvite(); break;
            case 'reload': window.loadClassProgress && window.loadClassProgress(); break;
            case 'dedup': window.runDeduplication && window.runDeduplication(); break;
        }
    }
    function onInput(e) {
        if (e.target.id === 'tcab-q') { st.q = e.target.value; st._focusQ = true; st.listScroll = 0; render(); }
    }
    function onChange(e) {
        if (e.target.id === 'tcab-sort') { st.sort = e.target.value; try { localStorage.setItem('tcab_sort', st.sort); } catch (x) {} render(); }
    }
    let _wired = false;
    function wire() {
        if (_wired) return;
        const m = document.getElementById('teacher-modal'); if (!m) return;
        _wired = true;
        m.addEventListener('click', onClick);
        m.addEventListener('input', onInput);
        m.addEventListener('change', onChange);
        try { const s = localStorage.getItem('tcab_sort'); if (s && SORTS.some(x => x[0] === s)) st.sort = s; } catch (e) {}
    }

    async function loadContacts(code) {
        if (!code || st.contactsFor === code || !window._teacherContacts) return;
        st.contactsFor = code;
        try {
            const res = await window._teacherContacts(code);
            if (st.contactsFor !== code) return;
            st.contacts = (res && res.contacts) || {};
            if (st.openUid || st.q) render();
        } catch (e) { st.contactsFor = ''; }
    }

    const api = {
        loading(code) {
            wire();
            if (code !== st.code) { st.students = []; st.openUid = null; }
            st.status = 'loading'; st.loaded = 0; st.total = 0; render();
        },
        progress(done, total) {
            st.loaded = done; st.total = total;
            const el = document.getElementById('tcab-progress');
            if (el) el.textContent = `Загружаем прогресс учеников: ${done} из ${total}`;
        },
        // Список поменялся на месте (ученика выпустили из группы) — остальное состояние не трогаем.
        sync(list) { st.students = Array.isArray(list) ? list : []; render(); },
        error(msg) { wire(); st.status = 'error'; st.error = msg || 'Не удалось загрузить учеников'; render(); },
        setData(students, opts) {
            wire();
            const o = opts || {};
            if (o.code !== st.code) { st.openUid = null; st.hwOpen = null; st.q = ''; st.seg = 'all'; st.listScroll = 0; st.contacts = {}; st.contactsFor = ''; }
            st.students = Array.isArray(students) ? students : [];
            st.code = o.code || ''; st.upto = Number(o.upto) || 0; st.note = o.note || '';
            st.status = 'ready'; _pathCache.clear();
            render();
            loadContacts(st.code);
        },
        setUpto(y) { st.upto = Number(y) || 0; _pathCache.clear(); if (st.status === 'ready') render(); },
        tab(name) {
            wire();
            st.tab = ['students', 'hw', 'class'].includes(name) ? name : 'students';
            if (st.openUid) { st.openUid = null; if (window.popBackHandler) window.popBackHandler('tcab:student'); }
            const el = root(); if (el) el.scrollTop = 0;
            render();
        },
        render,
        openStudent,
        // Строка «Кабинет учителя» в лобби: учитель не должен знать про
        // двойной клик по логотипу, чтобы попасть на рабочее место.
        showEntry(groups) {
            const b = document.getElementById('lobby-teacher-entry'); if (!b) return;
            const list = Array.isArray(groups) ? groups : [];
            b.classList.toggle('hidden', !list.length && !window._isGlobalAdmin);
            const sub = document.getElementById('lobby-teacher-sub');
            if (sub) sub.textContent = list.length === 1 ? `Группа «${list[0].name || list[0].code}»` : list.length ? `${list.length} ${plural(list.length, 'группа', 'группы', 'групп')}` : 'Все ученики';
        },
        hideEntry() { const b = document.getElementById('lobby-teacher-entry'); if (b) b.classList.add('hidden'); },
        _state: st,
        _path: path
    };
    window.TeacherCabinet = api;
})();
