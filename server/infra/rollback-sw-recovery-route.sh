#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP=/root/nginx-reshay-sw-recovery.rollback.bak
TARGET=/etc/nginx/sites-enabled/reshay-istoriyu.ru

test -f "$BACKUP"
cp -a "$BACKUP" "$TARGET"
nginx -t
systemctl reload nginx
echo "SW recovery route rolled back from $BACKUP"
