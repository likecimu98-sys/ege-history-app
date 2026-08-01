'use strict';

require('dotenv').config();
const path = require('path');
const { Bot, InlineKeyboard, GrammyError, HttpError } = require('grammy');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { createVpsFirestoreCompat } = require('./vps-firestore-compat');

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'Reshay_istoriyu_bot';
const APP_URL = process.env.APP_URL || 'https://likecimu98-sys.github.io/ege-history-app/';
const RECOVERY_URL = process.env.RECOVERY_URL || 'https://reshay-istoriyu.ru/sw-recover';
// A newly opened Telegram WebView still shares Service Worker registrations
// with the WebView that was just closed. Recovery therefore must reopen the
// app on a different origin, where the broken root-origin worker cannot run.
const RECOVERY_APP_URL = process.env.RECOVERY_APP_URL || 'https://www.reshay-istoriyu.ru/?recovery=1';
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const FB_APP_ID = process.env.FB_APP_ID || 'ege-history-bot';
const HISTORY_API_URL = process.env.HISTORY_API_URL || 'http://127.0.0.1:8792';
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || '';

if (!BOT_TOKEN) {
    console.error('BOT_TOKEN is not set in .env');
    process.exit(1);
}

// ---------- SQLite ----------
const db = new Database(path.join(__dirname, 'users.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, username TEXT, ref TEXT,
    first_seen TEXT DEFAULT (datetime('now', 'localtime')), last_seen TEXT
)`);
for (const col of [
    'notify_hw INTEGER DEFAULT 1', 'notify_duel INTEGER DEFAULT 1', 'last_duel_notify INTEGER DEFAULT 0',
    'notify_hw_done INTEGER DEFAULT 1', 'notify_join INTEGER DEFAULT 1',
    'notify_streak INTEGER DEFAULT 1', 'notify_digest INTEGER DEFAULT 1', 'notify_alerts INTEGER DEFAULT 1'
]) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) {} }
db.exec(`CREATE TABLE IF NOT EXISTS seen_assignments (
    student_id TEXT NOT NULL, assignment_id TEXT NOT NULL,
    seen_at TEXT DEFAULT (datetime('now', 'localtime')), PRIMARY KEY (student_id, assignment_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS delivered_notify_jobs (
    job_id TEXT PRIMARY KEY, delivered_at TEXT DEFAULT (datetime('now', 'localtime'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS delivered_notify_recipients (
    job_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
    delivered_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (job_id, recipient_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS duel_msgs (
    match_id TEXT NOT NULL, chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL, created_at INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS pending_orgs (
    user_id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
)`);
// Родители: подписка на еженедельный отчёт об успехах ребёнка (рассылает engage.js).
// parent_tokens: одноразовые ссылки-приглашения от ученика (?start=p_<token>).
db.exec(`CREATE TABLE IF NOT EXISTS parents (
    parent_id INTEGER NOT NULL, student_id TEXT NOT NULL, since INTEGER NOT NULL,
    PRIMARY KEY (parent_id, student_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS parent_tokens (
    token TEXT PRIMARY KEY, student_id TEXT NOT NULL, created_at INTEGER NOT NULL
)`);
// Глобальные выключатели рассылок (админка /admin). Нет строки = ВКЛ.
db.exec(`CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
function flagOn(key) { const r = db.prepare('SELECT value FROM flags WHERE key = ?').get(key); return !r || r.value === 1; }
function setFlag(key, v) { db.prepare('INSERT INTO flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, v ? 1 : 0); }

const upsertUser = db.prepare(`
    INSERT INTO users (id, first_name, last_name, username, ref, last_seen)
    VALUES (@id, @first_name, @last_name, @username, @ref, datetime('now', 'localtime'))
    ON CONFLICT(id) DO UPDATE SET first_name=@first_name, last_name=@last_name, username=@username, last_seen=datetime('now','localtime')
`);
function trackUser(from, ref) {
    if (!from || from.is_bot) return;
    try { upsertUser.run({ id: from.id, first_name: from.first_name || '', last_name: from.last_name || '', username: from.username || '', ref: ref || null }); }
    catch (e) { console.error('trackUser failed:', e.message); }
}
function displayName(u) {
    if (!u) return '—';
    const n = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    return n || (u.username ? '@' + u.username : String(u.id));
}

// ---------- VPS API / PostgreSQL ----------
let fdb = null, base = null, admin = null;
let engage = null; // модуль вовлечения (engage.js), инициализируется после API
const teachers = new Map(); // tgId(str) -> { name, classes:[{code,name}], orgId, role }
const orgs = new Map();     // orgId(str) -> { name, ownerTgId, teacherIds:[] }

function initHistoryApi() {
    if (!INTERNAL_API_TOKEN) { console.log('VPS API OFF: нет INTERNAL_API_TOKEN'); return false; }
    const compat = createVpsFirestoreCompat({ baseUrl: HISTORY_API_URL, token: INTERNAL_API_TOKEN });
    admin = compat.admin;
    fdb = compat.firestore;
    base = `artifacts/${FB_APP_ID}/public/data`;
    console.log('VPS API ON, слушаю', base);
    return true;
}
// Массив групп бывает смешанным: старые строки (легаси v3) + новые {code,name}.
// Нормализуем к объектам, чтобы /delclass, /myclasses и уведомления не падали на строках.
function normClasses(arr) {
    return (Array.isArray(arr) ? arr : []).map(c => typeof c === 'string' ? { code: c, name: c } : c).filter(c => c && c.code);
}
function teacherClasses(id) { const t = teachers.get(String(id)); return normClasses(t && t.classes); }
function isTeacher(id) { return teachers.has(String(id)) || id === ADMIN_ID; }
function isOrgOwner(id) { const t = teachers.get(String(id)); return !!(t && t.role === 'org_owner' && t.orgId); }
function recipientsForClass(code) {
    const set = new Set();
    for (const [tgId, t] of teachers) {
        if (normClasses(t.classes).some(c => c.code === code)) {
            set.add(Number(tgId));
            if (t.orgId && orgs.has(t.orgId)) set.add(Number(orgs.get(t.orgId).ownerTgId));
        }
    }
    if (ADMIN_ID) set.add(ADMIN_ID);
    return set;
}
function watchTeachers() {
    const attach = () => fdb.collection(`${base}/teachers`).onSnapshot((snap) => {
        for (const change of snap.docChanges()) {
            if (change.type === 'removed') teachers.delete(change.doc.id);
            else teachers.set(change.doc.id, change.doc.data() || {});
        }
        console.log(`teachers cache: ${teachers.size}`);
    }, (err) => { console.error('watchTeachers error:', err.message); setTimeout(attach, 15000); });
    attach();
}
function watchOrgs() {
    const attach = () => fdb.collection(`${base}/orgs`).onSnapshot((snap) => {
        for (const change of snap.docChanges()) {
            if (change.type === 'removed') orgs.delete(change.doc.id);
            else orgs.set(change.doc.id, change.doc.data() || {});
        }
        console.log(`orgs cache: ${orgs.size}`);
    }, (err) => { console.error('watchOrgs error:', err.message); setTimeout(attach, 15000); });
    attach();
}

// ---------- Бот ----------
const bot = new Bot(BOT_TOKEN);
bot.use(async (ctx, next) => { if (ctx.from) trackUser(ctx.from, null); await next(); });
// Команда, вставленная как «код» (скопирована из сообщения с моноширинным текстом),
// приходит БЕЗ entity bot_command — grammY её не матчит, и юзер получает catch-all
// «вся тренировка в приложении». Достраиваем entity сами: команды снова работают.
bot.use(async (ctx, next) => {
    const m = ctx.message;
    if (m && m.text && m.text.startsWith('/')) {
        const hasCmd = (m.entities || []).some(e => e.type === 'bot_command' && e.offset === 0);
        if (!hasCmd) {
            const len = (m.text.split(/\s/)[0] || '').length;
            if (len > 1) { m.entities = m.entities || []; m.entities.unshift({ type: 'bot_command', offset: 0, length: len }); }
        }
    }
    await next();
});

const appKb = () => new InlineKeyboard().webApp('🚀 Открыть тренажёр', APP_URL);

// Клавиатура вызова на дуэль. Второй кнопкой — выключить эти уведомления.
//
// Зачем: зовём ВСЕХ, у кого включены уведомления, и при большой школе это сотни
// сообщений в день. Человек, которому дуэли не нужны, раньше должен был знать
// про /menu → настройки; на практике он просто отключал бота целиком или уходил.
// Отказ в один тап дешевле потерянного ученика.
const duelKb = () => new InlineKeyboard()
    .webApp('⚔️ Принять вызов', APP_URL).row()
    .text('🔕 Не звать на дуэли', 'duel_off');
const repairKb = () => new InlineKeyboard()
    .webApp('1. 🛟 Исправить загрузку', RECOVERY_URL)
    .row()
    .webApp('2. 🚀 Открыть тренажёр заново', RECOVERY_APP_URL);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// ожидание ввода названия группы после нажатия кнопки «Новая группа»
const awaitingInput = new Map(); // userId -> { type, ts }

async function sendSafe(chatId, text, opts) {
    try { return await bot.api.sendMessage(chatId, text, opts); }
    catch (e) {
        const desc = (e && e.description) || String(e);
        if (/blocked|deactivated|chat not found/i.test(desc)) db.prepare('UPDATE users SET notify_hw=0, notify_duel=0, notify_hw_done=0, notify_join=0 WHERE id=?').run(chatId);
        else console.error(`sendSafe ${chatId}:`, desc);
        return null;
    }
}

// ---------- Нативное меню команд (Telegram показывает список по кнопке «/») ----------
const CMD_BASE = [
    { command: 'start', description: '🚀 Открыть тренажёр' },
    { command: 'menu', description: '📋 Меню и все команды' },
    { command: 'pc', description: '💻 Открыть на компьютере' },
    { command: 'parent', description: '👪 Отчёт родителям' },
    { command: 'repair', description: '🛟 Исправить загрузку' },
    { command: 'settings', description: '⚙️ Уведомления' }
];
const CMD_TEACHER = [
    { command: 'menu', description: '📋 Меню' },
    { command: 'newclass', description: '➕ Создать группу' },
    { command: 'myclasses', description: '📚 Мои группы и ссылки' },
    { command: 'msg', description: '📣 Сообщение группе' },
    { command: 'delclass', description: '🗑 Удалить группу' },
    { command: 'repair', description: '🛟 Исправить загрузку' },
    { command: 'settings', description: '⚙️ Уведомления' },
    { command: 'start', description: '🚀 Открыть тренажёр' }
];
const CMD_OWNER = [
    { command: 'menu', description: '📋 Меню' },
    { command: 'newclass', description: '➕ Создать группу' },
    { command: 'myclasses', description: '📚 Группы школы' },
    { command: 'msg', description: '📣 Сообщение группе' },
    { command: 'inviteteacher', description: '👨‍🏫 Пригласить преподавателя' },
    { command: 'delclass', description: '🗑 Удалить группу' },
    { command: 'repair', description: '🛟 Исправить загрузку' },
    { command: 'settings', description: '⚙️ Уведомления' }
];
const CMD_ADMIN = [
    { command: 'admin', description: '🛠 Админка: рассылки, роли, лимиты' },
    { command: 'premium', description: '💎 Подписка клуба ученику (ID/@user)' },
    { command: 'premiumgroup', description: '♾ Группа безлимита (в группе / ID)' },
    { command: 'commands', description: '🗂 Все команды всех ролей' },
    { command: 'stats', description: '📈 Статистика' },
    { command: 'msg', description: '📣 Сообщение группе' },
    { command: 'menu', description: '📋 Меню' },
    { command: 'newclass', description: '➕ Создать группу' },
    { command: 'myclasses', description: '📚 Группы' },
    { command: 'repair', description: '🛟 Исправить загрузку' },
    { command: 'settings', description: '⚙️ Уведомления' },
    { command: 'start', description: '🚀 Открыть тренажёр' }
];
async function applyCommandMenu(userId, forceSet) {
    try {
        const cmds = forceSet || (userId === ADMIN_ID ? CMD_ADMIN : (isOrgOwner(userId) ? CMD_OWNER : (isTeacher(userId) ? CMD_TEACHER : CMD_BASE)));
        await bot.api.setMyCommands(cmds, { scope: { type: 'chat', chat_id: userId } });
    } catch (e) { console.error('setMyCommands', e.message); }
}

// ---------- Инвайты и коды ----------
const PLAIN_CODE = /^[A-Za-z0-9_-]{1,48}$/;
const TRANSLIT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugify(name) {
    const s = String(name || '').toLowerCase().split('').map(ch => TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch).join('').replace(/[^a-z0-9]+/g, '').slice(0, 12);
    return s || 'grp';
}
function randCode(n) { const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)]; return s; }
async function genUniqueCode(name) {
    for (let i = 0; i < 6; i++) { const code = `${slugify(name)}-${randCode(4)}`; const snap = await fdb.doc(`${base}/classes/${code}`).get(); if (!snap.exists) return code; }
    return `${slugify(name)}-${randCode(7)}`;
}
function inviteLink(code) {
    if (PLAIN_CODE.test(code)) return `https://t.me/${BOT_USERNAME}?start=c_${code}`;
    const b64 = Buffer.from(code, 'utf8').toString('base64url');
    if (b64.length > 60) return null;
    return `https://t.me/${BOT_USERNAME}?start=cb_${b64}`;
}
function decodeInvitePayload(payload) {
    if (payload.startsWith('c_')) return payload.slice(2);
    if (payload.startsWith('cb_')) { try { return Buffer.from(payload.slice(3), 'base64url').toString('utf8'); } catch (e) { return null; } }
    return null;
}
function classDocId(code) { return String(code || '').trim().replace(/[\/#?%]/g, '_'); }

// ---------- Меню (кнопки) ----------
function menuText(userId) {
    if (isOrgOwner(userId)) return 'Меню школы 🏫\nВыбери действие или набери «/» для списка команд.';
    if (isTeacher(userId)) return 'Меню репетитора 👨‍🏫\nВыбери действие или набери «/» для списка команд.';
    return 'Меню\nЖми «Открыть тренажёр» — там вся тренировка. Учитель? Стань репетитором ниже.';
}
function menuKeyboard(userId) {
    const kb = new InlineKeyboard().webApp('🚀 Открыть тренажёр', APP_URL).row();
    kb.text('💻 Открыть на компьютере', 'm_pc').text('👪 Отчёт родителям', 'm_parent').row();
    if (isTeacher(userId)) {
        kb.text('➕ Новая группа', 'm_newclass').text('📚 Мои группы', 'm_myclasses').row();
        kb.text('📣 Сообщение группе', 'm_msg').text('🗑 Удалить группу', 'm_delclass').row();
    }
    if (isOrgOwner(userId)) kb.text('👨‍🏫 Пригласить преподавателя', 'm_inviteteacher').row();
    kb.text('⚙️ Уведомления', 'm_settings');
    if (!isTeacher(userId)) kb.row().text('👨‍🏫 Я репетитор', 'm_teacher');
    return kb;
}
async function sendMenu(ctx) { await ctx.reply(menuText(ctx.from.id), { reply_markup: menuKeyboard(ctx.from.id) }); }

// ---------- /start ----------
bot.command('start', async (ctx) => {
    const payload = String(ctx.match || '').trim().slice(0, 64);
    if (payload) trackUser(ctx.from, payload);
    applyCommandMenu(ctx.from.id);

    // подтверждение QR-входа на ПК: ученик отсканировал код с экрана компьютера телефоном
    if (payload.startsWith('pc_') && fdb) {
        const token = payload.slice(3);
        try {
            const ref = fdb.doc(`${base}/loginSessions/${token}`);
            const snap = await ref.get();
            if (!snap.exists) { await ctx.reply('QR-код устарел или уже использован. Обнови страницу на ПК и попробуй снова.'); return; }
            const d = snap.data() || {};
            if (d.exp && Date.now() > d.exp) { try { await ref.delete(); } catch (e) {} await ctx.reply('QR-код истёк. Обнови страницу на ПК и отсканируй заново.'); return; }
            await ref.set({ status: 'confirmed', tgId: ctx.from.id, name: displayName(ctx.from), confirmedAt: Date.now() }, { merge: true });
            await ctx.reply('✅ Готово! Возвращайся к компьютеру — прогресс уже загружается.');
            return;
        } catch (e) { console.error('pc-login confirm failed:', e.message); await ctx.reply('Не удалось подтвердить вход, попробуй ещё раз.'); return; }
    }

    // приглашение методиста в школу
    if (payload.startsWith('t_') && fdb) {
        const orgId = payload.slice(2);
        const org = orgs.get(orgId);
        if (org) {
            try {
                await fdb.doc(`${base}/teachers/${ctx.from.id}`).set({ name: displayName(ctx.from), username: ctx.from.username || '', role: 'org_teacher', orgId, classes: [], joinedAt: Date.now() }, { merge: true });
                await fdb.doc(`${base}/orgs/${orgId}`).set({ teacherIds: admin.firestore.FieldValue.arrayUnion(ctx.from.id) }, { merge: true });
                applyCommandMenu(ctx.from.id, CMD_TEACHER);
                await ctx.reply(`Вы присоединились к школе «${org.name}» как преподаватель! 👨‍🏫\n\nЖми /menu — там всё под рукой.`, { reply_markup: menuKeyboard(ctx.from.id) });
                const ownerId = Number(org.ownerTgId);
                if (ownerId && ownerId !== ctx.from.id) await sendSafe(ownerId, `👨‍🏫 ${displayName(ctx.from)} присоединился к вашей школе «${org.name}»`);
                return;
            } catch (e) { console.error('org-teacher join failed:', e.message); }
        }
    }

    // подписка родителя на отчёт (ссылка от ученика: /parent)
    if (payload.startsWith('p_')) {
        const token = payload.slice(2);
        const row = db.prepare('SELECT student_id, created_at FROM parent_tokens WHERE token = ?').get(token);
        if (!row || Date.now() - row.created_at > 30 * 86400000) {
            await ctx.reply('Ссылка на отчёт устарела. Попросите ребёнка отправить новую: команда /parent в этом боте.');
            return;
        }
        if (String(ctx.from.id) === String(row.student_id)) {
            await ctx.reply('Это твоя собственная ссылка 🙂 Перешли её родителю — отчёты будут приходить ему.');
            return;
        }
        db.prepare('INSERT OR IGNORE INTO parents (parent_id, student_id, since) VALUES (?, ?, ?)').run(ctx.from.id, String(row.student_id), Date.now());
        let childName = 'ребёнка';
        try { if (fdb) { const s = await fdb.doc(`${base}/students/${row.student_id}`).get(); if (s.exists && s.data().name) childName = s.data().name; } } catch (e) {}
        await ctx.reply(
            `✅ Вы подписаны на еженедельный отчёт об успехах: ${childName}.\n\n` +
            'Каждое воскресенье в 18:00 (МСК) сюда придёт сводка: сколько решено за неделю, серия занятий, домашние задания.\n\n' +
            'Отписаться в любой момент: /parentstop');
        return;
    }

    // приглашение ученика в класс
    const invitedClass = payload ? decodeInvitePayload(payload) : null;
    if (invitedClass && fdb) {
        const code = classDocId(invitedClass);

        // ⚠️ Преподавателя по ссылке в группу НЕ записываем.
        //
        // Ссылку на свою же группу учитель открывает постоянно — проверить, что она
        // рабочая, переслать ученику, ткнуть в истории чата. Раньше каждое такое
        // нажатие делало его учеником собственной группы: приложение подтягивало ему
        // ВСЕ старые ДЗ класса как свои, в кабинете он появлялся в списке учеников, а
        // выйти было нельзя — способа покинуть группу в интерфейсе нет вовсе.
        // Замер 27.07.2026: так залипли двое из трёх учителей на бою.
        //
        // Ниже по коду это уже частично знали: уведомление «вступил в группу» себе не
        // шлют (`tid === ctx.from.id`). Но подавили только уведомление, а не запись.
        if (isTeacher(ctx.from.id)) {
            const mine = teacherClasses(ctx.from.id).some(c => classDocId(c.code) === code);
            await ctx.reply(mine
                ? 'Это ссылка-приглашение в вашу собственную группу — перешлите её ученикам. 👨‍🏫\n\nВы преподаватель, поэтому учеником группы вы не стали.'
                : 'Вы преподаватель, поэтому по ученической ссылке в группу вас не записали. 👨‍🏫\n\nЕсли нужно посмотреть тренажёр глазами ученика — откройте его с отдельного аккаунта.',
                { reply_markup: appKb() });
            return;
        }

        try {
            // classCode ставим сразу — ученик появляется в кабинете учителя, даже если ещё не
            // открыл приложение. inviteClassCode — «оверрайд» для приложения (тост, подтяжка ДЗ,
            // очистка старого локального кода при первом заходе).
            await fdb.doc(`${base}/students/${ctx.from.id}`).set({ classCode: code, inviteClassCode: code, inviteAt: Date.now() }, { merge: true });
            let clsName = code;
            try { const cs = await fdb.doc(`${base}/classes/${code}`).get(); if (cs.exists && cs.data().name) clsName = cs.data().name; } catch (e) {}
            await ctx.reply(`Ты приглашён в группу «${clsName}»! 🎓\n\nОткрой тренажёр — группа подключится сама, репетитор увидит прогресс и будет присылать ДЗ 👇`, { reply_markup: appKb() });
            const who = displayName(ctx.from) + (ctx.from.username ? ` (@${ctx.from.username})` : '');
            if (flagOn('join')) for (const tid of recipientsForClass(code)) {
                if (tid === ctx.from.id) continue;
                const u = db.prepare('SELECT notify_join FROM users WHERE id = ?').get(tid);
                if (u && !u.notify_join) continue;
                await sendSafe(tid, `➕ ${who} вступил в группу «${clsName}»`); await sleep(50);
            }
            return;
        } catch (e) { console.error('invite join failed:', e.message); }
    }

    await ctx.reply(
        `Привет, ${ctx.from.first_name || 'будущий стобалльник'}! 👋\n\n` +
        'Это «Решаю историю» — тренажёр для подготовки к ЕГЭ и ОГЭ:\n' +
        '📅 даты и события · 🖼 культура и карты · ⚔️ дуэли с друзьями · 📚 ДЗ от репетитора\n\n' +
        'Открывай и решай — всё бесплатно 👇\n\nА чтобы я подсказал, с чего начать, — выбери, кто ты:',
        { reply_markup: new InlineKeyboard()
            .webApp('🚀 Открыть тренажёр', APP_URL).row()
            .text('👨‍🎓 Я ученик', 'onb_student').text('👨‍🏫 Я репетитор', 'onb_teacher').row()
            .text('👪 Я родитель', 'onb_parent') });
});

// ---------- Онбординг по ролям (кнопки под /start) ----------
bot.callbackQuery('onb_student', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
        '👨‍🎓 Как заниматься:\n\n' +
        '1️⃣ Жми «Открыть тренажёр» — решай даты, культуру, карты и дуэли. Умная кнопка сама подскажет, что учить сегодня.\n' +
        '2️⃣ Занимаешься с репетитором? Попроси у него ссылку-приглашение в группу — ДЗ будут приходить прямо сюда.\n' +
        '3️⃣ Удобнее на компьютере? Открой reshay-istoriyu.ru и войди по QR-коду — прогресс общий.\n\n' +
        '🔔 Напоминания о ДЗ и дуэлях включаются в /settings',
        { reply_markup: appKb() });
});
bot.callbackQuery('onb_teacher', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
        '👨‍🏫 Кабинет репетитора — это:\n\n' +
        '• группы учеников и их прогресс в реальном времени\n' +
        '• ДЗ в пару кликов — бот сам доставит и напомнит\n' +
        '• еженедельный дайджест и сигналы «кто буксует»\n' +
        '• отчёты родителям без вашего участия\n\n' +
        'Жми кнопку — заявка уйдёт на одобрение, обычно это быстро.',
        { reply_markup: new InlineKeyboard().text('👨‍🏫 Стать репетитором', 'm_teacher') });
});
bot.callbackQuery('onb_parent', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
        '👪 Родителям:\n\n' +
        'Раз в неделю (воскресенье, 18:00 МСК) бот присылает отчёт: сколько ребёнок решил, ' +
        'какая серия занятий, сданы ли домашние задания.\n\n' +
        'Как подключить: попросите ребёнка отправить этому боту команду /parent — ' +
        'он получит ссылку и перешлёт её вам. Один клик — и отчёты приходят.');
});

// ---------- Меню/помощь ----------
bot.command(['menu', 'help'], async (ctx) => { applyCommandMenu(ctx.from.id); await sendMenu(ctx); });
bot.command('id', async (ctx) => { await ctx.reply(`Твой Telegram ID: \`${ctx.from.id}\``, { parse_mode: 'Markdown' }); });
bot.command('repair', async (ctx) => {
    applyCommandMenu(ctx.from.id);
    await ctx.reply(
        'Если тренажёр не начинает загружаться:\n\n' +
        '1. Нажми «Исправить загрузку». Если окно не закрылось само — закрой его крестиком.\n' +
        '2. Затем нажми «Открыть тренажёр заново».\n\n' +
        'Будет удалён только старый кэш приложения. Аккаунт и прогресс сохранятся.',
        { reply_markup: repairKb() }
    );
});

// ---------- Вход на компьютере (магик-линк) ----------
// Ученик тренируется в Telegram, а на ПК (обычный браузер, без TG) открывает ссылку
// с одноразовым токеном → приложение (?login=<token>) подхватывает его tgId и тот же
// прогресс. Токен неугадываемый, короткоживущий, одноразовый (приложение удаляет его).
async function doPcLogin(ctx) {
    if (!fdb) return ctx.reply('Сервис временно недоступен, попробуйте позже.');
    try {
        const token = crypto.randomBytes(18).toString('hex'); // 36 симв.
        const ttlMin = 15;
        await fdb.doc(`${base}/loginTokens/${token}`).set({
            tgId: ctx.from.id, name: displayName(ctx.from),
            exp: Date.now() + ttlMin * 60 * 1000, createdAt: Date.now()
        });
        const sep = APP_URL.includes('?') ? '&' : '?';
        const link = `${APP_URL}${sep}login=${token}`;
        await ctx.reply(
            '💻 Открыть на компьютере\n\n' +
            '1. На ПК открой этот адрес (лучше скопировать целиком):\n' + link + '\n\n' +
            '2. Прогресс из Telegram подхватится сам — продолжишь с того же места.\n\n' +
            `⏳ Ссылка одноразовая и работает ${ttlMin} минут. Никому не пересылай — по ней открывается твой аккаунт.`,
            { link_preview_options: { is_disabled: true } }
        );
    } catch (e) {
        console.error('pc-login failed:', e.message);
        await ctx.reply('Не удалось создать ссылку, попробуйте ещё раз.');
    }
}
bot.command('pc', doPcLogin);

// ---------- Отчёт родителям ----------
// Ученик получает персональную ссылку и передаёт её родителю. По ссылке родитель
// подписывается на еженедельную сводку (рассылает engage.js по воскресеньям 18:00).
async function doParentLink(ctx) {
    try { db.prepare('DELETE FROM parent_tokens WHERE created_at < ?').run(Date.now() - 30 * 86400000); } catch (e) {}
    const token = crypto.randomBytes(8).toString('hex');
    db.prepare('INSERT INTO parent_tokens (token, student_id, created_at) VALUES (?, ?, ?)').run(token, String(ctx.from.id), Date.now());
    const link = `https://t.me/${BOT_USERNAME}?start=p_${token}`;
    await ctx.reply(
        '👪 Отчёт для родителей\n\n' +
        'Отправь родителю эту ссылку:\n' + link + '\n\n' +
        'Каждое воскресенье ему будет приходить сводка: сколько ты решил за неделю, серия занятий, как дела с ДЗ.\n' +
        'Ссылка работает 30 дней, подписаться могут оба родителя.',
        { link_preview_options: { is_disabled: true } });
}
bot.command('parent', doParentLink);
bot.command('parentstop', async (ctx) => {
    const n = db.prepare('DELETE FROM parents WHERE parent_id = ?').run(ctx.from.id).changes;
    await ctx.reply(n ? '✅ Вы отписаны от отчётов.' : 'У вас нет активных подписок на отчёты.');
});

// ---------- Сообщение группе от учителя ----------
// /msg текст (одна группа) или /msg КОД текст (несколько групп).
// Анти-спам: не чаще раза в 5 минут на группу.
const _msgCooldown = new Map(); // `${teacherId}:${code}` -> ts
async function doClassMsg(ctx, rawText) {
    if (!isTeacher(ctx.from.id)) return;
    if (!fdb) return ctx.reply('Сервис временно недоступен.');
    let text = String(rawText || '').trim();
    const myClasses = teacherClasses(ctx.from.id);
    if (!text) {
        const hint = myClasses.length > 1 ? `\nУ вас несколько групп — укажите код первым словом:\n${myClasses.map(c => `/msg ${c.code} текст`).join('\n')}` : '';
        return ctx.reply('📣 Сообщение группе: /msg текст — его получат все ученики группы.' + hint);
    }
    let code = null;
    const firstTok = text.split(/\s+/)[0];
    if (myClasses.some(c => c.code === firstTok)) { code = firstTok; text = text.slice(firstTok.length).trim(); }
    else if (myClasses.length === 1) code = myClasses[0].code;
    else if (ctx.from.id === ADMIN_ID && /^[\w-]{2,48}$/.test(firstTok) && text.includes(' ')) {
        // админ может писать любой группе по коду
        const cs = await fdb.doc(`${base}/classes/${classDocId(firstTok)}`).get();
        if (cs.exists) { code = firstTok; text = text.slice(firstTok.length).trim(); }
    }
    if (!code) return ctx.reply(`Укажите код группы первым словом:\n${myClasses.map(c => `/msg ${c.code} текст`).join('\n') || 'Сначала создайте группу: /newclass'}`);
    if (!text) return ctx.reply('Текст пустой. Формат: /msg ' + (myClasses.length > 1 ? code + ' ' : '') + 'текст');
    if (text.length > 1500) return ctx.reply('Слишком длинно (макс. 1500 символов).');
    const cdKey = `${ctx.from.id}:${code}`;
    if (Date.now() - (_msgCooldown.get(cdKey) || 0) < 5 * 60 * 1000) return ctx.reply('⏳ Не так часто: одной группе — не чаще раза в 5 минут.');
    let clsName = code;
    try { const cs = await fdb.doc(`${base}/classes/${classDocId(code)}`).get(); if (cs.exists && cs.data().name) clsName = cs.data().name; } catch (e) {}
    const t = teachers.get(String(ctx.from.id));
    const teacherName = (t && t.name) || displayName(ctx.from);
    const q = await fdb.collection(`${base}/students`).where('classCode', '==', code).get();
    const chatIds = new Set();
    q.forEach(s => {
        const d = s.data() || {}; if (d._mergedInto) return;
        const cand = d.knownTgId || d.tgId || (/^\d+$/.test(s.id) ? s.id : null);
        const n = Number(cand); if (Number.isFinite(n) && n > 0 && n !== ctx.from.id) chatIds.add(n);
    });
    if (!chatIds.size) return ctx.reply(`В группе «${clsName}» пока нет учеников с Telegram.`);
    _msgCooldown.set(cdKey, Date.now());
    let sent = 0;
    for (const id of chatIds) {
        const ok = await sendSafe(id, `📣 Сообщение от ${teacherName} (группа «${clsName}»):\n\n${text}`, { reply_markup: appKb() });
        if (ok) sent++;
        await sleep(60);
    }
    await ctx.reply(`✅ Доставлено ${sent} из ${chatIds.size} учеников группы «${clsName}».`);
}
bot.command('msg', (ctx) => doClassMsg(ctx, ctx.match));

// ---------- Роль репетитора ----------
async function doBecomeTeacher(ctx) {
    if (!fdb) return ctx.reply('Сервис временно недоступен, попробуйте позже.');
    if (isTeacher(ctx.from.id)) return ctx.reply('Вы уже репетитор! 👨‍🏫 Меню: /menu');
    if (!ADMIN_ID) return ctx.reply('Заявки временно не принимаются.');
    const who = displayName(ctx.from) + (ctx.from.username ? ` (@${ctx.from.username})` : '') + `, id ${ctx.from.id}`;
    const kb = new InlineKeyboard().text('✅ Одобрить', `t_approve:${ctx.from.id}`).text('❌ Отклонить', `t_deny:${ctx.from.id}`);
    await sendSafe(ADMIN_ID, `👨‍🏫 Заявка на роль репетитора:\n${who}`, { reply_markup: kb });
    await ctx.reply('Заявка отправлена! Как только одобрят — придёт уведомление.');
}
bot.command('teacher', doBecomeTeacher);

bot.callbackQuery(/^t_(approve|deny):(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    const action = ctx.match[1], targetId = Number(ctx.match[2]);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    const who = displayName(u || { id: targetId });
    if (action === 'approve') {
        if (!fdb) return ctx.answerCallbackQuery('Сервер данных недоступен');
        await fdb.doc(`${base}/teachers/${targetId}`).set({ name: who, username: (u && u.username) || '', role: 'solo', classes: [], approvedAt: Date.now(), approvedBy: ADMIN_ID }, { merge: true });
        applyCommandMenu(targetId, CMD_TEACHER);
        await ctx.answerCallbackQuery('Одобрено');
        await ctx.editMessageText(`✅ ${who} — теперь репетитор`);
        await sendSafe(targetId, 'Вас одобрили как репетитора! 👨‍🏫\n\nВсё делается через /menu:\n• ➕ Новая группа — получите ссылку для учеников\n• 📚 Мои группы — список и ссылки\n\nЕсли кабинет в приложении не открылся — перезайдите в тренажёр.', { reply_markup: appKb() });
    } else {
        await ctx.answerCallbackQuery('Отклонено');
        await ctx.editMessageText(`❌ ${who} — заявка отклонена`);
        await sendSafe(targetId, 'Заявка на роль репетитора отклонена.');
    }
});

// ---------- Организации ----------
async function doNewOrg(ctx, rawName) {
    if (!fdb) return ctx.reply('Сервис временно недоступен.');
    if (isOrgOwner(ctx.from.id)) { const t = teachers.get(String(ctx.from.id)); const org = orgs.get(t.orgId); return ctx.reply(`У вас уже есть школа «${org ? org.name : t.orgId}». Пригласить преподавателей: /inviteteacher`); }
    const name = String(rawName || '').trim().slice(0, 60);
    if (!name) return ctx.reply('Укажите название школы: `/neworg ИСТОРИК`', { parse_mode: 'Markdown' });
    if (!ADMIN_ID) return ctx.reply('Регистрация школ временно недоступна.');
    db.prepare('INSERT OR REPLACE INTO pending_orgs (user_id, name, created_at) VALUES (?, ?, ?)').run(ctx.from.id, name, Date.now());
    const who = displayName(ctx.from) + (ctx.from.username ? ` (@${ctx.from.username})` : '') + `, id ${ctx.from.id}`;
    const kb = new InlineKeyboard().text('✅ Одобрить школу', `o_approve:${ctx.from.id}`).text('❌ Отклонить', `o_deny:${ctx.from.id}`);
    await sendSafe(ADMIN_ID, `🏫 Заявка на школу:\n«${name}»\nВладелец: ${who}`, { reply_markup: kb });
    await ctx.reply(`Заявка на школу «${name}» отправлена. Ждите одобрения.`);
}
bot.command('neworg', (ctx) => doNewOrg(ctx, ctx.match));

bot.callbackQuery(/^o_(approve|deny):(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    const action = ctx.match[1], targetId = Number(ctx.match[2]);
    const pend = db.prepare('SELECT * FROM pending_orgs WHERE user_id = ?').get(targetId);
    if (!pend) { await ctx.answerCallbackQuery('Заявка не найдена'); return; }
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    const who = displayName(u || { id: targetId });
    if (action === 'approve') {
        const orgId = `org_${targetId}`;
        await fdb.doc(`${base}/orgs/${orgId}`).set({ name: pend.name, ownerTgId: targetId, teacherIds: [targetId], createdAt: Date.now() }, { merge: true });
        await fdb.doc(`${base}/teachers/${targetId}`).set({ name: who, username: (u && u.username) || '', role: 'org_owner', orgId, classes: [], approvedAt: Date.now(), approvedBy: ADMIN_ID }, { merge: true });
        db.prepare('DELETE FROM pending_orgs WHERE user_id = ?').run(targetId);
        applyCommandMenu(targetId, CMD_OWNER);
        await ctx.answerCallbackQuery('Школа одобрена');
        await ctx.editMessageText(`✅ Школа «${pend.name}» одобрена (владелец ${who})`);
        await sendSafe(targetId, `Школа «${pend.name}» зарегистрирована! 🏫\n\nЧерез /menu:\n• 👨‍🏫 Пригласить преподавателя — ссылка для методистов\n• ➕ Новая группа — создать группу самому\n• 📚 Группы школы — все группы и статистика\n\nВы получаете уведомления о сдаче ДЗ во всех группах школы.`, { reply_markup: menuKeyboard(targetId) });
    } else {
        db.prepare('DELETE FROM pending_orgs WHERE user_id = ?').run(targetId);
        await ctx.answerCallbackQuery('Отклонено');
        await ctx.editMessageText(`❌ Школа «${pend.name}» отклонена`);
        await sendSafe(targetId, `Заявка на школу «${pend.name}» отклонена.`);
    }
});

async function doInviteTeacher(ctx) {
    if (!isOrgOwner(ctx.from.id)) return ctx.reply('Команда для владельцев школ. Зарегистрировать: /neworg Название');
    const t = teachers.get(String(ctx.from.id)); const org = orgs.get(t.orgId);
    const link = `https://t.me/${BOT_USERNAME}?start=t_${t.orgId}`;
    await ctx.reply(`Приглашение преподавателей в школу «${org ? org.name : ''}»:\n\n${link}\n\nОтправьте методистам. Кто нажмёт — станет преподавателем школы, а вы будете видеть все его группы.`, { link_preview_options: { is_disabled: true } });
}
bot.command('inviteteacher', doInviteTeacher);

// ---------- Группы ----------
async function createClass(ctx, rawName) {
    if (!isTeacher(ctx.from.id)) return ctx.reply('Сначала станьте репетитором: /teacher');
    if (!fdb) return ctx.reply('Сервис временно недоступен.');
    const name = String(rawName || '').trim().slice(0, 60);
    if (!name) { awaitingInput.set(ctx.from.id, { type: 'classname', ts: Date.now() }); return ctx.reply('Как назвать группу? Отправьте название сообщением (например: Вечерняя 10А).'); }
    const code = await genUniqueCode(name);
    const t = teachers.get(String(ctx.from.id));
    const orgId = (t && t.orgId) || null;
    // unlimited наследуется от учителя: новые группы безлимитного репетитора сразу без лимита строк
    await fdb.doc(`${base}/classes/${code}`).set({ name, ownerTgId: ctx.from.id, orgId, unlimited: !!(t && t.unlimited), createdAt: Date.now() }, { merge: true });
    await fdb.doc(`${base}/teachers/${ctx.from.id}`).set({ name: displayName(ctx.from), username: ctx.from.username || '', classes: admin.firestore.FieldValue.arrayUnion({ code, name }) }, { merge: true });
    const link = inviteLink(code);
    await ctx.reply(`Группа «${name}» создана! 🎓\n\nСсылка-приглашение для учеников:\n${link}\n\nОтправьте её в чат группы или лично. Список групп: /myclasses`, { link_preview_options: { is_disabled: true } });
}
bot.command('newclass', (ctx) => createClass(ctx, ctx.match));

async function classCount(code) {
    try { const agg = await fdb.collection(`${base}/students`).where('classCode', '==', code).count().get(); return agg.data().count; }
    catch (e) { return '?'; }
}
async function doMyClasses(ctx) {
    if (!isTeacher(ctx.from.id)) return;
    if (!fdb) return ctx.reply('Сервис временно недоступен.');
    let list = [];
    if (isOrgOwner(ctx.from.id)) {
        const myOrg = teachers.get(String(ctx.from.id)).orgId;
        for (const [tgId, t] of teachers) { if (t.orgId === myOrg) for (const c of (t.classes || [])) list.push({ ...c, owner: t.name, mine: String(tgId) === String(ctx.from.id) }); }
    } else list = teacherClasses(ctx.from.id).map(c => ({ ...c, mine: true }));
    if (!list.length) return ctx.reply('Групп пока нет. Создайте: ➕ Новая группа (/newclass Название)');
    let msg = isOrgOwner(ctx.from.id) ? `🏫 Группы школы (${list.length}):\n` : `📚 Ваши группы (${list.length}):\n`;
    for (const c of list.slice(0, 25)) {
        const n = await classCount(c.code); const link = inviteLink(c.code);
        const by = (isOrgOwner(ctx.from.id) && !c.mine) ? ` · ведёт: ${c.owner}` : '';
        msg += `\n• «${c.name}» — ${n} уч.${by}\n  ${link}`;
    }
    msg += '\n\nПодробный прогресс и ДЗ — в кабинете учителя (в приложении).';
    await ctx.reply(msg, { link_preview_options: { is_disabled: true } });
}
bot.command('myclasses', doMyClasses);

async function doDelClass(ctx) {
    if (!isTeacher(ctx.from.id)) return;
    const list = teacherClasses(ctx.from.id);
    if (!list.length) return ctx.reply('У вас нет групп.');
    const kb = new InlineKeyboard();
    for (const c of list.slice(0, 20)) kb.text(`🗑 ${c.name}`.slice(0, 60), `delcls:${c.code}`).row();
    await ctx.reply('Какую группу удалить? Ученики и их прогресс сохранятся — группа просто исчезнет из кабинета.', { reply_markup: kb });
}
bot.command('delclass', doDelClass);

bot.callbackQuery('delcls_cancel', async (ctx) => { await ctx.answerCallbackQuery('Отменено'); try { await ctx.editMessageText('Отменено.'); } catch (e) {} });
bot.callbackQuery(/^delcls:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const c = teacherClasses(ctx.from.id).find(x => x.code === code);
    if (!c) return ctx.answerCallbackQuery('Группа не найдена');
    const kb = new InlineKeyboard().text('❗ Точно удалить', `delclsY:${code}`).text('Отмена', 'delcls_cancel');
    await ctx.answerCallbackQuery();
    try { await ctx.editMessageText(`Удалить группу «${c.name}»? Прогресс учеников сохранится.`, { reply_markup: kb }); } catch (e) {}
});
bot.callbackQuery(/^delclsY:(.+)$/, async (ctx) => {
    if (!fdb) return ctx.answerCallbackQuery('Сервис недоступен');
    const code = ctx.match[1];
    // ВЛАДЕНИЕ: удалять/архивировать можно только СВОЮ группу (иначе любой учитель мог бы
    // заархивировать чужой класс, зная его код).
    if (!teacherClasses(ctx.from.id).some(x => x.code === code)) return ctx.answerCallbackQuery('Это не ваша группа');
    try {
        const tref = fdb.doc(`${base}/teachers/${ctx.from.id}`);
        const snap = await tref.get();
        // нормализуем (убираем и легаси-строки) и вычищаем удаляемый код
        const classes = normClasses(snap.exists ? snap.data().classes : []).filter(x => x.code !== code);
        await tref.set({ classes }, { merge: true });
        try { await fdb.doc(`${base}/classes/${code}`).set({ archived: true, archivedAt: Date.now() }, { merge: true }); } catch (e) {}
        await ctx.answerCallbackQuery('Удалено');
        await ctx.editMessageText('✅ Группа удалена из кабинета. Ученики и их прогресс сохранены.');
    } catch (e) { console.error('delclass failed:', e.message); await ctx.answerCallbackQuery('Ошибка'); }
});

// ---------- Настройки уведомлений ----------
function settingsKb(userId) {
    const u = db.prepare('SELECT notify_hw, notify_duel, notify_hw_done, notify_join, notify_streak, notify_digest, notify_alerts FROM users WHERE id = ?').get(userId) || {};
    const on = (v) => (v === undefined || v ? 'вкл ✅' : 'выкл ❌');
    const kb = new InlineKeyboard()
        .text(`📚 Домашка: ${on(u.notify_hw)}`, 'toggle_hw').row()
        .text(`⚔️ Дуэли: ${on(u.notify_duel)}`, 'toggle_duel').row()
        .text(`🔥 Напоминания о серии: ${on(u.notify_streak)}`, 'toggle_streak');
    if (isTeacher(userId)) kb
        .row().text(`✅ Сдача ДЗ: ${on(u.notify_hw_done)}`, 'toggle_hw_done')
        .row().text(`➕ Новые ученики: ${on(u.notify_join)}`, 'toggle_join')
        .row().text(`📊 Дайджест недели: ${on(u.notify_digest)}`, 'toggle_digest')
        .row().text(`⚠️ Алерты по группе: ${on(u.notify_alerts)}`, 'toggle_alerts');
    return kb;
}
async function doSettings(ctx) { await ctx.reply('Какие уведомления присылать?', { reply_markup: settingsKb(ctx.from.id) }); }
bot.command('settings', doSettings);
const TOGGLE_COLS = { toggle_hw: 'notify_hw', toggle_duel: 'notify_duel', toggle_hw_done: 'notify_hw_done', toggle_join: 'notify_join', toggle_streak: 'notify_streak', toggle_digest: 'notify_digest', toggle_alerts: 'notify_alerts' };
bot.callbackQuery(Object.keys(TOGGLE_COLS), async (ctx) => {
    const col = TOGGLE_COLS[ctx.callbackQuery.data];
    db.prepare(`UPDATE users SET ${col} = 1 - ${col} WHERE id = ?`).run(ctx.from.id);
    await ctx.answerCallbackQuery('Сохранено');
    try { await ctx.editMessageReplyMarkup({ reply_markup: settingsKb(ctx.from.id) }); } catch (e) {}
});

// Отказ от вызовов на дуэль прямо из уведомления.
//
// ⚠️ Именно ВЫКЛЮЧАЕТ, а не переключает: человек жмёт «не звать» в конкретном
// сообщении, и повторное нажатие (случайное, или по старому сообщению в истории)
// не должно включить рассылку обратно. Переключатель живёт в /menu → настройки,
// там он и остаётся двусторонним.
bot.callbackQuery('duel_off', async (ctx) => {
    db.prepare('UPDATE users SET notify_duel = 0 WHERE id = ?').run(ctx.from.id);
    await ctx.answerCallbackQuery('Больше не зовём на дуэли');
    // Само сообщение убираем: оно уже неактуально, а в истории чата такие вызовы
    // копятся сотнями. Не вышло удалить (старше 48 часов) — гасим кнопки.
    try { await ctx.deleteMessage(); }
    catch (e) {
        try { await ctx.editMessageText('🔕 Вызовы на дуэль отключены. Вернуть: /menu → ⚙️ Настройки.'); } catch (e2) {}
    }
});

// ---------- Кнопки меню ----------
bot.callbackQuery('m_newclass', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTeacher(ctx.from.id)) return ctx.reply('Сначала станьте репетитором: /teacher');
    awaitingInput.set(ctx.from.id, { type: 'classname', ts: Date.now() });
    await ctx.reply('Как назвать группу? Отправьте название сообщением (например: Вечерняя 10А).');
});
bot.callbackQuery('m_myclasses', async (ctx) => { await ctx.answerCallbackQuery(); await doMyClasses(ctx); });
bot.callbackQuery('m_delclass', async (ctx) => { await ctx.answerCallbackQuery(); await doDelClass(ctx); });
bot.callbackQuery('m_inviteteacher', async (ctx) => { await ctx.answerCallbackQuery(); await doInviteTeacher(ctx); });
bot.callbackQuery('m_settings', async (ctx) => { await ctx.answerCallbackQuery(); await doSettings(ctx); });
bot.callbackQuery('m_teacher', async (ctx) => { await ctx.answerCallbackQuery(); await doBecomeTeacher(ctx); });
bot.callbackQuery('m_pc', async (ctx) => { await ctx.answerCallbackQuery(); await doPcLogin(ctx); });
bot.callbackQuery('m_parent', async (ctx) => { await ctx.answerCallbackQuery(); await doParentLink(ctx); });
bot.callbackQuery('m_msg', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isTeacher(ctx.from.id)) return ctx.reply('Сначала станьте репетитором: /teacher');
    const my = teacherClasses(ctx.from.id);
    if (my.length === 1) {
        awaitingInput.set(ctx.from.id, { type: 'classmsg', code: my[0].code, ts: Date.now() });
        return ctx.reply(`Напишите текст — я отправлю его всем ученикам группы «${my[0].name || my[0].code}».`);
    }
    await ctx.reply('Формат: /msg КОД текст\n' + (my.map(c => `• /msg ${c.code} …`).join('\n') || 'Сначала создайте группу: /newclass'));
});

// ---------- Админ ----------
// Полная шпаргалка по всем командам и ролям (только админ). Без Markdown —
// в токенах есть «_» (start=c_КОД, t_orgId), легаси-разметка бы поломала отправку.
function commandsCheatsheet() {
    return [
        '🗂 ВСЕ КОМАНДЫ БОТА',
        '',
        '👤 Ученик (база, у всех):',
        '/start — открыть тренажёр',
        '/menu (/help) — меню и кнопки',
        '/pc — открыть на компьютере (магик-линк + QR)',
        '/parent — ссылка родителю на еженедельный отчёт',
        '/settings — уведомления: 📚 Домашка, ⚔️ Дуэли, 🔥 Серия',
        '/id — узнать свой Telegram ID',
        '/teacher — заявка «стать репетитором» (аппрув админом)',
        '',
        '👪 Родитель:',
        'Подписка — по ссылке от ребёнка (…?start=p_токен)',
        '/parentstop — отписаться от отчётов',
        '',
        '👨‍🏫 Репетитор:',
        '/newclass Название — создать группу (автокод)',
        '/myclasses — мои группы + инвайт-ссылки для учеников',
        '/msg текст — сообщение всем ученикам группы (несколько групп: /msg КОД текст)',
        '/delclass — удалить (архивировать) группу',
        '/settings — плюс: ✅ Сдача ДЗ, ➕ Новые ученики, 📊 Дайджест, ⚠️ Алерты',
        'Пригласить ученика — ссылкой из /myclasses (t.me/…?start=c_КОД)',
        '',
        '🏫 Владелец школы: всё как у репетитора, плюс',
        '/neworg Название — создать школу (аппрув админом)',
        '/inviteteacher — ссылка приглашения препода (…?start=t_orgId)',
        '/myclasses — группы всей школы',
        '',
        '👑 Админ (ты):',
        '/admin — АДМИНКА: рассылки · учителя (роль, ♾ безлимит группам) · 📏 лимиты строк/день',
        '/premium ID или @user — вкл/выкл подписку клуба ученику (безлимит по тарифу «подписчики»)',
        '/commands — эта шпаргалка',
        '/stats — всего/сегодня/неделя/учителя/школы/ref-источники',
        '/msg КОД текст — сообщение любой группе',
        'Аппрув заявок — кнопками под сообщением (репетиторы и школы)',
        '',
        '🔁 Автоматика (без команд, шлётся сама; вкл/выкл — в /admin):',
        '• Новое ДЗ → пуш ученику + переотправка через 6ч, если не открыл',
        '• 🌅 Пульс админу 10:00 МСК · ⚠️ Алерты учителю 09:00 · ⏰ Дедлайн-пинг 15:00 · 🔥 Стрик-пинг 17:00',
        '• Вс: 👪 Отчёты родителям 18:00 · 📊 Дайджест учителю 19:00',
        '• «Кто-то ищет дуэль» — всем желающим без кулдауна; сообщение затирается, когда матч начался или поиск окончен'
    ].join('\n');
}
bot.command('commands', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply(commandsCheatsheet());
});

bot.command('stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const total = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    const today = db.prepare("SELECT COUNT(*) n FROM users WHERE date(last_seen) = date('now', 'localtime')").get().n;
    const week = db.prepare("SELECT COUNT(*) n FROM users WHERE last_seen >= datetime('now', 'localtime', '-7 days')").get().n;
    const hwSent = db.prepare('SELECT COUNT(*) n FROM seen_assignments').get().n;
    const refs = db.prepare('SELECT ref, COUNT(*) n FROM users WHERE ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 10').all();
    let msg = `👥 Всего: ${total}\n📆 Сегодня: ${today}\n🗓 За 7 дней: ${week}\n👨‍🏫 Учителей: ${teachers.size}\n🏫 Школ: ${orgs.size}\n📚 Уведомлений о ДЗ: ${hwSent}\n🗄 Сервер данных: ${fdb ? 'ON' : 'OFF'}`;
    if (refs.length) msg += '\n\nИсточники (ref):\n' + refs.map(r => `• ${r.ref}: ${r.n}`).join('\n');
    await ctx.reply(msg);
});

// ---------- Админка (/admin): выключатели рассылок, роли, тесты ----------
const FLAG_DEFS = [
    { key: 'hw_push',       label: '📚 Пуши о новом ДЗ' },
    { key: 'hw_resend',     label: '🔁 Переотправка ДЗ (не открыл)' },
    { key: 'dl_ping',       label: '⏰ Дедлайн-пинги ученикам' },
    { key: 'streak_ping',   label: '🔥 Стрик-пинги ученикам' },
    { key: 'duel_notify',   label: '⚔️ «Ищут дуэль» всем' },
    { key: 'hw_done',       label: '✅ «Сдал ДЗ» учителям' },
    { key: 'join',          label: '➕ «Вступил в группу» учителям' },
    { key: 'digest',        label: '📊 Дайджест недели учителям' },
    { key: 'alerts',        label: '⚠️ Алерты учителям' },
    { key: 'parent_report', label: '👪 Отчёты родителям' }
];
function admHomeKb() {
    const off = FLAG_DEFS.filter(f => !flagOn(f.key)).length;
    return new InlineKeyboard()
        .text(`🔕 Рассылки${off ? ` (выкл: ${off})` : ' (все вкл)'}`, 'adm_flags').row()
        .text('👨‍🏫 Учителя', 'adm_teachers').row()
        .text('📏 Лимиты решения', 'adm_limits').row()
        .text('📈 Статистика', 'adm_stats').text('🗂 Команды', 'adm_cmds');
}
// ── Лимиты строк/день: конфиг в Firestore config/limits — его же читает приложение.
// 0 = безлимит. Категории: бесплатные / подписчики клуба (premium на ученике).
// Безлимит поверх категорий: учителя, группы с ♾ (тумблер в «Учителях»), дуэли, ДЗ.
async function getLimitsCfg() {
    let cfg = {};
    try { const s = await fdb.doc(`${base}/config/limits`).get(); if (s.exists) cfg = s.data() || {}; } catch (e) {}
    return { freeDaily: Number(cfg.freeDaily) || 0, premiumDaily: Number(cfg.premiumDaily) || 0, clubUrl: String(cfg.clubUrl || ''),
        premiumChats: Array.isArray(cfg.premiumChats) ? cfg.premiumChats : [] };
}
function fmtLim(n) { return n > 0 ? `${n} строк/день` : 'безлимит ♾'; }
async function admShowLimits(ctx) {
    if (!fdb) return admShow(ctx, 'Сервер данных недоступен', admHomeKb());
    const c = await getLimitsCfg();
    const kb = new InlineKeyboard()
        .text(`🆓 Бесплатные: ${fmtLim(c.freeDaily)}`, 'adm_limset:freeDaily').row()
        .text(`💎 Подписчики: ${fmtLim(c.premiumDaily)}`, 'adm_limset:premiumDaily').row()
        .text(`🔗 Ссылка клуба: ${c.clubUrl ? 'задана ✅' : 'нет'}`, 'adm_limset:clubUrl').row()
        .text('⬅️ Назад', 'adm_home');
    const chatsList = c.premiumChats.length
        ? c.premiumChats.map(g => `  • ${g.title || g.id}`).join('\n')
        : '  — нет (добавь: /premiumgroup в самой группе)';
    await admShow(ctx,
        '📏 Лимиты решения (строк в день)\n\n' +
        `🆓 Бесплатные: ${fmtLim(c.freeDaily)}\n` +
        `💎 Подписчики клуба: ${fmtLim(c.premiumDaily)}\n` +
        `🔗 Клуб: ${c.clubUrl || '—'}\n` +
        `♾ Группы, чья подписка даёт тариф «подписчики»:\n${chatsList}\n\n` +
        'Всегда безлимит: учителя, их группы с ♾ (тумблер в «Учителях»), дуэли и домашка.\n' +
        'Подписчик = состоит в группе из списка (авто при входе) или /premium ID вручную.\n' +
        'У учеников применяется при следующем открытии приложения.', kb);
}
function admFlagsKb() {
    const kb = new InlineKeyboard();
    FLAG_DEFS.forEach(f => kb.text(`${f.label}: ${flagOn(f.key) ? 'вкл ✅' : 'ВЫКЛ ⛔'}`, `adm_flag:${f.key}`).row());
    kb.text('⬅️ Назад', 'adm_home');
    return kb;
}
function admTeachersKb() {
    const kb = new InlineKeyboard().text('➕ Выдать роль учителя', 'adm_tgrant').row();
    for (const [tgId, t] of teachers) {
        const roleMark = t.role === 'org_owner' ? '🏫' : (t.role === 'org_teacher' ? '👥' : '👨‍🏫');
        const nCls = normClasses(t.classes).length;
        kb.text(`❌ ${roleMark} ${String(t.name || tgId).slice(0, 20)} (${nCls} гр.)`, `adm_trevoke:${tgId}`)
          .text(t.unlimited ? '♾✅' : '♾', `adm_tunlim:${tgId}`).row();
    }
    kb.text('⬅️ Назад', 'adm_home');
    return kb;
}
async function admShow(ctx, text, kb) {
    try { await ctx.editMessageText(text, { reply_markup: kb }); }
    catch (e) { await ctx.reply(text, { reply_markup: kb }); }
}
bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('🛠 Админка', { reply_markup: admHomeKb() });
});
bot.callbackQuery(/^adm_(home|flags|teachers|stats|cmds|limits)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    await ctx.answerCallbackQuery();
    const p = ctx.match[1];
    if (p === 'home') return admShow(ctx, '🛠 Админка', admHomeKb());
    if (p === 'limits') return admShowLimits(ctx);
    if (p === 'flags') return admShow(ctx, '🔕 Глобальные выключатели рассылок\nДействуют на ВСЕХ получателей (личные настройки юзеров — поверх).', admFlagsKb());
    if (p === 'teachers') return admShow(ctx, '👨‍🏫 Учителя — ❌ забрать роль · ♾ безлимит его группам', admTeachersKb());
    if (p === 'cmds') return ctx.reply(commandsCheatsheet());
    if (p === 'stats') {
        const total = db.prepare('SELECT COUNT(*) n FROM users').get().n;
        const today = db.prepare("SELECT COUNT(*) n FROM users WHERE date(last_seen) = date('now', 'localtime')").get().n;
        const week = db.prepare("SELECT COUNT(*) n FROM users WHERE last_seen >= datetime('now', 'localtime', '-7 days')").get().n;
        return ctx.reply(`👥 Всего: ${total}\n📆 Сегодня: ${today}\n🗓 За 7 дней: ${week}\n👨‍🏫 Учителей: ${teachers.size}\n🏫 Школ: ${orgs.size}`);
    }
});
bot.callbackQuery(/^adm_flag:(\w+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    const key = ctx.match[1];
    setFlag(key, !flagOn(key));
    await ctx.answerCallbackQuery(flagOn(key) ? 'Включено' : 'Выключено для всех');
    try { await ctx.editMessageReplyMarkup({ reply_markup: admFlagsKb() }); } catch (e) {}
});
bot.callbackQuery(/^adm_limset:(freeDaily|premiumDaily|clubUrl)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    await ctx.answerCallbackQuery();
    const field = ctx.match[1];
    awaitingInput.set(ctx.from.id, { type: 'limitset', field, ts: Date.now() });
    if (field === 'clubUrl') await ctx.reply('Пришли ссылку на клуб (https://…, показывается в окне «лимит исчерпан»).\nЧтобы убрать кнопку — пришли «-».');
    else await ctx.reply(`Пришли число строк в день для категории «${field === 'freeDaily' ? 'бесплатные' : 'подписчики'}».\n0 = безлимит.`);
});
// ♾ безлимит группам учителя: флаг на документе учителя + на всех его классах
bot.callbackQuery(/^adm_tunlim:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    const tid = ctx.match[1];
    const t = teachers.get(tid);
    if (!t || !fdb) return ctx.answerCallbackQuery(t ? 'Сервер данных недоступен' : 'Учитель не найден');
    const next = !t.unlimited;
    try {
        await fdb.doc(`${base}/teachers/${tid}`).set({ unlimited: next }, { merge: true });
        t.unlimited = next;
        for (const c of normClasses(t.classes)) {
            await fdb.doc(`${base}/classes/${classDocId(c.code)}`).set({ unlimited: next }, { merge: true });
        }
        await ctx.answerCallbackQuery(next ? '♾ Группы учителя — безлимит' : 'Безлимит снят');
        try { await ctx.editMessageReplyMarkup({ reply_markup: admTeachersKb() }); } catch (e) {}
    } catch (e) { console.error('tunlim:', e.message); await ctx.answerCallbackQuery('Ошибка'); }
});
// 💎 подписка клуба на конкретного ученика (переключатель)
bot.command('premium', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const raw = String(ctx.match || '').trim();
    if (!raw) return ctx.reply('Формат: /premium 123456789 или /premium @username — включает/снимает подписку клуба.');
    if (!fdb) return ctx.reply('Сервер данных недоступен.');
    let target = null;
    if (/^\d{5,15}$/.test(raw)) target = { id: Number(raw) };
    else if (/^@?\w{3,32}$/.test(raw)) target = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(raw.replace(/^@/, ''));
    if (!target || !target.id) return ctx.reply('Не нашёл такого пользователя (нужен числовой ID или @username из бота).');
    try {
        const ref = fdb.doc(`${base}/students/${target.id}`);
        const s = await ref.get();
        const cur = !!(s.exists && s.data().premium);
        await ref.set({ premium: !cur }, { merge: true });
        await ctx.reply(!cur ? `💎 Подписка клуба ВКЛючена: ${target.id}` : `💤 Подписка снята: ${target.id}`);
    } catch (e) { console.error('premium:', e.message); await ctx.reply('Ошибка записи.'); }
});
// ♾ Группы безлимита: подписка на любую из config/limits.premiumChats даёт ученику
// premiumAuto (флаг ставит/снимает токен-эндпоинт hist-token при входе в приложение).
// /premiumgroup В САМОЙ группе — вкл/выкл её; /premiumgroup <chatId> в личке — для
// каналов (бот должен быть админом канала); /premiumgroup без аргумента — список.
bot.command('premiumgroup', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    if (!fdb) return ctx.reply('Сервер данных недоступен.');
    const arg = String(ctx.match || '').trim();
    let chat = null;
    if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        chat = { id: ctx.chat.id, title: ctx.chat.title || String(ctx.chat.id) };
    } else if (/^-?\d{5,20}$/.test(arg)) {
        let title = arg;
        try { const c = await bot.api.getChat(Number(arg)); title = c.title || arg; }
        catch (e) { return ctx.reply('Не вижу такой чат. Бот должен состоять в группе (в канале — админом).'); }
        chat = { id: Number(arg), title };
    } else {
        const cfg = await getLimitsCfg();
        const list = cfg.premiumChats.map(g => `• ${g.title || g.id} (${g.id})`).join('\n') || '— пусто —';
        return ctx.reply('♾ Группы, чья подписка даёт тариф «подписчики»:\n' + list +
            '\n\nВкл/выкл группу: пришли /premiumgroup В САМОЙ группе (добавь туда бота).\n' +
            'Канал: /premiumgroup <chatId> здесь (бот — админ канала).');
    }
    try {
        const cfg = await getLimitsCfg();
        const rest = cfg.premiumChats.filter(g => Number(g.id) !== Number(chat.id));
        const adding = rest.length === cfg.premiumChats.length;
        const next = adding ? [...rest, chat] : rest;
        await fdb.doc(`${base}/config/limits`).set({ premiumChats: next, updatedAt: Date.now() }, { merge: true });
        await ctx.reply(adding
            ? `♾ «${chat.title}» теперь ДАЁТ безлимит по тарифу «подписчики».\nУченики из группы получат его при следующем входе в приложение.`
            : `💤 «${chat.title}» больше НЕ даёт безлимит. У участников снимется при следующем входе.`);
    } catch (e) { console.error('premiumgroup:', e.message); await ctx.reply('Ошибка записи.'); }
});
bot.callbackQuery('adm_tgrant', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    await ctx.answerCallbackQuery();
    awaitingInput.set(ctx.from.id, { type: 'grantteacher', ts: Date.now() });
    await ctx.reply('Пришли Telegram ID (число) или @username будущего учителя.\nОн должен был хоть раз нажать /start в боте.');
});
bot.callbackQuery(/^adm_trevoke:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery('Только для админа');
    const tid = ctx.match[1];
    const t = teachers.get(tid);
    if (!fdb) return ctx.answerCallbackQuery('Сервер данных недоступен');
    try {
        // Вместе с ролью снимаем ♾ с его групп — иначе безлимит остался бы у учеников навсегда
        const hadUnlim = !!(t && t.unlimited);
        if (hadUnlim) {
            for (const c of normClasses(t.classes)) {
                try { await fdb.doc(`${base}/classes/${classDocId(c.code)}`).set({ unlimited: false }, { merge: true }); } catch (e) {}
            }
        }
        await fdb.doc(`${base}/teachers/${tid}`).delete();
        teachers.delete(tid); // кэш обновится и снапшотом, но UI перерисуем сразу
        applyCommandMenu(Number(tid), CMD_BASE);
        await ctx.answerCallbackQuery('Роль забрана');
        await admShow(ctx, `👨‍🏫 Роль учителя забрана у ${t ? t.name : tid}. Его группы остались в базе (classes)${hadUnlim ? ', безлимит ♾ с них снят' : ''} — прогресс учеников не пострадал.`, admTeachersKb());
        await sendSafe(Number(tid), 'Роль репетитора отключена администратором. Тренажёр работает как обычно.');
    } catch (e) { console.error('trevoke:', e.message); await ctx.answerCallbackQuery('Ошибка'); }
});
// выдача роли по ID/username — продолжение в bot.on('message') через awaitingInput
async function grantTeacherByInput(ctx, raw) {
    const s = String(raw || '').trim();
    let target = null;
    if (/^\d{5,15}$/.test(s)) target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(s)) || { id: Number(s) };
    else if (/^@?\w{3,32}$/.test(s)) target = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(s.replace(/^@/, ''));
    if (!target || !target.id) return ctx.reply('Не нашёл такого пользователя. Нужен числовой ID или @username того, кто уже нажимал /start в боте.');
    if (teachers.has(String(target.id))) return ctx.reply('Он уже учитель 👨‍🏫');
    if (!fdb) return ctx.reply('Сервер данных недоступен.');
    const who = displayName(target.id ? target : { id: target.id });
    await fdb.doc(`${base}/teachers/${target.id}`).set({ name: who, username: target.username || '', role: 'solo', classes: [], approvedAt: Date.now(), approvedBy: ADMIN_ID }, { merge: true });
    applyCommandMenu(target.id, CMD_TEACHER);
    await ctx.reply(`✅ ${who} (id ${target.id}) — теперь репетитор.`);
    await sendSafe(target.id, 'Вас назначили репетитором! 👨‍🏫\n\nВсё через /menu: создайте группу и пригласите учеников ссылкой.', { reply_markup: appKb() });
}

bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('Telegram API error:', e.description);
    else if (e instanceof HttpError) console.error('Network error:', e.message);
    else console.error('Unknown error:', e);
});

// ---------- Очередь notifyJobs ----------
const TASK_LABELS = { task1: '№1 (Хронология)', task3: '№3 (Процессы)', task4: '№4 (География)', task5: '№5 (Личности)', task7: '№7 (Культура)', flash: 'Карточки (зубрёжка)', cram: 'Зубрёжка дат', bundle: 'несколько заданий' };
const JOB_MAX_AGE_MS = 24 * 3600 * 1000;
function watchJobs() {
    const isSeen = db.prepare('SELECT 1 FROM seen_assignments WHERE student_id = ? AND assignment_id = ?');
    const markSeen = db.prepare('INSERT OR IGNORE INTO seen_assignments (student_id, assignment_id) VALUES (?, ?)');
    const isJobDone = db.prepare('SELECT 1 FROM delivered_notify_jobs WHERE job_id = ?');
    const markJobDone = db.prepare('INSERT OR IGNORE INTO delivered_notify_jobs (job_id) VALUES (?)');
    const isRecipientDone = db.prepare('SELECT 1 FROM delivered_notify_recipients WHERE job_id = ? AND recipient_id = ?');
    const markRecipientDone = db.prepare('INSERT OR IGNORE INTO delivered_notify_recipients (job_id, recipient_id) VALUES (?, ?)');
    const attach = () => fdb.collection(`${base}/notifyJobs`).onSnapshot(async (snap) => {
        for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue;
            const ref = change.doc.ref, jobId = String(change.doc.id), j = change.doc.data() || {};
            try {
                if (isJobDone.get(jobId)) { await ref.delete(); continue; }
                const fresh = (Date.now() - (Number(j.ts) || 0)) < JOB_MAX_AGE_MS;
                if (fresh && j.type === 'hw_assigned' && j.studentId) {
                    const dedupeId = String(j.recId || ('noid_' + (j.ts || Date.now())));
                    if (!isSeen.get(String(j.studentId), dedupeId)) {
                        const engageKey = `engage:${j.studentId}`;
                        if (engage && !isRecipientDone.get(jobId, engageKey)) {
                            engage.onHwAssigned(j.studentId, dedupeId, j.ts, j.deadline, j.task);
                            markRecipientDone.run(jobId, engageKey);
                        }
                        const chatId = Number(j.studentId);
                        const u = Number.isFinite(chatId) ? db.prepare('SELECT notify_hw FROM users WHERE id = ?').get(chatId) : null;
                        if (u && u.notify_hw && flagOn('hw_push') && !isRecipientDone.get(jobId, String(chatId))) {
                            const label = TASK_LABELS[j.task] || j.task || 'задание';
                            const dl = j.deadline ? `\n⏰ Дедлайн: ${new Date(j.deadline + 'T00:00:00').toLocaleDateString('ru-RU')}` : '';
                            const sent = await sendSafe(chatId, `📚 Новое домашнее задание!\n${label} — ${j.total || '?'} строк${dl}\n\nОткрывай и решай 👇`, { reply_markup: appKb() });
                            if (!sent) throw new Error(`notification_send_failed:${chatId}`);
                            markRecipientDone.run(jobId, String(chatId));
                        }
                        markSeen.run(String(j.studentId), dedupeId);
                    }
                }
                // 🔴 Массовая выдача ДЗ — ОДНО задание со списком получателей.
                //
                // Раньше приложение писало по заданию на ученика прямо в цикле выдачи.
                // Обрыв цикла (закрыли вкладку, уснул WebView, моргнула сеть) — и до кого
                // не дошли, тот не получал сообщения НИКОГДА. 31.07 из 145 учеников
                // сообщение получили 17, остальных 129 досылали вручную из базы.
                // Само ДЗ при этом доходило: его догоняет журнал класса.
                //
                // Теперь список приезжает одним документом, записанным ДО рассылки.
                // Обработка каждого получателя — ровно та же, что у одиночного
                // hw_assigned, включая обе защиты от повторов (seen_assignments по паре
                // ученик+задание и delivered_notify_recipients по паре задание+адресат).
                if (fresh && j.type === 'hw_assigned_bulk' && Array.isArray(j.studentIds)) {
                    const dedupeId = String(j.recId || ('noid_' + (j.ts || Date.now())));
                    const label = TASK_LABELS[j.task] || j.task || 'задание';
                    const dl = j.deadline ? `\n⏰ Дедлайн: ${new Date(j.deadline + 'T00:00:00').toLocaleDateString('ru-RU')}` : '';
                    let failed = 0;
                    for (const rawId of j.studentIds) {
                        const studentId = String(rawId);
                        if (isSeen.get(studentId, dedupeId)) continue;
                        const engageKey = `engage:${studentId}`;
                        if (engage && !isRecipientDone.get(jobId, engageKey)) {
                            engage.onHwAssigned(studentId, dedupeId, j.ts, j.deadline, j.task);
                            markRecipientDone.run(jobId, engageKey);
                        }
                        const chatId = Number(studentId);
                        const u = Number.isFinite(chatId) ? db.prepare('SELECT notify_hw FROM users WHERE id = ?').get(chatId) : null;
                        if (u && u.notify_hw && flagOn('hw_push') && !isRecipientDone.get(jobId, String(chatId))) {
                            const sent = await sendSafe(chatId, `📚 Новое домашнее задание!\n${label} — ${j.total || '?'} строк${dl}\n\nОткрывай и решай 👇`, { reply_markup: appKb() });
                            if (!sent) {
                                // ⚠️ Отказ одного получателя НЕ обрывает рассылку остальным:
                                // у одиночного hw_assigned адресат один и можно бросить сразу,
                                // здесь же их до полутора сотен — один удалённый бот не должен
                                // лишать сообщения весь класс.
                                // Но и «обработанным» такого ученика не помечаем: без пометки
                                // он попадёт в повтор задания (до 5 попыток с отсрочкой), а
                                // те, кому уже отправили, отсеются по isSeen.
                                failed++;
                                await sleep(50);
                                continue;
                            }
                            markRecipientDone.run(jobId, String(chatId));
                        }
                        markSeen.run(studentId, dedupeId);
                        await sleep(50);
                    }
                    if (failed) throw new Error(`bulk_notify_partial:${failed}/${j.studentIds.length}`);
                }
                if (fresh && j.type === 'hw_done' && j.classCode && flagOn('hw_done')) {
                    const code = String(j.classCode), label = TASK_LABELS[j.task] || j.task || 'задание';
                    const name = String(j.studentName || j.studentId || 'Ученик').slice(0, 50);
                    const onTime = j.onTime === false ? ' (после дедлайна)' : j.onTime === true ? ' — в срок ✅' : '';
                    for (const tid of recipientsForClass(code)) {
                        if (String(tid) === String(j.studentId)) continue;
                        const u = db.prepare('SELECT notify_hw_done FROM users WHERE id = ?').get(tid);
                        if (!u || !u.notify_hw_done) continue;
                        if (isRecipientDone.get(jobId, String(tid))) continue;
                        const sent = await sendSafe(tid, `✅ ${name} (группа «${code}») сдал ДЗ: ${label}, ${j.total || '?'} строк${onTime}`);
                        if (!sent) throw new Error(`notification_send_failed:${tid}`);
                        markRecipientDone.run(jobId, String(tid));
                        await sleep(50);
                    }
                }
                markJobDone.run(jobId);
                await ref.delete();
            } catch (e) {
                console.error('job processing failed:', e.message);
                try { if (typeof ref.fail === 'function') await ref.fail(e); }
                catch (failError) { console.error('job retry scheduling failed:', failError.message); }
            }
        }
    }, (err) => { console.error('watchJobs error:', err.message); setTimeout(attach, 15000); });
    attach();
}

// ---------- Дуэли ----------
const MAX_WAITING_AGE_MS = 2 * 60 * 1000;
// Размер волны приглашений и пауза между волнами. 25 человек с запасом закрывают
// потребность «найти одного соперника»: при 231 подписчике полный обход давал ~200
// сообщений на матч, которые потом приходилось догонять удалением.
// 12 секунд — время принять вызов, не растягивая поиск: за 2 минуты жизни вызова
// успевает пройти до 8 волн, то есть весь список, если никто не откликается.
const DUEL_WAVE_SIZE = 25;
const DUEL_WAVE_PAUSE_MS = 12000;
function watchDuels() {
    const saveMsg = db.prepare('INSERT INTO duel_msgs (match_id, chat_id, message_id, created_at) VALUES (?, ?, ?, ?)');
    const msgsFor = db.prepare('SELECT rowid AS rid, chat_id, message_id FROM duel_msgs WHERE match_id = ?');
    const dropMsgRow = db.prepare('DELETE FROM duel_msgs WHERE rowid = ?');

    // 🔴 Матчи, которые ПРЯМО СЕЙЧАС ищут соперника.
    //
    // Замер 01.08.2026: на дуэли подписан 231 человек, отправка идёт с паузой 60 мс,
    // то есть полный круг рассылки — около 30 секунд. Дуэль же принимают за секунды.
    // Раньше цикл этого не знал и продолжал звать людей в матч, которого уже нет:
    // большинство получало приглашение в мёртвую дуэль, и висело оно до уборщика
    // (5 минут). Отсюда жалоба «половина вызовов не удаляется» — они и не удалялись
    // вовремя, потому что отправлялись уже ПОСЛЕ конца матча.
    //
    // Теперь ветка 'removed' убирает матч отсюда, и рассылка обрывается на следующем
    // же человеке. Проверка синхронная и стоит до первого await — гонки нет.
    const waiting = new Set();

    // 🔴 Убираем разосланные вызовы ПОСТРОЧНО.
    //
    // Прежний код читал список сообщений, удалял их, а потом стирал ВСЕ строки матча
    // одним `DELETE ... WHERE match_id = ?`. Пока шло удаление (по 40 мс на сообщение),
    // рассылка успевала дописать новые строки — и тот `DELETE` стирал их, ни разу не
    // удалив сами сообщения. Строки исчезали, сообщения оставались, уборщик их уже не
    // видел: висели у людей навсегда. Именно поэтому таблица duel_msgs выглядит пустой,
    // а вызовы у части учеников на месте.
    //
    // Теперь строка удаляется ровно та, чьё сообщение мы только что обработали. Всё,
    // что доехало позже, останется в таблице и достанется уборщику (см. ниже).
    const purgeMatchMessages = async (matchId) => {
        let failed = 0, removed = 0;
        // Два прохода: второй добирает то, что дописала обрывающаяся рассылка.
        for (let pass = 0; pass < 2; pass++) {
            const rows = msgsFor.all(matchId);
            if (!rows.length) break;
            for (const row of rows) {
                try { await bot.api.deleteMessage(row.chat_id, row.message_id); removed++; }
                catch (e) { failed++; }
                // Строку убираем в любом случае: повторять отказ Telegram бессмысленно.
                dropMsgRow.run(row.rid);
                await sleep(40);
            }
        }
        // Раньше отказ Telegram глотался пустым catch — сколько вызовов реально осталось
        // висеть у людей, узнать было неоткуда. Теперь это видно в логе.
        if (failed) console.warn(`duel cleanup: матч ${matchId} — убрано ${removed}, не удалось ${failed}`);
    };

    const attach = () => fdb.collection(`${base}/matches`).where('status', '==', 'waiting').onSnapshot(async (snap) => {
        for (const change of snap.docChanges()) {
            const matchId = change.doc.id;
            if (change.type === 'added') {
                const m = change.doc.data(); const createdAt = Number(m.createdAt) || 0;
                if (Date.now() - createdAt > MAX_WAITING_AGE_MS) continue;
                const seeker = m.player1 || {}; const seekerUid = String(seeker.uid || ''); const seekerName = String(seeker.name || 'Кто-то').slice(0, 40);
                const modeLabel = m.mode === 'swipe' ? 'свайп-дуэль' : 'дуэль по датам';
                const now = Date.now();
                // 🔴 ЗОВЁМ ВОЛНАМИ, А НЕ ВЕСЬ СПИСОК СРАЗУ.
                //
                // Дуэли нужен ОДИН соперник, а подписано на вызовы 231 человек. Прежний код
                // на каждый матч рассылал двести сообщений и потом гнался за ними, чтобы
                // удалить: 209 удалений за день, круг рассылки ~30 секунд, и любой сбой в
                // уборке оставлял вызовы висеть у людей. Это лечение симптома — правильно
                // не создавать двести сообщений там, где хватает десятка.
                //
                // Волна: зовём WAVE_SIZE случайных человек и ждём WAVE_PAUSE_MS. Соперник
                // нашёлся — цикл обрывается на следующей же проверке waiting, и убирать
                // придётся десятки сообщений вместо двух сотен. Никого не нашли — зовём
                // следующую волну, пока не кончится время жизни вызова (2 минуты).
                //
                // Случайный порядок обязателен: при выборке по id первые в списке получали
                // бы каждый вызов, а хвост — никогда.
                if (!flagOn('duel_notify')) continue; // глобальный выключатель из /admin
                const candidates = db.prepare('SELECT id FROM users WHERE notify_duel = 1 ORDER BY RANDOM()').all();
                waiting.add(matchId);
                try {
                    let inWave = 0;
                    for (const { id } of candidates) {
                        // Матч закончился, пока мы рассылали, — звать в него больше некого.
                        // Возрастная граница страхует на случай, если событие об окончании
                        // потерялось (перезапуск бота, обрыв опроса): вызов живёт 2 минуты.
                        if (!waiting.has(matchId)) break;
                        if (Date.now() - createdAt > MAX_WAITING_AGE_MS) break;
                        if (String(id) === seekerUid) continue;
                        const sent = await sendSafe(id, `⚔️ ${seekerName} ищет соперника (${modeLabel})!\nПрими вызов, пока место свободно 👇`, { reply_markup: duelKb() });
                        if (sent) saveMsg.run(matchId, id, sent.message_id, Date.now());
                        if (++inWave >= DUEL_WAVE_SIZE) {
                            inWave = 0;
                            // Пауза дробная: между кусочками снова смотрим, не закончился ли
                            // матч. Один сон на всю паузу задержал бы обрыв на секунды, и за
                            // это время улетела бы лишняя волна.
                            for (let waited = 0; waited < DUEL_WAVE_PAUSE_MS; waited += 500) {
                                if (!waiting.has(matchId)) break;
                                await sleep(500);
                            }
                        } else {
                            await sleep(60);
                        }
                    }
                } finally { waiting.delete(matchId); }
            }
            if (change.type === 'removed') {
                // Порядок важен: сначала обрываем рассылку, потом убираем разосланное.
                // Иначе цикл выше продолжит добавлять новые сообщения нам за спиной.
                waiting.delete(matchId);
                await purgeMatchMessages(matchId);
            }
        }
    }, (err) => { console.error('watchDuels error:', err.message); setTimeout(attach, 15000); });
    attach();
}

// Дожимаем удаление вызовов, которые не убрались по событию.
//
// 🔴 Замер 29.07.2026: в duel_msgs висело 4327 неудалённых записей за сутки, у
// отдельных людей по 80 штук в чате. Причина: удаление запускалось РОВНО ОДИН РАЗ
// — по событию «матч больше не ждёт». Бот перезапустился в этот момент (28.07
// перезапусков было много) — и записи оставались навсегда. Повтора не было.
//
// ⚠️ Прежняя уборка здесь чистила таблицу через 48 часов, НЕ удаляя сами
// сообщения. То есть она не лечила, а прятала: записи исчезали, вызовы у людей
// оставались, и удалить их было уже нечем. Плюс Telegram и так не даёт удалять
// сообщения старше 48 часов — то есть чистка срабатывала ровно тогда, когда
// делать что-либо было поздно.
//
// Вызов актуален не дольше MAX_WAITING_AGE_MS (2 минуты), поэтому всё, что
// заметно старше, можно удалять не спрашивая состояние матча.
const DUEL_MSG_STALE_MS = 5 * 60 * 1000;
const staleDuelMsgs = db.prepare('SELECT rowid AS rid, chat_id, message_id FROM duel_msgs WHERE created_at < ? LIMIT 300');
const dropDuelMsg = db.prepare('DELETE FROM duel_msgs WHERE rowid = ?');
let sweepingDuelMsgs = false;
setInterval(async () => {
    if (sweepingDuelMsgs) return; // проход может не уложиться в минуту — не наслаиваем
    sweepingDuelMsgs = true;
    try {
        for (const row of staleDuelMsgs.all(Date.now() - DUEL_MSG_STALE_MS)) {
            try { await bot.api.deleteMessage(row.chat_id, row.message_id); } catch (e) { /* уже удалено / слишком старое */ }
            // Строку убираем в любом случае: повторять отказ Telegram бессмысленно,
            // а копить записи — то, из-за чего и набралось четыре тысячи.
            dropDuelMsg.run(row.rid);
            await sleep(60);
        }
    } catch (e) { console.error('duel msg sweep:', e.message); }
    finally { sweepingDuelMsgs = false; }
}, 60 * 1000);
setInterval(() => {
    db.prepare("DELETE FROM delivered_notify_recipients WHERE delivered_at < datetime('now','-90 days')").run();
    db.prepare("DELETE FROM delivered_notify_jobs WHERE delivered_at < datetime('now','-90 days')").run();
}, 24 * 3600 * 1000);

// Гигиена: чистим протухшие токены входа (редим удаляет их сам, это на случай неиспользованных).
setInterval(async () => {
    if (!fdb) return;
    try {
        for (const col of ['loginTokens', 'loginSessions']) {
            const q = await fdb.collection(`${base}/${col}`).where('exp', '<', Date.now()).limit(50).get();
            for (const d of q.docs) { try { await d.ref.delete(); } catch (e) {} }
        }
    } catch (e) { console.error('login cleanup:', e.message); }
}, 30 * 60 * 1000);

// ---------- Старт ----------
try {
    if (initHistoryApi()) {
        watchTeachers(); watchOrgs(); watchJobs(); watchDuels();
        try {
            engage = require('./engage')({
                bot, db, getFdb: () => fdb, base, sendSafe, sleep, appKb,
                recipientsForClass, teachers, InlineKeyboard, ADMIN_ID
            });
        } catch (e) { console.error('engage init failed:', e.message); }
    }
} catch (e) { console.error('VPS API init failed:', e.message); }

// ---------- Прочие сообщения (в т.ч. ввод названия группы) ----------
// ВАЖНО: регистрируется ПОСЛЕДНИМ (после engage.js) — grammY строит middleware-цепочку
// в порядке регистрации; этот catch-all матчит ЛЮБОЕ сообщение и не вызывает next(),
// поэтому команды, зарегистрированные ПОСЛЕ него (например из engage.js),
// никогда не выполнялись бы — их всегда перехватывал catch-all первым.
bot.on('message', async (ctx) => {
    const pend = awaitingInput.get(ctx.from.id);
    const text = ctx.message && ctx.message.text;
    if (pend && pend.type === 'classname' && text && !text.startsWith('/')) {
        awaitingInput.delete(ctx.from.id);
        if (Date.now() - pend.ts < 5 * 60 * 1000) return createClass(ctx, text);
    }
    if (pend && pend.type === 'classmsg' && text && !text.startsWith('/')) {
        awaitingInput.delete(ctx.from.id);
        if (Date.now() - pend.ts < 5 * 60 * 1000) return doClassMsg(ctx, `${pend.code} ${text}`);
    }
    if (pend && pend.type === 'grantteacher' && text && !text.startsWith('/') && ctx.from.id === ADMIN_ID) {
        awaitingInput.delete(ctx.from.id);
        if (Date.now() - pend.ts < 5 * 60 * 1000) return grantTeacherByInput(ctx, text);
    }
    if (pend && pend.type === 'limitset' && text && !text.startsWith('/') && ctx.from.id === ADMIN_ID) {
        awaitingInput.delete(ctx.from.id);
        if (Date.now() - pend.ts < 5 * 60 * 1000 && fdb) {
            let value;
            if (pend.field === 'clubUrl') {
                if (text === '-') value = '';
                else if (/^https:\/\/\S+$/.test(text)) value = text;
                else return ctx.reply('Нужна ссылка вида https://… (или «-», чтобы убрать кнопку).');
            } else {
                const n = parseInt(text, 10);
                if (isNaN(n) || n < 0 || n > 100000) return ctx.reply('Нужно число ≥ 0 (0 = безлимит).');
                value = n;
            }
            try {
                await fdb.doc(`${base}/config/limits`).set({ [pend.field]: value, updatedAt: Date.now() }, { merge: true });
                return ctx.reply('✅ Сохранено. Открой /admin → 📏 Лимиты, чтобы проверить.');
            } catch (e) { console.error('limitset:', e.message); return ctx.reply('Ошибка записи.'); }
        }
        return;
    }
    // Неизвестная слэш-команда — говорим честно, а не «вся тренировка в приложении»
    if (text && text.startsWith('/')) return ctx.reply('Не знаю такую команду 🤔 Список — по кнопке «/» или /menu');
    await ctx.reply('Вся тренировка — в приложении 👇 Меню: /menu', { reply_markup: appKb() });
});

bot.api.setMyCommands(CMD_BASE).catch(e => console.error('setMyCommands base', e.message));
if (ADMIN_ID) bot.api.setMyCommands(CMD_ADMIN, { scope: { type: 'chat', chat_id: ADMIN_ID } }).catch(e => console.error('setMyCommands admin', e.message));
// Описание в профиле бота (видно ДО нажатия «Старт») — часть первого впечатления
bot.api.setMyDescription('Тренажёр для ЕГЭ и ОГЭ по истории: даты, культура, карты, дуэли с друзьями. Занимайся в мини-приложении, получай ДЗ от репетитора, а родители — отчёты об успехах. Жми «Старт» 👇').catch(e => console.error('setMyDescription', e.message));
bot.api.setMyShortDescription('Тренажёр ЕГЭ/ОГЭ по истории: даты, культура, дуэли, ДЗ от репетитора').catch(e => console.error('setMyShortDescription', e.message));
bot.start({ onStart: (me) => console.log(`Bot @${me.username} started (long polling)`) });
