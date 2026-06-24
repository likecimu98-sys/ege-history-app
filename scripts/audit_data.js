const fs = require('fs');
const d = fs.readFileSync('visualArchitectureData.generated.js', 'utf8');
const m = d.match(/window\.visualArchitectureData\s*=\s*(\[[\s\S]*\]);?/);
const items = JSON.parse(m[1]);

console.log('=== ПОЛНЫЙ АУДИТ ДАННЫХ ===\n');
console.log('Всего памятников:', items.length);

// Collect all unique fullCharacteristic values
const fcMap = {};
items.forEach(it => {
    if (!fcMap[it.fullCharacteristic]) fcMap[it.fullCharacteristic] = [];
    fcMap[it.fullCharacteristic].push(it.title);
});

console.log('\n--- ДУБЛИКАТЫ fullCharacteristic (нельзя различить!) ---');
Object.entries(fcMap).filter(([k, v]) => v.length > 1).forEach(([fc, titles]) => {
    console.log(`  FC="${fc}": ${titles.join(' / ')}`);
});

console.log('\n--- ПАМЯТНИКИ С <= 1 drillFact (слабо для точечного вопроса) ---');
items.filter(it => (it.drillFacts || []).length <= 1).forEach(it => {
    const df = (it.drillFacts || []).map(f => f.type).join(',');
    console.log(`  ${it.title}: drills=[${df}], FC="${it.fullCharacteristic}"`);
});

console.log('\n--- ПАМЯТНИКИ БЕЗ АРХИТЕКТОРА (creators пуст) ---');
items.filter(it => !it.creators.length).forEach(it => {
    console.log(`  ${it.title} (${it.fullCharacteristic})`);
});

console.log('\n--- ПОЛНАЯ ТАБЛИЦА ---');
items.forEach(it => {
    const df = (it.drillFacts || []).map(f => `${f.type}=${f.answer}`).join('; ');
    console.log(`${it.title} | FC="${it.fullCharacteristic}" | drills(${(it.drillFacts||[]).length}): ${df}`);
});
