#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 2; }
API_DIR="${API_DIR:-/opt/ege-history-api}"
INFRA_DIR="${INFRA_DIR:-/opt/ege-history-infra}"
[[ -f "$API_DIR/package.json" ]] || { echo "Upload API to $API_DIR first" >&2; exit 2; }
[[ -f "$INFRA_DIR/backup.sh" ]] || { echo "Upload infra to $INFRA_DIR first" >&2; exit 2; }

CPU="$(nproc)"
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
FREE_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
if (( CPU < 2 || MEM_KB < 3800000 || FREE_KB < 20000000 )); then
  echo "VPS below production minimum: cpu=$CPU mem_kb=$MEM_KB free_kb=$FREE_KB" >&2
  [[ "${ALLOW_LOW_RESOURCES:-0}" == "1" ]] || exit 3
  echo "Continuing only because ALLOW_LOW_RESOURCES=1 (staging, no production cutover)." >&2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends postgresql postgresql-client age sqlite3 curl ca-certificates
systemctl enable --now postgresql
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET listen_addresses='localhost'"
systemctl restart postgresql

install -d -m 700 /etc/ege-history /var/backups/ege-history/tmp /var/backups/ege-history/snapshots /var/backups/ege-history/weekly /var/log/ege-history
if ! getent passwd hist-api >/dev/null; then
  useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin hist-api
fi
chown root:hist-api /etc/ege-history
chmod 750 /etc/ege-history
SECRETS=/etc/ege-history/generated-secrets.env
if [[ ! -s "$SECRETS" ]]; then
  {
    printf 'APP_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'BACKUP_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'INTERNAL_API_TOKEN=%s\n' "$(openssl rand -hex 48)"
  } >"$SECRETS"
  chmod 600 "$SECRETS"
fi
# shellcheck disable=SC1090
source "$SECRETS"

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hist_api') THEN CREATE ROLE hist_api LOGIN; END IF; END \$\$"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE hist_api WITH LOGIN PASSWORD '$APP_DB_PASSWORD'"
if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='ege_history'" | grep -qx 1; then
  runuser -u postgres -- createdb --owner=hist_api ege_history
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ege_backup') THEN CREATE ROLE ege_backup LOGIN; END IF; END \$\$"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ege_backup WITH LOGIN PASSWORD '$BACKUP_DB_PASSWORD' CREATEDB"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "GRANT pg_read_all_data TO ege_backup"
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "GRANT CONNECT ON DATABASE ege_history TO ege_backup"

BOT_TOKEN="$(sed -n 's/^BOT_TOKEN=//p' /root/bot/.env | tail -n 1 | tr -d '\r')"
BOT_TOKEN="${BOT_TOKEN%\"}"; BOT_TOKEN="${BOT_TOKEN#\"}"
[[ -n "$BOT_TOKEN" ]] || { echo "BOT_TOKEN missing in /root/bot/.env" >&2; exit 2; }
if [[ -r /etc/ege-history/api.env ]]; then
  : "${GOOGLE_CLIENT_ID:=$(sed -n 's/^GOOGLE_CLIENT_ID=//p' /etc/ege-history/api.env | tail -n 1)}"
  : "${GOOGLE_CLIENT_SECRET:=$(sed -n 's/^GOOGLE_CLIENT_SECRET=//p' /etc/ege-history/api.env | tail -n 1)}"
fi
: "${MIRROR_FIREBASE:=0}"
cat >/etc/ege-history/api.env <<EOF
API_HOST=127.0.0.1
API_PORT=8792
PUBLIC_ORIGIN=https://reshay-istoriyu.ru
DATABASE_URL=postgresql://hist_api:${APP_DB_PASSWORD}@127.0.0.1:5432/ege_history
DATABASE_SSL=0
DB_POOL_MAX=10
BOT_TOKEN=${BOT_TOKEN}
ADMIN_TELEGRAM_IDS=352253483
INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=https://reshay-istoriyu.ru/api/v1/auth/google/callback
SESSION_DAYS=90
SESSION_COOKIE=ege_session
CSRF_COOKIE=ege_csrf
MAX_BODY_BYTES=8388608
TRUST_PROXY=1
FIREBASE_SERVICE_ACCOUNT=/etc/ege-history/firebase-service-account.json
FIREBASE_APP_ID=ege-history-bot
MIRROR_FIREBASE=${MIRROR_FIREBASE}
EOF
install -m 640 -o root -g hist-api /root/bot/serviceAccount.json /etc/ege-history/firebase-service-account.json
chown root:hist-api /etc/ege-history/api.env
chmod 640 /etc/ege-history/api.env

AGE_RECIPIENT="$(awk '$1=="ssh-ed25519" { print $1 " " $2; exit }' /root/.ssh/authorized_keys)"
[[ -n "$AGE_RECIPIENT" ]] || { echo "No ssh-ed25519 administrator key found for age encryption" >&2; exit 2; }
{
  printf 'PGHOST=127.0.0.1\nPGPORT=5432\nPGDATABASE=ege_history\nPGUSER=ege_backup\n'
  printf 'PGPASSWORD=%q\n' "$BACKUP_DB_PASSWORD"
  printf 'BACKUP_ROOT=/var/backups/ege-history\nBOT_SQLITE=/root/bot/users.db\n'
  printf 'AGE_RECIPIENT=%q\n' "$AGE_RECIPIENT"
  printf 'TELEGRAM_BOT_TOKEN=%q\n' "$BOT_TOKEN"
  printf 'BACKUP_ADMIN_CHAT_ID=352253483\nTELEGRAM_PART_BYTES=45000000\n'
} >/etc/ege-history/backup.env
chmod 600 /etc/ege-history/backup.env

cd "$API_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
else
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
fi
chown -R root:hist-api "$API_DIR"
find "$API_DIR" -type d -exec chmod 750 {} +
find "$API_DIR" -type f -exec chmod 640 {} +
ENV_FILE=/etc/ege-history/api.env node scripts/run-migrations.js

install -m 700 "$INFRA_DIR/backup.sh" /usr/local/sbin/ege-history-backup
install -m 700 "$INFRA_DIR/restore-check.sh" /usr/local/sbin/ege-history-restore-check
install -m 700 "$INFRA_DIR/backup-firestore-source.sh" /usr/local/sbin/ege-history-backup-firestore
install -m 700 "$INFRA_DIR/preflight-cutover.sh" /usr/local/sbin/ege-history-preflight-cutover
install -m 700 "$INFRA_DIR/cutover.sh" /usr/local/sbin/ege-history-cutover
install -m 700 "$INFRA_DIR/rollback.sh" /usr/local/sbin/ege-history-rollback
install -m 700 "$INFRA_DIR/stop-firebase-mirror.sh" /usr/local/sbin/ege-history-stop-firebase-mirror
install -m 700 "$INFRA_DIR/migration-reminder.sh" /usr/local/sbin/ege-history-migration-reminder
install -m 700 "$INFRA_DIR/verify-decrypted-backup.sh" /usr/local/sbin/ege-history-verify-decrypted-backup
install -m 644 "$INFRA_DIR/systemd/"*.service "$INFRA_DIR/systemd/"*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ege-backup-local.timer ege-backup-telegram.timer ege-restore-check.timer ege-migration-reminder.timer

if [[ "${RUN_SOURCE_BACKUP:-0}" == "1" ]]; then /usr/local/sbin/ege-history-backup-firestore; fi
if [[ "${RUN_IMPORT:-0}" == "1" ]]; then
  ENV_FILE=/etc/ege-history/api.env node "$API_DIR/scripts/import-firestore.js" --output=/var/backups/ege-history/import-report.json
  if ! ENV_FILE=/etc/ege-history/api.env node "$API_DIR/scripts/compare-firestore.js" --output=/var/backups/ege-history/compare-report.json; then
    [[ "${ALLOW_COMPARE_MISMATCH:-0}" == "1" ]] || exit 5
    echo "Comparison mismatch retained in report; transition ingest will catch live writes." >&2
  fi
fi

install -m 644 "$INFRA_DIR/nginx-http-map.conf" /etc/nginx/conf.d/history-websocket-map.conf
install -m 644 "$INFRA_DIR/nginx-api.conf" /etc/nginx/snippets/history-api.conf
SITE=/etc/nginx/sites-enabled/reshay-istoriyu.ru
if ! grep -qF 'include snippets/history-api.conf;' "$SITE"; then
  install -d -m 700 /root/nginx-backups
  cp -a "$SITE" "/root/nginx-backups/reshay-istoriyu.ru.before-history-api-$(date -u +%Y%m%dT%H%M%SZ)"
  sed -i '/include snippets\/tutorapp.conf;/i\    include snippets/history-api.conf;' "$SITE"
fi

cp "$INFRA_DIR/ecosystem.config.cjs" "$API_DIR/ecosystem.config.cjs"
ENABLE_FIREBASE_INGEST="${ENABLE_FIREBASE_INGEST:-1}" pm2 startOrReload "$API_DIR/ecosystem.config.cjs" --update-env
pm2 save
for _ in {1..30}; do curl --fail --silent http://127.0.0.1:8792/api/v1/health >/dev/null && break; sleep 1; done
curl --fail --silent http://127.0.0.1:8792/api/v1/health >/dev/null
nginx -t
systemctl reload nginx
ss -lnt | grep -E '127\.0\.0\.1:5432|\[::1\]:5432' >/dev/null
if ss -lnt | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\[::\]):5432'; then echo "PostgreSQL is publicly listening" >&2; exit 4; fi
echo "VPS API staged successfully. Production cutover remains a separate step."
