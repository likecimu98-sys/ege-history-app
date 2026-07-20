#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

API_DIR="${API_DIR:-/opt/ege-history-api}"
CONFIG="${ENV_FILE:-/etc/ege-history/api.env}"
DB_NAME="ege_history_smoke_test"
PORT=8793
[[ -f "$API_DIR/src/server.js" && -r "$CONFIG" ]]
[[ "$DB_NAME" == "ege_history_smoke_test" ]]
# shellcheck disable=SC1090
source "$CONFIG"
WORK="$(mktemp -d /tmp/ege-history-smoke-XXXXXX)"
PID=""
STEP="initialize"
cleanup() {
  [[ -n "$PID" ]] && kill "$PID" >/dev/null 2>&1 || true
  runuser -u postgres -- dropdb --if-exists "$DB_NAME" >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT
failed() {
  local code="$?"
  echo "API smoke test failed at step: $STEP" >&2
  [[ -f "$WORK/api.log" ]] && tail -n 30 "$WORK/api.log" >&2
  exit "$code"
}
trap failed ERR

if runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -qx 1; then
  echo "Smoke database already exists" >&2
  exit 2
fi
runuser -u postgres -- createdb --owner=hist_api "$DB_NAME"
STEP="start temporary API"
SMOKE_DATABASE_URL="${DATABASE_URL%/*}/$DB_NAME"
runuser -u hist-api -- env ENV_FILE="$CONFIG" DATABASE_URL="$SMOKE_DATABASE_URL" API_PORT="$PORT" MIRROR_FIREBASE=0 \
  node "$API_DIR/src/server.js" >"$WORK/api.log" 2>&1 &
PID=$!
for _ in {1..30}; do curl --fail --silent "http://127.0.0.1:$PORT/api/v1/health" >/dev/null && break; sleep 1; done
curl --fail --silent "http://127.0.0.1:$PORT/api/v1/health" >/dev/null

BASE="http://127.0.0.1:$PORT/api/v1"
STEP="guest session and state merge"
curl --fail --silent -c "$WORK/one.cookies" -H 'content-type: application/json' -d '{}' "$BASE/auth/guest" >"$WORK/one.json"
CSRF_ONE="$(awk '$6=="ege_csrf" {print $7}' "$WORK/one.cookies")"
FIRST_ID="$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1])).user.canonicalDocId)" "$WORK/one.json")"
[[ -n "$CSRF_ONE" && -n "$FIRST_ID" ]]

curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d '{"state":{"stats":{"totalSolvedEver":5,"mockExams":{"active":{"id":"smoke","updatedAt":1},"history":[]}},"mistakesPool":[],"hideLearned":true},"baseRevision":0}' \
  "$BASE/me/state" >"$WORK/state-one.json"
curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d '{"state":{"stats":{"totalSolvedEver":8,"mockExams":{"active":null,"history":[{"id":"smoke","completedAt":2}]}},"mistakesPool":[],"hideLearned":true},"baseRevision":0}' \
  "$BASE/me/state" >"$WORK/state-two.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(!r.conflictMerged||r.version!==2)process.exit(1);const s=JSON.parse(r.data.fullStateJson);if(s.stats.totalSolvedEver!==8||s.stats.mockExams.history.length!==1||s.stats.mockExams.active!==null)process.exit(2)" "$WORK/state-two.json"

EVIL_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/one.cookies" -H 'content-type: application/json' \
  -H "x-csrf-token: $CSRF_ONE" -H 'origin: https://attacker.invalid' -X PATCH -d '{"name":"bad"}' "$BASE/me/profile")"
[[ "$EVIL_STATUS" == "403" ]]

STEP="cross-user isolation"
curl --fail --silent -c "$WORK/two.cookies" -H 'content-type: application/json' -d '{}' "$BASE/auth/guest" >"$WORK/two.json"
SECOND_ID="$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1])).user.canonicalDocId)" "$WORK/two.json")"
OTHER_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/two.cookies" \
  "$BASE/store/doc?path=artifacts%2Fege-history-bot%2Fprivate%2Fdata%2Fstate%2F${FIRST_ID}")"
[[ "$OTHER_STATUS" == "403" ]]

STEP="internal store and durable notification queue"
INTERNAL="http://127.0.0.1:$PORT/internal/v1"
INTERNAL_AUTH="authorization: Bearer $INTERNAL_API_TOKEN"
CONFIG_PATH="artifacts/${FIREBASE_APP_ID}/public/data/config/smoke-config"
NOTIFY_PATH="artifacts/${FIREBASE_APP_ID}/public/data/notifyJobs/smoke-notification"
SECOND_STATE_PATH="artifacts/${FIREBASE_APP_ID}/private/data/state/${SECOND_ID}"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$CONFIG_PATH\",\"data\":{\"smoke\":true},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$SECOND_STATE_PATH\",\"data\":{\"fullStateJson\":\"{}\"},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$NOTIFY_PATH\",\"data\":{\"type\":\"hw_done\",\"ts\":$(date +%s%3N)},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" -d '{}' "$INTERNAL/notifications/claim" >"$WORK/claim-one.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.jobs?.[0]?.id!=='smoke-notification')process.exit(1)" "$WORK/claim-one.json"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" -d '{"error":"smoke retry"}' \
  "$INTERNAL/notifications/smoke-notification/fail" >/dev/null
[[ "$(psql "$SMOKE_DATABASE_URL" -Atqc "SELECT status||':'||attempts||':'||(next_attempt_at>now()) FROM notification_jobs WHERE doc_id='smoke-notification'")" == "pending:1:true" ]]
psql "$SMOKE_DATABASE_URL" -v ON_ERROR_STOP=1 -qc "UPDATE notification_jobs SET next_attempt_at=now() WHERE doc_id='smoke-notification'"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" -d '{}' "$INTERNAL/notifications/claim" >"$WORK/claim-two.json"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" -d '{}' \
  "$INTERNAL/notifications/smoke-notification/ack" >/dev/null
[[ "$(psql "$SMOKE_DATABASE_URL" -Atqc "SELECT status||':'||attempts FROM notification_jobs WHERE doc_id='smoke-notification'")" == "delivered:2" ]]
UNAUTHORIZED_INTERNAL="$(curl --silent -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{}' "$INTERNAL/notifications/claim")"
[[ "$UNAUTHORIZED_INTERNAL" == "403" ]]

STEP="websocket origin, authorization and reconnect"
COOKIE_ONE="$(awk 'BEGIN{first=1} $6 ~ /^ege_/ {if(!first)printf "; "; printf "%s=%s",$6,$7; first=0}' "$WORK/one.cookies")"
node "$API_DIR/scripts/smoke-websocket.js" "ws://127.0.0.1:$PORT/api/v1/store/ws" "$COOKIE_ONE" \
  'https://reshay-istoriyu.ru' "artifacts/${FIREBASE_APP_ID}/private/data/state/${FIRST_ID}" "$SECOND_STATE_PATH" "$INTERNAL_API_TOKEN"

STEP="Telegram signed authentication"
TG_INIT="$(BOT_TOKEN="$BOT_TOKEN" node -e "const c=require('crypto');const token=process.env.BOT_TOKEN;const p={auth_date:String(Math.floor(Date.now()/1000)),query_id:'smoke-query',user:JSON.stringify({id:700000000002,first_name:'Smoke'})};const s=Object.keys(p).sort().map(k=>k+'='+p[k]).join('\\n');const key=c.createHmac('sha256','WebAppData').update(token).digest();p.hash=c.createHmac('sha256',key).update(s).digest('hex');process.stdout.write(new URLSearchParams(p).toString())")"
INIT_DATA="$TG_INIT" node -e "process.stdout.write(JSON.stringify({initData:process.env.INIT_DATA}))" | \
  curl --fail --silent -c "$WORK/telegram.cookies" -H 'content-type: application/json' --data-binary @- "$BASE/auth/telegram" >"$WORK/telegram.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.user?.canonicalDocId!=='700000000002')process.exit(1)" "$WORK/telegram.json"

STEP="magic link and teacher authorization scope"
EXP_MS="$(( $(date +%s%3N) + 600000 ))"
TEACHER_TOKEN="teacher-magic-1234567890"
TEACHER_PATH="artifacts/${FIREBASE_APP_ID}/public/data/teachers/700000000001"
STUDENT_A_PATH="artifacts/${FIREBASE_APP_ID}/public/data/students/smoke-student-a"
STUDENT_B_PATH="artifacts/${FIREBASE_APP_ID}/public/data/students/smoke-student-b"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"artifacts/${FIREBASE_APP_ID}/public/data/loginTokens/${TEACHER_TOKEN}\",\"data\":{\"tgId\":\"700000000001\",\"name\":\"Smoke teacher\",\"exp\":${EXP_MS}},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$TEACHER_PATH\",\"data\":{\"name\":\"Smoke teacher\",\"classes\":[{\"code\":\"SMOKE-A\",\"name\":\"A\"}]},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$STUDENT_A_PATH\",\"data\":{\"name\":\"Student A\",\"classCode\":\"SMOKE-A\"},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$STUDENT_B_PATH\",\"data\":{\"name\":\"Student B\",\"classCode\":\"SMOKE-B\"},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -c "$WORK/teacher.cookies" -H 'content-type: application/json' \
  -d "{\"token\":\"$TEACHER_TOKEN\",\"kind\":\"token\"}" "$BASE/auth/magic/redeem" >"$WORK/teacher.json"
curl --fail --silent -b "$WORK/teacher.cookies" "$BASE/teacher/classes" >"$WORK/teacher-classes.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(!r.classes?.includes('SMOKE-A'))process.exit(1)" "$WORK/teacher-classes.json"
curl --fail --silent -b "$WORK/teacher.cookies" "$BASE/teacher/students?classCode=SMOKE-A" >"$WORK/teacher-a.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.students?.length!==1||r.students[0].data.name!=='Student A')process.exit(1)" "$WORK/teacher-a.json"
TEACHER_B_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/teacher.cookies" "$BASE/teacher/students?classCode=SMOKE-B")"
[[ "$TEACHER_B_STATUS" == "403" ]]

STEP="QR session redemption"
CSRF_TWO="$(awk '$6=="ege_csrf" {print $7}' "$WORK/two.cookies")"
QR_TOKEN="qr-session-1234567890123456"
QR_PATH="artifacts/${FIREBASE_APP_ID}/public/data/loginSessions/${QR_TOKEN}"
curl --fail --silent -b "$WORK/two.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_TWO" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$QR_PATH\",\"data\":{\"status\":\"pending\",\"createdAt\":$(date +%s%3N),\"exp\":${EXP_MS}},\"mode\":\"set\"}" "$BASE/store/doc" >/dev/null
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$QR_PATH\",\"data\":{\"status\":\"confirmed\",\"tgId\":\"700000000003\",\"name\":\"QR student\"},\"mode\":\"merge\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -b "$WORK/two.cookies" -c "$WORK/two.cookies" -H 'content-type: application/json' \
  -d "{\"token\":\"$QR_TOKEN\",\"kind\":\"session\"}" "$BASE/auth/magic/redeem" >"$WORK/qr.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.tgId!=='700000000003')process.exit(1)" "$WORK/qr.json"
SECOND_DUEL_ID="700000000003"
CSRF_TWO="$(awk '$6=="ege_csrf" {print $7}' "$WORK/two.cookies")"

STEP="PIN linking and PIN rate limit"
PIN_TARGET="smoke-pin-profile-123"
PIN_PATH="artifacts/${FIREBASE_APP_ID}/public/data/students/${PIN_TARGET}"
curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$PIN_PATH\",\"data\":{\"name\":\"PIN student\",\"syncPin\":\"87654321\"},\"mode\":\"set\"}" "$INTERNAL/store/write" >/dev/null
curl --fail --silent -c "$WORK/pin.cookies" -H 'content-type: application/json' -d '{}' "$BASE/auth/guest" >/dev/null
CSRF_PIN="$(awk '$6=="ege_csrf" {print $7}' "$WORK/pin.cookies")"
curl --fail --silent -b "$WORK/pin.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_PIN" \
  -H 'origin: https://reshay-istoriyu.ru' -d '{"pin":"87654321"}' "$BASE/auth/pin/link" >"$WORK/pin.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.targetId!=='smoke-pin-profile-123')process.exit(1)" "$WORK/pin.json"
PIN_STATUS=""
for _ in 1 2 3 4 5; do
  PIN_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/pin.cookies" -H 'content-type: application/json' \
    -H "x-csrf-token: $CSRF_PIN" -H 'origin: https://reshay-istoriyu.ru' -d '{"pin":"11111111"}' "$BASE/auth/pin/link")"
done
[[ "$PIN_STATUS" == "429" ]]

STEP="duel ownership, race and duplicate result handling"
MATCH_PATH="artifacts/${FIREBASE_APP_ID}/public/data/matches/smoke-duel"
curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"status\":\"waiting\",\"mode\":\"classic\",\"createdAt\":$(date +%s%3N),\"player1\":{\"uid\":\"$FIRST_ID\",\"name\":\"One\",\"score\":0,\"combo\":0},\"player2\":null,\"startTime\":0},\"mode\":\"set\"}" "$BASE/store/doc" >"$WORK/match-create.json"
MATCH_VERSION="$(node -e "const fs=require('fs');console.log(JSON.parse(fs.readFileSync(process.argv[1])).version)" "$WORK/match-create.json")"
curl --fail --silent -b "$WORK/two.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_TWO" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"status\":\"playing\",\"player2\":{\"uid\":\"$SECOND_DUEL_ID\",\"name\":\"Two\",\"score\":0,\"combo\":0},\"startTime\":$(date +%s%3N)},\"mode\":\"update\",\"expectedVersion\":${MATCH_VERSION}}" "$BASE/store/doc" >/dev/null
TEACHER_CSRF="$(awk '$6=="ege_csrf" {print $7}' "$WORK/teacher.cookies")"
RACE_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/teacher.cookies" -H 'content-type: application/json' -H "x-csrf-token: $TEACHER_CSRF" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"status\":\"playing\",\"player2\":{\"uid\":\"700000000001\",\"name\":\"Third\",\"score\":0}},\"mode\":\"update\",\"expectedVersion\":${MATCH_VERSION}}" "$BASE/store/doc")"
[[ "$RACE_STATUS" == "403" || "$RACE_STATUS" == "409" ]]
OPPONENT_EDIT_STATUS="$(curl --silent -o /dev/null -w '%{http_code}' -b "$WORK/two.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_TWO" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"player1\":{\"uid\":\"$FIRST_ID\",\"name\":\"Hacked\",\"score\":999}},\"mode\":\"update\"}" "$BASE/store/doc")"
[[ "$OPPONENT_EDIT_STATUS" == "403" ]]
curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"player1\":{\"uid\":\"$FIRST_ID\",\"name\":\"One\",\"score\":5,\"combo\":2,\"seq\":2}},\"mode\":\"update\"}" "$BASE/store/doc" >/dev/null
curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PUT \
  -d "{\"path\":\"$MATCH_PATH\",\"data\":{\"player1\":{\"uid\":\"$FIRST_ID\",\"name\":\"One\",\"score\":2,\"combo\":0,\"seq\":1}},\"mode\":\"update\"}" "$BASE/store/doc" >/dev/null
curl --fail --silent -b "$WORK/one.cookies" "$BASE/store/doc?path=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$MATCH_PATH")" >"$WORK/match-final.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.data?.player1?.score!==5||r.data?.player1?.seq!==2||r.data?.player1?.name!=='One')process.exit(1)" "$WORK/match-final.json"

STEP="request size limit"
LARGE_STATUS="$(node -e "process.stdout.write(JSON.stringify({name:'x'.repeat(70000)}))" | curl --silent -o /dev/null -w '%{http_code}' \
  -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -X PATCH --data-binary @- "$BASE/me/profile")"
[[ "$LARGE_STATUS" == "413" ]]

STEP="logout and cleanup"
curl --fail --silent -b "$WORK/one.cookies" -H 'content-type: application/json' -H "x-csrf-token: $CSRF_ONE" \
  -H 'origin: https://reshay-istoriyu.ru' -d '{}' "$BASE/auth/logout" >/dev/null

curl --fail --silent -H 'content-type: application/json' -H "$INTERNAL_AUTH" \
  -d "{\"path\":\"$CONFIG_PATH\"}" "$INTERNAL/store/delete" >/dev/null
echo "API smoke test passed"
