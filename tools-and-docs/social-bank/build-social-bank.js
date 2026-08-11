'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse: parseHtml } = require('../tools/fipi-parser/node_modules/node-html-parser');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_ROOT = path.join(ROOT, 'tools-and-docs', 'tools', 'fipi-parser', 'output');
const APP_ROOT = path.join(ROOT, 'ege-social-app');
const IMAGE_ROOT = path.join(APP_ROOT, 'assets', 'questions');
const MANUAL_ANSWERS_FILE = path.join(__dirname, 'manual-answers.json');
const BANK_FILE = path.join(APP_ROOT, 'bank.js');

const EXPECTED = Object.freeze({
  total: 1058,
  images: 155,
  topics: 65,
  types: Object.freeze({ task1: 80, task12: 51, task13: 49, matching: 169, choice: 709 })
});

const BLOCKS = Object.freeze([
  { id: '1', name: 'Человек в обществе. Духовная культура', short: 'Человек и культура' },
  { id: '2', name: 'Экономическая жизнь общества', short: 'Экономика' },
  { id: '3', name: 'Социальная сфера', short: 'Социальные отношения' },
  { id: '4', name: 'Политическая сфера', short: 'Политика' },
  { id: '5', name: 'Правовое регулирование общественных отношений', short: 'Право' }
]);

// В выгрузке шесть почти одинаковых серий о социальном государстве помечены КЭС 5.4.
// Продуктовый манифест фиксирует 51 задание №12: один вариант остаётся в №12,
// ещё пять доступны в общем режиме выбора верных ответов. Все 1 058 заданий сохранены.
const TASK12_GENERAL_CHOICE_IDS = new Set(['923D4D', '449615', '931252', '1CF1C0', '20C869']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function cleanMultiline(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => cleanText(line))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function htmlText(html) {
  const prepared = String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|table|li)>/gi, '$&\n');
  return cleanMultiline(parseHtml(prepared).textContent);
}

function findSource() {
  const candidates = [];
  for (const entry of fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('Обществознание')) continue;
    const file = path.join(OUTPUT_ROOT, entry.name, 'задания.json');
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    if (data.total === EXPECTED.total && Array.isArray(data.tasks) && data.tasks.length === EXPECTED.total) {
      candidates.push({ dir: path.dirname(file), file, data });
    }
  }
  candidates.sort((a, b) => String(b.data.exportedAt || '').localeCompare(String(a.data.exportedAt || '')));
  if (!candidates.length) throw new Error(`Не найдена полная выгрузка обществознания на ${EXPECTED.total} заданий`);
  return candidates[0];
}

function kesTag(value) {
  const match = cleanText(value).match(/^(\d+\.\d+)\s+(.+)$/);
  if (!match) throw new Error(`Не удалось разобрать тему КЭС: ${value}`);
  return { code: match[1], name: match[2], blockId: match[1].split('.')[0] };
}

function selectedDigits(bitmask) {
  return String(bitmask || '').split('').map((value, index) => value === '1' ? String(index + 1) : '').join('');
}

function extractTask1(task) {
  const text = cleanMultiline(task.questionText);
  const firstOption = text.search(/(?:^|\n|\s)1\)\s*/);
  const instruction = text.indexOf('Найдите', Math.max(0, firstOption));
  if (firstOption < 0 || instruction < 0) throw new Error(`Не удалось отделить варианты задания №1 ${task.number}`);

  const optionBlock = text.slice(firstOption).split('Найдите')[0].trim().replace(/[.\s]+$/, '');
  const markers = [...optionBlock.matchAll(/([1-6])\)\s*/g)];
  const options = markers.map((marker, index) => {
    const start = marker.index + marker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : optionBlock.length;
    return {
      n: Number(marker[1]),
      text: cleanText(optionBlock.slice(start, end)).replace(/[;,.:\s]+$/, '')
    };
  });
  const tail = text.slice(instruction).replace(/\s*Ответ:\s*$/i, '').trim();
  const prompt = `${text.slice(0, firstOption).trim()}\n\n${tail}`;
  if (options.length !== 6 || options.some((item, index) => item.n !== index + 1 || !item.text)) {
    throw new Error(`Ожидалось шесть вариантов задания №1 ${task.number}`);
  }
  return { prompt, options };
}

function variantRows(task) {
  const root = parseHtml(String(task.variantsHtml || ''));
  const rows = root.querySelectorAll('tr').filter(row => {
    const className = row.getAttribute('class') || '';
    return /(?:^|\s)active-distractor(?:\s|$)/.test(className);
  });
  const values = rows.map((row, index) => ({ n: index + 1, text: cleanText(row.textContent) })).filter(item => item.text);
  if (values.length) return values;
  return (task.elements || []).map((item, index) => ({
    n: Number(item.n) || index + 1,
    text: cleanText(item.text)
  })).filter(item => item.text);
}

function matchingTargets(task, expectedCount) {
  const targets = [];
  let current = null;
  const lines = String(task.questionText || '').replace(/\r/g, '').split('\n').map(line => cleanText(line)).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([А-Е])\)\s*(.*)$/);
    if (match) {
      current = { label: match[1], text: cleanText(match[2]) };
      targets.push(current);
      continue;
    }
    if (/^\d+\)\s*/.test(line) || /^Запишите\b/i.test(line)) {
      current = null;
      continue;
    }
    if (current) current.text = cleanText(`${current.text} ${line}`);
  }
  if (targets.length !== expectedCount || targets.some(target => !target.text)) {
    throw new Error(`Не удалось выделить ${expectedCount} позиций соответствия ${task.number}: ${targets.length}`);
  }
  return targets;
}

function matchingPrompt(task) {
  const root = parseHtml(String(task.questionHtml || ''));
  const firstParagraph = root.querySelector('p');
  const text = firstParagraph ? cleanText(firstParagraph.textContent) : '';
  if (text) return text;
  return cleanMultiline(task.questionText).split(/\n(?:[А-Е]\)|[А-ЯЁ ]{5,}\s+[А-ЯЁ ]{5,})/)[0].trim();
}

function resolveImage(sourceDir, ref) {
  const relative = String(ref || '').replace(/[\\/]+/g, path.sep);
  const candidates = [
    path.join(sourceDir, relative),
    path.join(sourceDir, 'images', path.basename(relative))
  ];
  return candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

function copyImages(task, sourceDir) {
  const output = [];
  const seen = new Set();
  for (const [index, ref] of (task.images || []).entries()) {
    const source = resolveImage(sourceDir, ref);
    if (!source) throw new Error(`Не найдено изображение ${ref} для ${task.number}`);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    if (seen.has(digest)) continue;
    seen.add(digest);
    const ext = (path.extname(source) || '.jpg').toLowerCase();
    const name = `${task.number}-${index + 1}${ext}`;
    const target = path.join(IMAGE_ROOT, name);
    fs.copyFileSync(source, target);
    output.push(`assets/questions/${name}`);
  }
  return output;
}

function classify(task, topicCodes) {
  const kind = task.answerForm && task.answerForm.kind;
  if (kind === 'text') return 'task1';
  if (kind === 'selects' && topicCodes.some(code => code === '4.5' || code === '4.6')) return 'task13';
  if (kind === 'selects') return 'matching';
  if (kind === 'bitmask' && topicCodes.includes('5.4') && !TASK12_GENERAL_CHOICE_IDS.has(task.number)) return 'task12';
  if (kind === 'bitmask') return 'choice';
  throw new Error(`Неизвестный формат ответа ${task.number}: ${kind}`);
}

function buildTask(rawTask, sourceDir, manualAnswers) {
  const tags = (rawTask.kes || []).map(kesTag);
  const topicCodes = [...new Set(tags.map(tag => tag.code))];
  const blockIds = [...new Set(tags.map(tag => tag.blockId))];
  const type = classify(rawTask, topicCodes);
  const manual = manualAnswers[rawTask.number];
  let answer = manual || rawTask.answer || '';
  if (rawTask.answerForm.kind === 'bitmask') answer = selectedDigits(answer);
  answer = String(answer).replace(/\s+/g, '').trim();
  if (!answer) throw new Error(`Нет проверяемого ответа для ${rawTask.number}`);

  const task = {
    id: rawTask.number,
    type,
    blockIds,
    topicCodes,
    prompt: '',
    options: [],
    answer
  };

  if (type === 'task1') {
    const parsed = extractTask1(rawTask);
    task.prompt = parsed.prompt;
    task.options = parsed.options;
  } else if (type === 'matching' || type === 'task13') {
    task.prompt = matchingPrompt(rawTask);
    task.options = (rawTask.elements || []).map((item, index) => ({
      n: Number(item.n) || index + 1,
      text: cleanText(item.text)
    })).filter(item => item.text);
    task.targets = matchingTargets(rawTask, answer.length);
  } else {
    task.prompt = htmlText(rawTask.questionHtml) || cleanMultiline(rawTask.questionText);
    task.options = variantRows(rawTask);
  }

  const images = copyImages(rawTask, sourceDir);
  if (images.length) task.images = images;
  return task;
}

function validate(tasks, topics, manualAnswers) {
  if (tasks.length !== EXPECTED.total) throw new Error(`Ожидалось ${EXPECTED.total} заданий, получено ${tasks.length}`);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('В банке есть повторяющиеся стабильные ID');
  if (topics.length !== EXPECTED.topics) throw new Error(`Ожидалось ${EXPECTED.topics} тем КЭС, получено ${topics.length}`);

  const counts = {};
  for (const task of tasks) {
    counts[task.type] = (counts[task.type] || 0) + 1;
    if (!task.answer) throw new Error(`Пустой ответ ${task.id}`);
    if (!task.prompt || !task.options.length) throw new Error(`Неполная карточка ${task.id}`);
    if (task.type === 'task1') {
      if (task.options.length !== 6 || !/^\d{2}$/.test(task.answer)) throw new Error(`Некорректное задание №1 ${task.id}`);
    } else if (task.type === 'matching' || task.type === 'task13') {
      if (!task.targets || task.targets.length !== task.answer.length) throw new Error(`Некорректное соответствие ${task.id}`);
      if ([...task.answer].some(value => !task.options.some(option => String(option.n) === value))) {
        throw new Error(`Ответ соответствия выходит за варианты ${task.id}`);
      }
    } else if ([...task.answer].some(value => !task.options.some(option => String(option.n) === value))) {
      throw new Error(`Ответ выбора выходит за варианты ${task.id}`);
    }
    if (task.options.some(option => !option.text || option.text.length < 2)) throw new Error(`Битый вариант ответа ${task.id}`);
  }

  for (const [type, expected] of Object.entries(EXPECTED.types)) {
    if (counts[type] !== expected) throw new Error(`Тип ${type}: ожидалось ${expected}, получено ${counts[type] || 0}`);
  }
  if (Object.keys(manualAnswers).length !== 85) throw new Error(`Ожидалось 85 ручных ключей, получено ${Object.keys(manualAnswers).length}`);

  const imageFiles = fs.readdirSync(IMAGE_ROOT).filter(name => /\.(?:jpe?g|png|webp)$/i.test(name));
  const referenced = new Set(tasks.flatMap(task => task.images || []).map(ref => path.basename(ref)));
  if (referenced.size !== EXPECTED.images) throw new Error(`Ожидалось ${EXPECTED.images} изображений в банке, получено ${referenced.size}`);
  for (const name of referenced) {
    const file = path.join(IMAGE_ROOT, name);
    if (!fs.existsSync(file) || fs.statSync(file).size < 100) throw new Error(`Недоступно изображение ${name}`);
  }
  const extras = imageFiles.filter(name => !referenced.has(name));
  if (extras.length) throw new Error(`В каталоге изображений есть устаревшие файлы: ${extras.slice(0, 5).join(', ')}`);
}

function main() {
  const source = findSource();
  const manualAnswers = readJson(MANUAL_ANSWERS_FILE).answers || {};
  fs.mkdirSync(APP_ROOT, { recursive: true });
  fs.mkdirSync(IMAGE_ROOT, { recursive: true });

  const tasks = source.data.tasks.map(task => buildTask(task, source.dir, manualAnswers));
  const topicMap = new Map();
  for (const rawTask of source.data.tasks) {
    for (const rawTag of rawTask.kes || []) {
      const tag = kesTag(rawTag);
      const existing = topicMap.get(tag.code);
      if (existing && existing.name !== tag.name) throw new Error(`Разные названия темы ${tag.code}`);
      topicMap.set(tag.code, tag);
    }
  }
  const topics = [...topicMap.values()].sort((a, b) => a.code.localeCompare(b.code, 'ru', { numeric: true }));
  validate(tasks, topics, manualAnswers);

  const bank = {
    version: '2026-08-11.1',
    source: {
      name: 'Открытый банк заданий ФИПИ',
      url: 'https://fipi.ru/ege/otkrytyy-bank-zadaniy-ege',
      exportedAt: source.data.exportedAt || '',
      taskCount: tasks.length,
      imageCount: EXPECTED.images
    },
    blocks: BLOCKS,
    topics,
    tasks
  };
  fs.writeFileSync(BANK_FILE, `window.EGE_SOCIAL_BANK=${JSON.stringify(bank)};\n`, 'utf8');

  const counts = tasks.reduce((result, task) => {
    result[task.type] = (result[task.type] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({ source: path.relative(ROOT, source.file), total: tasks.length, topics: topics.length, images: EXPECTED.images, types: counts }, null, 2));
}

main();
