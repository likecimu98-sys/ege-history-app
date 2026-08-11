'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [federalSource, authoritiesSource] = process.argv.slice(2);
if (!federalSource || !authoritiesSource) {
  throw new Error('Usage: node import-task13-trainers.js <federal-index.html> <authorities-index.html>');
}

function decodeString(value) {
  return JSON.parse(`"${value}"`);
}

function extractCards(filePath, prefix) {
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf('const dbQuestions = [');
  const end = source.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error(`dbQuestions not found in ${filePath}`);
  const block = source.slice(start, end + 2);
  const cards = [];
  const pattern = /\{\s*id:\s*(\d+),\s*text:\s*"((?:\\.|[^"\\])*)",\s*type:\s*"([a-z]+)"\s*\}/g;
  let match;
  while ((match = pattern.exec(block))) {
    cards.push({ id: `${prefix}-${match[1]}`, text: decodeString(match[2]), answer: match[3] });
  }
  if (!cards.length) throw new Error(`No cards parsed from ${filePath}`);
  return {
    cards,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    contentSha256: crypto.createHash('sha256').update(JSON.stringify(cards)).digest('hex')
  };
}

const federal = extractCards(federalSource, 'federal');
const authorities = extractCards(authoritiesSource, 'authority');

if (federal.cards.length !== 51) throw new Error(`Expected 51 federal cards, found ${federal.cards.length}`);
if (authorities.cards.length !== 78) throw new Error(`Expected 78 authority cards, found ${authorities.cards.length}`);

const data = {
  version: 1,
  trainers: [
    {
      id: 'federal',
      title: 'Ведение РФ и совместное ведение',
      shortTitle: 'Статьи 71 и 72',
      description: 'Различайте исключительное ведение Российской Федерации и совместное ведение РФ и субъектов.',
      sourceSha256: federal.sourceSha256,
      contentSha256: federal.contentSha256,
      mechanics: {
        initialTarget: 2,
        mistakeTarget: 3,
        mistakesBeforePenalty: 2,
        reinsertDistance: 2,
        revealCorrectOnMistake: false,
        correctDelayMs: 600,
        wrongDelayMs: 1000
      },
      answers: [
        { id: 'rf', label: 'Ведение Российской Федерации', hint: 'Статья 71' },
        { id: 'joint', label: 'Совместное ведение РФ и субъектов', hint: 'Статья 72' }
      ],
      cards: federal.cards
    },
    {
      id: 'authorities',
      title: 'Полномочия органов власти',
      shortTitle: 'Кто это решает?',
      description: 'Распределяйте полномочия между Президентом, Правительством, палатами парламента и высшими судами.',
      sourceSha256: authorities.sourceSha256,
      contentSha256: authorities.contentSha256,
      mechanics: {
        initialTarget: 2,
        mistakeTarget: 3,
        mistakesBeforePenalty: 1,
        reinsertDistance: 3,
        revealCorrectOnMistake: true,
        correctDelayMs: 600,
        wrongDelayMs: 1800
      },
      answers: [
        { id: 'p', label: 'Президент РФ', hint: 'П' },
        { id: 'pr', label: 'Правительство РФ', hint: 'ПР' },
        { id: 'sf', label: 'Совет Федерации', hint: 'СФ' },
        { id: 'gd', label: 'Государственная Дума', hint: 'ГД' },
        { id: 'ks', label: 'Конституционный Суд РФ', hint: 'КС' },
        { id: 'vs', label: 'Верховный Суд РФ', hint: 'ВС' }
      ],
      cards: authorities.cards
    }
  ]
};

const output = path.resolve(__dirname, '../../ege-social-app/task13-trainers.js');
const json = JSON.stringify(data);
const body = `(function(root){'use strict';root.EGE_SOCIAL_TASK13_TRAINERS=Object.freeze(${json});})(typeof window!=='undefined'?window:globalThis);\n`;
fs.writeFileSync(output, body, 'utf8');
console.log(`task13 trainers: ${federal.cards.length} + ${authorities.cards.length} cards -> ${output}`);
console.log(`federal content sha256: ${federal.contentSha256}`);
console.log(`authorities content sha256: ${authorities.contentSha256}`);
