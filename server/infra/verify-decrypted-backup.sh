#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == "0" ]]
[[ "$#" == "2" ]]
DUMP="$1"
SQLITE="$2"
case "$DUMP" in /tmp/ege-archive-verify-*.dump) ;; *) echo "Unsafe dump path" >&2; exit 2;; esac
case "$SQLITE" in /tmp/ege-archive-verify-*.db) ;; *) echo "Unsafe SQLite path" >&2; exit 2;; esac
[[ -f "$DUMP" && -f "$SQLITE" ]]
CHECK_DB=ege_history_archive_restore_test
cleanup() {
  runuser -u postgres -- dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true
  rm -f -- "$DUMP" "$SQLITE"
}
trap cleanup EXIT
if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$CHECK_DB'" | grep -qx 1; then
  echo "Archive restore test database already exists" >&2
  exit 3
fi
runuser -u postgres -- createdb "$CHECK_DB"
runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-acl --dbname="$CHECK_DB" "$DUMP"
COUNTS="$(runuser -u postgres -- psql -AtF: -d "$CHECK_DB" -c 'SELECT (SELECT count(*) FROM app_users),(SELECT count(*) FROM student_states),(SELECT count(*) FROM classes);')"
INVALID="$(runuser -u postgres -- psql -Atqc "SELECT count(*) FROM student_states WHERE jsonb_typeof(data)<>'object'" "$CHECK_DB")"
[[ "$INVALID" == "0" ]]
[[ "$(sqlite3 "$SQLITE" 'PRAGMA integrity_check;')" == "ok" ]]
echo "Decrypted archive restore passed: $COUNTS; sqlite=ok"
