// exam-scoring.js — единая система первичных баллов ЕГЭ (история, задания 1–12)
// с явно помеченной учебной терпимостью к форме записи кратких текстовых ответов.
(function(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.EgeScoring = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    const MAX_POINTS = Object.freeze({
        1: 2, 2: 1, 3: 2, 4: 3, 5: 2, 6: 2,
        7: 2, 8: 1, 9: 1, 10: 1, 11: 1, 12: 2
    });
    let knownTextAnswers = new Set();

    function maxPoints(kim) {
        return MAX_POINTS[Number(kim)] || 0;
    }

    function normalizeSymbols(value) {
        const raw = Array.isArray(value) ? value.join('') : String(value == null ? '' : value);
        return raw.replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '').split('');
    }

    function normalizeTextAnswer(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLocaleLowerCase('ru-RU')
            .replace(/ё/g, 'е')
            .replace(/[^0-9a-zа-я]/g, '');
    }

    function damerauLevenshteinDistance(left, right) {
        const a = String(left || '');
        const b = String(right || '');
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;
        const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
        for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
        for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                );
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
                }
            }
        }
        return matrix[a.length][b.length];
    }

    function typoBudget(length) {
        const size = Number(length) || 0;
        if (size >= 12) return 2;
        if (size >= 4) return 1;
        return 0;
    }

    function setKnownTextAnswers(values) {
        knownTextAnswers = new Set((values || []).map(normalizeTextAnswer).filter(Boolean));
        return knownTextAnswers.size;
    }

    function normalizeOrderedSlots(value) {
        if (!Array.isArray(value)) return normalizeSymbols(value);
        return value.map(slot => normalizeSymbols(slot)[0] || '');
    }

    function orderedErrors(expected, actual) {
        const key = normalizeSymbols(expected);
        const answer = normalizeOrderedSlots(actual);
        if (answer.length > key.length) return { errors: Infinity, extra: answer.length - key.length };
        let errors = 0;
        for (let i = 0; i < key.length; i++) {
            if (answer[i] !== key[i]) errors++;
        }
        return { errors, extra: 0 };
    }

    // Для заданий 6 и 12 порядок не важен. Замена одного символа — одна ошибка,
    // поэтому расстояние равно max(пропущено, добавлено), а не их сумме.
    function unorderedEditDistance(expected, actual) {
        const key = normalizeSymbols(expected);
        const answer = normalizeSymbols(actual);
        const counts = new Map();
        key.forEach(ch => counts.set(ch, (counts.get(ch) || 0) + 1));
        let common = 0;
        answer.forEach(ch => {
            const left = counts.get(ch) || 0;
            if (left > 0) {
                common++;
                counts.set(ch, left - 1);
            }
        });
        const missing = key.length - common;
        const extra = answer.length - common;
        return { distance: Math.max(missing, extra), missing, extra, common };
    }

    function pointsFromErrorCount(kim, errorCount) {
        const n = Number(kim);
        const errors = Number(errorCount);
        if (!Number.isFinite(errors) || errors < 0) return 0;
        if (n === 4) return errors === 0 ? 3 : errors === 1 ? 2 : errors <= 3 ? 1 : 0;
        if ([1, 3, 5, 7].includes(n)) return errors === 0 ? 2 : errors === 1 ? 1 : 0;
        return errors === 0 ? maxPoints(n) : 0;
    }

    function acceptedTextAnswers(task) {
        const list = Array.isArray(task && task.acceptedAnswers) && task.acceptedAnswers.length
            ? task.acceptedAnswers
            : [task && task.answer];
        return [...new Set(list.map(normalizeTextAnswer).filter(Boolean))];
    }

    function textWarnings(actual, matchedRaw, typoDistance) {
        const raw = String(actual == null ? '' : actual).trim();
        const expected = String(matchedRaw == null ? '' : matchedRaw).trim();
        const warnings = [];
        if (typoDistance > 0) warnings.push('typo');
        if (/[^0-9A-Za-zА-Яа-яЁё]/u.test(raw)) warnings.push('spacing');
        if (/[a-zа-яё]/u.test(raw)) warnings.push('case');
        return [...new Set(warnings)];
    }

    function matchTextAnswer(task, actual) {
        const normalized = normalizeTextAnswer(actual);
        const rawAnswers = (Array.isArray(task && task.acceptedAnswers) && task.acceptedAnswers.length
            ? task.acceptedAnswers
            : [task && task.answer]).map(value => String(value == null ? '' : value).trim()).filter(Boolean);
        if (!normalized || !rawAnswers.length) return { matched: false, matchType: 'none', editDistance: null, warningKinds: [] };

        for (const rawAnswer of rawAnswers) {
            if (normalizeTextAnswer(rawAnswer) === normalized) {
                const warningKinds = textWarnings(actual, rawAnswer, 0);
                return {
                    matched: true,
                    matchedAnswer: rawAnswer,
                    matchType: warningKinds.length ? 'normalized' : 'exact',
                    editDistance: 0,
                    warningKinds,
                    acceptedWithWarning: warningKinds.length > 0
                };
            }
        }

        // Не считаем опечаткой другое самостоятельное понятие из банка. Например,
        // «семнадцатый» не должно засчитываться вместо «восемнадцатый».
        if (knownTextAnswers.has(normalized)) {
            return { matched: false, matchType: 'known-answer-conflict', editDistance: null, warningKinds: [], knownAnswerConflict: true };
        }

        let best = null;
        for (const rawAnswer of rawAnswers) {
            const key = normalizeTextAnswer(rawAnswer);
            const distance = damerauLevenshteinDistance(key, normalized);
            if (!best || distance < best.distance) best = { rawAnswer, key, distance };
        }
        const budget = typoBudget(Math.max(best.key.length, normalized.length));
        if (best.distance <= budget) {
            const warningKinds = textWarnings(actual, best.rawAnswer, best.distance);
            return {
                matched: true,
                matchedAnswer: best.rawAnswer,
                matchType: 'typo',
                editDistance: best.distance,
                typoBudget: budget,
                warningKinds,
                acceptedWithWarning: true
            };
        }
        return { matched: false, matchedAnswer: best.rawAnswer, matchType: 'none', editDistance: best.distance, typoBudget: budget, warningKinds: [] };
    }

    function scoreTask(task, actual) {
        const kim = Number(task && task.kim);
        const maximum = maxPoints(kim);
        const expected = task && task.answer;
        if (!maximum || expected == null) return { kim, points: 0, max: maximum, correct: false, errorCount: null };

        if ([6, 12].includes(kim)) {
            const diff = unorderedEditDistance(expected, actual);
            const points = diff.distance === 0 ? 2 : diff.distance === 1 ? 1 : 0;
            return { kim, points, max: maximum, correct: points === maximum, errorCount: diff.distance, ...diff };
        }

        if ([1, 3, 4, 5, 7].includes(kim)) {
            const diff = orderedErrors(expected, actual);
            const points = pointsFromErrorCount(kim, diff.errors);
            return { kim, points, max: maximum, correct: points === maximum, errorCount: diff.errors };
        }

        if (kim === 2) {
            const correct = normalizeSymbols(expected).join('') === normalizeOrderedSlots(actual).join('');
            return { kim, points: correct ? 1 : 0, max: maximum, correct, errorCount: correct ? 0 : 1 };
        }

        const match = matchTextAnswer(task, actual);
        return { kim, points: match.matched ? 1 : 0, max: maximum, correct: match.matched, errorCount: match.matched ? 0 : 1, ...match };
    }

    function scoreVariant(tasks, answers) {
        const byKim = {};
        let total = 0;
        let maximum = 0;
        (tasks || []).forEach(task => {
            const actual = answers && Object.prototype.hasOwnProperty.call(answers, task.id) ? answers[task.id] : '';
            const result = scoreTask(task, actual);
            byKim[task.kim] = result;
            total += result.points;
            maximum += result.max;
        });
        return { total, max: maximum, byKim };
    }

    return Object.freeze({
        MAX_POINTS,
        maxPoints,
        normalizeSymbols,
        normalizeTextAnswer,
        damerauLevenshteinDistance,
        typoBudget,
        setKnownTextAnswers,
        acceptedTextAnswers,
        matchTextAnswer,
        normalizeOrderedSlots,
        orderedErrors,
        unorderedEditDistance,
        pointsFromErrorCount,
        scoreTask,
        scoreVariant
    });
});
