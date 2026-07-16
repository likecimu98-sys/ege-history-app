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

## Как это подключается к боту (на VPS)

Бот уже держит `firebase-admin` (`admin.credential.cert(serviceAccount.json)`, bot.js:83)
и токен бота в `/root/bot/.env`. Эндпоинт переиспользует их же.

Вставить в `bot.js` (в блоке «Старт», после инициализации `admin`):

```js
const { createTokenServer } = require('./token-endpoint');
// isTeacher: читаем teachers/{tgId} через тот же admin (или из users.db)
async function isTeacher(tgId) {
  const snap = await admin.firestore()
    .doc(`artifacts/ege-history-bot/public/data/teachers/${tgId}`).get();
  if (!snap.exists) return { teacher: false };
  const d = snap.data() || {};
  const classes = (d.classes || []).map(c => (typeof c === 'string' ? c : c.code)).filter(Boolean);
  return { teacher: true, classes };
}
const tokenServer = createTokenServer({
  admin, botToken: process.env.BOT_TOKEN, isTeacher,
  origin: 'https://reshay-istoriyu.ru', log: console,
});
tokenServer.listen(8791, '127.0.0.1', () => console.log('[token] :8791'));
```

Скопировать `initdata.js` и `token-endpoint.js` в `/root/bot/`, затем
`pm2 restart hist-bot`.

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
