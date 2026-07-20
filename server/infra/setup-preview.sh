#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == "0" ]]
DB_NAME=ege_history_preview
[[ "$DB_NAME" == "ege_history_preview" ]]
[[ -d /var/www/ege-app-preview && -f /etc/nginx/snippets/history-preview.conf ]]

pm2 delete hist-api-preview >/dev/null 2>&1 || true
runuser -u postgres -- dropdb --if-exists "$DB_NAME"
runuser -u postgres -- createdb --owner=hist_api "$DB_NAME"
cp /etc/ege-history/api.env /etc/ege-history/preview.env
sed -i \
  -e 's#/ege_history#/ege_history_preview#' \
  -e 's/^API_PORT=.*/API_PORT=8793/' \
  -e 's/^MIRROR_FIREBASE=.*/MIRROR_FIREBASE=0/' \
  /etc/ege-history/preview.env
chown root:hist-api /etc/ege-history/preview.env
chmod 640 /etc/ege-history/preview.env

ENV_FILE=/etc/ege-history/preview.env pm2 start /opt/ege-history-api/src/server.js \
  --name hist-api-preview --uid hist-api --gid hist-api --time
nginx -t
systemctl reload nginx
for _ in {1..20}; do
  if curl --fail --silent https://reshay-istoriyu.ru/api-preview/v1/health >/dev/null; then
    echo "Isolated preview API is ready"
    exit 0
  fi
  sleep 1
done
echo "Preview API health check failed" >&2
exit 4
