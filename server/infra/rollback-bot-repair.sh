#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP=/root/bot/bot.js.repair.rollback.bak
TARGET=/root/bot/bot.js

test -f "$BACKUP"
cp -a "$BACKUP" "$TARGET"
node --check "$TARGET"
pm2 restart hist-bot --update-env
pm2 show hist-bot --no-color | grep -q 'online'
echo "Bot repair command rolled back from $BACKUP"
