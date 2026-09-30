// Симулятор учеников для главной кнопки («Глава», lesson-plan.js) — запускается В БРАУЗЕРЕ
// на открытом приложении (локальный сервер): await (await fetch('tools-and-docs/lesson-sim.js')).text() → eval.
// Гоняет НАСТОЯЩИЕ computeMainAction / mainActionGo / maybeRotateLadderTask / generateTable /
// updateFactSRS по дням, с ошибками, и проверяет правила пути. Ничего не отправляет на сервер:
// window.saveProgress и облако подменяются заглушками на время прогона.
// window.LessonSim.run(opts) → { scenarios: [...], violations: [...] }
(function () {
    'use strict';
    const DAY = 864e5;

    function withClock(dayIndex, fn) {
        const base = Date.UTC(2026, 9, 1, 9) + dayIndex * DAY;
        const realNow = Date.now, realToday = window.getTodayString;
        let tick = 0;
        Date.now = () => base + (tick++) * 1000;
        window.getTodayString = () => new Date(base + 3 * 3600e3).toISOString().slice(0, 10);
        try { return fn(); } finally { Date.now = realNow; window.getTodayString = realToday; }
    }

    function reset(profile) {
        const s = window.state;
        s.stats.factStreaks = {};
        s.stats.dailyStats = {};
        s.stats.totalSolvedEver = 0;
        s.stats.assignments = [];
        s.mistakesPool = [];
        ['ege_own_period', 'ege_own_year_from', 'ege_own_year_to', 'class_current_upto', 'class_current_period']
            .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
        if (profile.upto) localStorage.setItem('class_current_upto', String(profile.upto));
        if (profile.own) window.rememberOwnPeriod(profile.own.period, profile.own.from, profile.own.to);
        if (profile.seed) profile.seed(s.stats.factStreaks);
        if (profile.seedSolved) s.stats.totalSolvedEver = profile.seedSolved;
    }

    const yearOf = f => getYearFromFact(f);

    // Один «день» ученика: жмёт главную кнопку и решает lines строк с точностью acc.
    async function playDay(profile, day, report) {
        const s = window.state;
        let lines = 0, guard = 0;
        await withClock(day, async () => {});
        const realNow = Date.now, realToday = window.getTodayString;
        const base = Date.UTC(2026, 9, 1, 9) + day * DAY;
        let tick = 0;
        Date.now = () => base + (tick++) * 2000;
        window.getTodayString = () => new Date(base + 3 * 3600e3).toISOString().slice(0, 10);
        try {
            const a0 = computeMainAction();
            report.kinds[a0.kind] = (report.kinds[a0.kind] || 0) + 1;
            if (a0.kind !== 'continue' && a0.kind !== 'start') {
                // день повторения / ДЗ / всё пройдено — тоже решаем, но правила урока не проверяем
                await window.mainActionGo();
            } else {
                await window.mainActionGo();
            }
            await new Promise(r => setTimeout(r, 30));
            let prevCh = s._lesson ? s._lesson.ch : null;
            while (lines < profile.linesPerDay && guard++ < 200) {
                const rows = s.currentTargetData || [];
                const L = s._lesson;
                const task = s.currentTask;
                if (!rows.length) { report.v.push(`д${day}: пустая таблица (${task})`); break; }
                if (L) {
                    const w = typeof _tableYearRange === 'function' ? _tableYearRange() : null;
                    if (rows.length < 4) report.v.push(`д${day}: таблица ${rows.length} строк (${task}, гл.${L.ch + 1})`);
                    if (w && rows.some(f => yearOf(f) < w.from || yearOf(f) > w.to)) report.v.push(`д${day}: строка вне окна ${w.from}–${w.to} (${task}, гл.${L.ch + 1}${s._blendTable ? ', повтор' : ''})`);
                    if (!s._blendTable) {
                        const inSeg = rows.filter(f => yearOf(f) >= L.segFrom && yearOf(f) <= L.segTo).length;
                        report.tables++; report.segRows += inSeg; report.rows += rows.length;
                        if (!inSeg) report.noSeg++;
                        const nat = window.LessonPlan.nativeTypes(L.segFrom, L.segTo);
                        if (L.zone !== 'pin' && !nat.has(task)) report.v.push(`д${day}: задание ${task} не своё для гл.${L.ch + 1}`);
                    } else report.blends++;
                    if (prevCh != null && L.ch < prevCh && L.zone !== 'before') report.v.push(`д${day}: глава откатилась ${prevCh + 1}→${L.ch + 1}`);
                    prevCh = L.ch;
                }
                // Ответы: первый раз — по «знанию» профиля, потом точность растёт.
                for (const f of rows) {
                    const k = factKey(f);
                    const had = !!s.stats.factStreaks[k];
                    const p = had ? profile.acc : profile.firstAcc;
                    const ok = Math.random() < p;
                    updateFactSRS(k, ok, ok);
                    if (!ok && window.recordMistake) try { window.recordMistake(f, task, null); } catch (e) {}
                    else if (ok) { const i = s.mistakesPool.findIndex(m => mistakeMatchesFact(m, f, task)); if (i >= 0) s.mistakesPool.splice(i, 1); }
                }
                const d = getTodayString();
                const ds = s.stats.dailyStats[d] = s.stats.dailyStats[d] || { solved: 0, timeSpent: 0 };
                ds.solved += rows.length;
                const kk = 'solved' + task.charAt(0).toUpperCase() + task.slice(1);
                ds[kk] = (ds[kk] || 0) + rows.length;
                s.stats.totalSolvedEver += rows.length;
                lines += rows.length;
                if (!window.maybeRotateLadderTask()) generateTable();
                // Смена главы/задания перезапускает занятие асинхронно — ждём, пока урок встанет.
                for (let w = 0; w < 40 && !s._lesson && a0.kind !== 'mistakes' && a0.kind !== 'review'; w++) await new Promise(r => setTimeout(r, 10));
                await new Promise(r => setTimeout(r, 5));
            }
            backToLobby();
        } finally { Date.now = realNow; window.getTodayString = realToday; }
        return lines;
    }

    async function scenario(profile) {
        reset(profile);
        const report = { name: profile.name, v: [], kinds: {}, tables: 0, rows: 0, segRows: 0, noSeg: 0, blends: 0, days: [] };
        let lastProgress = -1, lastCh = -1;
        for (let day = 0; day < profile.days; day++) {
            await playDay(profile, day, report);
            const a = computeMainAction();
            const p = a.plan;
            const ch = p && p.cur ? p.cur.ch : 99;
            const pct = p && p.cur ? p.cur.progress : 100;
            if (ch === lastCh && pct < lastProgress) report.v.push(`д${day}: готовность главы упала ${lastProgress}→${pct}`);
            if (ch < lastCh && !(p.cur && p.cur.zone === 'before')) report.v.push(`д${day}: путь откатился на главу ${ch + 1}`);
            lastCh = ch; lastProgress = pct;
            report.days.push(`${day + 1}: гл.${ch === 99 ? '—' : ch + 1} ${pct}% · закрыто ${p ? p.closed : '?'} · ${a.kind}`);
        }
        report.segShare = report.rows ? Math.round(100 * report.segRows / report.rows) : 0;
        // Что в текущей главе так и не встречено — и почему (для разбора застреваний).
        const a = computeMainAction();
        if (a.plan && a.plan.cur) {
            const c = a.plan.cur, fsx = window.state.stats.factStreaks, idx = window.LessonPlan.index();
            const nat = window.LessonPlan.nativeTypes(c.from, c.to);
            report.unseenLeft = [];
            idx.all.forEach((v, k) => { if (v.y >= c.from && v.y <= c.to && nat.has(v.t) && !fsx[k]) report.unseenLeft.push(v.t + ' ' + v.y + ' ' + String(k).slice(0, 50)); });
            report.cur = { ch: c.ch + 1, n: c.n, seen: c.seen, learned: c.learned, firstN: c.firstN, firstOk: c.firstOk };
        }
        return report;
    }

    async function run(opts) {
        const saved = { save: window.saveProgress, sync: window.syncToCloud, fs: window.state.stats.factStreaks, ds: window.state.stats.dailyStats, tot: window.state.stats.totalSolvedEver, mp: window.state.mistakesPool, asg: window.state.stats.assignments };
        window.saveProgress = () => {};
        window.syncToCloud = () => {};
        // Подмешивание ФИПИ бывает только при «всей истории» — у урока окно лет, оно не мешает.
        const idx = window.LessonPlan.index();
        const learnUpTo = (fsx, to, share) => { let i = 0; idx.all.forEach((v, k) => { if (v.y <= to) { fsx[k] = (i++ % 10) < share * 10 ? { level: 2, points: 3, nextReview: Date.UTC(2026, 9, 3) } : { level: 0, points: 1, nextReview: 0 }; } }); };
        const profiles = (opts && opts.profiles) || [
            { name: 'новичок, 70%', days: 6, linesPerDay: 60, firstAcc: 0.55, acc: 0.75 },
            { name: 'знает из онлайн-школы', days: 4, linesPerDay: 80, firstAcc: 0.97, acc: 0.97 },
            { name: 'класс до 1485, уже всё до границы', days: 3, linesPerDay: 60, firstAcc: 0.7, acc: 0.8, upto: 1485, seed: f => learnUpTo(f, 1485, 0.6), seedSolved: 3000 },
            { name: 'свой период XVIII век', days: 3, linesPerDay: 60, firstAcc: 0.7, acc: 0.8, own: { period: '18th' } },
            { name: 'вернулся после перерыва (всё к повтору)', days: 3, linesPerDay: 60, firstAcc: 0.7, acc: 0.8, seed: f => { learnUpTo(f, 1700, 0.5); Object.values(f).forEach(d => { if (d.level > 0) d.nextReview = Date.UTC(2026, 8, 1); }); }, seedSolved: 4000 },
        ];
        const out = [];
        try {
            for (const p of profiles) out.push(await scenario(p));
        } finally {
            Object.assign(window.state.stats, { factStreaks: saved.fs, dailyStats: saved.ds, totalSolvedEver: saved.tot, assignments: saved.asg });
            window.state.mistakesPool = saved.mp;
            window.saveProgress = saved.save; window.syncToCloud = saved.sync;
            ['ege_own_period', 'ege_own_year_from', 'ege_own_year_to', 'class_current_upto'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
        }
        return out;
    }
    window.LessonSim = { run };
})();
