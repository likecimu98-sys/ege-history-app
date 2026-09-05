'use strict';
// Перевод ученика из группы в группу.
//
// 🔴 Разбор 05.09.2026. Ученика пригласил в летнюю группу админ школы, потом он
// перешёл к куратору — и группа куратора продолжала получать домашку летней.
// Сервер про перевод знал; не знал КЛИЕНТ: код группы записывался только когда
// ключ пуст, то есть первый попавший в localStorage код жил вечно. Каждый вход
// журнал летней группы читался заново, а синхронизация писала протухший код
// обратно в профиль — перевод откатывался сам собой, кругом через клиента.
//
// Тем же объяснялось «раздел второй части не появляется»: признак доступности
// снимался по документу той группы, чей код лежал в localStorage.
//
// Здесь проверяется главное: решение о группе принимается В ОДНОМ месте и это
// место снимает долги прежней группы. Разъедется — вернётся ровно та поломка.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const cloud = strip(fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8'));
const store = strip(fs.readFileSync(path.join(root, 'server/api/src/store.js'), 'utf8'));

// ── 1. Одна точка правды ────────────────────────────────────────────────────
assert.match(cloud, /window\._adoptStudentClass = async function\(rawCode, opts\)/,
  'Нет _adoptStudentClass — решение о группе снова размазано по трём местам');

const writes = (cloud.match(/setItem\('student_class_code'/g) || []).length;
assert.strictEqual(writes, 1,
  `student_class_code записывается в ${writes} местах вместо одного — ` +
  'ровно так и появился вечный протухший код');

// Стираний два, и второе законно: pullClassAssignments убирает код СОБСТВЕННОЙ
// группы у учителя, случайно открывшего своё же приглашение. Звать оттуда
// _adoptStudentClass нельзя — она сама и зовёт pullClassAssignments.
const wipes = (cloud.match(/removeItem\('student_class_code'\)/g) || []).length;
assert.ok(wipes <= 2, `student_class_code стирается в ${wipes} местах — стало больше, чем задумано`);

// ── 2. Условия «только если пусто» больше нет ───────────────────────────────
assert.doesNotMatch(cloud, /!localStorage\.getItem\('student_class_code'\)/,
  'Вернулось условие «писать код только когда ключ пуст» — это и есть та поломка');

// ── 3. Перевод снимает несданное прежней группы ─────────────────────────────
const from = cloud.indexOf('window._adoptStudentClass = async function');
const adopt = cloud.slice(from, cloud.indexOf('window.pullClassAssignments = async function', from));
assert.ok(adopt.length > 200, 'Тело _adoptStudentClass не найдено');
assert.match(adopt, /reconcileRevokedAssignments\(ids\)/,
  'Смена группы не снимает несданные ДЗ прежней — долг летней школы поедет к куратору');
assert.match(adopt, /rememberRevokedHw\(ids, 0\)/,
  'Снятое не помечено локально — облачное состояние вернёт его на следующем входе');
assert.doesNotMatch(adopt, /\.splice\(|assignments\s*=\s*\S+\.filter/,
  'ДЗ прежней группы удаляется, а не помечается надгробием — слияние вернёт снятое');

// ── 4. Клиент не воскрешает протухший код ───────────────────────────────────
assert.match(cloud, /classCode: window\._serverClassCode !== null/,
  'Синхронизация снова шлёт код класса из localStorage — перевод откатится сам собой');

// ── 5. Признак второй части — только про свою группу ────────────────────────
assert.match(cloud, /if \(_classDocId\(localStorage\.getItem\('student_class_code'\) \|\| ''\) === code\) \{[\s\S]{0,240}?class_second_part/,
  'Признак второй части снимается по документу ЛЮБОЙ прочитанной группы — раздел исчезнет у того, кому его открыли');
assert.match(cloud, /if \(newsAt \|\| hasWorks\) localStorage\.setItem\('class_second_part', '1'\)/,
  'Нет второй линии: у кого есть работы второй части, раздел обязан быть доступен');

// ── 6. Мёртвый дубль не даёт прав на группу ─────────────────────────────────
assert.match(store, /AND data->>'_mergedInto' IS NULL/,
  'ownClasses снова собирается по влитым документам — журнал прежней группы останется читаемым');

console.log('✅ class-switch: перевод между группами, один источник правды, долги прежней группы сняты');
