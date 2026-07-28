#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP=/root/ege-security-headers.rollback.bak
TARGET=/etc/nginx/snippets/ege-security-headers.conf

test -f "$BACKUP"
cp -a "$BACKUP" "$TARGET"
nginx -t
systemctl reload nginx
echo "Security headers rolled back from $BACKUP"
