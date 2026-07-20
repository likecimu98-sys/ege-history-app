#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${CONFIRM_CLIENT_DEPLOY:-}" == "RESHAY_HISTORY_CLIENT" ]] || {
  echo "Set CONFIRM_CLIENT_DEPLOY=RESHAY_HISTORY_CLIENT" >&2
  exit 2
}
[[ "$(id -u)" == "0" ]] || { echo "Run as root" >&2; exit 3; }

CLIENT_ARCHIVE="${CLIENT_ARCHIVE:-/root/ege-app-cutover.tar.gz}"
STAMP="$(TZ=Europe/Moscow date +%Y%m%d-%H%M%S)"
CLIENT_NEW="/var/www/ege-app.release-$STAMP"
CLIENT_OLD="/var/www/ege-app.client-rollback-$STAMP"
CLIENT_FAILED="/var/www/ege-app.failed-$STAMP"
ARCHIVE_LIST="$(mktemp /tmp/ege-client-list-XXXXXX)"
HTTP_CHECK="$(mktemp /tmp/ege-client-http-XXXXXX)"
SWITCHED=0

cleanup_temp() { rm -f -- "$ARCHIVE_LIST" "$HTTP_CHECK"; }
rollback_on_error() {
  local code="$?"
  cleanup_temp
  if (( SWITCHED == 1 )); then
    if [[ -d /var/www/ege-app ]]; then mv /var/www/ege-app "$CLIENT_FAILED"; fi
    if [[ -d "$CLIENT_OLD" ]]; then mv "$CLIENT_OLD" /var/www/ege-app; fi
    systemctl reload nginx || true
  elif [[ -d "$CLIENT_NEW" ]]; then
    rm -rf -- "$CLIENT_NEW"
  fi
  exit "$code"
}
trap rollback_on_error ERR
trap cleanup_temp EXIT

[[ -f "$CLIENT_ARCHIVE" && -d /var/www/ege-app && ! -e "$CLIENT_NEW" && ! -e "$CLIENT_OLD" ]]
tar -tzf "$CLIENT_ARCHIVE" >"$ARCHIVE_LIST"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "$ARCHIVE_LIST"; then
  echo "Unsafe path in client archive" >&2
  exit 4
fi
grep -qx './index.html\|index.html' "$ARCHIVE_LIST"
grep -Eq '(^|/)cloud-sync\.js$' "$ARCHIVE_LIST"
grep -Eq '(^|/)vps-sync-compat\.js$' "$ARCHIVE_LIST"
if grep -Eq '(^|/)server/' "$ARCHIVE_LIST"; then
  echo "Server sources must not be present in the public archive" >&2
  exit 5
fi

install -d -m 755 "$CLIENT_NEW"
tar -xzf "$CLIENT_ARCHIVE" -C "$CLIENT_NEW"
find "$CLIENT_NEW" -type d -exec chmod 755 {} +
find "$CLIENT_NEW" -type f -exec chmod 644 {} +
if [[ -e "$CLIENT_NEW/firebase-sync.js" ]]; then
  echo "Legacy Firebase client module remains in public build" >&2
  exit 6
fi
if grep -R -E 'www\.gstatic\.com/firebasejs|firebaseio\.com|firebaseapp\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com' \
  "$CLIENT_NEW" --include='*.js' --include='*.html' -q; then
  echo "Direct Firebase client reference remains in public build" >&2
  exit 7
fi

mv /var/www/ege-app "$CLIENT_OLD"
mv "$CLIENT_NEW" /var/www/ege-app
SWITCHED=1
nginx -t
systemctl reload nginx
curl --fail --silent https://reshay-istoriyu.ru/ -o "$HTTP_CHECK"
grep -q 'pwa.js' "$HTTP_CHECK"
curl --fail --silent https://reshay-istoriyu.ru/cloud-sync.js >/dev/null
curl --fail --silent https://reshay-istoriyu.ru/vps-sync-compat.js >/dev/null
trap - ERR
echo "Client release deployed; rollback copy: $CLIENT_OLD"
