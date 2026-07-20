#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PREFLIGHT_STAGE="startup"
report_preflight_error() {
  local code="$?"
  echo "Cutover preflight failed during: $PREFLIGHT_STAGE" >&2
  exit "$code"
}
trap report_preflight_error ERR

[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 2; }
API_DIR="${API_DIR:-/opt/ege-history-api}"
INFRA_DIR="${INFRA_DIR:-/opt/ege-history-infra}"
API_ENV="${ENV_FILE:-/etc/ege-history/api.env}"
CLIENT_ARCHIVE="${CLIENT_ARCHIVE:-/root/ege-app-cutover.tar.gz}"
BOT_STAGE="${BOT_STAGE:-/root/bot/vps-stage}"
REPORT_ROOT="${REPORT_ROOT:-/var/backups/ege-history/migration-reports}"

PREFLIGHT_STAGE="required files"
[[ -r "$API_ENV" && -f "$CLIENT_ARCHIVE" && -d "$BOT_STAGE" ]]
[[ -f "$BOT_STAGE/bot.js" && -f "$BOT_STAGE/engage.js" && -f "$BOT_STAGE/bot-client.js" && -f "$BOT_STAGE/vps-firestore-compat.js" ]]
set -a
# shellcheck disable=SC1090
source "$API_ENV"
set +a

PREFLIGHT_STAGE="server capacity"
CPU="$(nproc)"
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
FREE_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
if ! (( CPU >= 2 && MEM_KB >= 3800000 && FREE_KB >= 20000000 )); then
  echo "WARNING: VPS is below the recommended production size: cpu=$CPU mem_kb=$MEM_KB free_kb=$FREE_KB" >&2
fi
if [[ -z "${GOOGLE_CLIENT_ID:-}" || -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "WARNING: Google OAuth is not configured; Google sign-in will stay disabled" >&2
fi
PREFLIGHT_STAGE="migration mode"
[[ "${MIRROR_FIREBASE:-0}" == "0" ]] || { echo "Firebase reverse mirror is already enabled" >&2; exit 5; }

PREFLIGHT_STAGE="API and PostgreSQL"
curl --fail --silent http://127.0.0.1:8792/api/v1/health >/dev/null
curl --fail --silent https://reshay-istoriyu.ru/api/v1/health >/dev/null
pm2 describe hist-api >/dev/null
pm2 describe hist-firebase-ingest >/dev/null
ss -lnt | grep -E '127\.0\.0\.1:5432|\[::1\]:5432' >/dev/null
if ss -lnt | grep -Eq '(^|[[:space:]])(0\.0\.0\.0|\[::\]):5432'; then
  echo "PostgreSQL is publicly listening" >&2
  exit 6
fi

PREFLIGHT_STAGE="Telegram bot"
node --check "$BOT_STAGE/bot.js"
node --check "$BOT_STAGE/engage.js"
node --check "$BOT_STAGE/bot-client.js"
node --check "$BOT_STAGE/vps-firestore-compat.js"
grep -Eq '^APP_URL=https://reshay-istoriyu\.ru/?$' /root/bot/.env || {
  echo "Bot APP_URL must point to https://reshay-istoriyu.ru/" >&2
  exit 7
}

PREFLIGHT_STAGE="client archive paths"
if tar -tzf "$CLIENT_ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Unsafe path in client archive" >&2
  exit 8
fi
tar -tzf "$CLIENT_ARCHIVE" | grep -qx './index.html\|index.html'
tar -tzf "$CLIENT_ARCHIVE" | grep -Eq '(^|/)vps-sync-compat\.js$'
if tar -tzf "$CLIENT_ARCHIVE" | grep -Eq '(^|/)server/'; then
  echo "Server sources must not be present in the public archive" >&2
  exit 9
fi
PREFLIGHT_STAGE="client archive contents"
WORK="$(mktemp -d /tmp/ege-cutover-preflight-XXXXXX)"
cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT
tar -xzf "$CLIENT_ARCHIVE" -C "$WORK"
[[ -f "$WORK/cloud-sync.js" && -f "$WORK/vps-sync-compat.js" ]]
if [[ -e "$WORK/firebase-sync.js" ]]; then
  echo "Legacy Firebase client module remains in public build" >&2
  exit 10
fi
if grep -R -E 'www\.gstatic\.com/firebasejs|firebaseio\.com|firebaseapp\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com' "$WORK" --include='*.js' --include='*.html' -q; then
  echo "Direct Firebase client reference remains in public build" >&2
  exit 11
fi
grep -q '/api/' "$WORK/service-worker.js"

PREFLIGHT_STAGE="Firestore comparison"
mkdir -p "$REPORT_ROOT"
STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
ENV_FILE="$API_ENV" node "$API_DIR/scripts/compare-firestore.js" --output="$REPORT_ROOT/preflight-$STAMP.json"
PREFLIGHT_STAGE="API tests"
(cd "$API_DIR" && node --test)
PREFLIGHT_STAGE="API smoke test"
/usr/local/sbin/ege-history-smoke-api
PREFLIGHT_STAGE="pre-cutover backup"
/usr/local/sbin/ege-history-backup local
echo "Cutover preflight passed"
