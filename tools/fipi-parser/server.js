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
const { exec } = require('child_process');

const PORT = +process.env.PORT || 3777;
const FIPI = 'https://ege.fipi.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT_DIR = path.join(__dirname, 'output');
const LOG_FILE = path.join(__dirname, 'parser-error.log');
const CHECKPOINT_FILE = path.join(OUT_DIR, '_last-session.json');

// ФИПИ отдаёт страницы в windows-1251
const cp1251 = new TextDecoder('windows-1251');

// Сессионная cookie ФИПИ: фильтр отправляется POST-ом один раз,
// дальше сервер ФИПИ помнит его в сессии и страницы листаются GET-ом.
let fipiCookie = '';
let lastFilterBody = null; // чтобы восстановить сессию, если она протухла

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
  return new Error(`Нет связи с сайтом ФИПИ (${e.code || e.message}). Проверьте интернет и отключите VPN.`);
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
          Referer: FIPI + '/bank/index.php',
          ...(fipiCookie ? { Cookie: fipiCookie } : {}),
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
            const parts = new Map(fipiCookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
            for (const c of setc) {
              const kv = c.split(';')[0];
              parts.set(kv.split('=')[0], kv);
            }
            fipiCookie = [...parts.values()].join('; ');
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
    req.setTimeout(45000, () => req.destroy(new Error('превышено время ожидания')));
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
  s = s.replace(/^https?:\/\/ege\.fipi\.ru\//i, '');
  s = s.replace(/^(?:\.\.\/)+/, '');
  s = s.replace(/^\/+/, '');
  let i;
  while ((i = s.indexOf('. ')) > 0) s = s.substring(0, i + 1) + s.substring(i + 2);
  return s;
}

function fipiFileUrl(p) {
  const clean = cleanFipiPath(p);
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${FIPI}/${encoded}`;
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
    args.push((m[1] ?? m[2] ?? m[3] ?? '').trim());
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

function renderPictureCall(kind, args, images) {
  let file = '';
  let fullFile = '';
  if (kind === '2' || kind === '2WH' || kind === '3' || kind === '3WH') {
    // ФИПИ обычно передает полноразмерный файл и превью. В задании показываем превью:
    // оно ближе к исходной верстке банка и надежнее для печатной выгрузки.
    fullFile = cleanFipiPath(args[0] || '');
    const previewFile = cleanFipiPath(args[1] || '');
    file = previewFile || fullFile;
    if (fullFile && fullFile !== file) images.add(fullFile);
  } else {
    file = cleanFipiPath(args[0] || '');
  }
  if (!file) return '';
  images.add(file);
  const fullAttr = fullFile && fullFile !== file ? ` data-fipi-full="${escapeAttr(fullFile)}"` : '';
  return `<img class="fipi-img" data-fipi="${escapeAttr(file)}"${fullAttr} src="/fipi-file?p=${encodeURIComponent(file)}" alt="иллюстрация">`;
}

// Заменяет <script>ShowPictureQ...(...)</script> на <img>, собирает пути картинок
function replacePictureScripts(html, images) {
  let out = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (whole, body) => {
    const rendered = [];
    const re = /ShowPictureQ(2WH|3WH|BL|2|3)?\s*\(/g;
    let m;
    while ((m = re.exec(body))) {
      const openIndex = re.lastIndex - 1;
      const closeIndex = findClosingParen(body, openIndex);
      if (closeIndex < 0) continue;
      const args = parseCallArgs(body.slice(openIndex + 1, closeIndex));
      const img = renderPictureCall(m[1] || '', args, images);
      if (img) rendered.push(img);
      re.lastIndex = closeIndex + 1;
    }
    return rendered.join('');
  });
  // обычные <img src="../../docs/..."> тоже перепишем на прокси
  out = out.replace(/(<img[^>]+src=["'])(?:\.\.\/)+([^"']+)(["'])/gi, (_, a, p, b) => {
    const file = cleanFipiPath(p);
    images.add(file);
    return `${a}/fipi-file?p=${encodeURIComponent(file)}${b} data-fipi="${escapeAttr(file)}"`;
  });
  return out;
}

// Разбирает одну страницу questions.php на задания
function parseTasksPage(html) {
  const count = +(html.match(/setQCount\((\d+)/)?.[1] ?? -1);
  const tasks = [];
  const starts = [];
  const re = /<div\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!hasClass(m[0], 'qblock')) continue;
    const id = getAttr(m[0], 'id');
    const num = id.replace(/^q/i, '');
    if (num) starts.push({ idx: m.index, num });
  }
  if (!starts.length && count !== 0) {
    throw new Error('ФИПИ вернул страницу без распознаваемых блоков заданий. Вероятно, изменилась разметка questions.php или открылась служебная страница ФИПИ.');
  }
  for (let i = 0; i < starts.length; i++) {
    const chunk = html.slice(starts[i].idx, i + 1 < starts.length ? starts[i + 1].idx : html.length);
    const t = parseTask(chunk, starts[i].num);
    if (t) tasks.push(t);
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

function parseTask(chunk, num) {
  const inputs = chunk.match(/<input\b[^>]*>/gi) || [];
  const guidInput = inputs.find((tag) => getAttr(tag, 'name').toLowerCase() === 'guid');
  const guid = getAttr(guidInput, 'value');
  const hint = stripTags(chunk.match(/<div\b[^>]*\bid\s*=\s*(?:"hint"|'hint'|hint)[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');

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
  qHtml = replacePictureScripts(qHtml, images);
  vHtml = replacePictureScripts(vHtml, images);

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

  const cleanupHtml = (h) =>
    h
      .replace(/<input[^>]*>/gi, '')
      .replace(/<select[\s\S]*?<\/select>/gi, '<span class="gap">____</span>')
      .replace(/\s(?:onclick|onchange|onkeypress|onkeyup)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .trim();

  qHtml = cleanupHtml(qHtml);
  vHtml = cleanupHtml(vHtml);

  return {
    number: num,
    guid,
    hint,
    answerType,
    kes,
    questionHtml: qHtml,
    variantsHtml: vHtml,
    questionText: stripTags(qHtml + (vHtml ? '\n' + vHtml : '')),
    images: [...images],
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

async function getSubjects() {
  return parseSubjectsHtml(await fipiHtml(FIPI + '/bank/'));
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

async function getMeta(proj) {
  return parseMetaHtml(await fipiHtml(`${FIPI}/bank/index.php?proj=${proj}`));
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
  p.set('zid', '');
  p.set('solved', '');
  p.set('favorite', '');
  p.set('blind', '');
  p.set('pagesize', String(pagesize));
  return p.toString();
}

// page 0 — POST с фильтром (заодно устанавливает сессию), дальше GET
async function fetchPage(proj, filter, page, pagesize) {
  let html;
  if (page === 0 || !lastFilterBody) {
    lastFilterBody = filterBody(proj, filter, pagesize);
    html = await fipiHtml(`${FIPI}/bank/questions.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: lastFilterBody,
      retries: 2,
    });
  } else {
    html = await fipiHtml(
      `${FIPI}/bank/questions.php?proj=${proj}&page=${page}&pagesize=${pagesize}&rfsh=${Date.now()}`,
      { retries: 2 }
    );
  }
  return parseTasksPage(html);
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

async function solveOne(proj, guid, form) {
  if (!form || form.kind === 'text') return { answer: null, tried: 0, reason: 'свободный ответ' };
  if (estimateTries(form) > SOLVE_CAP * 4)
    return { answer: null, tried: 0, reason: 'слишком много вариантов' };
  let tried = 0;
  for (const cand of candidates(form)) {
    if (tried >= SOLVE_CAP) return { answer: null, tried, reason: 'превышен лимит попыток' };
    tried++;
    const res = await fipiRequest(`${FIPI}/bank/solve.php`, {
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

async function getFipiFile(p) {
  p = cleanFipiPath(p);
  if (imgCache.has(p)) return imgCache.get(p);
  const res = await fipiRequest(fipiFileUrl(p));
  if (!res.ok) throw new Error(`Файл не найден: ${p} (${res.status})`);
  const item = { buf: res.buf, type: res.type };
  if (item.buf.length < 5 * 1024 * 1024) imgCache.set(p, item);
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
  fs.renameSync(tmp, CHECKPOINT_FILE);
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

async function saveExport(payload) {
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
        const { buf } = await getFipiFile(p);
        fs.writeFileSync(path.join(imgDir, fname), buf);
        localImages.push('images/' + fname);
        const proxied = `/fipi-file?p=${encodeURIComponent(p)}`;
        t.questionHtml = t.questionHtml.split(proxied).join('images/' + fname);
        t.variantsHtml = t.variantsHtml.split(proxied).join('images/' + fname);
      } catch {
        imgErrors++;
        localImages.push(p); // оставляем исходный путь ФИПИ
      }
    }
    t.images = localImages;
  }

  const json = {
    source: 'Открытый банк заданий ФИПИ (ege.fipi.ru)',
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
    subject: data.subject,
    exportedAt: data.exportedAt,
    total: data.total,
    tasks: data.tasks.map((t) => ({
      number: t.number,
      type: t.answerType,
      kes: t.kes,
      prompt: t.questionText,
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
      sendJson(res, 200, await getSubjects());
    } else if (url.pathname === '/api/meta') {
      sendJson(res, 200, await getMeta(url.searchParams.get('proj')));
    } else if (url.pathname === '/api/page' && req.method === 'POST') {
      const b = await readBody(req);
      sendJson(res, 200, await fetchPage(b.proj, b.filter || {}, b.page | 0, b.pagesize || 10));
    } else if (url.pathname === '/api/solve' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await solveOne(b.proj, b.guid, b.form);
      sendJson(res, 200, { ...r, answerText: r.answer ? decodeAnswer({ answer: r.answer, answerForm: b.form, elements: b.elements || [] }) : '' });
    } else if (url.pathname === '/fipi-file') {
      const p = cleanFipiPath(url.searchParams.get('p') || '');
      if (!isSafeFipiPath(p)) throw new Error('Недопустимый путь');
      const f = await getFipiFile(p);
      res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'max-age=86400' });
      res.end(f.buf);
    } else if (url.pathname === '/api/save' && req.method === 'POST') {
      sendJson(res, 200, await saveExport(await readBody(req)));
    } else if (url.pathname === '/api/open-folder' && req.method === 'POST') {
      const b = await readBody(req);
      const target = path.resolve(b.folder || OUT_DIR);
      if (!target.startsWith(path.resolve(OUT_DIR))) throw new Error('Недопустимая папка');
      exec(`explorer "${target}"`);
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

process.on('unhandledRejection', (reason) => {
  logError('[необработанная ошибка promise]', reason);
});

process.on('uncaughtException', (error) => {
  logError('[критическая ошибка]', error);
});

function openLocalUrl(url) {
  if (process.env.FIPI_PARSER_NO_OPEN === '1') return;
  if (process.platform === 'win32') exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
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

if (require.main === module) startServer();

module.exports = {
  parseSubjectsHtml,
  parseMetaHtml,
  parseTasksPage,
  parseTask,
  parseAnswerShape,
};
