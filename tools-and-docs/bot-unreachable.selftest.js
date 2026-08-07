'use strict';
// Ученик, не начавший диалог с ботом, недостижим НАВСЕГДА: Telegram не даёт боту
// писать первым. Раньше это было видно только в stderr — учитель просто не знал,
// почему ученик «не видел домашку», а рассылка честно долбилась в закрытую дверь
// по пять попыток на каждую выдачу.
//
// 🔴 Замер 07.08.2026: пятеро активных учеников (четверо из летней школы
// letnyaya-2wp4tbt) не получали ни одного уведомления.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'bot', 'src', 'bot.js'), 'utf8');
const code = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

// ── 1. Состояние недостижимости отделено от выбора человека ─────────────────
assert.match(code, /'unreachable_at INTEGER DEFAULT 0'/,
  'нет колонки unreachable_at — отмечать недостижимость негде');
assert.doesNotMatch(code, /can't initiate conversation[\s\S]{0,200}?notify_hw=0/,
  'недостижимость не должна гасить notify_* — это выбор человека, а не его состояние');

// ── 2. sendSafe ставит и СНИМАЕТ отметку ────────────────────────────────────
const sendStart = code.indexOf('async function sendSafe(');
assert.ok(sendStart > 0, 'sendSafe не найдена');
const sendBody = code.slice(sendStart, code.indexOf('\n}', sendStart) + 2);
assert.match(sendBody, /clearUnreachable\.run/,
  'отметка не снимается после успешной отправки — ученик нажал «Старт», а мы про него забыли');
assert.match(sendBody, /can't initiate conversation[\s\S]{0,300}?markUnreachable\.run/,
  'отметка не ставится на нужной ошибке');

// ── 3. Повторов для недостижимого быть не должно ────────────────────────────
// Одиночная выдача: раньше безусловно бросала notification_send_failed, из-за чего
// задание уходило в повтор до пяти раз — впустую.
assert.match(code, /if \(isUnreachable\(chatId\)\)[\s\S]{0,600}?warnTeachersUnreachable/,
  'недостижимый не отделён от обычного сбоя — повторы останутся');
assert.match(code, /\} else \{\s*throw new Error\(`notification_send_failed:\$\{chatId\}`\);/,
  'обычный сбой обязан по-прежнему уходить в повтор');

// Массовая выдача: один недостижимый не должен считаться провалом всей рассылки.
const bulkAt = code.indexOf('hw_assigned_bulk');
const bulkTail = code.slice(bulkAt);
const guardAt = bulkTail.indexOf('if (isUnreachable(chatId))');
const failedAt = bulkTail.indexOf('failed++');
assert.ok(guardAt > 0 && guardAt < failedAt,
  'в массовой рассылке недостижимый попадает в failed++ и гоняет повтор для всего класса');

// ── 4. Учителя предупреждают один раз на выдачу ─────────────────────────────
// Веток выдачи ДЗ ДВЕ — одиночная и массовая. Проверять надо обе: пока хоть в
// одной дедуп есть, одиночное совпадение регулярки успокаивает зря (проверено
// саботажем — снятие защиты в одной ветке тест не ловил).
const dedupes = code.match(/const warnKey = `unreachable:\$\{chatId\}`;\s*if \(!isRecipientDone\.get\(jobId, warnKey\)\)/g) || [];
assert.equal(dedupes.length, 2,
  `защита от повторного предупреждения стоит в ${dedupes.length} ветке(ях) из двух — `
  + 'учитель получит предупреждение на каждую выдачу');

// ── 5. Класс выясняется сам, раз задание его не несёт ───────────────────────
const warnStart = code.indexOf('async function warnTeachersUnreachable(');
assert.ok(warnStart > 0, 'warnTeachersUnreachable не найдена');
const warnBody = code.slice(warnStart, code.indexOf('\n}', warnStart) + 2);
assert.match(warnBody, /students\/\$\{studentId\}/,
  'класс не добирается из профиля — hw_assigned его не несёт, и предупреждение никуда не уйдёт');
assert.match(warnBody, /if \(!code\) return;/,
  'без класса адресата нет — обязан быть ранний выход');

console.log('bot-unreachable.selftest: ok');
