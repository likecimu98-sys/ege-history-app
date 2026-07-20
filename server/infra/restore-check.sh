#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
CONFIG="${BACKUP_CONFIG:-/etc/ege-history/backup.env}"
# shellcheck disable=SC1090
set -a
source "$CONFIG"
set +a
: "${PGDATABASE:=ege_history}"
CHECK_DB="ege_history_restore_check"
[[ "$CHECK_DB" != "$PGDATABASE" ]]

WORK="$(mktemp -d /var/backups/ege-history/tmp/restore-XXXXXX)"
cleanup() {
  dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT
notify() {
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${BACKUP_ADMIN_CHAT_ID:-}" ]] || return 0
  curl --fail --silent --show-error --max-time 30 \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${BACKUP_ADMIN_CHAT_ID}" --data-urlencode "text=$1" >/dev/null || true
}
failed() { local code="$?"; notify "❌ Еженедельная проверка восстановления резервной копии не прошла на $(hostname), код ${code}."; exit "$code"; }
trap failed ERR

pg_dump --format=custom --no-owner --no-acl --file="$WORK/check.dump" "$PGDATABASE"
dropdb --if-exists "$CHECK_DB"
createdb "$CHECK_DB"
pg_restore --no-owner --no-acl --dbname="$CHECK_DB" "$WORK/check.dump"
psql -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM app_users; SELECT count(*) FROM student_states; SELECT count(*) FROM classes;" "$CHECK_DB"

if [[ -f "${BOT_SQLITE:-/root/bot/users.db}" ]]; then
  sqlite3 "$BOT_SQLITE" ".backup '$WORK/users.db'"
  [[ "$(sqlite3 "$WORK/users.db" 'PRAGMA integrity_check;')" == "ok" ]]
fi
notify "✅ Еженедельная проверка восстановления «Решай Историю» прошла успешно."
echo "Restore check passed at $(date --iso-8601=seconds)"
