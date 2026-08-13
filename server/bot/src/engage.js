'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  engage.js — вовлечение и аналитика бота (самодостаточный модуль)
//  Фичи: (1) авто-переотправка пуша ДЗ, (2) ежедневный стрик-пинг ученику,
//        (3) еженедельный дайджест учителю, (4) проактивные алерты учителю,
//        (5) дедлайн-пинг ученику (ДЗ открыто, но не сдано, дедлайн сегодня/завтра),
//        (6) утренняя сводка-пульс админу, (7) еженедельный отчёт родителям.
//  ВАЖНО: модуль НИЧЕГО не пишет в Firestore — только читает students/classes,
//  шлёт сообщения в Telegram и ведёт СВОИ таблицы в users.db. Это уважает
//  границу «не трогай базы данных» (fullStateJson принадлежит ученику).
//  Аварийный стоп: выключатели в /admin (таблица flags) или ENGAGE_DRY_RUN=1 (лог вместо отправки)
//  (запуск по требованию, все сообщения летят только админу).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = function initEngagement(ctx) {
    const { bot, db, getFdb, base, sendSafe, sleep, appKb, recipientsForClass,
            teachers, InlineKeyboard, ADMIN_ID } = ctx;

    // P4 (2026-07-17): блоб прогресса fullStateJson переехал из публичного students/{id}
    // в private/data/state/{id}; в публичном доке он остаётся только у необновившихся
    // клиентов. Дайджесты обходят всех учеников, поэтому читаем приватную коллекцию
    // целиком с кэшем на 10 минут, а collect() берёт приватный блоб | публичный.
    const privBase = base.replace('/public/data', '/private/data');

    // ── Обход коллекции целиком ──
    // 🔴 store/query отдаёт максимум 500 строк, если лимит не запрошен ЯВНО, и
    // делает это молча: ни ошибки, ни признака обрезки. Учеников давно больше.
    // 13.08.2026 утренний «Пульс» доложил «решено вчера: 0 строк» — на самом деле
    // 1070 строк у 16 человек. Ровно ноль, а не «часть», по злой причине: без
    // ORDER BY срез забирает 500 САМЫХ СТАРЫХ записей, а неравенства (lastActive
    // > …) фильтруются уже ПОСЛЕ среза — активных там нет вовсе. По той же причине
    // стрик-пинг и дедлайн-пинг каждый день писали в лог «0» и не слали ничего.
    //
    // Просим потолок явно и кричим, когда в него упёрлись. Молча больше не будет.
    const SCAN_CAP = 5000; // выше API не отдаёт (store.js: Math.min(5000, …))
    async function scanAll(what, ref) {
        const q = await ref.limit(SCAN_CAP).get();
        if (q.docs.length >= SCAN_CAP) {
            console.error(`[engage] ВНИМАНИЕ: обход «${what}» упёрся в потолок ${SCAN_CAP} — ` +
                'сводки неполные, нужна постраничная выборка');
        }
        return q;
    }

    let _privCache = { at: 0, map: new Map() };
    async function privBlobs() {
        const fdb = getFdb(); if (!fdb) return _privCache.map;
        if (Date.now() - _privCache.at < 10 * 60 * 1000) return _privCache.map;
        const m = new Map();
        try {
            const q = await scanAll('приватные состояния', fdb.collection(`${privBase}/state`));
            q.forEach(s => { const j = (s.data() || {}).fullStateJson; if (j && j.length > 10) m.set(String(s.id), j); });
            _privCache = { at: Date.now(), map: m };
        } catch (e) { console.error('[engage] privBlobs:', e.message); }
        return _privCache.map;
    }

    const DRY = process.env.ENGAGE_DRY_RUN === '1';
    const TZ_MIN = Number(process.env.ENGAGE_TZ_OFFSET_MIN || 180); // МСК = UTC+3
    const STREAK_MIN = 30;          // как в приложении: день засчитан при solved >= 30
    const INACTIVE_ALERT_DAYS = 3;  // «не заходит» — порог для алерта учителю
    const HW_RESEND_AFTER_H = 6;    // через сколько часов дожать непрочитанное ДЗ
    const HW_RESEND_GAP_H = 18;     // минимум между переотправками
    const HW_RESEND_MAX = 2;        // не больше двух напоминаний на одно ДЗ

    // ── схема (свои таблицы + опт-аут колонки) ──
    db.exec(`CREATE TABLE IF NOT EXISTS engage_runs (job TEXT PRIMARY KEY, last_key TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS hw_track (
        student_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
        assigned_at INTEGER NOT NULL, deadline TEXT, task TEXT,
        resends INTEGER DEFAULT 0, last_resend INTEGER DEFAULT 0, done INTEGER DEFAULT 0,
        PRIMARY KEY (student_id, assignment_id))`);
    for (const col of ['notify_streak INTEGER DEFAULT 1', 'notify_digest INTEGER DEFAULT 1', 'notify_alerts INTEGER DEFAULT 1']) {
        try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) {}
    }
    // дедлайн-пинги: не больше одного пинга на (ученик, ДЗ, день)
    db.exec(`CREATE TABLE IF NOT EXISTS dl_pinged (
        student_id TEXT NOT NULL, assignment_id TEXT NOT NULL, day TEXT NOT NULL,
        PRIMARY KEY (student_id, assignment_id, day))`);

    const getRun = db.prepare('SELECT last_key FROM engage_runs WHERE job = ?');
    const setRun = db.prepare('INSERT INTO engage_runs (job, last_key) VALUES (?, ?) ON CONFLICT(job) DO UPDATE SET last_key = excluded.last_key');
    const notifyCol = (id, col) => { const r = db.prepare(`SELECT ${col} c FROM users WHERE id = ?`).get(Number(id)); return r ? r.c === 1 : false; };
    // Глобальные выключатели из /admin (таблица flags в bot.js). Нет строки = ВКЛ.
    // Гейтит только боевые рассылки (redirect-вызовы, если появятся, работают всегда).
    const flagOn = (key) => { try { const r = db.prepare('SELECT value v FROM flags WHERE key = ?').get(key); return !r || r.v === 1; } catch (e) { return true; } };

    // ── время в МСК ──
    const localNow = () => new Date(Date.now() + TZ_MIN * 60000);
    const ymd = (d) => d.toISOString().split('T')[0];              // d уже сдвинут в МСК
    const isoWeekKey = (d) => { const t = new Date(d); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3); const y = t.getUTCFullYear(); const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7); return `${y}-W${w}`; };
    const todayKey = () => ymd(localNow());
    const daysAgoKey = (n) => { const d = localNow(); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };

    // ── чтение ученика ──
    function chatIdOf(id, d) {
        const cand = d.knownTgId || d.tgId || (/^\d+$/.test(String(id)) ? id : null);
        const n = Number(cand); return Number.isFinite(n) && n > 0 ? n : null;
    }
    // Стрик по dailyStats (зеркалит computeDayStreak приложения): день засчитан при solved>=30,
    // серия — подряд идущие такие дни, кончая сегодня или вчера.
    function dayStreak(ds) {
        const solvedOn = (k) => { const x = ds[k]; return !!(x && (x.solved || 0) >= STREAK_MIN); };
        let cur = localNow(); let key = ymd(cur);
        if (!solvedOn(key)) { cur.setUTCDate(cur.getUTCDate() - 1); key = ymd(cur); }
        let s = 0; while (solvedOn(key)) { s++; cur.setUTCDate(cur.getUTCDate() - 1); key = ymd(cur); }
        return s;
    }
    function collect(id, d) {
        let st = {}; try { st = JSON.parse(_privCache.map.get(String(id)) || d.fullStateJson || '{}'); } catch (e) {}
        const stats = st.stats || st || {};
        const ds = stats.dailyStats || {};
        const week = new Set(Array.from({ length: 7 }, (_, i) => daysAgoKey(i)));
        let weekSolved = 0; for (const k of week) weekSolved += (ds[k] && ds[k].solved) || 0;
        const streak = dayStreak(ds);
        const solvedToday = (ds[todayKey()] && ds[todayKey()].solved) || 0;
        const la = Number(d.lastActive) || 0;
        const daysSince = la ? Math.floor((Date.now() - la) / 86400000) : 999;
        const learned = Number(d.learnedCount) || 0;
        const asg = Array.isArray(stats.assignments) ? stats.assignments : [];
        const today = todayKey(), tmr = daysAgoKey(-1);
        // Строго status==='active': кроме done есть надгробия revoked (снятое ДЗ,
        // запись хранится ради слияния состояний) — напоминать о них нельзя.
        const active = asg.filter(a => a && a.status === 'active');
        const overdue = active.filter(a => a.deadline && a.deadline < today);
        const dueSoon = active.filter(a => a.deadline && (a.deadline === today || a.deadline === tmr));
        const doneThisWeek = asg.filter(a => a && a.status === 'done' && a.completedAt && a.completedAt > Date.now() - 7 * 86400000);
        // Невыданное = ученик ещё НЕ открыл приложение после выдачи (ДЗ висит в pendingAssignments,
        // в stats.assignments его нет). Дедлайн близко/прошёл — самый важный сигнал для учителя.
        const pend = Array.isArray(d.pendingAssignments) ? d.pendingAssignments : [];
        const notOpenedRisk = pend.some(a => a && a.deadline && a.deadline <= tmr);
        // Для дедлайн-пинга ученику: сколько строк осталось по каждому «горящему» ДЗ.
        const remOf = (a) => (Array.isArray(a.items) ? a.items : [])
            .reduce((n, it) => n + Math.max(0, (Number(it && it.goal) || 0) - (Number(it && it.progress) || 0)), 0);
        const dueSoonList = dueSoon.map(a => ({ id: a.id, deadline: a.deadline, remaining: remOf(a) })).filter(x => x.remaining > 0);
        return {
            id, chatId: chatIdOf(id, d), name: (d.name || 'Ученик').slice(0, 40),
            weekSolved, streak, solvedToday, daysSince, learned,
            overdueN: overdue.length, dueSoon, dueSoonList, doneWeekN: doneThisWeek.length,
            notOpenedRisk, hasPending: pend.length > 0, classCode: d.classCode || ''
        };
    }

    async function loadClassStudents(code) {
        const fdb = getFdb(); if (!fdb) return [];
        const q = await scanAll(`группа ${code}`, fdb.collection(`${base}/students`).where('classCode', '==', code));
        await privBlobs();
        const out = [];
        q.forEach(s => { const d = s.data() || {}; if (d._mergedInto) return; out.push(collect(s.id, d)); });
        return out;
    }
    // уникальные коды групп из кэша учителей
    function allClassCodes() {
        const set = new Set();
        for (const [, t] of teachers) (Array.isArray(t.classes) ? t.classes : []).forEach(c => {
            const code = typeof c === 'string' ? c : (c && c.code); if (code) set.add(code);
        });
        return [...set];
    }
    function className(code) {
        for (const [, t] of teachers) for (const c of (t.classes || [])) {
            const cc = typeof c === 'string' ? c : (c && c.code); if (cc === code) return (typeof c === 'object' && c.name) || code;
        }
        return code;
    }

    // ── отправка (учитывает DRY и redirect на админа для теста) ──
    async function send(chatId, text, redirect) {
        const to = redirect || chatId;
        if (DRY && !redirect) { console.log(`[engage DRY] → ${chatId}: ${text.split('\n')[0]}`); return; }
        await sendSafe(to, (redirect ? `[тест → ${chatId}]\n` : '') + text, { reply_markup: appKb() });
        await sleep(60);
    }

    // ═══ ФИЧА 1: авто-переотправка пуша ДЗ ═══
    // Хук из watchJobs: регистрируем каждое выданное ДЗ для последующего дожатия.
    function onHwAssigned(studentId, recId, assignedAt, deadline, task) {
        try {
            db.prepare(`INSERT INTO hw_track (student_id, assignment_id, assigned_at, deadline, task)
                        VALUES (?, ?, ?, ?, ?) ON CONFLICT(student_id, assignment_id) DO NOTHING`)
              .run(String(studentId), String(recId), Number(assignedAt) || Date.now(), deadline || null, task || null);
        } catch (e) { console.error('hw_track insert:', e.message); }
    }
    async function runHwResend(redirect) {
        const fdb = getFdb(); if (!fdb) return;
        if (!redirect && !flagOn('hw_resend')) return;
        const rows = db.prepare('SELECT * FROM hw_track WHERE done = 0').all();
        const now = Date.now();
        for (const r of rows) {
            try {
                const snap = await fdb.doc(`${base}/students/${r.student_id}`).get();
                if (!snap.exists) { db.prepare('UPDATE hw_track SET done=1 WHERE student_id=? AND assignment_id=?').run(r.student_id, r.assignment_id); continue; }
                const d = snap.data() || {};
                const still = Array.isArray(d.pendingAssignments) && d.pendingAssignments.some(a => a && a.id === r.assignment_id);
                // ученик открыл приложение (ДЗ ушло из pending) или ДЗ протухло — снимаем с дожатия
                if (!still || now - r.assigned_at > 8 * 86400000) { db.prepare('UPDATE hw_track SET done=1 WHERE student_id=? AND assignment_id=?').run(r.student_id, r.assignment_id); continue; }
                const ageH = (now - r.assigned_at) / 3600000;
                const gapOk = (now - (r.last_resend || 0)) / 3600000 >= HW_RESEND_GAP_H;
                if (ageH < HW_RESEND_AFTER_H || r.resends >= HW_RESEND_MAX || !gapOk) continue;
                const chatId = chatIdOf(r.student_id, d);
                if (!chatId || !notifyCol(chatId, 'notify_hw')) { db.prepare('UPDATE hw_track SET done=1 WHERE student_id=? AND assignment_id=?').run(r.student_id, r.assignment_id); continue; }
                const dl = r.deadline ? `\n⏰ Дедлайн: ${fmtDate(r.deadline)}` : '';
                await send(chatId, `⏰ Напоминание: тебе выдали домашнее задание, а ты его ещё не открывал.${dl}\n\nЗайди и начни — это быстро 👇`, redirect);
                db.prepare('UPDATE hw_track SET resends=resends+1, last_resend=? WHERE student_id=? AND assignment_id=?').run(now, r.student_id, r.assignment_id);
            } catch (e) { console.error('hwResend row:', e.message); }
        }
    }

    // ═══ ФИЧА 2: ежедневный стрик-пинг ученику ═══
    async function runStreakPing(redirect) {
        const fdb = getFdb(); if (!fdb) return;
        if (!redirect && !flagOn('streak_ping')) return;
        const cutoff = Date.now() - 2 * 86400000; // только недавно активные — не будим спящих
        const q = await scanAll('ученики (недавно активные)', fdb.collection(`${base}/students`).where('lastActive', '>', cutoff));
        await privBlobs();
        let pinged = 0;
        for (const s of q.docs) {
            const d = s.data() || {}; if (d._mergedInto) continue;
            const c = collect(s.id, d);
            if (!c.chatId) continue;
            if (c.solvedToday >= STREAK_MIN) continue;   // уже занимался сегодня
            if (c.streak < 3) continue;                  // нет привычки — не дёргаем
            if (!notifyCol(c.chatId, 'notify_streak')) continue;
            await send(c.chatId, `🔥 У тебя серия ${c.streak} ${plural(c.streak, 'день', 'дня', 'дней')} подряд!\nНе разрывай — порешай сегодня хотя бы ${STREAK_MIN} строк 👇`, redirect);
            pinged++;
        }
        console.log(`[engage] streak-ping: ${pinged}${DRY && !redirect ? ' (dry)' : ''}`);
    }

    // ═══ ФИЧА 3: еженедельный дайджест учителю ═══
    async function runDigest(redirect) {
        if (!redirect && !flagOn('digest')) return;
        for (const code of allClassCodes()) {
            let studs; try { studs = await loadClassStudents(code); } catch (e) { console.error('digest load', code, e.message); continue; }
            if (!studs.length) continue;
            studs.sort((a, b) => b.weekSolved - a.weekSolved);
            const active = studs.filter(s => s.weekSolved > 0);
            const idle = studs.filter(s => s.daysSince >= 7);
            const doneW = studs.reduce((n, s) => n + s.doneWeekN, 0);
            const overdueW = studs.filter(s => s.overdueN > 0).length;
            const lines = [`📊 Дайджест группы «${className(code)}» за неделю`, ''];
            lines.push(`👥 Учеников: ${studs.length} · активны за неделю: ${active.length}`);
            if (active.length) {
                lines.push('', '🏆 Кто решал:');
                active.slice(0, 10).forEach((s, i) => {
                    const medal = i === 0 ? '👑 ' : '• ';
                    const lrn = s.learned ? `, выучено ${s.learned}` : '';
                    const strk = s.streak >= 3 ? ` 🔥${s.streak}` : '';
                    lines.push(`${medal}${s.name} — ${s.weekSolved} строк${lrn}${strk}`);
                });
            }
            if (idle.length) lines.push('', `💤 Не заходили 7+ дней: ${idle.map(s => s.name).join(', ')}`);
            lines.push('', `📚 ДЗ за неделю: сдано ${doneW}${overdueW ? ` · с просрочкой у ${overdueW}` : ''}`);
            const text = lines.join('\n');
            for (const tid of recipientsForClass(code)) { if (redirect || notifyCol(tid, 'notify_digest')) await send(tid, text, redirect); }
        }
        console.log(`[engage] digest sent${DRY && !redirect ? ' (dry)' : ''}`);
    }

    // ═══ ФИЧА 4: проактивные алерты учителю ═══
    async function runAlerts(redirect) {
        if (!redirect && !flagOn('alerts')) return;
        for (const code of allClassCodes()) {
            let studs; try { studs = await loadClassStudents(code); } catch (e) { console.error('alerts load', code, e.message); continue; }
            if (!studs.length) continue;
            const gone = studs.filter(s => s.daysSince >= INACTIVE_ALERT_DAYS && s.daysSince < 999);
            const risk = studs.filter(s => s.dueSoon.length > 0);
            const late = studs.filter(s => s.overdueN > 0);
            const notOpened = studs.filter(s => s.notOpenedRisk);
            if (!gone.length && !risk.length && !late.length && !notOpened.length) continue;
            const lines = [`⚠️ Группа «${className(code)}» — на что обратить внимание`, ''];
            if (notOpened.length) lines.push(`📭 Не открыли выданное ДЗ (дедлайн близко): ${notOpened.map(s => s.name).join(', ')}`);
            if (risk.length) lines.push(`⏰ Дедлайн ДЗ на носу, не сдано: ${risk.map(s => s.name).join(', ')}`);
            if (late.length) lines.push(`❗ Просрочили ДЗ: ${late.map(s => s.name).join(', ')}`);
            if (gone.length) lines.push(`💤 Не заходят ${INACTIVE_ALERT_DAYS}+ дн: ${gone.map(s => `${s.name} (${s.daysSince}д)`).join(', ')}`);
            const text = lines.join('\n');
            for (const tid of recipientsForClass(code)) { if (redirect || notifyCol(tid, 'notify_alerts')) await send(tid, text, redirect); }
        }
        console.log(`[engage] alerts sent${DRY && !redirect ? ' (dry)' : ''}`);
    }

    // ═══ ФИЧА 5: дедлайн-пинг ученику ═══
    // ДЗ открыто (уже в stats.assignments), но не доделано, а дедлайн сегодня/завтра.
    // Замыкает петлю: про дедлайны раньше узнавал только учитель (алерты).
    async function runDeadlinePing(redirect) {
        const fdb = getFdb(); if (!fdb) return;
        if (!redirect && !flagOn('dl_ping')) return;
        const cutoff = Date.now() - 30 * 86400000; // совсем спящих не трогаем
        const q = await scanAll('ученики (недавно активные)', fdb.collection(`${base}/students`).where('lastActive', '>', cutoff));
        await privBlobs();
        const today = todayKey();
        let pinged = 0;
        for (const s of q.docs) {
            const d = s.data() || {}; if (d._mergedInto) continue;
            const c = collect(s.id, d);
            if (!c.chatId || !c.dueSoonList.length) continue;
            if (!notifyCol(c.chatId, 'notify_hw')) continue; // тот же тумблер, что и пуши о ДЗ
            const fresh = c.dueSoonList.filter(a =>
                !db.prepare('SELECT 1 FROM dl_pinged WHERE student_id=? AND assignment_id=? AND day=?').get(String(s.id), String(a.id), today));
            if (!fresh.length) continue;
            const remaining = fresh.reduce((n, a) => n + a.remaining, 0);
            const isToday = fresh.some(a => a.deadline === today);
            const when = isToday ? 'СЕГОДНЯ' : 'завтра';
            await send(c.chatId, `⏰ Дедлайн по ДЗ ${when}!\nОсталось ${remaining} ${plural(remaining, 'строка', 'строки', 'строк')} — ещё успеваешь 👇`, redirect);
            fresh.forEach(a => db.prepare('INSERT OR IGNORE INTO dl_pinged (student_id, assignment_id, day) VALUES (?, ?, ?)').run(String(s.id), String(a.id), today));
            pinged++;
        }
        console.log(`[engage] deadline-ping: ${pinged}${DRY && !redirect ? ' (dry)' : ''}`);
    }

    // ═══ ФИЧА 6: утренняя сводка-пульс админу ═══
    // Раз в день админу: здоровье продукта одним сообщением. Полный скан студентов —
    // ~1200 чтений/день, для Firestore это копейки.
    async function runAdminPulse(redirect) {
        const fdb = getFdb(); if (!fdb || !ADMIN_ID) return;
        const q = await scanAll('все ученики', fdb.collection(`${base}/students`));
        await privBlobs();
        const now = Date.now(); const yest = daysAgoKey(1);
        let total = 0, active24 = 0, active7 = 0, solvedYest = 0, streak3 = 0, hwPending = 0;
        const byClass = new Map(); // code -> {n, solved}
        q.forEach(s => {
            const d = s.data() || {}; if (d._mergedInto) return;
            total++;
            const la = Number(d.lastActive) || 0;
            if (la > now - 86400000) active24++;
            if (la > now - 7 * 86400000) active7++;
            let st = {}; try { st = JSON.parse(_privCache.map.get(String(s.id)) || d.fullStateJson || '{}'); } catch (e) {}
            const ds = (st.stats && st.stats.dailyStats) || {};
            const ySolved = (ds[yest] && ds[yest].solved) || 0;
            solvedYest += ySolved;
            if (Array.isArray(d.pendingAssignments) && d.pendingAssignments.length) hwPending++;
            if (ySolved >= STREAK_MIN) streak3++; // вчера удержали норму
            const code = d.classCode || '';
            if (code) { const c = byClass.get(code) || { n: 0, solved: 0 }; c.n++; c.solved += ySolved; byClass.set(code, c); }
        });
        const newUsers = db.prepare("SELECT COUNT(*) n FROM users WHERE first_seen >= datetime('now', 'localtime', '-1 day')").get().n;
        const hwSent24 = db.prepare("SELECT COUNT(*) n FROM seen_assignments WHERE seen_at >= datetime('now', 'localtime', '-1 day')").get().n;
        let parentsN = 0; try { parentsN = db.prepare('SELECT COUNT(DISTINCT parent_id) n FROM parents').get().n; } catch (e) {}
        const topClasses = [...byClass.entries()].filter(([, v]) => v.solved > 0)
            .sort((a, b) => b[1].solved - a[1].solved).slice(0, 3)
            .map(([code, v]) => `• ${className(code)}: ${v.solved} строк (${v.n} уч.)`);
        const lines = [
            `🌅 Пульс за сутки — ${fmtDate(yest)}`,
            '',
            `👥 Учеников в базе: ${total} · новых в боте: +${newUsers}`,
            `⚡ Активны: ${active24} за 24ч · ${active7} за 7 дней`,
            `📊 Решено вчера: ${solvedYest} строк · норму (${STREAK_MIN}+) выполнили ${streak3}`,
            `📚 Пушей о ДЗ за сутки: ${hwSent24} · не открыли ДЗ: ${hwPending}`,
            `👪 Родителей на отчётах: ${parentsN}`
        ];
        if (topClasses.length) lines.push('', '🏆 Топ групп за вчера:', ...topClasses);
        await send(redirect || ADMIN_ID, lines.join('\n'), null);
        console.log('[engage] admin pulse sent');
    }

    // ═══ ФИЧА 7: еженедельный отчёт родителям ═══
    // Подписка: ученик делает /parent → шлёт ссылку родителю (bot.js ведёт таблицы
    // parents/parent_tokens). Здесь — только рассылка по воскресеньям.
    async function runParentReport(redirect) {
        const fdb = getFdb(); if (!fdb) return;
        if (!redirect && !flagOn('parent_report')) return;
        let rows = [];
        try { rows = db.prepare('SELECT parent_id, student_id FROM parents').all(); } catch (e) { return; }
        if (!rows.length) return;
        const byStudent = new Map();
        rows.forEach(r => { if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []); byStudent.get(r.student_id).push(Number(r.parent_id)); });
        let sent = 0;
        await privBlobs();
        for (const [sid, parentIds] of byStudent) {
            try {
                const snap = await fdb.doc(`${base}/students/${sid}`).get();
                if (!snap.exists) continue;
                const d = snap.data() || {};
                const c = collect(sid, d);
                const lastSeen = c.daysSince === 0 ? 'сегодня' : (c.daysSince === 1 ? 'вчера' : (c.daysSince >= 999 ? 'давно' : `${c.daysSince} дн. назад`));
                const lines = [
                    `👪 Отчёт за неделю: ${c.name}`,
                    '',
                    `📊 Решено строк: ${c.weekSolved}`,
                    c.streak >= 2 ? `🔥 Серия занятий: ${c.streak} ${plural(c.streak, 'день', 'дня', 'дней')} подряд` : null,
                    c.learned ? `🧠 Выучено фактов всего: ${c.learned}` : null,
                    `📚 ДЗ за неделю: сдано ${c.doneWeekN}${c.overdueN ? ` · просрочено ${c.overdueN}` : ''}`,
                    `🕐 Последнее занятие: ${lastSeen}`,
                    '',
                    c.weekSolved > 0 ? 'Ребёнок занимается — поддержите его! 💪' : 'На этой неделе занятий не было — стоит мягко напомнить 🙂'
                ].filter(Boolean);
                const text = lines.join('\n');
                for (const pid of parentIds) {
                    if (DRY && !redirect) { console.log(`[engage DRY] → parent ${pid}: отчёт ${c.name}`); continue; }
                    await sendSafe(redirect || pid, (redirect ? `[тест → родителю ${pid}]\n` : '') + text); // без кнопки тренажёра
                    await sleep(60); sent++;
                }
            } catch (e) { console.error('parent report', sid, e.message); }
        }
        console.log(`[engage] parent reports: ${sent}${DRY && !redirect ? ' (dry)' : ''}`);
    }

    // ── утилиты ──
    function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few; return many; }
    function fmtDate(s) { try { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; } catch (e) { return s; } }

    // ── планировщик: тик каждые 5 мин, каждая задача — раз в свой период ──
    function due(job, targetHour, key, windowH = 4) {
        const l = localNow(); const h = l.getUTCHours();
        if (h < targetHour || h >= targetHour + windowH) return false;
        const prev = getRun.get(job); if (prev && prev.last_key === key) return false;
        setRun.run(job, key); return true;
    }
    async function tick() {
        try {
            const l = localNow();
            if (due('streak', 17, todayKey())) await runStreakPing();
            if (l.getUTCDay() === 0 && due('digest', 19, isoWeekKey(l))) await runDigest();
            if (due('alerts', 9, todayKey())) await runAlerts();
            if (due('pulse', 10, todayKey())) await runAdminPulse();
            if (due('dlping', 15, todayKey())) await runDeadlinePing();
            if (l.getUTCDay() === 0 && due('parents', 18, isoWeekKey(l))) await runParentReport();
        } catch (e) { console.error('engage tick:', e.message); }
    }
    setInterval(tick, 5 * 60 * 1000);
    setInterval(() => runHwResend().catch(e => console.error('hwResend:', e.message)), 60 * 60 * 1000);
    // старт: небольшая задержка, чтобы кэш учителей успел прогрузиться
    setTimeout(tick, 90 * 1000);
    setTimeout(() => runHwResend().catch(() => {}), 120 * 1000);

    console.log(`[engage] init OK${DRY ? ' (DRY_RUN)' : ''} · tz+${TZ_MIN}m`);
    return { onHwAssigned, _runDigest: runDigest, _runStreakPing: runStreakPing, _runAlerts: runAlerts,
             _runHwResend: runHwResend, _runAdminPulse: runAdminPulse, _runDeadlinePing: runDeadlinePing,
             _runParentReport: runParentReport };
};
