#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${CONFIRM_ROLLBACK:-}" == "RESHAY_HISTORY_FIREBASE" ]] || {
  echo "Set CONFIRM_ROLLBACK=RESHAY_HISTORY_FIREBASE" >&2
  exit 2
}
STATE_FILE=/var/lib/ege-history/migration/cutover.env
API_DIR="${API_DIR:-/opt/ege-history-api}"
API_ENV="${ENV_FILE:-/etc/ege-history/api.env}"
[[ -r "$STATE_FILE" ]]
# shellcheck disable=SC1090
source "$STATE_FILE"
case "$CLIENT_OLD" in /var/www/ege-app.rollback-*) ;; *) echo "Unsafe client rollback path" >&2; exit 3;; esac
case "$BOT_OLD" in /root/bot/rollback-*) ;; *) echo "Unsafe bot rollback path" >&2; exit 3;; esac
[[ -d "$CLIENT_OLD" && -d "$BOT_OLD" ]]
STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
FAILED_CLIENT="/var/www/ege-app.failed-$STAMP"
/usr/local/sbin/ege-history-backup local

mv /var/www/ege-app "$FAILED_CLIENT"
mv "$CLIENT_OLD" /var/www/ege-app
install -m 640 "$BOT_OLD/bot.js" /root/bot/bot.js
install -m 640 "$BOT_OLD/engage.js" /root/bot/engage.js
install -m 600 "$BOT_OLD/.env" /root/bot/.env
sed -i 's/^MIRROR_FIREBASE=.*/MIRROR_FIREBASE=0/' "$API_ENV"
ENABLE_FIREBASE_INGEST=1 pm2 startOrReload "$API_DIR/ecosystem.config.cjs" --update-env
pm2 restart hist-bot --update-env
pm2 save
nginx -t
systemctl reload nginx
curl --fail --silent https://reshay-istoriyu.ru/ >/dev/null
echo "Rollback to Firebase client completed. Failed VPS client preserved at $FAILED_CLIENT"
