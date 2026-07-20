#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == "0" ]]
DB_NAME=ege_history_preview
PREVIEW_DIR=/var/www/ege-app-preview
[[ "$DB_NAME" == "ege_history_preview" && "$PREVIEW_DIR" == "/var/www/ege-app-preview" ]]

pm2 delete hist-api-preview >/dev/null 2>&1 || true
runuser -u postgres -- dropdb --if-exists "$DB_NAME"
sed -i '/include snippets\/history-preview.conf;/d' /etc/nginx/sites-enabled/reshay-istoriyu.ru
nginx -t
systemctl reload nginx
rm -f -- /etc/ege-history/preview.env /etc/nginx/snippets/history-preview.conf
if [[ -d "$PREVIEW_DIR" ]]; then
  RESOLVED="$(realpath "$PREVIEW_DIR")"
  [[ "$RESOLVED" == "/var/www/ege-app-preview" ]]
  rm -rf -- "$RESOLVED"
fi
echo "Migration preview removed"
