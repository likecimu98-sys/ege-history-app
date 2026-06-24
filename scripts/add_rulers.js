/**
 * Скрипт для добавления drillFact "ruler" (правитель) к памятникам,
 * где это разумно. НЕ добавляем правителя для:
 * - Удельной Руси / раздробленность (Новгород, Псков XIV в.)
 * - Произведений искусства без привязки к конкретному правителю
 * - Памятников, где правитель неизвестен или неважен
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'visualArchitectureData.generated.js');
const content = fs.readFileSync(filePath, 'utf8');
const match = content.match(/window\.visualArchitectureData\s*=\s*(\[[\s\S]*\]);?\s*$/);
if (!match) { console.error('Cannot parse data file'); process.exit(1); }

const data = eval(match[1]);

// Маппинг: id памятника → правитель
// Основан на описаниях и исторических фактах
const rulerMap = {
    // Киевская Русь
    'zolotye-vorota-v-kieve': 'Ярослав Мудрый',
    'sofijskij-sobor-v-kieve': 'Ярослав Мудрый',
    'sofijskij-sobor-v-novgorode': 'Ярослав Мудрый',
    'georgievskij-sobor-yureva-monastyrya': 'Мстислав Великий',

    // Владимиро-Суздальское княжество (центральная власть)
    'zolotye-vorota-vo-vladimire': 'Андрей Боголюбский',
    'uspenskij-sobor-vo-vladimire': 'Андрей Боголюбский',
    'cerkov-pokrova-na-nerli': 'Андрей Боголюбский',
    'dmitrovskij-sobor-vo-vladimire': 'Всеволод Большое Гнездо',

    // НЕ добавляем: Новгород XIV в. (раздробленность, республика)
    // cerkov-fedora-stratilata-na-ruchyu — Новгородская республика
    // cerkov-spasa-preobrazheniya-na-iline-ulice — Новгородская республика
    // cerkov-spasa-na-neredice — Новгородская республика

    // Московское княжество / централизация
    'troickij-sobor-troice-sergievoj-lavry': 'Василий I',
    'moskovskij-kreml': 'Иван III',
    'uspenskij-sobor': 'Иван III',
    'blagoveshchenskij-sobor': 'Иван III',
    'spasskaya-bashnya': 'Иван III',
    'granovitaya-palata': 'Иван III',
    'arhangelskij-sobor': 'Василий III',
    'kolokolnya-ivana-velikogo': 'Василий III',
    'cerkov-vozneseniya-v-kolomenskom': 'Василий III',
    'novodevichij-monastyr': 'Василий III',
    'hram-vasiliya-blazhennogo-pokrova-na-rvu': 'Иван IV Грозный',
    'belyj-gorod': 'Фёдор Иоаннович',

    // XVII век — Романовы
    'kazanskij-sobor': 'Михаил Фёдорович',
    'teremnoj-dvorec': 'Михаил Фёдорович',
    'cerkov-troicy-v-nikitnikah': 'Алексей Михайлович',
    'kolomenskij-dvorec-alekseya-mihajlovicha': 'Алексей Михайлович',
    'voskresenskij-sobor-novoierusalimskogo-monastyrya': 'Алексей Михайлович',
    'hram-pokrova-v-filyah': 'Пётр I',
    'suhareva-bashnya': 'Пётр I',

    // XVIII век — Петр I и далее
    'cerkov-preobrazheniya-gospodnya': 'Пётр I',
    'hram-apostolov-petra-i-pavla': 'Пётр I',
    'menshikova-bashnya': 'Пётр I',
    'petropavlovskij-sobor': 'Пётр I',
    'letnij-dvorec-petra-i': 'Пётр I',
    'zdanie-12-kollegij': 'Пётр I',
    'menshikovskij-dvorec': 'Пётр I',
    'kunstkamera': 'Пётр I',
    'smolnyj-sobor': 'Елизавета Петровна',
    'zimnij-dvorec': 'Елизавета Петровна',
    'bolshoj-ekaterininskij-dvorec': 'Елизавета Петровна',
    'usadba-caricyno': 'Екатерина II',
    'dom-pashkova': 'Екатерина II',
    'senatskij-dvorec': 'Екатерина II',
    'tavricheskij-dvorec': 'Екатерина II',

    // XIX век
    'kazanskij-sobor-2': 'Александр I',
    'manezh': 'Александр I',
    'glavnoe-admiraltejstvo': 'Александр I',
    'bolshoj-teatr': 'Александр I',
    'arka-glavnogo-shtaba': 'Николай I',
    'triumfalnaya-arka': 'Николай I',
    'bolshoj-kremlevskij-dvorec': 'Николай I',
    'isaakievskij-sobor': 'Николай I',
    'hram-hrista-spasitelya': 'Николай I',
    'gosudarstvennyj-istoricheskij-muzej': 'Александр III',
    'gum-verhnie-torgovye-ryady': 'Александр III',
    'hram-voskreseniya-hristova-na-krovi-spas-na-krovi': 'Александр III',

    // XX век — Сталин и т.д.
    'mavzolej-v-i-lenina': 'Ленин / Сталин',
    'teatr-krasnoj-armii': 'Сталин',
    'stalinskie-vysotki-sem-sester': 'Сталин',

    // НЕ добавляем для: модерн (Шехтель), авангард, конструктивизм — 
    // частные заказы или нет привязки к конкретному правителю
    // bashnya-tatlina — нереализованный проект
    // dom-melnikova — частный дом
    // dom-kultury-im-rusakova — советский период, но не привязан к правителю специально
    // pushkinskij-muzej — общественная инициатива
    // shuhovskaya-bashnya — инженерный проект
    // zdanie-sev-dom-knizhka — Брежнев, но это не ключевая характеристика
    // dom-pravitelstva — Брежнев, но тоже не ключевое
};

// Знамя: дубровицы — частный заказ голицыных, пропускаем
// znamenskaya-cerkov — не привязываем

let changed = 0;

for (const item of data) {
    const ruler = rulerMap[item.id];
    if (!ruler) continue;

    // Проверяем, есть ли уже drillFact типа ruler
    const hasRuler = (item.drillFacts || []).some(f => f.type === 'ruler');
    if (hasRuler) {
        console.log(`  SKIP (already has ruler): ${item.id}`);
        continue;
    }

    if (!item.drillFacts) item.drillFacts = [];
    item.drillFacts.push({
        type: 'ruler',
        label: 'правитель',
        question: 'При каком правителе был(а) создан(а)?',
        answer: ruler
    });

    // Также добавим в rulers массив если ещё нет
    if (!item.rulers) item.rulers = [];
    if (!item.rulers.includes(ruler)) {
        item.rulers.push(ruler);
    }

    changed++;
    console.log(`  ADD ruler: ${item.id} => ${ruler}`);
}

// Записываем обратно
const header = content.match(/^([\s\S]*?)window\.visualArchitectureData\s*=/);
const prefix = header ? header[1] : '// Generated data\n';
const output = prefix + 'window.visualArchitectureData = ' + JSON.stringify(data, null, 2) + ';\n';
fs.writeFileSync(filePath, output, 'utf8');

console.log(`\nDone! Added ruler to ${changed} monuments.`);
console.log(`Total monuments: ${data.length}`);
console.log(`With ruler drillFact now: ${data.filter(x => (x.drillFacts || []).some(f => f.type === 'ruler')).length}`);
