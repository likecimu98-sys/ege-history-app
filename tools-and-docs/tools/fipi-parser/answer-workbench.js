'use strict';

// Формирует устойчивый реестр заданий части 1, для которых в локальной
// библиотеке пока нет ключа. Реестр нужен для ручного решения и последующей
// точечной проверки кандидатов через /api/check-answer.

const fs = require('fs');
const path = require('path');
const constructor = require('./constructor.js');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'output');
const WORK_DIR = path.join(OUT_DIR, '_answer-work');
const REGISTRY_FILE = path.join(WORK_DIR, 'missing-answers.json');
const ANSWERS_FILE = path.join(WORK_DIR, 'answers.json');

function readRawTask(cache, sourceDir, number) {
  if (!cache.has(sourceDir)) {
    const file = path.join(OUT_DIR, sourceDir, 'задания.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache.set(sourceDir, Array.isArray(data.tasks) ? data.tasks : []);
  }
  return cache.get(sourceDir).find((task) => task.number === number) || null;
}

function absoluteImages(task, raw) {
  const result = [];
  const add = (sourceDir, rel, role) => {
    if (!rel || /^(?:https?:|data:)/i.test(rel)) return;
    const absolute = path.resolve(OUT_DIR, sourceDir, rel);
    if (!fs.existsSync(absolute)) return;
    const key = `${role}|${absolute}`;
    if (result.some((item) => `${item.role}|${item.path}` === key)) return;
    result.push({ role, path: absolute });
  };

  for (const rel of raw.images || []) add(task.sourceDir, rel, 'question');
  const stimulusDir = raw.stimulusSourceDir || task.stimulusSourceDir || task.sourceDir;
  for (const rel of raw.stimulusImages || []) add(stimulusDir, rel, 'stimulus');
  return result;
}

function buildRegistry() {
  const library = constructor.scanLibrary(OUT_DIR);
  const selected = constructor.selectTasks(library, {
    exam: 'ege',
    subject: 'История',
    kims: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  });
  const rawCache = new Map();
  const tasks = [];

  for (const task of selected) {
    if (task.answer) continue;
    const raw = readRawTask(rawCache, task.sourceDir, task.number);
    if (!raw) throw new Error(`Не найден исходник задания ${task.number} (${task.sourceDir})`);
    tasks.push({
      id: task.number,
      guid: raw.guid || '',
      kim: task.kim,
      groupId: task.groupId || '',
      groupOrder: Number(task.groupOrder) || 0,
      sourceDir: task.sourceDir,
      answerType: task.answerType || '',
      answerForm: raw.answerForm || null,
      hint: task.hint || raw.hint || '',
      questionText: task.questionText || raw.questionText || '',
      elements: Array.isArray(raw.elements) ? raw.elements : [],
      stimulusText: task.stimulusText || raw.stimulusText || '',
      images: absoluteImages(task, raw),
    });
  }

  const counts = {};
  for (const task of tasks) counts[task.kim] = (counts[task.kim] || 0) + 1;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'Открытый банк заданий ФИПИ, ЕГЭ История, часть 1 (КИМ 2026)',
    total: tasks.length,
    counts,
    tasks,
  };
}

function ensureAnswerFile() {
  if (fs.existsSync(ANSWERS_FILE)) return;
  fs.writeFileSync(ANSWERS_FILE, JSON.stringify({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    answers: {},
  }, null, 2) + '\n', 'utf8');
}

function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const registry = buildRegistry();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  ensureAnswerFile();
  console.log(JSON.stringify({
    registry: REGISTRY_FILE,
    answers: ANSWERS_FILE,
    total: registry.total,
    counts: registry.counts,
  }, null, 2));
}

main();
