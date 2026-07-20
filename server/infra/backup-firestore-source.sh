#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

CONFIG="${BACKUP_CONFIG:-/etc/ege-history/backup.env}"
API_DIR="${API_DIR:-/opt/ege-history-api}"
[[ -r "$CONFIG" ]] || { echo "Backup config is missing: $CONFIG" >&2; exit 2; }
[[ -d "$API_DIR" ]] || { echo "API directory is missing: $API_DIR" >&2; exit 2; }
# shellcheck disable=SC1090
source "$CONFIG"
: "${BACKUP_ROOT:=/var/backups/ege-history}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"

case "$BACKUP_ROOT" in
  /var/backups/ege-history|/var/backups/ege-history/*) ;;
  *) echo "Unsafe BACKUP_ROOT: $BACKUP_ROOT" >&2; exit 2 ;;
esac

STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_ROOT/firebase-source"
WORK="$(mktemp -d "$BACKUP_ROOT/tmp/firebase-${STAMP}-XXXXXX")"
cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT
mkdir -p "$DEST" "$WORK/export"
chmod 700 "$DEST"

ENV_FILE=/etc/ege-history/api.env node "$API_DIR/scripts/export-firestore.js" --output="$WORK/export" >"$WORK/export-report.json"
ENV_FILE=/etc/ege-history/api.env node "$API_DIR/scripts/verify-firestore-export.js" --input="$WORK/export" >"$WORK/verify-report.json"
ENV_FILE=/etc/ege-history/api.env node "$API_DIR/scripts/restore-firestore-export.js" --input="$WORK/export" --target-app="restore-check-${STAMP}" >"$WORK/restore-dry-run.json"
tar -C "$WORK" -czf "$WORK/firebase-source-${STAMP}.tar.gz" export export-report.json verify-report.json restore-dry-run.json
age -r "$AGE_RECIPIENT" -o "$DEST/firebase-source-${STAMP}.tar.gz.age" "$WORK/firebase-source-${STAMP}.tar.gz"
sha256sum "$DEST/firebase-source-${STAMP}.tar.gz.age" >"$DEST/firebase-source-${STAMP}.tar.gz.age.sha256"
echo "Encrypted Firestore source export ready: $DEST/firebase-source-${STAMP}.tar.gz.age"
