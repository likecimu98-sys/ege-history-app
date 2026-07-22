// table.js — единый генератор таблиц для всех типов заданий
// Заменяет 4 отдельные функции generateTable/Task3/Task5/Task7Table (~800 строк → ~350)
'use strict';

// ═══════════════════════════════════════════════════════════
//  АЛГОРИТМЫ ПОДБОРА СТРОК ПО ЭПОХАМ
// ═══════════════════════════════════════════════════════════

// ── Fingerprint: события с одним годом+гео = «близнецы», не должны
//    попадать вместе в одно задание и в дистракторы ──
function eventFingerprint(d) {
    const y = String(d.year).replace(/\D/g, '');
    const g = (d.geo || '').toLowerCase().replace(/^(река |село |деревня |мыс |озеро )/, '').trim();
    return y + '|' + g;
}

// ── Тематические группы: события одной группы НЕ попадают как дистракторы ──
// Если в задании "присоединение Новгорода", то "присоединение Пскова" не будет дистрактором.
const _thematicRules = [
    { id: 'join',       re: /присоединени|включени.*состав|вхожден.*состав|ликвидация независимости/i },
    { id: 'treaty_swe', re: /(?:мир|договор|перемири).*швец|швец.*(?:мир|договор)|столбов|ништадт|або.*швец|верель|фридрихсгам|кардис/i },
    { id: 'treaty_tur', re: /(?:мир|договор).*(?:турц|осман|перси|иран)|кючук|(?:яссы|адрианопол|бухарест).*(?:договор|мир)|(?:договор|мир).*(?:яссы|адрианопол|бухарест)|сан-стефан|ункяр|туркманчай|гюлистан/i },
    { id: 'treaty_pol', re: /(?:мир|договор|перемири).*(?:реч.*посполит|польш)|деулин|андрусов|поляновк/i },
    { id: 'mongol',     re: /батый|батыя|нашестви.*монгол|монгол.*нашестви|монгольск.*войск/i },
    { id: 'revolt',     re: /восстани|бунт(?!ую)|мятеж/i },
    { id: 'found',      re: /^основани|основание/i },
    { id: 'suvorov',    re: /суворов/i },
    { id: 'ww2_ops',    re: /операци.*(?:багратион|искра|уран|кутузов|румянцев)|контрнаступлен.*(?:сталинград|москв)/i },
    { id: 'crimean_w',  re: /крымск.*войн|оборон.*севастопол.*крымск|синоп.*эскадр/i },
    { id: 'svo',        re: /специальн.*военн.*операц|вхожден.*(?:днр|лнр|херсон|запорож|донецк|луганск|российск.*федерац.*2022)/i },
];

function getEventGroup(d) {
    const text = (d.event || '') + ' ' + (d.geo || '');
    for (const rule of _thematicRules) {
        if (rule.re.test(text)) return rule.id;
    }
    return null;
}

// Кеш групп: строится один раз при первом вызове
let _groupCache = null;
function ensureGroupCache() {
    if (!_groupCache) {
        _groupCache = {};
        (window.bigData || []).forEach(d => {
            const g = getEventGroup(d);
            if (g) {
                if (!_groupCache[g]) _groupCache[g] = [];
                _groupCache[g].push(d);
            }
        });
    }
}

// Task4: 75% — по одной из каждой эпохи, 25% — 2×XX + early + XVIII/XIX
function pickTargetTask4(allowed, rowsCount) {
    if (rowsCount !== 4) return null;
    const ep = {};
    TASK_EPOCHS.forEach(e => { ep[e] = shuffleArray(allowed.filter(f => f.c === e)); });
    const usedEv = new Set();
    const usedFP = new Set(); // fingerprints — запрет близнецов
    const pick1 = (pool) => {
        for (const f of pool) {
            const fp = eventFingerprint(f);
            if (!usedEv.has(f.event) && !usedFP.has(fp)) {
                usedEv.add(f.event); usedFP.add(fp); return f;
            }
        }
        return null;
    };
    const use20twice = Math.random() < 0.25;
    let picked = [];
    if (use20twice && ep['20th'].length >= 2) {
        const p20a = pick1(ep['20th']), p20b = pick1(ep['20th']);
        const pEa = pick1(ep['early']);
        const midEp = Math.random() < 0.5 ? '18th' : '19th';
        const pMid = pick1(ep[midEp]) || pick1(ep[midEp === '18th' ? '19th' : '18th']);
        picked = [p20a, p20b, pEa, pMid].filter(Boolean);
    } else {
        TASK_EPOCHS.forEach(e => { const f = pick1(ep[e]); if (f) picked.push(f); });
    }
    return picked.length === 4 ? shuffleArray(picked) : null;
}

// ── Защита task3 от пересекающихся процессов в одном раунде ──
// «Активный диапазон» процесса = min..max годов его фактов в базе.
// Если факт строки А попадает в диапазон процесса строки Б (±2 года),
// ответ строки А почти наверняка валиден и для Б («Смута в России» +
// «правление Семибоярщины», «Северная война» + «итоги Северной войны»).
let _t3ProcRanges = null;
function _task3ProcRanges() {
    if (_t3ProcRanges) return _t3ProcRanges;
    const pr = {};
    (window.task3Data || []).forEach(d => {
        if (typeof d.year !== 'number') return;
        const r = pr[d.process] || (pr[d.process] = { min: d.year, max: d.year });
        if (d.year < r.min) r.min = d.year;
        if (d.year > r.max) r.max = d.year;
    });
    return (_t3ProcRanges = pr);
}
// Эпоха из ТЕКСТА процесса: «преобразования Петра I» покрывают 1682–1725,
// даже если в базе у этого процесса один факт. Дополняет диапазон по базе.
const _T3_ERAS = [
    [/перв[ыо]х русских князей/i, 862, 980], [/ярослава мудрого/i, 1019, 1054],
    [/владимира мономаха/i, 1113, 1125], [/ивана калиты/i, 1325, 1340],
    [/дмитрия донского/i, 1359, 1389], [/ивана iii/i, 1462, 1505], [/василия iii/i, 1505, 1533],
    [/елены глинской/i, 1533, 1538], [/ивана iv|ивана грозного/i, 1533, 1584],
    [/избранной рады/i, 1549, 1560], [/опричн/i, 1565, 1572], [/ливонск\w+ войн/i, 1558, 1583],
    [/бориса годунова/i, 1598, 1605], [/смут/i, 1604, 1618],
    [/михаила ф[её]доровича/i, 1613, 1645], [/алексея михайловича/i, 1645, 1676],
    [/разин/i, 1667, 1671], [/болотников/i, 1606, 1607],
    [/церковн\w+ раскол|реформ\w+ патриарха никона/i, 1653, 1667],
    [/городск\w+ восстани\w+ середины xvii/i, 1648, 1662],
    [/петра i(?!i)|петровск/i, 1682, 1725], [/северн\w+ войн/i, 1700, 1721],
    [/дворцовых переворотов/i, 1725, 1762], [/анны иоанновны/i, 1730, 1740],
    [/елизаветы петровны/i, 1741, 1761], [/петра iii/i, 1761, 1762],
    [/семилетн\w+ войн/i, 1756, 1763], [/екатерины ii/i, 1762, 1796],
    [/пугач[её]в/i, 1773, 1775], [/павла i(?!i)/i, 1796, 1801],
    [/александра i(?![iv])/i, 1801, 1825], [/отечественн\w+ войн\w+ 1812|войн\w+ с наполеоном/i, 1812, 1814],
    [/декабрист/i, 1816, 1826], [/николая i(?!i)/i, 1825, 1855],
    [/крымск\w+ войн/i, 1853, 1856], [/александра ii(?!i)/i, 1855, 1881],
    [/велики[ех] реформ|1860\s*[–-]\s*18?70/i, 1860, 1874], [/народнич|народовол/i, 1874, 1884],
    [/александра iii/i, 1881, 1894], [/контрреформ/i, 1881, 1894],
    [/николая ii/i, 1894, 1917], [/русско-японск/i, 1904, 1905],
    [/перв\w+ российск\w+ революц/i, 1905, 1907], [/столыпин/i, 1906, 1911],
    [/перв\w+ миров\w+ войн/i, 1914, 1918], [/революционн\w+ событи\w+ 1917|двоевласти/i, 1917, 1918],
    [/большевик/i, 1917, 1922], [/гражданск\w+ войн/i, 1917, 1922],
    [/военного коммунизма/i, 1918, 1921], [/нэп/i, 1921, 1928],
    [/коллективизац/i, 1928, 1937], [/индустриализац/i, 1928, 1941],
    [/советско-финляндск/i, 1939, 1940], [/велик\w+ отечественн\w+ войн/i, 1941, 1945],
    [/сталинизм|сталинск\w+ репресс/i, 1945, 1953], [/оттепел|хрущ[её]в/i, 1953, 1964],
    [/застой|брежнев/i, 1964, 1985], [/разрядк/i, 1969, 1979],
    [/перестройк|горбач[её]в/i, 1985, 1991], [/холодн\w+ войн/i, 1946, 1991],
];
const _t3RangeCache = {};
function _task3RangesFor(process) {
    if (_t3RangeCache[process]) return _t3RangeCache[process];
    const out = [];
    const db = _task3ProcRanges()[process];
    if (db) out.push([db.min, db.max]);
    for (const [re, min, max] of _T3_ERAS) if (re.test(process)) out.push([min, max]);
    return (_t3RangeCache[process] = out);
}
function _task3YearInProcess(year, process) {
    if (typeof year !== 'number') return false;
    const PAD = 2;
    return _task3RangesFor(process).some(([min, max]) => year >= min - PAD && year <= max + PAD);
}
// ── Семантический (таксономический) конфликт task3 ──
// Диапазоны лет ловят пересечение по времени, но НЕ ловят «матрёшку» из процессов
// разной общности: обобщающий процесс «расширение территории Московского княжества»
// и его частный случай «присоединение Твери»/«взятие Смоленска (борьба с ВКЛ)» —
// факт частного процесса дословно верен и для обобщающего → в одной таблице двойной
// ответ. Также «Любечский съезд» — канонический маркер И «обороны против половцев»,
// И «распада Древнерусского государства»: если оба процесса в таблице, факт подходит
// к обоим. Такие пары запрещаем соседствовать (проявляется в узких средневековых
// периодах; в обычном режиме умный подбор разносит эпохи и до этого не доходит).
const _T3_GROWTH_UMBRELLA = [
    /расширение территории московск/i,
    /формирование единого русск/i,
    /образование единого русск/i,
    /объединение русских земель вокруг москв/i,
];
const _T3_GROWTH_SPECIFIC = [
    /присоединение твер/i,
    /(включение|присоединение) новгород/i,
    /ликвидаци\w+ независимост\w+.*(новгород|псков|вечев)/i,
    /борьба за русские земли между вкл/i,
    /включение .* в состав русского государ/i,
];
function _task3SemanticConflict(a, b) {
    const pa = a.process || '', pb = b.process || '';
    const ua = _T3_GROWTH_UMBRELLA.some(r => r.test(pa)), ub = _T3_GROWTH_UMBRELLA.some(r => r.test(pb));
    const sa = _T3_GROWTH_SPECIFIC.some(r => r.test(pa)), sb = _T3_GROWTH_SPECIFIC.some(r => r.test(pb));
    // обобщающий ↔ обобщающий, либо обобщающий ↔ частный (частный ↔ частный не конфликтует:
    // разные города, факты не взаимозаменяемы — напр. Новгород ≠ Тверь)
    if ((ua && ub) || (ua && sb) || (ub && sa)) return true;
    const lyu = /любечск/i, raspad = /распад древнерусск|раздроблен/i;
    if ((lyu.test(a.fact || '') && raspad.test(pb)) || (lyu.test(b.fact || '') && raspad.test(pa))) return true;
    return false;
}
function _task3Conflicts(a, b) {
    if (!a || !b) return false;
    return _task3YearInProcess(a.year, b.process) || _task3YearInProcess(b.year, a.process) ||
        _task3SemanticConflict(a, b);
}

// Task3: строго по одному из каждой эпохи
function pickTargetTask3(allowed, rowsCount) {
    if (rowsCount !== 4) return null;
    const ep = {};
    TASK_EPOCHS.forEach(e => { ep[e] = shuffleArray(allowed.filter(f => f.c === e)); });
    if (!TASK_EPOCHS.every(e => ep[e].length > 0)) return null;
    const uP = new Set(), uF = new Set(), target = [];
    TASK_EPOCHS.forEach(e => {
        for (const f of ep[e]) {
            if (uP.has(f.process) || uF.has(f.fact)) continue;
            if (target.some(t => _task3Conflicts(f, t))) continue;
            target.push(f); uP.add(f.process); uF.add(f.fact); break;
        }
    });
    return target.length === 4 ? shuffleArray(target) : null;
}

function _task1EventVariants(row) {
    const variants = Array.isArray(row?.eventVariants) && row.eventVariants.length
        ? row.eventVariants
        : [row?.event];
    return variants.map(v => String(v || '').trim()).filter(Boolean);
}

function _task1PickEvent(row, usedEvents) {
    const variants = shuffleArray(_task1EventVariants(row));
    if (usedEvents) {
        const unused = variants.find(v => !usedEvents.has(v));
        if (unused) return unused;
    }
    return variants[0] || String(row?.event || '');
}

function _task1MaterializeEvent(row, usedEvents) {
    if (!row) return row;
    return { ...row, event: _task1PickEvent(row, usedEvents) };
}

function pickTargetTask1(allowed, rowsCount) {
    const picked = [];
    const usedEvents = new Set();
    const usedYears = new Set();
    for (const f of shuffleArray([...allowed])) {
        if (picked.length >= rowsCount) break;
        const year = String(f?.year || '').trim();
        if (!year || usedYears.has(year)) continue;
        const variants = _task1EventVariants(f);
        if (!variants.length || variants.some(v => usedEvents.has(v))) continue;
        picked.push(f);
        usedYears.add(year);
        variants.forEach(v => usedEvents.add(v));
    }
    return picked.length === rowsCount ? shuffleArray(picked) : null;
}

// Task5: слоты по твоей схеме —
//   Слот 1 (100%): Древность и Смута (<1700)
//   Слот 2 (100%): XVIII и XIX века вместе (1700 — 1917 включительно, чтобы 1901-1918 не пустовали)
//   Слот 3 (100%): ВОВ (1941-1945)
//   Слот 4 (ротация): случайно одна из трёх категорий с равным шансом —
//      * ранний СССР (1918-1940, без ВОВ)
//      * поздний СССР + РФ (1946-2021)
//      * СВО (>=2022)
//   Если выбранной подкатегории нет в пуле, fallback на соседние.
// ── Защита task5 от «событие подходит сразу двум личностям» ──
// Активный период личности = диапазон годов всех её событий в БД (с запасом).
// Если у двух выбранных строк КАЖДАЯ личность «дотягивается» до года события другой,
// то событие можно отнести к обеим (Пётр/Меншиков ↔ Северная война/Гангут) → неоднозначно.
let _t5Span = null;
function _task5PersonSpan() {
    if (_t5Span) return _t5Span;
    const span = {};
    (window.task5Data || []).forEach(d => {
        if (typeof d.year !== 'number') return;
        const s = span[d.person] || (span[d.person] = { min: Infinity, max: -Infinity });
        if (d.year < s.min) s.min = d.year;
        if (d.year > s.max) s.max = d.year;
    });
    return (_t5Span = span);
}
function _task5Interchangeable(a, b) {
    if (!a || !b || a.person === b.person) return false;
    if (typeof a.year !== 'number' || typeof b.year !== 'number') return false;
    // ВОВ (1941–1945): множество разнопрофильных современников — не блокируем друг от друга.
    if (a.year >= 1941 && a.year <= 1945 && b.year >= 1941 && b.year <= 1945) return false;
    const sp = _task5PersonSpan(), sa = sp[a.person], sb = sp[b.person];
    if (!sa || !sb) return false;
    const PAD = 5;
    const aCoversB = b.year >= sa.min - PAD && b.year <= sa.max + PAD;
    const bCoversA = a.year >= sb.min - PAD && a.year <= sb.max + PAD;
    return aCoversB && bCoversA;
}

function pickTargetTask5(allowed, rowsCount) {
    if (rowsCount !== 4) return null;
    const isEarly    = f => f.year < 1700;
    const isXVIIIXIX = f => f.year >= 1700 && f.year <= 1917;
    const isWW2      = f => f.year >= 1941 && f.year <= 1945;
    const isEarlySov = f => f.year >= 1918 && f.year < 1941;
    const isLateSov  = f => f.year >= 1946 && f.year < 2022; // поздний СССР + РФ
    const isSVO      = f => f.year >= 2022;

    const slotUE = new Set(), slotUP = new Set();
    const eventPersons = {};
    (window.task5Data || []).forEach(d => {
        if (!eventPersons[d.event]) eventPersons[d.event] = new Set();
        eventPersons[d.event].add(d.person);
    });
    const selectedPersons = new Set(), selectedEvents = new Set();
    const picked = [];
    const pick1 = (pool) => {
        for (const f of pool) {
            if (slotUE.has(f.event) || slotUP.has(f.person)) continue;
            const myAlts = eventPersons[f.event] || new Set();
            const fwd = [...selectedPersons].some(sp => myAlts.has(sp));
            const rev = [...selectedEvents].some(se => (eventPersons[se] || new Set()).has(f.person));
            if (fwd || rev) continue;
            if (picked.some(p => _task5Interchangeable(f, p))) continue;
            slotUE.add(f.event); slotUP.add(f.person);
            selectedPersons.add(f.person); selectedEvents.add(f.event);
            picked.push(f);
            return f;
        }
        return null;
    };
    const shuf = shuffleArray([...allowed]);

    const slot1 = pick1(shuf.filter(isEarly));
    const slot2 = pick1(shuf.filter(isXVIIIXIX));
    const slot3 = pick1(shuf.filter(isWW2));

    // Слот 4: равномерная ротация по 3 подкатегориям XX+ века
    const subcats = ['earlySov', 'lateSov', 'svo'];
    const chosen = subcats[Math.floor(Math.random() * subcats.length)];
    const filters = { earlySov: isEarlySov, lateSov: isLateSov, svo: isSVO };
    const fallbackOrder = [chosen, ...shuffleArray(subcats.filter(s => s !== chosen))];
    let slot4 = null;
    for (const cat of fallbackOrder) {
        slot4 = pick1(shuf.filter(filters[cat]));
        if (slot4) break;
    }

    const slots = [slot1, slot2, slot3, slot4].filter(Boolean);
    return slots.length === 4 ? shuffleArray(slots) : null;
}

// Task7: 50% схема A (1+1+1+1), 50% схема B (1+0+2+1)
function pickTargetTask7(allowed, rowsCount) {
    if (rowsCount !== 4) return null;
    const ep = {};
    TASK_EPOCHS.forEach(e => { ep[e] = allowed.filter(f => f.c === e); });

    const pickFrom = (pool, count, usedC, usedT, selectedRows) => {
        const res = [];
        for (const f of shuffleArray([...pool])) {
            if (res.length >= count) break;
            if (!_task7CanUseAsTarget(f, selectedRows, usedC, usedT)) continue;
            res.push(f);
            _task7RememberTarget(f, selectedRows, usedC, usedT);
        }
        return res;
    };
    const usedC = new Set(), usedT = new Set(), selectedRows = [];
    let picked = [];
    if (Math.random() < 0.5) {
        TASK_EPOCHS.forEach(e => { picked.push(...pickFrom(ep[e], 1, usedC, usedT, selectedRows)); });
    } else {
        picked.push(...pickFrom(ep['early'], 1, usedC, usedT, selectedRows));
        picked.push(...pickFrom(ep['19th'], 2, usedC, usedT, selectedRows));
        picked.push(...pickFrom(ep['20th'], 1, usedC, usedT, selectedRows));
    }
    return picked.length === 4 ? shuffleArray(picked) : null;
}

const EPOCH_PICKERS = { task1: pickTargetTask1, task3: pickTargetTask3, task4: pickTargetTask4, task5: pickTargetTask5, task7: pickTargetTask7 };

// ═══════════════════════════════════════════════════════════
//  SMART DISTRACTORS — генерация ловушек
// ═══════════════════════════════════════════════════════════

// ── Адаптивное правило «минимум N лет удалённости» для дистракторов task3/5/7.
//    Если пользователь выбрал широкий период (span >= 120) — строго ±30 лет.
//    Если узкий — правило смягчается, чтобы пул не иссякал.
function _computeMinYearDistance(epochSpan) {
    if (epochSpan >= 120) return 30;
    if (epochSpan >= 80)  return 20;
    if (epochSpan >= 40)  return 10;
    if (epochSpan >= 15)  return 5;
    return 0; // микро-период — правило отключено
}

function _task7AddKey(keys, key) {
    if (key) keys.add(key);
}

function _task7Century(year) {
    year = parseInt(year, 10);
    if (!year || year < 1) return 0;
    return Math.floor((year - 1) / 100) + 1;
}

function _task7NormalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[«»„“”]/g, '"')
        .replace(/[—–]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function _task7Slug(text) {
    return _task7NormalizeText(text)
        .replace(/[^a-zа-я0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function _task7CultureKey(culture) {
    const raw = _task7NormalizeText(culture);
    const quoted = raw.match(/"([^"]+)"/);
    let title = quoted ? quoted[1] : raw;
    title = title.replace(/\s*\([^)]*\)\s*$/g, '').trim();

    let type = 'object';
    const typeMatch = raw.match(/^(рассказ|повесть|роман|книга|поэма|стихотворение|комедия|пьеса|опера|картина|портрет|кинофильм|киноэпопея|скульптура)\s+/);
    if (typeMatch) {
        type = typeMatch[1];
    } else if (quoted) {
        type = 'book';
    }

    if (type === 'рассказ' || type === 'повесть') type = 'short_prose';
    if (type === 'комедия' || type === 'пьеса') type = 'drama';
    if (type === 'книга') type = 'book';
    if (type === 'киноэпопея') type = 'кинофильм';

    if (!quoted) {
        title = raw
            .replace(/^(икона|памятник|ансамбль|здание|собор|церковь|храм)\s+/, '')
            .replace(/^(рассказ|повесть|роман|книга|поэма|стихотворение|комедия|пьеса|опера|картина|портрет|кинофильм|киноэпопея|скульптура)\s+/, '')
            .trim();
    }

    return type + ':' + _task7Slug(title);
}

function _task7RowId(row) {
    const id = parseInt(row?.id, 10);
    return Number.isFinite(id) ? id : null;
}

function _task7TraitVariants(row) {
    const variants = Array.isArray(row?.traitVariants) && row.traitVariants.length
        ? row.traitVariants
        : [row?.trait];
    return variants.map(v => String(v || '').trim()).filter(Boolean);
}

function _task7PickTrait(row, usedVals) {
    const variants = shuffleArray(_task7TraitVariants(row));
    if (usedVals) {
        const unused = variants.find(v => !usedVals.has(v));
        if (unused) return unused;
    }
    return variants[0] || String(row?.trait || '');
}

function _task7MaterializeTrait(row) {
    if (!row || !Array.isArray(row.traitVariants) || row.traitVariants.length < 2) return row;
    return { ...row, trait: _task7PickTrait(row) };
}

function _task7AppliesToIds(row) {
    const ids = Array.isArray(row?.appliesToIds) ? row.appliesToIds : [row?.id];
    return ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id));
}

function _task7CanUseAsTarget(candidate, selectedRows, usedCultures, usedTraits) {
    const cultureKey = _task7CultureKey(candidate?.culture);
    if (usedCultures.has(cultureKey)) return false;
    if (_task7TraitVariants(candidate).some(trait => usedTraits.has(trait))) return false;

    const candidateId = _task7RowId(candidate);
    if (candidateId === null) return true;
    const candidateApplies = new Set(_task7AppliesToIds(candidate));

    return selectedRows.every(selected => {
        const selectedId = _task7RowId(selected);
        if (selectedId === null) return true;
        const selectedApplies = new Set(_task7AppliesToIds(selected));
        return !candidateApplies.has(selectedId) && !selectedApplies.has(candidateId);
    });
}

function _task7RememberTarget(row, selectedRows, usedCultures, usedTraits) {
    selectedRows.push(row);
    usedCultures.add(_task7CultureKey(row?.culture));
    _task7TraitVariants(row).forEach(trait => usedTraits.add(trait));
}

function _task7IsSafeDistractor(candidate, targetRows) {
    const applies = new Set(_task7AppliesToIds(candidate));
    return targetRows.every(target => {
        const targetId = _task7RowId(target);
        return targetId === null || !applies.has(targetId);
    });
}

function _task7AddTextKeys(keys, text) {
    text = _task7NormalizeText(text);

    const aliases = [
        ['creator:ilarion', /митрополит иларион|слово о законе и благодати/],
        ['creator:nestor', /нестор|повесть временных лет|чтение о борисе и глебе/],
        ['creator:monomakh', /поучение детям|киевским князем/],
        ['creator:epifaniy', /епифан|житие сергия радонежского/],
        ['creator:rublev', /андрей рубл[её]в|икона «?троица»?|троица/],
        ['creator:nikitin', /никитин|хожение за три моря|тверским купцом/],
        ['creator:filofey', /филофей|москва\s*[—-]\s*третий рим/],
        ['creator:silvestr', /сильвестр|домострой/],
        ['creator:kurbsky', /курбск|история о великом князе московском/],
        ['creator:palitsyn', /авраамий палицын|осаде троице-сергиева монастыря|смутного времени/],
        ['creator:avvakum', /аввакум|житие протопопа аввакума/],
        ['creator:sumarokov', /сумароков|отец русской драмы/],
        ['creator:fonvizin', /фонвизин|недоросль/],
        ['creator:falkone', /фальконе|медный всадник/],
        ['creator:karamzin', /карамзин|бедная лиза|сентиментализм|история государства российского/],
        ['creator:radishchev', /радищев|путешествие из петербурга в москву|бунтовщиком хуже пугач[её]ва/],
        ['creator:trezzini', /доменико трезини|трезини|летний дворец петра|петропавловский собор|двенадцати коллегий/],
        ['creator:rastrelli', /растрелли|смольн(?:ый|ого)(?: собор| монастыр)|зимний дворец|петергофский дворец|екатерининский дворец/],
        ['creator:novikov', /новиков|трутень|живописец/],
        ['creator:kazakov', /м\.?\s*ф\.?\s*казаков|сенатский дворец|московского университета на моховой/],
        ['creator:bazhenov', /баженов|дом пашкова|царицыно/],
        ['creator:quarenghi', /кваренги|академии наук|смольного института/],
        ['creator:pushkin', /пушкин|евгений онегин|капитанская дочка/],
        ['creator:gogol', /гоголь|ревизор|м[её]ртвые души/],
        ['creator:glinka', /глинка|жизнь за царя|русской национальной оперы/],
        ['creator:musorgsky', /мусоргск|борис годунов|хованщина/],
        ['creator:surikov', /суриков|утро стрелецкой казни|боярыня морозова|переход суворова через альпы|покорение сибири ермаком/],
        ['creator:repin', /репин|бурлаки на волге|крестный ход|не ждали/],
        ['creator:bulgakov', /булгаков|белая гвардия|собачье сердце|дни турбиных/],
        ['creator:sholokhov', /шолохов|тихий дон|поднятая целина|они сражались за родину/],
        ['creator:eisenstein', /эйзенштейн|броненосец|иван грозный|александр невский/],
        ['creator:solzhenitsyn', /солженицын|один день ивана денисовича|матр[её]нин двор|архипелаг гулаг/],
        ['creator:ryazanov', /рязанов|ирония судьбы|служебный роман|жестокий романс/],
        ['creator:gaidai', /гайдай|операция «?ы»?|кавказская пленница|иван васильевич/]
    ];

    aliases.forEach(([key, re]) => { if (re.test(text)) _task7AddKey(keys, key); });

    // Персоналия-художник/композитор тоже принадлежит своей группе: если показан
    // «И.Е. Репин», характеристика «участник Товарищества передвижников» — валидна.
    if (keys.has('creator:repin') || keys.has('creator:surikov')) _task7AddKey(keys, 'group:peredvizhniki');
    if (keys.has('creator:musorgsky')) _task7AddKey(keys, 'group:moguchaya_kuchka');

    const centuryRe = /(xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)\s*в/i;
    const roman = { xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
    const m = text.match(centuryRe);
    if (m && !/рубеж/.test(text)) _task7AddKey(keys, 'century:' + roman[m[1].toLowerCase()]);

    if (/начал[еа]\s+xviii|первой четверти\s+xviii/.test(text)) _task7AddKey(keys, 'period:early18');
    if (/рубеж[еа]?\s+xvii[–-]xviii/.test(text)) _task7AddKey(keys, 'period:turn17_18');
    if (/рубеж[еа]?\s+xv[–-]xvi/.test(text)) _task7AddKey(keys, 'period:turn15_16');
    if (/правлени[ея]\s+владимира святославича/.test(text)) _task7AddKey(keys, 'reign:vladimir');
    if (/правлени[ея]\s+ярослава мудрого/.test(text)) _task7AddKey(keys, 'reign:yaroslav');
    if (/правлени[ея]\s+всеволода большое гнездо/.test(text)) _task7AddKey(keys, 'reign:vsevolod_big_nest');
    if (/правлени[ея]\s+петра i/.test(text)) _task7AddKey(keys, 'reign:peter1');
    if (/правлени[ея]\s+ивана iii/.test(text)) _task7AddKey(keys, 'reign:ivan3');
    if (/правлени[ея]\s+ивана iv/.test(text)) _task7AddKey(keys, 'reign:ivan4');
    if (/правлени[ея]\s+андрея боголюбского/.test(text)) _task7AddKey(keys, 'reign:andrey_bogolubsky');
    if (/правлени[ея]\s+алексея михайловича/.test(text)) _task7AddKey(keys, 'reign:alexey_mikhailovich');
    if (/правлени[ея]\s+павла i/.test(text)) _task7AddKey(keys, 'reign:pavel1');
    if (/правлени[ея]\s+николая i/.test(text)) _task7AddKey(keys, 'reign:nikolay1');
    if (/период руководства.*ленина/.test(text)) _task7AddKey(keys, 'life:lenin');
    if (/период руководства.*хрущ[её]ва|эпох[ау]\s+«?оттепел/.test(text)) _task7AddKey(keys, 'period:ottepel');
    if (/эпох[ау]\s+«?засто|период\s+«?засто/.test(text)) _task7AddKey(keys, 'period:zastoy');
    if (/современником владимира мономаха/.test(text)) _task7AddKey(keys, 'life:monomakh');
    if (/современником ярослава мудрого/.test(text)) _task7AddKey(keys, 'life:yaroslav');
    if (/современником александра невского/.test(text)) _task7AddKey(keys, 'life:alexander_nevsky');
    if (/современником дмитрия донского/.test(text)) _task7AddKey(keys, 'life:dmitry_donskoy');
    if (/современником сергия радонежского/.test(text)) _task7AddKey(keys, 'life:sergiy_radonezhsky');
    if (/современником василия i/.test(text)) _task7AddKey(keys, 'life:vasily1');
    if (/современником ивана iii/.test(text)) _task7AddKey(keys, 'life:ivan3');
    if (/современником ивана iv/.test(text)) _task7AddKey(keys, 'life:ivan4');
    if (/современником м\.?\s*и\.?\s*воротынского/.test(text)) _task7AddKey(keys, 'life:vorotynsky');
    if (/современником ленина/.test(text)) _task7AddKey(keys, 'life:lenin');
    if (/мамаево побоище|куликовск|событиям xiv/.test(text)) _task7AddKey(keys, 'event:kulikovo');
    if (/нашестви[ея] батыя/.test(text)) _task7AddKey(keys, 'event:baty');
    if (/церковн(?:ого|ый) раскол/.test(text)) _task7AddKey(keys, 'event:schism');
    if (/смутн(?:ого|ое) времен/.test(text)) _task7AddKey(keys, 'event:smuta');
    if (/крымск(?:ой|ая) войн/.test(text)) _task7AddKey(keys, 'event:crimean_war');
    if (/восстани[яе]\s+пугач/.test(text)) _task7AddKey(keys, 'event:pugachev_revolt');
    if (/стрелецк(?:их|ие) бунт/.test(text)) _task7AddKey(keys, 'event:streltsy_revolt');
    if (/перв(?:ой|ая) российск(?:ой|ая) революц/.test(text)) _task7AddKey(keys, 'event:first_revolution');
    if (/гражданск(?:ой|ая) войн/.test(text)) _task7AddKey(keys, 'event:civil_war');
    if (/велик(?:ой|ая) отечественн(?:ой|ая) войн/.test(text)) _task7AddKey(keys, 'event:ww2');
    if (/нэп|новой экономической политик/.test(text)) _task7AddKey(keys, 'period:nep');
    if (/поздн(?:его|ий) сталинизм|формализм/.test(text)) _task7AddKey(keys, 'period:late_stalin');
    if (/перестройк/.test(text)) _task7AddKey(keys, 'period:perestroika');
    if (/могуч(?:ей|ая) кучк/.test(text)) _task7AddKey(keys, 'group:moguchaya_kuchka');
    if (/передвижн/.test(text)) _task7AddKey(keys, 'group:peredvizhniki');
    if (/борис годунов|хованщина|князь игорь|сказка о царе салтане/.test(text)) _task7AddKey(keys, 'group:moguchaya_kuchka');
    if (/тройка|не ждали|крестный ход|боярыня морозова|бурлаки на волге|утро стрелецкой казни|апофеоз войны/.test(text)) _task7AddKey(keys, 'group:peredvizhniki');
    if (/белая гвардия|разгром|чапаев|окаянные дни|хождение по мукам/.test(text)) _task7AddKey(keys, 'event:civil_war');
    if (/броненосец.*пот[её]мкин/.test(text)) _task7AddKey(keys, 'event:first_revolution');
    if (/пут[её]вка в жизнь/.test(text)) _task7AddKey(keys, 'period:nep');
    if (/ленинградская.*симфония|жди меня|василий т[её]ркин|молодая гвардия|они сражались за родину|судьба человека|живые и м[её]ртвые|сотников|а зори здесь тихие|в списках не значился|оборона севастополя|фашист пролетел|в бой идут одни/.test(text)) _task7AddKey(keys, 'event:ww2');
    if (/карнавальная ночь|летят журавли|оттепель|один день ивана денисовича|матр[её]нин двор|я шагаю по москве|доктор живаго/.test(text)) _task7AddKey(keys, 'period:ottepel');
    if (/семнадцать мгновений весны|ирония судьбы|служебный роман|москва слезам не верит|иван васильевич|белое солнце пустыни|жестокий романс|архипелаг гулаг/.test(text)) _task7AddKey(keys, 'period:zastoy');
    if (/покаяние|дети арбата/.test(text)) _task7AddKey(keys, 'period:perestroika');
}

function _task7FactSemanticKeys(fact) {
    const keys = new Set();
    const year = typeof getYearFromFact === 'function' ? getYearFromFact(fact) : parseInt(fact?.year, 10);
    const century = _task7Century(year);

    if (century) _task7AddKey(keys, 'century:' + century);
    if (year >= 1490 && year <= 1510) _task7AddKey(keys, 'period:turn15_16');
    if (year >= 1690 && year <= 1710) _task7AddKey(keys, 'period:turn17_18');
    if (year >= 1700 && year <= 1725) _task7AddKey(keys, 'period:early18');
    if (year >= 980 && year <= 1015) _task7AddKey(keys, 'reign:vladimir');
    if (year >= 1019 && year <= 1054) _task7AddKey(keys, 'reign:yaroslav');
    if (year >= 1176 && year <= 1212) _task7AddKey(keys, 'reign:vsevolod_big_nest');
    if (year >= 1682 && year <= 1725) _task7AddKey(keys, 'reign:peter1');
    if (year >= 1462 && year <= 1505) _task7AddKey(keys, 'reign:ivan3');
    if (year >= 1533 && year <= 1584) _task7AddKey(keys, 'reign:ivan4');
    if (year >= 1157 && year <= 1174) _task7AddKey(keys, 'reign:andrey_bogolubsky');
    if (year >= 1645 && year <= 1676) _task7AddKey(keys, 'reign:alexey_mikhailovich');
    if (year >= 1796 && year <= 1801) _task7AddKey(keys, 'reign:pavel1');
    if (year >= 1825 && year <= 1855) _task7AddKey(keys, 'reign:nikolay1');
    if (year >= 1953 && year <= 1964) _task7AddKey(keys, 'period:ottepel');
    if (year >= 1964 && year <= 1985) _task7AddKey(keys, 'period:zastoy');
    if (year >= 1070 && year <= 1125) _task7AddKey(keys, 'life:monomakh');
    if (year >= 1019 && year <= 1054) _task7AddKey(keys, 'life:yaroslav');
    if (year >= 1220 && year <= 1263) _task7AddKey(keys, 'life:alexander_nevsky');
    if (year >= 1359 && year <= 1389) _task7AddKey(keys, 'life:dmitry_donskoy');
    if (year >= 1340 && year <= 1392) _task7AddKey(keys, 'life:sergiy_radonezhsky');
    if (year >= 1389 && year <= 1425) _task7AddKey(keys, 'life:vasily1');
    if (year >= 1440 && year <= 1505) _task7AddKey(keys, 'life:ivan3');
    if (year >= 1530 && year <= 1584) _task7AddKey(keys, 'life:ivan4');
    if (year >= 1510 && year <= 1573) _task7AddKey(keys, 'life:vorotynsky');
    if (year >= 1870 && year <= 1924) _task7AddKey(keys, 'life:lenin');

    _task7AddTextKeys(keys, `${fact?.culture || ''} ${fact?.trait || ''}`);
    return keys;
}

function _task7TraitSemanticKeys(trait) {
    const keys = new Set();
    _task7AddTextKeys(keys, trait);
    return keys;
}

function _task1CorrectYearsSet() {
    const rows = typeof task1Data !== 'undefined' ? task1Data : (window.task1Data || []);
    const years = new Set();
    rows.forEach(d => {
        if (d?.year) years.add(String(d.year));
        if (Number.isFinite(d?.yearNum)) years.add(`${d.yearNum} г.`);
    });
    return years;
}

function _task1DistractorYearList() {
    const src = typeof task1DistractorYears !== 'undefined'
        ? task1DistractorYears
        : (window.task1DistractorYears || []);
    return Array.isArray(src) ? src.map(y => String(y).trim()).filter(Boolean) : [];
}

function _task1AddGeneratedYears(target, poolItems, used, correctYears, needed) {
    const nums = target.map(t => Number.isFinite(t?.yearNum) ? t.yearNum : parseInt(String(t?.year || '').replace(/\D/g, ''), 10))
        .filter(y => Number.isFinite(y));
    const deltas = [1, -1, 2, -2, 3, -3, 5, -5, 7, -7, 10, -10, 15, -15, 20, -20, 25, -25, 30, -30];
    for (const base of shuffleArray(nums)) {
        for (const delta of deltas) {
            if (poolItems.length >= needed) return;
            const y = base + delta;
            if (y < 800 || y > 2026) continue;
            const label = `${y} г.`;
            if (used.has(label) || correctYears.has(label)) continue;
            used.add(label);
            poolItems.push(label);
        }
    }
}

function generateDistractorsTask1(target, poolItems) {
    const fakesCount = Math.ceil(target.length / 2);
    const needed = target.length + fakesCount;
    const used = new Set(poolItems.map(v => String(v)));
    const correctYears = _task1CorrectYearsSet();
    const selectedYears = new Set(target.map(t => String(t?.year || '')).filter(Boolean));

    for (const year of shuffleArray(_task1DistractorYearList())) {
        if (poolItems.length >= needed) break;
        if (used.has(year) || selectedYears.has(year) || correctYears.has(year)) continue;
        used.add(year);
        poolItems.push(year);
    }

    if (poolItems.length < needed) {
        _task1AddGeneratedYears(target, poolItems, used, correctYears, needed);
    }

    return poolItems;
}

function generateDistractors(task, target, missing) {
    const poolItems = [...missing];

    if (task === 'task1') {
        return generateDistractorsTask1(target, poolItems);
    }

    if (task === 'task4') {
        return generateDistractorsTask4(target, poolItems);
    }

    // Task3/5/7: единая логика
    const cfg = TASK_CONFIG[task];
    const dataSource = cfg.data();
    const task7UsesAudit = task === 'task7' && dataSource.some(d => Array.isArray(d.appliesToIds));
    const targetPeriods = [...new Set(target.map(t => t.c))];
    const periodOrder = TASK_EPOCHS;
    const adjSet = new Set();
    targetPeriods.forEach(p => {
        const i = periodOrder.indexOf(p);
        if (i > 0) adjSet.add(periodOrder[i - 1]);
        if (i < periodOrder.length - 1) adjSet.add(periodOrder[i + 1]);
    });
    targetPeriods.forEach(p => adjSet.delete(p));

    const fieldMap = { task3: 'fact', task5: 'person', task7: 'trait' };
    const displayMap = { task3: 'process', task5: 'event', task7: 'culture' };
    const field = fieldMap[task];
    const displayField = displayMap[task];

    // ── Собираем все "запрещённые" значения поля field ──
    const usedVals = new Set(poolItems);
    if (task === 'task7') {
        target.forEach(t => _task7TraitVariants(t).forEach(v => usedVals.add(v)));
    }
    const targetDisplayVals = new Set(target.map(t => t[displayField]));
    const task7TargetDisplayKeys = task === 'task7'
        ? new Set(target.map(t => _task7CultureKey(t[displayField])))
        : null;
    // Семантический слой работает ВМЕСТЕ с appliesToIds-аудитом: одинаковый текст
    // век-генерика («создан в 16 в.») живёт в нескольких строках с разными
    // appliesToIds, и проверка только своей строки пропускает двойные ответы.
    const task7TargetSemanticKeys = task === 'task7'
        ? target.reduce((keys, t) => {
            _task7FactSemanticKeys(t).forEach(k => keys.add(k));
            return keys;
        }, new Set())
        : null;

    const markUsedValue = d => {
        if (task === 'task7') {
            _task7TraitVariants(d).forEach(v => usedVals.add(v));
        } else {
            usedVals.add(d[field]);
        }
    };

    // 1) Прямая блокировка: любое значение field, которое в базе связано
    //    с каким-то из target[displayField] — уже валидный ответ → не дистрактор.
    dataSource.forEach(d => {
        if (targetDisplayVals.has(d[displayField])) markUsedValue(d);
        if (task7TargetDisplayKeys && task7TargetDisplayKeys.has(_task7CultureKey(d[displayField]))) {
            markUsedValue(d);
        }
    });

    // 2) Обратная блокировка: строим индекс field → все его displayField.
    //    Любой кандидат, чей field хотя бы раз в базе связан с одним
    //    из target[displayField] — тоже должен быть исключён.
    //    (Эта проверка дублирует п.1 математически, но работает и для случаев,
    //     когда один и тот же person/fact/trait появляется с разными display-values
    //     в базе, т.е. это дополнительный defensive слой.)
    const fieldToDisplays = {};
    const fieldToDisplayKeys = {};
    const fieldToSemanticKeys = {};
    dataSource.forEach(d => {
        const values = task === 'task7' ? _task7TraitVariants(d) : [d[field]];
        values.forEach(v => {
            if (!fieldToDisplays[v]) fieldToDisplays[v] = new Set();
            fieldToDisplays[v].add(d[displayField]);
            if (task === 'task7') {
                if (!fieldToDisplayKeys[v]) fieldToDisplayKeys[v] = new Set();
                fieldToDisplayKeys[v].add(_task7CultureKey(d[displayField]));
                if (!fieldToSemanticKeys[v]) fieldToSemanticKeys[v] = new Set();
                _task7FactSemanticKeys(d).forEach(k => fieldToSemanticKeys[v].add(k));
            }
        });
    });

    // ── Определяем эпох-диапазон и порог ±N лет ──
    const targetPeriodSet = new Set(targetPeriods);
    const relevantPool = dataSource.filter(d => targetPeriodSet.has(d.c));
    const relevantYears = relevantPool.map(d => d.year).filter(y => typeof y === 'number');
    const epochSpan = relevantYears.length
        ? (Math.max(...relevantYears) - Math.min(...relevantYears))
        : 0;
    const initMinDist = task7UsesAudit ? 0 : _computeMinYearDistance(epochSpan);
    const targetYears = target.map(t => t.year).filter(y => typeof y === 'number');

    // ── Собираем кандидатов с данным порогом yearDist ──
    // Правило «минимум ±N лет от target-года» защищает от тематических близнецов:
    //   target=Избранная рада (1549) → в дистракторах НЕ должно быть Макария (1551)
    //   или Курбского (1552), т.к. они тоже участники реформ Ивана IV.
    //   target=свержение Лжедмитрия I (1606) → блокируем Болотникова (1606),
    //   Пожарского (1612), Минина (1612) — все тематически в Смуте.
    //
    // ИСКЛЮЧЕНИЕ для task5: если конкретный target-год ∈ [1941, 1945] (ВОВ),
    //   то правило к НЕМУ не применяется. Причина: в ВОВ множество деятелей
    //   разных тем (лётчики, конструкторы, разведчики, писатели) — они по смыслу
    //   не пересекаются, и блокировать их друг от друга вредно.
    //   Но правило сохраняется для остальных target-лет того же задания.
    const wwExempt = (ty) => (task === 'task5' && ty >= 1941 && ty <= 1945);

    // ── task3: «активный диапазон» показанных процессов ──
    // Факт, чей год попадает в диапазон показанного процесса (по базе И по эпохе
    // из текста процесса, ±2), почти наверняка валиден для него семантически
    // (Смута → «Совет всея земли», Северная война → Ништадтский мир,
    // преобразования Петра I → Синод). Бан ЖЁСТКИЙ — fallback его не ослабляет.
    const t3Procs = task === 'task3' ? target.map(t => t.process) : null;

    function collectCandidates(yearDist) {
        const scored = [];
        const seen = new Set();
        dataSource.forEach(d => {
            const val = task === 'task7' ? _task7PickTrait(d, usedVals) : d[field];
            if (seen.has(val) || usedVals.has(val)) return;
            if (task7UsesAudit && !_task7IsSafeDistractor(d, target)) return;
            // текст-двойники: та же формулировка может принадлежать ДРУГОЙ строке
            // с иным appliesToIds — баним по объединению всех строк-владельцев текста
            // (сравнение нормализованное: «А. И.» и «А.И.» — один текст)
            if (task === 'task7') {
                const vkey = _task7NormalizeText(val).replace(/\.\s+/g, '.');
                const ownersUnsafe = dataSource.some(o =>
                    _task7TraitVariants(o).some(t => _task7NormalizeText(t).replace(/\.\s+/g, '.') === vkey) &&
                    !_task7IsSafeDistractor(o, target));
                if (ownersUnsafe) return;
            }
            // ── Слой 3: правитель эпохи не может быть дистрактором для события
            //    своего правления (он сам — защитимый ответ). Только task5 (val = личность).
            if (task === 'task5' && typeof isReigningAuthority === 'function' &&
                targetYears.some(ty => isReigningAuthority(val, ty))) return;
            if (t3Procs && t3Procs.some(p => _task3YearInProcess(d.year, p))) return;
            // Обратная проверка: кандидат подходит как ответ для какого-то target.display?
            const myDisplays = fieldToDisplays[val] || new Set();
            for (const tdv of targetDisplayVals) {
                if (myDisplays.has(tdv)) return; // семантический близнец — не дистрактор
            }
            if (task7TargetDisplayKeys) {
                const myDisplayKeys = fieldToDisplayKeys[val] || new Set();
                for (const key of myDisplayKeys) {
                    if (task7TargetDisplayKeys.has(key)) return;
                }
            }
            if (task7TargetSemanticKeys) {
                const candidateKeys = fieldToSemanticKeys[val] || _task7FactSemanticKeys(d);
                for (const k of candidateKeys) {
                    if (task7TargetSemanticKeys.has(k)) return;
                }
            }
            // Правило ±N лет: применяется выборочно — не применяется к target-годам ВОВ (task5)
            if (yearDist > 0 && typeof d.year === 'number' && targetYears.length) {
                const tooClose = targetYears.some(ty => !wwExempt(ty) && Math.abs(d.year - ty) < yearDist);
                if (tooClose) return;
            }
            seen.add(val);
            const pri = targetPeriodSet.has(d.c) ? 0 : (adjSet.has(d.c) ? 1 : 2);
            scored.push({ val, pri });
        });
        shuffleArray(scored);
        scored.sort((a, b) => a.pri - b.pri);
        return scored;
    }

    const fakesCount = Math.ceil(target.length / 2);
    const needed = target.length + fakesCount;

    // Основной проход
    let scored = collectCandidates(initMinDist);

    // FALLBACK: если не хватает — поэтапно снижаем порог.
    // task5 — не ниже 12 лет: дистрактор-«современник» показанного события
    // (Меншиков при «Северной войне») почти всегда валиден семантически.
    // Лучше меньше фейков, чем двойной ответ.
    if (poolItems.length + scored.length < needed) {
        for (const step of (task === 'task5' ? [20, 12] : [20, 10, 5, 0])) {
            if (step >= initMinDist) continue;
            scored = collectCandidates(step);
            if (poolItems.length + scored.length >= needed) break;
        }
    }

    // ── task5: «парные» личности не встречаются в одном пуле вариантов ──
    // Если у двух личностей в базе есть ОБЩЕЕ событие (Минин/Пожарский,
    // Пётр I/Меншиков, Ленин/Троцкий), их совместное появление в пуле — маркер,
    // который выдаёт эпоху/событие и легко запоминается. Дистрактор, «парный»
    // любому уже лежащему в пуле (включая правильные ответы), пропускаем.
    let t5PersonEvents = null;
    if (task === 'task5') {
        t5PersonEvents = {};
        dataSource.forEach(d => {
            (t5PersonEvents[d.person] = t5PersonEvents[d.person] || new Set()).add(d.event);
        });
    }
    const t5Paired = (a, b) => {
        if (a === b) return false;
        const ea = t5PersonEvents[a], eb = t5PersonEvents[b];
        if (!ea || !eb) return false;
        for (const e of ea) if (eb.has(e)) return true;
        return false;
    };

    for (const s of scored) {
        if (poolItems.length >= needed) break;
        if (t5PersonEvents && poolItems.some(p => t5Paired(String(p), s.val))) continue;
        poolItems.push(s.val);
    }

    // ── Финальная дедупликация ──
    const uniquePool = [];
    const seenPool = new Set();
    for (const item of poolItems) {
        const str = String(item);
        if (!seenPool.has(str)) { seenPool.add(str); uniquePool.push(item); }
    }
    return uniquePool;
}

function generateDistractorsTask4(target, poolItems) {
    const rowsCount = target.length;
    // Вычисляем blanks и hidden types
    const blanksPerRow = Array(rowsCount).fill(1);
    let rem = Math.floor(rowsCount * 1.5) - rowsCount;
    while (rem > 0) {
        const r = Math.floor(Math.random() * rowsCount);
        if (blanksPerRow[r] < 2) { blanksPerRow[r]++; rem--; }
    }

    const totalBlanks = blanksPerRow.reduce((a, b) => a + b, 0);
    const types = ['geo', 'event', 'year'];
    const availableTypes = [];
    for (let i = 0; i < totalBlanks; i++) availableTypes.push(types[i % 3]);

    const fakesPerType = Math.ceil(rowsCount / 4);
    const requiredFakes = { geo: fakesPerType, event: fakesPerType, year: fakesPerType };
    const hiddenRowsData = [];

    // ── Определяем группы для каждой строки ──
    const rowGroups = target.map(getEventGroup);

    function popType(av, excl) {
        const valIds = av.map((t, i) => excl.includes(t) ? -1 : i).filter(i => i !== -1);
        if (valIds.length === 0) return av.splice(Math.floor(Math.random() * av.length), 1)[0];
        return av.splice(valIds[Math.floor(Math.random() * valIds.length)], 1)[0];
    }

    // ── Определяем что скрыть в каждой строке ──
    // Правило: если строка из тематической группы И у неё 1 бланк → нельзя скрывать event в одиночку
    // (иначе в дистракторах появится другое "присоединение" и не понять какое правильное)
    const rowChoices = [];
    target.forEach((row, idx) => {
        const needed = blanksPerRow[idx];
        const group = rowGroups[idx];
        const chosen = [];

        if (group && needed === 1) {
            // Группированная строка с 1 бланком → только geo или year
            const geoOrYear = availableTypes.filter(t => t !== 'event');
            if (geoOrYear.length > 0) {
                const pickIdx = availableTypes.indexOf(geoOrYear[Math.floor(Math.random() * geoOrYear.length)]);
                chosen.push(availableTypes.splice(pickIdx, 1)[0]);
            } else {
                // Все geo/year разобраны → берём event, но ОБЯЗАТЕЛЬНО добавляем 2-й бланк (geo или year)
                chosen.push(availableTypes.splice(availableTypes.indexOf('event'), 1)[0]);
                // Принудительно добавляем geo или year из оставшихся (или создаём новый)
                const extra = availableTypes.findIndex(t => t !== 'event');
                if (extra !== -1) {
                    chosen.push(availableTypes.splice(extra, 1)[0]);
                } else {
                    // Совсем крайний случай: добавляем год без учёта availableTypes
                    chosen.push(Math.random() < 0.5 ? 'geo' : 'year');
                }
                blanksPerRow[idx] = 2;
            }
        } else {
            for (let i = 0; i < needed; i++) chosen.push(popType(availableTypes, chosen));
        }

        hiddenRowsData.push({ row, types: chosen });
        rowChoices.push(chosen);
        chosen.forEach(key => poolItems.push(row[key]));
    });

    // ── FIX: устраняем дубликаты скрытых значений ──
    const hiddenValues = new Map();
    rowChoices.forEach((chosen, ri) => {
        chosen.forEach((key, ti) => {
            const val = String(target[ri][key]);
            if (!hiddenValues.has(val)) hiddenValues.set(val, []);
            hiddenValues.get(val).push({ ri, ti });
        });
    });
    for (const [val, slots] of hiddenValues) {
        if (slots.length < 2) continue;
        for (let s = 1; s < slots.length; s++) {
            const { ri, ti } = slots[s];
            const row = target[ri];
            const curKey = rowChoices[ri][ti];
            const allHiddenVals = new Set();
            rowChoices.forEach((ch, i) => ch.forEach((k, j) => {
                if (i !== ri || j !== ti) allHiddenVals.add(String(target[i][k]));
            }));
            const alt = types.filter(t => t !== curKey && !rowChoices[ri].includes(t));
            for (const newKey of alt) {
                if (!allHiddenVals.has(String(row[newKey]))) {
                    const oldIdx = poolItems.indexOf(String(row[curKey]));
                    if (oldIdx !== -1) poolItems.splice(oldIdx, 1);
                    poolItems.push(row[newKey]);
                    rowChoices[ri][ti] = newKey;
                    hiddenRowsData[ri].types[ti] = newKey;
                    break;
                }
            }
        }
    }

    // ── Строим bannedVals ──
    // 1) Близнецы (same year+geo) → банятся полностью (все поля)
    const targetFPs = new Set(target.map(eventFingerprint));
    const bannedVals = new Set(poolItems.map(String));
    window.bigData.forEach(d => {
        if (targetFPs.has(eventFingerprint(d)) && !target.includes(d)) {
            bannedVals.add(String(d.geo));
            bannedVals.add(String(d.event));
            bannedVals.add(String(d.year));
        }
    });
    // 2) Тематические группы → банятся ТОЛЬКО тексты событий
    //    Год и гео из группы — ОТЛИЧНЫЕ дистракторы (проверяют знания)
    const targetGroupIds = new Set(rowGroups.filter(Boolean));
    ensureGroupCache();
    if (targetGroupIds.size > 0 && _groupCache) {
        for (const gid of targetGroupIds) {
            (_groupCache[gid] || []).forEach(d => {
                if (!target.includes(d)) {
                    bannedVals.add(String(d.event)); // бан только на текст события
                }
            });
        }
    }
    // 3) Записи с ИДЕНТИЧНЫМ текстом event → банятся ВСЕ их поля
    //    Если event="вхождение в состав РФ" у target, а в базе ещё 3 таких —
    //    их geo/year создают неразрешимую неоднозначность
    const targetEvents = new Set(target.map(t => t.event));
    window.bigData.forEach(d => {
        if (targetEvents.has(d.event) && !target.includes(d)) {
            bannedVals.add(String(d.geo));
            bannedVals.add(String(d.event));
            bannedVals.add(String(d.year));
        }
    });

    // Авто-ловушки для годов.
    //
    // Факт считается «ТОПОВЫМ», если его год уже размечен в trapDict вручную.
    // Для ТОПовых событий (Куликовская, Бородино, Сталинград и т.п.) выпускник
    // ДОЛЖЕН знать год точно, поэтому допустимы близкие даты-ловушки.
    //
    // Для НЕ-ТОПовых событий (второстепенные битвы, города, указы) лучше
    // давать тематически близкие дистракторы (даже с разницей 100+ лет),
    // либо события той же эпохи с отступом ≥40 лет — чтобы случайная близость
    // в 2-3 года не создавала ложное ощущение ошибки ученика.
    function autoYearTraps(yearStr, targetFact) {
        const y = parseInt(yearStr, 10);
        if (!y) return [];
        const period = targetFact && targetFact.c;
        const targetGroup = targetFact ? getEventGroup(targetFact) : null;

        // Является ли дата «ТОПовой»? Проверяем наличие ключа в trapDict.
        const isTopEvent = typeof trapDict !== 'undefined' && trapDict.hasOwnProperty(yearStr);

        const seen = new Set();
        const thematic = []; // тематически родственные (любое расстояние)
        const farSame  = []; // та же эпоха, отступ ≥40 лет
        const nearSame = []; // та же эпоха, отступ <40 лет
        const closeAll = []; // ближайшие ≤50 лет (для ТОПовых — поведение как было раньше)

        window.bigData.forEach(d => {
            const dy = parseInt(d.year, 10);
            if (!dy || dy === y || seen.has(d.year)) return;
            seen.add(d.year);
            const dist = Math.abs(dy - y);
            if (targetGroup && getEventGroup(d) === targetGroup) {
                thematic.push({ val: d.year, dist });
            }
            if (period && d.c === period) {
                if (dist >= 40) farSame.push({ val: d.year, dist });
                else            nearSame.push({ val: d.year, dist });
            }
            if (dist <= 50) closeAll.push({ val: d.year, dist });
        });

        thematic.sort((a, b) => a.dist - b.dist);
        farSame.sort((a, b) => a.dist - b.dist);
        nearSame.sort((a, b) => b.dist - a.dist); // чем дальше, тем лучше в fallback
        closeAll.sort((a, b) => a.dist - b.dist);

        if (isTopEvent) {
            // ТОП: близкие даты — «злые» ловушки, как и было. trapDict всё равно
            // имеет приоритет 60% над этим auto-fallback.
            return [
                ...closeAll.slice(0, 4).map(c => c.val),
                ...thematic.slice(0, 2).map(c => c.val),
            ];
        }

        // НЕ-ТОП: приоритет тематическим, затем отступ ≥40, последним — fallback
        return [
            ...thematic.slice(0, 4).map(c => c.val),
            ...farSame.slice(0, 4).map(c => c.val),
            ...nearSame.slice(0, 2).map(c => c.val),
        ];
    }

    function autoGeoTraps(geoStr, period) {
        const targetGeos = new Set(target.map(t => t.geo));
        const seen = new Set(), result = [];
        shuffleArray(window.bigData.filter(d => d.c === period && !targetGeos.has(d.geo) && d.geo !== geoStr))
            .forEach(d => { if (!seen.has(d.geo)) { seen.add(d.geo); result.push(d.geo); } });
        return result.slice(0, 5);
    }

    const targetPeriodSet = new Set(target.map(t => t.c));
    const pFacts = window.bigData.filter(d => targetPeriodSet.has(d.c));

    ['geo', 'event', 'year'].forEach(type => {
        for (let i = 0; i < requiredFakes[type]; i++) {
            const relHid = hiddenRowsData.find(h => h.types.includes(type));
            // Ручные ловушки
            if (typeof trapDict !== 'undefined' && relHid && Math.random() < 0.6) {
                const pT = trapDict[relHid.row[type]];
                if (pT && pT.length > 0) {
                    const trap = pT[Math.floor(Math.random() * pT.length)];
                    if (!bannedVals.has(trap)) { poolItems.push(trap); bannedVals.add(trap); continue; }
                }
            }
            // Авто-ловушки для годов
            if (type === 'year' && relHid) {
                const picked = autoYearTraps(relHid.row.year, relHid.row).find(t => !bannedVals.has(t));
                if (picked) { poolItems.push(picked); bannedVals.add(picked); continue; }
            }
            // Авто-ловушки для гео
            if (type === 'geo' && relHid) {
                const picked = autoGeoTraps(relHid.row.geo, relHid.row.c).find(t => !bannedVals.has(t));
                if (picked) { poolItems.push(picked); bannedVals.add(picked); continue; }
            }
            // Fallback
            let fnd = false, att = 0;
            while (!fnd && att < 50) {
                const rF = pFacts[Math.floor(Math.random() * pFacts.length)];
                if (rF && !bannedVals.has(rF[type])) { poolItems.push(rF[type]); bannedVals.add(rF[type]); fnd = true; }
                att++;
            }
        }
    });

    // ── Финальная дедупликация пула ──
    const uniquePool = [];
    const seenPool = new Set();
    for (const item of poolItems) {
        const s = String(item);
        if (!seenPool.has(s)) { seenPool.add(s); uniquePool.push(item); }
    }

    return { poolItems: uniquePool, rowChoices, blanksPerRow };
}

// ═══════════════════════════════════════════════════════════
//  ЕДИНЫЙ ГЕНЕРАТОР ТАБЛИЦ
// ═══════════════════════════════════════════════════════════

function generateTableOnce() {
    // Any ordinary round replaces a previously embedded bank task. The marker is
    // intentionally session-only and is never persisted in the student state.
    window._activeEmbeddedFipiTask = null;
    // Режим «Решать»: случайный формат задания (task3/4/5/7) каждый раунд,
    // в выбранном (или любом) периоде. Формат меняется на каждой «Дальше».
    if (window.state.currentMode === 'solve') {
        const t = TASK_LIST[Math.floor(Math.random() * TASK_LIST.length)];
        window.state.currentTask = t;
        if ($('filter-task')) $('filter-task').value = t;
    }

    const task = window.state.currentTask;

    // Режим ошибок: УВАЖАЕМ выбранное/текущее задание (из пикера или главной кнопки).
    // Раньше здесь каждый раз выбиралось СЛУЧАЙНОЕ задание среди всех, где есть что решать —
    // из-за этого «выбрал задание 1, показывает 4». Переключаемся на другое задание ТОЛЬКО
    // когда в текущем уже нечего решать (ошибки/просроченные разобраны).
    if (window.state.currentMode === 'mistakes') {
        const mPool = window.state.mistakesPool || [];
        const now = Date.now();
        const contentOf = (t) => {
            const cfg = TASK_CONFIG[t];
            const hasM = mPool.some(m => m.task === t);
            const hasE = cfg.data().some(f => {
                const d = window.state.stats.factStreaks[cfg.keyFn(f)];
                return d && d.level > 0 && d.nextReview <= now;
            });
            return { hasM, hasE };
        };
        const cur = contentOf(window.state.currentTask);
        // Фокус «Повторить» смотрит на просроченные; обычные ошибки — на любое содержимое.
        const curOk = window.state.reviewFocus ? cur.hasE : (cur.hasM || cur.hasE);
        if (!curOk) {
            const availableTasks = [], expiredTasks = [];
            TASK_LIST.forEach(t => { const c = contentOf(t); if (c.hasM || c.hasE) availableTasks.push(t); if (c.hasE) expiredTasks.push(t); });
            const pickFrom = (window.state.reviewFocus && expiredTasks.length > 0) ? expiredTasks : availableTasks;
            if (pickFrom.length > 0) {
                const randomTask = pickFrom[Math.floor(Math.random() * pickFrom.length)];
                window.state.currentTask = randomTask;
                $('filter-task').value = randomTask;
            }
        }
    }

    // Режим детектива — отдельная логика
    if (window.state.currentMode === 'detective') return generateDetectiveTable();

    // Task4 имеет 3-колоночную таблицу с множественными скрытыми полями — отдельная ветка
    if (window.state.currentTask === 'task4') return generateTask4Table();

    // Task3/5/7 — единая логика 2-колоночной таблицы
    return generateTwoColumnTable();
}

// ── Слой 1: инвариант-валидатор сгенерированной классической таблицы ──
// Гарантирует: (1) решаемость — каждый ожидаемый ответ присутствует в пуле
// в нужном количестве; (2) уникальность — один и тот же ответ не требуется
// в 2+ слотах (иначе задание неоднозначно). Детектив/визуал/ДЗ не проверяются.
function validateTable() {
    const slots = $$('#task-table-body .dnd-slot');
    if (!slots.length) return true; // пустая таблица (напр. «ошибок нет») — не ошибка
    const have = {};
    $$('#pool-container .dnd-chip').forEach(c => {
        const t = c.dataset.pureText;
        have[t] = (have[t] || 0) + 1;
    });
    const need = {};
    slots.forEach(s => { const e = s.dataset.expected; need[e] = (need[e] || 0) + 1; });
    for (const v in need) {
        if (need[v] > 1) return false;        // дубль ответа → неоднозначно
        if ((have[v] || 0) < need[v]) return false; // не хватает фишек → нерешаемо
    }
    return true;
}

// ── Гейт неоднозначности task5 ──
// (1) пары: две личности пула (ответы или дистракторы) с ОБЩИМ событием в базе
//     (Кутузов+Багратион ← Бородино) — маркер и потенциальный двойной ответ;
// (2) взаимозаменяемые строки: события двух строк покрываются активными
//     периодами обеих личностей (Суворов/Ушаков ← 1799);
// (3) правитель: личность-ответ одной строки правила страной в год события
//     другой строки (Пётр I + Гангут, Екатерина II + Пугачёв).
// При нарушении раунд пересобирается (см. generateTable).
let _t5PairMap = null;
function _task5PersonEventsMap() {
    if (_t5PairMap) return _t5PairMap;
    const m = {};
    (window.task5Data || []).forEach(d => {
        (m[d.person] = m[d.person] || new Set()).add(d.event);
    });
    return (_t5PairMap = m);
}
function _task5PoolPaired() {
    const chips = Array.from(document.querySelectorAll('#pool-container .dnd-chip')).map(c => c.dataset.pureText);
    const m = _task5PersonEventsMap();
    for (let i = 0; i < chips.length; i++) {
        const ea = m[chips[i]];
        if (!ea) continue;
        for (let j = i + 1; j < chips.length; j++) {
            const eb = m[chips[j]];
            if (!eb) continue;
            for (const e of ea) if (eb.has(e)) return true;
        }
    }
    return false;
}
function _task5GateOk() {
    if (window.state.currentTask !== 'task5') return true;
    const t = window.state.currentTargetData || [];
    for (let i = 0; i < t.length; i++) {
        for (let j = i + 1; j < t.length; j++) {
            if (_task5Interchangeable(t[i], t[j])) return false;
        }
    }
    if (typeof isReigningAuthority === 'function') {
        for (const a of t) for (const b of t) {
            // ВОВ-строки (слот 3) исключены: иначе Сталин-строки (образование СССР,
            // Ялта) не могли бы соседствовать с обязательным ВОВ-слотом вовсе.
            if (a !== b && typeof b.year === 'number' &&
                !(b.year >= 1941 && b.year <= 1945) &&
                isReigningAuthority(a.person, b.year)) return false;
        }
    }
    return !_task5PoolPaired();
}

// Цельное задание из открытого банка использует ровно тот же стол, фишки и
// проверку, что и авторские вопросы. Источник данных намеренно не показывается:
// для ученика это обычной раунд выбранного задания, без смены интерфейса.
function renderEmbeddedFipiTask(task) {
    const taskKey = `task${Number(task?.kim) || 0}`;
    if (!task || !['task1', 'task3', 'task4', 'task5', 'task7'].includes(taskKey)) return false;
    if (taskKey !== window.state.currentTask) return false;

    const answerDigits = window.EgeScoring?.normalizeSymbols(task.answer) || String(task.answer || '').split('');
    const options = new Map((task.elements || []).map(item => [String(item.n), String(item.text || '').trim()]));
    const optionForSlot = index => options.get(String(answerDigits[index] || '')) || '';
    if (!answerDigits.length || answerDigits.some((_, index) => !optionForSlot(index))) return false;

    const structuredRows = taskKey === 'task4' ? task.grid : task.targets;
    if (!Array.isArray(structuredRows)) return false;
    if (taskKey === 'task4' && structuredRows.length !== 4) return false;
    if (taskKey !== 'task4' && structuredRows.length !== answerDigits.length) return false;

    resetTableUI();
    window._activeEmbeddedFipiTask = task;
    window.state.tableHasMistake = false;
    window.state.answersRevealed = false;

    const facts = [];
    const body = $('task-table-body');
    const pool = $('pool-container');
    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];

    const makeSlot = (expected, label, slotIndex) => {
        const slot = document.createElement('div');
        slot.className = 'dnd-slot relative';
        slot.dataset.expected = expected;
        slot.dataset.letter = label || '?';
        slot.dataset.fipiSlot = String(slotIndex);
        return slot;
    };

    if (taskKey === 'task4') {
        $('table-head').innerHTML = '<tr><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[27.5%] text-center">🗺️ Объект</th><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[45%] border-l border-gray-200 dark:border-[#2c2c2c] text-center">📜 Событие</th><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[27.5%] border-l border-gray-200 dark:border-[#2c2c2c] text-center">⏳ Дата</th></tr>';
        task.grid.forEach((sourceRow, rowIndex) => {
            const resolved = sourceRow.map(cell => Number.isInteger(cell.slot) ? optionForSlot(cell.slot) : String(cell.text || ''));
            const fact = {
                geo: resolved[0], event: resolved[1], year: resolved[2],
                _fipiKey: `fipi_${task.id}_${rowIndex}`,
                _fipiTaskId: task.id
            };
            facts.push(fact);
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-100 dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] transition-colors hover:bg-gray-50 dark:hover:bg-[#25282a]';
            tr.dataset.index = String(rowIndex);
            sourceRow.forEach((cell, cellIndex) => {
                const td = document.createElement('td');
                td.className = 'p-1 sm:p-3 py-1.5 align-middle text-center overflow-hidden border-l border-gray-100 dark:border-[#2c2c2c] first:border-l-0';
                if (Number.isInteger(cell.slot)) {
                    td.appendChild(makeSlot(optionForSlot(cell.slot), letters[cell.slot], cell.slot));
                } else {
                    const span = document.createElement('span');
                    span.className = `text-[12px] sm:text-[14px] ${cellIndex === 2 ? 'font-bold text-blue-800 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'} leading-relaxed block`;
                    span.textContent = String(cell.text || '');
                    td.appendChild(span);
                }
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    } else {
        const cfg = TASK_CONFIG[taskKey];
        const targets = task.targets;
        $('table-head').innerHTML = `<tr>${cfg.tableHeaders.map((header, index) =>
            `<th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[${cfg.headerWidths[index]}] ${index === 0 ? 'text-left pl-2 sm:pl-4' : 'border-l border-gray-200 dark:border-[#2c2c2c] text-center'}">${header}</th>`
        ).join('')}</tr>`;
        const fieldMap = { task1: ['event', 'year'], task3: ['process', 'fact'], task5: ['event', 'person'], task7: ['culture', 'trait'] };
        const [displayField, hiddenField] = fieldMap[taskKey];
        targets.forEach((target, index) => {
            const expected = optionForSlot(index);
            const fact = {
                [displayField]: String(target.text || ''),
                [hiddenField]: expected,
                id: `fipi_${task.id}_${index}`,
                _fipiKey: `fipi_${task.id}_${index}`,
                _fipiTaskId: task.id,
                _fipiExpected: expected
            };
            facts.push(fact);
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-100 dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] transition-colors hover:bg-gray-50 dark:hover:bg-[#25282a]';
            tr.dataset.index = String(index);
            const labelCell = document.createElement('td');
            labelCell.className = 'p-1.5 sm:p-3 py-1.5 align-middle text-left border-r border-gray-100 dark:border-[#2c2c2c]';
            const label = document.createElement('span');
            label.className = 'text-[12px] sm:text-[14px] font-bold text-gray-800 dark:text-gray-300 leading-relaxed block';
            label.textContent = `${target.label || letters[index] || '?'}) ${target.text || ''}`;
            labelCell.appendChild(label);
            const slotCell = document.createElement('td');
            slotCell.className = 'p-1 sm:p-3 py-1.5 align-middle text-center overflow-hidden';
            slotCell.appendChild(makeSlot(expected, target.label || letters[index], index));
            tr.append(labelCell, slotCell);
            body.appendChild(tr);
        });
    }

    window.state.currentTargetData = facts;
    shuffleArray([...(task.elements || [])]).forEach(item => {
        const chip = document.createElement('div');
        chip.className = `dnd-chip${taskKey === 'task7' ? ' task7-chip' : ''}`;
        chip.textContent = String(item.text || '').trim();
        chip.dataset.pureText = String(item.text || '').trim();
        pool.appendChild(chip);
    });
    return true;
}
window.renderEmbeddedFipiTask = renderEmbeddedFipiTask;

// Обёртка-гейт: генерирует и при нарушении инварианта перегенерирует.
// Детектив и режим ДЗ (фиксированные индексы) не валидируются/не ретраятся.
function generateTable() {
    // В обычной тренировке без ограничения по эпохе каждый новый раунд имеет
    // 20% шанс стать цельным заданием того же номера из открытого банка ФИПИ.
    if (window.EgeExamMode?.maybeOpenTrainingTask?.()) return;
    const skipValidation = () =>
        window.state.currentMode === 'detective' ||
        window.state.isHomeworkMode === true;

    for (let attempt = 0; attempt < 15; attempt++) {
        generateTableOnce();
        if (skipValidation() || (validateTable() && _task5GateOk())) return;
    }
    // Фолбэк: умный подбор по всем эпохам обычно даёт корректную таблицу.
    const periodEl = $('filter-period');
    const saved = periodEl ? periodEl.value : 'all';
    if (periodEl && saved !== 'all') {
        periodEl.value = 'all';
        generateTableOnce();
        periodEl.value = saved;
    }
}

window.generateTableOnce = generateTableOnce;
window.validateTable = validateTable;

// Task3/5/7 — единый генератор 2-колоночных таблиц
function generateTwoColumnTable() {
    const task = window.state.currentTask;
    const cfg = TASK_CONFIG[task];

    window.state.tableHasMistake = false;
    window.state.answersRevealed = false;

    const isForced4 = window.state.currentMode === 'duel';
    const rowsCount = isForced4 ? 4 : (parseInt($('filter-rows').value) || 4);
    const actualPeriod = isForced4 ? 'all' : ($('filter-period').value || 'all');

    // Сброс UI
    resetTableUI();

    $('table-head').innerHTML = `<tr>${cfg.tableHeaders.map((h, i) =>
        `<th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[${cfg.headerWidths[i]}] ${i === 0 ? 'text-left pl-2 sm:pl-4' : 'border-l border-gray-200 dark:border-[#2c2c2c] text-center'}">${h}</th>`
    ).join('')}</tr>`;

    // Получаем пул
    let allowed = getFilteredPool(actualPeriod, rowsCount);
    if (!allowed || allowed.length === 0) {
        $('task-table-body').innerHTML = `<tr><td colspan="2" class="p-10 text-center font-bold text-rose-500 bg-white dark:bg-[#1e1e1e]">⚠️ Нет событий!</td></tr>`;
        return;
    }

    // Подбираем строки
    let target = [];
    if (window.state.isHomeworkMode && window.state.hwTargetIndices?.length > 0) {
        const dataSource = cfg.data();
        const count = Math.min(rowsCount, window.state.hwCurrentPool.length);
        window.state.hwCurrentPool.slice(0, count).forEach(i => {
            if (dataSource[i]) target.push(dataSource[i]);
        });
    } else {
        const picker = EPOCH_PICKERS[task];
        // Умный подбор работает если доступны все эпохи (all, или кастом покрывающий все)
        const coversAll = TASK_EPOCHS.every(e => allowed.some(f => f.c === e));
        if (coversAll && picker) target = picker(allowed, rowsCount) || [];
        if (target.length === 0) {
            // Fallback: случайный выбор с дедупликацией
            target = [];
            const dedupeKey = task === 'task7' ? 'culture' : (cfg.displayField || 'event');
            const dedupeKey2 = cfg.fieldName || (task === 'task3' ? 'fact' : (task === 'task5' ? 'person' : 'trait'));
            const used1 = new Set(), used2 = new Set();
            // Task7: дополнительная проверка на кросс-неоднозначность
            const selectedTraits = new Set();
            const selectedCultures7 = new Set();
            const selectedRows7 = [];
            // Task5: аналогичная проверка для event→person
            const selectedPersons5 = new Set();
            const selectedEvents5 = new Set();
            const eventPersons5 = {};
            if (task === 'task5') {
                (window.task5Data || []).forEach(d => {
                    if (!eventPersons5[d.event]) eventPersons5[d.event] = new Set();
                    eventPersons5[d.event].add(d.person);
                });
            }
            const shuf = shuffleArray([...allowed]);
            const t5Deferred = [];  // task5: отложенные из-за неоднозначности (добираем, если не хватит)
            for (const f of shuf) {
                if (target.length >= rowsCount) break;
                if (task === 'task1') {
                    if (_task1EventVariants(f).some(v => used1.has(v))) continue;
                } else if (used1.has(f[dedupeKey])) continue;
                if (dedupeKey2 && used2.has(f[dedupeKey2])) continue;
                // Task7: trait не должен быть альтернативой другой уже выбранной culture и наоборот
                if (task === 'task7') {
                    if (!_task7CanUseAsTarget(f, selectedRows7, selectedCultures7, selectedTraits)) continue;
                }
                // Task5: person не должен быть альтернативой другого уже выбранного event и наоборот
                if (task === 'task5') {
                    const myAlts = eventPersons5[f.event] || new Set();
                    const fwd = [...selectedPersons5].some(sp => myAlts.has(sp));
                    const rev = [...selectedEvents5].some(se => (eventPersons5[se]||new Set()).has(f.person));
                    if (fwd || rev) continue;
                    // событие не должно подходить сразу двум личностям с уже выбранной строкой
                    if (target.some(t => _task5Interchangeable(f, t))) { t5Deferred.push(f); continue; }
                }
                // Task3: факт кандидата не должен попадать в диапазон лет уже выбранного
                // процесса (и наоборот) — иначе ответы строк взаимозаменяемы
                if (task === 'task3' && target.some(t => _task3Conflicts(f, t))) { t5Deferred.push(f); continue; }
                target.push(f);
                if (task === 'task1') _task1EventVariants(f).forEach(v => used1.add(v));
                else used1.add(f[dedupeKey]);
                if (dedupeKey2) { used2.add(f[dedupeKey2]); selectedTraits.add(f[dedupeKey2]); }
                if (task === 'task7') _task7RememberTarget(f, selectedRows7, selectedCultures7, selectedTraits);
                if (task === 'task5') { selectedPersons5.add(f.person); selectedEvents5.add(f.event); }
            }
            // Если защита от неоднозначности не дала набрать строки (узкий период) —
            // добираем из отложенных, чтобы задание не оказалось неполным.
            if ((task === 'task5' || task === 'task3') && target.length < rowsCount && t5Deferred.length) {
                for (const f of t5Deferred) {
                    if (target.length >= rowsCount) break;
                    if (used1.has(f[dedupeKey]) || (dedupeKey2 && used2.has(f[dedupeKey2]))) continue;
                    target.push(f);
                    used1.add(f[dedupeKey]); if (dedupeKey2) used2.add(f[dedupeKey2]);
                    if (task === 'task5') { selectedPersons5.add(f.person); selectedEvents5.add(f.event); }
                }
            }
        }
    }

    if (task === 'task1') {
        const usedEvents = new Set();
        target = target.map(row => {
            const materialized = _task1MaterializeEvent(row, usedEvents);
            if (materialized?.event) usedEvents.add(materialized.event);
            return materialized;
        });
    }

    if (task === 'task7') {
        target = target.map(_task7MaterializeTrait);
    }

    // Сортировка по году для хронологических и культурных заданий
    if (task === 'task1' || task === 'task3' || task === 'task7') {
        const sortByYear = $('filter-sort-year') && $('filter-sort-year').checked;
        if (sortByYear) target.sort((a, b) => getYearFromFact(a) - getYearFromFact(b));
    }

    window.state.currentTargetData = target;

    // Определяем скрытое поле и отображаемое
    const fieldMap = { task1: ['event', 'year'], task3: ['process', 'fact'], task5: ['event', 'person'], task7: ['culture', 'trait'] };
    const [displayField, hiddenField] = fieldMap[task];

    const missing = [];
    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М'];
    const trFrag = document.createDocumentFragment();

    target.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-100 dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] transition-colors hover:bg-gray-50 dark:hover:bg-[#25282a]";
        tr.dataset.index = idx;
        missing.push(row[hiddenField]);

        const chipClass = task === 'task7' ? 'task7-chip' : '';
        tr.innerHTML = `<td class="p-1.5 sm:p-3 py-1.5 align-middle text-left border-r border-gray-100 dark:border-[#2c2c2c]"><span class="text-[12px] sm:text-[14px] font-bold text-gray-800 dark:text-gray-300 leading-relaxed block">${letters[idx] || '?'}) ${row[displayField]}</span></td>` +
            `<td class="p-1 sm:p-3 py-1.5 align-middle text-center overflow-hidden"><div class="dnd-slot relative ${chipClass ? '' : ''}" data-expected="${String(row[hiddenField]).replace(/"/g, '&quot;')}" data-letter="?"></div></td>`;
        trFrag.appendChild(tr);
    });
    $('task-table-body').appendChild(trFrag);

    // Дистракторы
    const poolItems = generateDistractors(task, target, missing);

    const poolFrag = document.createDocumentFragment();
    const chipExtraClass = task === 'task7' ? ' task7-chip' : '';
    shuffleArray(poolItems).forEach(txt => {
        const c = document.createElement('div');
        c.className = 'dnd-chip' + chipExtraClass;
        c.innerText = txt;
        c.dataset.pureText = txt;
        poolFrag.appendChild(c);
    });
    $('pool-container').appendChild(poolFrag);
}

// Task4 — 3-колоночная таблица со смешанными скрытыми полями
function generateTask4Table() {
    window.state.tableHasMistake = false;
    window.state.answersRevealed = false;

    const isForced4 = window.state.currentMode === 'duel';
    const rowsCount = isForced4 ? 4 : (parseInt(DOM['filter-rows']?.value || $('filter-rows').value) || 4);
    const actualPeriod = isForced4 ? 'all' : (DOM['filter-period']?.value || $('filter-period').value || 'all');

    resetTableUI();

    // FIX: всегда перестраиваем голову task4. Раньше кэш _lastHeadTask не сбрасывался
    // генератором 2-колоночных таблиц → при task4→task3→task4 оставалась голова на 2 колонки,
    // и третья колонка визуально «отваливалась».
    $('table-head').innerHTML = `<tr><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[27.5%] text-center">🗺️ Объект</th><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[45%] border-l border-gray-200 dark:border-[#2c2c2c] text-center">📜 Событие</th><th class="p-1.5 sm:p-3 text-[12px] sm:text-[14px] font-bold border-b border-gray-200 dark:border-[#2c2c2c] w-[27.5%] border-l border-gray-200 dark:border-[#2c2c2c] text-center">⏳ Дата</th></tr>`;

    let target = [];
    if (window.state.isHomeworkMode && window.state.hwTargetIndices?.length > 0) {
        const count = Math.min(rowsCount, window.state.hwCurrentPool.length);
        window.state.hwCurrentPool.slice(0, count).forEach(i => {
            if (window.bigData[i]) target.push(window.bigData[i]);
        });
    } else {
        const allowed = getFilteredPool(actualPeriod, rowsCount);
        if (!allowed || allowed.length === 0) {
            $('task-table-body').innerHTML = `<tr><td colspan="3" class="p-10 text-center font-bold text-rose-500 bg-white dark:bg-[#1e1e1e]">⚠️ Нет событий!</td></tr>`;
            return;
        }
        // Умный подбор работает если доступны все эпохи (all, или кастом покрывающий все)
        const coversAllEpochs4 = TASK_EPOCHS.every(e => allowed.some(f => f.c === e));
        if (coversAllEpochs4) target = pickTargetTask4(allowed, rowsCount) || [];
        if (target.length === 0) {
            // Fallback с дедупликацией по event text + fingerprint
            target = [];
            const usedEvents = new Set();
            const usedFPs = new Set();
            for (const f of shuffleArray([...allowed])) {
                if (target.length >= rowsCount) break;
                const fp = eventFingerprint(f);
                if (!usedEvents.has(f.event) && !usedFPs.has(fp)) {
                    target.push(f); usedEvents.add(f.event); usedFPs.add(fp);
                }
            }
        }
    }

    window.state.currentTargetData = target;

    // Генерация дистракторов для task4
    const result = generateDistractorsTask4(target, []);
    const { poolItems, rowChoices } = result;

    const letters = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М', 'Н', 'О', 'П'];
    let lIdx = 0;
    const trFrag = document.createDocumentFragment();

    target.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-100 dark:border-[#2c2c2c] bg-white dark:bg-[#1e1e1e] transition-colors hover:bg-gray-50 dark:hover:bg-[#25282a]";
        tr.dataset.index = idx;
        const chosen = rowChoices[idx];

        ['geo', 'event', 'year'].forEach(key => {
            const td = document.createElement('td');
            td.className = "p-1 sm:p-3 py-1.5 align-middle text-center overflow-hidden border-l border-gray-100 dark:border-[#2c2c2c] first:border-l-0";
            if (chosen.includes(key)) {
                td.innerHTML = `<div class="dnd-slot relative" data-expected="${String(row[key]).replace(/"/g, '&quot;')}" data-letter="${letters[lIdx] || '?'}"></div>`;
                lIdx++;
            } else {
                const style = key === 'year' ? "font-bold text-blue-800 dark:text-blue-400" : "text-gray-700 dark:text-gray-300";
                let cH = `<span class="text-[12px] sm:text-[14px] ${style} leading-relaxed block">${row[key]}</span>`;
                if (key === 'geo' && typeof geoDict !== 'undefined' && geoDict[row[key]]) {
                    cH = `<span onclick="openMapModal('${row[key]}')" title="На карте" class="text-[12px] sm:text-[14px] font-bold text-blue-600 dark:text-blue-400 underline decoration-dashed cursor-pointer block">${row[key]}</span>`;
                }
                td.innerHTML = cH;
            }
            tr.appendChild(td);
        });
        trFrag.appendChild(tr);
    });
    $('task-table-body').appendChild(trFrag);

    const pFrag = document.createDocumentFragment();
    shuffleArray(poolItems).forEach(txt => {
        const c = document.createElement('div');
        c.className = "dnd-chip";
        c.innerText = txt;
        c.dataset.pureText = txt;
        pFrag.appendChild(c);
    });
    $('pool-container').appendChild(pFrag);
}

// Сброс UI таблицы
function resetTableUI() {
    const poolTitle = DOM['pool-title'] || $('pool-title');
    if (poolTitle) poolTitle.innerHTML = '<span>🧩</span> ВАРИАНТЫ';
    const stamp = DOM['detective-stamp'] || $('detective-stamp');
    if (stamp) stamp.classList.add('hidden');

    const checkBtns = DOM['check-buttons'] || $('check-buttons');
    if (checkBtns) { checkBtns.classList.remove('hidden'); checkBtns.classList.add('flex'); }

    const btnSure = DOM['check-btn-sure'] || $('check-btn-sure');
    if (btnSure) btnSure.innerHTML = '✅ Уверен';
    const btnDoubt = DOM['check-btn-doubt'] || $('check-btn-doubt');
    if (btnDoubt) btnDoubt.innerHTML = '🤔 Сомневаюсь';

    const revealBtn = DOM['reveal-btn'] || $('reveal-btn');
    if (revealBtn) {
        revealBtn.className = "hidden text-gray-500 hover:text-orange-500 dark:text-gray-400 font-bold py-2 active:scale-95 text-[11px] sm:text-xs w-full transition-colors underline uppercase tracking-wider mt-2";
        revealBtn.innerHTML = '👀 Сдаюсь, покажи ответы';
    }

    const nextBtn = DOM['next-btn'] || $('next-btn');
    if (nextBtn) nextBtn.classList.add('hidden');

    const tbody = DOM['task-table-body'] || $('task-table-body');
    if (tbody) tbody.innerHTML = '';
    const pool = DOM['pool-container'] || $('pool-container');
    if (pool) pool.innerHTML = '';
}

// Обработка кликов по слотам и чипам
function handleSlotClick(slot) {
    if (slot.classList.contains('correct-slot') || slot.classList.contains('revealed-slot')) return;
    haptic('light');
    if (window.state.selectedChip) {
        if (slot.classList.contains('has-item')) {
            const oldC = slot.querySelector('.dnd-chip');
            if (oldC) { oldC.classList.remove('in-slot', 'selected'); $('pool-container').appendChild(oldC); }
        }
        const newC = window.state.selectedChip;
        newC.classList.remove('selected');
        newC.classList.add('in-slot');
        slot.innerHTML = '';
        slot.appendChild(newC);
        slot.classList.add('has-item');
        slot.classList.remove('incorrect-slot');
        window.state.selectedChip = null;
        updateSlotGlow();
        if (window.maybeAutoSubmit) window.maybeAutoSubmit(); // авто-«Далее» при полностью верном заполнении
    } else if (slot.classList.contains('has-item')) {
        const oldC = slot.querySelector('.dnd-chip');
        if (oldC) {
            oldC.classList.remove('in-slot', 'selected');
            $('pool-container').appendChild(oldC);
            slot.innerHTML = '';
            slot.classList.remove('has-item', 'incorrect-slot');
        }
    }
}

function updateSlotGlow() {
    $$('.dnd-slot').forEach(s => s.classList.toggle('slot-ready', !!window.state.selectedChip && !s.classList.contains('has-item')));
}

window.onChipClick = function(chip, e) {
    haptic('light');
    const now = Date.now();
    const timeSinceLastClick = now - (chip._lastClickTime || 0);

    if (chip.classList.contains('crossed-out')) {
        chip.classList.remove('crossed-out', 'opacity-30', 'line-through', 'grayscale', 'scale-90');
        chip._lastClickTime = 0;
    } else if (timeSinceLastClick < 300) {
        chip.classList.add('crossed-out', 'opacity-30', 'line-through', 'grayscale', 'scale-90');
        chip.classList.remove('selected');
        if (window.state.selectedChip === chip) window.state.selectedChip = null;
        updateSlotGlow();
        // Разовая подсказка: нетерпеливый двойной тап зачёркивает вариант, и без
        // объяснения новичок думает, что вариант «сломался/пропал».
        try {
            if (!localStorage.getItem('hint_cross_seen')) {
                localStorage.setItem('hint_cross_seen', '1');
                if (typeof showToast === 'function') showToast('✏️', 'Двойной тап зачёркивает вариант (отсев). Тапни ещё раз — вернётся.', 'bg-gray-800', 'border-black');
            }
        } catch (er) {}
        e.stopPropagation();
        chip._lastClickTime = now;
        return;
    }

    chip._lastClickTime = now;

    if (chip.classList.contains('in-slot')) {
        e.stopPropagation();
        const slot = chip.parentElement;
        if (slot.classList.contains('correct-slot') || slot.classList.contains('revealed-slot')) return;
        chip.classList.remove('in-slot', 'selected');
        $('pool-container').appendChild(chip);
        slot.innerHTML = '';
        slot.classList.remove('has-item', 'incorrect-slot');
        if (window.state.selectedChip === chip) window.state.selectedChip = null;
        updateSlotGlow();
        return;
    }

    if (window.state.selectedChip && window.state.selectedChip !== chip) {
        window.state.selectedChip.classList.remove('selected');
    }
    if (window.state.selectedChip !== chip) {
        window.state.selectedChip = chip;
        chip.classList.add('selected');
    } else {
        window.state.selectedChip = null;
        chip.classList.remove('selected');
    }
    updateSlotGlow();
};
