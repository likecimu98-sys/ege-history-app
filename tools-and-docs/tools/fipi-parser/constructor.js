/*
 * Конструктор заданий: из скачанных выгрузок (output/*) собирает наборы
 * заданий по экзамену / предмету / номеру задания КИМ / темам и отдаёт
 * готовый документ (печатный HTML и Word .doc) с ключом ответов в конце.
 *
 * Модуль без внешних зависимостей. Подключается из server.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ============ 1. Чтение библиотеки выгрузок ============ */

// Определяет экзамен/предмет по метаданным выгрузки и имени папки.
function inferExamSubject(dirName, data) {
  let exam = data.exam;
  if (exam !== 'ege' && exam !== 'oge') {
    exam = /(^|\W)(oge|огэ)(\W|$)/i.test(dirName) ? 'oge' : 'ege';
  }
  const subject = data.subject || (/обществ/i.test(dirName) ? 'Обществознание' : 'История');
  return { exam, subject };
}

// Сканирует OUT_DIR: читает все задания.json, склеивает и убирает дубли.
// Приоритет при дублях — у задания с ответом и с более богатым html.
function scanLibrary(outDir) {
  const sources = [];
  let entries = [];
  try {
    entries = fs.readdirSync(outDir, { withFileTypes: true });
  } catch {
    return { tasks: [], sources: [] };
  }
  const byKey = new Map(); // exam|subject|number -> task

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = ent.name;
    const file = path.join(outDir, dir, 'задания.json');
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(data.tasks)) continue;
    let sourceTime = Date.parse(data.exportedAt || '');
    if (!Number.isFinite(sourceTime)) {
      try {
        sourceTime = fs.statSync(file).mtimeMs;
      } catch {
        sourceTime = 0;
      }
    }
    const { exam, subject } = inferExamSubject(dir, data);
    let added = 0;
    for (const t of data.tasks) {
      if (!t || !t.number) continue;
      const key = `${exam}|${subject}|${t.number}`;
      const bogusStimulus = /загрузка\s+заданий|loading[_-]?(?:spinner|indicator)|ajax[_-]?loader/i.test(`${t.stimulusHtml || ''} ${t.stimulusText || ''}`);
      const enriched = {
        exam,
        subject,
        sourceDir: dir,
        sourceTime,
        number: t.number,
        answerType: t.answerType || '',
        kes: (Array.isArray(t.kes) ? t.kes : []).filter(isRealKes),
        groupId: t.groupId || '', // группа «одного материала» (карта/источник)
        groupOrder: t.groupOrder || 0,
        groupUrl: t.groupUrl || '',
        stimulusHtml: bogusStimulus ? '' : (t.stimulusHtml || ''),
        stimulusText: bogusStimulus ? '' : (t.stimulusText || ''),
        stimulusImages: bogusStimulus ? [] : (Array.isArray(t.stimulusImages) ? t.stimulusImages : []),
        stimulusSourceDir: t.stimulusSourceDir || dir,
        hint: t.hint || '',
        questionHtml: t.questionHtml || '',
        variantsHtml: t.variantsHtml || '',
        questionText: t.questionText || '',
        images: Array.isArray(t.images) ? t.images : [],
        answer: t.answer || null,
        answerText: t.answerText || '',
      };
      const prev = byKey.get(key);
      byKey.set(key, prev ? mergeEnrichedTasks(prev, enriched) : enriched);
      added++;
    }
    sources.push({ dir, exam, subject, count: data.tasks.length, added });
  }

  const tasks = [...byKey.values()];
  annotateTaskGroups(tasks);
  for (const t of tasks) {
    t.periods = periodsOf(t);
    const cls = classify(t);
    t.kim = cls.kim;
    t.group = cls.group;
    t.outdated = !!cls.outdated;
  }
  return { tasks, sources };
}

// Номер задания ЕГЭ нельзя надёжно определить по одному слову в формулировке.
// Сначала восстанавливаем структуру групп с общим материалом, затем классифицируем
// каждый вопрос по его месту в группе.
function annotateTaskGroups(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    t.groupKind = '';
    t.groupSize = 0;
    t.groupOrders = [];
    if (!t.groupId) continue;
    const key = `${t.exam}|${t.subject}|${t.groupId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  for (const members of groups.values()) {
    const orders = [...new Set(members.map((t) => +t.groupOrder).filter(Boolean))].sort((a, b) => a - b);
    for (const t of members) {
      t.groupSize = members.length;
      t.groupOrders = orders;
    }

    const first = members[0];
    if (first.exam !== 'ege' || !/истори/i.test(first.subject)) continue;
    const byOrder = new Map(members.map((t) => [+t.groupOrder, t]));
    const exactOrders = members.length === 4 && orders.join(',') === '1,2,3,4' && byOrder.size === 4;
    const exactTypes = exactOrders && [1, 2, 3].every((n) => byOrder.get(n)?.answerType === 'Краткий ответ') &&
      byOrder.get(4)?.answerType === 'Выбор ответов из предложенных вариантов';
    const groupText = norm(members.map((t) => `${t.stimulusText || ''} ${t.questionText || t.questionHtml || ''}`).join(' '));
    const hasMapMaterial = /(схем[аеуы]|схемой|схему|легенд[аеы]\s+схем|карт[аеуы](?![а-яё])|картосхем)/.test(groupText);
    if (exactTypes && hasMapMaterial) {
      for (const t of members) t.groupKind = 'history-ege-map-9-12';
      continue;
    }

    // В старых версиях ЕГЭ к одному письменному источнику шли три вопроса.
    // В КИМ-2026 осталась пара 13–14; третий вопрос нельзя повторно считать № 14.
    const exactLegacySourceOrders = members.length === 3 && orders.join(',') === '1,2,3' && byOrder.size === 3;
    const allExtended = members.every((t) => t.answerType === 'Развернутый ответ');
    const hasSourceMaterial = /отрыв|(?<![а-яё])текст|документ|источник|летопис|манифест|воспоминани|(?<![а-яё])письм|стать[яеи]|доклад|обращени|послани|фрагмент|челобитн|мемуар|дневник|записк/.test(groupText);
    if (exactLegacySourceOrders && allExtended && hasSourceMaterial) {
      for (const t of members) t.groupKind = 'history-ege-source-legacy-triple';
    }
  }
}

function score(t) {
  return (t.answer ? 2 : 0) + (t.questionHtml ? 1 : 0) + (t.stimulusHtml ? 2 : 0) + (t.groupId ? 0.25 : 0) + t.images.length * 0.1;
}

function mergeEnrichedTasks(a, b) {
  const scoreA = score(a);
  const scoreB = score(b);
  const primary = scoreB > scoreA || (scoreB === scoreA && (b.sourceTime || 0) > (a.sourceTime || 0)) ? b : a;
  const secondary = primary === a ? b : a;
  const merged = { ...primary };
  for (const field of ['answer', 'answerText', 'groupId', 'groupOrder', 'groupUrl', 'stimulusHtml', 'stimulusText']) {
    if (!merged[field] && secondary[field]) merged[field] = secondary[field];
  }
  if (!merged.stimulusHtml && secondary.stimulusHtml) merged.stimulusHtml = secondary.stimulusHtml;
  if (merged.stimulusHtml === secondary.stimulusHtml && secondary.stimulusHtml) {
    merged.stimulusImages = secondary.stimulusImages || [];
    merged.stimulusSourceDir = secondary.stimulusSourceDir || secondary.sourceDir;
  }
  return merged;
}

// Банк ФИПИ иногда добавляет к КЭС служебные строки (второй классификатор:
// «тип К5», «Документы 2016 года», «Инструкции и постинструкции 2016 г.») —
// они не относятся к разделам содержания и ломают фильтр по периодам.
function isRealKes(k) {
  return !/(^|\s)(тип\s+К\d|Документы\s+\d{4}|Инструкции\s+и\s+постинструкции)/i.test(String(k || ''));
}

// Ведущие номера разделов КЭС (периоды для истории / блоки для общества).
function periodsOf(t) {
  const set = new Set();
  for (const k of t.kes) {
    const m = String(k).match(/^\s*(\d+)/);
    if (m) set.add(+m[1]);
  }
  return [...set].sort((a, b) => a - b);
}

/* ============ 2. Классификация по номеру задания КИМ ============ */

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function classify(t) {
  if (/истори/i.test(t.subject)) {
    return t.exam === 'oge' ? classifyHistoryOge(t) : classifyHistoryEge(t);
  }
  if (/обществ/i.test(t.subject)) {
    return t.exam === 'oge' ? classifySocialOge(t) : classifySocialEge(t);
  }
  return { kim: null, group: t.answerType || 'Задания' };
}

// ЕГЭ История — формат КИМ 2026 (сверено со сборником Артасова, 30 вариантов).
// Часть 1 (1–12): 1 событие↔год, 2 хронология, 3 процесс↔факт, 4 таблица,
// 5 событие↔участник, 6 письменный источник+суждения, 7 культура,
// 8 изображение (марка/монета/плакат), 9–11 карта (краткий), 12 карта+суждения.
// Часть 2 (13–21) — развёрнутые. Форматы, которых в КИМ 2026 нет, помечаются
// как устаревшие (outdated): пропуски-в-предложениях (старое зад.8), распределение и др.
function classifyHistoryEge(t) {
  const p = norm(t.questionText || t.questionHtml);
  const type = t.answerType;
  const hasImg = t.images.length > 0 || (t.stimulusImages || []).length > 0;

  // В КИМ-2026 карта образует один блок из четырёх вопросов. Только эта
  // структурная сигнатура даёт номера 9–12; отдельные слова «обозначен» и
  // «изображение» встречаются также в культуре, монетах, марках и плакатах.
  if (t.groupKind === 'history-ege-map-9-12') {
    const n = 8 + t.groupOrder;
    return kim(n, n === 12
      ? 'Задание 12 — карта: верные суждения'
      : `Задание ${n} — работа с исторической картой`);
  }

  if (type === 'Последовательность') return kim(2, 'Задание 2 — хронологическая последовательность');

  if (type === 'Установление соответствия') {
    if (/между событиями и (годами|десятилетиями)/.test(p)) return kim(1, 'Задание 1 — событие ↔ год');
    if (/между процессами.*и фактами/.test(p)) return kim(3, 'Задание 3 — процесс ↔ факт');
    if (/между событиями.*и.*участниками/.test(p)) return kim(5, 'Задание 5 — событие ↔ участник');
    if (/между (памятниками культуры|литературными произведениями|произведениями культуры|памятниками архитектуры|памятниками литературы).*характеристиками/.test(p))
      return kim(7, 'Задание 7 — памятник культуры ↔ характеристика');
    return old('Соответствие (устаревший формат, нет в КИМ 2026)');
  }

  if (type === 'Расстановка терминов') {
    if (/пустые ячейки таблицы/.test(p)) {
      // актуальное задание 4 — таблица с географическим объектом;
      // старая «век-таблица» (Век / столетие) из КИМ 2026 убрана
      if (/географическ/.test(p)) return kim(4, 'Задание 4 — заполнение таблицы');
      return old('Таблица «Век» (устаревший формат, нет в КИМ 2026)');
    }
    // «пропуски в предложениях» (в т.ч. про ВОВ) — старое задание 8, в 2026 его нет
    return old('Пропуски в предложениях (старое задание 8, нет в КИМ 2026)');
  }

  if (type === 'Распределение') return old('Распределение по группам (устаревший формат)');

  const isSource = /(прочтите|отрывок|из сочинения|из воспоминаний|из документа|из указа|из письма|из работы|используя (отрывок|текст)|данн(ый|ого) (текст|источник))/.test(p);
  // № 8 в КИМ-2026 — одиночный вопрос по одному изображению. Старые пары
  // «марка/монета + выберите два памятника» имеют groupId и к № 8 не относятся.
  const isPicture = !t.groupId && hasImg && /(рассмотрите изображение|на (почтовой )?марке|данн(ая|ый|ое) (марк|монет|плакат|фотограф|карикатур|изображени)|марк[аеи](?![а-яё])|монет|плакат|карикатур|репродукц|изображённ|на изображении)/.test(p);

  if (type === 'Краткий ответ') {
    if (isPicture) return kim(8, 'Задание 8 — работа с изображением (марка/монета/плакат)');
    return old('Краткий ответ — термин/иное (нет в части 1 КИМ 2026)');
  }

  if (type === 'Выбор ответов из предложенных вариантов') {
    if (isSource) return kim(6, 'Задание 6 — письменный источник: верные суждения');
    if (isPicture) return old('Изображение — верные суждения (устаревший формат)');
    return old('Выбор верных суждений (устаревший формат)');
  }

  if (type === 'Развернутый ответ') return classifyHistoryEgePart2(t, p);
  return group(t.answerType || 'Прочее');
}

// Часть 2 ЕГЭ История (13–21), формат 2026 (сверено по вариантам Артасова):
// 13 атрибуция письм. источника, 14 анализ письм. источника,
// 15 датировка изображения + обоснование, 16 выбор изображения + автор,
// 17 два источника (сравнение), 18 причины/последствия события,
// 19 смысл понятия, 20 тезис о различиях, 21 аргументация (Россия/зарубежье).
// Убраны из КИМ 2026 → outdated: историческое сочинение (эссе), «аргументы
// за/против точки зрения» (старое зад.24), «историческая ситуация».
function classifyHistoryEgePart2(t, p) {
  const hasImg = t.images.length > 0;

  // — устаревшие форматы части 2 —
  if (/историческое сочинение/.test(p))
    return old('Историческое сочинение (эссе, убрано из ЕГЭ с 2023)');
  if ((/подтвердить|в подтверждение/.test(p) && /опроверг/.test(p)) ||
      /высказываются различн/.test(p) || /дискуссионн/.test(p))
    return old('Аргументы за/против точки зрения (старый формат, до 2023)');
  if (/рассмотрите (историческую )?ситуацию/.test(p))
    return old('Историческая ситуация (старый формат)');

  // Старая группа по одному источнику состояла из трёх вопросов. Для формата
  // 2026 сохраняем только соответствие первых двух современным № 13 и № 14.
  if (t.groupKind === 'history-ege-source-legacy-triple') {
    if (t.groupOrder === 1) return kim(13, 'Задание 13 — атрибуция письменного источника');
    if (t.groupOrder === 2) return kim(14, 'Задание 14 — анализ письменного источника');
    return old('Дополнительный вопрос к письменному источнику (старый формат, нет в КИМ 2026)');
  }

  // — 21: аргументация (один для России и один для зарубежной истории) —
  if (/приведите аргументы в подтверждение точки зрения/.test(p) ||
      (/аргумент/.test(p) && /один аргумент для|для россии и один|один\s*[—–-]\s*для/.test(p)))
    return kim(21, 'Задание 21 — аргументация (Россия и зарубежье)');

  // — 20: тезис о различиях + два обоснования —
  if (/запишите один любой тезис/.test(p) || /обоснования (этого )?тезиса/.test(p) ||
      /информацию о различиях/.test(p) || (/(?<![а-яё])тезис(?![а-яё])/.test(p) && /обоснован/.test(p)))
    return kim(20, 'Задание 20 — тезис о различиях + обоснования');

  // — 19: смысл понятия + факт —
  if (/смысл понятия/.test(p)) return kim(19, 'Задание 19 — смысл понятия + факт');

  // — 17: сравнение двух источников —
  if (/прочтите отрывки|фрагменты источников/.test(p))
    return kim(17, 'Задание 17 — работа с двумя источниками');

  // — 15/16: работа с изображением (марка/медаль/монета/плакат) —
  const choose = /из представленных ниже/.test(p) && /запишите цифр|укажите цифр/.test(p);
  if (choose) return kim(16, 'Задание 16 — выбор изображения + автор');
  if (/используя изображени\S*[^.]*обоснование|приведите одно любое обоснование|обоснование вашего ответа/.test(p) ||
      (hasImg && /изображ|марк|медал|монет|плакат|жетон|календар|нагрудный знак/.test(p)))
    return kim(15, 'Задание 15 — датировка изображения + обоснование');

  // — ссылка на письменный источник. Используем корни слов (а не словоформы):
  //   «отрыв» ловит отрывок/отрывке/отрывка, «текст» — текст/тексте и т.д.
  //   Границу слова задаём через (?<![а-яё]) / (?![а-яё]) — \b с кириллицей НЕ работает.
  const srcRef = /отрыв|(?<![а-яё])текст|документ|источник|летопис|манифест|грамот|воспоминани|(?<![а-яё])письм|стать[яеи]|доклад|(?<![а-яё])речь(?![а-яё])|обращени|послани|(?<![а-яё])автор|повеств|фрагмент|(?<![а-яё])указ(?![а-яё])|(?<![а-яё])указ[аеу](?![а-яё])|челобитн|переписк|мемуар|дневник|хроник|записк|постановлени|о котор\S* идёт речь|имя которого (пропущ|заретушир)|(дважды|трижды) пропущ|согласно (текст|документ|летопис|источник|записк|отрыв)|упоминаем\S* в (тексте|отрывк|документ)|упомянут\S* в (тексте|отрывк|документ)|в этом тексте|описываем\S* событ|описанны\S* событ|данн\S+ (постановлени|указ|манифест|обращени|послани|доклад|стать|речь|записк|отрыв|фрагмент|документ|конференци)/.test(p);

  // «Три X» / «не менее трёх» — задание-перечисление (18 либо извлечение из источника → 14).
  const listing = /не менее (трёх|трех|двух|3|2)|(три|две|два) любы|любы[ех] (три|две|два)|(?<![а-яё])(три|две|два)(?![а-яё]) любы|(укаж\S*|назов\S*|привед\S*|выпиш\S*) (любы[ех] )?(три|две|два|не менее)|(укаж\S*|назов\S*) (любы[ех] )?(три|два)/.test(p);

  if (srcRef) {
    // 14 — анализ/извлечение из источника; 13 — атрибуция/датировка
    const isAnalysis = listing ||
      /по мнению автора|как автор|автор (пишет|считает|называ|объясня|утвержда|оценива|выдвига|указыва|свидетельств|отмеча|описыва)|используя (текст|документ|отрыв|данн\S+ отрыв|источник|письмо|фрагмент|записк)|на основе (текст|источник|документ)|привлекая .{0,25}знани|согласно (текст|документ|летопис|источник|записк|отрыв)|каким\S* образ|какими способ|(?<![а-яё])почему(?![а-яё])|(?<![а-яё])какие(?![а-яё])|(?<![а-яё])каков|(?<![а-яё])чём(?![а-яё])|(?<![а-яё])чем(?![а-яё])|как, по|на каких (услови|основани)/.test(p);
    if (isAnalysis) return kim(14, 'Задание 14 — анализ письменного источника');
    return kim(13, 'Задание 13 — атрибуция письменного источника');
  }

  // — 18: причинно-следственные связи / перечисление по событию (без источника) —
  if (listing || /(последстви|причин|предпосыл)/.test(p))
    return kim(18, 'Задание 18 — причины/последствия/факты о событии');

  return group('Часть 2 — развёрнутый ответ (13–21)');
}

// ОГЭ История: пока группируем по типу ответа (номера уточним позже).
function classifyHistoryOge(t) {
  if (t.answerType === 'Последовательность') return group('Последовательность');
  if (t.answerType === 'Установление соответствия') return group('Установление соответствия');
  if (t.answerType === 'Развернутый ответ') return group('Развёрнутый ответ');
  return group(t.answerType || 'Прочее');
}

// Обществознание: КЭС верхнего уровня = содержательный блок.
// ЕГЭ: 1 Человек/общество → задания 2–4, 2 Экономика → 5–7, 3 Социальная → 8–9,
// 4 Политика → 10–13, 5 Право → 14–16 (точный номер внутри блока не выводим —
// показываем блок; плюс задание 1 может быть на любую тему).
const SOCIAL_EGE_BLOCK = {
  1: 'Блок «Человек и общество» (задания 2–4)',
  2: 'Блок «Экономика» (задания 5–7)',
  3: 'Блок «Социальные отношения» (задания 8–9)',
  4: 'Блок «Политика» (задания 10–13)',
  5: 'Блок «Право» (задания 14–16)',
};
function classifySocialEge(t) {
  if (t.answerType === 'Развернутый ответ') return group('Часть 2 — развёрнутый ответ (задания 17–25)');
  const b = t.periods.find((n) => SOCIAL_EGE_BLOCK[n]);
  if (b) return group(SOCIAL_EGE_BLOCK[b]);
  return group(t.answerType || 'Прочее');
}

const SOCIAL_OGE_BLOCK = {
  1: 'Блок «Человек и общество»',
  2: 'Блок «Сфера духовной культуры»',
  3: 'Блок «Экономика»',
  4: 'Блок «Социальная сфера»',
  5: 'Блок «Политика и право»',
};
function classifySocialOge(t) {
  if (t.answerType === 'Развернутый ответ') return group('Развёрнутый ответ');
  const b = t.periods.find((n) => SOCIAL_OGE_BLOCK[n]);
  if (b) return group(SOCIAL_OGE_BLOCK[b]);
  return group(t.answerType || 'Прочее');
}

function kim(n, label) {
  return { kim: n, group: label, outdated: false };
}
function group(label) {
  return { kim: null, group: label, outdated: false };
}
// формат, которого в актуальном КИМ (2026) нет — «устаревшее задание»
function old(label) {
  return { kim: null, group: label, outdated: true };
}

/* ============ 3. Сборка документа ============ */

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Встраивает картинки как data:URI, чтобы файл был самодостаточным.
function inlineImages(html, outDir, sourceDir) {
  return html.replace(/src=(["'])(images\/[^"']+)\1/gi, (whole, q, rel) => {
    try {
      const abs = path.join(outDir, sourceDir, rel);
      const buf = fs.readFileSync(abs);
      const ext = path.extname(rel).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      return `src="data:image/${mime};base64,${buf.toString('base64')}"`;
    } catch {
      return whole; // файла нет — оставляем как есть
    }
  });
}

function typeBadgeHtml(t) {
  const name = esc(String(t.group || t.answerType || '').replace(/^Задани[ея]\s*[\d–-]+\s*[—-]\s*/i, ''));
  const label = t.kim != null ? `Задание ${t.kim}` : t.outdated ? 'Дополнительное задание' : (t.answerType || 'Задание');
  return `<span class="task-type">${esc(label)}</span>${name ? ` <span class="task-kind">${name}</span>` : ''}`;
}

function taskCardHtml(t, i, outDir, showAnswerInline) {
  const q = inlineImages(t.questionHtml, outDir, t.sourceDir);
  const v = t.variantsHtml ? inlineImages(t.variantsHtml, outDir, t.sourceDir) : '';
  return `
<div class="task${t.outdated ? ' task-old' : ''}">
  <div class="task-head"><span class="task-no">${i + 1}.</span><span>${typeBadgeHtml(t)}</span></div>
  ${t.hint ? `<div class="task-hint">${esc(t.hint)}</div>` : ''}
  <div class="task-body">${q}</div>
  ${v ? `<div class="task-body">${v}</div>` : ''}
  ${showAnswerInline && t.answer ? `<div class="task-answer"><b>Ответ:</b> ${esc(t.answer)}${t.answerText && t.answerText !== t.answer ? ' — ' + esc(t.answerText) : ''}</div>` : ''}
</div>`;
}

function answerKeyHtml(tasks) {
  const rows = tasks
    .map((t, i) => {
      const a = t.answer ? esc(t.answer) + (t.answerText && t.answerText !== t.answer ? ` (${esc(t.answerText)})` : '') : '—';
      return `<tr><td class="ak-no">${i + 1}</td><td>${a}</td></tr>`;
    })
    .join('');
  return `
<div class="answer-key">
  <h2>Ответы</h2>
  <table class="ak">
    <thead><tr><td>№</td><td>Ответ</td></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

const DOC_CSS = `
  :root{--ink:#17212b;--blue:#244e73;--muted:#647180;--rule:#ccd5de;--paper:#fff;--canvas:#edf1f5}
  *{box-sizing:border-box}
  html{background:var(--canvas)}
  body{font-family:Georgia,'Times New Roman',serif;color:var(--ink);font-size:11.25pt;line-height:1.42;max-width:190mm;margin:18px auto;padding:18mm 17mm 20mm;background:var(--paper);box-shadow:0 2px 18px rgba(23,33,43,.12)}
  h1{font-size:20pt;line-height:1.15;letter-spacing:0;margin:0 0 3mm;color:var(--ink)}
  .doc-sub{font-family:Arial,sans-serif;color:var(--muted);font-size:9.5pt;margin:0 0 4mm}
  .student-fields{display:flex;gap:8mm;flex-wrap:wrap;font-family:Arial,sans-serif;font-size:9.5pt;color:#374553;margin:0 0 5mm;padding-bottom:4mm;border-bottom:1.5pt solid var(--blue)}
  .student-fields .name{flex:1;min-width:80mm}
  .task{position:relative;margin:0 0 6mm;padding:0 0 4mm 9mm;border-bottom:.6pt solid var(--rule);page-break-inside:auto;break-inside:auto}
  .task-head{display:grid;grid-template-columns:8mm minmax(0,1fr);gap:1mm;margin:0 0 2.5mm -9mm;font-family:Arial,sans-serif;line-height:1.25}
  .task-no{font-weight:700;font-size:11.5pt;color:var(--ink)}
  .task-type{font-size:10pt;font-weight:700;color:var(--blue)}
  .task-kind{font-size:9.5pt;color:var(--muted)}
  .task-old .task-type{color:#7f1d1d}
  .task-hint{font-style:italic;color:var(--muted);font-size:9.5pt;margin:0 0 2mm}
  .task-body{margin:0;max-width:100%;overflow:visible}
  .task-body+ .task-body{margin-top:2mm}
  .task-body img{display:block;max-width:100%;max-height:235mm;width:auto;height:auto;margin:3mm auto;page-break-inside:avoid;break-inside:avoid}
  .task-body table{border-collapse:collapse;max-width:100%;table-layout:auto}
  .task-body table[border="1"] td,.task-body table[border="1"] th{border:.6pt solid #9ca8b3;padding:2mm}
  .task-body p{margin:0 0 2.2mm}
  .task-body td p,.task-body td .MsoNormal{margin:0}
  .task-body td{vertical-align:top;padding:.8mm 1mm}
  .task-body .distractors-table{width:100%;border:0;table-layout:auto}
  .task-body .distractors-table tr{break-inside:avoid;page-break-inside:avoid}
  .task-body .distractors-table td{border:0;padding:1mm 0;vertical-align:top}
  .task-body .distractors-table td:first-child{display:none}
  .task-body .distractors-table td:nth-child(2){width:10mm;padding-right:1.5mm;font-weight:700;white-space:nowrap}
  .gap{display:inline-block;min-width:20mm;border-bottom:.7pt solid #111;padding:0 3mm}
  .task-answer{margin-top:3mm;padding:2.5mm 3mm;background:#f1f4f6;border-left:2pt solid var(--blue);font-family:Arial,sans-serif;font-size:10pt}
  .task-group{margin:0;page-break-inside:auto;break-inside:auto}
  .task-group.new-page{page-break-before:always;break-before:page}
  .group-head{font-family:Arial,sans-serif;font-size:11pt;font-weight:700;color:var(--blue);margin:0 0 4mm;padding-top:1mm}
  .group-material-label{font-family:Arial,sans-serif;font-size:9pt;font-weight:700;text-transform:uppercase;color:var(--muted);margin:0 0 2mm}
  .group-stimulus{margin:0 0 6mm;padding:0;overflow:visible}
  .group-stimulus img{display:block;max-width:100%;max-height:240mm;width:auto;height:auto;margin:3mm auto;page-break-inside:avoid;break-inside:avoid}
  .group-stimulus p{margin:0 0 2.2mm}
  .stimulus-missing{border:1pt dashed #b7791f;background:#fffaf0;color:#7c4a03;padding:3mm;margin:0 0 5mm;font-size:10pt;text-align:center}
  .stimulus-missing a{color:var(--blue)}
  .answer-key{page-break-before:always;break-before:page;margin-top:0}
  .answer-key h2{font-size:17pt;margin:0 0 5mm}
  table.ak{width:100%;border-collapse:collapse;font-size:10pt}
  table.ak td{border:.6pt solid #aeb9c4;padding:2mm 3mm;vertical-align:top}
  table.ak thead td{background:#edf2f6;font-family:Arial,sans-serif;font-weight:700}
  table.ak td:first-child{width:13mm;text-align:center;font-weight:700}
`;

// Задания одной группы (общий материал: карта/источник) заворачиваем в общий
// блок, чтобы визуально было видно — они идут вместе. Для карт, которых банк не
// отдаёт, показываем заметный плейсхолдер «вставьте схему».
function groupBoxHtml(items, inner, outDir, setNo, newPage) {
  const nums = items.map((t) => t.kim).filter((x) => x != null);
  const range = nums.length
    ? Math.min(...nums) === Math.max(...nums)
      ? `Задание ${nums[0]}`
      : `Задания ${Math.min(...nums)}–${Math.max(...nums)}`
    : 'Задания по общему материалу';
  const stimulusItem = items.find((t) => t.stimulusHtml);
  const stimulus = stimulusItem
    ? inlineImages(stimulusItem.stimulusHtml, outDir, stimulusItem.stimulusSourceDir || stimulusItem.sourceDir)
    : '';
  const hasImg = items.some((t) => t.images.length > 0 || (t.stimulusImages || []).length > 0);
  const isMap = items.some((t) => t.groupKind === 'history-ege-map-9-12');
  const isSource = items.some((t) => /данн(ый|ого) (текст|источник)|манифест|документ|отрывок|по мнению автора|используя текст/i.test(t.questionText));
  const groupUrl = items.find((t) => t.groupUrl)?.groupUrl || '';
  const link = groupUrl ? ` <a href="${esc(groupUrl)}" target="_blank" rel="noopener">Открыть группу в ФИПИ</a>` : '';
  let placeholder = '';
  if (!stimulus && isMap && !hasImg) placeholder = `<div class="stimulus-missing">Карта-схема не была получена при загрузке.${link}</div>`;
  else if (!stimulus && isSource) placeholder = `<div class="stimulus-missing">Общий текст источника не был получен при загрузке.${link}</div>`;
  const materialLabel = isMap ? 'Карта-схема' : hasImg ? 'Общий иллюстративный материал' : 'Письменный источник';
  return `<div class="task-group${newPage ? ' new-page' : ''}">
  <div class="group-head">Комплект ${setNo} · ${esc(range)}</div>
  ${stimulus ? `<div class="group-material-label">${materialLabel}</div><div class="group-stimulus">${stimulus}</div>` : ''}
  ${placeholder}
  ${inner}
</div>`;
}

// Разбивает список на подряд идущие группы (по groupId) и рендерит,
// сохраняя сквозную нумерацию заданий.
function renderCards(tasks, outDir, inline) {
  const groups = [];
  for (const t of tasks) {
    const last = groups[groups.length - 1];
    if (t.groupId && last && last.groupId === t.groupId) last.items.push(t);
    else groups.push({ groupId: t.groupId || '', items: [t] });
  }
  let n = 0;
  let setNo = 0;
  let rendered = false;
  return groups
    .map((g) => {
      if (g.items.length <= 1 && !g.groupId) {
        rendered = true;
        return taskCardHtml(g.items[0], n++, outDir, inline);
      }
      const inner = g.items.map((t) => taskCardHtml(t, n++, outDir, inline)).join('\n');
      const html = groupBoxHtml(g.items, inner, outDir, ++setNo, rendered);
      rendered = true;
      return html;
    })
    .join('\n');
}

// title — заголовок, tasks — уже отобранные и упорядоченные задания.
function renderDocument(tasks, opts, outDir) {
  const answersMode = opts.answers || 'end'; // 'end' | 'inline' | 'none'
  const inline = answersMode === 'inline';
  const cards = renderCards(tasks, outDir, inline);
  const key = answersMode === 'end' && tasks.some((task) => task.answer) ? answerKeyHtml(tasks) : '';
  const sub = esc(opts.subtitle || '');
  const forWord = opts.forWord;

  const printBtn = forWord
    ? ''
    : `<div class="toolbar noprint"><button onclick="window.print()">Печать / Сохранить в PDF</button></div>`;
  const toolbarCss = forWord
    ? ''
    : `.toolbar{position:sticky;top:0;z-index:3;background:#fff;padding:0 0 4mm;margin-bottom:6mm;border-bottom:1px solid #d6dee6}
       .toolbar button{font:600 14px Arial,sans-serif;padding:9px 15px;border:0;border-radius:5px;background:#244e73;color:#fff;cursor:pointer}
       @media print{html,body{background:#fff}body{max-width:none;margin:0;padding:0;box-shadow:none;font-size:11pt}.noprint{display:none}.task-group.new-page{break-before:page}}
       @page{size:A4;margin:18mm 17mm 20mm}`;

  return `<!DOCTYPE html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>${esc(opts.title || 'Задания')}</title>
<style>${DOC_CSS}${toolbarCss}</style></head>
<body>
${printBtn}
<h1>${esc(opts.title || 'Задания')}</h1>
${sub ? `<div class="doc-sub">${sub}</div>` : ''}
<div class="student-fields"><span class="name">Фамилия, имя: ______________________________</span><span>Класс: ______</span><span>Дата: ____________</span></div>
${cards}
${key}
</body></html>`;
}

/* ============ 4. Отбор заданий по фильтру ============ */

function selectTasks(library, filter) {
  const exam = filter.exam || 'ege';
  const subject = filter.subject || 'История';
  const kims = (filter.kims || []).map(Number); // выбранные номера заданий
  const periods = (filter.periods || []).map(Number); // выбранные разделы/периоды
  const types = filter.types || []; // выбранные типы ответа
  const limit = filter.limit || 0;
  const outdatedMode = filter.outdated || 'hide'; // 'hide' | 'only' | 'all'

  const pool = library.tasks.filter((t) => t.exam === exam && t.subject === subject);

  // задания, прошедшие фильтр пользователя
  let matched = pool;
  if (outdatedMode === 'hide') matched = matched.filter((t) => !t.outdated);
  else if (outdatedMode === 'only') matched = matched.filter((t) => t.outdated);
  if (kims.length) matched = matched.filter((t) => t.kim != null && kims.includes(t.kim));
  if (periods.length) matched = matched.filter((t) => t.periods.some((p) => periods.includes(p)));
  if (types.length) matched = matched.filter((t) => types.includes(t.answerType));

  // Общий материал уже скопирован в каждую запись группы. Поэтому при выборе,
  // например, только № 9 берём именно № 9 с картой, а не весь блок 9–12.
  let tasks = [...matched];

  // сортировка: группы держим вместе и по внутреннему порядку (Задание №N)
  const gKey = {}; // groupId -> {kim, period}
  for (const t of tasks) {
    if (!t.groupId) continue;
    const g = gKey[t.groupId] || (gKey[t.groupId] = { kim: 99, period: 99 });
    g.kim = Math.min(g.kim, t.kim || 99);
    g.period = Math.min(g.period, t.periods[0] || 99);
  }
  const keyOf = (t) => (t.groupId ? gKey[t.groupId] : { kim: t.kim || 99, period: t.periods[0] || 99 });
  tasks.sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    if (ka.kim !== kb.kim) return ka.kim - kb.kim;
    if (ka.period !== kb.period) return ka.period - kb.period;
    const ga = a.groupId || '~' + a.number, gb = b.groupId || '~' + b.number;
    if (ga !== gb) return ga < gb ? -1 : 1; // одна группа — рядом
    return (a.groupOrder || 0) - (b.groupOrder || 0) || a.number.localeCompare(b.number);
  });

  // лимит: не разрываем группу — дотягиваем до конца последней группы
  if (limit > 0 && tasks.length > limit) {
    let end = limit;
    const lastG = tasks[end - 1].groupId;
    if (lastG) while (end < tasks.length && tasks[end].groupId === lastG) end++;
    tasks = tasks.slice(0, end);
  }
  return tasks;
}

// Сводка для интерфейса. По умолчанию считаем только актуальные задания;
// устаревшие идут отдельным счётчиком и в свою группировку.
function libraryIndex(library, includeOutdated) {
  const combos = {};
  for (const t of library.tasks) {
    const ck = `${t.exam}|${t.subject}`;
    if (!combos[ck]) combos[ck] = { exam: t.exam, subject: t.subject, count: 0, outdatedCount: 0, kims: {}, periods: {}, types: {}, groups: {}, outdatedGroups: {} };
    const c = combos[ck];
    if (t.outdated) {
      c.outdatedCount++;
      c.outdatedGroups[t.group] = (c.outdatedGroups[t.group] || 0) + 1;
      if (!includeOutdated) continue;
    }
    c.count++;
    if (t.kim != null) c.kims[t.kim] = (c.kims[t.kim] || 0) + 1;
    for (const p of t.periods) c.periods[p] = (c.periods[p] || 0) + 1;
    c.types[t.answerType] = (c.types[t.answerType] || 0) + 1;
    c.groups[t.group] = (c.groups[t.group] || 0) + 1;
  }
  return { combos: Object.values(combos), sources: library.sources };
}

module.exports = {
  scanLibrary,
  annotateTaskGroups,
  classify,
  selectTasks,
  renderDocument,
  libraryIndex,
  periodsOf,
};
