#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${CONFIRM_CUTOVER:-}" == "RESHAY_HISTORY_VPS" ]] || {
  echo "Set CONFIRM_CUTOVER=RESHAY_HISTORY_VPS for the production switch" >&2
  exit 2
}
[[ "$(id -u)" == "0" ]]
API_DIR="${API_DIR:-/opt/ege-history-api}"
INFRA_DIR="${INFRA_DIR:-/opt/ege-history-infra}"
API_ENV="${ENV_FILE:-/etc/ege-history/api.env}"
CLIENT_ARCHIVE="${CLIENT_ARCHIVE:-/root/ege-app-cutover.tar.gz}"
BOT_STAGE="${BOT_STAGE:-/root/bot/vps-stage}"
STATE_DIR=/var/lib/ege-history/migration
REPORT_ROOT=/var/backups/ege-history/migration-reports
STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
CLIENT_NEW="/var/www/ege-app.release-$STAMP"
CLIENT_OLD="/var/www/ege-app.rollback-$STAMP"
BOT_OLD="/root/bot/rollback-$STAMP"
STATE_FILE="$STATE_DIR/cutover.env"

"$INFRA_DIR/preflight-cutover.sh"
install -d -m 700 "$STATE_DIR" "$REPORT_ROOT" "$BOT_OLD" "$CLIENT_NEW"
tar -xzf "$CLIENT_ARCHIVE" -C "$CLIENT_NEW"
[[ -f "$CLIENT_NEW/index.html" && -f "$CLIENT_NEW/vps-sync-compat.js" ]]
cp -a /root/bot/bot.js /root/bot/engage.js /root/bot/.env "$BOT_OLD/"

INGEST_STOPPED=0
restore_ingest_on_early_failure() {
  local code="$?"
  if (( code != 0 && INGEST_STOPPED == 1 )) && [[ ! -f "$STATE_FILE" ]]; then
    ENABLE_FIREBASE_INGEST=1 pm2 startOrReload "$API_DIR/ecosystem.config.cjs" --update-env >/dev/null || true
    pm2 save >/dev/null || true
  fi
  exit "$code"
}
trap restore_ingest_on_early_failure ERR

pm2 stop hist-firebase-ingest
INGEST_STOPPED=1
ENV_FILE="$API_ENV" node "$API_DIR/scripts/import-firestore.js" --output="$REPORT_ROOT/final-import-$STAMP.json"
ENV_FILE="$API_ENV" node "$API_DIR/scripts/compare-firestore.js" --output="$REPORT_ROOT/final-compare-$STAMP.json"
/usr/local/sbin/ege-history-backup local

NOW="$(date +%s)"
MIRROR_UNTIL="$((NOW + 14 * 86400))"
ARCHIVE_UNTIL="$((NOW + 60 * 86400))"
cat >"$STATE_FILE" <<EOF
CUTOVER_AT=$NOW
MIRROR_UNTIL=$MIRROR_UNTIL
ARCHIVE_UNTIL=$ARCHIVE_UNTIL
CLIENT_OLD=$CLIENT_OLD
BOT_OLD=$BOT_OLD
MIRROR_STOPPED_AT=0
EOF

sed -i 's/^MIRROR_FIREBASE=.*/MIRROR_FIREBASE=1/' "$API_ENV"
pm2 delete hist-firebase-ingest || true
ENABLE_FIREBASE_INGEST=0 pm2 startOrReload "$API_DIR/ecosystem.config.cjs" --update-env

# Internal key is kept out of command output and copied only into the root-owned bot environment.
set -a
# shellcheck disable=SC1090
source /etc/ege-history/generated-secrets.env
set +a
sed -i '/^HISTORY_API_URL=/d;/^INTERNAL_API_TOKEN=/d' /root/bot/.env
printf '\nHISTORY_API_URL=http://127.0.0.1:8792\nINTERNAL_API_TOKEN=%s\n' "$INTERNAL_API_TOKEN" >>/root/bot/.env
chmod 600 /root/bot/.env
install -m 640 "$BOT_STAGE/bot.js" /root/bot/bot.js
install -m 640 "$BOT_STAGE/engage.js" /root/bot/engage.js
install -m 640 "$BOT_STAGE/bot-client.js" /root/bot/bot-client.js
install -m 640 "$BOT_STAGE/vps-firestore-compat.js" /root/bot/vps-firestore-compat.js
node --check /root/bot/bot.js
pm2 restart hist-bot --update-env

[[ -d /var/www/ege-app && ! -e "$CLIENT_OLD" ]]
mv /var/www/ege-app "$CLIENT_OLD"
mv "$CLIENT_NEW" /var/www/ege-app
nginx -t
systemctl reload nginx
pm2 save
curl --fail --silent https://reshay-istoriyu.ru/api/v1/health >/dev/null
curl --fail --silent https://reshay-istoriyu.ru/ | grep -q 'vps-sync-compat.js'
echo "Production cutover completed at $STAMP. Firebase reverse mirror deadline: $(date -d "@$MIRROR_UNTIL" --iso-8601=seconds)."
