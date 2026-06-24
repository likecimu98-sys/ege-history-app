# Безопасность Firestore — что сделано и что делать дальше

## Зачем это вообще

Все данные приложения лежат в `artifacts/ege-history-bot/public/data/...` —
путь буквально `public`. Если в консоли Firebase правила сейчас в «тестовом режиме»
(`allow read, write: if true`), то **любой человек в интернете** может читать и менять
данные всех учеников всех школ. Для B2B-продукта с данными несовершеннолетних это
прямой риск (в т.ч. 152-ФЗ).

В репозитории появился **`firestore.rules`** — безопасный baseline. Это первый и
самый дешёвый шаг. Но прочти раздел «Честная оценка» — полная изоляция упирается в
модель аутентификации.

---

## Шаг 1. Задеплоить baseline-правила (безопасно, никого не залочит)

`firestore.rules` (в корне) закрывает доступ для НЕавторизованных запросов, но
оставляет полный доступ авторизованным — поэтому он не ломает приложение (все клиенты
авторизуются: custom-token в Telegram или анонимно в PWA) и не теряет прогресс.

**Вариант А — через консоль (проще, не нужен CLI):**
1. Firebase Console → проект → Firestore Database → вкладка **Rules**.
2. **Сначала скопируй текущие правила в блокнот** (на случай отката).
3. Вставь содержимое `firestore.rules`, нажми **Publish**.
4. Открой приложение как ученик — проверь, что прогресс грузится/сохраняется,
   лидерборд и ДЗ работают. Если что-то отвалилось — верни старые правила и напиши мне.

**Вариант Б — через CLI (нужен `firebase-tools` + VPN):**
```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

---

## Шаг 2. Проверить правила в «песочнице» ПЕРЕД ужесточением

Прежде чем включать строгие правила (ниже), протестируй на эмуляторе — он не трогает
боевые данные:
```bash
firebase emulators:start --only firestore
```
Открой Emulator UI (`http://localhost:4000`) или Rules Playground в консоли и проверь
сценарии: ученик читает/пишет свой документ; ученик пытается писать ЧУЖОЙ документ;
учитель читает класс. **Ключевой вопрос для теста:** чему равен `request.auth.uid` у
реального ученика и совпадает ли он с ID его документа (`studentId`). См. ниже.

---

## Честная оценка: почему строгая изоляция — это отдельная работа

«Ученик пишет только свой документ» в правилах выглядит как
`request.auth.uid == studentId`. Но в этом приложении **ID документа ≠ `auth.uid`** в
общем случае:

- ID документа задаёт `resolveUserId()` (firebase-sync.js): приоритет
  **Telegram ID → `google_<uid>` → legacy `stable_student_id` → анонимный `uid`**.
- `request.auth.uid` зависит от способа входа: custom-token (Telegram, минтит серверный
  бэкенд бота — какой там uid, из клиента не видно), анонимный (случайный Firebase uid),
  Google (Firebase uid).

Поэтому правило `auth.uid == studentId` вслепую **может залочить всех 200 учеников**.
Кроме того, включён **анонимный вход** — значит «только авторизованным» закрывает
интернет-ботов, но любой может вызвать `signInAnonymously()` и снова получить доступ.

**Вывод:** по-настоящему изолировать данные (и сделать мультитенант для школ) можно
только если **Firebase-Auth-UID совпадает с каноническим ID документа**. Это требует:
1. Минтить custom-token с `uid = <канонический ID>` (для Telegram — `uid = tgId`).
2. Перевести Google/анонимных пользователей на ту же схему (или хранить их в
   `users/{auth.uid}/...`, а не в общем `public/data`).
3. После этого включить строгие правила (ниже) — они начнут реально защищать.

Это и есть «структурная» часть масштабирования (п.1–2 из аудита). Без неё правила —
только baseline.

---

## Шаг 3. Ужесточённый ruleset (включать ТОЛЬКО после Шага 2 и фикса аутентификации)

Когда проверено, что `auth.uid == studentId`, замени baseline на это:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function authed() { return request.auth != null; }
    function isOwner(id) { return authed() && request.auth.uid == id; }
    function blobOk() {
      return !('fullStateJson' in request.resource.data)
             || request.resource.data.fullStateJson.size() < 950000; // backstop < 1 МБ
    }

    // Ученик: читать может любой авторизованный (нужно учителю/лидерборду),
    // писать — только владелец, и блоб ограничен по размеру.
    match /artifacts/{appId}/public/data/students/{studentId} {
      allow read:  if authed();
      allow write: if isOwner(studentId) && blobOk();
    }

    // Классы/ДЗ. (Полная изоляция «учитель видит только свой класс» требует связи
    //  classCode ↔ владелец-учитель; пока — авторизованным.)
    match /artifacts/{appId}/public/data/classes/{classCode} {
      allow read, write: if authed();
    }

    // Дуэли и кэш лидерборда.
    match /artifacts/{appId}/public/data/matches/{matchId}       { allow read, write: if authed(); }
    match /artifacts/{appId}/public/data/leaderboards/{doc}      { allow read, write: if authed(); }

    // Прочее под public/data — авторизованным (после аудита можно сузить).
    match /artifacts/{appId}/public/data/{document=**} { allow read, write: if authed(); }
    // Всё остальное — запрет.
    match /{document=**} { allow read, write: if false; }
  }
}
```

> Внимание: если оставить общий `…/public/data/{document=**}` с `allow write: if authed()`,
> он по правилу ИЛИ перебьёт `isOwner` на студентах. Перед включением строгого режима
> либо убери этот catch-all, либо подтверди тестом, что владение реально срабатывает.

---

## Заметка про индексы

Запросы лидерборда/класса используют составные индексы (например
`where('classCode','==') + orderBy('totalSolved','desc')`). Они, скорее всего, уже
созданы в консоли (иначе запрос падал бы с ссылкой «создать индекс»). При желании их
можно зафиксировать в `firestore.indexes.json` и деплоить через CLI.
