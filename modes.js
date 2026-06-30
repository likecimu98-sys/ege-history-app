// modes.js — игровые режимы: flashcards, study, redpencil, detective, duel
// Зависимости: config.js, utils.js, state.js, table.js
'use strict';

// ═══════════════════════════════════════════════════════════
//  ДУЭЛЬ (PvP)
// ═══════════════════════════════════════════════════════════

let duelSearchTimer = null;
let duelSearchSeconds = 0;

window.startDuelSearch = function() {
    haptic('medium');
    showModal('duel-search-modal');
    $('duel-search-status').innerText = "Поиск соперника...";
    duelSearchSeconds = 0;
    $('duel-search-timer').innerText = `Ожидание: 0с`;
    duelSearchTimer = setInterval(() => {
        duelSearchSeconds++;
        $('duel-search-timer').innerText = `Ожидание: ${duelSearchSeconds}с`;
        if (duelSearchSeconds > 30) window.cancelDuelSearch('Никого нет в сети 😢');
    }, 1000);
    if (window.startDuelSearchDb) window.startDuelSearchDb();
};

window.cancelDuelSearch = function(msg) {
    haptic('light');
    clearInterval(duelSearchTimer);
    hideModal('duel-search-modal');
    if (msg) showToast('ℹ️', msg, 'bg-blue-500', 'border-blue-700');
    if (window.cancelDuelDb) window.cancelDuelDb();
};

// Принять вызов из всплывающего баннера
window.acceptDuelChallenge = async function(matchId) {
    haptic('medium');
    if (window.hideDuelChallenge) window.hideDuelChallenge();
    if (!matchId || !window.acceptDuelChallengeDb) return;
    showModal('duel-search-modal');
    $('duel-search-status').innerText = 'Подключение к дуэли...';
    $('duel-search-timer').innerText = 'Принимаем вызов...';
    $('cancel-duel-btn').classList.remove('hidden');
    const ok = await window.acceptDuelChallengeDb(matchId);
    if (!ok) hideModal('duel-search-modal');
    // при успехе listenToDuel → initDuelStart запустит обратный отсчёт и игру
};

window.initDuelStart = function(startTime) {
    clearInterval(duelSearchTimer);
    haptic('success');
    $('duel-search-status').innerText = "СОПЕРНИК НАЙДЕН!";
    $('cancel-duel-btn').classList.add('hidden');
    $('duel-search-timer').innerText = (window.state.duel.oppName || 'Соперник') + " готовится...";
    const startWait = setInterval(() => {
        const left = startTime - Date.now();
        if (left <= 0) { clearInterval(startWait); hideModal('duel-search-modal'); window.startDuelGame(); }
        else { $('duel-search-timer').innerText = `Начинаем через ${Math.ceil(left / 1000)}...`; }
    }, 100);
};

window.startDuelGame = function() {
    $('lobby-area').classList.add('hidden');
    $('game-container').classList.remove('hidden');
    $('game-container').classList.add('flex');
    document.body.classList.add('in-game');
    $('bottom-nav').classList.add('hide-nav');

    ['flashcard-area', 'study-area', 'visual-trainer-area', 'redpencil-area'].forEach(id => {
        const el = $(id); if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
    });
    const ca = $('classic-task-area');
    if (ca) { ca.classList.remove('hidden'); ca.classList.add('flex', 'lg:flex-row'); }

    window.state.currentTask = 'task4';
    $('filter-task').value = 'task4';
    window.state.currentMode = 'duel';
    Object.assign(window.state.duel, { active: true, myScore: 0, myCombo: 0, oppScore: 0, oppCombo: 0 });
    window.state.timeLeft = 60;

    $('game-header').classList.add('hidden');
    $('duel-header').classList.remove('hidden');
    $('duel-header').classList.add('flex');
    $('duel-opp-name').innerText = window.state.duel.oppName || "Соперник";
    window.updateDuelUI();
    window.generateTable();

    window.state.timerInterval = setInterval(() => {
        window.state.timeLeft--;
        $('duel-timer').innerText = window.state.timeLeft;
        if (window.state.timeLeft <= 0) window.endDuel();
    }, 1000);
};

window.updateDuelUI = function() {
    if (!window.state.duel?.active) return;
    $('duel-my-score').innerText = window.state.duel.myScore;
    $('duel-opp-score').innerText = window.state.duel.oppScore;
    $('duel-my-combo').innerText = `🔥 ${window.state.duel.myCombo}`;
    $('duel-opp-combo').innerText = `🔥 ${window.state.duel.oppCombo}`;
};

window.endDuel = function() {
    clearInterval(window.state.timerInterval);
    const myS = window.state.duel.myScore, oppS = window.state.duel.oppScore;
    window.state.duel.active = false;
    if (window.cancelDuelDb) window.cancelDuelDb();

    let emoji = '😐', title = 'НИЧЬЯ', color = 'text-gray-500';
    if (myS > oppS) { emoji = '🏆'; title = 'ПОБЕДА!'; color = 'text-emerald-500'; haptic('success'); }
    else if (myS < oppS) { emoji = '💔'; title = 'ПОРАЖЕНИЕ'; color = 'text-rose-500'; haptic('error'); }

    $('modal-emoji').innerText = emoji;
    $('modal-main-title').innerText = title;
    $('modal-score').innerHTML = `<span class="${color}">${myS}</span> <span class="text-gray-400 text-3xl mx-2">:</span> <span class="text-gray-500">${oppS}</span>`;
    showModal('game-over-modal');
    $('board-overlay').classList.remove('hidden');
    saveLocal();
    syncNow();
    updateGlobalUI();
};

// ═══════════════════════════════════════════════════════════
//  ФЛЕШ-КАРТОЧКИ
// ═══════════════════════════════════════════════════════════

const MEDIA_LEARNING_TASKS = {
    visualPainting: 'painting',
    visualArchitecture: 'architecture',
    visualMaps: 'maps',
};

function isMediaLearningTask(task) {
    return Object.prototype.hasOwnProperty.call(MEDIA_LEARNING_TASKS, task || window.state.currentTask);
}

window.isMediaLearningTask = isMediaLearningTask;

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cultureLearningTab() {
    return 'base';
}

function cultureLearningTabsHtml() {
    return '';
}

window.selectCultureLearningTab = function(tab) {
    const taskByTab = { painting: 'visualPainting', architecture: 'visualArchitecture', maps: 'visualMaps' };
    if (!taskByTab[tab]) return;
    window.state.currentTask = taskByTab[tab];
    if ($('filter-task')) $('filter-task').value = taskByTab[tab];
    window.state.studyIndex = 0;
    window._cultureFlashcardCursor = {};
    haptic('light');
    if (window.state.currentMode === 'flashcards') window.nextFlashcard();
    else if (window.state.currentMode === 'study') window.renderStudyCard();
};

function cultureVisualPool(period, task) {
    const tab = MEDIA_LEARNING_TASKS[task || window.state.currentTask];
    if (!tab) return null;
    const base = (window.visualStudyData && window.visualStudyData[tab]) || [];
    if (period === 'all') return [...base];
    if (period === 'custom') {
        const startY = parseInt($('custom-year-start').value) || 0;
        const endY = parseInt($('custom-year-end').value) || 3000;
        return base.filter(item => {
            const y = getYearFromFact(item);
            return y >= startY && y <= endY;
        });
    }
    return base.filter(item => item.c === period);
}

function flashcardPoolForCurrentTask() {
    const period = $('filter-period').value || 'all';
    if (!isMediaLearningTask(window.state.currentTask)) {
        return getFilteredPool(period);
    }

    let pool = cultureVisualPool(period) || [];
    const now = Date.now();
    const filtered = pool.filter(f => {
        const d = window.state.stats.factStreaks[factKey(f)];
        return !(d && d.level > 0 && d.nextReview > now);
    });
    return filtered.length ? filtered : pool;
}

function studyPoolForCurrentTask() {
    const period = $('filter-period').value || 'all';
    if (isMediaLearningTask(window.state.currentTask)) {
        return cultureVisualPool(period) || [];
    }
    return getBasePool(period);
}

function pickFlashcardFact(allowed) {
    const sortByYear = $('filter-sort-year') && $('filter-sort-year').checked;
    if ((window.state.currentTask === 'task1' || window.state.currentTask === 'task7' || isMediaLearningTask(window.state.currentTask)) && sortByYear) {
        const sorted = [...allowed].sort((a, b) => getYearFromFact(a) - getYearFromFact(b));
        const key = `${window.state.currentTask}|${$('filter-period').value || 'all'}`;
        if (!window._cultureFlashcardCursor) window._cultureFlashcardCursor = {};
        const idx = window._cultureFlashcardCursor[key] || 0;
        window._cultureFlashcardCursor[key] = idx + 1;
        return sorted[idx % sorted.length];
    }
    return allowed[Math.floor(Math.random() * allowed.length)];
}

function mediaKindLabel(fact) {
    if (fact.mediaKind === 'painting') return 'Живопись';
    if (fact.mediaKind === 'architecture') return 'Архитектура';
    if (fact.mediaKind === 'maps') return 'Карта';
    return 'Памятник культуры';
}

function normalizeDetailLabel(label) {
    return String(label || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function detailValue(fact, labels) {
    const wanted = labels.map(normalizeDetailLabel);
    const row = (fact.details || []).find(item => wanted.includes(normalizeDetailLabel(item.label)));
    return row ? String(row.value || '').trim() : '';
}

function compactText(text, maxLen) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || value.length <= maxLen) return value;
    return value.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

function mediaMetaPieces(fact) {
    const years = fact.years || detailValue(fact, ['Годы', 'Дата']) || (fact.year ? `${fact.year} г.` : '');
    if (fact.mediaKind === 'maps') {
        return [
            years,
            fact.ruler || detailValue(fact, ['Правитель/руководитель', 'Правитель'])
        ].filter(Boolean).map(item => compactText(item, 72));
    }
    if (fact.mediaKind === 'painting') {
        return [
            years,
            detailValue(fact, ['Автор']),
            detailValue(fact, ['Период'])
        ].filter(Boolean).map(item => compactText(item, 64));
    }
    if (fact.mediaKind === 'architecture') {
        return [
            years,
            detailValue(fact, ['Место', 'Город']),
            detailValue(fact, ['Правитель', 'Автор', 'Архитектор'])
        ].filter(Boolean).map(item => compactText(item, 64));
    }
    return [years].filter(Boolean);
}

function mediaSublineText(fact) {
    if (fact.mediaKind === 'maps') {
        return [detailValue(fact, ['Тип']), detailValue(fact, ['Раздел'])]
            .filter(Boolean)
            .map(item => compactText(item, 72))
            .join(' · ');
    }
    return compactText(detailValue(fact, ['Стиль']), 150);
}

function mediaDescriptionText(fact) {
    if (fact.mediaKind === 'maps') {
        const legend = mapLegendParts(fact);
        if (legend.items.length || legend.notes.length) return '';
        const fallback = String(fact.fullDescription || '')
            .replace(/;\s*период:\s*[^;]+/i, '')
            .replace(/;\s*раздел:\s*\d{1,2}\s*-\s*\d{1,2}\s*вв?\.?/i, '');
        return compactText(detailValue(fact, ['Ориентиры']) || fallback, 185);
    }
    const description = detailValue(fact, ['Описание']) || fact.fullDescription;
    if (fact.mediaKind === 'architecture' && isRedundantMediaDescription(fact, description)) return '';
    return compactText(description, 185);
}

function isRedundantMediaDescription(fact, description) {
    const text = String(description || '').toLowerCase().replace(/ё/g, 'е');
    if (!text) return false;
    const years = String(fact.years || detailValue(fact, ['Годы']) || '').toLowerCase().replace(/ё/g, 'е');
    if (years && text.includes(years)) return true;
    const century = years.match(/(\d+)\s*век/);
    return !!(century && text.match(new RegExp(`${century[1]}\\s*век`)));
}

function cleanMapLegendText(fact, text) {
    let value = String(text || '').replace(/\s+/g, ' ').trim();
    const title = String(fact.culture || '').trim();
    const shortTitle = title.split(':')[0].trim();
    [title, shortTitle].filter(Boolean).forEach(part => {
        const idx = value.indexOf(part);
        if (idx > 0) value = value.slice(0, idx).trim();
        else if (idx === 0) value = value.slice(part.length).trim();
    });
    value = value
        // Общая склейка слов: строчная буква (или закрывающая скобка), сразу за ней заглавная
        // кириллическая — почти всегда артефакт PDF-парсинга ("ЗолотаяОрда" → "Золотая Орда", ")На" → ") На").
        .replace(/([а-яё)])([А-Я])/g, '$1 $2')
        // Римские маркеры на латинице (I/V/X) тоже склеиваются: "ДунайI -" → "Дунай I -".
        .replace(/([а-яё)])([IVX]{1,3}\s*[-–—])/g, '$1 $2')
        // Точка/запятая без пробела перед заглавной: "рабство.Российское" → "рабство. Российское".
        .replace(/([а-яё])([.,])([А-Я])/g, '$1$2 $3')
        // Прилипшая открывающая скобка: "США(Портсмут)" → "США (Портсмут)", «Варяг»(Руднев) → «Варяг» (Руднев).
        .replace(/([а-яёА-Я»"])\(/g, '$1 (')
        // Частые склейки с предлогами (строчная+строчная — общим правилом не ловятся).
        .replace(/поитогам/gi, 'по итогам')
        .replace(/влетописях/gi, 'в летописях')
        .replace(/стороныкрасных/gi, 'стороны красных')
        .replace(/польскаявойна/gi, 'польская война')
        .replace(/Нагасакиподверглись/gi, 'Нагасаки подверглись')
        .replace(/ещесуществовало/gi, 'еще существовало')
        .replace(/правительствосохраняло/gi, 'правительство сохраняло')
        .replace(/другихземлепроходцев/gi, 'других землепроходцев')
        .replace(/неспрашивают/gi, 'не спрашивают')
        .replace(/\s+история$/i, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s;,.\-]+|[\s;,.\-]+$/g, '');
    return value;
}

function normalizeMapLegendPayload(fact) {
    const payload = (window.mapLegendData && window.mapLegendData[fact.id]) || null;
    if (!payload) return { items: [], notes: [] };
    if (Array.isArray(payload)) return { items: payload, notes: [] };
    return {
        items: Array.isArray(payload.items) ? payload.items : [],
        notes: Array.isArray(payload.notes) ? payload.notes : []
    };
}

function splitMapLegendText(fact, text) {
    let value = cleanMapLegendText(fact, text);
    const notes = [];
    value = value.replace(/([а-яё)])(?=(Заштрихованные|Подсказки:|Фронты и командующие|Как поменялись|На схеме есть|Кучум\s*[-–—]|Кашлык\s*[-–—]|Ясак\s*[-–—]|Дальше цифры|Важные сражения:|Орел и Белгород|Больше 3 городов|Линии фронта|Варшава\s*[-–—]|Параллельно проходила|Прага была|Хиросима|Темные страны|Северо-Кавказский|Отступать))/gi, '$1 ');
    const notePatterns = [
        /(\s|^)(Заштрихованные.+)$/i,
        /(\s|^)(Подсказки:.*)$/i,
        /(\s|^)(Фронты и командующие.*)$/i,
        /(\s|^)(Как поменялись.+)$/i,
        /(\s|^)(На схеме есть.+)$/i,
        /(\s|^)(Кучум\s*[-–—].+)$/i,
        /(\s|^)(Кашлык\s*[-–—].+)$/i,
        /(\s|^)(Ясак\s*[-–—].+)$/i,
        /(\s|^)(Дальше цифры.+)$/i,
        /(\s|^)(Важные сражения:.+)$/i,
        /(\s|^)(Орел и Белгород.+)$/i,
        /(\s|^)(Больше 3 городов.+)$/i,
        /(\s|^)(Линии фронта.+)$/i,
        /(\s|^)(Варшава\s*[-–—].+)$/i,
        /(\s|^)(Параллельно проходила.+)$/i,
        /(\s|^)(Прага была.+)$/i,
        /(\s|^)(Хиросима.+)$/i,
        /(\s|^)(Темные страны.+)$/i,
        /(\s|^)(Северо-Кавказский.+)$/i,
        /(\s|^)(Отступать.+)$/i
    ];

    notePatterns.forEach(pattern => {
        const match = value.match(pattern);
        if (!match) return;
        const note = match[2].replace(/^[\s;,.\-]+|[\s;,.\-]+$/g, '').trim();
        if (note) notes.push(note);
        value = value.slice(0, match.index).replace(/^[\s;,.\-]+|[\s;,.\-]+$/g, '').trim();
    });

    return { text: value, notes };
}

function cleanMapLegendNote(fact, text) {
    const note = cleanMapLegendText(fact, text)
        .replace(/^[\s;,.\-]+|[\s;,.\-]+$/g, '')
        .trim();
    if (/^Фронты и командующие в$/i.test(note)) return '';
    return note;
}

function isFalseMapLegendItem(item) {
    const value = String(item.t || '').trim();
    if (!value) return true;
    if (/^(?:й|го|ый|ая|ой|ого|ий)\b/i.test(value)) return true;
    if (/^(?:й|го|ый|ая|ой|ого|ий)\s+/i.test(value)) return true;
    if (/^(?:Белорусский|Украинский|Прибалтийский)\s+фронт/i.test(value)) return true;
    if (/^(?:командующие|Параллельно проходила|армии СССР|армии США)\b/i.test(value)) return true;
    return false;
}

function normalizeEmbeddedMapMarkers(text) {
    return String(text || '')
        .replace(/([а-яё)])(?=([А-Я])\s*[-–—])/g, '$1 ')
        .replace(/([а-яё)])(?=(\d{1,2})\s*[-.)]\s+)/g, '$1 ');
}

function expandMapLegendEntries(raw) {
    const n = String(raw.n || raw.mark || '').trim();
    const source = normalizeEmbeddedMapMarkers(raw.t || raw.text || '');
    const markerRegex = /(?:^|\s)(\d{1,2})\s*[-.)]\s+|(?:^|\s)([А-Я])\s*[-–—]\s*/g;
    const matches = Array.from(source.matchAll(markerRegex)).filter(match => match.index > 0);
    if (!matches.length) return [{ n, t: source }];

    const entries = [{ n, t: source.slice(0, matches[0].index).trim() }];
    matches.forEach((match, index) => {
        const mark = match[1] || match[2] || '';
        const start = match.index + match[0].length;
        const end = matches[index + 1] ? matches[index + 1].index : source.length;
        entries.push({ n: mark, t: source.slice(start, end).trim() });
    });
    return entries;
}

function falseMapLegendNote(item) {
    const mark = String(item.n || '').trim();
    const value = String(item.t || '').trim();
    if (!mark || !value) return '';
    return `${mark}-${value}`.replace(/^(\d+)-\s+(й|го|ый|ая|ой|ого|ий)\b/i, '$1-$2');
}

function mapLegendParts(fact) {
    if (fact.mediaKind !== 'maps') return { items: [], notes: [] };
    const payload = normalizeMapLegendPayload(fact);
    const notes = [];
    const seenItems = new Set();
    const seenNotes = new Set();
    const pushNote = (noteText) => {
        const note = cleanMapLegendNote(fact, noteText);
        const key = note.toLowerCase();
        if (note && !seenNotes.has(key)) {
            seenNotes.add(key);
            notes.push(note);
        }
    };

    const items = payload.items.flatMap(expandMapLegendEntries).map(raw => {
        const split = splitMapLegendText(fact, raw.t || raw.text || '');
        split.notes.forEach(pushNote);
        return {
            n: String(raw.n || raw.mark || '').trim(),
            t: split.text
        };
    }).filter(item => {
        if (!item.n) return false;
        if (isFalseMapLegendItem(item)) {
            pushNote(falseMapLegendNote(item));
            return false;
        }
        const key = `${item.n}::${item.t.toLowerCase()}`;
        if (seenItems.has(key)) return false;
        seenItems.add(key);
        return true;
    });

    payload.notes.forEach(pushNote);

    return { items, notes };
}

function mapLegendItems(fact) {
    return mapLegendParts(fact).items;
}

function mediaLegendHtml(fact) {
    const legend = mapLegendParts(fact);
    if (!legend.items.length && !legend.notes.length) return '';
    const itemsHtml = legend.items.length ? `<div class="media-map-legend" aria-label="Подписи к номерам на карте">
        ${legend.items.map(item => `<div><b>${escapeHtml(item.n)}</b><span>${escapeHtml(item.t)}</span></div>`).join('')}
    </div>` : '';
    const notesHtml = legend.notes.length ? `<div class="media-map-notes" aria-label="Пояснения к карте">
        ${legend.notes.map(note => `<p>${escapeHtml(note)}</p>`).join('')}
    </div>` : '';
    return `${itemsHtml}${notesHtml}`;
}

function mediaInfoHtml(fact, tailHtml) {
    const meta = mediaMetaPieces(fact);
    const subline = mediaSublineText(fact);
    const description = mediaDescriptionText(fact);
    return `<div class="media-fact-info">
        <span class="media-fact-label">${escapeHtml(mediaKindLabel(fact))}</span>
        <h2>${escapeHtml(fact.culture)}</h2>
        ${meta.length ? `<div class="media-meta-line">${meta.map(escapeHtml).join('<span>·</span>')}</div>` : ''}
        ${subline ? `<p class="media-subline">${escapeHtml(subline)}</p>` : ''}
        ${mediaLegendHtml(fact)}
        ${description ? `<p class="media-description">${escapeHtml(description)}</p>` : ''}
        ${tailHtml || ''}
    </div>`;
}

function mediaImageHtml(fact) {
    const imgSrc = escapeHtml(fact.image);
    const imgAlt = escapeHtml(fact.culture);
    const img = `<img src="${imgSrc}" alt="${imgAlt}">`;
    if (fact.mediaKind === 'maps') {
        return `<div class="media-fact-image media-map-zoomable">
            ${img}
        </div>`;
    }
    return `<div class="media-fact-image">${img}</div>`;
}

function renderMediaFlashcardFront(fact, d) {
    const actions = `<div class="media-answer-buttons">
        <button type="button" onclick="window.answerFlashcard(false, false, event)" class="forgot">Забыл</button>
        <button type="button" onclick="window.answerFlashcard(true, false, event)" class="doubt">Сомневаюсь</button>
        <button type="button" onclick="window.answerFlashcard(true, true, event)" class="remember">Помню</button>
    </div>`;
    // ЛИЦЕВАЯ сторона — только изображение + уровень + подсказка «нажми»
    return `<div class="culture-media-flashcard media-kind-${escapeHtml(fact.mediaKind || 'culture')} media-fc-front" onclick="window.flipMediaFlashcard(this)" style="cursor:pointer;" data-fact-key="${escapeHtml(factKey(fact))}">
        <div class="fc-level-badge media-level">Ур: ${d ? d.level || 0 : 0} | Балл: ${d ? (d.points || 0).toFixed(1) : 0}/3</div>
        ${mediaImageHtml(fact)}
        <div class="media-fact-info" style="justify-content:center;align-items:center;text-align:center;">
            <span class="media-fact-label">${escapeHtml(mediaKindLabel(fact))}</span>
            <p style="font-size:12px;font-weight:900;color:#60a5fa;text-transform:uppercase;letter-spacing:0.08em;margin-top:8px;animation:pulse 2s infinite;">👆 Нажми, чтобы перевернуть</p>
        </div>
    </div>`;
}

// Переворот медиа-карточки (архитектура, живопись, карты)
window.flipMediaFlashcard = function(card) {
    if (card.classList.contains('media-fc-flipped')) return;
    card.classList.add('media-fc-flipped');
    card.onclick = null;
    card.style.cursor = 'default';
    haptic('medium');

    const fact = window.state.currentFlashcardFact;
    if (!fact) return;

    const d = window.state.stats.factStreaks[factKey(fact)];
    const actions = `<div class="media-answer-buttons">
        <button type="button" onclick="window.answerFlashcard(false, false, event)" class="forgot">Забыл</button>
        <button type="button" onclick="window.answerFlashcard(true, false, event)" class="doubt">Сомневаюсь</button>
        <button type="button" onclick="window.answerFlashcard(true, true, event)" class="remember">Помню</button>
    </div>`;

    // Перестраиваем карточку в открытое состояние
    card.className = `culture-media-flashcard media-open-card media-kind-${escapeHtml(fact.mediaKind || 'culture')}`;
    card.innerHTML = `
        <div class="fc-level-badge media-level">Ур: ${d ? d.level || 0 : 0} | Балл: ${d ? (d.points || 0).toFixed(1) : 0}/3</div>
        ${mediaImageHtml(fact)}
        ${mediaInfoHtml(fact, actions)}
    `;
    setTimeout(() => window.updateZenButton(), 50);
};

function renderMediaFactBack(fact) {
    return `<div class="media-fact-back">
        ${mediaImageHtml(fact)}
        ${mediaInfoHtml(fact, '')}
    </div>`;
}

function renderMediaStudyCard(fact, progressText) {
    const nextButton = '<button data-action="nextStudyCard" class="culture-study-next">Понятно, дальше</button>';
    return `<div class="culture-study-wrap media-kind-${escapeHtml(fact.mediaKind || 'culture')}-wrap">
        <article class="culture-study-card media-kind-${escapeHtml(fact.mediaKind || 'culture')}">
            ${mediaImageHtml(fact)}
            ${mediaInfoHtml(fact, nextButton)}
        </article>
        <div class="st-progress media-progress">${escapeHtml(progressText)}</div>
    </div>`;
}

// Лицевая сторона (обычный режим) — «название».
const FC_LABEL = { task1: 'Событие', task3: 'Процесс', task4: 'Событие', task5: 'Участник', task7: 'Памятник культуры' };
const FC_TITLE = { task1: f => f.event, task3: f => f.process, task4: f => f.event, task5: f => f.person, task7: f => f.culture };
// Лицевая сторона в перевёрнутом режиме — спрашиваем название по факту.
const FC_REVERSE_LABEL = { task1: 'Назови событие', task3: 'Назови процесс', task4: 'Назови событие', task5: 'Назови личность', task7: 'Назови памятник' };

// HTML «детали» (оборот в обычном режиме / лицо в перевёрнутом): год, место, событие, характеристика.
function _fcDetailContent(fact, task) {
    const contentMap = {
        task1: () => `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-cyan-100 dark:border-[#2c2c2c] w-full text-center"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Дата</span><span class="text-2xl font-black text-cyan-700 dark:text-cyan-300">${fact.year}</span></div>`,
        task3: () => `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-emerald-100 dark:border-[#2c2c2c] w-full text-center mb-3"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Факт</span><span class="text-[14px] font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed">${fact.fact}</span></div><div class="bg-white dark:bg-[#181818]/50 p-4 rounded-2xl shadow-sm border border-blue-100 dark:border-[#2c2c2c] w-full text-center"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Год</span><span class="text-2xl font-black text-examBlue dark:text-blue-300">${fact.year}</span></div>`,
        task4: () => {
            let mapLink = '';
            if (fact.geo && typeof geoDict !== 'undefined' && geoDict[fact.geo]) mapLink = `<span onclick="event.stopPropagation();window.openMapModal('${fact.geo}')" class="mt-2 text-[12px] font-bold text-blue-600 underline decoration-dashed cursor-pointer">Показать на карте</span>`;
            return `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-blue-100 dark:border-[#2c2c2c] w-full mb-3"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Год</span><span class="text-3xl font-black text-examBlue dark:text-blue-300">${fact.year}</span></div><div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-green-100 dark:border-[#2c2c2c] flex flex-col items-center w-full"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Место</span><span class="text-xl font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed">${fact.geo}</span>${mapLink}</div>`;
        },
        task5: () => `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-purple-100 dark:border-[#2c2c2c] w-full text-center"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Событие</span><span class="text-lg sm:text-xl font-bold text-purple-700 dark:text-purple-400 leading-relaxed">${fact.event}</span></div>`,
        task7: () => fact.image ? renderMediaFactBack(fact) : `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-amber-100 dark:border-[#2c2c2c] w-full text-center mb-3"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Характеристика</span><span class="text-[14px] font-bold text-amber-700 dark:text-amber-400 leading-relaxed">${fact.trait}</span></div><div class="bg-white dark:bg-[#181818]/50 p-4 rounded-2xl shadow-sm border border-blue-100 dark:border-[#2c2c2c] w-full text-center"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">Создание</span><span class="text-2xl font-black text-examBlue dark:text-blue-300">${fact.year}</span></div>`,
    };
    return (contentMap[task] || contentMap.task4)();
}

// HTML «название» как ответ (оборот в перевёрнутом режиме). Цвета — инлайном, чтобы не зависеть от purge Tailwind.
function _fcTitleAnswerHtml(fact, task) {
    const palette = { task1: '#0891b2', task3: '#059669', task4: '#2563eb', task5: '#9333ea', task7: '#d97706' };
    const col = palette[task] || '#2563eb';
    const title = (FC_TITLE[task] || FC_TITLE.task4)(fact);
    return `<div class="bg-white dark:bg-[#181818]/50 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-[#2c2c2c] w-full text-center"><span class="text-[10px] text-gray-400 uppercase font-black block mb-1 tracking-widest">${FC_LABEL[task] || 'Ответ'}</span><span class="text-xl sm:text-2xl font-bold leading-relaxed" style="color:${col}">${title}</span></div>`;
}

// Переключатель направления карточек (доступен только для текстовых заданий).
function _fcReverseToggleHtml() {
    const on = !!window.state.flashcardReverse;
    const cls = on
        ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40'
        : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-[#2c2c2c] dark:text-gray-400 dark:border-[#3f3f46]';
    return `<div class="w-full max-w-md flex justify-center mb-3"><button onclick="window.toggleFlashcardReverse()" class="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full border transition-colors active:scale-95 ${cls}">🔄 ${on ? 'Факт → название' : 'Название → факт'}</button></div>`;
}

window.toggleFlashcardReverse = function() {
    window.state.flashcardReverse = !window.state.flashcardReverse;
    haptic('light');
    window.nextFlashcard();
};

window.nextFlashcard = function() {
    const area = $('flashcard-area');
    const tabs = cultureLearningTabsHtml();
    const allowed = flashcardPoolForCurrentTask();
    if (!allowed || allowed.length === 0) {
        area.innerHTML = tabs + '<div class="text-center p-10 w-full"><h2 class="text-xl font-bold text-rose-500 bg-white dark:bg-[#1e1e1e] rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-[#2c2c2c]">⚠️ В этом периоде нет событий!</h2></div>';
        return;
    }
    const fact = pickFlashcardFact(allowed);
    const d = window.state.stats.factStreaks[factKey(fact)];
    const task = window.state.currentTask;
    const cfg = TASK_CONFIG[task];

    // Перевёрнутый режим только для текстовых заданий (медиа-карточки с картинками — нет).
    const reverse = !!window.state.flashcardReverse && !fact.image && !isMediaLearningTask(task);
    const showToggle = !fact.image && !isMediaLearningTask(task);

    area.innerHTML = tabs + (showToggle ? _fcReverseToggleHtml() : '');
    if (fact.image) {
        area.insertAdjacentHTML('beforeend', renderMediaFlashcardFront(fact, d));
    } else if (reverse) {
        const badge = `Ур: ${d ? d.level || 0 : 0} | Балл: ${d ? (d.points || 0).toFixed(1) : 0}/3`;
        area.insertAdjacentHTML('beforeend', `<div class="w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] p-6 min-h-[300px] flex flex-col items-center justify-center text-center cursor-pointer border-2 border-dashed border-amber-300 dark:border-amber-500/40 hover:border-amber-400 transition-all duration-300 relative group" onclick="window.flipFlashcard(this)" data-reverse="1"><div class="absolute top-4 left-4 bg-gray-100 dark:bg-[#2c2c2c] px-2 py-1 rounded text-[12px] font-bold text-gray-500 shadow-sm border border-gray-200 dark:border-[#3f3f46]">${badge}</div><span class="text-[12px] font-black text-amber-500 uppercase tracking-[0.2em] mb-4">${FC_REVERSE_LABEL[task] || 'Назови ответ'}</span><div class="w-full">${_fcDetailContent(fact, task)}</div><p class="text-[12px] font-bold text-amber-500 mt-6 opacity-70 animate-pulse uppercase tracking-wider">Коснись, чтобы перевернуть</p></div>`);
    } else {
        const tpl = $('flashcard-template-front').content.cloneNode(true);
        tpl.querySelector('.fc-level-badge').innerText = `Ур: ${d ? d.level || 0 : 0} | Балл: ${d ? (d.points || 0).toFixed(1) : 0}/3`;
        tpl.querySelector('.fc-label').innerText = FC_LABEL[task] || 'Событие';
        tpl.querySelector('.fc-title').innerText = (FC_TITLE[task] || FC_TITLE.task4)(fact);
        area.appendChild(tpl);
    }
    window.state.currentFlashcardFact = fact;
};

window.flipFlashcard = function(card) {
    if (card.classList.contains('flipped')) return;
    card.classList.add('flipped');
    haptic('medium');
    const fact = window.state.currentFlashcardFact;
    const task = window.state.currentTask;
    const reverse = card.dataset.reverse === '1';
    card.className = fact.image
        ? "culture-media-flashcard media-back-card flipped"
        : "w-full max-w-md bg-blue-50 dark:bg-[#1e1e1e] rounded-3xl shadow-[0_8px_30px_rgba(59,130,246,0.15)] p-6 min-h-[300px] flex flex-col items-center justify-center text-center border-2 border-blue-200 dark:border-[#2c2c2c] transition-all duration-300 relative flipped";
    card.onclick = null;

    if (fact.image) {
        card.innerHTML = `${renderMediaFactBack(fact)}
            <div class="media-answer-buttons">
                <button onclick="window.answerFlashcard(false, false, event)" class="forgot">Забыл</button>
                <button onclick="window.answerFlashcard(true, false, event)" class="doubt">Сомневаюсь</button>
                <button onclick="window.answerFlashcard(true, true, event)" class="remember">Помню</button>
            </div>`;
        setTimeout(() => window.updateZenButton(), 50);
        return;
    }

    const tpl = $('flashcard-template-back').content.cloneNode(true);
    tpl.querySelector('.fc-content').innerHTML = reverse ? _fcTitleAnswerHtml(fact, task) : _fcDetailContent(fact, task);
    card.innerHTML = '';
    card.appendChild(tpl);
    setTimeout(() => window.updateZenButton(), 50);
};

window.answerFlashcard = function(isCorrect, isSure, e) {
    e.stopPropagation();
    const fact = window.state.currentFlashcardFact;
    const fKey = factKey(fact);
    const task = window.state.currentTask;
    const mIdx = window.state.mistakesPool.findIndex(m => mistakeMatchesFact(m, fact));

    // FIX #3: трекаем eraStats для флеш-карточек
    const eraKey = getEraFromFact(fact, task);
    if (eraKey) {
        if (!window.state.stats.eraStats[task]) window.state.stats.eraStats[task] = {};
        if (!window.state.stats.eraStats[task][eraKey]) window.state.stats.eraStats[task][eraKey] = { correct: 0, total: 0 };
        window.state.stats.eraStats[task][eraKey].total++;
        if (isCorrect) window.state.stats.eraStats[task][eraKey].correct++;
    }

    if (isCorrect) {
        haptic('success');
        const d = updateFactSRS(fKey, true, isSure);
        if (mIdx !== -1) window.state.mistakesPool.splice(mIdx, 1);
        window.state.stats.streak++;
        if (d.level > 0) showToast('🧠', isSure ? 'Отлично! Уровень повышен' : 'Повторим завтра', 'bg-emerald-500', 'border-emerald-700');
        else showToast(isSure ? '✅' : '🤔', window.getJokePhrase(true), isSure ? 'bg-emerald-500' : 'bg-indigo-500', isSure ? 'border-emerald-700' : 'border-indigo-700');
    } else {
        haptic('error');
        updateFactSRS(fKey, false, false);
        if (mIdx === -1) window.state.mistakesPool.push({ fact, task: window.state.currentTask });
        window.state.stats.streak = 0;
        showToast('🔄', window.getJokePhrase(false), 'bg-rose-500', 'border-rose-700');
    }
    window.state.stats.flashcardsSolved = (window.state.stats.flashcardsSolved || 0) + 1;
    saveProgress();
    updateGlobalUI();
    checkAchievements();
    // Поток ДЗ (learned-этапы): если цель по выученным фактам достигнута — автопереход/завершение
    if (window.state.activeHw && window.maybeAdvanceHw && window.maybeAdvanceHw()) return;
    window.nextFlashcard();
};

// ═══════════════════════════════════════════════════════════
//  ДЕТЕКТИВ
// ═══════════════════════════════════════════════════════════

function generateDetectiveTable() {
    window.state.tableHasMistake = false;
    window.state.answersRevealed = false;

    $('pool-title').innerHTML = '<span>🔎</span> УЛИКИ';
    $('check-buttons').classList.remove('hidden');
    $('check-buttons').classList.add('flex');
    $('check-btn-sure').innerHTML = '✅ Вынести вердикт';
    $('check-btn-doubt').innerHTML = '🤔 Нужна экспертиза';
    $('reveal-btn').className = "hidden text-orange-500 font-bold py-2 px-6 active:scale-95 text-[11px] sm:text-xs w-full transition-colors underline uppercase tracking-wider mt-2";
    $('reveal-btn').innerHTML = '👀 Запросить подсказку штаба';
    $('next-btn').classList.add('hidden');
    if ($('detective-stamp')) $('detective-stamp').classList.remove('hidden');
    $('task-table-body').innerHTML = '';
    $('pool-container').innerHTML = '';

    if (typeof detectiveCases === 'undefined') {
        $('table-head').innerHTML = '';
        $('task-table-body').innerHTML = '<tr><td class="text-center p-10 font-bold text-gray-500">Материалы дела недоступны...</td></tr>';
        return;
    }
    const cases = detectiveCases[$('filter-case').value];
    if (!cases || cases.length === 0) {
        $('table-head').innerHTML = '';
        $('task-table-body').innerHTML = '<tr><td class="text-center p-10 font-bold text-gray-500">Дела в разработке...</td></tr>';
        return;
    }

    // ── Умный выбор кейса: цикл без повторов ──
    const caseKey = $('filter-case').value;
    if (!window._detectiveSeenCases) window._detectiveSeenCases = {};
    if (!window._detectiveSeenCases[caseKey]) window._detectiveSeenCases[caseKey] = [];
    let seen = window._detectiveSeenCases[caseKey];
    // Если все кейсы показаны — сбросить
    if (seen.length >= cases.length) seen.length = 0;
    // Выбрать из непоказанных
    const unseen = cases.map((c, i) => i).filter(i => !seen.includes(i));
    const pickIdx = unseen[Math.floor(Math.random() * unseen.length)];
    seen.push(pickIdx);
    const caseData = cases[pickIdx];
    window.state.currentTargetData = caseData.items;
    $('table-head').innerHTML = `<tr><th class="p-2 sm:p-4 text-left relative bg-[#f3efe6] dark:bg-[#c7c1b3] rounded-t-lg"><div class="text-[10px] text-gray-500 font-bold tracking-widest uppercase mb-1">Архив Главного Управления</div><div class="text-2xl sm:text-3xl font-serif font-black text-[#3e352d] uppercase border-b-2 border-[#d1c1a5] pb-2">ДОСЬЕ №${Math.floor(Math.random() * 900 + 100)}-${['К','А','М','С','Ж'][Math.floor(Math.random() * 5)]}</div><div class="text-sm font-bold text-[#3e352d] mt-3 flex items-center gap-2"><span class="text-xl">📁</span> ${caseData.title}</div></th></tr>`;

    const missing = [];
    const trFrag = document.createDocumentFragment();
    caseData.items.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.index = idx;
        const td = document.createElement('td');
        td.className = "p-2 sm:p-4 align-middle text-left leading-relaxed text-[13px] sm:text-base";
        missing.push(item.answer);
        td.innerHTML = `<span class="font-bold mr-2 text-gray-500">${idx + 1}.</span> ${item.text.replace('###', `<div class="dnd-slot detective-slot" data-expected="${String(item.answer).replace(/"/g, '&quot;')}" data-letter=""></div>`)}`;
        tr.appendChild(td);
        trFrag.appendChild(tr);
    });
    $('task-table-body').appendChild(trFrag);

    const poolItems = [...missing, ...(caseData.fakes || [])];
    const poolFrag = document.createDocumentFragment();
    shuffleArray(poolItems).forEach(txt => {
        const chip = document.createElement('div');
        chip.className = "dnd-chip";
        chip.innerText = txt;
        chip.dataset.pureText = txt;
        poolFrag.appendChild(chip);
    });
    $('pool-container').appendChild(poolFrag);
}

// ═══════════════════════════════════════════════════════════
//  УЧЁБА (Study)
// ═══════════════════════════════════════════════════════════

window.renderStudyCard = function() {
    const pool = studyPoolForCurrentTask();
    const tabs = cultureLearningTabsHtml();
    if (pool.length === 0) {
        $('study-area').innerHTML = tabs + '<div class="text-center p-10 bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm"><h2 class="text-xl font-bold text-rose-500">⚠️ В этом периоде нет событий!</h2></div>';
        return;
    }
    const sorted = [...pool].sort((a, b) => getYearFromFact(a) - getYearFromFact(b));
    if (window.state.studyIndex >= sorted.length) {
        window.state.studyIndex = 0;
        showToast('🎉', 'Эпоха пройдена!', 'bg-emerald-500', 'border-emerald-700');
    }

    const it = sorted[window.state.studyIndex];
    const task = window.state.currentTask;
    const progressText = `Карточка ${window.state.studyIndex + 1} из ${sorted.length}`;
    if (it.image) {
        $('study-area').innerHTML = tabs + renderMediaStudyCard(it, progressText);
        return;
    }
    const labelMap = { task1: 'Хронология', task3: 'Процесс → Факт', task4: 'География', task5: 'Личность', task7: 'Культура' };
    const titleMap = {
        task1: it => it.event,
        task3: it => `${it.year} г. • ${it.process}`,
        task4: it => `${it.year} г. • ${it.geo}`,
        task5: it => `${it.year} • ${it.person}`,
        task7: it => `${it.culture}`,
    };
    const descMap = { task1: it => it.year, task3: it => it.fact, task4: it => it.event, task5: it => it.event, task7: it => it.trait };

    const e = ['📜','⚔️','🛡️','👑','🚂','🚀','🏛️','🗺️','💡','🎨','⚓'];
    const b = ['from-blue-500 to-purple-600','from-emerald-400 to-teal-600','from-orange-400 to-rose-500','from-indigo-500 to-blue-600'];
    const tpl = $('study-card-template').content.cloneNode(true);

    tpl.querySelector('.st-bg').className = `h-32 sm:h-40 flex items-center justify-center text-7xl shadow-inner transition-colors bg-gradient-to-br ${b[Math.floor(Math.random() * b.length)]}`;
    tpl.querySelector('.st-emoji').innerText = task === 'task1' ? '⏳' : (task === 'task7' ? '🎨' : (task === 'task3' ? '🔗' : e[Math.floor(Math.random() * e.length)]));
    tpl.querySelector('.st-label').innerText = labelMap[task] || 'Событие';
    tpl.querySelector('.st-title').innerText = titleMap[task](it);
    tpl.querySelector('.st-desc').innerText = descMap[task](it);
    tpl.querySelector('.st-progress').innerText = progressText;
    $('study-area').innerHTML = tabs;
    $('study-area').appendChild(tpl);
};

window.nextStudyCard = function() { haptic('light'); window.state.studyIndex++; window.renderStudyCard(); };

// ═══════════════════════════════════════════════════════════
//  ВИЗУАЛЬНАЯ АРХИТЕКТУРА — вынесена в visual-trainer.js
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  КРАСНЫЙ КАРАНДАШ (Red Pencil)
// ═══════════════════════════════════════════════════════════

let currentRPCaseIndex = 0, rpFakesTotal = 0, rpFakesFound = 0, rpCasesShuffled = [];

window.updateRPCounter = function() { if ($('rp-counter')) $('rp-counter').innerText = `${rpFakesFound} / ${rpFakesTotal}`; };

window.startRedPencilMode = function() {
    if (typeof redPencilCases === 'undefined') {
        $('rp-content').innerHTML = '<div class="text-center text-red-500 font-bold py-10 bg-white">База данных не найдена.</div>';
        return;
    }
    const p = $('filter-period').value || 'all';
    let fC = [];
    if (p === 'all') fC = [...redPencilCases];
    else if (p === 'custom') {
        const sy = parseInt($('custom-year-start').value) || 0, ey = parseInt($('custom-year-end').value) || 3000;
        fC = redPencilCases.filter(c => c.year >= sy && c.year <= ey);
    } else {
        fC = redPencilCases.filter(c => {
            const y = c.year;
            if (p === 'early' && y <= 1700) return true;
            if (p === '18th' && y > 1700 && y <= 1800) return true;
            if (p === '19th' && y > 1800 && y <= 1900) return true;
            if (p === '20th' && y > 1900) return true;
            return false;
        });
    }
    if (fC.length === 0) {
        $('rp-content').innerHTML = '<div class="text-center text-rose-500 font-bold py-10 bg-white">⚠️ В периоде нет документов!</div>';
        $('rp-giveup-btn').classList.add('hidden');
        return;
    }
    rpCasesShuffled = shuffleArray([...fC]);
    currentRPCaseIndex = 0;
    window.loadRPCase(0);
};

window.loadRPCase = function(idx) {
    if (window.state) window.state.rpHasMistake = false;
    if (idx >= rpCasesShuffled.length) { idx = 0; currentRPCaseIndex = 0; rpCasesShuffled = shuffleArray([...rpCasesShuffled]); }
    const cD = rpCasesShuffled[idx];
    $('rp-title').innerText = cD.title + ' • ' + cD.year + ' г.';

    const pF = cD.slots.filter(s => s.current !== s.correct);
    const fT = cD.slots.filter(s => s.current === s.correct);
    const tFC = Math.max(1, Math.min(Math.floor(Math.random() * 5) + 2, pF.length));
    const sF = shuffleArray([...pF]);
    const aF = sF.slice(0, tFC), cT = sF.slice(tFC);
    const fS = {};
    aF.forEach(s => fS[s.id] = { ...s, isFake: true });
    cT.forEach(s => fS[s.id] = { ...s, isFake: false, current: s.correct });
    fT.forEach(s => fS[s.id] = { ...s, isFake: false, current: s.correct });
    rpFakesTotal = aF.length;
    rpFakesFound = 0;
    window.updateRPCounter();

    let hC = cD.text;
    cD.slots.forEach(s => {
        const f = fS[s.id];
        hC = hC.replace(`{${f.id}}`, `<span class="word-node target-node" data-id="${f.id}" data-type="${f.isFake ? 'fake' : 'truth'}" data-correct="${f.correct}">${f.current}</span>`);
    });

    const tD = document.createElement('div');
    tD.innerHTML = hC;
    function wrapTN(node) {
        if (node.nodeType === 3) {
            const txt = node.nodeValue;
            if (!txt.trim()) return;
            const wS = txt.split(/([\s.,!?;:«»"—]+)/);
            const fr = document.createDocumentFragment();
            wS.forEach(str => {
                if (str.trim().length > 0 && !/^[\s.,!?;:«»"—]+$/.test(str)) {
                    const s = document.createElement('span');
                    s.className = 'plain-word';
                    s.textContent = str;
                    fr.appendChild(s);
                } else fr.appendChild(document.createTextNode(str));
            });
            node.parentNode.replaceChild(fr, node);
        } else if (node.nodeType === 1 && !node.classList.contains('word-node')) {
            Array.from(node.childNodes).forEach(wrapTN);
        }
    }
    Array.from(tD.childNodes).forEach(wrapTN);
    $('rp-content').innerHTML = tD.innerHTML;
    $('rp-next-btn').classList.add('hidden');
    $('rp-giveup-btn').classList.remove('hidden');
    $$('#rp-content .word-node').forEach(n => n.addEventListener('click', window.handleRPWordClick));
    $$('#rp-content .plain-word').forEach(n => n.addEventListener('click', window.handleRPPlainClick));
};

window.handleRPWordClick = function(e) {
    const n = e.currentTarget;
    if (!n || n.classList.contains('crossed')) return;
    if (n.dataset.type === 'fake') {
        n.classList.add('crossed', 'show-correction');
        n.innerHTML += `<span class="correction-badge">${n.dataset.correct}</span>`;
        rpFakesFound++;
        window.updateRPCounter();
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        if (rpFakesFound === rpFakesTotal) window.winRPCase();
    } else {
        window.handleRPPlainClick({ currentTarget: n });
    }
};

window.handleRPPlainClick = function(e) {
    const n = e.currentTarget;
    if (n.classList.contains('shaking') || n.classList.contains('crossed')) return;
    n.classList.add('animate-shake', 'text-rose-600', 'shaking');
    if (window.state) {
        window.state.stats.streak = 0;
        window.state.rpHasMistake = true;
        updateGlobalUI();
        saveLocal(); // FIX #9: только локально, не спамим облако
    }
    setTimeout(() => n.classList.remove('animate-shake', 'text-rose-600', 'shaking'), 500);
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    showToast('❌', window.getJokePhrase(false), 'bg-rose-500', 'border-rose-700');
};

window.winRPCase = function() {
    $('rp-next-btn').classList.remove('hidden');
    $('rp-giveup-btn').classList.add('hidden');
    if (window.state && !window.state.rpHasMistake) {
        updateScoreAndStats(1, true);
        window.state.stats.streak = (window.state.stats.streak || 0) + 1;
        updateGlobalUI();
        saveProgress();
        checkAchievements();
    }
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    showToast('🎉', window.state.rpHasMistake ? 'Все фальшивки найдены!' : window.getJokePhrase(true), 'bg-emerald-500', 'border-emerald-700');
};

window.giveUpRedPencil = function() {
    $$('#rp-content .target-node[data-type="fake"]').forEach(n => {
        if (!n.classList.contains('crossed')) {
            n.classList.add('crossed', 'show-correction');
            n.innerHTML += `<span class="correction-badge">${n.dataset.correct}</span>`;
        }
    });
    rpFakesFound = rpFakesTotal;
    window.updateRPCounter();
    if (window.state) { window.state.stats.streak = 0; updateGlobalUI(); saveProgress(); }
    $('rp-next-btn').classList.remove('hidden');
    $('rp-giveup-btn').classList.add('hidden');
};

window.nextRedPencilCase = function() {
    haptic('light');
    currentRPCaseIndex++;
    window.loadRPCase(currentRPCaseIndex);
};
