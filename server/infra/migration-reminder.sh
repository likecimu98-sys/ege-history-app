#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
STATE_DIR=/var/lib/ege-history/migration
STATE_FILE="$STATE_DIR/cutover.env"
[[ -r "$STATE_FILE" ]] || exit 0
# shellcheck disable=SC1090
source "$STATE_FILE"
set -a
# shellcheck disable=SC1090
source /etc/ege-history/backup.env
set +a
NOW="$(date +%s)"
notify() {
  curl --fail --silent --show-error --max-time 30 -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${BACKUP_ADMIN_CHAT_ID}" --data-urlencode "text=$1" >/dev/null
}
if (( NOW >= MIRROR_UNTIL )) && [[ "${MIRROR_STOPPED_AT:-0}" == "0" && ! -f "$STATE_DIR/mirror-reminder.sent" ]]; then
  notify "⏳ Прошло 14 дней после переезда «Решай Историю». Проверь отчёты и останови обратное зеркалирование Firebase отдельной подтверждённой командой."
  touch "$STATE_DIR/mirror-reminder.sent"
fi
if (( NOW >= ARCHIVE_UNTIL )) && [[ ! -f "$STATE_DIR/archive-reminder.sent" ]]; then
  notify "🗄 Прошло 60 дней после переезда «Решай Историю». Firebase можно удалить только после финального экспорта и отдельного подтверждения администратора."
  touch "$STATE_DIR/archive-reminder.sent"
fi
