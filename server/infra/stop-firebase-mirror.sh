#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "${CONFIRM_STOP_MIRROR:-}" == "RESHAY_HISTORY_STABLE" ]] || { echo "Confirmation missing" >&2; exit 2; }
STATE_FILE=/var/lib/ege-history/migration/cutover.env
API_ENV="${ENV_FILE:-/etc/ege-history/api.env}"
API_DIR="${API_DIR:-/opt/ege-history-api}"
[[ -r "$STATE_FILE" ]]
# shellcheck disable=SC1090
source "$STATE_FILE"
NOW="$(date +%s)"
(( NOW >= MIRROR_UNTIL )) || [[ "${ALLOW_EARLY_STOP:-0}" == "1" ]] || { echo "14-day mirror period is not complete" >&2; exit 3; }
/usr/local/sbin/ege-history-backup local
sed -i 's/^MIRROR_FIREBASE=.*/MIRROR_FIREBASE=0/' "$API_ENV"
ENABLE_FIREBASE_INGEST=0 pm2 startOrReload "$API_DIR/ecosystem.config.cjs" --update-env
sed -i "s/^MIRROR_STOPPED_AT=.*/MIRROR_STOPPED_AT=$NOW/" "$STATE_FILE"
pm2 save
curl --fail --silent http://127.0.0.1:8792/api/v1/health >/dev/null
echo "Firebase reverse mirror stopped. Firebase remains an archive until the 60-day review."
