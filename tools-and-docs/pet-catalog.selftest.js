'use strict';
// «Летописчик»: каталог живёт на сервере (server/api/src/pet/catalog.js), рисунки —
// в клиенте (pet-art.js). Их связывает только строка art.t у каждой вещи, и
// разойтись они могут молча: вещь продаётся, а на питомце — пустое место.
// Этот тест держит связку, открытость шансов и правило «питомец не в стартовой
// загрузке».
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const C = require(path.join(root, 'server/api/src/pet/catalog.js'));

// pet-art.js — обычный браузерный скрипт; исполняем в песочнице с фальшивым window.
const sandbox = { window: {} };
vm.runInNewContext(read('pet-art.js'), sandbox);
const Art = sandbox.window.PetArt;
assert.ok(Art && Art.templates, 'pet-art.js не выставил window.PetArt');

// 1. У каждой вещи каталога есть шаблон рисунка, и он рисует непустой SVG.
for (const item of C.ITEMS) {
  const fn = Art.templates[item.art.t];
  assert.ok(typeof fn === 'function', `нет рисунка «${item.art.t}» для ${item.id}`);
  const svg = fn(item.art.c);
  assert.ok(typeof svg === 'string' && svg.length > 20, `пустой рисунок у ${item.id}`);
  assert.ok(!/undefined|NaN/.test(svg), `в рисунке ${item.id} undefined/NaN`);
}

// 2. Питомец целиком собирается для каждого вида и каждого состояния, в любой вещи.
const items = Object.fromEntries(C.ITEMS.map(i => [i.id, i]));
for (const sp of C.SPECIES.map(s => s.id)) {
  assert.ok(Art.species[sp], `нет рисунка зверька ${sp}`);
  for (const state of ['happy', 'ok', 'sad', 'hungry', 'sick', 'sleep']) {
    const svg = Art.render({ species: sp, state, items, equipped: {} });
    assert.ok(svg.startsWith('<svg') && !/undefined|NaN/.test(svg), `${sp}/${state}`);
  }
}
for (const item of C.ITEMS) {
  const svg = Art.render({ species: 'owl', state: 'ok', items, equipped: { [item.slot]: item.id } });
  assert.ok(!/undefined|NaN/.test(svg), `питомец в ${item.id}`);
}

// 3. Значки есть у всей еды, лекарств, игрушек и коробок.
for (const c of [...C.CONSUMABLES, ...C.BOXES]) assert.ok(Art.icons[c.id], `нет значка у ${c.id}`);

// 4. Шансы открыты и сходятся в 100%.
for (const box of C.BOXES) {
  const sum = Object.values(box.odds).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `шансы ${box.id}: ${sum}`);
}

// 5. Сотня вещей — это обещание владельцу, а не пожелание.
assert.ok(C.ITEMS.length >= 100, `вещей всего ${C.ITEMS.length}`);

// 6. Питомец НЕ в стартовой загрузке: ни в index.html, ни в прекэше SW.
const index = read('index.html');
assert.ok(!/<script[^>]+src="pet(-art)?\.js/.test(index), 'pet.js не должен грузиться defer-скриптом из index.html');
assert.ok(!/pet\.css/.test(index), 'pet.css не должен подключаться в index.html');
assert.ok(/window\.loadPetModule\s*=/.test(read('ui.js')), 'нет ленивого загрузчика loadPetModule в ui.js');

// 7. Монета — своя картинка: эмодзи 🪙 нет в шрифтах Windows 10.
assert.ok(!read('pet.js').includes('🪙'), 'в pet.js снова эмодзи 🪙 — на Windows 10 это пустой квадрат');

// 8. Имя в рейтинге экранируется в nickHtml — его задаёт сам ученик.
{
  const pet = read('pet.js');
  const nick = pet.slice(pet.indexOf('function nickHtml'), pet.indexOf('function miniAvatar'));
  assert.ok(/var safe = esc\(name\)/.test(nick), 'nickHtml обязан экранировать имя');
}

// 9. Каждая ачивка клиента оплачивается сервером: id в data.js и в карте
//    ACHIEVEMENTS каталога обязаны совпадать, иначе за неё молча не заплатят.
{
  const data = read('data.js');
  const seg = data.slice(data.indexOf('const achievementsList = ['), data.indexOf('];', data.indexOf('const achievementsList = [')));
  const ids = [...seg.matchAll(/\{ id: '([a-z0-9_]+)'/g)].map(m => m[1]);
  assert.ok(ids.length >= 60, `ачивок в data.js: ${ids.length}`);
  for (const id of ids) assert.ok(C.ACHIEVEMENTS[id], `ачивка ${id} есть в data.js, но сервер за неё не платит`);
  const rar = [...seg.matchAll(/\{ id: '([a-z0-9_]+)'[^\n]*?rarity: '([a-z]+)'/g)];
  for (const [, id, r] of rar) assert.strictEqual(C.ACHIEVEMENTS[id], r, `редкость ${id}: в data.js ${r}, на сервере ${C.ACHIEVEMENTS[id]}`);
}

console.log(`pet-catalog selftest: OK (${C.ITEMS.length} вещей, ${C.SPECIES.length} вида, ${C.BOXES.length} коробки)`);
