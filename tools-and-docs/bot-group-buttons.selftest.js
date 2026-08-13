'use strict';
// Бот обязан отвечать в группе, а не молчать.
//
// 🔴 Telegram разрешает web_app-кнопки только в личных чатах. Все клавиатуры бота
// (appKb, duelKb, menuKeyboard, repairKb) построены на .webApp, а типом чата не
// интересуется ни один из двадцати обработчиков. В группе Telegram отвечал
// BUTTON_TYPE_INVALID, сообщение не уходило ЦЕЛИКОМ, grammY бросал, bot.catch
// писал строчку в лог — и человек не получал ничего. 26 отказов с 08.08 по
// 12.08.2026, и ни одной жалобы: со стороны бот выглядел просто мёртвым.
//
// Тест держит два обещания: в группе web_app подменяется на обычную ссылку,
// а в личке не меняется ни байта.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'bot', 'src', 'bot.js'), 'utf8');

// ── Достаём разбор чата и правку клавиатуры прямо из исходника ───────────────
function cut(header) {
  const from = src.indexOf(header);
  assert.ok(from > 0, `${header} не найдена в bot.js`);
  const to = src.indexOf('\n}', from);
  assert.ok(to > from, `не видно конца ${header}`);
  return src.slice(from, to + 2);
}
const { isNonPrivateTarget, withoutWebAppButtons, BOT_CHAT_LINK } = new Function(`
  const BOT_USERNAME = 'TestBot';
  const BOT_CHAT_LINK = \`https://t.me/\${BOT_USERNAME}\`;
  ${cut('function isNonPrivateTarget(')}
  ${cut('function withoutWebAppButtons(')}
  return { isNonPrivateTarget, withoutWebAppButtons, BOT_CHAT_LINK };
`)();

// ── 1. Кто считается неличным чатом ─────────────────────────────────────────
assert.equal(isNonPrivateTarget(-1001234567890), true, 'супергруппа не распознана');
assert.equal(isNonPrivateTarget('-1001234567890'), true, 'супергруппа строкой не распознана');
assert.equal(isNonPrivateTarget('@somechannel'), true, 'канал по имени не распознан');
assert.equal(isNonPrivateTarget(448123480), false, 'личный чат принят за группу — сломали бы рабочий путь');
assert.equal(isNonPrivateTarget('448123480'), false, 'личный чат строкой принят за группу');
// Нет chat_id вовсе (правка inline-сообщения) — не наше дело, не трогаем.
assert.equal(isNonPrivateTarget(undefined), false, 'без chat_id лезть в клавиатуру нельзя');
assert.equal(isNonPrivateTarget(null), false, 'без chat_id лезть в клавиатуру нельзя');

// ── 2. В группе web_app превращается в ссылку, надпись сохраняется ──────────
const groupKb = {
  inline_keyboard: [
    [{ text: '🚀 Открыть тренажёр', web_app: { url: 'https://reshay-istoriyu.ru/' } }],
    [{ text: '🔕 Не звать на дуэли', callback_data: 'duel_off' }],
  ],
};
const fixed = withoutWebAppButtons(groupKb);
assert.notStrictEqual(fixed, groupKb, 'клавиатура должна быть переписана, а не возвращена как есть');
const appBtn = fixed.inline_keyboard[0][0];
assert.equal(appBtn.web_app, undefined, 'web_app остался — Telegram снова откажет');
assert.equal(appBtn.url, BOT_CHAT_LINK, 'ссылка должна вести в чат с ботом');
assert.equal(appBtn.text, '🚀 Открыть тренажёр', 'надпись кнопки потерялась');
// Обычные кнопки трогать нельзя: на callback_data висят все настройки и меню.
assert.deepEqual(fixed.inline_keyboard[1][0], { text: '🔕 Не звать на дуэли', callback_data: 'duel_off' },
  'обычная кнопка пострадала при правке');
// Исходный объект портить нельзя — его могли собрать один раз и слать многим.
assert.ok(groupKb.inline_keyboard[0][0].web_app, 'исходная клавиатура испорчена на месте');

// ── 3. Где нечего править — возвращаем ТОТ ЖЕ объект ────────────────────────
// На этом стоит вся дешевизна: в личке ветка вообще не срабатывает.
const plain = { inline_keyboard: [[{ text: 'Да', callback_data: 'yes' }]] };
assert.strictEqual(withoutWebAppButtons(plain), plain, 'клавиатуру без web_app переписывать незачем');
const reply = { keyboard: [['Привет']] };
assert.strictEqual(withoutWebAppButtons(reply), reply, 'обычную (не inline) клавиатуру трогать нельзя');
assert.strictEqual(withoutWebAppButtons(undefined), undefined, 'пустая разметка не должна падать');

// ── 4. Правка действительно подключена к исходящим запросам ─────────────────
const wired = src.slice(src.indexOf('bot.api.config.use('), src.indexOf('bot.api.config.use(') + 500);
assert.ok(src.includes('bot.api.config.use('), 'преобразователь не подключён — правка мертва');
assert.match(wired, /isNonPrivateTarget\(payload\.chat_id\)/,
  'преобразователь не смотрит на чат получателя');
assert.match(wired, /withoutWebAppButtons\(payload\.reply_markup\)/,
  'преобразователь не правит клавиатуру');
assert.match(wired, /return prev\(method, payload, signal\)/,
  'запрос должен уходить дальше нетронутым, когда править нечего');

// ── 5. Подключено ДО первого исходящего вызова ──────────────────────────────
// Иначе первые сообщения уйдут мимо правки.
const wiredAt = src.indexOf('bot.api.config.use(');
const firstSend = src.indexOf('bot.api.sendMessage(');
assert.ok(firstSend < 0 || wiredAt < firstSend,
  'преобразователь подключён позже первой отправки — она пройдёт мимо него');

console.log('bot-group-buttons.selftest: ok');
