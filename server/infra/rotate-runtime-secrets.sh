#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 2; }

API_ENV="${API_ENV:-/etc/ege-history/api.env}"
BACKUP_ENV="${BACKUP_ENV:-/etc/ege-history/backup.env}"
GENERATED_ENV="${GENERATED_ENV:-/etc/ege-history/generated-secrets.env}"
BOT_ENV="${BOT_ENV:-/root/bot/.env}"

for required in "$API_ENV" "$BACKUP_ENV" "$GENERATED_ENV" "$BOT_ENV" /root/bot/bot.js; do
  [[ -f "$required" ]] || { echo "Missing required file: $required" >&2; exit 3; }
done

APP_DB_PASSWORD_NEW="$(openssl rand -hex 32)"
BACKUP_DB_PASSWORD_NEW="$(openssl rand -hex 32)"
INTERNAL_API_TOKEN_NEW="$(openssl rand -hex 48)"

# Generated values are hexadecimal, so they are safe to embed in these
# single-quoted PostgreSQL literals and URL fields.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE hist_api WITH LOGIN PASSWORD '$APP_DB_PASSWORD_NEW'" >/dev/null
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE ege_backup WITH LOGIN PASSWORD '$BACKUP_DB_PASSWORD_NEW' CREATEDB" >/dev/null

sed -i -E "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://hist_api:${APP_DB_PASSWORD_NEW}@127.0.0.1:5432/ege_history#" "$API_ENV"
sed -i -E "s/^INTERNAL_API_TOKEN=.*/INTERNAL_API_TOKEN=${INTERNAL_API_TOKEN_NEW}/" "$API_ENV"
sed -i -E "s/^PGPASSWORD=.*/PGPASSWORD=${BACKUP_DB_PASSWORD_NEW}/" "$BACKUP_ENV"
sed -i '/^HISTORY_API_URL=/d;/^INTERNAL_API_TOKEN=/d' "$BOT_ENV"
printf '\nHISTORY_API_URL=http://127.0.0.1:8792\nINTERNAL_API_TOKEN=%s\n' "$INTERNAL_API_TOKEN_NEW" >>"$BOT_ENV"

GENERATED_TMP="$(mktemp /etc/ege-history/generated-secrets.env.XXXXXX)"
printf 'APP_DB_PASSWORD=%s\nBACKUP_DB_PASSWORD=%s\nINTERNAL_API_TOKEN=%s\n' \
  "$APP_DB_PASSWORD_NEW" "$BACKUP_DB_PASSWORD_NEW" "$INTERNAL_API_TOKEN_NEW" >"$GENERATED_TMP"
chmod 600 "$API_ENV" "$BACKUP_ENV" "$BOT_ENV" "$GENERATED_TMP"
mv -f -- "$GENERATED_TMP" "$GENERATED_ENV"

unset APP_DB_PASSWORD_NEW BACKUP_DB_PASSWORD_NEW INTERNAL_API_TOKEN_NEW

pm2 restart hist-api >/dev/null

# Recreate the bot with a minimal environment. It reads application settings
# from /root/bot/.env, so database and internal credentials never enter PM2.
pm2 delete hist-bot >/dev/null
(
  cd /root/bot
  env -i \
    HOME=/root \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_ENV=production \
    /usr/local/bin/pm2 start bot.js --name hist-bot --time --merge-logs >/dev/null
)

pm2 describe hist-api >/dev/null
pm2 describe hist-bot >/dev/null
curl --fail --silent http://127.0.0.1:8792/api/v1/health >/dev/null

if pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const bot = JSON.parse(input).find(item => item.name === "hist-bot");
  const env = bot && bot.pm2_env ? bot.pm2_env : {};
  const forbidden = ["APP_DB_PASSWORD", "BACKUP_DB_PASSWORD", "INTERNAL_API_TOKEN", "CONFIRM_CUTOVER"];
  process.exit(forbidden.some(key => Object.prototype.hasOwnProperty.call(env, key)) ? 1 : 0);
});
'; then
  :
else
  echo "The bot PM2 environment still contains a forbidden secret variable" >&2
  exit 4
fi

/usr/local/sbin/ege-history-backup local >/dev/null
pm2 save >/dev/null
echo "Runtime credentials rotated; API, bot and backup checks passed"
