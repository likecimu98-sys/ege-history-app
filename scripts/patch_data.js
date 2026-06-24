// Скрипт для исправления фактических ошибок и добавления архитекторов
const fs = require('fs');
const src = fs.readFileSync('visualArchitectureData.generated.js', 'utf8');
const m = src.match(/window\.visualArchitectureData\s*=\s*(\[[\s\S]*\]);?/);
const items = JSON.parse(m[1]);

function addCreator(item, creator) {
    if (!item.creators.includes(creator)) item.creators.push(creator);
    // Update fullCharacteristic
    if (!item.fullCharacteristic.includes(creator)) {
        item.fullCharacteristic += `; создатель/архитектор: ${creator}`;
    }
    // Update traits
    const traitText = `Создатель/архитектор: ${creator}.`;
    if (!item.traits.some(t => t.includes(creator))) item.traits.push(traitText);
    // Update importantFacts
    if (!item.importantFacts.some(t => t.includes(creator))) item.importantFacts.push(traitText);
    // Add drillFact if missing
    if (!item.drillFacts.find(f => f.type === 'creator')) {
        item.drillFacts.push({
            type: 'creator', label: 'создатель',
            question: 'Кто создатель / архитектор?', answer: creator
        });
    }
}

function addLocation(item, loc) {
    if (!item.locations.includes(loc)) item.locations.push(loc);
    if (!item.fullCharacteristic.includes(loc)) {
        item.fullCharacteristic = `${loc}; ${item.fullCharacteristic}`;
    }
    if (!item.drillFacts.find(f => f.type === 'location')) {
        item.drillFacts.unshift({
            type: 'location', label: 'город/место',
            question: 'Где находится памятник?', answer: loc
        });
    }
}

function find(id) { return items.find(it => it.id === id); }

// ============= ФАКТИЧЕСКИЕ ОШИБКИ =============

// 1. Исаакиевский собор — убрать Киев из locations, оставить СПб
const isaak = find('isaakievskij-sobor');
if (isaak) {
    isaak.locations = ['Санкт-Петербург'];
    isaak.fullCharacteristic = 'Санкт-Петербург; 1858; создатель/архитектор: Монферран';
    isaak.traits = isaak.traits.map(t => t.replace('Киев, ', ''));
    isaak.importantFacts = isaak.importantFacts.map(t => t.replace('Киев, ', ''));
    isaak.drillFacts = isaak.drillFacts.map(f => {
        if (f.type === 'location') return { ...f, answer: 'Санкт-Петербург' };
        return f;
    });
    console.log('✅ Исаакиевский собор: убран Киев из locations');
}

// 2. Башня Татлина — это нереализованный проект, location не Владимир
const tatlin = find('bashnya-tatlina');
if (tatlin) {
    tatlin.locations = ['Москва'];
    tatlin.fullCharacteristic = 'нереализованный проект; создатель/архитектор: Владимир Татлин; стиль: конструктивизм';
    tatlin.drillFacts = tatlin.drillFacts.filter(f => f.type !== 'location');
    tatlin.description = 'Нереализованный проект, 1919-1920, Владимир Татлин, конструктивизм';
    console.log('✅ Башня Татлина: убран ошибочный город Владимир');
}

// 3. Сталинские высотки — добавить Москва
const vysotki = find('stalinskie-vysotki-sem-sestyor');
if (vysotki) {
    addLocation(vysotki, 'Москва');
    console.log('✅ Сталинские высотки: добавлена Москва');
}

// 4. Спасская башня — убрать «Тон» из creators (Тон не строил башню)
const spasskaya = find('spasskaya-bashnya');
if (spasskaya) {
    spasskaya.creators = spasskaya.creators.filter(c => c !== 'Тон');
    spasskaya.fullCharacteristic = '1491; создатель/архитектор: Пьетро Антонио Солари, Марк Фрязин';
    spasskaya.traits = spasskaya.traits.map(t => t.replace(', Тон', ''));
    spasskaya.importantFacts = spasskaya.importantFacts.map(t => t.replace(', Тон', ''));
    console.log('✅ Спасская башня: убран Тон из архитекторов');
}

// 5. Грановитая палата — убрать «Тон» из creators  
const granovitaya = find('granovitaya-palata');
if (granovitaya) {
    granovitaya.creators = granovitaya.creators.filter(c => c !== 'Тон');
    granovitaya.fullCharacteristic = 'Москва; 1491; создатель/архитектор: Пьетро Антонио Солари, Марк Фрязин';
    granovitaya.traits = granovitaya.traits.map(t => t.replace(', Тон', ''));
    granovitaya.importantFacts = granovitaya.importantFacts.map(t => t.replace(', Тон', ''));
    console.log('✅ Грановитая палата: убран Тон из архитекторов');
}

// 6. Коломенский дворец — period должен быть early, century XVII, year не 2010
const kolom = find('kolomenskij-dvorec-alekseya-mihajlovicha');
if (kolom) {
    kolom.period = 'early';
    kolom.century = 'XVII век';
    kolom.years = [];
    kolom.fullCharacteristic = 'Москва; XVII век';
    kolom.description = 'Вторая половина XVII века, Москва. Снесён в XVIII веке, воссоздан в 2010 году';
    kolom.drillFacts = kolom.drillFacts.filter(f => f.type !== 'date');
    kolom.drillFacts = kolom.drillFacts.map(f => {
        if (f.type === 'century') return { ...f, answer: 'XVII век' };
        return f;
    });
    kolom.traits = ['Вторая половина XVII века, Москва.', 'Относится к XVII век.', 'Связанное место: Москва.'];
    kolom.importantFacts = kolom.traits.slice();
    console.log('✅ Коломенский дворец: исправлен период на XVII век');
}

// 7. Церковь Покрова на Нерли — добавить location Владимирская область
const pokrova = find('cerkov-pokrova-na-nerli');
if (pokrova) {
    addLocation(pokrova, 'Владимирская область');
    console.log('✅ Церковь Покрова на Нерли: добавлена Владимирская область');
}

// 8. Троицкий собор Троице-Сергиевой лавры — добавить location
const troickij = find('troickij-sobor-troice-sergievoj-lavry');
if (troickij) {
    addLocation(troickij, 'Сергиев Посад');
    console.log('✅ Троицкий собор: добавлен Сергиев Посад');
}

// 9. Московский кремль — добавить location
const kreml = find('moskovskij-kreml');
if (kreml) {
    addLocation(kreml, 'Москва');
    console.log('✅ Московский кремль: добавлена Москва');
}

// 10. Спасская башня — добавить location Москва
if (spasskaya && !spasskaya.locations.includes('Москва')) {
    addLocation(spasskaya, 'Москва');
    console.log('✅ Спасская башня: добавлена Москва');
}

// ============= ДОБАВЛЕНИЕ АРХИТЕКТОРОВ =============

// Храм Василия Блаженного — Барма и Постник
const vasiliy = find('hram-vasiliya-blazhennogo-pokrova-na-rvu');
if (vasiliy) { addCreator(vasiliy, 'Барма и Постник'); console.log('✅ Храм Василия Блаженного: +Барма и Постник'); }

// Манеж — Бове, Бетанкур
const manezh = find('manezh');
if (manezh) { addCreator(manezh, 'Бове'); console.log('✅ Манеж: +Бове'); }

// Спас на крови — Парланд
const spas = find('hram-voskreseniya-hristova-na-krovi-spas-na-krovi');
if (spas) { addCreator(spas, 'Парланд'); console.log('✅ Спас на крови: +Парланд'); }

// Кунсткамера — Маттарнови (главный архитектор)
const kunstkamera = find('kunstkamera');
if (kunstkamera) { addCreator(kunstkamera, 'Маттарнови'); console.log('✅ Кунсткамера: +Маттарнови'); }

// Меншиковский дворец — Фонтана, Шедель
const menshikov = find('menshikovskij-dvorec');
if (menshikov) { addCreator(menshikov, 'Фонтана'); console.log('✅ Меншиковский дворец: +Фонтана'); }

// Меншикова башня — Зарудный
const menshBashnya = find('menshikova-bashnya');
if (menshBashnya) { addCreator(menshBashnya, 'Зарудный'); console.log('✅ Меншикова башня: +Зарудный'); }

// Церковь Вознесения в Коломенском — Петрок Малый (предположительно)
const voznesenie = find('cerkov-vozneseniya-v-kolomenskom');
if (voznesenie) { addCreator(voznesenie, 'Петрок Малый'); console.log('✅ Церковь Вознесения: +Петрок Малый'); }

// Политехнический музей — Монигетти
const polytech = find('politehnicheskij-muzej');
if (polytech) { addCreator(polytech, 'Монигетти'); console.log('✅ Политехнический музей: +Монигетти'); }

// Пушкинский музей — Клейн
const pushkin = find('pushkinskij-muzej');
if (pushkin) { addCreator(pushkin, 'Клейн'); console.log('✅ Пушкинский музей: +Клейн'); }

// Гостиница Метрополь — Валькотт
const metropol = find('gostinica-metropol');
if (metropol) { addCreator(metropol, 'Валькотт'); console.log('✅ Гостиница Метрополь: +Валькотт'); }

// Знаменская церковь в Дубровицах — предположительно итальянские мастера, точный автор неизвестен
// Пропускаем — нет достоверного архитектора

// Театр Красной армии — Алабян, Симбирцев
const teatr = find('teatr-krasnoj-armii');
if (teatr) { addCreator(teatr, 'Алабян'); console.log('✅ Театр Красной армии: +Алабян'); }

// Здание СЭВ — добавляем архитекторов Посохин, Мндоянц
const sev = find('zdanie-sev-dom-knizhka');
if (sev) { addCreator(sev, 'Посохин'); console.log('✅ Здание СЭВ: +Посохин'); }

// Дом правительства (Белый дом) — Чечулин
const beldom = find('dom-pravitelstva');
if (beldom) { addCreator(beldom, 'Чечулин'); console.log('✅ Дом правительства: +Чечулин'); }

// ============= СОХРАНЕНИЕ =============
const output = '// Generated by scripts/extract_visual_architecture_pdf.py\n// Source PDF is user-provided; every entry is marked reviewed: false.\n// Patched by scripts/patch_data.js\nwindow.visualArchitectureData = ' + JSON.stringify(items, null, 2) + ';\n';
fs.writeFileSync('visualArchitectureData.generated.js', output, 'utf8');
console.log('\n✅ Файл visualArchitectureData.generated.js обновлён!');
console.log(`Всего записей: ${items.length}`);
