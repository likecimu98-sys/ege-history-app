'use strict';
// Стык со второй частью ЕГЭ («Проверочная», hw.reshay-istoriyu.ru).
//
// Договорённость: состав класса принадлежит тренажёру, «Проверочная» его
// ЧИТАЕТ. Копия разошлась бы с оригиналом в тот же день — пришёл ученик,
// перевели, отчислили.
//
// Проверяем не разметку ответа, а три условия, нарушение каждого из которых
// не видно на экране:
//   1) узкий ключ не подменяется общим служебным (тот открывает запись в
//      обход прав, а «Проверочная» принимает файлы от учеников);
//   2) признак secondPart доезжает до ученика;
//   3) ученик без Telegram не пропадает молча.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Соединение не открывается: проверяем проекцию и текст маршрута, в базу не ходим.
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';

const SRC = path.join(__dirname, '..', 'src');
const server = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
const env = fs.readFileSync(path.join(SRC, 'env.js'), 'utf8');
const store = require(path.join(SRC, 'store.js'));

test('ключ второй части отдельный, а не общий служебный', () => {
  assert.match(env, /secondPartKey: value\('SECOND_PART_KEY'\)/,
    'Узкого ключа нет — значит его роль исполнит INTERNAL_API_TOKEN');
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.ok(fn.length > 200, 'handleSecondPartClasses не найдена');
  assert.doesNotMatch(fn, /internalApiToken|internalRequest/,
    'Маршрут состава пускает по общему служебному ключу — он открывает запись в обход прав');
  assert.match(fn, /timingSafeEqualText\(key, env\.secondPartKey\)/,
    'Ключ сверяется небезопасно — по времени сравнения его можно подобрать');
});

test('без ключа маршрут выглядит несуществующим', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.match(fn, /!env\.secondPartKey \|\| !timingSafeEqualText/,
    'Незаполненный ключ должен закрывать маршрут, а не открывать его всем');
  assert.match(fn, /json\(res, 404/, 'Отказ должен быть 404: 403 подсказывает, что за маршрутом что-то есть');
});

test('маршрут только на чтение', () => {
  assert.match(server, /req\.method === 'GET' && url\.pathname === '\/api\/v1\/second-part\/classes'/,
    'Маршрут принимает не только GET — узкий ключ обязан быть ключом на чтение');
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.doesNotMatch(fn, /\b(INSERT|UPDATE|DELETE)\b/i, 'В чтении состава появилась запись');
});

test('признак второй части доезжает до ученика', () => {
  // Ученику из документа класса отдаётся только перечисленный набор полей.
  // Поля нет в списке — оно не доедет молча, и раздел просто не появится.
  const view = store.studentClassView({
    secondPart: true, currentUpto: 1800, unlimited: false, teacherNote: 'не для ученика',
  });
  assert.strictEqual(view.secondPart, true, 'secondPart не отдаётся ученику — раздел никогда не покажется');
  assert.strictEqual(view.teacherNote, undefined, 'Проекция перестала быть закрытой');
});

test('состав отдаётся только у включённых классов', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.match(fn, /const enabled = codes\.filter\(code => docs\.get\(code\)\?\.secondPart === true\)/,
    'Состав собирается не по включённым классам — это сотни учеников через границу зря');
  assert.match(fn, /WHERE data->>'classCode' = ANY\(\$1::text\[\]\)/,
    'Ученики выбираются не одним запросом — на классе в полтораста человек это заметно');
});

test('выключенный класс остаётся в выдаче, но без состава', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  // Пропажа строки читается как поломка: назначение куратора выглядит потерянным.
  assert.match(fn, /const classes = codes\.map/,
    'Выдача строится не по всем классам — выключенные исчезнут, и назначение куратора будет выглядеть потерянным');
  assert.match(fn, /if \(on\) \{/, 'Состав прикладывается независимо от признака');
});

test('ученик без Telegram не пропадает молча', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.match(fn, /students_without_telegram/,
    'Ученики без Telegram выпадают из состава без следа — в одном из классов это 10 человек из 14');
  assert.match(fn, /skipped\.set\(code, skipped\.get\(code\) \+ 1\)/,
    'Пропущенные не считаются — куратор недосчитается людей и не поймёт почему');
});

test('склеенный дубль аккаунта не выдаётся за ученика', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.match(fn, /_mergedInto/, 'Склеенные документы попадут в состав вторым лицом того же человека');
});

test('архивные классы не выдаются', () => {
  const fn = server.slice(server.indexOf('async function handleSecondPartClasses'),
    server.indexOf('async function handleInternal'));
  assert.match(fn, /!docs\.get\(code\)\?\.archived/,
    'Удалённый из кабинета класс продолжит приходить куратору');
});
