// app.js — точка входа: инициализация, проверка ответов, навигация, делегирование событий
// Зависимости: config.js, utils.js, state.js, table.js, modes.js, ui.js
'use strict';

window.openGlobalTopModal = function() { showToast('⏳', 'Подключение...', 'bg-blue-500', 'border-blue-700'); };

// === LOGO / SECRET ADMIN ===
window.secretClicks = 0;
window.secretTimer = null;
window.handleLogoClick = function() {
    window.secretClicks++;
    clearTimeout(window.secretTimer);
    window.secretTimer = setTimeout(() => window.secretClicks = 0, 1000);
    if (window.secretClicks === 5) {
        window.secretClicks = 0;
        window.state.isTeacherAdmin = true;
        showToast('👨‍🏫', 'Кабинет учителя открыт!', 'bg-purple-600', 'border-purple-800');
        if (window.loadClassProgress) window.loadClassProgress();
        window.openTeacherModal();
        return;
    }
    haptic('light');
    if (!$('game-container').classList.contains('hidden')) backToLobby();
    else { updateGlobalUI(); showToast('🔄', 'Лобби обновлено', 'bg-blue-500', 'border-blue-700'); }
};

// === ZEN BUTTON ===
window.updateZenButton = function() {
    const zenBtn = $('zen-exit-btn');
    if (!zenBtn) return;
    if (window.state.focusMode) {
        const smallClass = "w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-tr from-teal-500 to-emerald-400 backdrop-blur-md hover:scale-110 active:scale-90 transition-all duration-300 rounded-full cursor-pointer flex items-center justify-center shadow-[0_0_10px_rgba(20,184,166,0.8)] no-print border-2 border-white dark:border-[#1e1e1e] z-[100]";
        if (!$('classic-task-area').classList.contains('hidden')) {
            zenBtn.className = "absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 " + smallClass;
            zenBtn.innerHTML = '<span class="text-[12px] sm:text-[14px] drop-shadow-md relative">🧘</span>';
            const wrap = $('action-wrapper');
            if (wrap) { wrap.classList.add('relative'); wrap.appendChild(zenBtn); }
        } else {
            document.body.appendChild(zenBtn);
            zenBtn.className = "fixed bottom-4 left-1/2 transform -translate-x-1/2 " + smallClass;
            zenBtn.innerHTML = '<span class="text-[12px] sm:text-[14px] drop-shadow-md relative">🧘</span>';
        }
        zenBtn.classList.remove('hidden');
        zenBtn.classList.add('flex');
    } else {
        zenBtn.classList.add('hidden');
        zenBtn.classList.remove('flex');
    }
};

// === НАВИГАЦИЯ ===
function isMediaTaskChoice(task) {
    return !!(window.isMediaLearningTask && window.isMediaLearningTask(task));
}

function supportsYearSort(task) {
    return task === 'task3' || task === 'task7' || isMediaTaskChoice(task);
}

window.quickStartGame = function(task, mode) {
    haptic('medium');
    if (isMediaTaskChoice(task) && mode !== 'flashcards' && mode !== 'study') {
        mode = 'study';
    }
    window.state.currentTask = task;
    $('filter-task').value = task;
    $('filter-mode').value = mode;
    const sortYC = $('pg-sort-year-container');
    if (sortYC) sortYC.classList.toggle('hidden', !supportsYearSort(task));
    if (!$('filter-period').value) $('filter-period').value = 'all';

    const cfg = TASK_CONFIG[task] || TASK_CONFIG.task4;
    const titles = {
        'normal': `${cfg.emoji} ${cfg.label}`,
        'solve': '🎲 Решать', 'flashcards': '🃏 Флеш-карточки',
        'mistakes': '🔥 Ошибки', 'study': '📖 Сюжеты',
        'detective': '🕵️ Секретный архив', 'redpencil': '🖍️ Красный карандаш'
    };
    $('pre-game-title').innerText = titles[mode];
    $('game-title-display').innerText = titles[mode];
    $('lobby-area').classList.add('hidden');
    $('game-container').classList.remove('hidden');
    $('game-container').classList.add('flex');
    document.body.classList.add('in-game');
    $('bottom-nav').classList.add('hide-nav');
    toggleMode(mode);
    if (window.updateHwLearnBar) window.updateHwLearnBar();
    if (window.updateGamePeriodChip) window.updateGamePeriodChip();
};

window.backToLobby = function() {
    haptic('light');
    if (window.state.currentMode === 'duel') {
        if (window.cancelDuelDb) window.cancelDuelDb();
        window.state.duel.active = false;
    }
    // FIX #7: сброс режима при выходе
    window.state.currentMode = 'normal';
    window.state.activeHw = null; // выход из потока ДЗ
    $('game-container').classList.add('hidden');
    $('game-container').classList.remove('flex');
    $('lobby-area').classList.remove('hidden');
    if (!window.state.focusMode) {
        document.body.classList.remove('in-game');
        $('bottom-nav').classList.remove('hide-nav');
    }
    $('duel-header').classList.add('hidden');
    $('duel-header').classList.remove('flex');
    $('game-header').classList.remove('hidden');
    clearInterval(window.state.timerInterval);
    $('game-timer-display').classList.add('hidden');
    $('task-table-body').innerHTML = '';
    $('pool-container').innerHTML = '';
    ['classic-task-area', 'flashcard-area', 'study-area', 'visual-trainer-area', 'redpencil-area'].forEach(id => {
        const el = $(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('flex', 'lg:flex-row'); }
    });
    document.body.classList.remove('mode-detective');
    // FIX #10: убираем оверлей доски если остался
    const bo = $('board-overlay');
    if (bo) bo.classList.add('hidden');
    if (window.updateHwLearnBar) window.updateHwLearnBar();
    if (window.updateGamePeriodChip) window.updateGamePeriodChip();
    window.updateZenButton();
    updateProgressBars();
};

// === TASK PICKER ===
window._pendingMode = null;
window.pickTaskForMode = function(mode) {
    haptic('light');
    if (mode === 'visual') { window.startVisualTrainer?.(); return; }
    if (mode === 'detective' || mode === 'redpencil' || mode === 'solve') {
        // FIX: детектив/карандаш/решать не используют медийные задания (карты/живопись/архитектура).
        // Иначе media-гард в quickStartGame принудительно вернёт режим в study и покажет прошлую карту.
        // Для «решать» начальное задание неважно — оно выбирается случайно в generateTable.
        const cur = window.state.currentTask;
        quickStartGame(isMediaTaskChoice(cur) ? 'task4' : (cur || 'task4'), mode);
        return;
    }
    window._pendingMode = mode;
    const modeNames = { 'flashcards': '🃏 Флеш-карточки', 'speedrun': '⚡ Спидран', 'mistakes': '🔥 Ошибки', 'study': '📖 Сюжеты' };
    $('tp-title').innerText = modeNames[mode] || 'Выберите задание';
    const allowMediaTasks = mode === 'flashcards' || mode === 'study';
    $$('.media-task-pick').forEach(btn => btn.classList.toggle('hidden', !allowMediaTasks));
    updateTaskPickerProgress();
    $('task-picker-modal').classList.remove('hidden');
    $('task-picker-modal').classList.add('flex');
    setTimeout(() => { $('task-picker-modal').classList.remove('opacity-0'); $('tp-sheet').classList.remove('translate-y-full'); }, 10);
};

window.confirmTaskPick = function(task) {
    const mode = (isMediaTaskChoice(task) && window._pendingMode !== 'flashcards') ? 'study' : window._pendingMode;
    closeTaskPicker();
    if (mode) quickStartGame(task, mode);
};
window.closeTaskPicker = function() {
    $('task-picker-modal').classList.add('opacity-0');
    $('tp-sheet').classList.add('translate-y-full');
    setTimeout(() => { $('task-picker-modal').classList.add('hidden'); $('task-picker-modal').classList.remove('flex'); }, 300);
};
function updateTaskPickerProgress() {
    $$('.tp-progress').forEach(el => {
        const info = getTaskProgress(el.dataset.task);
        el.textContent = info.learned + '/' + info.total;
    });
}

// === ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ===
function toggleMode(mode) {
    if (window.state.currentMode !== mode) {
        window.state.currentMode = mode;
        window.state.stats.streak = 0;
        updateGlobalUI();
    }
    const timerContainer = $('game-timer-display');
    timerContainer.classList.add('hidden');
    clearInterval(window.state.timerInterval);

    const isFc = mode === 'flashcards';
    const isSt = mode === 'study', isDet = mode === 'detective';
    const isVisual = mode === 'visual';
    const isRP = mode === 'redpencil', isDuel = mode === 'duel';
    document.body.classList.toggle('mode-detective', isDet);

    ['classic-task-area', 'flashcard-area', 'study-area', 'visual-trainer-area', 'redpencil-area'].forEach(id => {
        const el = $(id);
        if (el) { el.classList.add('hidden'); if (id === 'classic-task-area') el.classList.remove('flex', 'lg:flex-row'); else el.classList.remove('flex'); }
    });

    if (isRP) {
        const rpa = $('redpencil-area'); if (rpa) { rpa.classList.remove('hidden'); rpa.classList.add('flex'); }
        if (window.startRedPencilMode) window.startRedPencilMode();
    } else if (isFc) {
        const fa = $('flashcard-area'); if (fa) { fa.classList.remove('hidden'); fa.classList.add('flex'); }
        if (window.nextFlashcard) window.nextFlashcard();
    } else if (isSt) {
        const sa = $('study-area'); if (sa) { sa.classList.remove('hidden'); sa.classList.add('flex'); }
        window.state.studyIndex = 0;
        if (window.renderStudyCard) window.renderStudyCard();
    } else if (isVisual) {
        const va = $('visual-trainer-area'); if (va) { va.classList.remove('hidden'); va.classList.add('flex'); }
        if (window.renderVisualTrainer) window.renderVisualTrainer();
    } else {
        const ca = $('classic-task-area');
        if (ca) { ca.classList.remove('hidden'); ca.classList.add('flex', 'lg:flex-row'); }
        if (window.generateTable && !isDuel) generateTable();
    }
    setTimeout(() => window.updateZenButton(), 50);
}

// === ОБРАБОТЧИКИ ИЗМЕНЕНИЙ ===
window.handleTaskChange = function() {
    window.state.currentTask = $('filter-task').value;
    const sortC = $('pg-sort-year-container');
    if (sortC) sortC.classList.toggle('hidden', !supportsYearSort(window.state.currentTask));
    if (window.state.currentMode === 'flashcards') window.nextFlashcard();
    else if (window.state.currentMode === 'study') window.renderStudyCard();
    else if (isMediaTaskChoice(window.state.currentTask)) quickStartGame(window.state.currentTask, 'study');
    else generateTable();
};
window.handleModeChange = function() { toggleMode($('filter-mode').value); };
window.handleSettingsChange = function() {
    const mode = window.state.currentMode;
    if (mode === 'flashcards') window.nextFlashcard();
    else if (mode === 'study') { window.state.studyIndex = 0; if (window.renderStudyCard) renderStudyCard(); }
    else if (mode === 'visual') { if (window.renderVisualTrainer) renderVisualTrainer(true); }
    else if (mode === 'redpencil') { if (window.startRedPencilMode) startRedPencilMode(); }
    else if (window.generateTable) generateTable();
    if (window.updateGamePeriodChip) window.updateGamePeriodChip();
};

// === ЕГЭ-БАЛЛЫ ЗА ЗАДАНИЕ ===
// Критерии оценивания:
//   task4: 3 балла — без ошибок, 2 — 1 ошибка, 1 — 2 ошибки, 0 — 3+
//   task3, task5, task7: 2 балла — без ошибок, 1 — 1 ошибка, 0 — 2+
// «Ошибка» = строка, которую ученик исправлял хотя бы раз (scored="fixed")
// или строка, на которую был показан ответ (answersRevealed)
function calculateEgePoints(rows, task) {
    if (window.state.answersRevealed) return 0;
    const errCount = [...rows].filter(tr => {
        const scored = tr.dataset.scored;
        // Ошибка = исправленная строка, неправильная, или вообще не оценённая (была пропущена)
        return scored === 'fixed' || scored === 'incorrect' || !scored;
    }).length;
    if (task === 'task4') {
        return errCount === 0 ? 3 : errCount === 1 ? 2 : errCount === 2 ? 1 : 0;
    } else {
        return errCount === 0 ? 2 : errCount === 1 ? 1 : 0;
    }
}

// Все ячейки заполнены и КАЖДАЯ верна (read-only, без начисления/пометок). Зеркалит логику checkAnswers.
function _tableAllSlotsCorrect() {
    const rows = $$('#task-table-body tr');
    if (!rows.length) return false;
    let sawSlot = false;
    for (let idx = 0; idx < rows.length; idx++) {
        const slots = rows[idx].querySelectorAll('.dnd-slot');
        if (!slots.length) continue;
        const fact = window.state.currentTargetData[idx];
        const acceptSet = (window.state.currentMode !== 'detective')
            ? window.acceptableAnswerSet(fact, window.state.currentTask) : null;
        for (const slot of slots) {
            if (slot.classList.contains('revealed-slot')) continue;
            sawSlot = true;
            const chip = slot.querySelector('.dnd-chip');
            if (!chip) return false; // не заполнено
            const val = chip.dataset.pureText || chip.innerText;
            const ok = acceptSet ? acceptSet.has(val) : (val === slot.dataset.expected);
            if (!ok) return false;
        }
    }
    return sawSlot;
}

// Авто-проверка после расстановки: если ВСЁ заполнено верно — сразу проверяем (как «Зубрёжка»).
// При ошибках ничего не делаем — ученик жмёт «Проверить» сам и видит, где не так.
window.maybeAutoSubmit = function() {
    const st = window.state;
    if (!st || st.currentMode === 'duel') return;        // дуэль — ручная проверка
    if (st.answersRevealed) return;
    const cb = $('check-buttons');
    if (!cb || cb.classList.contains('hidden')) return;  // уже проверено / не идёт ввод
    if (!_tableAllSlotsCorrect()) return;
    checkAnswers(true, true);
};

// === ПРОВЕРКА ОТВЕТОВ ===
function checkAnswers(isSure, auto) {
    isSure = isSure !== false;
    const rows = $$('#task-table-body tr');
    let allCorrect = true, filled = 0, total = $$('#task-table-body .dnd-slot').length, newlyCorrect = 0;

    rows.forEach(tr => tr.querySelectorAll('.dnd-slot').forEach(slot => {
        if (slot.classList.contains('has-item') && !slot.classList.contains('revealed-slot')) filled++;
    }));
    if (filled === 0) return showToast('⚠️', 'Заполните ячейки', 'bg-gray-800', 'border-black');

    rows.forEach((tr, idx) => {
        const fact = window.state.currentTargetData[idx];
        const slots = tr.querySelectorAll('.dnd-slot');
        let rowAllCor = true, rowFilled = 0;

        // Слой 2: множество допустимых ответов (только task3/5/7, не детектив)
        const acceptSet = (window.state.currentMode !== 'detective')
            ? window.acceptableAnswerSet(fact, window.state.currentTask)
            : null;

        slots.forEach(slot => {
            if (slot.classList.contains('has-item') && !slot.classList.contains('revealed-slot')) rowFilled++;
            const chip = slot.querySelector('.dnd-chip');
            const valToCheck = chip ? (chip.dataset.pureText || chip.innerText) : null;
            const slotCorrect = acceptSet ? acceptSet.has(valToCheck) : (valToCheck === slot.dataset.expected);
            if (slotCorrect && !slot.classList.contains('revealed-slot')) {
                slot.classList.add('correct-slot');
                slot.classList.remove('incorrect-slot');
            } else if (!slot.classList.contains('revealed-slot')) {
                rowAllCor = false;
                if (chip) { slot.classList.add('incorrect-slot'); slot.classList.remove('correct-slot'); }
            }
        });

        if (!rowAllCor || rowFilled !== slots.length) allCorrect = false;

        if (rowFilled > 0 && !window.state.answersRevealed) {
            const isDet = window.state.currentMode === 'detective';
            if (!isDet) {
                const fKey = factKey(fact);
                const mIdx = window.state.mistakesPool.findIndex(m => mistakeMatchesFact(m, fact));
                if (!tr.dataset.scored) {
                    const tk = window.state.currentMode === 'duel' ? 'task4' : window.state.currentTask;
                    const eraKey = getEraFromFact(fact, tk);
                    if (!window.state.stats.eraStats[tk]) window.state.stats.eraStats[tk] = {};
                    if (eraKey && !window.state.stats.eraStats[tk][eraKey]) window.state.stats.eraStats[tk][eraKey] = { correct: 0, total: 0 };
                    if (eraKey) window.state.stats.eraStats[tk][eraKey].total++;

                    if (rowAllCor && rowFilled === slots.length) {
                        if (eraKey) window.state.stats.eraStats[tk][eraKey].correct++;
                        updateFactSRS(fKey, true, isSure);
                        if (mIdx !== -1) window.state.mistakesPool.splice(mIdx, 1);
                        tr.dataset.scored = "correct";
                        newlyCorrect++;
                    } else {
                        updateFactSRS(fKey, false, false);
                        if (mIdx === -1) window.state.mistakesPool.push({ fact, task: window.state.currentTask });
                        tr.dataset.scored = "incorrect";
                    }
                } else if (tr.dataset.scored === "incorrect" && rowAllCor && rowFilled === slots.length) {
                    tr.dataset.scored = "fixed";
                    if (mIdx !== -1) window.state.mistakesPool.splice(mIdx, 1);
                }
            } else {
                if (!tr.dataset.scored) {
                    if (rowAllCor && rowFilled === slots.length) { tr.dataset.scored = "correct"; newlyCorrect++; }
                    else tr.dataset.scored = "incorrect";
                } else if (tr.dataset.scored === "incorrect" && rowAllCor && rowFilled === slots.length) {
                    tr.dataset.scored = "fixed";
                }
            }
        }
    });

    if (window.updateHwLearnBar) window.updateHwLearnBar();   // обновить прогресс выучивания (learned-ДЗ)

    // DUEL MODE
    if (window.state.currentMode === 'duel') {
        if (newlyCorrect > 0) {
            if (!window.state.tableHasMistake && allCorrect && filled === total) {
                const prevCombo = window.state.duel.myCombo || 0;
                const newCombo = prevCombo + newlyCorrect;
                let bonus = 0;
                for (let i = prevCombo + 1; i <= newCombo; i++) { if (i % 5 === 0) bonus += (i / 5); }
                window.state.duel.myCombo = newCombo;
                window.state.duel.myScore += newlyCorrect + bonus;
                if (bonus > 0) showToast('🔥', `КОМБО x${newCombo}! Бонус +${bonus}`, 'bg-purple-600', 'border-purple-800');
                else showToast('✅', `+${newlyCorrect} строк!`, 'bg-emerald-500', 'border-emerald-700');
            } else {
                window.state.duel.myScore += newlyCorrect;
                haptic('success');
                showToast('✅', `+${newlyCorrect} строк!`, 'bg-emerald-500', 'border-emerald-700');
            }
            updateScoreAndStats(newlyCorrect);
        }
        if (!allCorrect) {
            window.state.duel.myCombo = 0;
            haptic('error');
            window.state.tableHasMistake = true;
            showToast('❌', 'Есть ошибки! Комбо сброшено.', 'bg-rose-500', 'border-rose-700');
            $('reveal-btn').classList.remove('hidden');
        } else if (allCorrect && filled === total) {
            haptic('success');
            $('check-buttons').classList.add('hidden');
            $('reveal-btn').classList.add('hidden');
            setTimeout(() => window.generateTable(), 300);
        }
        window.updateDuelUI();
        if (window.updateDuelScoreDb) window.updateDuelScoreDb(window.state.duel.myScore, window.state.duel.myCombo);
        updateGlobalUI();
        return;
    }

    // NORMAL MODE
    if (newlyCorrect > 0) {
        updateScoreAndStats(newlyCorrect, !window.state.tableHasMistake && allCorrect, 0);
    }
    // ── FIX: ЕГЭ-баллы начисляются когда ВСЯ таблица решена, даже если были ошибки ──
    if (allCorrect && filled === total) {
        const egePts = calculateEgePoints(rows, window.state.currentTask || 'task4');
        if (egePts > 0) {
            updateScoreAndStats(0, false, egePts);
        }
    }
    window.state.stats.achievementsData.maxMistakes = Math.max(window.state.stats.achievementsData.maxMistakes || 0, window.state.mistakesPool.length);

    const isDet = window.state.currentMode === 'detective';
    if (allCorrect && filled === total) {
        haptic('success');
        if (!window.state.tableHasMistake) {
            window.state.stats.streak++;
            if (window.state.stats.streak % 5 === 0 && window.state.stats.streak > 0 && !window.state.isHomeworkMode) {
                setTimeout(() => showToast('🔥', 'Отличный стрик!', 'bg-purple-600', 'border-purple-800'), 2500);
            }
        }
        if (isDet) {
            showToast('🕵️', 'Дело успешно закрыто!', 'bg-emerald-600', 'border-emerald-800');
        } else {
            if (!window.state.tableHasMistake) showToast(isSure ? '✅' : '🤔', window.getJokePhrase(true), isSure ? 'bg-emerald-500' : 'bg-indigo-500', isSure ? 'border-emerald-700' : 'border-indigo-700');
            else showToast('✅', 'Ошибки исправлены!', 'bg-blue-500', 'border-blue-700');
        }
        $('check-buttons').classList.add('hidden');
        $('check-buttons').classList.remove('flex');
        $('reveal-btn').classList.add('hidden');
        $('next-btn').classList.remove('hidden');
        $('next-btn').innerHTML = isDet ? '📂 Следующее дело' : '➡️ Дальше';

        if (window.state.isHomeworkMode && window.state.hwTargetIndices?.length > 0) {
            window.state.hwCurrentPool.splice(0, rows.length);
            if (window.state.hwCurrentPool.length === 0) endGame();
        } else { saveLocal(); syncNow(); }
        checkAchievements();
        // Поток ДЗ: если активный этап выполнен — автопереход к следующему / завершение
        if (window.state.activeHw && window.maybeAdvanceHw && window.maybeAdvanceHw()) {
            $('next-btn').classList.add('hidden');
            updateGlobalUI();
            return;
        }
        // Авто-«Далее» при полностью верном заполнении (как в «Зубрёжке»): жмём «Дальше» сами.
        if (auto) {
            const nb = $('next-btn');
            setTimeout(() => { if (nb && !nb.classList.contains('hidden')) nb.click(); }, 550);
        }
    } else {
        haptic('error');
        window.state.stats.streak = 0;
        window.state.tableHasMistake = true;
        showToast('❌', isDet ? 'Улики не сходятся!' : window.getJokePhrase(false), 'bg-rose-500', 'border-rose-700');
        $('reveal-btn').classList.remove('hidden');
    }
    updateGlobalUI();
    window.updateZenButton();
}

function toggleAnswers() {
    window.state.answersRevealed = !window.state.answersRevealed;
    const btn = $('reveal-btn');
    const rows = $$('#task-table-body tr');
    const isDet = window.state.currentMode === 'detective';

    if (window.state.answersRevealed) {
        window.state.tableHasMistake = true;
        window.state.stats.streak = 0;
        btn.innerHTML = isDet ? '🙈 Скрыть улики' : '🙈 Скрыть ответы';
        rows.forEach((tr, idx) => {
            const fact = window.state.currentTargetData[idx];
            if (!window.state.isHomeworkMode && !tr.dataset.scored) {
                tr.dataset.scored = "incorrect";
                if (!isDet) {
                    updateFactSRS(factKey(fact), false, false);
                    if (!window.state.mistakesPool.some(m => mistakeMatchesFact(m, fact))) {
                        window.state.mistakesPool.push({ fact, task: window.state.currentTask });
                    }
                }
            }
            tr.querySelectorAll('.dnd-slot').forEach(slot => {
                if (!slot.classList.contains('correct-slot')) {
                    slot._userChildren = Array.from(slot.childNodes);
                    slot.innerHTML = `<div class="dnd-chip in-slot revealed-chip">${slot.dataset.expected}</div>`;
                    slot.classList.remove('incorrect-slot');
                    slot.classList.add('revealed-slot', 'has-item');
                }
            });
        });
        window.state.stats.achievementsData.maxMistakes = Math.max(window.state.stats.achievementsData.maxMistakes || 0, window.state.mistakesPool.length);
        $('check-buttons').classList.add('hidden');
        $('check-buttons').classList.remove('flex');
        $('next-btn').classList.remove('hidden');
        $('next-btn').innerHTML = isDet ? '📂 Следующее дело' : '➡️ Дальше';
        updateGlobalUI();
        saveLocal();
    } else {
        btn.innerHTML = isDet ? '👀 Запросить подсказку штаба' : '👀 Сдаюсь, покажи ответы';
        rows.forEach(tr => tr.querySelectorAll('.dnd-slot').forEach(slot => {
            if (slot.classList.contains('revealed-slot')) {
                slot.classList.remove('revealed-slot');
                slot.innerHTML = '';
                if (slot._userChildren?.length > 0) {
                    slot._userChildren.forEach(c => slot.appendChild(c));
                    slot.classList.add('has-item', 'incorrect-slot');
                } else slot.classList.remove('has-item', 'incorrect-slot');
            }
        }));
        $('check-buttons').classList.remove('hidden');
        $('check-buttons').classList.add('flex');
        $('next-btn').classList.add('hidden');
    }
    window.updateZenButton();
}

// === HOMEWORK ===
function checkURLForHomework() {
    const p = new URLSearchParams(window.location.search);
    const hwCount = p.get('hw_count');
    const hwIds = p.get('hw');

    if (hwIds) {
        const tsk = p.get('task') || 'task4';
        window.state.isHomeworkMode = true;
        window.state.hwTargetIndices = hwIds.split(',').map(Number);
        window.state.hwCurrentPool = [...window.state.hwTargetIndices];
        $('filter-task').value = tsk;
        window.state.currentTask = tsk;
        $('lobby-area').classList.add('hidden');
        $('hw-alert').classList.remove('hidden');
        updateText($('hw-remaining'), window.state.hwCurrentPool.length);
        $('game-container').classList.remove('hidden');
        $('game-container').classList.add('flex');
        $('game-title-display').innerText = "📚 ДОМАШНЕЕ ЗАДАНИЕ";
        document.body.classList.add('in-game');
        $('bottom-nav').classList.add('hide-nav');
        toggleMode('normal');
    } else if (hwCount) {
        window.state.stats.hwFlashcardsToSolve = parseInt(hwCount);
        if (p.get('hw_task')) { $('filter-task').value = p.get('hw_task'); window.state.currentTask = p.get('hw_task'); }
        if (p.get('hw_period')) {
            $('filter-period').value = p.get('hw_period');
            if (p.get('hw_period') === 'custom') {
                $('custom-year-start').value = p.get('hw_sy') || '862';
                $('custom-year-end').value = p.get('hw_ey') || '2022';
            }
        }
        saveProgress();
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('📝', 'Вам назначено ДЗ!', 'bg-blue-500', 'border-blue-700');
        updateGlobalUI();
        setTimeout(() => {
            $('lobby-area').classList.add('hidden');
            $('game-container').classList.remove('hidden');
            $('game-container').classList.add('flex');
            document.body.classList.add('in-game');
            $('bottom-nav').classList.add('hide-nav');
            $('game-title-display').innerText = "📚 ДОМАШНЕЕ ЗАДАНИЕ";
            toggleMode('normal');
        }, 500);
    }
}

// === ИНИЦИАЛИЗАЦИЯ ===
function initStorage() {
    cacheDOM();
    if (tg && tg.initDataUnsafe) {
        tg.expand(); tg.ready();
        // Тема по умолчанию — светлая. Тёмную из Telegram больше не навязываем новым
        // пользователям; кто хочет тёмную — переключает сам (выбор сохраняется в ege_theme).
    }
    initPrecomputed();

    // Скрываем пустые/одиночные категории детектива из селектора + добавляем счётчик дел
    if (typeof window.refreshDetectiveCaseOptions === 'function') window.refreshDetectiveCaseOptions();

    if (!DOM['filter-period'].value) DOM['filter-period'].value = 'all';
    if (!DOM['filter-task'].value) DOM['filter-task'].value = 'task4';
    if (!DOM['filter-mode'].value) DOM['filter-mode'].value = 'normal';
    if (!DOM['filter-rows'].value) DOM['filter-rows'].value = '4';

    DOM['task-table-body'].addEventListener('click', e => { const slot = e.target.closest('.dnd-slot'); if (slot) handleSlotClick(slot); });
    DOM['pool-container'].addEventListener('click', e => { const chip = e.target.closest('.dnd-chip'); if (chip) window.onChipClick(chip, e); });

    loadFromStorage();
    if (localStorage.getItem('ege_theme') === 'dark') document.documentElement.classList.add('dark');
    // hideLearned теперь всегда true — чекбоксы не нужны

    setTimeout(() => $$('.modal-content-hidden').forEach(el => el.classList.remove('modal-content-hidden')), 500);
    updateGlobalUI();
    updateProgressBars();
    checkOnboarding();
    checkURLForHomework();
    window.egeAppStorageReady = true;
    document.dispatchEvent(new Event('ege:storage-ready'));
    if (window.egePwa && navigator.onLine !== false) window.egePwa.loadFirebaseSync?.();

    // Таймер общего времени — сохраняем каждые 30 сек
    setInterval(() => {
        window.state.stats.totalTimeSpent = (window.state.stats.totalTimeSpent || 0) + 1;
        const today = getTodayString();
        if (!window.state.stats.dailyStats[today]) window.state.stats.dailyStats[today] = { timeSpent: 0, solved: 0 };
        window.state.stats.dailyStats[today].timeSpent++;
        if (window.state.stats.totalTimeSpent % 30 === 0) saveLocal();
    }, 1000);
}

// === ДЕЛЕГИРОВАНИЕ СОБЫТИЙ ===
const ACTION_HANDLERS = {
    handleLogoClick:        () => window.handleLogoClick?.(),
    openGlobalSettings:     () => window.openGlobalSettings?.(),
    openStatsModal:         () => window.openStatsModal?.(),
    openGlobalTopModal:     () => window.openGlobalTopModal?.(),
    openEGEModal:           () => window.openEGEModal?.(),
    toggleFocusMode:        () => window.toggleFocusMode?.(),
    toggleTheme:            () => window.toggleTheme?.(),
    startDuelSearch:        () => window.startDuelSearch?.(),
    cancelDuelSearch:       () => window.cancelDuelSearch?.(),
    startHwFromBanner:      () => window.startHwFromBanner?.(),
    openHwTab:              () => window.openHwTab?.(),
    openCram:               (a) => window.openCram?.(a),
    backToLobby:            () => window.backToLobby?.(),
    quickStartGame:         (a, a2) => window.quickStartGame?.(a, a2 || 'normal'),
    startVisualTrainer:     () => window.startVisualTrainer?.(),
    selectVisualCategory:   (a) => window.selectVisualCategory?.(a),
    selectCultureLearningTab: (a) => window.selectCultureLearningTab?.(a),
    backToVisualCategoryPicker: () => window.backToVisualCategoryPicker?.(),
    answerVisualStep:       (a) => window.answerVisualStep?.(a),
    resetVisualTrainer:     () => window.resetVisualTrainer?.(),
    pickTaskForMode:        (a) => window.pickTaskForMode?.(a),
    confirmTaskPick:        (a) => window.confirmTaskPick?.(a),
    closeTaskPicker:        () => window.closeTaskPicker?.(),
    checkAnswersTrue:       () => window.checkAnswers?.(true),
    checkAnswersFalse:      () => window.checkAnswers?.(false),
    generateTable:          () => window.generateTable?.(),
    toggleAnswers:          () => window.toggleAnswers?.(),
    giveUpRedPencil:        () => window.giveUpRedPencil?.(),
    nextRedPencilCase:      () => window.nextRedPencilCase?.(),
    applyGlobalSettings:    () => window.applyGlobalSettings?.(),
    closePreGameModal:      () => window.closePreGameModal?.(),
    checkCustomPeriod:      () => window.checkCustomPeriod?.(),
    setPgRows:              (a) => window.setPgRows?.(Number(a)),
    nextOnbStep:            (a) => window.nextOnbStep?.(Number(a)),
    finishOnboarding:       () => window.finishOnboarding?.(),
    hideModal:              (a) => window.hideModal?.(a),
    openProfileModal:       () => window.openProfileModal?.(),
    openAchievementsModal:  () => window.openAchievementsModal?.(),
    openMistakesListModal:  () => window.openMistakesListModal?.(),
    copyTextReport:         () => window.copyTextReport?.(),
    shareTelegram:          () => window.shareTelegram?.(),
    closeGameOverModal:     () => window.closeGameOverModal?.(),
    signInWithGoogle:       () => window.signInWithGoogle?.(),
    saveProfileName:        () => window.saveProfileName?.(),
    saveTeacherClassCode:   () => window.saveTeacherClassCode?.(),
    switchTeacherTab:       (a) => window.switchTeacherTab?.(a),
    nextStudyCard:          () => window.nextStudyCard?.(),
    openMapModal:           (a) => window.openMapModal?.(a),
};

// Экспорт на window для совместимости
window.generateTable = generateTable;
window.checkAnswers = checkAnswers;
window.toggleAnswers = toggleAnswers;

document.addEventListener('click', function(e) {
    if (e.target.dataset.backdrop && e.target === e.target.closest('[data-backdrop]')) {
        const fn = window[e.target.dataset.backdrop];
        if (typeof fn === 'function') fn();
        return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const handler = ACTION_HANDLERS[el.dataset.action];
    if (handler) { e.stopPropagation(); handler(el.dataset.arg || null, el.dataset.arg2 || null); }
}, true);

document.addEventListener('DOMContentLoaded', initStorage);
