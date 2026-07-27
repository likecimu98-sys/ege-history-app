'use strict';

// Регрессия на права ЗАПИСИ в собственный документ ученика.
//
// Дыра, из-за которой это появилось (найдена 27.07.2026): `authorizeWrite`,
// case 'students' на свой документ отвечает безусловным `true`. Ученик мог одним
// PUT со своим же docId записать себе `premium: true`, а `quota.js` берёт признак
// подписки ровно оттуда — `student_profiles.data.premium || premiumAuto`. То есть
// серверный дневной лимит, ради которого делалась задача 1.2, обходился запросом
// из консоли, без DevTools и без правки JS. Любая биллинг-интеграция, сверяющаяся
// с тем же флагом, обходилась бы вместе с ним.
//
// ⚠️ Тест намеренно проверяет и ОБРАТНУЮ сторону: обычные поля прогресса должны
// проходить нетронутыми. Слишком широкий запрет здесь молча перестанет сохранять
// прогресс — это дороже самой дыры.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripPrivilegedFields, PRIVILEGED_STUDENT_FIELDS } = require('../src/store');
const { pool } = require('../src/db');

test.after(() => pool.end());

test('ученик не может выдать себе премиум записью в свой документ', () => {
  const patch = { totalSolved: 42, premium: true, premiumAuto: true };
  const result = stripPrivilegedFields(patch, true);
  assert.equal(result.premium, undefined);
  assert.equal(result.premiumAuto, undefined);
  assert.equal(result.totalSolved, 42, 'прогресс обязан пройти нетронутым');
});

test('бот и админ (не self-write) премиум ставить могут', () => {
  // internal-путь и админ до этой функции доходят с isSelfWrite = false:
  // именно так /premium в боте и token-endpoint отмечают подписчика клуба.
  const patch = { premium: true };
  assert.equal(stripPrivilegedFields(patch, false).premium, true);
});

test('обычная синхронизация прогресса не задевается вовсе', () => {
  // Полезная нагрузка syncProgressToCloud (cloud-sync.js): если хоть одно поле
  // отсюда исчезнет, прогресс перестанет сохраняться молча.
  const patch = {
    name: 'Ученик', nameUpdatedAt: 1, classCode: '7A', googleEmail: 'a@b.c',
    knownTgId: '1', knownGoogleId: '', totalSolved: 10, egePoints: 5,
    weeklyScore: 3, weeklyEgePoints: 2, weekStartStr: '2026-07-27',
    fullStateJson: '{}', lastActive: 1, duelRating: 1000, duelGames: 1,
    duelWins: 1, duelLosses: 0, tgId: '1', canonicalId: '1',
    identitySource: 'telegram', syncPin: '1234', _mergedInto: 'x', _mergedAt: 1,
  };
  const result = stripPrivilegedFields(patch, true);
  assert.deepEqual(result, patch);
  assert.equal(result, patch, 'нечего вырезать — объект должен вернуться тем же');
});

test('запрет узкий и осознанный', () => {
  // Список запрещённых, а не разрешённых: клиент пишет в свой профиль открытый и
  // растущий набор полей. Белый список, отставший на одно поле, тихо потерял бы
  // прогресс. Расширять этот список можно только полями, которые ДАЮТ ПРАВА.
  assert.deepEqual(PRIVILEGED_STUDENT_FIELDS, ['premium', 'premiumAuto', 'unlimited', 'role', 'isAdmin']);
});

test('исходный патч не мутируется', () => {
  const patch = { premium: true, totalSolved: 1 };
  stripPrivilegedFields(patch, true);
  assert.equal(patch.premium, true, 'вызывающий код полагается на свой объект');
});
