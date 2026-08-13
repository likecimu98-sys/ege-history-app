#!/usr/bin/env bash
# Сторож обязан замечать, что бэкапы перестали делаться.
#
# 🔴 Дважды подряд бэкапы умирали молча: неделю в июле (после переезда на Beget
# скриптов не оказалось в /usr/local/sbin) и 12.08.2026 (миграции обществознания
# завели таблицы, недоступные роли ege_backup, — pg_dump стал падать целиком).
# Оба раза таймер тикал, юнит падал, и об этом никто не знал.
#
# Тест гоняет НАСТОЯЩИЙ скрипт на подставных каталогах. Ни одного обращения к
# Telegram: без токена в конфиге send() возвращается сразу.
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../server/infra/health-watch.sh"
[[ -r "$script" ]] || { echo "не нахожу health-watch.sh"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/backups" "$tmp/empty" "$tmp/state"
# Порт 9 (discard) закрыт — API заведомо «не отвечает», нас интересует не он.
printf 'HEALTH_URL=http://127.0.0.1:9/nope\n' > "$tmp/watch.env"

state() { cat "$tmp/state/backup.state" 2>/dev/null || echo '(нет файла)'; }
run() {
  WATCH_CONFIG="$tmp/watch.env" \
  BACKUP_DIR="$1" \
  BACKUP_STATE_FILE="$tmp/state/backup.state" \
  STATE_FILE="$tmp/state/health.state" \
  bash "$script" >/dev/null 2>&1 || true
}
expect() {
  local want="$1" got; got="$(state)"
  [[ "$got" == "$want" ]] || { echo "✗ ожидалось «$want», получено «$got» — $2"; exit 1; }
}

archive="$tmp/backups/ege-history-20260812-180138.tar.gz.age"

touch "$archive";                     run "$tmp/backups"; expect fresh 'свежий архив принят за протухший'
touch -d '20 hours ago' "$archive";   run "$tmp/backups"; expect stale 'протухший архив не замечен'
touch "$archive";                     run "$tmp/backups"; expect fresh 'сторож не вернулся в норму после починки'
                                      run "$tmp/empty";   expect stale 'пустой каталог бэкапов сошёл за норму'
                                      run "$tmp/нет-такого"; expect stale 'отсутствующий каталог сошёл за норму'

# Граница: ровно на пороге — уже тревога, на час раньше — ещё нет.
touch "$archive"; run "$tmp/backups"
touch -d '8 hours ago' "$archive";  run "$tmp/backups"; expect fresh 'восемь часов — это ещё не авария'
touch -d '9 hours ago' "$archive";  run "$tmp/backups"; expect stale 'девять часов — это уже авария'

echo 'health-watch.selftest: ok'
