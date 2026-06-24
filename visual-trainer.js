// visual-trainer.js — Визуальный тренажёр: последовательные характеристики
'use strict';

// ═══════════════════════════════════════════════════════════
//  ВИЗУАЛЬНАЯ АРХИТЕКТУРА — МУЛЬТИ-ХАРАКТЕРИСТИКИ
//  Для каждого памятника спрашиваем 2-3 характеристики подряд
//  (автор, век, город и т.д.), каждая с 4 вариантами.
//  Только если ВСЕ правильно — засчитываем.
// ═══════════════════════════════════════════════════════════

// История показов для spacing (не показывать подряд)
if (!window._visualHistory) window._visualHistory = [];

function visualEscape(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function visualAnswerText(text) {
    const value = String(text ?? '').trim();
    if (value === 'Великий Новгород' || value === 'Великий Новгород, Новгород') return 'Новгород';
    return value.replace(/\bВеликий Новгород\b/g, 'Новгород').replace(/Новгород,\s*Новгород/g, 'Новгород');
}

function visualIsBlockedDistractor(item, fact, answer) {
    if (item?.id === 'hram-voskreseniya-hristova-na-krovi-spas-na-krovi' && fact?.type === 'ruler') {
        return visualAnswerText(answer) === 'Сталин';
    }
    return false;
}

let visualMistakeCardTimeout = null;
function showVisualMistakeCard(item, step) {
    const old = document.getElementById('visual-mistake-card');
    if (old) old.remove();
    if (visualMistakeCardTimeout) clearTimeout(visualMistakeCardTimeout);

    const card = document.createElement('div');
    card.id = 'visual-mistake-card';
    const facts = visualAnswerText(item.fullCharacteristic || (item.importantFacts || []).slice(0, 3).join(' '));
    card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:0.75rem;">
            <div style="width:2.25rem;height:2.25rem;border-radius:999px;background:rgba(239,68,68,0.12);display:flex;align-items:center;justify-content:center;flex:0 0 auto;font-size:1.15rem;">✕</div>
            <div style="min-width:0;flex:1;">
                <div style="font-size:0.68rem;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:var(--c-danger);margin-bottom:0.18rem;">Разбор ошибки</div>
                <div style="font-size:0.98rem;font-weight:900;color:#111827;line-height:1.15;margin-bottom:0.35rem;">${visualEscape(item.title)}</div>
                <div style="font-size:0.78rem;font-weight:700;color:#475569;line-height:1.35;">${visualEscape(facts)}</div>
                <div style="margin-top:0.35rem;font-size:0.78rem;font-weight:900;color:var(--c-brand-strong);">${visualEscape(visualFactLabel(step.factType))}: ${visualEscape(visualAnswerText(step.correctAnswer))}</div>
            </div>
        </div>`;
    card.style.cssText = [
        'position:fixed',
        'left:50%',
        'top:calc(env(safe-area-inset-top, 0px) + 0.75rem)',
        'transform:translate(-50%, -0.75rem)',
        'opacity:0',
        'z-index:10050',
        'width:min(92vw, 34rem)',
        'padding:0.9rem 1rem',
        'border-radius:1.1rem',
        'background:rgba(255,255,255,0.96)',
        'border:1px solid rgba(239,68,68,0.22)',
        'box-shadow:0 20px 50px rgba(15,23,42,0.22)',
        'backdrop-filter:blur(14px)',
        'transition:opacity 180ms ease, transform 180ms ease',
        'pointer-events:none'
    ].join(';');
    document.body.appendChild(card);
    requestAnimationFrame(() => {
        card.style.opacity = '1';
        card.style.transform = 'translate(-50%, 0)';
    });
    visualMistakeCardTimeout = setTimeout(() => {
        card.style.opacity = '0';
        card.style.transform = 'translate(-50%, -0.75rem)';
        setTimeout(() => card.remove(), 220);
    }, 2500);
}

const VISUAL_CATEGORY_CONFIG = {
    architecture: {
        label: 'Архитектура',
        shortLabel: 'Архитектура',
        icon: '🏛️',
        progressKey: 'visualArchitectureProgress',
        solvedKey: 'visualArchitectureSolved',
        data: () => (window.visualArchitectureData || []).filter(item => item.type === 'architecture'),
    },
    painting: {
        label: 'Живопись',
        shortLabel: 'Живопись',
        icon: '🖼️',
        progressKey: 'visualPaintingProgress',
        solvedKey: 'visualPaintingSolved',
        excludedFactTypes: ['style'],
        data: () => (window.visualPaintingData || []).filter(item => item.type === 'painting'),
    },
};

function visualSelectedCategory() {
    return window.state.currentVisualCategory || null;
}

function visualCategoryConfig(category) {
    return VISUAL_CATEGORY_CONFIG[category] || VISUAL_CATEGORY_CONFIG.architecture;
}

function visualCategoryForItem(item) {
    return item?.type === 'painting' ? 'painting' : 'architecture';
}

function visualFactEnabled(item, fact) {
    const excluded = visualCategoryConfig(visualCategoryForItem(item)).excludedFactTypes || [];
    return !excluded.includes(fact.type);
}

function visualData(category) {
    if (category && VISUAL_CATEGORY_CONFIG[category]) {
        return VISUAL_CATEGORY_CONFIG[category].data().filter(item => item && item.mainImage && item.fullCharacteristic);
    }
    return Object.keys(VISUAL_CATEGORY_CONFIG).flatMap(key => visualData(key));
}

function visualProgressFor(itemOrId, category) {
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    const resolvedCategory = category || (typeof itemOrId === 'string' ? visualSelectedCategory() : visualCategoryForItem(itemOrId));
    const cfg = visualCategoryConfig(resolvedCategory);
    const stats = window.state.stats;
    if (!stats[cfg.progressKey]) stats[cfg.progressKey] = {};
    if (!stats[cfg.progressKey][id]) {
        stats[cfg.progressKey][id] = { streak: 0, learned: false, attempts: 0, correct: 0 };
    }
    return stats[cfg.progressKey][id];
}

function visualLearnedCount(items) {
    return items.filter(item => visualProgressFor(item).learned).length;
}

/**
 * Умный подбор следующего памятника:
 * - Не повторять тот же памятник подряд (gap 3-6 итераций)
 * - Приоритет: in-progress (streak > 0) > новые
 */
function visualPickPool(items) {
    const open = items.filter(item => !visualProgressFor(item).learned);
    if (!open.length) return null;

    const history = window._visualHistory || [];
    const recentIds = new Set(history.slice(-6));

    // Кандидаты с минимальным gap=3
    const minGap = Math.min(3, open.length - 1);
    const recentBlock = new Set(history.slice(-minGap));
    let candidates = open.filter(item => !recentBlock.has(item.id));
    if (!candidates.length) candidates = open;

    // Приоритет: in-progress
    const inProgress = candidates.filter(item => visualProgressFor(item).streak > 0);
    // Из in-progress убираем те что были в последних 6
    const ipFresh = inProgress.filter(item => !recentIds.has(item.id));
    
    let pool;
    if (ipFresh.length) pool = ipFresh;
    else if (inProgress.length) pool = inProgress;
    else {
        const fresh = candidates.filter(item => !recentIds.has(item.id));
        pool = fresh.length ? fresh : candidates;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    window._visualHistory.push(pick.id);
    if (window._visualHistory.length > 20) window._visualHistory = window._visualHistory.slice(-15);
    return pick;
}

function visualUniqueBy(items, getValue) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const value = getValue(item);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push({ item, value });
    }
    return out;
}

/**
 * Генерируем дистракторы для конкретного drill fact
 */
function visualFactDistractors(items, item, fact) {
    const correctAnswer = visualAnswerText(fact.answer);
    const byType = other => (other.drillFacts || []).find(f => {
        const answer = visualAnswerText(f.answer);
        return f.type === fact.type &&
            answer &&
            answer !== correctAnswer &&
            !visualIsBlockedDistractor(item, fact, answer);
    });
    const samePeriod = visualUniqueBy(
        items.filter(other => other.id !== item.id && other.period === item.period && byType(other)),
        other => visualAnswerText(byType(other).answer)
    );
    const all = visualUniqueBy(
        items.filter(other => other.id !== item.id && byType(other)),
        other => visualAnswerText(byType(other).answer)
    );
    const source = samePeriod.length >= 4 ? samePeriod : all;
    return shuffleArray(source).slice(0, 4).map((entry, idx) => ({
        key: `d${idx}`, text: entry.value, correct: false,
    }));
}

/**
 * Строим набор последовательных вопросов для одного памятника.
 * Возвращаем массив шагов (steps), каждый шаг — один drill fact с 4 вариантами.
 * Если у памятника мало drillFacts с дистракторами, используем те что есть (min 1).
 */
function visualBuildSteps(items, item) {
    // Фильтруем date — точный год не спрашиваем
    const facts = (item.drillFacts || []).filter(f => visualFactEnabled(item, f) && f.type !== 'date' && f.answer && visualFactDistractors(items, item, f).length >= 3);

    if (!facts.length) {
        // Фоллбэк: если нет drill facts с достаточными дистракторами,
        // спрашиваем хотя бы то что есть
        const anyFacts = (item.drillFacts || []).filter(f => visualFactEnabled(item, f) && f.answer && visualFactDistractors(items, item, f).length >= 1);
        if (!anyFacts.length) return [];
        return anyFacts.map(fact => _buildStep(items, item, fact));
    }

    // Случайный порядок характеристик каждый раз
    const shuffled = shuffleArray([...facts]);

    return shuffled.map(fact => _buildStep(items, item, fact));
}

function _buildStep(items, item, fact) {
    const distractors = visualFactDistractors(items, item, fact);
    // Берём до 3 дистракторов + 1 правильный = 4 варианта
    const options = shuffleArray([
        { key: 'correct', text: visualAnswerText(fact.answer), correct: true },
        ...distractors.slice(0, 3),
    ]);
    return {
        factType: fact.type,
        label: fact.label,
        question: fact.question,
        correctAnswer: visualAnswerText(fact.answer),
        options,
    };
}

/** Красивое имя типа факта для UI */
function visualFactIcon(type) {
    const icons = {
        title: '🖼️',
        creator: '🎨',
        location: '📍',
        century: '🕰️',
        halfCentury: '⌛',
        date: '📅',
        style: '🏛️',
        ruler: '👑',
        event: '⚔️',
    };
    return icons[type] || '❓';
}

function visualFactLabel(type) {
    const labels = {
        title: 'Название',
        creator: 'Автор',
        location: 'Место',
        century: 'Век',
        halfCentury: 'Половина века',
        date: 'Дата',
        style: 'Стиль',
        ruler: 'Правитель',
        event: 'Событие',
    };
    return labels[type] || 'Факт';
}

function renderVisualCategoryPicker(area) {
    const categories = Object.keys(VISUAL_CATEGORY_CONFIG).map(key => {
        const cfg = visualCategoryConfig(key);
        const items = visualData(key);
        const learned = visualLearnedCount(items);
        const pct = items.length ? Math.round(learned / items.length * 100) : 0;
        return { key, cfg, items, learned, pct };
    });

    const cards = categories.map(({ key, cfg, items, learned, pct }) => `
        <button data-action="selectVisualCategory" data-arg="${key}" class="visual-cat-btn">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;">
                <div style="display:flex;align-items:center;gap:0.75rem;min-width:0;">
                    <span style="font-size:1.875rem;">${cfg.icon}</span>
                    <div style="min-width:0;">
                        <div class="vcat-title">${cfg.label}</div>
                        <div class="vcat-sub">${learned} / ${items.length} выучено</div>
                    </div>
                </div>
                <span class="vcat-arrow">›</span>
            </div>
            <div class="visual-cat-progress-track">
                <div class="visual-cat-progress-fill" style="width:${pct}%"></div>
            </div>
        </button>
    `).join('');

    area.innerHTML = `<div class="visual-category-picker">
        <div style="text-align:center;margin-bottom:1rem;">
            <div style="font-size:0.625rem;font-weight:900;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.5rem;">Визуал ЕГЭ</div>
            <h2>Что решаем?</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.75rem;">${cards}</div>
    </div>`;
}

window.selectVisualCategory = function(category) {
    if (!VISUAL_CATEGORY_CONFIG[category]) return;
    haptic('medium');
    window.state.currentVisualCategory = category;
    window.state.currentVisualId = null;
    window._visualHistory = [];
    window._visualMultiStep = null;
    const cfg = visualCategoryConfig(category);
    $('game-title-display').innerText = `${cfg.icon} ${cfg.label}`;
    window.renderVisualTrainer(true);
};

window.backToVisualCategoryPicker = function() {
    haptic('light');
    window.state.currentVisualCategory = null;
    window.state.currentVisualId = null;
    window._visualHistory = [];
    window._visualMultiStep = null;
    $('game-title-display').innerText = '🏛️ Визуал ЕГЭ';
    window.renderVisualTrainer(true);
};


window.startVisualTrainer = function() {
    haptic('medium');
    window.state.currentMode = 'visual';
    window.state.currentVisualCategory = null;
    window.state.currentVisualId = null;
    window._visualHistory = [];
    window._visualMultiStep = null;
    $('game-title-display').innerText = '🏛️ Визуал ЕГЭ';
    $('lobby-area').classList.add('hidden');
    $('game-container').classList.remove('hidden');
    $('game-container').classList.add('flex');
    document.body.classList.add('in-game');
    $('bottom-nav').classList.add('hide-nav');
    if (typeof toggleMode === 'function') toggleMode('visual');
};

/**
 * Основной рендер: если нет активного мульти-шага — выбираем новый памятник
 * и строим цепочку вопросов. Если есть — рендерим текущий шаг.
 */
window.renderVisualTrainer = function(forceNew) {
    const area = $('visual-trainer-area');
    if (!area) return;
    const selectedCategory = visualSelectedCategory();
    const allItems = visualData();
    if (!allItems.length) {
        area.innerHTML = '<div class="text-center p-8 bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-gray-100 dark:border-[#2c2c2c] text-rose-500 font-black">База визуала не загружена.</div>';
        return;
    }
    if (forceNew) {
        window.state.currentVisualId = null;
        window._visualHistory = [];
        window._visualMultiStep = null;
    }
    if (!selectedCategory) {
        renderVisualCategoryPicker(area);
        return;
    }

    const cfg = visualCategoryConfig(selectedCategory);
    const items = visualData(selectedCategory);
    if (!items.length) {
        area.innerHTML = `<div class="w-full max-w-lg bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-sm border border-gray-200 dark:border-[#2c2c2c] p-6 text-center">
            <div class="text-3xl mb-3">${cfg.icon}</div>
            <div class="text-sm font-black text-rose-500 uppercase tracking-widest mb-4">База «${visualEscape(cfg.label)}» не загружена.</div>
            <button data-action="backToVisualCategoryPicker" class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-black py-3 rounded-xl uppercase tracking-widest active:scale-95 transition-transform">Назад</button>
        </div>`;
        return;
    }
    const learned = visualLearnedCount(items);
    const pct = Math.round(learned / items.length * 100);

    if (learned >= items.length) {
        area.innerHTML = `<div class="w-full max-w-lg bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-sm border border-gray-200 dark:border-[#2c2c2c] p-8 text-center">
            <div class="text-5xl mb-4">🏆</div>
            <h2 class="text-2xl font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest mb-2">${visualEscape(cfg.label)} выучена!</h2>
            <p class="text-sm font-bold text-gray-500 dark:text-gray-400 mb-6">${learned} / ${items.length} памятников</p>
            <div class="flex flex-col gap-2">
                <button data-action="resetVisualTrainer" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-4 rounded-2xl uppercase tracking-widest active:scale-95 transition-transform">🔄 Начать заново</button>
                <button data-action="backToVisualCategoryPicker" class="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-black py-3 rounded-2xl uppercase tracking-widest active:scale-95 transition-transform">Выбор раздела</button>
            </div>
        </div>`;
        return;
    }

    // Если нет активной цепочки — выбираем новый памятник
    let ms = window._visualMultiStep;
    if (!ms || ms.finished) {
        const item = visualPickPool(items);
        if (!item) return;
        window.state.currentVisualId = item.id;
        const steps = visualBuildSteps(items, item);
        if (!steps.length) {
            // Если у памятника совсем нет вопросов — пропускаем
            window._visualMultiStep = null;
            setTimeout(() => window.renderVisualTrainer(), 50);
            return;
        }
        ms = {
            item,
            category: selectedCategory,
            steps,
            currentStep: 0,
            allCorrect: true,
            wrongSteps: [],
            finished: false,
        };
        window._visualMultiStep = ms;
    }

    const item = ms.item;
    const progress = visualProgressFor(item, ms.category);
    const step = ms.steps[ms.currentStep];
    const totalSteps = ms.steps.length;
    const currentIdx = ms.currentStep;

    // --- Stepper dots ---
    const stepperDots = ms.steps.map((s, i) => {
        let dotClass = 'bg-gray-300 dark:bg-gray-600';
        let iconText = '';
        if (i < currentIdx) {
            // Завершённый шаг
            if (ms.wrongSteps.includes(i)) {
                dotClass = 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]';
                iconText = '✗';
            } else {
                dotClass = 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]';
                iconText = '✓';
            }
        } else if (i === currentIdx) {
            dotClass = 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] ring-2 ring-blue-300 dark:ring-blue-700';
        }
        const label = visualFactLabel(s.factType);
        return `<div class="flex flex-col items-center gap-0.5">
            <div class="w-7 h-7 rounded-full ${dotClass} flex items-center justify-center text-[10px] font-black text-white transition-all duration-300">${iconText}</div>
            <span class="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">${visualEscape(label)}</span>
        </div>`;
    }).join(`<div class="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 self-start mt-3.5 -mx-1"></div>`);

    // --- Streak dots (общий прогресс: 2 правильных раунда подряд) ---
    const streakDots = [0,1].map(i =>
        `<div class="w-3 h-3 rounded-full ${i < progress.streak ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-gray-300 dark:bg-gray-600'}"></div>`
    ).join('');

    // --- Options ---
    const options = step.options.map(option => `
        <button data-action="answerVisualStep" data-arg="${option.key}" data-visual-option="${option.key}"
            class="visual-option">
            ${visualEscape(option.text)}
        </button>`).join('');

    area.innerHTML = `<div class="visual-trainer-root" style="width:100%;max-width:80rem;display:flex;flex-direction:column;gap:0.5rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0 0.25rem;">
            <div style="font-size:0.6875rem;font-weight:900;color:#9ca3af;text-transform:uppercase;letter-spacing:0.1em;">${cfg.icon} ${visualEscape(cfg.label)}</div>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <div class="visual-learned-badge">${learned} / ${items.length} выучено</div>
                <button data-action="backToVisualCategoryPicker" class="visual-ctrl-btn" title="Выбрать раздел">↔</button>
                <button data-action="resetVisualTrainer" class="visual-ctrl-btn ctrl-reset" title="Сбросить прогресс">🔄</button>
            </div>
        </div>
        <div class="visual-progress-track" style="margin-bottom:0.25rem;">
            <div class="visual-cat-progress-fill" style="width:${pct}%;transition:width 0.7s;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:0.75rem;align-items:stretch;">
            <div class="visual-item-card">
                <div class="visual-img-box">
                    <img src="${visualEscape(item.mainImage)}" alt="Памятник">
                </div>
                <div class="visual-item-footer">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.5rem;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.625rem;font-weight:900;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">🧩 Определи характеристики</div>
                            <div style="display:flex;align-items:center;gap:0.25rem;font-size:0.6875rem;font-weight:700;color:#9ca3af;">
                                <span>Серия:</span> ${streakDots}
                                <span style="margin-left:4px;">${progress.streak}/2</span>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:flex-start;gap:0;margin-top:0.25rem;">${stepperDots}</div>
                </div>
            </div>
            <div class="visual-question-panel">
                <div>
                    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem;">
                        <span style="font-size:1.125rem;">${visualFactIcon(step.factType)}</span>
                        <div style="font-size:0.625rem;font-weight:900;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;">Шаг ${currentIdx + 1} из ${totalSteps}</div>
                    </div>
                    <h3 class="visual-question-text">${visualEscape(step.question)}</h3>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.375rem;">${options}</div>
                <div id="visual-feedback" class="visual-feedback"></div>
            </div>
        </div>
    </div>
    <style>
    @media(min-width:1024px){
        .visual-trainer-root > div:last-child{
            grid-template-columns: minmax(0,1fr) minmax(300px,400px);
        }
    }
    </style>`;
};

/**
 * Обработка ответа на один шаг мульти-цепочки
 */
window.answerVisualStep = function(optionKey) {
    const ms = window._visualMultiStep;
    if (!ms || ms.finished) return;

    const step = ms.steps[ms.currentStep];
    const correct = optionKey === 'correct';

    // Подсветить кнопки через CSS-классы (без Tailwind dark: в JS)
    document.querySelectorAll('[data-visual-option]').forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.visualOption === 'correct') {
            btn.classList.add('opt-correct');
        } else if (btn.dataset.visualOption === optionKey) {
            btn.classList.add('opt-wrong');
        } else {
            btn.classList.add('opt-dim');
        }
    });

    const feedback = $('visual-feedback');

    if (correct) {
        haptic('success');
        if (feedback) feedback.innerHTML = `<span style="color:#059669;">✓ ${visualEscape(visualFactLabel(step.factType))}: ${visualEscape(step.correctAnswer)}</span>`;
    } else {
        haptic('error');
        ms.allCorrect = false;
        ms.wrongSteps.push(ms.currentStep);
        showVisualMistakeCard(ms.item, step);
        if (feedback) feedback.innerHTML = `<span style="color:#e11d48;">✗ Разбор ошибки показан сверху</span>`;
    }

    const isLast = ms.currentStep >= ms.steps.length - 1;

    if (isLast) {
        // Завершение раунда — подводим итоги
        ms.finished = true;
        const item = ms.item;
        const category = ms.category || visualCategoryForItem(item);
        const cfg = visualCategoryConfig(category);
        const progress = visualProgressFor(item, category);
        progress.attempts = (progress.attempts || 0) + 1;
        progress.lastUpdated = Date.now();

        if (ms.allCorrect) {
            progress.correct = (progress.correct || 0) + 1;
            progress.streak = Math.min((progress.streak || 0) + 1, 2);
            if (progress.streak >= 2) {
                progress.learned = true;
                progress.learnedAt = Date.now();
                window.state.currentVisualId = null;
                window.state.stats[cfg.solvedKey] = (window.state.stats[cfg.solvedKey] || 0) + 1;
                setTimeout(() => {
                    if (feedback) feedback.innerHTML = `<span style="color:#059669;">🏆 Все верно! <b>${visualEscape(item.title)}</b> — ВЫУЧЕНО!</span>`;
                }, correct ? 300 : 800);
                showToast(cfg.icon, `${item.title} выучен!`, 'bg-emerald-500', 'border-emerald-700');
            } else {
                window.state.currentVisualId = item.id;
                setTimeout(() => {
                    if (feedback) feedback.innerHTML = `<span style="color:var(--c-brand-strong);">✅ Все характеристики верны! <b>${visualEscape(item.title)}</b> — серия ${progress.streak}/2</span>`;
                }, correct ? 300 : 800);
            }
        } else {
            progress.streak = 0;
            progress.learned = false;
            window.state.currentVisualId = null;
            const wrongCount = ms.wrongSteps.length;
            setTimeout(() => {
                if (feedback) feedback.innerHTML = `<span style="color:#e11d48;">❌ Ошибок: ${wrongCount} из ${ms.steps.length}. Серия сброшена.</span>`;
            }, correct ? 300 : 800);
        }

        saveProgress();
        // Переход к следующему памятнику
        const delay = ms.allCorrect ? 1500 : 2500;
        setTimeout(() => {
            window._visualMultiStep = null;
            window.renderVisualTrainer();
        }, delay);
    } else {
        // Переход к следующему шагу
        ms.currentStep++;
        const delay = correct ? 700 : 1400;
        setTimeout(() => window.renderVisualTrainer(), delay);
    }
};


window.resetVisualTrainer = function() {
    const category = visualSelectedCategory();
    const cfg = visualCategoryConfig(category);
    const message = category
        ? `Сбросить прогресс раздела «${cfg.label}»? Все памятники вернутся в пул.`
        : 'Сбросить весь прогресс визуала? Все памятники вернутся в пул.';
    if (!confirm(message)) return;
    haptic('light');
    if (category) {
        window.state.stats[cfg.progressKey] = {};
        window.state.stats[cfg.solvedKey] = 0;
    } else {
        Object.values(VISUAL_CATEGORY_CONFIG).forEach(entry => {
            window.state.stats[entry.progressKey] = {};
            window.state.stats[entry.solvedKey] = 0;
        });
    }
    window.state.currentVisualId = null;
    window._visualHistory = [];
    window._visualMultiStep = null;
    saveProgress();
    window.renderVisualTrainer(true);
    showToast('🔄', category ? `Прогресс раздела «${cfg.label}» сброшен` : 'Прогресс визуала сброшен', 'bg-blue-500', 'border-blue-700');
};
