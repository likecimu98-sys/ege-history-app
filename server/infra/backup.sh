#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

MODE="${1:-local}"
CONFIG="${BACKUP_CONFIG:-/etc/ege-history/backup.env}"
[[ -r "$CONFIG" ]] || { echo "Backup config is missing: $CONFIG" >&2; exit 2; }
# shellcheck disable=SC1090
set -a
source "$CONFIG"
set +a

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=ege_history}"
: "${PGUSER:=ege_backup}"
: "${BACKUP_ROOT:=/var/backups/ege-history}"
: "${BOT_SQLITE:=/root/bot/users.db}"
: "${TELEGRAM_PART_BYTES:=45000000}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"

case "$BACKUP_ROOT" in
  /var/backups/ege-history|/var/backups/ege-history/*) ;;
  *) echo "Unsafe BACKUP_ROOT: $BACKUP_ROOT" >&2; exit 2 ;;
esac

SNAPSHOT_DIR="$BACKUP_ROOT/snapshots/$([[ "$MODE" == "telegram" ]] && echo nightly || echo six-hour)"
mkdir -p "$SNAPSHOT_DIR" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/tmp"
chmod 700 "$BACKUP_ROOT" "$BACKUP_ROOT/snapshots" "$SNAPSHOT_DIR" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/tmp"
STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "$BACKUP_ROOT/tmp/run-${STAMP}-XXXXXX")"
ARCHIVE="$WORK/ege-history-${STAMP}.tar.gz"
ENCRYPTED="$SNAPSHOT_DIR/ege-history-${STAMP}.tar.gz.age"

cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT
notify_failure() {
  local code="$?"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${BACKUP_ADMIN_CHAT_ID:-}" ]]; then
    curl --fail --silent --show-error --max-time 30 \
      -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${BACKUP_ADMIN_CHAT_ID}" \
      --data-urlencode "text=❌ Резервная копия «Решай Историю» завершилась с ошибкой (${MODE}, код ${code}) на $(hostname)." >/dev/null || true
  fi
  exit "$code"
}
trap notify_failure ERR

pg_dump --format=custom --no-owner --no-acl --file="$WORK/postgres.dump" "$PGDATABASE"
pg_restore --list "$WORK/postgres.dump" >/dev/null

if [[ -f "$BOT_SQLITE" ]]; then
  sqlite3 "$BOT_SQLITE" ".timeout 10000" ".backup '$WORK/users.db'"
  [[ "$(sqlite3 "$WORK/users.db" 'PRAGMA integrity_check;')" == "ok" ]]
fi

cat >"$WORK/manifest.txt" <<EOF
created_at=$(date --iso-8601=seconds)
created_at_moscow=$(TZ=Europe/Moscow date --iso-8601=seconds)
database=$PGDATABASE
schema_version=$(psql -Atqc 'SELECT COALESCE(max(version), '\''none'\'') FROM schema_migrations' "$PGDATABASE")
host=$(hostname)
postgres_dump_bytes=$(stat -c %s "$WORK/postgres.dump")
bot_sqlite_bytes=$([[ -f "$WORK/users.db" ]] && stat -c %s "$WORK/users.db" || echo 0)
EOF
CONTENTS=(postgres.dump manifest.txt)
[[ -f "$WORK/users.db" ]] && CONTENTS+=(users.db)
(cd "$WORK" && sha256sum "${CONTENTS[@]}" > SHA256SUMS)
CONTENTS+=(SHA256SUMS)
tar -C "$WORK" -czf "$ARCHIVE" "${CONTENTS[@]}"
age -r "$AGE_RECIPIENT" -o "$ENCRYPTED" "$ARCHIVE"
sha256sum "$ENCRYPTED" >"$ENCRYPTED.sha256"

KEEP=28
[[ "$MODE" == "telegram" ]] && KEEP=8
mapfile -t SNAPSHOTS < <(find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name '*.tar.gz.age' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
if (( ${#SNAPSHOTS[@]} > KEEP )); then
  for old in "${SNAPSHOTS[@]:KEEP}"; do rm -f -- "$old" "$old.sha256"; done
fi

if [[ "$MODE" == "telegram" && "$(TZ=Europe/Moscow date +%u)" == "7" ]]; then
  cp -- "$ENCRYPTED" "$BACKUP_ROOT/weekly/$(basename "$ENCRYPTED")"
  cp -- "$ENCRYPTED.sha256" "$BACKUP_ROOT/weekly/$(basename "$ENCRYPTED").sha256"
  mapfile -t WEEKLY < <(find "$BACKUP_ROOT/weekly" -maxdepth 1 -type f -name '*.tar.gz.age' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  if (( ${#WEEKLY[@]} > 8 )); then
    for old in "${WEEKLY[@]:8}"; do rm -f -- "$old" "$old.sha256"; done
  fi
fi

send_text() {
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${BACKUP_ADMIN_CHAT_ID:-}" ]] || return 1
  curl --fail --silent --show-error --max-time 30 \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${BACKUP_ADMIN_CHAT_ID}" --data-urlencode "text=$1" >/dev/null
}

send_file() {
  local file="$1" caption="$2"
  curl --fail --silent --show-error --max-time 180 \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" \
    -F "chat_id=${BACKUP_ADMIN_CHAT_ID}" -F "document=@${file}" -F "caption=${caption}" >/dev/null
}

if [[ "$MODE" == "telegram" ]]; then
  : "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required for telegram mode}"
  : "${BACKUP_ADMIN_CHAT_ID:?BACKUP_ADMIN_CHAT_ID is required for telegram mode}"
  SIZE="$(stat -c %s "$ENCRYPTED")"
  HASH="$(cut -d' ' -f1 "$ENCRYPTED.sha256")"
  PARTS=()
  if (( SIZE > TELEGRAM_PART_BYTES )); then
    split -b "$TELEGRAM_PART_BYTES" -d -a 3 "$ENCRYPTED" "$WORK/$(basename "$ENCRYPTED").part-"
    mapfile -t PARTS < <(find "$WORK" -maxdepth 1 -type f -name '*.part-*' | sort)
  else
    PARTS=("$ENCRYPTED")
  fi
  DELIVERY_MANIFEST="$WORK/delivery-manifest-${STAMP}.txt"
  {
    printf 'archive=%s\n' "$(basename "$ENCRYPTED")"
    printf 'archive_bytes=%s\n' "$SIZE"
    printf 'archive_sha256=%s\n' "$HASH"
    printf 'part_count=%s\n' "${#PARTS[@]}"
    index=0
    for part in "${PARTS[@]}"; do
      index=$((index+1))
      printf 'part_%03d_name=%s\n' "$index" "$(basename "$part")"
      printf 'part_%03d_bytes=%s\n' "$index" "$(stat -c %s "$part")"
      printf 'part_%03d_sha256=%s\n' "$index" "$(sha256sum "$part" | cut -d' ' -f1)"
    done
  } >"$DELIVERY_MANIFEST"
  attempt_send() {
    local total="${#PARTS[@]}" index=0
    send_file "$DELIVERY_MANIFEST" "Backup manifest ${STAMP}"
    for part in "${PARTS[@]}"; do
      index=$((index+1))
      send_file "$part" "Резервная копия Решай Историю ${STAMP} · часть ${index}/${total} · SHA-256 ${HASH}"
    done
    send_file "$ENCRYPTED.sha256" "Контрольная сумма резервной копии ${STAMP}"
  }
  sent=0
  for delay in 0 300 900 2400; do
    (( delay > 0 )) && sleep "$delay"
    if attempt_send; then sent=1; break; fi
  done
  if (( sent == 0 )); then
    send_text "❌ Не удалось отправить резервную копию ${STAMP}. Файл сохранён на VPS: $(basename "$ENCRYPTED")" || true
    exit 1
  fi
fi

USAGE="$(df -P "$BACKUP_ROOT" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if (( USAGE >= 80 )); then send_text "⚠️ Диск VPS заполнен на ${USAGE}% после резервного копирования." || true; fi
echo "Backup ready: $ENCRYPTED"
