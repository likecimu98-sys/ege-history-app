'use strict';

const fs = require('fs');
const path = require('path');

const workDir = path.join(__dirname, 'output', '_answer-work');
const registry = JSON.parse(fs.readFileSync(path.join(workDir, 'missing-answers.json'), 'utf8'));
const answersFile = path.join(workDir, 'answers.json');
const answerData = JSON.parse(fs.readFileSync(answersFile, 'utf8'));

const candidates = {
  '6054A0': { answer: 'Иван Грозный', confidence: 'high', note: 'Ливонская война.' },
  'B8C9B9': { answer: 'Псков', confidence: 'high' },
  'A2B32E': { answer: 'Везенберг', confidence: 'high' },
  'F67C15': { answer: 'Пётр Первый', confidence: 'high', note: 'Цифрой 4 обозначен Ревель, вошедший в состав России по итогам Северной войны.' },
  'B7eB03': { answer: 'Иван Грозный', confidence: 'high' },
  '4B473D': { answer: 'Азов', confidence: 'high' },
  'DD01A0': { answer: 'Муром', confidence: 'high' },
  '273DDe': { answer: 'Алексей Михайлович', confidence: 'high' },
  'eF0cA3': { answer: 'Симбирск', confidence: 'high' },
  '3e7cFD': { answer: 'Астрахань', confidence: 'high' },
  '9D966B': { answer: 'шестнадцатом', confidence: 'high' },
  '8180D4': { answer: 'Ермак', confidence: 'high' },
  '41CA5B': { answer: 'Тагил', confidence: 'high' },
  '74B03B': { answer: 'семидесятых', confidence: 'high' },
  '790167': { answer: 'Таганрог', confidence: 'high' },
  '3DAAD9': { answer: 'Рябая Могила', confidence: 'high' },
  '391F16': { answer: 'Александр Первый', confidence: 'high' },
  '21D3e1': { answer: 'Второй мировой', confidence: 'high' },
  '8D8515': { answer: 'Финляндией', confidence: 'high' },
  '806927': { answer: 'Кишинёв', confidence: 'high' },
  '176CC9': { answer: 'ноябрь', confidence: 'high' },
  '1C4676': { answer: 'Сталинград', confidence: 'high' },
  '232930': { answer: 'Мелитополь', confidence: 'high' },
  'FBee4c': { answer: 'сорок втором', confidence: 'high' },
  '15A0A5': { answer: 'Сталинград', confidence: 'high' },
  '53420F': { answer: 'Демянск', confidence: 'high' },
  'e2D8c2': { answer: 'сорок пятом', confidence: 'high' },
  '84480e': { answer: 'Одер', confidence: 'high' },
  '3B4ee4': { answer: 'Пулав', confidence: 'high', note: 'На карте подписаны Пулавы; по правилу ФИПИ ответ заполняет пропуск в требуемой предложением форме: «от Пулав».' },
  'Dec2FD': { answer: 'сорок пятом', confidence: 'high' },
  '383471': { answer: 'Кёнигсберг', confidence: 'high' },
  '368B85': { answer: 'Неман', confidence: 'high' },
  'B90BDF': { answer: 'сорок первом', confidence: 'high' },
  'DEEE2D': { answer: 'Тула', confidence: 'high' },
  '45F8AF': { answer: 'Севастополь', confidence: 'high' },
  '2366AD': { answer: 'Ярослав Мудрый', confidence: 'high' },
  '34D8eA': { answer: 'Новгород', confidence: 'high' },
  '689BA7': { answer: 'Кама', confidence: 'high' },
  '42200D': { answer: 'десятого', confidence: 'high' },
  '787796': { answer: 'Олег', confidence: 'high' },
  '247894': { answer: 'Доростол', confidence: 'high' },
  'A273FD': { answer: 'Ярослав Мудрый', confidence: 'high' },
  'BB3CF2': { answer: 'печенеги', confidence: 'high' },
  '416AD7': { answer: 'волынян', confidence: 'high', note: 'Маршрут к Червенским городам проходит через земли волынян; по правилу ФИПИ записывается форма, требуемая пропуском: «земли волынян».' },
};

let merged = 0;
for (const [id, candidate] of Object.entries(candidates)) {
  const task = registry.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Задание ${id} отсутствует в реестре`);
  const existing = answerData.answers[id];
  if (existing && existing.answer.toLocaleLowerCase('ru') !== candidate.answer.toLocaleLowerCase('ru')) {
    throw new Error(`Конфликт ответа ${id}: «${existing.answer}» / «${candidate.answer}»`);
  }
  answerData.answers[id] = {
    ...(existing || {}),
    kim: task.kim,
    answer: candidate.answer,
    confidence: candidate.confidence || 'medium',
    verification: 'manual_map_review',
    groupId: task.groupId,
    ...(candidate.note ? { note: candidate.note } : {}),
  };
  merged += 1;
}

answerData.updatedAt = new Date().toISOString();
fs.writeFileSync(answersFile, JSON.stringify(answerData, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ merged, total: Object.keys(answerData.answers).length }, null, 2));
