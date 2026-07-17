/*
 * Локальный парсер открытого банка заданий ФИПИ (ege.fipi.ru).
 * Запуск: node server.js  → откроется http://localhost:3777
 * Без внешних зависимостей (Node 18+).
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const constructor = require('./constructor.js');
const wordExport = require('./word-export.js');

const PORT = +process.env.PORT || 3777;
// Открытые банки ФИПИ: ЕГЭ и ОГЭ — один движок, разные хосты.
const HOSTS = { ege: 'https://ege.fipi.ru', oge: 'https://oge.fipi.ru' };
function normExam(exam) {
  return exam === 'oge' ? 'oge' : 'ege';
}
function examHost(exam) {
  return HOSTS[normExam(exam)];
}
const FIPI = HOSTS.ege; // база по умолчанию (обратная совместимость)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT_DIR = path.join(__dirname, 'output');
const LOG_FILE = path.join(__dirname, 'parser-error.log');
const CHECKPOINT_FILE = path.join(OUT_DIR, '_last-session.json');

// ФИПИ отдаёт страницы в windows-1251
const cp1251 = new TextDecoder('windows-1251');

// Сессионная cookie ФИПИ (отдельная на каждый хост ege/oge): фильтр
// отправляется POST-ом один раз, дальше сервер помнит его в сессии.
const cookieJars = {}; // hostname -> "k=v; k2=v2"
let lastFilterBody = null; // чтобы восстановить сессию, если она протухла
let listSessionDirty = true; // отдельный запрос группы меняет фильтр в cookie-сессии

const imgCache = new Map(); // path -> {buf, type}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function logError(message, error) {
  const detail = error?.stack || error?.message || String(error || '');
  const line = `[${new Date().toISOString()}] ${message}${detail ? '\n' + detail : ''}\n\n`;
  console.error(message, error?.message || error || '');
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Лог не должен ломать сам парсер.
  }
}

function asFipiConnectionError(e) {
  return new Error(`Нет связи с сайтом ФИПИ (${e.code || e.message}). Проверьте интернет и повторите загрузку.`);
}

/* ---------------- запросы к ФИПИ ---------------- */

// Запрос напрямую через https: у ФИПИ сертификат российского УЦ (Минцифры),
// которого нет в хранилище Node, поэтому проверку сертификата отключаем
// (только для ege.fipi.ru — сервер больше никуда не ходит).
async function fipiRequest(url, opts = {}) {
  const retries = Number.isFinite(opts.retries) ? opts.retries : 1;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fipiRequestOnce(url, opts);
    } catch (e) {
      lastError = e;
      if (attempt < retries) await sleep(700 * (attempt + 1));
    }
  }
  throw asFipiConnectionError(lastError);
}

function fipiRequestOnce(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const host = u.hostname;
    const timeoutMs = opts.timeoutMs || 45000;
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        rejectUnauthorized: false,
        headers: {
          'User-Agent': UA,
          Referer: `https://${host}/bank/index.php`,
          ...(cookieJars[host] ? { Cookie: cookieJars[host] } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('aborted', () => fail(new Error('ответ ФИПИ оборвался во время получения')));
        res.on('error', fail);
        res.on('close', () => {
          if (!settled && !res.complete) fail(new Error('ответ ФИПИ получен не полностью'));
        });
        res.on('end', () => {
          if (!res.complete) return fail(new Error('ответ ФИПИ получен не полностью'));
          const setc = res.headers['set-cookie'] || [];
          if (setc.length) {
            const parts = new Map((cookieJars[host] || '').split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
            for (const c of setc) {
              const kv = c.split(';')[0];
              parts.set(kv.split('=')[0], kv);
            }
            cookieJars[host] = [...parts.values()].join('; ');
          }
          done({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            type: res.headers['content-type'] || 'application/octet-stream',
            buf: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', fail);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('превышено время ожидания')));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function fipiHtml(url, opts = {}) {
  const res = await fipiRequest(url, opts);
  if (!res.ok) throw new Error(`ФИПИ ответил кодом ${res.status} на ${url}`);
  return cp1251.decode(res.buf);
}

/* ---------------- разбор HTML ---------------- */

function decodeEntities(s) {
  const named = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…',
    minus: '−', times: '×', deg: '°', sect: '§', copy: '©',
  };
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-zA-Z]+);/g, (m, n) => named[n] ?? m);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function getAttr(tag, name) {
  const re = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = String(tag || '').match(re);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : '';
}

function hasClass(tag, className) {
  return (` ${getAttr(tag, 'class')} `).includes(` ${className} `);
}

function findOpeningTagByClass(html, tagName, className, fromOffset = 0) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  re.lastIndex = fromOffset;
  let m;
  while ((m = re.exec(html))) {
    if (hasClass(m[0], className)) return { index: m.index, tag: m[0], end: re.lastIndex, tagName };
  }
  return null;
}

function findMatchingCloseTag(html, tagName, fromOffset) {
  const re = new RegExp(`<\\/?${escapeRegExp(tagName)}\\b[^>]*>`, 'gi');
  re.lastIndex = fromOffset;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (/^<\//.test(m[0])) depth--;
    else depth++;
    if (depth === 0) return { index: m.index, end: re.lastIndex };
  }
  return null;
}

function minIndex(...values) {
  const indexes = values.filter((v) => Number.isInteger(v) && v >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function stripTags(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|BR)\s*\/?>/g, '\n')
    .replace(/<\/(?:p|P|tr|TR|div|DIV|li|LI)>/g, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// путь к файлу у ФИПИ: их же JS вырезает последовательности ". "
function cleanFipiPath(p) {
  let s = decodeEntities(String(p || '')).trim().replace(/\\/g, '/');
  s = s.replace(/^https?:\/\/(?:ege|oge)\.fipi\.ru\//i, '');
  s = s.replace(/^(?:\.\.\/)+/, '');
  s = s.replace(/^\/+/, '');
  let i;
  while ((i = s.indexOf('. ')) > 0) s = s.substring(0, i + 1) + s.substring(i + 2);
  return s;
}

function extractFilesAbsLocation(html) {
  let location = '';
  const re = /\bfiles_abs_location\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (m[2].trim()) location = m[2].trim();
  }
  return location;
}

function resolveFipiPicturePath(file, filesAbsLocation = '') {
  const raw = decodeEntities(String(file || '')).trim();
  const clean = cleanFipiPath(raw);
  const base = cleanFipiPath(filesAbsLocation).replace(/\/+$/, '');
  if (!clean || !base) return clean;

  // Полные пути ФИПИ уже указывают нужный каталог. files_abs_location нужен
  // для коротких имён, которые встречаются у карт и общих материалов групп.
  if (/^(?:https?:\/\/|\/|(?:\.\.\/)+|docs\/)/i.test(raw) || clean === base || clean.startsWith(base + '/')) {
    return clean;
  }
  return cleanFipiPath(`${base}/${clean}`);
}

function fipiFileUrl(p, exam) {
  const clean = cleanFipiPath(p);
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${examHost(exam)}/${encoded}`;
}

function isSafeFipiPath(p) {
  const clean = cleanFipiPath(p);
  return Boolean(clean) && !clean.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(clean) && !/[\\\0]/.test(clean);
}

// разбирает аргументы вызова ShowPictureQ...('a','b',1,2)
function parseCallArgs(argsStr) {
  const args = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([^,()]+)/g;
  let m;
  while ((m = re.exec(argsStr))) {
    let value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1).trim();
    }
    args.push(value);
  }
  return args;
}

function findClosingParen(s, openIndex) {
  let depth = 1;
  let quote = '';
  let escaped = false;
  for (let i = openIndex + 1; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function renderPictureCall(kind, args, images, exam, filesAbsLocation = '') {
  let file = '';
  let fullFile = '';
  if (kind === '2' || kind === '2WH' || kind === '3' || kind === '3WH') {
    // ФИПИ обычно передает полноразмерный файл и превью. В задании показываем превью:
    // оно ближе к исходной верстке банка и надежнее для печатной выгрузки.
    fullFile = resolveFipiPicturePath(args[0] || '', filesAbsLocation);
    const previewFile = resolveFipiPicturePath(args[1] || '', filesAbsLocation);
    file = previewFile || fullFile;
    if (fullFile && fullFile !== file) images.add(fullFile);
  } else {
    file = resolveFipiPicturePath(args[0] || '', filesAbsLocation);
  }
  if (!file) return '';
  images.add(file);
  const fullAttr = fullFile && fullFile !== file ? ` data-fipi-full="${escapeAttr(fullFile)}"` : '';
  return `<img class="fipi-img" data-fipi="${escapeAttr(file)}"${fullAttr} src="${proxyUrl(file, exam)}" alt="иллюстрация">`;
}

// URL картинки через локальный прокси (с пометкой exam, чтобы знать хост ФИПИ)
function proxyUrl(file, exam) {
  return `/fipi-file?p=${encodeURIComponent(file)}&exam=${normExam(exam)}`;
}

// Заменяет скрипты картинок ФИПИ на <img>, собирает пути файлов. У обычных
// вопросов используется ShowPictureQ, у общих материалов встречается также Z.
function replacePictureScripts(html, images, exam, inheritedFilesAbsLocation = '') {
  const filesAbsLocation = extractFilesAbsLocation(html) || inheritedFilesAbsLocation;
  let out = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (whole, body) => {
    const rendered = [];
    const re = /\bShowPicture(?:Q|Z)?(2WH|3WH|BL|2|3)?\s*\(/g;
    let m;
    while ((m = re.exec(body))) {
      const openIndex = re.lastIndex - 1;
      const closeIndex = findClosingParen(body, openIndex);
      if (closeIndex < 0) continue;
      const args = parseCallArgs(body.slice(openIndex + 1, closeIndex));
      const img = renderPictureCall(m[1] || '', args, images, exam, filesAbsLocation);
      if (img) rendered.push(img);
      re.lastIndex = closeIndex + 1;
    }
    return rendered.join('');
  });
  // Общие карты могут приходить обычным <img> как с ../../docs, так и с docs/.
  out = out.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (whole, a, src, b) => {
    const raw = decodeEntities(src).trim();
    if (!/^(?:(?:\.\.\/)+|\/?docs\/|https?:\/\/(?:ege|oge)\.fipi\.ru\/)/i.test(raw)) return whole;
    const file = cleanFipiPath(raw);
    if (!isSafeFipiPath(file)) return whole;
    images.add(file);
    return `${a}${proxyUrl(file, exam)}${b} data-fipi="${escapeAttr(file)}"`;
  });
  return out;
}

function cleanupContentHtml(html) {
  return String(html || '')
    .replace(/<input\b[^>]*>/gi, '')
    .replace(/<select[\s\S]*?<\/select>/gi, '<span class="gap">____</span>')
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(?:onclick|onchange|onkeypress|onkeyup)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .trim();
}

function parseGroupInfo(chunk) {
  const re = /<(?:div|span)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(chunk))) {
    if (!hasClass(m[0], 'number-in-group')) continue;
    const title = getAttr(m[0], 'title');
    const gm = title.match(/^\s*Задание\s+(\d+)\s+в\s+(.+?)\s*$/i);
    if (gm) return { groupId: gm[2].trim(), groupOrder: +gm[1] };
  }
  return { groupId: '', groupOrder: 0 };
}

function stimulusTextLooksRelevant(text) {
  return /(прочтите|фрагмент|источник|отрывок|манифест|воспоминан|документ|летопис|из\s+(?:записок|письма|сочинения|работы|речи)|схем|карт[аеуы](?![а-яё])|легенд|заштрихован|обозначен)/i.test(text);
}

function isLoadingPlaceholder(html, text) {
  return /загрузка\s+заданий|loading[_-]?(?:spinner|indicator)|ajax[_-]?loader|spinner\.(?:gif|png|svg)/i.test(`${html || ''} ${text || ''}`);
}

function isUsableGroupStimulus(stimulus) {
  if (!stimulus?.html || isLoadingPlaceholder(stimulus.html, stimulus.text)) return false;
  if ((stimulus.images || []).length) return true;
  const text = String(stimulus.text || stripTags(stimulus.html)).trim();
  return text.length >= 80 && (stimulusTextLooksRelevant(text) || text.length >= 260);
}

// Общий материал группы ФИПИ (источник, карта, изображение) находится не в
// cell_0 вопроса, а в соседнем блоке. Выбираем содержательный блок до вопроса.
function extractStimulusCandidate(region, exam, inheritedFilesAbsLocation = '') {
  const candidates = [];
  const filesAbsLocation = extractFilesAbsLocation(region) || inheritedFilesAbsLocation;
  const re = /<(div|td|table|section|figure|blockquote)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(region))) {
    const tag = m[1].toLowerCase();
    const opening = m[0];
    if (hasClass(opening, 'qblock') || hasClass(opening, 'number-in-group') || hasClass(opening, 'cell_0')) continue;
    const close = findMatchingCloseTag(region, tag, re.lastIndex);
    if (!close) continue;
    const raw = region.slice(re.lastIndex, close.index);
    if (/class\s*=\s*["'][^"']*\bqblock\b/i.test(raw)) continue;

    const images = new Set();
    const html = cleanupContentHtml(replacePictureScripts(raw, images, exam, filesAbsLocation));
    const text = stripTags(html);
    if (isLoadingPlaceholder(html, text)) continue;
    const media = images.size > 0;
    const relevant = stimulusTextLooksRelevant(text);
    if (!media && text.length < 80) continue;
    if (!media && !relevant && text.length < 260) continue;
    if (/СВОЙСТВА ЗАДАНИЯ|Тип ответа:|Показать ответ/i.test(text)) continue;

    const distance = Math.max(0, region.length - close.end);
    const classHint = /(?:group|zblock|material|source|stimulus|question)/i.test(getAttr(opening, 'class'));
    const score = (media ? 1200 : 0) + (relevant ? 500 : 0) + (classHint ? 180 : 0) +
      Math.min(text.length, 500) - Math.min(raw.length / 200, 100) - Math.min(distance / 150, 250);
    candidates.push({ html, text, images: [...images], score, size: raw.length });
  }

  candidates.sort((a, b) => b.score - a.score || a.size - b.size);
  return candidates[0] || { html: '', text: '', images: [], score: 0, size: 0 };
}

function extractExplicitGroupStimulus(html, exam, groupId) {
  const candidates = [];
  const filesAbsLocation = extractFilesAbsLocation(html);
  const re = /<(div|td|table|section|figure|blockquote)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const opening = m[0];
    const cls = getAttr(opening, 'class');
    const id = getAttr(opening, 'id');
    const explicitClass = /(?:^|\s)(?:zblock|group-(?:material|content|text)|stimulus|source)(?:\s|$)/i.test(cls);
    const explicitId = groupId && id.toLowerCase().includes(groupId.toLowerCase());
    if ((!explicitClass && !explicitId) || hasClass(opening, 'qblock') || hasClass(opening, 'number-in-group')) continue;
    const close = findMatchingCloseTag(html, tag, re.lastIndex);
    if (!close) continue;
    const raw = html.slice(re.lastIndex, close.index);
    const nested = extractStimulusCandidate(raw, exam, filesAbsLocation);
    if (nested.html) candidates.push(nested);
    if (/class\s*=\s*["'][^"']*\bqblock\b/i.test(raw)) continue;
    const images = new Set();
    const rendered = cleanupContentHtml(replacePictureScripts(raw, images, exam, filesAbsLocation));
    const text = stripTags(rendered);
    if (isLoadingPlaceholder(rendered, text)) continue;
    if (!images.size && text.length < 80) continue;
    candidates.push({
      html: rendered,
      text,
      images: [...images],
      score: 1000 + (images.size ? 1400 : 0) + Math.min(text.length, 500),
      size: raw.length,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.size - b.size);
  return candidates[0] || { html: '', text: '', images: [] };
}

function extractAnonymousQBlockStimulus(blockHtml, exam) {
  const filesAbsLocation = extractFilesAbsLocation(blockHtml);
  const qCell = findOpeningTagByClass(blockHtml, 'td', 'cell_0') || findOpeningTagByClass(blockHtml, 'div', 'cell_0');
  let raw = '';
  if (qCell) {
    const close = findMatchingCloseTag(blockHtml, qCell.tagName, qCell.end);
    raw = blockHtml.slice(qCell.end, close?.index ?? blockHtml.length);
  } else {
    const opening = blockHtml.match(/^<div\b[^>]*>/i)?.[0] || '';
    const close = opening ? findMatchingCloseTag(blockHtml, 'div', opening.length) : null;
    raw = blockHtml.slice(opening.length, close?.index ?? blockHtml.length);
  }

  const images = new Set();
  const rendered = cleanupContentHtml(replacePictureScripts(raw, images, exam, filesAbsLocation));
  const stimulus = { html: rendered, text: stripTags(rendered), images: [...images] };
  if (isUsableGroupStimulus(stimulus)) return stimulus;
  return extractStimulusCandidate(raw, exam, filesAbsLocation);
}

// Разбирает одну страницу questions.php на задания
function parseTasksPage(html, exam) {
  const count = +(html.match(/setQCount\((\d+)/)?.[1] ?? -1);
  const tasks = [];
  const starts = [];
  const blocks = [];
  const re = /<div\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!hasClass(m[0], 'qblock')) continue;
    const id = getAttr(m[0], 'id');
    const num = id.replace(/^q/i, '');
    const close = findMatchingCloseTag(html, 'div', re.lastIndex);
    const block = { idx: m.index, tagEnd: re.lastIndex, closeIndex: close?.index ?? -1, closeEnd: close?.end ?? -1, num };
    blocks.push(block);
    if (num) {
      starts.push(block);
    }
  }
  if (!starts.length && count !== 0) {
    throw new Error('ФИПИ вернул страницу без распознаваемых блоков заданий. Вероятно, изменилась разметка questions.php или открылась служебная страница ФИПИ.');
  }
  for (let i = 0; i < starts.length; i++) {
    const blockIndex = blocks.indexOf(starts[i]);
    const chunk = html.slice(starts[i].idx, blockIndex + 1 < blocks.length ? blocks[blockIndex + 1].idx : html.length);
    const t = parseTask(chunk, starts[i].num, exam);
    if (t) tasks.push(t);
  }

  // ФИПИ представляет общий текст или карту группы отдельным qblock без id.
  // Это не задание и в setQCount не входит, но его содержимое нужно прикрепить
  // к следующим пронумерованным вопросам этой группы.
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.num || block.closeEnd < 0) continue;
    const nextIndex = i + 1 < blocks.length ? blocks[i + 1].idx : html.length;
    const context = html.slice(block.idx, nextIndex);
    let { groupId } = parseGroupInfo(context);
    if (!groupId) {
      const nextNumbered = blocks.slice(i + 1).find((candidate) => candidate.num);
      groupId = tasks.find((task) => task.number === nextNumbered?.num)?.groupId || '';
    }
    if (!groupId) continue;

    const blockHtml = html.slice(block.idx, block.closeEnd);
    const stimulus = extractAnonymousQBlockStimulus(blockHtml, exam);
    if (!isUsableGroupStimulus(stimulus)) continue;
    for (const task of tasks) {
      if (task.groupId !== groupId || task.stimulusHtml) continue;
      task.stimulusHtml = stimulus.html;
      task.stimulusText = stimulus.text;
      task.stimulusImages = stimulus.images;
      task.images = [...new Set([...task.images, ...stimulus.images])];
    }
  }

  // В некоторых ответах ФИПИ общий материал стоит непосредственно перед
  // первым qblock группы. Такой блок не попадает в chunk и требует привязки
  // на уровне всей страницы.
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.groupId || t.groupOrder !== 1 || t.stimulusHtml) continue;
    const start = starts[i]?.idx ?? 0;
    const previous = i > 0 && starts[i - 1].closeEnd >= 0 ? starts[i - 1].closeEnd : 0;
    const prefix = html.slice(previous, start);
    const stimulus = extractStimulusCandidate(prefix, exam);
    if (!stimulus.html) continue;
    t.stimulusHtml = stimulus.html;
    t.stimulusText = stimulus.text;
    t.stimulusImages = stimulus.images;
    t.images = [...new Set([...t.images, ...stimulus.images])];
  }
  return { count, tasks };
}

function cutBetween(s, fromMark, toMark, fromOffset = 0) {
  const a = s.indexOf(fromMark, fromOffset);
  if (a < 0) return null;
  const b = s.indexOf(toMark, a + fromMark.length);
  if (b < 0) return null;
  return s.slice(a + fromMark.length, b);
}

function parseTask(chunk, num, exam) {
  const inputs = chunk.match(/<input\b[^>]*>/gi) || [];
  const guidInput = inputs.find((tag) => getAttr(tag, 'name').toLowerCase() === 'guid');
  const guid = getAttr(guidInput, 'value');
  const hint = stripTags(chunk.match(/<div\b[^>]*\bid\s*=\s*(?:"hint"|'hint'|hint)[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');

  // Группа заданий: несколько вопросов по одному материалу (карта, письменный
  // источник) в банке помечены `<div class="number-in-group" title="Задание N в GROUPID">`.
  // Такие задания должны идти в подборке строго вместе и по порядку.
  const { groupId, groupOrder } = parseGroupInfo(chunk);

  // текст задания: содержимое ячейки cell_0
  const qCell = findOpeningTagByClass(chunk, 'td', 'cell_0') || findOpeningTagByClass(chunk, 'div', 'cell_0');
  let qHtml = '';
  if (qCell) {
    const qClose = findMatchingCloseTag(chunk, qCell.tagName, qCell.end);
    const variantsCell =
      findOpeningTagByClass(chunk, 'td', 'varinats-block', qCell.end) ||
      findOpeningTagByClass(chunk, 'td', 'variants-block', qCell.end);
    const submitCell = findOpeningTagByClass(chunk, 'td', 'submit-block', qCell.end);
    const formEnd = chunk.toLowerCase().indexOf('</form>', qCell.end);
    const qEnd = qClose?.index ?? minIndex(variantsCell?.index, submitCell?.index, formEnd);
    qHtml = chunk.slice(qCell.end, qEnd >= 0 ? qEnd : chunk.length);
  } else {
    qHtml = cutBetween(chunk, "class='cell_0'>", '</form>') || '';
  }

  // варианты ответа (для заданий с выбором) лежат отдельным блоком
  const variantsCell =
    findOpeningTagByClass(chunk, 'td', 'varinats-block') ||
    findOpeningTagByClass(chunk, 'td', 'variants-block');
  let vHtml = '';
  if (variantsCell) {
    const variantsClose = findMatchingCloseTag(chunk, variantsCell.tagName, variantsCell.end);
    const submitCell = findOpeningTagByClass(chunk, 'td', 'submit-block', variantsCell.end);
    const formEnd = chunk.toLowerCase().indexOf('</form>', variantsCell.end);
    const vEnd = variantsClose?.index ?? minIndex(submitCell?.index, formEnd);
    vHtml = chunk.slice(variantsCell.end, vEnd >= 0 ? vEnd : chunk.length);
  }
  // формы выбора (select/checkbox/radio) в тексте не нужны — оставляем только содержимое надписей
  if (!/<label|<b>\s*\d+\s*\)/i.test(vHtml) && !/MsoNormal/.test(vHtml)) vHtml = '';

  const images = new Set();
  const filesAbsLocation = extractFilesAbsLocation(chunk);
  qHtml = replacePictureScripts(qHtml, images, exam, filesAbsLocation);
  vHtml = replacePictureScripts(vHtml, images, exam, filesAbsLocation);

  const stimulus = groupId && qCell
    ? extractStimulusCandidate(chunk.slice(0, qCell.index), exam, filesAbsLocation)
    : { html: '', text: '', images: [] };

  // свойства задания
  const kes = [];
  const kesBlock = chunk.match(/<td\b[^>]*>\s*КЭС:\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i);
  if (kesBlock) {
    const dre = /<div>([\s\S]*?)<\/div>/g;
    let d;
    while ((d = dre.exec(kesBlock[1]))) kes.push(stripTags(d[1]));
  }
  const answerType = stripTags(chunk.match(/<td\b[^>]*>\s*Тип ответа:\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] || '');

  // форма ответа и пронумерованные элементы (нужны для подбора ответа) —
  // разбираем ДО очистки html, пока select/checkbox ещё на месте
  const answerForm = parseAnswerShape(chunk);
  const elements = parseElements(chunk);

  qHtml = cleanupContentHtml(qHtml);
  vHtml = cleanupContentHtml(vHtml);

  return {
    number: num,
    guid,
    hint,
    answerType,
    kes,
    groupId, // id группы «одного материала» (карта/источник); '' — одиночное задание
    groupOrder, // порядковый номер внутри группы (Задание №N)
    stimulusHtml: stimulus.html,
    stimulusText: stimulus.text,
    stimulusImages: stimulus.images,
    questionHtml: qHtml,
    variantsHtml: vHtml,
    questionText: stripTags(qHtml + (vHtml ? '\n' + vHtml : '')),
    images: [...new Set([...images, ...stimulus.images])],
    answerForm,
    elements,
    answer: null, // строка-ответ ФИПИ, заполняется при подборе
    answerText: '', // человекочитаемая расшифровка
  };
}

// Определяет форму ответа: как из полей собирается строка для solve.php
function parseAnswerShape(chunk) {
  const selects = [];
  const sre = /(<select\b[^>]*>)([\s\S]*?)<\/select>/gi;
  let m;
  while ((m = sre.exec(chunk))) {
    const name = getAttr(m[1], 'name');
    if (!/^ans\d+$/i.test(name)) continue;
    const vals = [...m[2].matchAll(/<option\b[^>]*>/gi)]
      .map((x) => getAttr(x[0], 'value'))
      .filter((v) => v !== '0' && v !== '');
    selects.push({ name, values: [...new Set(vals)] });
  }
  if (selects.length) {
    selects.sort((a, b) => +a.name.slice(3) - +b.name.slice(3));
    // последовательность/соответствие/расстановка — цепочка выпадающих списков
    return { kind: 'selects', selects };
  }
  const inputs = chunk.match(/<input\b[^>]*>/gi) || [];
  const cb = inputs
    .map((tag) => getAttr(tag, 'name').match(/^test(\d+)$/i))
    .filter(Boolean);
  if (cb.length) {
    return { kind: 'bitmask', count: cb.length };
  }
  const radios = inputs
    .filter((tag) => getAttr(tag, 'type').toLowerCase() === 'radio')
    .map((tag) => getAttr(tag, 'value'))
    .filter(Boolean);
  if (radios.length) return { kind: 'radio', values: [...new Set(radios)] };
  return { kind: 'text' }; // свободный ответ — автоподбор невозможен
}

// Пронумерованные элементы (1) ... 2) ...) — список для расшифровки ответа
function parseElements(chunk) {
  const cell = findOpeningTagByClass(chunk, 'td', 'cell_0') || findOpeningTagByClass(chunk, 'div', 'cell_0');
  let region = chunk;
  if (cell) {
    const submitCell = findOpeningTagByClass(chunk, 'td', 'submit-block', cell.end);
    const formEnd = chunk.toLowerCase().indexOf('</form>', cell.end);
    const propsStart = chunk.search(/СВОЙСТВА\s+ЗАДАНИЯ|КЭС:|Тип ответа:/i);
    const end = minIndex(submitCell?.index, formEnd, propsStart);
    region = chunk.slice(cell.index, end >= 0 ? end : chunk.length);
  }
  const els = [];
  // терминатор — только следующий маркер или явные концы списка
  // (НЕ </td>/</table> — они идут сразу после маркера и обрезают текст в ноль)
  const re = /<b>\s*(\d+)\)\s*<\/b>([\s\S]*?)(?=<b>\s*\d+\)\s*<\/b>|Запишите в таблиц|Ответ:|СВОЙСТВА\s+ЗАДАНИЯ|КЭС:|Тип ответа:|$)/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(region))) {
    const n = +m[1];
    if (seen.has(n)) continue;
    const text = stripTags(m[2].replace(/<select[\s\S]*?<\/select>|<input[^>]*>/gi, '')).trim();
    if (text) {
      seen.add(n);
      els.push({ n, text: text.slice(0, 220) });
    }
  }
  return els;
}

/* ---------------- операции ---------------- */

function parseSubjectsHtml(html) {
  const subjects = [];
  const seen = new Set();
  const re = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const openTag = m[0].match(/^<li\b[^>]*>/i)?.[0] || '';
    const id = getAttr(openTag, 'id');
    const onclick = getAttr(openTag, 'onclick');
    const guid =
      id.match(/^p_([0-9A-F]+)$/i)?.[1] ||
      onclick.match(/selectProject\(["']?([0-9A-F]+)["']?\)/i)?.[1];
    if (!guid || seen.has(guid)) continue;
    seen.add(guid);
    subjects.push({ guid, name: stripTags(m[0]) });
  }
  if (!subjects.length) {
    throw new Error('Не удалось распознать список предметов на странице ФИПИ. Вероятно, изменилась разметка /bank/.');
  }
  return subjects;
}

async function getSubjects(exam) {
  return parseSubjectsHtml(await fipiHtml(examHost(exam) + '/bank/'));
}

function parseMetaHtml(html) {
  const themes = [];
  const seen = new Set();
  const labels = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((m) => m[0]);
  for (const label of labels) {
    const input = label.match(/<input\b[^>]*>/i)?.[0] || '';
    const name = getAttr(input, 'name').toLowerCase();
    const type = getAttr(input, 'type').toLowerCase();
    const value = getAttr(input, 'value');
    if (type !== 'checkbox' || name !== 'theme' || !value || seen.has(value)) continue;
    seen.add(value);
    themes.push({ code: value, title: stripTags(label.replace(input, '')), isSection: !value.includes('.') });
  }

  const qkinds = [];
  const seenKinds = new Set();
  for (const label of labels) {
    const input = label.match(/<input\b[^>]*>/i)?.[0] || '';
    const name = getAttr(input, 'name').toLowerCase();
    const type = getAttr(input, 'type').toLowerCase();
    const value = getAttr(input, 'value');
    if (type !== 'checkbox' || name !== 'qkind' || !value || seenKinds.has(value)) continue;
    seenKinds.add(value);
    qkinds.push({ code: value, title: stripTags(label.replace(input, '')) });
  }
  if (!themes.length && !qkinds.length) {
    throw new Error('Не удалось распознать темы и типы заданий на странице ФИПИ. Вероятно, изменилась разметка index.php.');
  }
  return { themes, qkinds };
}

async function getMeta(exam, proj) {
  return parseMetaHtml(await fipiHtml(`${examHost(exam)}/bank/index.php?proj=${proj}`));
}

function filterBody(proj, filter, pagesize) {
  const p = new URLSearchParams();
  p.set('search', '1');
  p.set('proj', proj);
  p.set('theme', (filter.themes || []).join(','));
  p.set('qkind', (filter.qkinds || []).join(','));
  p.set('qlevel', '');
  p.set('qsstruct', '');
  p.set('qpos', '');
  p.set('qid', filter.qid || '');
  p.set('zid', filter.zid || '');
  p.set('solved', '');
  p.set('favorite', '');
  p.set('blind', '');
  p.set('pagesize', String(pagesize));
  return p.toString();
}

const groupStimulusCache = new Map();

function groupStimulusFromHtml(html, exam, groupId) {
  try {
    const parsed = parseTasksPage(html, exam);
    const candidates = parsed.tasks
      .filter((t) => !t.groupId || t.groupId === groupId)
      .filter((t) => t.stimulusHtml)
      .map((t) => ({ html: t.stimulusHtml, text: t.stimulusText, images: t.stimulusImages || [] }));
    const usable = candidates.filter(isUsableGroupStimulus);
    if (usable.length) return usable.sort((a, b) => b.html.length - a.html.length)[0];
  } catch {
    // index.php может быть только оболочкой без qblock — продолжаем искать материал.
  }

  const explicit = extractExplicitGroupStimulus(html, exam, groupId);
  if (isUsableGroupStimulus(explicit)) return explicit;
  const firstQ = html.search(/<div\b[^>]*class\s*=\s*["'][^"']*\bqblock\b/i);
  return extractStimulusCandidate(firstQ >= 0 ? html.slice(0, firstQ) : html, exam);
}

async function fetchGroupStimulus(exam, proj, groupId, force = false) {
  const key = `${normExam(exam)}|${proj}|${groupId}`;
  if (force) groupStimulusCache.delete(key);
  if (groupStimulusCache.has(key)) return groupStimulusCache.get(key);

  const promise = (async () => {
    const body = filterBody(proj, { zid: groupId }, 100);
    listSessionDirty = true;
    const base = examHost(exam);
    const questionsUrl = `${base}/bank/questions.php?proj=${encodeURIComponent(proj)}&pagesize=100`;
    let lastError = null;
    const trySource = async (load) => {
      try {
        const candidate = groupStimulusFromHtml(await load(), exam, groupId);
        return isUsableGroupStimulus(candidate) ? candidate : null;
      } catch (e) {
        lastError = e;
        return null;
      }
    };

    // Сначала пробуем короткий запрос. Он работает, если сессия банка уже знает
    // проект, и не добавляет лишних обращений для большинства групп.
    let stimulus = await trySource(() => fipiHtml(questionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      retries: 0,
      timeoutMs: 15000,
    }));
    if (stimulus) return stimulus;

    // Глубокая ссылка zid устанавливает серверное состояние группы. Без этого
    // ФИПИ иногда возвращает сами вопросы, но не общий текст или карту.
    const deepUrl = `${base}/bank/index.php?proj=${encodeURIComponent(proj)}&zid=${encodeURIComponent(groupId)}`;
    stimulus = await trySource(() => fipiHtml(deepUrl, { retries: 0, timeoutMs: 15000 }));
    if (stimulus) return stimulus;

    stimulus = await trySource(() => fipiHtml(
      `${questionsUrl}&zid=${encodeURIComponent(groupId)}&rfsh=${Date.now()}`,
      { retries: 0, timeoutMs: 30000 }
    ));
    if (stimulus) return stimulus;
    if (lastError) throw lastError;
    return { html: '', text: '', images: [] };
  })();

  groupStimulusCache.set(key, promise);
  try {
    const result = await promise;
    if (!result?.html) groupStimulusCache.delete(key);
    return result;
  } catch (e) {
    groupStimulusCache.delete(key);
    throw e;
  }
}

async function enrichGroupStimuli(exam, proj, tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!t.groupId) continue;
    t.groupUrl = `${examHost(exam)}/bank/index.php?proj=${encodeURIComponent(proj)}&zid=${encodeURIComponent(t.groupId)}`;
    if (!groups.has(t.groupId)) groups.set(t.groupId, []);
    groups.get(t.groupId).push(t);
  }

  for (const [groupId, items] of groups) {
    const local = items.find((t) => isUsableGroupStimulus({
      html: t.stimulusHtml,
      text: t.stimulusText,
      images: t.stimulusImages || [],
    }));
    let stimulus = local
      ? { html: local.stimulusHtml, text: local.stimulusText, images: local.stimulusImages || [] }
      : null;
    if (!stimulus) {
      try {
        stimulus = await fetchGroupStimulus(exam, proj, groupId);
      } catch (e) {
        logError(`[не удалось загрузить общий материал группы ${groupId}]`, e);
        for (const t of items) t.stimulusStatus = 'error';
        continue;
      }
    }
    if (!isUsableGroupStimulus(stimulus)) {
      for (const t of items) t.stimulusStatus = 'missing';
      continue;
    }
    for (const t of items) {
      t.stimulusStatus = 'loaded';
      t.stimulusHtml = stimulus.html;
      t.stimulusText = stimulus.text || stripTags(stimulus.html);
      t.stimulusImages = stimulus.images || [];
      t.images = [...new Set([...t.images, ...t.stimulusImages])];
    }
  }
}

// После перезапуска или запроса отдельной группы сначала восстанавливаем
// фильтр POST-ом, затем открываем нужную страницу обычным GET-запросом.
async function fetchPage(exam, proj, filter, page, pagesize) {
  const base = examHost(exam);
  const body = filterBody(proj, filter, pagesize);
  let html = '';
  if (page === 0 || listSessionDirty || lastFilterBody !== body) {
    html = await fipiHtml(`${base}/bank/questions.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      retries: 2,
    });
    lastFilterBody = body;
    listSessionDirty = false;
  }
  if (page > 0) {
    html = await fipiHtml(
      `${base}/bank/questions.php?proj=${encodeURIComponent(proj)}&page=${page}&pagesize=${pagesize}&rfsh=${Date.now()}`,
      { retries: 2 }
    );
  }
  const parsed = parseTasksPage(html, exam);
  await enrichGroupStimuli(exam, proj, parsed.tasks);
  return parsed;
}

/* ---------------- подбор ответа через solve.php ---------------- */

const SOLVE_THROTTLE_MS = 140; // пауза между запросами — щадим сервер ФИПИ
const SOLVE_CAP = 800; // максимум попыток на одно задание

function* permInts(values, k) {
  // сначала перестановки без повторов (реальные ответы почти всегда такие)
  const used = new Array(values.length).fill(false);
  const cur = [];
  function* rec(depth) {
    if (depth === k) {
      yield cur.join('');
      return;
    }
    for (let i = 0; i < values.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(values[i]);
      yield* rec(depth + 1);
      cur.pop();
      used[i] = false;
    }
  }
  yield* rec(0);
}

function* productCandidates(selects) {
  // полный декартов перебор (запасной, если перестановки не подошли)
  const idx = new Array(selects.length).fill(0);
  while (true) {
    yield selects.map((s, i) => s.values[idx[i]]).join('');
    let p = selects.length - 1;
    while (p >= 0) {
      idx[p]++;
      if (idx[p] < selects[p].values.length) break;
      idx[p] = 0;
      p--;
    }
    if (p < 0) return;
  }
}

// Генерирует строки-кандидаты в разумном порядке под форму ответа
function* candidates(form) {
  if (form.kind === 'selects') {
    const s = form.selects;
    const sameVals = s.every((x) => x.values.join(',') === s[0].values.join(','));
    const seen = new Set();
    if (sameVals && s[0].values.length >= s.length) {
      for (const c of permInts(s[0].values, s.length)) {
        seen.add(c);
        yield c;
      }
    }
    for (const c of productCandidates(s)) if (!seen.has(c)) yield c;
  } else if (form.kind === 'bitmask') {
    const n = form.count;
    // сначала маски с 2–3 выбранными (типичный краткий выбор), потом остальные
    const order = [];
    for (let m = 1; m < 1 << n; m++) order.push(m);
    order.sort((a, b) => popcount(a) - popcount(b) || a - b);
    for (const m of order) yield toBits(m, n);
  } else if (form.kind === 'radio') {
    for (const v of form.values) yield v;
  }
}
function popcount(x) {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}
function toBits(m, n) {
  let s = '';
  for (let i = n - 1; i >= 0; i--) s += (m >> i) & 1;
  return s;
}

function estimateTries(form) {
  if (form.kind === 'selects') return form.selects.reduce((a, s) => a * s.values.length, 1);
  if (form.kind === 'bitmask') return (1 << form.count) - 1;
  if (form.kind === 'radio') return form.values.length;
  return Infinity;
}

async function solveOne(exam, proj, guid, form) {
  if (!form || form.kind === 'text') return { answer: null, tried: 0, reason: 'свободный ответ' };
  if (estimateTries(form) > SOLVE_CAP * 4)
    return { answer: null, tried: 0, reason: 'слишком много вариантов' };
  let tried = 0;
  for (const cand of candidates(form)) {
    if (tried >= SOLVE_CAP) return { answer: null, tried, reason: 'превышен лимит попыток' };
    tried++;
    const res = await fipiRequest(`${examHost(exam)}/bank/solve.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `guid=${guid}&answer=${encodeURIComponent(cand)}&chkcode=&ajax=1&proj=${proj}`,
    });
    const verdict = cp1251.decode(res.buf).trim();
    if (verdict === '3') return { answer: cand, tried, reason: 'ок' };
    if (verdict !== '2' && verdict !== '1')
      return { answer: null, tried, reason: 'сессия ФИПИ сброшена — обновите список заданий' };
    await sleep(SOLVE_THROTTLE_MS);
  }
  return { answer: null, tried, reason: 'ответ не найден' };
}

// Человекочитаемая расшифровка найденного ответа
function decodeAnswer(task) {
  const a = task.answer;
  if (!a) return '';
  const form = task.answerForm;
  const byNum = new Map((task.elements || []).map((e) => [String(e.n), e.text]));
  if (form.kind === 'selects') {
    const letters = 'АБВГДЕЖЗ';
    return a
      .split('')
      .map((d, i) => `${letters[i]} — ${d}${byNum.has(d) ? ' (' + byNum.get(d) + ')' : ''}`)
      .join('; ');
  }
  if (form.kind === 'bitmask') {
    const picked = [];
    for (let i = 0; i < a.length; i++) if (a[i] === '1') picked.push(String(i + 1));
    return 'верные: ' + picked.map((n) => `${n}${byNum.has(n) ? ' (' + byNum.get(n) + ')' : ''}`).join(', ');
  }
  return a;
}

async function getFipiFile(exam, p, opts = {}) {
  p = cleanFipiPath(p);
  const key = `${normExam(exam)}:${p}`;
  if (imgCache.has(key)) return imgCache.get(key);
  const res = await fipiRequest(fipiFileUrl(p, exam), opts);
  if (!res.ok) throw new Error(`Файл не найден: ${p} (${res.status})`);
  const item = { buf: res.buf, type: res.type };
  if (item.buf.length < 5 * 1024 * 1024) imgCache.set(key, item);
  return item;
}

/* ---------------- сохранение ---------------- */

function safeName(s) {
  return s.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function saveCheckpoint(payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const data = {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...payload,
  };
  const tmp = CHECKPOINT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  try {
    fs.renameSync(tmp, CHECKPOINT_FILE);
  } catch (e) {
    // Windows иногда не заменяет существующий файл атомарным rename.
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
    fs.renameSync(tmp, CHECKPOINT_FILE);
  }
  return {
    ok: true,
    updatedAt: data.updatedAt,
    total: Array.isArray(data.tasks) ? data.tasks.length : 0,
  };
}

function loadCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return { exists: false };
    const data = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    return { exists: true, checkpoint: data };
  } catch (e) {
    logError('[ошибка чтения чекпойнта]', e);
    return { exists: false, error: e.message };
  }
}

function clearCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  } catch (e) {
    logError('[ошибка удаления чекпойнта]', e);
  }
  return { ok: true };
}

/* ---------------- конструктор подборок ---------------- */

let libraryCache = null;
function getLibrary(refresh) {
  if (!libraryCache || refresh) libraryCache = constructor.scanLibrary(OUT_DIR);
  return libraryCache;
}

function groupMaterialKind(items) {
  const byOrder = new Map(items.map((t) => [+t.groupOrder, t]));
  const exactMapShape = items.length === 4 && byOrder.size === 4 &&
    [1, 2, 3].every((n) => byOrder.get(n)?.answerType === 'Краткий ответ') &&
    byOrder.get(4)?.answerType === 'Выбор ответов из предложенных вариантов';
  const allText = items.map((t) => t.questionText || '').join(' ').toLowerCase();
  if (items.some((t) => t.groupKind === 'history-ege-map-9-12') ||
      (exactMapShape && /(схем[аеуы]|схемой|схему|легенд[аеы]\s+схем|карт[аеуы](?![а-яё])|картосхем)/.test(allText))) return 'map';
  if (/(изображ|марк[аеуи]|монет|медал|плакат|карикатур|фотограф|портрет|почтов.*блок)/.test(allText)) return 'image';
  return 'text';
}

function hasSavedGroupMaterial(items, kind) {
  if (kind === 'map' || kind === 'image') {
    return items.some((t) => (t.stimulusImages || []).length > 0 && !isLoadingPlaceholder(t.stimulusHtml, t.stimulusText));
  }
  return items.some((t) => isUsableGroupStimulus({
    html: t.stimulusHtml,
    text: t.stimulusText,
    images: t.stimulusImages || [],
  }));
}

function projectFromGroup(items) {
  for (const t of items) {
    try {
      const proj = new URL(t.groupUrl || '').searchParams.get('proj');
      if (/^[a-f0-9]{32}$/i.test(proj || '')) return proj;
    } catch { /* старая запись без ссылки */ }
  }
  return '';
}

function listMissingLibraryMaterials(exam, subject) {
  const lib = getLibrary(true);
  const groups = new Map();
  for (const t of lib.tasks) {
    if (!t.groupId || (exam && t.exam !== exam) || (subject && t.subject !== subject)) continue;
    const key = `${t.exam}|${t.subject}|${t.groupId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const missing = [];
  for (const items of groups.values()) {
    const kind = groupMaterialKind(items);
    if (hasSavedGroupMaterial(items, kind)) continue;
    const proj = projectFromGroup(items);
    if (!proj) continue;
    missing.push({
      exam: items[0].exam,
      subject: items[0].subject,
      sourceDir: items[0].sourceDir,
      groupId: items[0].groupId,
      proj,
      kind,
      count: items.length,
    });
  }
  const priority = { map: 0, text: 1, image: 2 };
  missing.sort((a, b) => priority[a.kind] - priority[b.kind] || a.groupId.localeCompare(b.groupId));
  return missing;
}

function resolveOutputSourceDir(sourceDir) {
  const root = path.resolve(OUT_DIR);
  const target = path.resolve(root, String(sourceDir || ''));
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Недопустимая папка выгрузки.');
  return target;
}

function writeTextAtomic(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(tmp, file);
  }
}

async function repairLibraryMaterial(body) {
  const exam = normExam(body.exam);
  const sourceDir = String(body.sourceDir || '');
  const groupId = String(body.groupId || '');
  const proj = String(body.proj || '');
  if (!/^[a-f0-9]{6}$/i.test(groupId) || !/^[a-f0-9]{32}$/i.test(proj)) throw new Error('Некорректная группа ФИПИ.');

  const folder = resolveOutputSourceDir(sourceDir);
  const jsonPath = path.join(folder, 'задания.json');
  if (!fs.existsSync(jsonPath)) throw new Error('Исходная выгрузка не найдена.');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const items = (data.tasks || []).filter((t) => t.groupId === groupId);
  if (!items.length) throw new Error('Группа отсутствует в выбранной выгрузке.');
  const kind = groupMaterialKind(items);

  const stimulus = await fetchGroupStimulus(exam, proj, groupId, true);
  if (!isUsableGroupStimulus(stimulus)) return { status: 'missing', groupId, kind, images: 0 };
  if ((kind === 'map' || kind === 'image') && !(stimulus.images || []).length) {
    return { status: 'missing', groupId, kind, images: 0 };
  }

  const imgDir = path.join(folder, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  let stimulusHtml = stimulus.html;
  const localImages = [];
  for (const remote of stimulus.images || []) {
    const clean = cleanFipiPath(remote);
    const fname = safeName(`group_${groupId}_${path.basename(clean)}`);
    const local = `images/${fname}`;
    const { buf } = await getFipiFile(exam, clean, { retries: 0, timeoutMs: 30000 });
    fs.writeFileSync(path.join(imgDir, fname), buf);
    stimulusHtml = stimulusHtml.split(proxyUrl(clean, exam)).join(local);
    localImages.push(local);
  }

  const groupUrl = `${examHost(exam)}/bank/index.php?proj=${encodeURIComponent(proj)}&zid=${encodeURIComponent(groupId)}`;
  for (const t of items) {
    t.groupUrl = groupUrl;
    t.stimulusStatus = 'loaded';
    t.stimulusHtml = stimulusHtml;
    t.stimulusText = stimulus.text || stripTags(stimulusHtml);
    t.stimulusImages = localImages;
    t.images = [...new Set([...(t.images || []), ...localImages])];
  }
  writeTextAtomic(jsonPath, JSON.stringify(data, null, 2));
  writeTextAtomic(path.join(folder, 'банк.json'), JSON.stringify(toBank(data), null, 2));
  writeTextAtomic(path.join(folder, 'задания.html'), renderHtmlDoc(data));
  libraryCache = null;
  return { status: 'loaded', groupId, kind, images: localImages.length };
}

async function buildSet(body) {
  const lib = getLibrary(false);
  const sel = constructor.selectTasks(lib, body.filter || {});
  if (!sel.length) throw new Error('По выбранным условиям заданий не нашлось — измените фильтр.');
  const opts = body.opts || {};
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const folder = path.join(OUT_DIR, '_подборки', safeName(`${opts.title || 'подборка'}_${stamp}`));
  fs.mkdirSync(folder, { recursive: true });

  const printHtml = constructor.renderDocument(sel, { ...opts, forWord: false }, OUT_DIR);
  const htmlPath = path.join(folder, 'подборка.html');
  const docPath = path.join(folder, 'подборка.docx');
  fs.writeFileSync(htmlPath, printHtml, 'utf8');
  fs.writeFileSync(docPath, await wordExport.renderWordDocument(sel, opts, OUT_DIR));

  return { folder, htmlPath, docPath, total: sel.length, withAnswers: sel.filter((t) => t.answer).length };
}

async function saveExport(payload) {
  const exam = normExam(payload.exam);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const folder = path.join(OUT_DIR, safeName(`${payload.title || 'выгрузка'}_${stamp}`));
  const imgDir = path.join(folder, 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  // скачиваем картинки, переписываем ссылки на локальные файлы
  const tasks = JSON.parse(JSON.stringify(payload.tasks));
  let imgErrors = 0;
  for (const t of tasks) {
    const localImages = [];
    for (const p of t.images) {
      const fname = safeName(t.number + '_' + path.basename(p));
      try {
        const { buf } = await getFipiFile(exam, p);
        fs.writeFileSync(path.join(imgDir, fname), buf);
        localImages.push('images/' + fname);
        const proxied = proxyUrl(cleanFipiPath(p), exam);
        for (const field of ['questionHtml', 'variantsHtml', 'stimulusHtml']) {
          t[field] = String(t[field] || '').split(proxied).join('images/' + fname);
        }
      } catch {
        imgErrors++;
        localImages.push(p); // оставляем исходный путь ФИПИ
      }
    }
    t.images = localImages;
  }

  const json = {
    source: `Открытый банк заданий ФИПИ ${exam.toUpperCase()} (${examHost(exam).replace(/^https?:\/\//, '')})`,
    exam,
    subject: payload.subject,
    filters: payload.filters,
    exportedAt: new Date().toISOString(),
    total: tasks.length,
    withAnswers: tasks.filter((t) => t.answer).length,
    tasks,
  };
  fs.writeFileSync(path.join(folder, 'задания.json'), JSON.stringify(json, null, 2), 'utf8');
  fs.writeFileSync(path.join(folder, 'задания.html'), renderHtmlDoc(json), 'utf8');
  // «чистый» банк для импорта в программы — только нормализованные поля
  fs.writeFileSync(path.join(folder, 'банк.json'), JSON.stringify(toBank(json), null, 2), 'utf8');
  return { folder, imgErrors, total: tasks.length, withAnswers: json.withAnswers };
}

// Конвертер: из «сырого» задания в чистую нормализованную запись для импорта
function toBank(data) {
  return {
    source: data.source,
    exam: data.exam,
    subject: data.subject,
    exportedAt: data.exportedAt,
    total: data.total,
    tasks: data.tasks.map((t) => ({
      number: t.number,
      type: t.answerType,
      kes: t.kes,
      prompt: t.questionText,
      stimulus: t.stimulusText || '',
      stimulusHtml: t.stimulusHtml || '',
      groupId: t.groupId || '',
      groupOrder: t.groupOrder || 0,
      groupUrl: t.groupUrl || '',
      stimulusStatus: t.stimulusStatus || (t.stimulusHtml ? 'loaded' : ''),
      elements: t.elements,
      images: t.images,
      answerRaw: t.answer || null, // строка-ответ ФИПИ (напр. "512")
      answer: t.answerText || null, // расшифровка (напр. "А — 5 (…); Б — 1 (…)")
    })),
  };
}

function renderHtmlDoc(data) {
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cards = data.tasks
    .map(
      (t, i) => `
<div class="card">
  <div class="meta"><b>№ ${i + 1}</b> · Номер ФИПИ: ${t.number} · ${esc(t.answerType)}<br>
  <small>${t.kes.map(esc).join(' · ')}</small></div>
  <div class="hint">${esc(t.hint)}</div>
  ${t.stimulusHtml && (!t.groupId || t.groupOrder === 1) ? `<div class="stimulus">${t.stimulusHtml}</div>` : ''}
  <div class="body">${t.questionHtml}</div>
  ${t.variantsHtml ? `<div class="body">${t.variantsHtml}</div>` : ''}
  ${t.answer ? `<div class="answer"><b>Ответ:</b> ${esc(t.answer)}${t.answerText && t.answerText !== t.answer ? ' — ' + esc(t.answerText) : ''}</div>` : ''}
</div>`
    )
    .join('\n');
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>${esc(data.subject || '')} — задания ФИПИ (${data.total})</title>
<style>
body{font-family:Georgia,serif;max-width:800px;margin:20px auto;padding:0 16px;color:#222}
.card{border:1px solid #ccc;border-radius:8px;padding:14px 18px;margin:14px 0;page-break-inside:avoid}
.meta{color:#555;font-size:14px;margin-bottom:8px}
.hint{font-style:italic;color:#777;font-size:14px;margin-bottom:6px}
.answer{margin-top:10px;padding:8px 12px;background:#eefbf0;border-left:3px solid #16a34a;border-radius:4px;font-size:15px}
img{max-width:100%;height:auto}
table{border-collapse:collapse}
.gap{border-bottom:1px solid #222;padding:0 14px}
</style></head><body>
<h1>${esc(data.subject || '')} — ${data.total} заданий</h1>
<p>Источник: ${esc(data.source)}. Выгружено ${data.exportedAt.slice(0, 10)}.${data.withAnswers ? ' С ответами: ' + data.withAnswers + '.' : ''}</p>
${cards}
</body></html>`;
}

/* ---------------- HTTP-сервер ---------------- */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
    } else if (url.pathname === '/api/subjects') {
      sendJson(res, 200, await getSubjects(url.searchParams.get('exam')));
    } else if (url.pathname === '/api/meta') {
      sendJson(res, 200, await getMeta(url.searchParams.get('exam'), url.searchParams.get('proj')));
    } else if (url.pathname === '/api/page' && req.method === 'POST') {
      const b = await readBody(req);
      sendJson(res, 200, await fetchPage(b.exam, b.proj, b.filter || {}, b.page | 0, b.pagesize || 10));
    } else if (url.pathname === '/api/group-material' && req.method === 'POST') {
      const b = await readBody(req);
      if (!/^[a-f0-9]{32}$/i.test(String(b.proj || '')) || !/^[a-f0-9]{6}$/i.test(String(b.groupId || ''))) {
        throw new Error('Некорректный идентификатор группы ФИПИ.');
      }
      const stimulus = await fetchGroupStimulus(b.exam, b.proj, b.groupId, true);
      sendJson(res, 200, {
        groupId: b.groupId,
        groupUrl: `${examHost(b.exam)}/bank/index.php?proj=${encodeURIComponent(b.proj)}&zid=${encodeURIComponent(b.groupId)}`,
        status: isUsableGroupStimulus(stimulus) ? 'loaded' : 'missing',
        stimulusHtml: isUsableGroupStimulus(stimulus) ? stimulus.html : '',
        stimulusText: isUsableGroupStimulus(stimulus) ? stimulus.text : '',
        stimulusImages: isUsableGroupStimulus(stimulus) ? stimulus.images || [] : [],
      });
    } else if (url.pathname === '/api/solve' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await solveOne(b.exam, b.proj, b.guid, b.form);
      sendJson(res, 200, { ...r, answerText: r.answer ? decodeAnswer({ answer: r.answer, answerForm: b.form, elements: b.elements || [] }) : '' });
    } else if (url.pathname === '/fipi-file') {
      const p = cleanFipiPath(url.searchParams.get('p') || '');
      if (!isSafeFipiPath(p)) throw new Error('Недопустимый путь');
      const f = await getFipiFile(url.searchParams.get('exam'), p);
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'max-age=86400' });
      res.end(f.buf);
    } else if (url.pathname === '/api/checkpoint' && req.method === 'GET') {
      sendJson(res, 200, loadCheckpoint());
    } else if (url.pathname === '/api/checkpoint' && req.method === 'POST') {
      sendJson(res, 200, saveCheckpoint(await readBody(req)));
    } else if (url.pathname === '/api/checkpoint/clear' && req.method === 'POST') {
      sendJson(res, 200, clearCheckpoint());
    } else if (url.pathname === '/api/save' && req.method === 'POST') {
      sendJson(res, 200, await saveExport(await readBody(req)));
    } else if (url.pathname === '/api/open-folder' && req.method === 'POST') {
      const b = await readBody(req);
      const target = path.resolve(b.folder || OUT_DIR);
      if (!isInsideOutput(target) || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new Error('Папка не найдена или находится вне папки выгрузок');
      }
      await openLocalTarget(target);
      sendJson(res, 200, { ok: true });
    } else if (url.pathname === '/constructor') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'constructor.html')));
    } else if (url.pathname === '/api/library') {
      const lib = getLibrary(url.searchParams.get('refresh') === '1');
      sendJson(res, 200, constructor.libraryIndex(lib, url.searchParams.get('outdated') === '1'));
    } else if (url.pathname === '/api/library/materials') {
      const missing = listMissingLibraryMaterials(
        url.searchParams.get('exam') || '',
        url.searchParams.get('subject') || ''
      );
      sendJson(res, 200, {
        total: missing.length,
        maps: missing.filter((x) => x.kind === 'map').length,
        texts: missing.filter((x) => x.kind === 'text').length,
        images: missing.filter((x) => x.kind === 'image').length,
        groups: missing,
      });
    } else if (url.pathname === '/api/library/material' && req.method === 'POST') {
      sendJson(res, 200, await repairLibraryMaterial(await readBody(req)));
    } else if (url.pathname === '/api/preview' && req.method === 'POST') {
      const b = await readBody(req);
      const lib = getLibrary(false);
      const sel = constructor.selectTasks(lib, b.filter || {});
      const shown = sel.slice(0, 20);
      const html = constructor.renderDocument(shown, { ...(b.opts || {}), title: b.opts?.title || 'Предпросмотр' }, OUT_DIR);
      sendJson(res, 200, { count: sel.length, shown: shown.length, html });
    } else if (url.pathname === '/api/build' && req.method === 'POST') {
      const b = await readBody(req);
      sendJson(res, 200, await buildSet(b));
    } else if (url.pathname === '/api/open-file' && req.method === 'POST') {
      const b = await readBody(req);
      const target = path.resolve(b.file || '');
      if (!isInsideOutput(target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error('Файл не найден или находится вне папки выгрузок');
      }
      await openLocalTarget(target);
      sendJson(res, 200, { ok: true });
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  } catch (e) {
    logError(`[ошибка] ${req.method} ${req.url}:`, e);
    sendJson(res, 500, { error: e.message });
  }
});

function isInsideOutput(target) {
  const relative = path.relative(path.resolve(OUT_DIR), path.resolve(target));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function openLocalTarget(target) {
  if (process.env.FIPI_PARSER_NO_OPEN === '1') return Promise.resolve();
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function openLocalUrl(url) {
  openLocalTarget(url).catch((e) => logError('[не удалось открыть браузер]', e));
}

function startServer() {
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Порт ${PORT} уже занят. Закройте другое окно парсера или задайте другой PORT.`);
    } else {
      console.error('Не удалось запустить сервер:', e.message);
    }
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('  Парсер банка ФИПИ запущен!');
    console.log(`  Откройте в браузере:  ${url}`);
    console.log('  Чтобы остановить — просто закройте это окно.');
    console.log('');
    openLocalUrl(url);
  });
}

if (require.main === module) {
  process.on('unhandledRejection', (reason) => {
    logError('[необработанная ошибка promise]', reason);
  });
  process.on('uncaughtException', (error) => {
    logError('[критическая ошибка]', error);
  });
  startServer();
}

module.exports = {
  parseSubjectsHtml,
  parseMetaHtml,
  parseTasksPage,
  parseTask,
  parseAnswerShape,
  extractStimulusCandidate,
  extractExplicitGroupStimulus,
};
