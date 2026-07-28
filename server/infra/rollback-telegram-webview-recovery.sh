#!/usr/bin/env bash
set -Eeuo pipefail

STATIC_LINK=/var/www/ege-app
STATIC_TARGET=/var/www/ege-app.release-20260728-154912
BOT_TARGET=/root/bot/bot.js
BOT_TARGET_BACKUP=/root/bot/bot.before-webview-recovery.js
ROLLBACK_CURRENT_BOT=/root/bot/bot.js.webview-rollback-current.bak
ROLLBACK_CURRENT_STATIC="$(readlink -f "$STATIC_LINK")"
NEXT_LINK=/var/www/ege-app.webview-rollback-next

test -f "$STATIC_TARGET/index.html"
test -f "$BOT_TARGET_BACKUP"
case "$ROLLBACK_CURRENT_STATIC" in
    /var/www/ege-app.release-*) ;;
    *) echo "Unexpected current webroot: $ROLLBACK_CURRENT_STATIC" >&2; exit 1 ;;
esac

cp -a "$BOT_TARGET" "$ROLLBACK_CURRENT_BOT"
ln -sfn "$STATIC_TARGET" "$NEXT_LINK"
mv -Tf "$NEXT_LINK" "$STATIC_LINK"
install -m 600 "$BOT_TARGET_BACKUP" "$BOT_TARGET"

if ! node --check "$BOT_TARGET" || ! pm2 restart hist-bot --update-env; then
    ln -sfn "$ROLLBACK_CURRENT_STATIC" "$NEXT_LINK"
    mv -Tf "$NEXT_LINK" "$STATIC_LINK"
    cp -a "$ROLLBACK_CURRENT_BOT" "$BOT_TARGET"
    pm2 restart hist-bot --update-env
    echo "Rollback failed; restored current release" >&2
    exit 1
fi

sleep 2
pm2 show hist-bot --no-color | grep -q 'online'
echo "Telegram WebView recovery rolled back"
echo "static: $STATIC_TARGET"
echo "bot: $BOT_TARGET_BACKUP"
