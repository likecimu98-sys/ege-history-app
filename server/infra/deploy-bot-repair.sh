#!/usr/bin/env bash
set -Eeuo pipefail

UPLOAD=/root/bot/bot.uploading.js
TARGET=/root/bot/bot.js
BACKUP=/root/bot/bot.js.repair.rollback.bak
ROLLBACK=/root/ege-bot-repair-rollback.sh

node --check "$UPLOAD"
cp -a "$TARGET" "$BACKUP"
install -m 600 "$UPLOAD" "$TARGET"
install -m 700 /root/ege-bot-repair-rollback.sh.uploading "$ROLLBACK"
node --check "$TARGET"

if ! pm2 restart hist-bot --update-env; then
    bash "$ROLLBACK"
    exit 1
fi

sleep 2
if ! pm2 show hist-bot --no-color | grep -q 'online'; then
    bash "$ROLLBACK"
    exit 1
fi

echo "hist-bot deployed; rollback: bash $ROLLBACK"
