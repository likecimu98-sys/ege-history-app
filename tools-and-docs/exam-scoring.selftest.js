'use strict';

const assert = require('assert');
const scoring = require('../exam-scoring.js');

function score(kim, expected, actual) {
  return scoring.scoreTask({ kim, answer: expected }, actual).points;
}

// ФИПИ: для задания с неважным порядком добавление, удаление и замена
// одного символа являются одной ошибкой.
assert.strictEqual(score(6, '23', '23'), 2);
assert.strictEqual(score(6, '23', '32'), 2);
assert.strictEqual(score(6, '23', '234'), 1);
assert.strictEqual(score(6, '23', '2'), 1);
assert.strictEqual(score(6, '23', '24'), 1);
assert.strictEqual(score(6, '146', '145'), 1);
assert.strictEqual(score(6, '23', '245'), 0);
assert.strictEqual(score(12, '2456', '24567'), 1);
assert.strictEqual(score(12, '2456', '2457'), 1);
assert.strictEqual(score(12, '2456', '24'), 0);

assert.strictEqual(score(4, '123456', '123456'), 3);
assert.strictEqual(score(4, '123456', '123457'), 2);
assert.strictEqual(score(4, '123456', '123477'), 1);
assert.strictEqual(score(4, '123456', '124477'), 1);
assert.strictEqual(score(4, '123456', '224477'), 0);

assert.strictEqual(score(1, '1234', '1234'), 2);
assert.strictEqual(score(1, '1234', '1235'), 1);
assert.strictEqual(score(1, '1234', '1256'), 0);
assert.strictEqual(score(1, '1234', ['1', '', '3', '4']), 1);

assert.strictEqual(score(8, 'сорок четвёртом', 'СОРОКЧЕТВЕРТОМ'), 1);
assert.strictEqual(score(8, 'сорок четвёртом', 'Сорок-четвёртом'), 1);
assert.strictEqual(score(11, 'волыняне', 'волынян'), 1);

const normalizedMatch = scoring.scoreTask({ kim: 10, answer: 'Нижний Новгород' }, ' нижний-новгород ');
assert.strictEqual(normalizedMatch.points, 1);
assert.strictEqual(normalizedMatch.matchType, 'normalized');
assert.ok(normalizedMatch.acceptedWithWarning);
assert.ok(normalizedMatch.warningKinds.includes('spacing'));

const examReadyMatch = scoring.scoreTask({ kim: 10, answer: 'Севастополь' }, 'СЕВАСТОПОЛЬ');
assert.strictEqual(examReadyMatch.points, 1);
assert.strictEqual(examReadyMatch.acceptedWithWarning, false);
assert.strictEqual(examReadyMatch.matchType, 'exact');

for (const typo of ['севастопль', 'севастопооль', 'севастопольь', 'севастоплоь']) {
  const result = scoring.scoreTask({ kim: 10, answer: 'Севастополь' }, typo);
  assert.strictEqual(result.points, 1, `должна засчитаться опечатка: ${typo}`);
  assert.strictEqual(result.matchType, 'typo');
  assert.ok(result.acceptedWithWarning);
}
assert.strictEqual(score(10, 'Севастополь', 'севастпль'), 0);
assert.strictEqual(score(10, 'Рим', 'мир'), 0);
assert.strictEqual(score(9, 'Ярослав Мудрый', 'ярослв мудрй'), 1);
assert.strictEqual(score(10, 'Новгород', ''), 0);

const alternative = scoring.scoreTask({ kim: 10, answer: 'Царьград', acceptedAnswers: ['Царьград', 'Константинополь'] }, 'КОНСТАНТИНОПОЛЬ');
assert.strictEqual(alternative.points, 1);
assert.strictEqual(alternative.matchedAnswer, 'Константинополь');

scoring.setKnownTextAnswers(['семнадцатый', 'восемнадцатый', 'Новгород', 'Севастополь']);
const conceptConflict = scoring.scoreTask({ kim: 9, answer: 'восемнадцатый' }, 'семнадцатый');
assert.strictEqual(conceptConflict.points, 0);
assert.strictEqual(conceptConflict.matchType, 'known-answer-conflict');
assert.strictEqual(scoring.scoreTask({ kim: 10, answer: 'Севастополь' }, 'севастопль').points, 1);

// ── Форма записи ответа ──────────────────────────────────────────────────────
//
// ⚠️ Это регрессия на баг, живший в проде. Флаг acceptedWithWarning красит ответ
// как неверный, кладёт задание в работу над ошибками и не выпускает его из
// ротации пробника. До 27.07.2026 его ставила ЛЮБАЯ разница в знаках: точка в
// конце, запятая, кавычки, двойной или неразрывный пробел — то есть полностью
// верный ответ выглядел небрежным.
// На бланке ЕГЭ знаки препинания не вводят вообще; значимо только различие
// ВНУТРИ слова — пропущенный дефис. Именно эту границу и проверяем.
function formNoise(kim, expected, typed) {
  const result = scoring.scoreTask({ kim, answer: expected }, typed);
  assert.strictEqual(result.points, 1, `должно быть засчитано: ${JSON.stringify(typed)}`);
  assert.ok(!result.acceptedWithWarning,
    `предупреждение о форме записи здесь лишнее: ${JSON.stringify(typed)} при эталоне ${JSON.stringify(expected)}`);
}

formNoise(10, 'Санкт-Петербург', 'Санкт-Петербург.');
formNoise(10, 'Санкт-Петербург', 'Санкт-Петербург,');
formNoise(10, 'Санкт-Петербург', '«Санкт-Петербург»');
formNoise(10, 'Санкт-Петербург', 'Санкт-Петербург!');
formNoise(9, 'Ярослав Мудрый', 'Ярослав  Мудрый');
formNoise(9, 'Ярослав Мудрый', 'Ярослав Мудрый');
formNoise(10, 'Сталинград', ' Сталинград ');
formNoise(10, 'Сталинград', 'сталинград');

// А вот здесь предупреждение обязано остаться: пропущенный дефис — это другая
// запись слова, а не оформление.
const missingHyphen = scoring.scoreTask({ kim: 10, answer: 'Санкт-Петербург' }, 'Санкт Петербург');
assert.strictEqual(missingHyphen.points, 1, 'ответ всё-таки верный, балл ставится');
assert.ok(missingHyphen.acceptedWithWarning, 'пропущенный дефис должен предупреждать');

console.log('exam-scoring: ok');
