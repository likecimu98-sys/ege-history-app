#!/usr/bin/env bash
set -Eeuo pipefail

cd /root/bot
set -a
# shellcheck disable=SC1091
. ./.env
set +a

test -n "${BOT_TOKEN:-}"
test -n "${ADMIN_ID:-}"
grep -q "bot.command('repair'" ./bot.js
grep -q "webApp('🛟 Исправить загрузку', RECOVERY_URL)" ./bot.js

response="$(
    curl -fsS --max-time 15 \
        --get \
        --data-urlencode 'scope={"type":"chat","chat_id":'"${ADMIN_ID}"'}' \
        "https://api.telegram.org/bot${BOT_TOKEN}/getMyCommands"
)"

if [[ "$response" != *'"command":"repair"'* ]]; then
    echo "Telegram command menu does not contain /repair" >&2
    exit 1
fi

pm2 show hist-bot --no-color | grep -q 'online'
echo "REPAIR_COMMAND_MENU=YES"
echo "LIVE_HANDLER=YES"
echo "PM2_STATUS=online"

if [[ "${1:-}" == "--button-smoke-test" ]]; then
    node <<'NODE'
require('dotenv').config({ path: '/root/bot/.env' });

const token = process.env.BOT_TOKEN;
const chatId = Number(process.env.ADMIN_ID || 0);
const recoveryUrl = process.env.RECOVERY_URL || 'https://reshay-istoriyu.ru/sw-recover';

async function call(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
        throw new Error(`${method}: ${data.description || response.status}`);
    }
    return data.result;
}

(async () => {
    const message = await call('sendMessage', {
        chat_id: chatId,
        text: 'Проверка кнопки восстановления',
        disable_notification: true,
        reply_markup: {
            inline_keyboard: [[{
                text: '🛟 Исправить загрузку',
                web_app: { url: recoveryUrl }
            }]]
        }
    });
    console.log('WEB_APP_BUTTON_SEND=YES');
    await call('deleteMessage', { chat_id: chatId, message_id: message.message_id });
    console.log('WEB_APP_BUTTON_CLEANUP=YES');
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
NODE
fi
