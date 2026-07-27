#!/usr/bin/env bash
# Сторож живости API: раз в две минуты спрашивает /api/v1/health и пишет в
# Telegram админу, когда состояние МЕНЯЕТСЯ.
#
# Зачем. Падение hist-api не видно ниоткуда: pm2 перезапустит процесс, но если он
# падает в цикле или встал PostgreSQL, наружу это выглядит как «приложение не
# грузится», и узнаём мы об этом от ученика в личке. Для бесплатного продукта это
# терпимо, для платного — нет.
#
# Токен и chat_id берём из того же /etc/ege-history/backup.env, что и бэкапы:
# заводить второй секрет ради того же самого бота смысла нет.
#
# ⚠️ С этого VPS основные IP api.telegram.org заблокированы, работает только
# 149.154.167.220 — он прописан в /etc/hosts. Не «почини» это, убрав запись.

set -Eeuo pipefail
umask 077

CONFIG="${WATCH_CONFIG:-/etc/ege-history/backup.env}"
[[ -r "$CONFIG" ]] || { echo "Config is missing: $CONFIG" >&2; exit 2; }
# shellcheck disable=SC1090
set -a
source "$CONFIG"
set +a

: "${HEALTH_URL:=http://127.0.0.1:8792/api/v1/health}"
: "${STATE_FILE:=/var/lib/ege-history/health-watch.state}"
# Порог в три проверки (~6 минут) — чтобы обычный перезапуск при деплое не поднимал
# тревогу. Деплой укладывается в секунды, реальная авария — нет.
: "${FAIL_THRESHOLD:=3}"

mkdir -p "$(dirname "$STATE_FILE")"

send() {
  [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${BACKUP_ADMIN_CHAT_ID:-}" ]] || return 0
  curl --fail --silent --show-error --max-time 30 \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${BACKUP_ADMIN_CHAT_ID}" \
    --data-urlencode "text=$1" >/dev/null || true
}

read -r prev_state prev_fails < <(cat "$STATE_FILE" 2>/dev/null || echo "up 0")
prev_fails="${prev_fails:-0}"

body="$(curl --silent --max-time 10 "$HEALTH_URL" 2>/dev/null || true)"
if [[ "$body" == *'"ok":true'* ]]; then
  # Поднялся после аварии — сообщаем, иначе так и не узнаем, чем кончилось.
  if [[ "$prev_state" == "down" ]]; then
    version="$(printf '%s' "$body" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    send "✅ API «Решай Историю» снова отвечает (релиз ${version:-неизвестен})."
  fi
  printf 'up 0\n' > "$STATE_FILE"
  exit 0
fi

fails=$((prev_fails + 1))
if [[ "$prev_state" != "down" && "$fails" -ge "$FAIL_THRESHOLD" ]]; then
  # Заодно приносим последние строки лога: без них первое действие всё равно
  # «зайти на сервер и посмотреть», а это лишние минуты простоя.
  tail_log="$(tail -n 5 /var/log/ege-history/api-error.log 2>/dev/null | cut -c1-300)"
  send "🔴 API «Решай Историю» не отвечает $fails проверки подряд на $(hostname).
Сайт для учеников сейчас не работает.
${tail_log:-（лог пуст）}"
  printf 'down %s\n' "$fails" > "$STATE_FILE"
  exit 1
fi

printf '%s %s\n' "$prev_state" "$fails" > "$STATE_FILE"
