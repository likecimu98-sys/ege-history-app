# server/ — бэкенд-эндпоинт выпуска Firebase-токенов

Линчпин перехода на строгие правила Firestore (см. `../security/write-surface.md`).
Даёт Telegram-ученику Firebase custom-token с **`uid = tgId`** и claim `teacher` —
после этого правило «пишет только владелец» перестаёт лочить людей.

**Код бота живёт на VPS (`/root/bot`), НЕ в этом репозитории.** Эти файлы —
версионируемый исходник, который РАЗВОРАЧИВАЕТСЯ на VPS отдельно (ниже). Пока не
развёрнут — на прод ничего не влияет: клиент как входил анонимно, так и входит.

## Файлы

| Файл                     | Что                                                            |
|--------------------------|---------------------------------------------------------------|
| `initdata.js`            | Проверка подписи Telegram initData (HMAC-SHA256). Security-ядро. |
| `token-endpoint.js`      | HTTP-обработчик: initData → `createCustomToken(tgId, {claims})`. |
| `initdata.selftest.js`   | Офлайн-тест подписи (подделка/подмена/протухание/кириллица).   |
| `endpoint.selftest.js`   | Офлайн-тест эндпоинта с моками (ученик/учитель/401/404).       |

Тесты (ничего живого): `node server/initdata.selftest.js && node server/endpoint.selftest.js`.

## Выкат на VPS — ОТДЕЛЬНЫЙ процесс (bot.js НЕ трогаем)

`vps-main.js` — самодостаточный запускатель: сам читает `serviceAccount.json` и
`/root/bot/.env` (токен бота), поднимает эндпоинт на `127.0.0.1:8791`. Работающего
бота не трогает вообще — это отдельное pm2-приложение рядом.

Из корня репозитория (с машины, где есть SSH-ключ к VPS):

```bash
# 1. Залить 3 файла рядом с ботом
scp server/initdata.js server/token-endpoint.js server/vps-main.js root@185.198.152.200:/root/bot/

# 2. Запустить как отдельный pm2-процесс + автозапуск
ssh root@185.198.152.200 'cd /root/bot && pm2 start vps-main.js --name hist-token && pm2 save'

# 3. Локальная проверка НА сервере (должен ответить 401 {"error":"empty"}, не упасть)
ssh root@185.198.152.200 'curl -sS -X POST http://127.0.0.1:8791/auth/telegram -H "Content-Type: application/json" -d "{}"'
```

Если шаг 3 вернул `{"error":"empty"}` — процесс жив и Firebase-admin инициализировался.
Если `BOT_TOKEN не найден` — глянуть имя ключа в `/root/bot/.env` и либо переименовать
в `BOT_TOKEN`, либо запустить с `TOKEN_ENV`… (проще: `pm2 delete hist-token`, поправить,
снова `pm2 start`). Бот при этом не затронут.

Легаси-вариант «вписать прямо в bot.js» (НЕ рекомендуется, трогает живого бота) —
см. историю git этого файла.

## Nginx (тот же домен, отдельный путь) — на VPS

В конфиг `reshay-istoriyu.ru` добавить проксирование ТОЛЬКО пути `/auth/`:

```nginx
location /auth/ {
    proxy_pass http://127.0.0.1:8791;
    proxy_set_header Host $host;
}
```
`nginx -t && systemctl reload nginx`. Порт 8791 наружу НЕ открывать (firewall) —
только через nginx.

## Клиент (в этом репо, ОТДЕЛЬНЫЙ шаг, за флагом)

`firebase-sync.js` `initAuth()`: в реальном Telegram (`isRealTelegram()`) сначала
`POST /auth/telegram {initData: tg.initData}` → `signInWithCustomToken(token)`;
при любой ошибке — текущий `signInAnonymously()` (полный откат поведения). Вне
Telegram — как сейчас. Включать за флагом, чтобы катить клиент и бэкенд независимо.

## Порядок безопасного выката

1. ✅ Код + офлайн-тесты (сделано, в репо).
2. Развернуть эндпоинт на VPS (по явному согласию — живой сервис). Проверить
   `curl -sS -X POST https://reshay-istoriyu.ru/auth/telegram -d '{}'` → `401` (не 404).
3. Включить клиентский флаг для СЕБЯ, войти в Telegram, убедиться:
   `firebase.auth().currentUser.uid === <свой tgId>`.
4. Раскатать флаг на всех. Прогресс не мигрируем — docId уже = tgId.
5. Только потом — предпосылки 2–4 (перенос учительских записей/слияния в бота,
   split fullStateJson) и лишь затем публикация `security/firestore.rules.strict`.

**НЕ включать строгие правила, пока шаги 2–4 не подтверждены на проде.**
