'use strict';

// Регрессия на проверку Origin — это половина защиты от CSRF.
//
// Появилось 27.07.2026: www.reshay-istoriyu.ru переведён в DNS-only и ходит на
// сервер мимо Cloudflare (запасной адрес для тех, у кого основной не
// открывается). Страница под ним грузилась, но ЛЮБАЯ запись падала с
// csrf_failed — браузер шлёт Origin с www, а сверялись мы ровно с одним
// значением. Человек занимается, прогресс не сохраняется, и видно это только в
// консоли разработчика.
//
// ⚠️ Тест проверяет ОБЕ стороны. Ослабить проверку легко и незаметно: маска
// вида /reshay-istoriyu\.ru$/ пропустила бы evil-reshay-istoriyu.ru, а
// startsWith — reshay-istoriyu.ru.evil.com. Поэтому список закрытый, сравнение
// точное, и ниже это зафиксировано отдельными проверками.

process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
process.env.PUBLIC_ORIGIN = 'https://reshay-istoriyu.ru';
process.env.EXTRA_ORIGINS = 'https://www.reshay-istoriyu.ru';

const test = require('node:test');
const assert = require('node:assert/strict');
const { originAllowed, allowedOrigins } = require('../src/env');
const { pool } = require('../src/db');

test.after(() => pool.end());

test('основной адрес принимается', () => {
  assert.equal(originAllowed('https://reshay-istoriyu.ru'), true);
});

test('запасной адрес www принимается — иначе прогресс не сохраняется', () => {
  assert.equal(originAllowed('https://www.reshay-istoriyu.ru'), true);
});

test('пустой Origin проходит: его не шлют не-CORS запросы и часть WebView', () => {
  // Защита при этом не исчезает — остаётся CSRF-токен из куки, который чужой
  // сайт прочитать не может. Требовать Origin всегда — сломать Telegram WebView.
  assert.equal(originAllowed(''), true);
  assert.equal(originAllowed(undefined), true);
});

test('похожие адреса НЕ принимаются', () => {
  for (const evil of [
    'https://evil-reshay-istoriyu.ru',        // ловит регулярку с $ на конце
    'https://reshay-istoriyu.ru.evil.com',    // ловит startsWith
    'https://reshay-istoriyu.ru.attacker.io',
    'http://reshay-istoriyu.ru',              // подмена схемы
    'https://sub.reshay-istoriyu.ru',         // произвольный поддомен
    'https://wwww.reshay-istoriyu.ru',
    'null',
  ]) {
    assert.equal(originAllowed(evil), false, `принят чужой origin: ${evil}`);
  }
});

test('хвостовой слэш не создаёт дыру и не мешает', () => {
  assert.equal(originAllowed('https://reshay-istoriyu.ru/'), true);
  assert.equal(originAllowed('https://evil.com/'), false);
});

test('список закрытый и содержит ровно то, что задано', () => {
  assert.deepEqual([...allowedOrigins].sort(),
    ['https://reshay-istoriyu.ru', 'https://www.reshay-istoriyu.ru']);
});

test('все три места проверки ходят через один helper', () => {
  // Раньше сравнение было рассыпано тремя копиями, и добавление адреса требовало
  // вспомнить про все. Пропустишь одну — часть запросов молча отвергается.
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['auth.js', 'server.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
    assert.ok(!/!==\s*env\.publicOrigin/.test(src),
      `${file}: осталось прямое сравнение с publicOrigin в обход originAllowed`);
  }
});
