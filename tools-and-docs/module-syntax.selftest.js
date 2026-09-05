'use strict';
// Синтаксис браузерных ES-модулей.
//
// 🔴 Разбор 05.09.2026, десять часов простоя. В `_assignBundleToClassDb`
// появился параметр `codes`, а внутри осталось `const codes = ...` — дубль
// объявления в одной области. Весь cloud-sync.js перестал выполняться, и
// вместе с ним исчезли ВСЕ облачные функции: вход, синхронизация, кабинет
// учителя, ПИН, выдача ДЗ. Страница при этом выглядела живой — pwa.js грузит
// модуль через динамический import() и глотает отказ в предупреждение.
//
// Почему это не поймали: проверяли `node --check cloud-sync.js`, а node парсит
// файл с таким расширением как CommonJS и на этой ошибке МОЛЧИТ. Ловит она
// только при разборе как модуля. Здесь копия кладётся с расширением .mjs —
// ровно затем, чтобы парсер был тот же, что в браузере.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Модули, которые браузер грузит как ES-модули (import / import()).
const MODULES = ['cloud-sync.js', 'vps-sync-compat.js'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ege-mod-'));
try {
  for (const name of MODULES) {
    const src = path.join(root, name);
    assert.ok(fs.existsSync(src), `${name} не найден — список модулей отстал от кода`);
    // Расширение .mjs заставляет node разбирать файл КАК МОДУЛЬ. Это и есть
    // весь смысл проверки: под .js та же ошибка проходит молча.
    const copy = path.join(tmp, name.replace(/\.js$/, '.mjs'));
    fs.copyFileSync(src, copy);
    try {
      execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    } catch (e) {
      const why = String(e.stderr || e.message).split('\n').find(l => l.includes('Error')) || '';
      assert.fail(`${name} не разбирается как ES-модуль — в браузере он не выполнится ЦЕЛИКОМ: ${why}`);
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// Вторая линия: параметр функции и const с одним именем — это ровно та ошибка.
// Проверяем её отдельно, чтобы отказ назывался своим именем, а не «SyntaxError».
{
  const src = fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8');
  const fn = src.match(/window\._assignBundleToClassDb = async function\(([^)]*)\)/);
  assert.ok(fn, '_assignBundleToClassDb не найдена');
  const params = fn[1].split(',').map(s => s.trim()).filter(Boolean);
  const body = src.slice(src.indexOf('window._assignBundleToClassDb'),
    src.indexOf('window._notifyHwDone') > 0 ? src.indexOf('window._notifyHwDone') : undefined);
  for (const p of params) {
    assert.doesNotMatch(body, new RegExp(`\b(const|let)\s+${p}\s*=`),
      `Параметр «${p}» переобъявлен внутри функции — файл не выполнится вовсе`);
  }
}

console.log('✅ module-syntax: браузерные модули разбираются как модули');
