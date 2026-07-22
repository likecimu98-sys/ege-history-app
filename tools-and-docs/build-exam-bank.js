/*
 * Одноразовый адаптер выгрузки ФИПИ для режима «Пробник 1–12».
 * Парсер не меняет: читает его готовые JSON, объединяет найденные ответы,
 * выносит изображения в assets и создаёт лениво загружаемый банк приложения.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse: parseHtml } = require('./tools/fipi-parser/node_modules/node-html-parser');
const constructor = require('./tools/fipi-parser/constructor.js');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(__dirname, 'tools', 'fipi-parser', 'output');
const ANSWERS_FILE = path.join(OUTPUT_ROOT, '_answer-work', 'answers.json');
const BANK_FILE = path.join(ROOT, 'exam-bank.generated.js');
const ASSET_DIR = path.join(ROOT, 'assets', 'mock-exam');
const EXPECTED_COUNTS = { 1: 99, 2: 104, 3: 74, 4: 42, 5: 127, 6: 64, 7: 54, 8: 23, 9: 64, 10: 64, 11: 64, 12: 64 };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadRawTasks() {
  const byId = new Map();
  const dirs = fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory());
  dirs.sort((a, b) => {
    const af = path.join(OUTPUT_ROOT, a.name, 'банк.json');
    const bf = path.join(OUTPUT_ROOT, b.name, 'банк.json');
    const at = fs.existsSync(af) ? fs.statSync(af).mtimeMs : 0;
    const bt = fs.existsSync(bf) ? fs.statSync(bf).mtimeMs : 0;
    return at - bt;
  });
  for (const entry of dirs) {
    const file = path.join(OUTPUT_ROOT, entry.name, 'банк.json');
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    for (const task of data.tasks || []) {
      if (task && task.number) byId.set(task.number, { ...task, sourceDir: entry.name });
    }
  }
  return byId;
}

function selectedDigits(bitmask) {
  return String(bitmask).split('').map((value, index) => value === '1' ? String(index + 1) : '').join('');
}

function cleanAnswer(task, external) {
  let answer = task.answer || (external && external.answer) || '';
  answer = String(answer).trim();
  if ([6, 12].includes(task.kim) && /^[01]+$/.test(answer)) answer = selectedDigits(answer);
  return answer;
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed)\b[^>]*\/?\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function cleanText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMatchingTargets(prompt, taskId) {
  const targets = [];
  let current = null;
  const lines = String(prompt || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([А-Е])\)\s*(.*)$/);
    if (match) {
      current = { label: match[1], text: match[2] };
      targets.push(current);
      continue;
    }
    if (/^\d+\)\s*/.test(line) || /^Запишите в таблицу/i.test(line)) {
      current = null;
      continue;
    }
    if (current) current.text += `${current.text ? ' ' : ''}${line}`;
  }
  targets.forEach(target => { target.text = cleanText(target.text); });
  if (targets.length !== 4 || targets.some(target => !target.text)) {
    throw new Error(`Не удалось выделить 4 позиции задания ${taskId}`);
  }
  return targets;
}

function nearestTable(node) {
  for (let parent = node && node.parentNode; parent; parent = parent.parentNode) {
    if (parent.tagName === 'TABLE') return parent;
  }
  return null;
}

function extractTask4Grid(html, taskId) {
  const root = parseHtml(sanitizeHtml(html));
  for (const table of root.querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr').filter(row => nearestTable(row) === table);
    const wideRows = rows.filter(row => row.childNodes.filter(node => node.tagName === 'TD').length >= 3);
    const text = cleanText(table.textContent).toLocaleLowerCase('ru-RU');
    if (wideRows.length < 2 || !text.includes('географический объект') || !text.includes('событие') || !text.includes('время')) continue;
    const grid = wideRows.slice(1).map(row => row.childNodes.filter(node => node.tagName === 'TD').slice(0, 3).map(cell => {
      const value = cleanText(cell.textContent);
      const marker = value.match(/_+\s*\(([А-Е])\)/) || value.match(/^\(([А-Е])\)$/);
      return marker ? { slot: 'АБВГДЕ'.indexOf(marker[1]) } : { text: value };
    }));
    const slots = grid.flat().map(cell => cell.slot).filter(Number.isInteger).sort((a, b) => a - b);
    if (grid.length === 4 && grid.every(row => row.length === 3) && slots.join(',') === '0,1,2,3,4,5') return grid;
  }
  throw new Error(`Не удалось разобрать таблицу задания 4: ${taskId}`);
}

function compactQuestion(prompt, elements) {
  let question = String(prompt || '').replace(/\r/g, '').trim();
  if (elements.length) {
    const firstOption = question.match(/(?:^|\n)\s*1\)\s+/);
    if (firstOption) question = question.slice(0, firstOption.index).trim();
  }
  return question;
}

function resolveImage(task, ref) {
  if (!ref || /^(?:data:|https?:)/i.test(ref)) return null;
  const normalized = String(ref).replace(/[\\/]+/g, path.sep);
  const sourceDir = task.sourceDir || '';
  const candidates = [
    path.join(OUTPUT_ROOT, sourceDir, normalized),
    path.join(OUTPUT_ROOT, sourceDir, 'images', path.basename(normalized))
  ];
  return candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

function copyImage(task, ref) {
  const source = resolveImage(task, ref);
  if (!source) throw new Error(`Не найдено изображение ${ref} для ${task.number}`);
  const buffer = fs.readFileSync(source);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 20);
  const ext = (path.extname(source) || '.jpg').toLowerCase();
  const name = `${hash}${ext}`;
  const target = path.join(ASSET_DIR, name);
  if (!fs.existsSync(target)) fs.writeFileSync(target, buffer);
  return `assets/mock-exam/${name}`;
}

function bestImageRef(task, refs) {
  const candidates = [...new Set((refs || []).filter(Boolean))]
    .map(ref => ({ ref, file: resolveImage(task, ref) }))
    .filter(item => item.file)
    .map(item => ({ ...item, bytes: fs.statSync(item.file).size }));
  if (!candidates.length) return '';
  // В заданиях с картой внутри формулировки встречаются миниатюрные изображения
  // стрелок и условных обозначений. Карта — самый крупный файл общего материала.
  candidates.sort((a, b) => b.bytes - a.bytes);
  return candidates[0].ref;
}

function build() {
  fs.mkdirSync(ASSET_DIR, { recursive: true });
  const externalAnswers = readJson(ANSWERS_FILE).answers || {};
  const rawById = loadRawTasks();
  const library = constructor.scanLibrary(OUTPUT_ROOT);
  const selected = constructor.selectTasks(library, {
    exam: 'ege', subject: 'История',
    kims: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    outdated: 'hide'
  });

  const tasks = selected.map(task => {
    const raw = rawById.get(task.number) || {};
    const sourceTask = { ...task, sourceDir: task.sourceDir || raw.sourceDir };
    const external = externalAnswers[task.number] || null;
    const answer = cleanAnswer(task, external);
    if (!answer) throw new Error(`Нет ответа: КИМ ${task.kim}, ${task.number}`);

    const refs = [...(task.images || []), ...(raw.images || [])];
    let image = '';
    if (refs.length && [8, 9, 10, 11, 12].includes(task.kim)) {
      const imageRef = bestImageRef(sourceTask, refs);
      if (imageRef) image = copyImage(sourceTask, imageRef);
    }

    const elements = (raw.elements || []).map((item, index) => ({
      n: Number(item.n) || index + 1,
      text: String(item.text || '').trim()
    })).filter(item => item.text);

    const acceptedAnswers = Array.isArray(external && external.acceptedAnswers)
      ? external.acceptedAnswers.map(String)
      : [answer];
    const distinctAnswers = [...new Set(acceptedAnswers.map(value => String(value).trim()).filter(value => value && value !== answer))];
    const prompt = String(raw.prompt || task.questionText || task.questionHtml || '').trim();
    const compact = {
      id: task.number,
      kim: task.kim,
      elements,
      answer
    };
    if (task.groupId) compact.groupId = task.groupId;
    if (task.groupOrder) compact.groupOrder = task.groupOrder;
    if (image) compact.image = image;
    if (distinctAnswers.length) compact.acceptedAnswers = [answer, ...distinctAnswers];
    if ([1, 3, 5, 7].includes(task.kim)) compact.targets = extractMatchingTargets(prompt, task.number);
    else if (task.kim === 4) compact.grid = extractTask4Grid(task.questionHtml || '', task.number);
    else if (task.kim !== 2) compact.question = compactQuestion(prompt, elements);
    return compact;
  });

  const counts = {};
  tasks.forEach(task => { counts[task.kim] = (counts[task.kim] || 0) + 1; });
  for (const [kim, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[kim] !== expected) throw new Error(`КИМ ${kim}: ожидалось ${expected}, получено ${counts[kim] || 0}`);
  }
  if (tasks.length !== 843) throw new Error(`Ожидалось 843 задания, получено ${tasks.length}`);
  if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('В банке есть повторяющиеся id');

  const groups = new Map();
  tasks.filter(task => task.kim >= 9).forEach(task => {
    if (!task.groupId) throw new Error(`Карта без groupId: ${task.id}`);
    if (!groups.has(task.groupId)) groups.set(task.groupId, []);
    groups.get(task.groupId).push(task);
  });
  if (groups.size !== 64) throw new Error(`Ожидалось 64 группы карт, получено ${groups.size}`);
  for (const [groupId, members] of groups) {
    const signature = members.map(task => task.kim).sort((a, b) => a - b).join(',');
    if (signature !== '9,10,11,12') throw new Error(`Неполная группа карт ${groupId}: ${signature}`);
    // В выгрузке один и тот же общий материал иногда сохранён четыре раза с разным
    // JPEG-сжатием. Для пробника назначаем всей группе одну каноническую карту.
    const canonicalImage = (members.find(task => task.kim === 9) || members[0]).image || members.find(task => task.image)?.image;
    if (!canonicalImage) throw new Error(`В группе ${groupId} отсутствует карта`);
    members.forEach(task => { task.image = canonicalImage; });
  }

  const bank = {
    schemaVersion: 2,
    version: 'fipi-history-2026-07-22-3',
    source: 'Открытый банк заданий ФИПИ, ЕГЭ История, задания 1–12',
    generatedAt: new Date().toISOString(),
    counts,
    mapGroupCount: groups.size,
    tasks
  };
  const json = JSON.stringify(bank);
  const output = `// Сгенерировано tools-and-docs/build-exam-bank.js. Не редактировать вручную.\n` +
    `(function(root,bank){if(typeof module==='object'&&module.exports)module.exports=bank;if(root)root.EGE_EXAM_BANK=bank;})(typeof window!=='undefined'?window:globalThis,${json});\n`;
  fs.writeFileSync(BANK_FILE, output, 'utf8');
  console.log(JSON.stringify({ tasks: tasks.length, counts, mapGroups: groups.size, bankBytes: Buffer.byteLength(output), assets: fs.readdirSync(ASSET_DIR).length }, null, 2));
}

build();
