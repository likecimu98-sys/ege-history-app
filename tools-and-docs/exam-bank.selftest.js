'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const bank = require('../exam-bank.generated.js');
const scoring = require('../exam-scoring.js');

scoring.setKnownTextAnswers(bank.tasks
  .filter(task => task.kim >= 8 && task.kim <= 11)
  .flatMap(task => task.acceptedAnswers || [task.answer]));

assert.strictEqual(bank.tasks.length, 843);
assert.strictEqual(bank.mapGroupCount, 64);
assert.strictEqual(bank.schemaVersion, 2);
assert.strictEqual(bank.version, 'fipi-history-2026-07-22-3');
for (let kim = 1; kim <= 12; kim++) assert.ok(bank.counts[kim] > 0, `пустой пул ${kim}`);
assert.strictEqual(new Set(bank.tasks.map(task => task.id)).size, bank.tasks.length);
const bankSource = fs.readFileSync(path.join(__dirname, '..', 'exam-bank.generated.js'));
assert.ok(bankSource.length < 900 * 1024, `банк снова раздулся: ${bankSource.length} байт`);
assert.ok(zlib.gzipSync(bankSource).length < 150 * 1024, 'сжатый банк должен оставаться лёгким');

const groups = new Map();
bank.tasks.filter(task => task.kim >= 9).forEach(task => {
  if (!groups.has(task.groupId)) groups.set(task.groupId, []);
  groups.get(task.groupId).push(task);
});
assert.strictEqual(groups.size, 64);
for (const members of groups.values()) {
  assert.deepStrictEqual(members.map(task => task.kim).sort((a, b) => a - b), [9, 10, 11, 12]);
  assert.strictEqual(new Set(members.map(task => task.image)).size, 1);
}

for (const task of bank.tasks) {
  assert.ok(task.answer, `нет ответа ${task.id}`);
  assert.ok(!Object.prototype.hasOwnProperty.call(task, 'html'), `тяжёлый HTML остался в ${task.id}`);
  if ([1, 3, 5, 7].includes(task.kim)) {
    assert.strictEqual(task.targets.length, 4, `неверное число позиций ${task.id}`);
    task.targets.forEach(target => assert.ok(target.label && target.text, `пустая позиция ${task.id}`));
  } else if (task.kim === 4) {
    assert.strictEqual(task.grid.length, 4, `неверное число строк ${task.id}`);
    assert.deepStrictEqual(task.grid.flat().map(cell => cell.slot).filter(Number.isInteger).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  } else if (task.kim !== 2) {
    assert.ok(String(task.question || '').trim().length >= 12, `пустое условие ${task.id}`);
    assert.ok(!/<script\b|javascript\s*:/i.test(task.question), `небезопасный текст ${task.id}`);
  }
  if (task.image) {
    const imageFile = path.join(__dirname, '..', task.image);
    assert.ok(fs.existsSync(imageFile), `нет картинки ${task.image}`);
    assert.ok(fs.statSync(imageFile).size > 20 * 1024, `подозрительно маленькое изображение ${task.image} (${task.id})`);
  }
  if ([2, 6, 12].includes(task.kim)) assert.ok(task.elements.length >= 3, `нет вариантов ${task.id}`);
  if ([1, 2, 3, 4, 5, 6, 7, 12].includes(task.kim)) {
    const optionIds = task.elements.map(item => String(item.n));
    assert.strictEqual(new Set(optionIds).size, optionIds.length, `повтор вариантов ${task.id}`);
    scoring.normalizeSymbols(task.answer).forEach(symbol => assert.ok(optionIds.includes(symbol), `ответ вне вариантов ${task.id}: ${symbol}`));
  }
  const perfect = scoring.scoreTask(task, task.answer);
  assert.strictEqual(perfect.points, perfect.max, `эталон не даёт максимум ${task.id}`);
  (task.acceptedAnswers || [task.answer]).forEach(answer => assert.strictEqual(scoring.scoreTask(task, answer).points, perfect.max, `допустимый ответ не принят ${task.id}: ${answer}`));
}

for (const task of bank.tasks.filter(task => [1, 3, 5, 7].includes(task.kim))) {
  assert.deepStrictEqual(task.targets.map(target => target.label), ['А', 'Б', 'В', 'Г']);
}

const expectedAnswerLengths = { 1: 4, 2: 3, 3: 4, 4: 6, 5: 4, 7: 4 };
for (const [kim, length] of Object.entries(expectedAnswerLengths)) {
  bank.tasks.filter(task => task.kim === Number(kim)).forEach(task => {
    assert.strictEqual(scoring.normalizeSymbols(task.answer).length, length, `неверная длина ответа ${task.id}`);
  });
}

const variant = [];
for (let kim = 1; kim <= 8; kim++) variant.push(bank.tasks.find(task => task.kim === kim));
variant.push(...groups.values().next().value.sort((a, b) => a.kim - b.kim));
const perfectAnswers = Object.fromEntries(variant.map(task => [task.id, task.answer]));
assert.strictEqual(scoring.scoreVariant(variant, perfectAnswers).total, 20);

const volhynians = bank.tasks.find(task => task.id === '416AD7');
assert.ok(volhynians);
assert.strictEqual(volhynians.answer, 'волыняне');
assert.strictEqual(scoring.scoreTask(volhynians, 'волынян').points, 1);
assert.strictEqual(scoring.scoreTask(volhynians, 'волынян').matchType, 'typo');

console.log('exam-bank: ok');
