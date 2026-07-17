'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');
const { imageSize } = require('image-size');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');

const PAGE = {
  width: 11906,
  height: 16838,
  marginTop: 1020,
  marginRight: 1134,
  marginBottom: 1020,
  marginLeft: 1134,
};
const CONTENT_WIDTH = PAGE.width - PAGE.marginLeft - PAGE.marginRight;
const TASK_INDENT = 360;
const BLUE = '244E73';
const INK = '17212B';
const MUTED = '647180';
const RULE = 'CCD5DE';
const LIGHT = 'EDF2F6';

const blockTags = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'ol', 'p', 'section', 'table', 'ul',
]);

const noBorder = {
  style: BorderStyle.NIL,
  size: 0,
  color: 'FFFFFF',
};
const gridBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: 'AEB9C4',
};

function normalizedText(node) {
  const raw = typeof node.text === 'string' ? node.text : (node.rawText || '');
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

function inlineStyleFor(node, inherited) {
  const tag = String(node.rawTagName || '').toLowerCase();
  const style = String(node.getAttribute?.('style') || '').toLowerCase();
  return {
    ...inherited,
    bold: inherited.bold || tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style),
    italics: inherited.italics || tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/.test(style),
    underline: inherited.underline || tag === 'u' || /text-decoration[^;]*underline/.test(style),
    superScript: inherited.superScript || tag === 'sup',
    subScript: inherited.subScript || tag === 'sub',
  };
}

function imageType(buffer, src) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buffer.slice(0, 2).toString('ascii') === 'BM') return 'bmp';
  const ext = path.extname(String(src || '')).toLowerCase().replace('.', '');
  return ext === 'jpeg' ? 'jpg' : ['png', 'jpg', 'gif', 'bmp'].includes(ext) ? ext : '';
}

function readImage(src, ctx) {
  try {
    let data;
    const dataMatch = String(src || '').match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i);
    if (dataMatch) {
      data = Buffer.from(dataMatch[2], 'base64');
    } else {
      const clean = decodeURIComponent(String(src || '').split(/[?#]/)[0]).replace(/\//g, path.sep);
      if (!clean || path.isAbsolute(clean) || clean.includes('..')) return null;
      data = fs.readFileSync(path.join(ctx.outDir, ctx.sourceDir || '', clean));
    }
    const type = imageType(data, src);
    if (!type) return null;
    const dimensions = imageSize(data);
    if (!dimensions.width || !dimensions.height) return null;
    const maxWidth = ctx.imageMaxWidth || 600;
    const maxHeight = ctx.imageMaxHeight || 720;
    const scale = Math.min(1, maxWidth / dimensions.width, maxHeight / dimensions.height);
    return new ImageRun({
      type,
      data,
      transformation: {
        width: Math.max(1, Math.round(dimensions.width * scale)),
        height: Math.max(1, Math.round(dimensions.height * scale)),
      },
      altText: { title: 'Иллюстрация к заданию', description: 'Материал задания', name: 'task-image' },
    });
  } catch {
    return null;
  }
}

function inlineRuns(node, ctx, inherited = {}) {
  if (!node) return [];
  if (node.nodeType === 3) {
    const text = normalizedText(node);
    if (!text) return [];
    return [new TextRun({
      text,
      bold: !!inherited.bold,
      italics: !!inherited.italics,
      underline: inherited.underline ? {} : undefined,
      superScript: !!inherited.superScript,
      subScript: !!inherited.subScript,
    })];
  }

  const tag = String(node.rawTagName || '').toLowerCase();
  if (['script', 'style', 'input', 'button', 'select', 'option'].includes(tag)) return [];
  if (tag === 'br') return [new TextRun({ break: 1 })];
  if (tag === 'img') {
    const image = readImage(node.getAttribute('src'), ctx);
    return image ? [image] : [];
  }
  const style = inlineStyleFor(node, inherited);
  return (node.childNodes || []).flatMap((child) => inlineRuns(child, ctx, style));
}

function alignmentFor(node) {
  const align = String(node.getAttribute?.('align') || '').toLowerCase();
  const style = String(node.getAttribute?.('style') || '').toLowerCase();
  if (align === 'center' || /text-align\s*:\s*center/.test(style)) return AlignmentType.CENTER;
  if (align === 'right' || /text-align\s*:\s*right/.test(style)) return AlignmentType.RIGHT;
  if (align === 'justify' || /text-align\s*:\s*justify/.test(style)) return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function paragraphFor(node, ctx, overrides = {}) {
  const runs = inlineRuns(node, ctx);
  const hasImage = (node.querySelectorAll?.('img') || []).length > 0 || String(node.rawTagName || '').toLowerCase() === 'img';
  const hasText = normalizedText(node).trim().length > 0;
  if (!hasImage && !hasText) return null;
  return new Paragraph({
    style: overrides.style || 'WorksheetBody',
    children: runs,
    alignment: hasImage && !hasText ? AlignmentType.CENTER : alignmentFor(node),
    indent: ctx.indent ? { left: ctx.indent } : undefined,
    spacing: overrides.spacing,
    keepNext: overrides.keepNext,
    keepLines: hasImage,
  });
}

function directTableRows(table) {
  const rows = [];
  const visit = (node) => {
    for (const child of node.childNodes || []) {
      const tag = String(child.rawTagName || '').toLowerCase();
      if (tag === 'table') continue;
      if (tag === 'tr') rows.push(child);
      else visit(child);
    }
  };
  visit(table);
  return rows;
}

function directCells(row) {
  return (row.childNodes || []).filter((node) => ['td', 'th'].includes(String(node.rawTagName || '').toLowerCase()));
}

function tableColumnWidths(rows, width) {
  const count = Math.max(1, ...rows.map((row) => directCells(row).reduce((sum, cell) => sum + (+cell.getAttribute('colspan') || 1), 0)));
  if (count === 2) {
    const firstTexts = rows.map((row) => normalizedText(directCells(row)[0]).trim().length).filter(Number.isFinite);
    const maxFirst = Math.max(0, ...firstTexts);
    if (maxFirst <= 8) return [Math.round(width * 0.13), width - Math.round(width * 0.13)];
  }
  const base = Math.floor(width / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? width - base * (count - 1) : base);
}

function distractorBlocks(node, ctx) {
  return directTableRows(node).flatMap((row) => {
    const cells = directCells(row);
    const meaningful = cells.filter((cell) => normalizedText(cell).trim());
    if (!meaningful.length) return [];
    const numberCell = meaningful.find((cell) => /^\d+[.)]$/.test(normalizedText(cell).trim()));
    const bodyCell = meaningful[meaningful.length - 1];
    const number = numberCell ? normalizedText(numberCell).trim() : '';
    const bodyRuns = inlineRuns(bodyCell, ctx);
    if (!number && !bodyRuns.length) return [];
    return [new Paragraph({
      style: 'WorksheetBody',
      children: [
        ...(number ? [new TextRun({ text: `${number} `, bold: true })] : []),
        ...bodyRuns,
      ],
      indent: { left: (ctx.indent || 0) + 360, hanging: 300 },
      spacing: { before: 0, after: 110, line: 276 },
      keepLines: true,
    })];
  });
}

function tableFor(node, ctx) {
  const rowNodes = directTableRows(node);
  if (!rowNodes.length) return null;
  const width = Math.max(1200, (ctx.availableWidth || CONTENT_WIDTH) - (ctx.indent || 0));
  const columnWidths = tableColumnWidths(rowNodes, width);
  const visibleGrid = (+node.getAttribute('border') || 0) > 0 || /msotablegrid|distractors-table|answer-table/i.test(node.getAttribute('class') || '');
  const borders = visibleGrid
    ? { top: gridBorder, bottom: gridBorder, left: gridBorder, right: gridBorder, insideHorizontal: gridBorder, insideVertical: gridBorder }
    : { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };

  const rows = rowNodes.map((rowNode, rowIndex) => {
    let colIndex = 0;
    const cells = directCells(rowNode).map((cellNode) => {
      const span = Math.max(1, +cellNode.getAttribute('colspan') || 1);
      const cellWidth = columnWidths.slice(colIndex, colIndex + span).reduce((sum, value) => sum + value, 0) || columnWidths[colIndex] || width;
      colIndex += span;
      const children = blocksFromNodes(cellNode.childNodes || [], {
        ...ctx,
        indent: 0,
        availableWidth: Math.max(600, cellWidth - 240),
        imageMaxWidth: Math.max(80, Math.round(cellWidth / 15)),
      });
      if (!children.length || children[children.length - 1] instanceof Table) {
        children.push(new Paragraph({ style: 'WorksheetBody', text: '' }));
      }
      const isHeader = String(cellNode.rawTagName || '').toLowerCase() === 'th';
      return new TableCell({
        children,
        columnSpan: span > 1 ? span : undefined,
        width: { size: cellWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        shading: isHeader ? { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' } : undefined,
        borders: visibleGrid ? undefined : { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      });
    });
    return new TableRow({ children: cells, cantSplit: false, tableHeader: rowIndex === 0 && directCells(rowNode).some((c) => String(c.rawTagName || '').toLowerCase() === 'th') });
  });

  return new Table({
    rows,
    width: { size: width, type: WidthType.DXA },
    indent: ctx.indent ? { size: ctx.indent, type: WidthType.DXA } : undefined,
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  });
}

function listBlocks(node, ctx, ordered) {
  const items = (node.childNodes || []).filter((child) => String(child.rawTagName || '').toLowerCase() === 'li');
  return items.map((item, index) => new Paragraph({
    style: 'WorksheetBody',
    children: [
      new TextRun({ text: ordered ? `${index + 1}. ` : '• ', bold: true }),
      ...inlineRuns(item, ctx),
    ],
    indent: { left: (ctx.indent || 0) + 360, hanging: 240 },
    spacing: { after: 80, line: 276 },
  }));
}

function blocksForElement(node, ctx) {
  const tag = String(node.rawTagName || '').toLowerCase();
  if (tag === 'table') {
    if (/\bdistractors-table\b/i.test(node.getAttribute('class') || '')) {
      return distractorBlocks(node, ctx);
    }
    const table = tableFor(node, ctx);
    return table ? [table, new Paragraph({ style: 'WorksheetBody', text: '', spacing: { after: 40 } })] : [];
  }
  if (tag === 'ul' || tag === 'ol') return listBlocks(node, ctx, tag === 'ol');
  if (tag === 'p' || tag === 'img' || /^h[1-6]$/.test(tag)) {
    const paragraph = paragraphFor(node, ctx, /^h[1-6]$/.test(tag) ? { style: 'WorksheetSubheading', keepNext: true } : {});
    return paragraph ? [paragraph] : [];
  }
  if (tag === 'blockquote') {
    return blocksFromNodes(node.childNodes || [], { ...ctx, indent: (ctx.indent || 0) + 280 });
  }
  return blocksFromNodes(node.childNodes || [], ctx);
}

function blocksFromNodes(nodes, ctx) {
  const blocks = [];
  let inline = [];
  const flush = () => {
    if (!inline.length) return;
    const fake = {
      nodeType: 1,
      rawTagName: 'p',
      childNodes: inline,
      text: inline.map((node) => normalizedText(node)).join(''),
      getAttribute: () => '',
      querySelectorAll: () => [],
    };
    const paragraph = paragraphFor(fake, ctx);
    if (paragraph) blocks.push(paragraph);
    inline = [];
  };
  for (const node of nodes) {
    const tag = String(node.rawTagName || '').toLowerCase();
    if (node.nodeType === 3 || (!blockTags.has(tag) && tag !== 'br')) {
      inline.push(node);
      continue;
    }
    if (tag === 'br') {
      inline.push(node);
      continue;
    }
    flush();
    blocks.push(...blocksForElement(node, ctx));
  }
  flush();
  return blocks;
}

function blocksFromHtml(html, ctx) {
  if (!html) return [];
  const root = parse(String(html), { lowerCaseTagName: true, comment: false });
  return blocksFromNodes(root.childNodes || [], ctx);
}

function taskTypeLabel(task) {
  if (task.kim != null) return `Задание ${task.kim}`;
  if (task.outdated) return 'Дополнительное задание';
  return task.answerType || 'Задание';
}

function taskKindLabel(task) {
  return String(task.group || task.answerType || '')
    .replace(/^Задани[ея]\s*[\d–-]+\s*[—-]\s*/i, '')
    .replace(/\s*\([^)]*устаревш[^)]*\)\s*/gi, '')
    .trim();
}

function taskBlocks(task, index, opts, outDir) {
  const label = taskTypeLabel(task);
  const kind = taskKindLabel(task);
  const children = [new Paragraph({
    style: 'TaskHeading',
    keepNext: true,
    children: [
      new TextRun({ text: `${index + 1}.`, bold: true, color: INK, size: 24 }),
      new TextRun({ text: `  ${label}`, bold: true, color: BLUE, size: 21 }),
      ...(kind ? [new TextRun({ text: `  ${kind}`, color: MUTED, size: 19 })] : []),
    ],
  })];
  if (task.hint) {
    children.push(new Paragraph({
      style: 'WorksheetHint',
      indent: { left: TASK_INDENT },
      children: [new TextRun({ text: task.hint, italics: true })],
    }));
  }
  const bodyCtx = { outDir, sourceDir: task.sourceDir, indent: TASK_INDENT, availableWidth: CONTENT_WIDTH, imageMaxWidth: 565, imageMaxHeight: 680 };
  children.push(...blocksFromHtml(task.questionHtml, bodyCtx));
  children.push(...blocksFromHtml(task.variantsHtml, bodyCtx));
  if (opts.answers === 'inline' && task.answer) {
    const answer = task.answerText && task.answerText !== task.answer ? `${task.answer} — ${task.answerText}` : task.answer;
    children.push(new Paragraph({
      style: 'WorksheetAnswer',
      indent: { left: TASK_INDENT },
      children: [new TextRun({ text: 'Ответ: ', bold: true }), new TextRun(answer)],
    }));
  }
  children.push(new Paragraph({
    text: '',
    spacing: { before: 40, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: RULE, space: 5 } },
  }));
  return children;
}

function groupedTasks(tasks) {
  const groups = [];
  for (const task of tasks) {
    const last = groups[groups.length - 1];
    if (task.groupId && last?.groupId === task.groupId) last.items.push(task);
    else groups.push({ groupId: task.groupId || '', items: [task] });
  }
  return groups;
}

function groupRange(items) {
  const nums = items.map((task) => task.kim).filter((value) => value != null);
  if (!nums.length) return 'задания по общему материалу';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `задание ${min}` : `задания ${min}–${max}`;
}

function groupMaterialLabel(items) {
  if (items.some((task) => task.groupKind === 'history-ege-map-9-12')) return 'Карта-схема';
  if (items.some((task) => (task.stimulusImages || []).length || (task.images || []).length)) return 'Общий иллюстративный материал';
  return 'Письменный источник';
}

function answerKeyBlocks(tasks) {
  const rows = [new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      new TableCell({
        width: { size: 780, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ style: 'AnswerHeader', alignment: AlignmentType.CENTER, text: '№' })],
      }),
      new TableCell({
        width: { size: CONTENT_WIDTH - 780, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ style: 'AnswerHeader', text: 'Ответ' })],
      }),
    ],
  })];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const answer = task.answer
      ? task.answerText && task.answerText !== task.answer ? `${task.answer} (${task.answerText})` : task.answer
      : '—';
    rows.push(new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 780, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ style: 'AnswerBody', alignment: AlignmentType.CENTER, text: String(i + 1) })],
        }),
        new TableCell({
          width: { size: CONTENT_WIDTH - 780, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ style: 'AnswerBody', text: answer })],
        }),
      ],
    }));
  }
  return [
    new Paragraph({ style: 'WorksheetTitle', pageBreakBefore: true, text: 'Ответы' }),
    new Table({
      rows,
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [780, CONTENT_WIDTH - 780],
      layout: TableLayoutType.FIXED,
      borders: { top: gridBorder, bottom: gridBorder, left: gridBorder, right: gridBorder, insideHorizontal: gridBorder, insideVertical: gridBorder },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    }),
  ];
}

async function renderWordDocument(tasks, opts, outDir) {
  const title = String(opts.title || 'Задания').trim();
  const subtitle = String(opts.subtitle || '').trim();
  const children = [
    new Paragraph({ style: 'WorksheetTitle', text: title }),
    ...(subtitle ? [new Paragraph({ style: 'WorksheetSubtitle', text: subtitle })] : []),
    new Paragraph({
      style: 'WorksheetStudentFields',
      text: 'Фамилия и имя ____________________________________    Класс ______    Дата ____________',
    }),
    new Paragraph({
      text: '',
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 6 } },
    }),
  ];

  let taskIndex = 0;
  let groupIndex = 0;
  for (const group of groupedTasks(tasks)) {
    if (group.groupId) {
      groupIndex++;
      children.push(new Paragraph({
        style: 'GroupHeading',
        pageBreakBefore: groupIndex > 1,
        keepNext: true,
        children: [
          new TextRun({ text: `Комплект ${groupIndex}`, bold: true, color: BLUE }),
          new TextRun({ text: `  ·  ${groupRange(group.items)}`, color: MUTED }),
        ],
      }));
      const stimulusItem = group.items.find((task) => task.stimulusHtml);
      if (stimulusItem) {
        children.push(new Paragraph({ style: 'MaterialLabel', keepNext: true, text: groupMaterialLabel(group.items) }));
        children.push(...blocksFromHtml(stimulusItem.stimulusHtml, {
          outDir,
          sourceDir: stimulusItem.stimulusSourceDir || stimulusItem.sourceDir,
          indent: 0,
          availableWidth: CONTENT_WIDTH,
          imageMaxWidth: 610,
          imageMaxHeight: 760,
        }));
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }
    }
    for (const task of group.items) {
      children.push(...taskBlocks(task, taskIndex++, opts, outDir));
    }
  }
  if (opts.answers === 'end' && tasks.some((task) => task.answer)) children.push(...answerKeyBlocks(tasks));

  const document = new Document({
    creator: 'Конструктор заданий ФИПИ',
    title,
    description: subtitle,
    styles: {
      default: {
        document: {
          run: { font: 'Georgia', size: 22, color: INK },
          paragraph: { spacing: { after: 100, line: 276 }, widowControl: true },
        },
      },
      paragraphStyles: [
        { id: 'WorksheetTitle', name: 'Worksheet Title', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Georgia', size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 0, after: 80 }, keepNext: true } },
        { id: 'WorksheetSubtitle', name: 'Worksheet Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 19, color: MUTED }, paragraph: { spacing: { before: 0, after: 40 }, keepNext: true } },
        { id: 'WorksheetStudentFields', name: 'Worksheet Student Fields', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 18, color: INK }, paragraph: { spacing: { before: 100, after: 40 }, keepNext: true } },
        { id: 'GroupHeading', name: 'Group Heading', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 22, bold: true, color: BLUE }, paragraph: { spacing: { before: 120, after: 100 }, keepNext: true } },
        { id: 'MaterialLabel', name: 'Material Label', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 18, bold: true, color: MUTED, allCaps: true }, paragraph: { spacing: { before: 40, after: 80 }, keepNext: true } },
        { id: 'TaskHeading', name: 'Task Heading', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 21, color: BLUE }, paragraph: { spacing: { before: 80, after: 80 }, keepNext: true } },
        { id: 'WorksheetBody', name: 'Worksheet Body', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Georgia', size: 22, color: INK }, paragraph: { spacing: { before: 0, after: 100, line: 276 }, widowControl: true } },
        { id: 'WorksheetSubheading', name: 'Worksheet Subheading', basedOn: 'WorksheetBody', next: 'WorksheetBody', quickFormat: true,
          run: { font: 'Georgia', size: 22, bold: true, color: INK }, paragraph: { spacing: { before: 80, after: 80 }, keepNext: true } },
        { id: 'WorksheetHint', name: 'Worksheet Hint', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Georgia', size: 19, italics: true, color: MUTED }, paragraph: { spacing: { before: 0, after: 80 } } },
        { id: 'WorksheetAnswer', name: 'Worksheet Answer', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 20, color: INK }, paragraph: { spacing: { before: 80, after: 80 }, shading: { type: ShadingType.CLEAR, fill: LIGHT, color: 'auto' } } },
        { id: 'AnswerHeader', name: 'Answer Header', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Arial', size: 19, bold: true, color: INK }, paragraph: { spacing: { before: 0, after: 0 } } },
        { id: 'AnswerBody', name: 'Answer Body', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Georgia', size: 19, color: INK }, paragraph: { spacing: { before: 0, after: 0 } } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: {
            top: PAGE.marginTop,
            right: PAGE.marginRight,
            bottom: PAGE.marginBottom,
            left: PAGE.marginLeft,
            header: 420,
            footer: 520,
          },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 40, after: 0 },
            children: [
              new TextRun({ text: `${title}  ·  `, font: 'Arial', size: 16, color: MUTED }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: MUTED }),
            ],
          })],
        }),
      },
      children,
    }],
  });
  return Packer.toBuffer(document);
}

module.exports = {
  CONTENT_WIDTH,
  blocksFromHtml,
  renderWordDocument,
};
