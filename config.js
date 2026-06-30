// config.js — константы, конфигурация заданий, эпохи
// Единый источник правды для всех модулей
'use strict';

const TASK_EPOCHS = ['early', '18th', '19th', '20th'];

const TASK_EPOCH_NAMES = {
    early: 'Древность и Смута',
    '18th': 'XVIII век',
    '19th': 'XIX век',
    '20th': 'XX век'
};

const TASK_EPOCH_SHORT = {
    early: 'Древность',
    '18th': 'XVIII в.',
    '19th': 'XIX в.',
    '20th': 'XX в.'
};

// Единый конфиг заданий — устраняет десятки if/else ветвлений по task1/3/4/5/7
const TASK_CONFIG = {
    task1: {
        prefix:    't1_',
        keyFn:     f => 't1_' + f.id,
        matchFn:   (a, b) => a.id === b.id,
        dedupeKey: f => f.id,
        data:      () => window.task1Data || [],
        emoji:     '⏳',
        label:     'Задание №1',
        shortLabel:'№1',
        fieldName: 'year',
        displayField: 'event',
        tableHeaders: ['📜 Событие', '⏳ Дата'],
        headerWidths: ['65%', '35%'],
    },
    task3: {
        prefix:    't3_',
        keyFn:     f => 't3_' + f.process + '|' + f.fact,
        matchFn:   (a, b) => a.process === b.process && a.fact === b.fact,
        dedupeKey: f => f.process + '|' + f.fact,
        data:      () => window.task3Data || [],
        emoji:     '🔗',
        label:     'Задание №3',
        shortLabel:'№3',
        fieldName: 'fact',       // поле, которое скрывается в таблице
        displayField: 'process', // поле, которое показывается
        tableHeaders: ['📋 Процесс (явление)', '📜 Факт'],
        headerWidths: ['55%', '45%'],
    },
    task4: {
        prefix:    '',
        keyFn:     f => f.event,
        matchFn:   (a, b) => a.event === b.event,
        dedupeKey: f => f.event,
        data:      () => window.bigData || [],
        emoji:     '📍',
        label:     'Задание №4',
        shortLabel:'№4',
        fieldName: 'year',
        displayField: 'event',
        tableHeaders: ['🗺️ Объект', '📜 Событие', '⏳ Дата'],
        headerWidths: ['27.5%', '45%', '27.5%'],
    },
    task5: {
        prefix:    't5_',
        keyFn:     f => 't5_' + f.event,
        matchFn:   (a, b) => a.event === b.event,
        dedupeKey: f => f.event,
        data:      () => window.task5Data || [],
        emoji:     '👤',
        label:     'Задание №5',
        shortLabel:'№5',
        fieldName: 'person',
        displayField: 'event',
        tableHeaders: ['📜 Процесс (явление)', '👤 Участник'],
        headerWidths: ['60%', '40%'],
    },
    task7: {
        prefix:    't7_',
        keyFn:     f => 't7_' + (f.mediaKind ? f.mediaKind + ':' : '') + f.culture,
        matchFn:   (a, b) => (a.mediaKind || 'base') === (b.mediaKind || 'base') && a.culture === b.culture,
        dedupeKey: f => (f.mediaKind ? f.mediaKind + ':' : '') + f.culture,
        data:      () => window.task7Data || [],
        emoji:     '🎨',
        label:     'Задание №7',
        shortLabel:'№7',
        fieldName: 'trait',
        displayField: 'culture',
        tableHeaders: ['🏛️ Памятник культуры', '📜 Характеристика'],
        headerWidths: ['35%', '65%'],
    },
    visualPainting: {
        prefix:    'vp_',
        keyFn:     f => 'vp_' + f.id,
        matchFn:   (a, b) => a.id === b.id,
        dedupeKey: f => f.id,
        data:      () => (window.visualStudyData && window.visualStudyData.painting) || [],
        emoji:     '🎨',
        label:     'Живопись',
        shortLabel:'Живопись',
        fieldName: 'trait',
        displayField: 'culture',
        tableHeaders: ['🎨 Картина', '📜 Характеристика'],
        headerWidths: ['35%', '65%'],
    },
    visualArchitecture: {
        prefix:    'va_',
        keyFn:     f => 'va_' + f.id,
        matchFn:   (a, b) => a.id === b.id,
        dedupeKey: f => f.id,
        data:      () => (window.visualStudyData && window.visualStudyData.architecture) || [],
        emoji:     '🏛️',
        label:     'Архитектура',
        shortLabel:'Архитектура',
        fieldName: 'trait',
        displayField: 'culture',
        tableHeaders: ['🏛️ Объект', '📜 Характеристика'],
        headerWidths: ['35%', '65%'],
    },
    visualMaps: {
        prefix:    'vm_',
        keyFn:     f => 'vm_' + f.id,
        matchFn:   (a, b) => a.id === b.id,
        dedupeKey: f => f.id,
        data:      () => (window.visualStudyData && window.visualStudyData.maps) || [],
        emoji:     '🗺️',
        label:     'Карты',
        shortLabel:'Карты',
        fieldName: 'fullDescription',
        displayField: 'culture',
        tableHeaders: ['🗺️ Карта', '📜 Описание'],
        headerWidths: ['35%', '65%'],
    },
};

const TASK_LIST = ['task1', 'task3', 'task4', 'task5', 'task7'];

// ── Слой 3: «авторитеты эпохи» (правители/вожди) ──
// Правитель почти всегда — защитимый ответ для события его правления,
// поэтому он не должен попадать в дистракторы task5, если год целевого
// события приходится на его правление. [регэксп имени, год начала, год конца]
const REIGNS = [
    [/иван iii\b/i, 1462, 1505],
    [/василий iii\b/i, 1505, 1533],
    [/иван iv|иван грозн/i, 1533, 1584],
    [/борис годунов/i, 1598, 1605],
    [/михаил ф[её]дорович|михаил романов/i, 1613, 1645],
    [/алексей михайлович/i, 1645, 1676],
    [/п[её]тр i\b|п[её]тр велик/i, 1682, 1725],
    [/екатерина i\b/i, 1725, 1727],
    [/анн\w* иоанновн/i, 1730, 1740],
    [/елизавет\w* петровн|елизавета петровн/i, 1741, 1761],
    [/п[её]тр iii\b/i, 1761, 1762],
    [/екатерина ii\b|екатерина велик/i, 1762, 1796],
    [/павел i\b/i, 1796, 1801],
    [/александр i\b/i, 1801, 1825],
    [/николай i\b/i, 1825, 1855],
    [/александр ii\b/i, 1855, 1881],
    [/александр iii\b/i, 1881, 1894],
    [/николай ii\b/i, 1894, 1917],
    [/ленин|в\.?\s*и\.?\s*ульянов/i, 1917, 1924],
    [/сталин|и\.?\s*в\.?\s*сталин/i, 1924, 1953],
    [/хрущ[её]в/i, 1953, 1964],
    [/брежнев/i, 1964, 1982],
];

function isReigningAuthority(personName, targetYear) {
    if (!personName || !targetYear) return false;
    const name = String(personName);
    return REIGNS.some(([re, a, b]) => re.test(name) && targetYear >= a && targetYear <= b);
}
if (typeof window !== 'undefined') window.isReigningAuthority = isReigningAuthority;

// Весовые коэффициенты эпох для прогноза ЕГЭ
const ERA_WEIGHTS = { early: .30, '18th': .15, '19th': .25, '20th': .30 };

// Шутки — корректная vs ошибочная серия
const JOKE_PHRASES = {
    correct: [
        "Неплохо.", "Хорош!", "Идешь к успеху.", "Так держать!", "База!",
        "Эксперт ЕГЭ.", "Исторично!", "Мозг как у Ленина!", "Ключевский тобой гордится.", "100 баллов на горизонте!",
        "Бюджетное место уже твое!", "Гений исторической мысли!", "Артасов лично пожмет тебе руку!", "Ты вообще спишь или только историю учишь?", "Машина для уничтожения тестов!",
        "Ты случайно не реинкарнация Нестора Летописца?", "Да ты знаешь историю лучше тех, кто ее делал!", "Приемная комиссия МГУ уже плачет от счастья!", "Кажется, составители ЕГЭ будут списывать у тебя!", "Великий Магистр Времен и Народов!",
        "Твой мозг — это буквально Государственный Архив РФ!", "Давай честно, ты сам писал эти учебники по истории?", "Император Всероссийский и Повелитель ЕГЭ по истории!", "С таким мозгом можно предсказывать будущее, а не только знать прошлое!", "Ты преисполнился в познании настолько, что этот мир тебе абсолютно понятен!"
    ],
    error: [
        "ты тупой?", "Мда...", "Артасов плачет от твоих ответов.", "Минус баллы.", "Соберись, тряпка!",
        "Завод уже ждет тебя!", "Армия близко, сынок.", "Платное отделение само себя не оплатит!", "Ты вообще открывал учебник?", "С такими знаниями только в ПТУ.",
        "Рюрик в гробу перевернулся.", "Это фиаско, братан.", "Твои шансы на сотку тают на глазах.", "Ты не сдашь ЕГЭ, чел.", "Может, историю вообще не сдавать? Подумай.",
        "Даже кот ответил бы лучше.", "Скажи маме, чтобы откладывала на коммерцию.", "Ты бьешь все рекорды по тупости.", "Твоя безграмотность войдет в легенды!", "Поздравляю, ты изобрел альтернативную историю!",
        "Кто-то перепутал века, а кто-то — тысячелетия...", "Если бы за ошибки платили, ты бы уже купил МГУ!", "Я всего лишь код, но даже мне больно на это смотреть.", "Оставь надежду, всяк сюда входящий. ЕГЭ тебе не светит.", "Хватит тыкать наугад, иди читай теорию, гений!"
    ]
};
