/**
 * Рефакторинг drillFacts:
 * 1. Убрать "date" — точный год не спрашиваем
 * 2. До XVIII в. — спрашиваем век, с XVIII в. — половину века
 * 3. Добавить стиль (только утверждённый список после XVI в.)
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'visualArchitectureData.generated.js');
const content = fs.readFileSync(filePath, 'utf8');
const match = content.match(/window\.visualArchitectureData\s*=\s*(\[[\s\S]*\]);?\s*$/);
if (!match) { console.error('Cannot parse'); process.exit(1); }
const data = eval(match[1]);

// ── Половина века (XVIII+) ──
const halfCenturyMap = {
    // XVIII — первая половина
    'cerkov-preobrazheniya-gospodnya': 'первая половина XVIII века',
    'hram-apostolov-petra-i-pavla': 'первая половина XVIII века',
    'znamenskaya-cerkov': 'первая половина XVIII века',
    'menshikova-bashnya': 'первая половина XVIII века',
    'petropavlovskij-sobor': 'первая половина XVIII века',
    'letnij-dvorec-petra-i': 'первая половина XVIII века',
    'zdanie-12-kollegij': 'первая половина XVIII века',
    'menshikovskij-dvorec': 'первая половина XVIII века',
    'kunstkamera': 'первая половина XVIII века',
    // XVIII — вторая половина
    'smolnyj-sobor': 'вторая половина XVIII века',
    'zimnij-dvorec': 'вторая половина XVIII века',
    'bolshoj-ekaterininskij-dvorec': 'вторая половина XVIII века',
    'usadba-caricyno': 'вторая половина XVIII века',
    'dom-pashkova': 'вторая половина XVIII века',
    'senatskij-dvorec': 'вторая половина XVIII века',
    'tavricheskij-dvorec': 'вторая половина XVIII века',
    // XIX — первая половина
    'kazanskij-sobor-2': 'первая половина XIX века',
    'manezh': 'первая половина XIX века',
    'glavnoe-admiraltejstvo': 'первая половина XIX века',
    'bolshoj-teatr': 'первая половина XIX века',
    'arka-glavnogo-shtaba': 'первая половина XIX века',
    'triumfalnaya-arka': 'первая половина XIX века',
    'bolshoj-kremlevskij-dvorec': 'первая половина XIX века',
    // XIX — вторая половина
    'isaakievskij-sobor': 'вторая половина XIX века',
    'hram-hrista-spasitelya': 'вторая половина XIX века',
    'gosudarstvennyj-istoricheskij-muzej': 'вторая половина XIX века',
    'gum-verhnie-torgovye-ryady': 'вторая половина XIX века',
    'gostinica-metropol': 'вторая половина XIX века',
    'politehnicheskij-muzej': 'вторая половина XIX века',
    // XX — первая половина
    'hram-voskreseniya-hristova-na-krovi-spas-na-krovi': 'первая половина XX века',
    'yaroslavskij-vokzal': 'первая половина XX века',
    'osobnyaki': 'первая половина XX века',
    'pushkinskij-muzej': 'первая половина XX века',
    'shuhovskaya-bashnya': 'первая половина XX века',
    'dk-imeni-zueva': 'первая половина XX века',
    'mavzolej-v-i-lenina': 'первая половина XX века',
    'bashnya-tatlina': 'первая половина XX века',
    'dom-melnikova': 'первая половина XX века',
    'dom-kultury-im-rusakova': 'первая половина XX века',
    'teatr-krasnoj-armii': 'первая половина XX века',
    // XX — вторая половина
    'stalinskie-vysotki-sem-sester': 'вторая половина XX века',
    'zdanie-sev-dom-knizhka': 'вторая половина XX века',
    'dom-pravitelstva': 'вторая половина XX века',
};

// ── Стили (после XVI века, утверждённый список) ──
const styleMap = {
    // XVII — русское узорочье
    'teremnoj-dvorec': 'русское узорочье',
    'cerkov-troicy-v-nikitnikah': 'русское узорочье',
    'kolomenskij-dvorec-alekseya-mihajlovicha': 'русское узорочье',
    // Барокко
    'hram-pokrova-v-filyah': 'барокко',
    'petropavlovskij-sobor': 'барокко',
    'letnij-dvorec-petra-i': 'барокко',
    'zdanie-12-kollegij': 'барокко',
    'menshikovskij-dvorec': 'барокко',
    'kunstkamera': 'барокко',
    'menshikova-bashnya': 'барокко',
    'hram-apostolov-petra-i-pavla': 'барокко',
    'smolnyj-sobor': 'барокко',
    'zimnij-dvorec': 'барокко',
    'bolshoj-ekaterininskij-dvorec': 'барокко',
    // Классицизм
    'dom-pashkova': 'классицизм',
    'senatskij-dvorec': 'классицизм',
    'tavricheskij-dvorec': 'классицизм',
    'isaakievskij-sobor': 'классицизм',
    // Ампир
    'kazanskij-sobor-2': 'ампир',
    'manezh': 'ампир',
    'glavnoe-admiraltejstvo': 'ампир',
    'bolshoj-teatr': 'ампир',
    'arka-glavnogo-shtaba': 'ампир',
    'triumfalnaya-arka': 'ампир',
    // Псевдорусский
    'bolshoj-kremlevskij-dvorec': 'псевдорусский',
    'hram-hrista-spasitelya': 'псевдорусский',
    'gosudarstvennyj-istoricheskij-muzej': 'псевдорусский',
    'gum-verhnie-torgovye-ryady': 'псевдорусский',
    'hram-voskreseniya-hristova-na-krovi-spas-na-krovi': 'псевдорусский',
    'politehnicheskij-muzej': 'псевдорусский',
    'yaroslavskij-vokzal': 'псевдорусский',
    // Модерн
    'gostinica-metropol': 'модерн',
    'osobnyaki': 'модерн',
    // Конструктивизм
    'shuhovskaya-bashnya': 'конструктивизм',
    'dk-imeni-zueva': 'конструктивизм',
    'bashnya-tatlina': 'конструктивизм',
    'dom-melnikova': 'конструктивизм',
    'dom-kultury-im-rusakova': 'конструктивизм',
    'mavzolej-v-i-lenina': 'конструктивизм',
    // Сталинский ампир
    'teatr-krasnoj-armii': 'сталинский ампир',
    'stalinskie-vysotki-sem-sester': 'сталинский ампир',
};

let stats = { dateRemoved: 0, centuryAdded: 0, halfCenturyAdded: 0, styleAdded: 0, styleRemoved: 0 };

for (const item of data) {
    if (!item.drillFacts) item.drillFacts = [];

    // 1. Убрать "date"
    const before = item.drillFacts.length;
    item.drillFacts = item.drillFacts.filter(f => f.type !== 'date');
    stats.dateRemoved += before - item.drillFacts.length;

    // 2. Убрать старые "style" факты (заменим на новые)
    const hadStyle = item.drillFacts.filter(f => f.type === 'style').length;
    item.drillFacts = item.drillFacts.filter(f => f.type !== 'style');
    stats.styleRemoved += hadStyle;

    // 3. Половина века (XVIII+) или оставить обычный century
    const hc = halfCenturyMap[item.id];
    if (hc) {
        // Убираем старый century если есть
        item.drillFacts = item.drillFacts.filter(f => f.type !== 'century');
        item.drillFacts.push({
            type: 'century',
            label: 'период',
            question: 'К какому периоду относится памятник?',
            answer: hc
        });
        stats.halfCenturyAdded++;
    } else if (!item.drillFacts.some(f => f.type === 'century') && item.century) {
        // Если нет century факта, но есть century поле — добавляем
        item.drillFacts.push({
            type: 'century',
            label: 'век',
            question: 'К какому веку относится памятник?',
            answer: item.century
        });
        stats.centuryAdded++;
    }

    // 4. Стиль
    const style = styleMap[item.id];
    if (style) {
        item.drillFacts.push({
            type: 'style',
            label: 'стиль',
            question: 'К какому архитектурному стилю относится?',
            answer: style
        });
        stats.styleAdded++;
    }
}

// Записываем
const header = content.match(/^([\s\S]*?)window\.visualArchitectureData\s*=/);
const prefix = header ? header[1] : '// Generated data\n';
fs.writeFileSync(filePath, prefix + 'window.visualArchitectureData = ' + JSON.stringify(data, null, 2) + ';\n', 'utf8');

console.log('Stats:', stats);
console.log('Drill facts by type:');
const types = {};
data.forEach(x => (x.drillFacts || []).forEach(f => { types[f.type] = (types[f.type] || 0) + 1; }));
console.log(types);
