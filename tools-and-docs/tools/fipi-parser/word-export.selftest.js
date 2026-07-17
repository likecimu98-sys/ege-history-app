'use strict';

const assert = require('assert');
const path = require('path');
const { renderWordDocument } = require('./word-export.js');

async function main() {
  const tasks = [
    {
      kim: 9,
      group: 'работа с исторической картой',
      groupId: 'map-1',
      groupKind: 'history-ege-map-9-12',
      stimulusHtml: '<p><strong>Общий материал</strong> к заданиям 9-12.</p>',
      questionHtml: '<p>Укажите век, когда произошли события, отраженные на схеме.</p>',
      variantsHtml: '',
      answer: 'XVII',
      answerText: '',
      images: [],
      stimulusImages: [],
      sourceDir: '',
    },
    {
      kim: 10,
      group: 'работа с исторической картой',
      groupId: 'map-1',
      groupKind: 'history-ege-map-9-12',
      questionHtml: '<p>Назовите город, обозначенный цифрой 1.</p><table border="1"><tr><th>Цифра</th><th>Ответ</th></tr><tr><td>1</td><td>________________</td></tr></table>',
      variantsHtml: '<ol><li>Москва</li><li>Казань</li></ol>',
      answer: 'Москва',
      answerText: '',
      images: [],
      stimulusImages: [],
      sourceDir: '',
    },
  ];

  const buffer = await renderWordDocument(tasks, {
    title: 'Тренировочная работа',
    subtitle: 'История. ЕГЭ 2026',
    answers: 'end',
  }, path.resolve(__dirname, 'output'));

  assert(Buffer.isBuffer(buffer));
  assert(buffer.length > 10_000, `DOCX is unexpectedly small: ${buffer.length}`);
  assert.strictEqual(buffer.subarray(0, 2).toString('ascii'), 'PK');
  console.log(`word export selftest ok (${buffer.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
