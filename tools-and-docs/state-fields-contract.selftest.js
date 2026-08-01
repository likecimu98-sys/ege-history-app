'use strict';

// 🔴 ДОГОВОР О ПОЛЯХ СОСТОЯНИЯ между клиентом и сервером.
//
// Прогресс ученика сливается ДВАЖДЫ разным кодом: на клиенте deepMergeStates
// (cloud-sync.js), на сервере mergeStateValues (server/api/src/state-merge.js).
// Серверная половина работает по РУЧНОМУ перечню полей — всё, чего в нём нет,
// исчезает при каждой записи.
//
// Это уже стреляло 30.07.2026: сервер молча терял `consent` (0 из 1345 записей
// в облаке — отсюда анкета «введи имя» почти каждый вход), `examSolved`
// (обнулялась ротация банка ФИПИ) и `timeByTask`. Нашли не тестом, а по жалобам,
// через несколько дней.
//
// Тест закрывает именно эту дыру: если клиент научился сохранять поле, а сервер
// о нём не знает — сборка падает здесь, а не через неделю у людей.
//
// ⚠️ Тест сравнивает ИСХОДНИКИ, а не поведение: поднимать Postgres ради одной
// проверки дороже, чем зафиксировать сам договор. Если сервер начнёт сливать
// состояние иначе (например, целиком, без перечня) — этот тест нужно будет
// переписать под новую схему, а не удалять.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ⚠️ Комментарии вырезаем ПЕРЕД разбором. Первая редакция теста этого не делала и
// дала ложное «всё хорошо»: обработку `consent` можно было удалить целиком, а тест
// продолжал видеть слово в объяснительном комментарии рядом и считал поле покрытым.
// То есть страж пропускал ровно тот инцидент, ради которого написан. Проверено
// саботажем: без этой строки удаление кода не ловится.
const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const clientSource = stripComments(read('state.js'));
const serverSource = stripComments(read('server/api/src/state-merge.js'));

// ─── Поля, которые клиент отправляет в облако ────────────────────────────────
const saveFieldsMatch = clientSource.match(/SAVE_FIELDS\s*=\s*\[([\s\S]*?)\]/);
assert.ok(saveFieldsMatch, 'SAVE_FIELDS не найден в state.js — договор проверить не по чему');
const clientFields = [...new Set(
    (saveFieldsMatch[1].match(/'([\w]+)'/g) || []).map(s => s.slice(1, -1))
)];
assert.ok(clientFields.length > 10, `SAVE_FIELDS распознан подозрительно коротким (${clientFields.length}) — проверь разбор`);

// ─── Что умеет сервер ────────────────────────────────────────────────────────
// Сервер упоминает поле либо как stats.X, либо строкой в перечне (maxFields и т.п.).
const serverKnows = new Set([
    ...(serverSource.match(/stats\.(\w+)/g) || []).map(s => s.slice(6)),
    ...(serverSource.match(/'(\w+)'/g) || []).map(s => s.slice(1, -1)),
    ...(serverSource.match(/\bstats\['(\w+)'\]/g) || []).map(s => s.slice(8, -2)),
]);

// ─── Осознанные исключения ───────────────────────────────────────────────────
// Зеркало активных ДЗ: НЕ сливается намеренно, а пересчитывается из assignments
// (см. cloud-sync.js — recomputeHwMirror и комментарий «hwFlashcardsToSolve/hwTaskX
// сюда НЕ входят»). Хранить их в облаке как самостоятельную величину нельзя:
// две копии зеркала разошлись бы и показали ученику несуществующий долг.
const INTENTIONALLY_NOT_MERGED = new Set([
    'hwFlashcardsToSolve', 'hwTask1', 'hwTask3', 'hwTask4', 'hwTask5', 'hwTask7',
]);

const orphans = clientFields.filter(f => !serverKnows.has(f) && !INTENTIONALLY_NOT_MERGED.has(f));

assert.deepEqual(orphans, [],
    'Клиент сохраняет поля, которых сервер не знает при слиянии — они будут ТЕРЯТЬСЯ '
    + 'при каждой записи (так 30.07 пропало согласие у 1345 человек). '
    + 'Добавь обработку в server/api/src/state-merge.js либо, если поле намеренно '
    + `не сливается, внеси его в INTENTIONALLY_NOT_MERGED с объяснением. Осиротевшие: ${orphans.join(', ')}`);

// ─── Обратная проверка: исключения не должны протухать ───────────────────────
// Если поле убрали из SAVE_FIELDS, оно не должно навечно оставаться в списке
// исключений — иначе список превратится в свалку, и следующий человек не поймёт,
// что здесь правда, а что мусор.
const staleExceptions = [...INTENTIONALLY_NOT_MERGED].filter(f => !clientFields.includes(f));
assert.deepEqual(staleExceptions, [],
    `В INTENTIONALLY_NOT_MERGED остались поля, которых клиент уже не сохраняет: ${staleExceptions.join(', ')}. Убери их.`);

// ─── Поля, потеря которых уже стоила инцидента ───────────────────────────────
// Именные проверки: эти три пропадали в бою, и их обработка обязана существовать
// адресно, а не «случайно попасть» в общий разбор.
for (const field of ['consent', 'examSolved', 'timeByTask']) {
    assert.ok(serverKnows.has(field),
        `Сервер перестал обрабатывать '${field}' — ровно это поле терялось в инциденте 30.07.2026`);
}

console.log(`state-fields-contract: ok (клиент сохраняет ${clientFields.length} полей, `
    + `осознанных исключений ${INTENTIONALLY_NOT_MERGED.size})`);
