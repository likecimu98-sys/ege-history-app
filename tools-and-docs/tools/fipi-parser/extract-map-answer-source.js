'use strict';

const fs = require('fs');
const path = require('path');

const workDir = path.join(__dirname, 'output', '_answer-work');
const registry = JSON.parse(fs.readFileSync(path.join(workDir, 'missing-answers.json'), 'utf8'));
const task4Mode = process.argv.includes('--task4');
const html = fs.readFileSync(path.join(workDir, task4Mode ? 'gdzotvet-task4.html' : 'gdzotvet-maps.html'), 'utf8');

function cleanAnswer(value) {
  return value
    .split(/<\/p>/i)[0]
    .split(/<br\s*\/?\s*>/i)[0]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&laquo;|&raquo;/g, '"')
    .trim();
}

const sourceAnswers = new Map();
const answerPattern = /<div class="gdzotvet"><details[^>]*>\s*<summary>Ответ:<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details><\/div>\s*<p align="right">Номер:\s*(?:<span[^>]*>)?([A-Za-z0-9]+)(?:<\/span>)?/g;
for (const match of html.matchAll(answerPattern)) {
  sourceAnswers.set(match[2], cleanAnswer(match[1]));
}

const tasks = registry.tasks.filter((task) => task4Mode ? task.kim === 4 : task.kim >= 9 && task.kim <= 11);
const found = [];
const missing = [];
for (const task of tasks) {
  const answer = sourceAnswers.get(task.id) || '';
  if (answer && answer !== '...' && answer !== '***') {
    found.push({ groupId: task.groupId, kim: task.kim, id: task.id, answer });
  } else {
    missing.push({ groupId: task.groupId, kim: task.kim, id: task.id });
  }
}

const result = {
  source: task4Mode
    ? 'gdzotvet.ru/oge-ege/istoriya/896-zadaniya-ege-istorii-otvetami-tablitsy-bank-fipi'
    : 'gdzotvet.ru/oge-ege/istoriya/902-zadaniya-ege-istorii-otvetami-karty-bank-fipi',
  extractedAt: new Date().toISOString(),
  found,
  missing,
};

const outputFile = path.join(workDir, task4Mode ? 'source-task4-answers.json' : 'source-map-answers.json');
fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n', 'utf8');

let merged = 0;
if (process.argv.includes('--merge')) {
  const answersFile = path.join(workDir, 'answers.json');
  const answerData = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  for (const item of found) {
    const existing = answerData.answers[item.id];
    if (existing
      && existing.verification !== 'verified_secondary_source'
      && existing.answer.toLocaleLowerCase('ru') !== item.answer.toLocaleLowerCase('ru')) {
      throw new Error(`Конфликт ответа ${item.id}: «${existing.answer}» / «${item.answer}»`);
    }
    answerData.answers[item.id] = {
      ...(existing || {}),
      kim: item.kim,
      answer: item.answer,
      confidence: 'high',
      verification: existing?.verification === 'verified_official_methodical_materials'
        ? existing.verification
        : 'verified_secondary_source',
      groupId: item.groupId,
    };
    merged += 1;
  }
  answerData.updatedAt = new Date().toISOString();
  fs.writeFileSync(answersFile, JSON.stringify(answerData, null, 2) + '\n', 'utf8');
}

console.log(JSON.stringify({ outputFile, found: found.length, missing: missing.length, merged }, null, 2));
