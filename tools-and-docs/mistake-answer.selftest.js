'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8');
const state = fs.readFileSync(path.join(root, 'state.js'), 'utf8');
const { mergeStateValues } = require('../server/api/src/state-merge');
const win = { acceptableAnswerSet: () => null, state: { mistakesPool: [] } };
const capture = new Function('window', app.slice(app.indexOf('function mistakeAnswerForRow('),
  app.indexOf('function checkAnswers(')) + ';return mistakeAnswerForRow;')(win);
const format = new Function(cloud.slice(cloud.indexOf('function studentMistakeReportLines('),
  cloud.indexOf('window.downloadStudentPDF =')) + ';return studentMistakeReportLines;')();
const recordCode = state.slice(state.indexOf('window.recordMistake ='), state.indexOf('// Убираем из пула ошибок'));
new Function('window', 'mistakeMatchesFact', recordCode)(win,
  (m, f, t) => m.task === t && m.fact.id === f.id);
const slot = (chosen, expected, index, revealed = false) => ({
  dataset: { expected }, closest: () => ({ cellIndex: index }),
  classList: { contains: c => revealed && c === 'revealed-slot' },
  querySelector: () => chosen == null ? null : { dataset: { pureText: chosen }, innerText: 'decorated' },
});
const row = (...slots) => ({ querySelectorAll: () => slots });
const fact = { id: 1, geo: 'Куликово поле', event: 'Куликовская битва', year: '1380' };
const answer = capture(row(slot('1240', '1380', 2), slot('Куликовская битва', 'Куликовская битва', 1)), fact, 'task4');
assert.deepEqual(answer.slots, [{ label: 'Дата', chosen: '1240', expected: '1380' }]);
win.recordMistake(fact, 'task4', answer);
win.recordMistake(fact, 'task4', { ...answer, at: answer.at + 1, slots: [{label:'Дата',chosen:'1480',expected:'1380'}] });
assert.equal(win.state.mistakesPool.length, 1);
assert.equal(win.state.mistakesPool[0].answer.slots[0].chosen, '1480');
const empty = capture(row(slot(null, '1380', 2)), fact, 'task4', 'revealed');
assert.equal(empty.slots[0].chosen, null);
assert.ok(format({fact,task:'task4',answer:empty}).some(x => x.text.includes('не ответил')));
assert.ok(format({fact,task:'task4'}).some(x => x.text === 'Ответ ученика не сохранён.'));
assert.ok(format({fact,task:'task4',answer:{source:'flashcard'}}).some(x => x.text.includes('«Забыл»')));
win.acceptableAnswerSet = () => new Set(['1380', '1380 г.']);
assert.deepEqual(capture(row(slot('1380 г.', '1380', 1)), fact, 'task1').slots, []);
assert.deepEqual(capture(row(slot('1380', '1380', 1, true)), fact, 'task1').slots, []);
const from = cloud.indexOf('            const mistakeByKey = new Map();');
const to = cloud.indexOf('// Союз mistakesPool', from);
const mergeClient = new Function('states', `const merged={}; ${cloud.slice(from,to)} return merged;`);
const old = { task:'task4', fact };
const newer = { task:'task4', fact, answer:{ ...answer, at:200 } };
const older = { task:'task4', fact, answer:{ ...empty, at:100 } };
for (const sequence of [[old,older,newer], [newer,old,older], [older,newer,old]]) {
  const states = sequence.map(m => ({ stats:{}, mistakesPool:[m] }));
  assert.deepEqual(mergeClient(states).mistakesPool, [newer]);
  assert.deepEqual(mergeStateValues(states).mistakesPool, [newer]);
}
console.log('mistake-answer: captured choices, omissions, alternative answers, legacy reports and both cloud merges OK');
