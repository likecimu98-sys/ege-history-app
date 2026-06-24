// Скрипт для обогащения visualArchitectureData из task7Data
// и удаления малоизвестных архитекторов
const fs = require('fs');

// Загружаем данные task7 через eval (JS синтаксис, не JSON)
const dataSrc = fs.readFileSync('data.js', 'utf8');
const t7m = dataSrc.match(/window\.task7Data\s*=\s*(\[[\s\S]*?\]);/);
const task7 = eval('(' + t7m[1] + ')');

const vaSrc = fs.readFileSync('visualArchitectureData.generated.js', 'utf8');
const vam = vaSrc.match(/window\.visualArchitectureData\s*=\s*(\[[\s\S]*\]);?/);
const items = JSON.parse(vam[1]);

// Нормализация названий для сопоставления
function normalize(s) {
    return s.toLowerCase()
        .replace(/[«»""„]/g, '')
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim();
}

// Находим все уникальные culture-trait пары из task7 для каждого памятника
const task7Map = {};
task7.forEach(d => {
    const key = normalize(d.culture);
    if (!task7Map[key]) task7Map[key] = [];
    task7Map[key].push(d);
});

console.log('=== СОПОСТАВЛЕНИЕ task7Data ↔ visualArchitectureData ===\n');

let matchCount = 0;
let enriched = 0;

items.forEach(item => {
    const titleNorm = normalize(item.title);
    // Ищем совпадения по нормализованному названию
    const matches = [];
    for (const [key, entries] of Object.entries(task7Map)) {
        if (key.includes(titleNorm) || titleNorm.includes(key) ||
            // Специфические совпадения
            (titleNorm.includes('покрова на нерли') && key.includes('покрова на нерли')) ||
            (titleNorm.includes('василия блаженного') && key.includes('василия блаженного')) ||
            (titleNorm.includes('смольный') && key.includes('смольн')) ||
            (titleNorm.includes('спас на крови') && key.includes('спас на крови')) ||
            (titleNorm.includes('христа спасителя') && key.includes('христа спасителя'))) {
            matches.push(...entries);
        }
    }
    if (matches.length > 0) {
        matchCount++;
        console.log(`✅ ${item.title}:`);
        matches.forEach(m => {
            console.log(`   task7: "${m.culture}" → "${m.trait}" (${m.year})`);
        });
        
        // Извлекаем полезные характеристики из task7
        matches.forEach(m => {
            const trait = m.trait;
            // Добавляем в traits если нет
            if (!item.traits.some(t => normalize(t) === normalize(trait))) {
                item.traits.push(trait);
                enriched++;
            }
            if (!item.importantFacts.some(t => normalize(t) === normalize(trait))) {
                item.importantFacts.push(trait);
            }
        });
    }
});

console.log(`\nСовпадений: ${matchCount}, обогащено traits: ${enriched}`);

// ============= УДАЛЕНИЕ МАЛОИЗВЕСТНЫХ АРХИТЕКТОРОВ =============
console.log('\n=== УДАЛЕНИЕ МАЛОИЗВЕСТНЫХ АРХИТЕКТОРОВ ===\n');

// Архитекторы, которые ТОЧНО спрашиваются на ЕГЭ (оставить)
const EGE_ARCHITECTS = new Set([
    'Аристотель Фиораванти',    // Успенский собор Кремля
    'Пьетро Антонио Солари',    // Кремлевские стены, Грановитая палата
    'Марк Фрязин',              // Грановитая палата
    'Алевиз Новый',             // Архангельский собор
    'Барма и Постник',          // Храм Василия Блаженного
    'мастер Пётр',              // Георгиевский собор
    'Трезини',                  // Петропавловский собор, 12 коллегий
    'Варфоломей Варфоломеевич Растрелли', // Зимний, Смольный, Екатерининский
    'Баженов',                  // Царицыно, Дом Пашкова
    'Казаков',                  // Сенатский дворец
    'Старов',                   // Таврический дворец
    'Воронихин',                // Казанский собор
    'Бове',                     // Большой театр, Триумфальная, Манеж
    'Андреян Захаров',          // Адмиралтейство
    'Росси',                    // Арка Главного штаба
    'Тон',                      // Храм Христа Спасителя, БКД
    'Монферран',                // Исаакиевский собор
    'Шервуд',                   // Исторический музей
    'Померанцев',               // ГУМ
    'Федор Шехтель',            // Ярославский вокзал, Особняки
    'Шухов',                    // Шуховская башня
    'Щусев',                    // Мавзолей Ленина
    'Константин Мельников',     // Дом Мельникова, ДК Русакова
    'Илья Голосов',             // ДК Зуева
    'Владимир Татлин',          // Башня Татлина (проект)
    'Парланд',                  // Спас на крови
]);

// Малоизвестные архитекторы — удалить из данных
const REMOVE_ARCHITECTS = new Set([
    'Петрок Малый',     // Предположительный автор, не спрашивается
    'Маттарнови',       // Малоизвестен для ЕГЭ
    'Фонтана',          // Малоизвестен для ЕГЭ
    'Зарудный',         // Малоизвестен для ЕГЭ
    'Монигетти',        // Малоизвестен для ЕГЭ
    'Клейн',            // Малоизвестен для ЕГЭ
    'Валькотт',         // Малоизвестен для ЕГЭ
    'Алабян',           // Малоизвестен для ЕГЭ
    'Посохин',          // Малоизвестен для ЕГЭ
    'Чечулин',          // Малоизвестен для ЕГЭ
]);

function rebuildFullCharacteristic(item) {
    const parts = [];
    if (item.locations.length) parts.push(item.locations.join(', '));
    if (item.century) parts.push(item.century);
    if (item.years.length) parts.push(item.years.join('-'));
    if (item.creators.length) parts.push('создатель/архитектор: ' + item.creators.join(', '));
    if (item.styles.length) parts.push('стиль: ' + item.styles.join(', '));
    if (item.rulers.length) parts.push('связано с: ' + item.rulers.join(', '));
    if (item.events.length) parts.push('событие: ' + item.events.join(', '));
    return parts.join('; ');
}

items.forEach(item => {
    const toRemove = item.creators.filter(c => REMOVE_ARCHITECTS.has(c));
    if (toRemove.length > 0) {
        console.log(`🗑️  ${item.title}: убран ${toRemove.join(', ')}`);
        item.creators = item.creators.filter(c => !REMOVE_ARCHITECTS.has(c));
        // Удаляем drill creator если creators пуст
        if (item.creators.length === 0) {
            item.drillFacts = item.drillFacts.filter(f => f.type !== 'creator');
        } else {
            // Обновляем ответ в drillFact
            const creatorDrill = item.drillFacts.find(f => f.type === 'creator');
            if (creatorDrill) creatorDrill.answer = item.creators[0];
        }
        // Пересобираем fullCharacteristic
        item.fullCharacteristic = rebuildFullCharacteristic(item);
        // Очищаем traits/importantFacts от упоминаний убранного
        toRemove.forEach(c => {
            item.traits = item.traits.filter(t => !t.includes(c));
            item.importantFacts = item.importantFacts.filter(t => !t.includes(c));
        });
    }
});

// Также Башня Татлина — исправляем fullCharacteristic
const tatlin = items.find(i => i.id === 'bashnya-tatlina');
if (tatlin) {
    tatlin.fullCharacteristic = rebuildFullCharacteristic(tatlin);
}

// ============= СОХРАНЕНИЕ =============
const output = '// Generated by scripts/extract_visual_architecture_pdf.py\n// Source PDF is user-provided; every entry is marked reviewed: false.\n// Patched by scripts/patch_data.js + enrich_from_task7.js\nwindow.visualArchitectureData = ' + JSON.stringify(items, null, 2) + ';\n';
fs.writeFileSync('visualArchitectureData.generated.js', output, 'utf8');
console.log('\n✅ Файл обновлён!');
