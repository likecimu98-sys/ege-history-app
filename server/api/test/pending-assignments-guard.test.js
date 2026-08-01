'use strict';

// 🔴 ЗАМОК НА ОЧИСТКУ ВЫДАЧИ ДЗ.
//
// Ученик забирает домашку из pendingAssignments и просит сервер снять её с документа.
// Если между «забрал» и «сохранил состояние» что-то сорвалось, задание исчезало
// НАВСЕГДА: в выдаче пусто, в состоянии пусто, повторить нечем. Так 01.08.2026
// потерялись задания у Султана, Веры и Тушинского Вора.
//
// Клиентские причины починены, но в тот же день по логам работали ШЕСТЬ версий
// клиента: кэш обновляется не у всех, и старая версия продолжает уничтожать выдачу.
// Поэтому правило живёт на сервере — там версия клиента не важна.

const test = require('node:test');
const assert = require('node:assert/strict');

// Подставная строка подключения: модуль хранилища требует её при загрузке, но сюда
// не ходит — весь разбор идёт на подставном клиенте ниже. Соединения не будет.
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const { guardPendingAssignments } = require('../src/store');

const REF = { collection: 'students', docId: '1639844841' };
const rec = id => ({ id, items: [{ task: 'task1', goal: 10 }] });
const removePatch = (...ids) => ({ pendingAssignments: { __vpsOp: 'arrayRemove', values: ids.map(rec) } });

// Подставной клиент БД: отдаёт состояние ученика так же, как настоящий.
const clientWithState = assignments => ({
  async query() {
    return { rows: [{ data: { fullStateJson: JSON.stringify({ stats: { assignments } }) } }] };
  },
});
const clientBroken = { async query() { throw new Error('соединение потеряно'); } };
const clientNoState = { async query() { return { rows: [] }; } };

test('снять из выдачи можно только то, что доехало в состояние', async () => {
  const client = clientWithState([{ id: 'a_landed', status: 'active' }]);
  const patch = await guardPendingAssignments(client, REF, removePatch('a_landed'), true);
  assert.equal(patch.pendingAssignments.values.length, 1);
  assert.equal(patch.pendingAssignments.values[0].id, 'a_landed');
});

test('НЕ доехавшее остаётся в выдаче — иначе домашка теряется навсегда', async () => {
  const client = clientWithState([{ id: 'a_other', status: 'done' }]);
  const patch = await guardPendingAssignments(client, REF, removePatch('a_lost'), true);
  assert.ok(!('pendingAssignments' in patch),
    'Очистка невзятого задания обязана быть отброшена целиком');
});

test('из смешанной пачки снимается только доехавшее', async () => {
  const client = clientWithState([{ id: 'a_ok', status: 'active' }]);
  const patch = await guardPendingAssignments(client, REF, removePatch('a_ok', 'a_lost'), true);
  assert.deepEqual(patch.pendingAssignments.values.map(v => v.id), ['a_ok']);
});

test('сданное и отозванное в состоянии тоже считаются доехавшими', async () => {
  for (const status of ['done', 'revoked']) {
    const client = clientWithState([{ id: 'a1', status }]);
    const patch = await guardPendingAssignments(client, REF, removePatch('a1'), true);
    assert.equal(patch.pendingAssignments.values.length, 1, `статус ${status} должен разрешать очистку`);
  }
});

test('состояние не прочиталось — очистку не разрешаем', async () => {
  const patch = await guardPendingAssignments(clientBroken, REF, removePatch('a1'), true);
  assert.ok(!('pendingAssignments' in patch), 'При сбое чтения состояния очистка обязана отбрасываться');
  // ⚠️ Именно отсутствие ключа, а не значение undefined: applyPatch обходит ключи
  // объекта и записал бы undefined ЗНАЧЕНИЕМ, стерев выдачу — то самое, от чего
  // этот замок защищает.
  assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'pendingAssignments'),
    'Ключ должен быть удалён, а не выставлен в undefined');
});

test('у ученика без состояния очистка не проходит', async () => {
  const patch = await guardPendingAssignments(clientNoState, REF, removePatch('a1'), true);
  assert.ok(!('pendingAssignments' in patch));
});

test('запись учителя замок не трогает', async () => {
  const original = removePatch('a_lost');
  const patch = await guardPendingAssignments(clientNoState, REF, original, false);
  assert.equal(patch, original, 'Выдача и отзыв со стороны учителя обязаны проходить как есть');
});

test('патчи без очистки выдачи проходят нетронутыми', async () => {
  const original = { pendingAssignments: { __vpsOp: 'arrayUnion', values: [rec('a1')] } };
  assert.equal(await guardPendingAssignments(clientNoState, REF, original, true), original,
    'Выдача нового ДЗ (arrayUnion) не должна попадать под замок');
  const plain = { name: 'Ученик' };
  assert.equal(await guardPendingAssignments(clientNoState, REF, plain, true), plain);
});
