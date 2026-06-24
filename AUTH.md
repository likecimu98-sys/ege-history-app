# Выравнивание аутентификации: `auth.uid` = ID документа

Это корневой фикс. Пока `request.auth.uid` не совпадает с ID документа ученика,
**нельзя** включить строгие правила Firestore («ученик пишет только свой документ»)
и нельзя построить настоящую изоляцию/тенант. Подробнее, почему — в `SECURITY.md`.

## Текущее состояние (по типам входа)

ID документа = `resolveUserId()` (firebase-sync.js), приоритет:
**Telegram ID → `google_<uid>` → legacy `stable_student_id` → анонимный `uid`.**

| Тип входа | `request.auth.uid` | ID документа | Совпадает? |
|---|---|---|---|
| **Telegram (custom-token)** | то, что положил сервер бота при минтинге токена | `tgId` | **❓ зависит от сервера** |
| **Анонимный (standalone PWA)** | случайный Firebase uid | тот же uid (фолбэк) | ✅ обычно да |
| **Google** | Firebase `u.uid` | `google_<u.uid>` (с префиксом!) | ❌ из-за префикса |

Главное неизвестное — **Telegram**: какой `uid` кладёт сервер в custom-token. Сервер
(бэкенд бота) **в этом репозитории отсутствует** — токен только потребляется клиентом
(`signInWithCustomToken(auth, __initial_auth_token)`).

## Шаг 0. Узнать факт (диагностика — уже в коде)

В клиент добавлена безопасная диагностика (за флагом, только лог):
```js
localStorage.setItem('ege_auth_debug', '1');  // затем перезагрузить
```
Открой приложение **в реальном Telegram Mini App** (не в preview — там всегда анонимный
вход) и посмотри в консоли строку `[AuthDiag]`:
```json
{ "authUid": "...", "canonicalDocId": "...", "match_authUid_equals_docId": true|false }
```
- Если `match: true` у Telegram-учеников — **сервер уже минтит правильно**, и можно сразу
  чинить только Google-префикс и включать строгие правила.
- Если `match: false` — нужен серверный фикс (Шаг 1).

> **ПОДТВЕРЖДЕНО (24.06.2026, реальный Telegram Mini App):**
> `authUid = 8UxGPoM2e5NA2pQg1E6PA02kgDg1` (случайный Firebase-uid),
> `canonicalDocId = 352253483` (Telegram ID), **`match: false`**.
> Сервер минтит токен со СЛУЧАЙНЫМ uid, не с tgId → нужен серверный фикс (Шаг 1).
> Документы уже ключатся по Telegram ID, поэтому миграции данных для Telegram-учеников
> НЕ требуется — после фикса `auth.uid (=tgId)` совпадёт с ID документа.

## Шаг 1. Сервер бота (вне этого репо): uid токена = tgId

Там, где бэкенд минтит токен для Mini App (Firebase Admin SDK), `uid` должен быть
строковым Telegram ID:
```js
// бэкенд бота (Node + firebase-admin)
const token = await admin.auth().createCustomToken(String(telegramUserId));
// затем отдать token клиенту как __initial_auth_token
```
Тогда у Telegram-учеников `request.auth.uid === tgId === ID документа`.

**Вариант с custom-claims (рекомендую — не меняет `auth.uid`, безопаснее для всего,
что могло на него завязаться):** оставить uid как есть, но добавить в токен claim с tgId:
```js
const token = await admin.auth().createCustomToken(firebaseUid, { tgId: String(telegramUserId) });
```
Тогда в правилах сверяемся не с `auth.uid`, а с claim:
```
function isOwner(id) {
  return request.auth != null && request.auth.token.tgId == id;
}
```
Любой из двух вариантов закрывает проблему. Custom-claims — мягче (ничего не ломает),
смена uid — проще в правилах. Выбирай по тому, что удобнее в бэкенде бота.

## Шаг 2. Клиент (этот репо): убрать рассинхрон Google-префикса

Сейчас Google-документ имеет ID `google_<uid>`, а `auth.uid` = `<uid>`. Варианты:
- **(A)** Хранить Google-пользователей по ID = `u.uid` (без префикса) — тогда совпадает.
  Требует миграции существующих `google_*` документов на новый ID.
- **(B)** Оставить как есть, но в строгих правилах разрешить запись, если
  `studentId == auth.uid || studentId == 'google_' + auth.uid`. Без миграции, но правило
  чуть сложнее. **Рекомендую (B)** — меньше риска для живых данных.

Пример правила для (B) (вставить в строгий ruleset из SECURITY.md):
```
function isOwner(id) {
  return request.auth != null
      && (id == request.auth.uid || id == 'google_' + request.auth.uid);
}
match /artifacts/{appId}/public/data/students/{studentId} {
  allow read:  if request.auth != null;
  allow write: if isOwner(studentId) && blobOk();
}
```
Анонимные пользователи уже совпадают (фолбэк `resolveUserId` = `userObj.uid`).

## Шаг 3. Включить строгие правила

После Шагов 0–2 (и проверки на эмуляторе) задеплоить строгий ruleset из `SECURITY.md`
с `isOwner` из варианта (B). Это и есть «реальная безопасность», поверх которой потом
строится тенант (школы).

## Порядок и риски

1. Диагностика (готова) → запустить в Mini App → прочитать `[AuthDiag]`. **Без риска.**
2. По результату: серверный фикс токена (Шаг 1) и/или правило для Google (Шаг 2B).
3. Прогон на эмуляторе → деплой строгих правил.

⚠️ Не включай строгие правила, пока `[AuthDiag]` не покажет `match: true` (или пока
правило не покрывает реальные ID) — иначе залочишь учеников/потеряешь прогресс.
