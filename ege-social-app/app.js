(function () {
  'use strict';

  const bank = window.EGE_SOCIAL_BANK;
  const task13Trainers = window.EGE_SOCIAL_TASK13_TRAINERS;
  const core = window.SocialCore;
  if (!bank || !task13Trainers || !core) throw new Error('Учебный банк не загрузился');

  const RELEASE = '2026-08-11-social-2';
  const STORAGE = Object.freeze({
    progress: 'ege_social_progress_v1',
    settings: 'ege_social_settings_v1',
    activeSession: 'ege_social_active_session_v1',
    lastSession: 'ege_social_last_session_v1',
    theme: 'ege_social_theme_v1',
    task13Labs: 'ege_social_task13_labs_v1'
  });
  const TYPE_META = Object.freeze({
    task1: { label: 'Задание №1', short: '№1', icon: '1', description: 'Два лишних термина' },
    task12: { label: 'Задание №12', short: '№12', icon: '12', description: 'Конституция РФ' },
    task13: { label: 'Задание №13', short: '№13', icon: '13', description: 'Органы власти и федерация' },
    matching: { label: 'Соответствие', short: 'А—1', icon: 'А1', description: '169 заданий' },
    choice: { label: 'Верные ответы', short: '✓', icon: '✓', description: '709 заданий' }
  });
  const MODE_META = Object.freeze({
    new: { label: 'Новое', description: 'Только задания без попыток', icon: '＋' },
    mixed: { label: 'Смешанная', description: 'Новые, ошибки и повторение', icon: '≈' },
    mistakes: { label: 'Ошибки', description: 'Задания, где нужен реванш', icon: '!' },
    review: { label: 'Повторение', description: 'То, что пора закрепить', icon: '↻' }
  });
  const TASK_BY_ID = new Map(bank.tasks.map(task => [task.id, task]));
  const BLOCK_BY_ID = new Map(bank.blocks.map(block => [block.id, block]));
  const TOPIC_BY_CODE = new Map(bank.topics.map(topic => [topic.code, topic]));
  const TASK13_TRAINER_BY_ID = new Map(task13Trainers.trainers.map(trainer => [trainer.id, trainer]));

  const elements = {
    shell: document.getElementById('appShell'),
    main: document.getElementById('mainView'),
    nav: document.getElementById('bottomNav'),
    topbar: document.querySelector('.topbar'),
    overlay: document.getElementById('overlayRoot'),
    theme: document.getElementById('themeToggle'),
    toast: document.getElementById('toast')
  };

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      showToast('Не удалось сохранить прогресс на этом устройстве');
    }
  }

  function uniqueKnown(values, known) {
    return [...new Set(Array.isArray(values) ? values : [])].filter(value => known.has(value));
  }

  function defaultSettings() {
    return { mode: 'mixed', count: 10, types: [], blocks: [], topics: [] };
  }

  function sanitizeSettings(value) {
    const base = defaultSettings();
    const source = value && typeof value === 'object' ? value : {};
    base.mode = Object.prototype.hasOwnProperty.call(MODE_META, source.mode) ? source.mode : 'mixed';
    base.count = [5, 10, 20].includes(Number(source.count)) ? Number(source.count) : 10;
    base.types = uniqueKnown(source.types, new Set(Object.keys(TYPE_META)));
    base.blocks = uniqueKnown(source.blocks, new Set(bank.blocks.map(block => block.id)));
    base.topics = uniqueKnown(source.topics, new Set(bank.topics.map(topic => topic.code)));
    return base;
  }

  function sanitizeSession(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.ids)) return null;
    const ids = [...new Set(value.ids)].filter(id => TASK_BY_ID.has(id));
    if (!ids.length) return null;
    return {
      version: 1,
      ids,
      index: Math.max(0, Math.min(ids.length - 1, Number(value.index) || 0)),
      responses: value.responses && typeof value.responses === 'object' ? value.responses : {},
      checked: value.checked && typeof value.checked === 'object' ? value.checked : {},
      exactCorrect: Math.max(0, Number(value.exactCorrect) || 0),
      earned: Math.max(0, Number(value.earned) || 0),
      possible: Math.max(0, Number(value.possible) || 0),
      startedAt: Math.max(0, Number(value.startedAt) || Date.now()),
      taskShownAt: Math.max(0, Number(value.taskShownAt) || Date.now()),
      completed: Boolean(value.completed)
    };
  }

  function emptyLabStat() {
    return { attempts: 0, correct: 0, wrong: 0, timeMs: 0, completions: 0, lastCompletedAt: 0 };
  }

  function sanitizeLabStat(value) {
    const source = value && typeof value === 'object' ? value : {};
    const stat = emptyLabStat();
    for (const key of Object.keys(stat)) stat[key] = Math.max(0, Number(source[key]) || 0);
    return stat;
  }

  function sanitizeTask13Labs(value) {
    const source = value && typeof value === 'object' ? value : {};
    const sessions = {};
    const stats = {};
    for (const trainer of task13Trainers.trainers) {
      const sanitized = core.sanitizeMasterySession(source.sessions && source.sessions[trainer.id], trainer);
      if (sanitized) sessions[trainer.id] = sanitized;
      stats[trainer.id] = sanitizeLabStat(source.stats && source.stats[trainer.id]);
    }
    return { version: 1, sessions, stats };
  }

  let progress = core.sanitizeProgress(loadJson(STORAGE.progress, null));
  let settings = sanitizeSettings(loadJson(STORAGE.settings, null));
  let session = sanitizeSession(loadJson(STORAGE.activeSession, null));
  let task13Labs = sanitizeTask13Labs(loadJson(STORAGE.task13Labs, null));
  let activeTrainerId = '';
  let view = session && !session.completed ? 'session' : 'home';
  let sheetOpen = false;
  let topicSearch = '';
  let toastTimer = 0;
  let labAdvanceTimer = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function textHtml(value) {
    return cleanDisplayText(value).split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function cleanDisplayText(value) {
    return String(value || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 2600);
  }

  function saveProgress() {
    saveJson(STORAGE.progress, progress);
  }

  function saveSettings() {
    settings = sanitizeSettings(settings);
    saveJson(STORAGE.settings, settings);
  }

  function saveSession() {
    if (session && !session.completed) saveJson(STORAGE.activeSession, session);
    else {
      try { localStorage.removeItem(STORAGE.activeSession); } catch (_) { /* noop */ }
    }
  }

  function saveTask13Labs() {
    saveJson(STORAGE.task13Labs, task13Labs);
  }

  function accuracy(earned, possible) {
    return possible > 0 ? Math.round((earned / possible) * 100) : 0;
  }

  function plural(number, one, few, many) {
    const value = Math.abs(Number(number)) % 100;
    const last = value % 10;
    if (value > 10 && value < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function sourceNote() {
    return `<p class="source-note">Источник заданий — <a href="${escapeHtml(bank.source.url)}" target="_blank" rel="noopener">открытый банк ФИПИ</a>. Структура тем сверена с <a href="https://fipi.ru/ege/demoversii-specifikacii-kodifikatory" target="_blank" rel="noopener">материалами ЕГЭ-2026</a>. Смешанная тренировка не является официальным пробником.</p>`;
  }

  function currentDaily() {
    return progress.daily[core.moscowDayKey(Date.now())] || 0;
  }

  function labLaunchCards() {
    return `<div class="lab-launch-grid">${task13Trainers.trainers.map(trainer => {
      const saved = task13Labs.sessions[trainer.id];
      const mastered = saved ? saved.mastered.length : 0;
      const action = saved && !saved.completed ? 'Продолжить' : saved && saved.completed ? 'Пройти снова' : 'Начать';
      return `<button class="lab-launch-card" type="button" data-action="open-task13-lab" data-trainer="${trainer.id}">
        <span class="lab-launch-top"><span class="format-icon">13</span><span class="tag tag--muted">${trainer.cards.length} карточек</span></span>
        <b>${escapeHtml(trainer.title)}</b>
        <small>${escapeHtml(trainer.description)}</small>
        <span class="lab-launch-progress"><span><i style="width:${Math.round((mastered / trainer.cards.length) * 100)}%"></i></span><em>${mastered}/${trainer.cards.length} · ${action}</em></span>
      </button>`;
    }).join('')}</div>`;
  }

  function homeView() {
    const today = currentDaily();
    const goal = 10;
    const degree = Math.min(360, Math.round((today / goal) * 360));
    const attemptedUnique = Object.values(progress.tasks).filter(item => item.attempts > 0).length;
    const mistakes = core.filterTasks(bank.tasks, { mode: 'mistakes' }, progress).length;
    const due = core.dueCount(bank.tasks, progress);
    const overallAccuracy = accuracy(progress.totals.earned, progress.totals.possible);
    const hasActive = session && !session.completed;
    return `
      <section class="view">
        <div class="hero">
          <p class="eyebrow">ЕГЭ · обществознание</p>
          <h1>${hasActive ? 'Занятие ждёт продолжения' : 'Решай по теме, а не наугад'}</h1>
          <p>${hasActive ? `Вы остановились на задании ${session.index + 1} из ${session.ids.length}. Ответы и время сохранены.` : 'Выберите блок, тему КЭС или конкретный тип задания. В банке — все 1 058 карточек из последней выгрузки.'}</p>
          <div class="hero-actions">
            <button class="button button--hero" type="button" data-action="${hasActive ? 'resume-session' : 'quick-start'}">${hasActive ? 'Продолжить' : 'Начать 10 вопросов'}</button>
            <button class="button button--soft" type="button" data-action="open-setup">Настроить</button>
          </div>
        </div>

        <div class="dashboard-grid">
          <article class="card daily-card">
            <div class="goal-ring" style="--goal:${degree}deg"><strong>${today}/${goal}</strong></div>
            <div class="daily-copy">
              <span class="card-kicker">Цель на сегодня</span>
              <h3>${today >= goal ? 'Готово. Отличный темп' : `Осталось ${Math.max(0, goal - today)} ${plural(Math.max(0, goal - today), 'задание', 'задания', 'заданий')}`}</h3>
              <p>День считается по московскому времени</p>
            </div>
          </article>
          <article class="card">
            <div class="card-head"><div><span class="card-kicker">Прогресс</span><h3>Ваш банк знаний</h3></div></div>
            <div class="mini-stats">
              <div class="mini-stat"><strong>${attemptedUnique}</strong><span>изучено</span></div>
              <div class="mini-stat"><strong>${overallAccuracy}%</strong><span>точность</span></div>
              <div class="mini-stat"><strong>${due}</strong><span>повторить</span></div>
            </div>
          </article>
        </div>

        <section class="section">
          <div class="section-head"><h2>Формат задания</h2><button type="button" data-action="open-setup">Все настройки</button></div>
          <div class="format-grid">
            ${Object.entries(TYPE_META).map(([id, meta]) => `
              <button class="format-card" type="button" data-action="quick-type" data-type="${id}">
                <span class="format-icon">${escapeHtml(meta.icon)}</span>
                <b>${escapeHtml(meta.label)}</b>
                <small>${escapeHtml(meta.description)}</small>
              </button>`).join('')}
          </div>
        </section>

        <section class="section task13-intensive-section">
          <div class="section-head"><div><p class="eyebrow">Внутри задания №13</p><h2>Интенсив по полномочиям</h2></div></div>
          <p class="lead">Две колоды доводят каждый факт до серии верных ответов. Ошибка возвращает карточку позже и увеличивает требуемую серию.</p>
          ${labLaunchCards()}
        </section>

        <section class="section">
          <div class="section-head"><h2>Закрепить</h2></div>
          <div class="quick-row">
            <button class="quick-card" type="button" data-action="quick-mode" data-mode="mistakes">
              <span class="quick-dot quick-dot--red"></span><span><strong>Ошибки</strong><small>${mistakes} ${plural(mistakes, 'задание', 'задания', 'заданий')}</small></span>
            </button>
            <button class="quick-card" type="button" data-action="quick-mode" data-mode="review">
              <span class="quick-dot"></span><span><strong>Повторение</strong><small>${due} ${plural(due, 'задание', 'задания', 'заданий')} на сегодня</small></span>
            </button>
          </div>
        </section>
        ${sourceNote()}
      </section>`;
  }

  function topicTaskCounts() {
    const counts = new Map(bank.topics.map(topic => [topic.code, 0]));
    for (const task of bank.tasks) for (const code of new Set(task.topicCodes)) counts.set(code, (counts.get(code) || 0) + 1);
    return counts;
  }

  function topicsView() {
    const counts = topicTaskCounts();
    const selectedBlocks = new Set(settings.blocks);
    const query = topicSearch.trim().toLocaleLowerCase('ru-RU');
    const topics = bank.topics.filter(topic => {
      if (selectedBlocks.size && !selectedBlocks.has(topic.blockId)) return false;
      if (query && !`${topic.code} ${topic.name}`.toLocaleLowerCase('ru-RU').includes(query)) return false;
      return true;
    });
    const selected = new Set(settings.topics);
    return `
      <section class="view">
        <header class="page-head"><p class="eyebrow">65 тем КЭС</p><h1>Решайте по темам</h1><p class="lead">Одно задание может относиться к нескольким темам. В занятии оно всё равно появится только один раз.</p></header>
        <div class="filter-toolbar" aria-label="Блоки обществознания">
          <button class="chip" type="button" data-action="topic-block" data-block="" aria-pressed="${settings.blocks.length === 0}">Все блоки</button>
          ${bank.blocks.map(block => `<button class="chip" type="button" data-action="topic-block" data-block="${block.id}" aria-pressed="${selectedBlocks.has(block.id)}">${escapeHtml(block.short)}</button>`).join('')}
        </div>
        <label class="search-field"><span class="sr-only">Поиск темы</span><input id="topicSearch" type="search" value="${escapeHtml(topicSearch)}" placeholder="Найти тему или код КЭС" autocomplete="off"></label>
        <div class="topic-list">
          ${topics.length ? topics.map(topic => `
            <button class="topic-card" type="button" data-action="toggle-topic" data-topic="${topic.code}" aria-pressed="${selected.has(topic.code)}">
              <span class="topic-code">${escapeHtml(topic.code)}</span>
              <span class="topic-title">${escapeHtml(topic.name)}</span>
              <span class="topic-count">${counts.get(topic.code)}</span>
            </button>`).join('') : `<div class="empty-state"><div class="empty-icon">⌕</div><h3>Темы не найдены</h3><p>Попробуйте изменить запрос или открыть другой блок.</p></div>`}
        </div>
        <div class="selection-bar">
          <span>${selected.size ? `Выбрано: ${selected.size}` : 'Без фильтра — все темы'}</span>
          <button class="button" type="button" data-action="open-setup">Настроить занятие</button>
        </div>
      </section>`;
  }

  function breakdownRows(rows, labels, limit) {
    const visible = rows.filter(row => row.attempted > 0 || row.possible > 0).sort((a, b) => b.attempted - a.attempted || b.available - a.available).slice(0, limit || rows.length);
    if (!visible.length) return `<div class="empty-state"><div class="empty-icon">◒</div><h3>Здесь появится прогресс</h3><p>Решите первое занятие — и увидите точность по каждому разделу.</p></div>`;
    return `<div class="breakdown">${visible.map(row => {
      const value = accuracy(row.earned, row.possible);
      return `<div class="breakdown-row"><div class="breakdown-top"><span>${escapeHtml(labels(row.key))}</span><span>${row.attempted}/${row.available} · ${value}%</span></div><div class="bar"><span style="width:${value}%"></span></div></div>`;
    }).join('')}</div>`;
  }

  function statsView() {
    const attemptedUnique = Object.values(progress.tasks).filter(item => item.attempts > 0).length;
    const totalAccuracy = accuracy(progress.totals.earned, progress.totals.possible);
    const minutes = Math.round(progress.totals.timeMs / 60000);
    const typeRows = core.aggregate(bank.tasks, progress, task => [task.type]);
    const blockRows = core.aggregate(bank.tasks, progress, task => task.blockIds);
    const topicRows = core.aggregate(bank.tasks, progress, task => task.topicCodes);
    const labRows = task13Trainers.trainers.map(trainer => {
      const stat = task13Labs.stats[trainer.id] || emptyLabStat();
      const saved = task13Labs.sessions[trainer.id];
      const mastered = saved ? saved.mastered.length : 0;
      return `<div class="breakdown-row"><div class="breakdown-top"><span>${escapeHtml(trainer.title)}</span><span>${mastered}/${trainer.cards.length} · ${accuracy(stat.correct, stat.attempts)}%</span></div><div class="bar"><span style="width:${Math.round((mastered / trainer.cards.length) * 100)}%"></span></div></div>`;
    }).join('');
    return `
      <section class="view">
        <header class="page-head"><p class="eyebrow">Личный прогресс</p><h1>Статистика</h1><p class="lead">Считаем попытки, точность по позициям и время. Данные пока хранятся только на этом устройстве.</p></header>
        <div class="stats-hero">
          <article class="stat-card"><span class="stat-label">Точность ответов</span><strong class="stat-value">${totalAccuracy}%</strong></article>
          <article class="stat-card"><span class="stat-label">Изучено заданий</span><strong class="stat-value">${attemptedUnique}</strong></article>
          <article class="stat-card"><span class="stat-label">Минут в тренировках</span><strong class="stat-value">${minutes}</strong></article>
        </div>
        <section class="section"><div class="section-head"><h2>По типам</h2></div><article class="card card--flat">${breakdownRows(typeRows, key => TYPE_META[key].label)}</article></section>
        <section class="section"><div class="section-head"><h2>Интенсивы №13</h2></div><article class="card card--flat"><div class="breakdown">${labRows}</div></article></section>
        <section class="section"><div class="section-head"><h2>По блокам</h2></div><article class="card card--flat">${breakdownRows(blockRows, key => BLOCK_BY_ID.get(key).short)}</article></section>
        <section class="section"><div class="section-head"><h2>Темы в работе</h2></div><article class="card card--flat">${breakdownRows(topicRows, key => `${key} ${TOPIC_BY_CODE.get(key).name}`, 12)}</article></section>
      </section>`;
  }

  function checkedDetailMap(checked) {
    return new Map((checked && checked.details || []).map(detail => [String(detail.n || detail.label), detail]));
  }

  function answerCombination(task) {
    if (task.type === 'matching' || task.type === 'task13') {
      return task.targets.map((target, index) => `${target.label}–${task.answer[index]}`).join(', ');
    }
    return task.answer.split('').join(', ');
  }

  function sessionTaskView(task) {
    const checked = session.checked[task.id] || null;
    const response = session.responses[task.id] || (task.type === 'matching' || task.type === 'task13' ? {} : []);
    const details = checkedDetailMap(checked);
    const isMatching = task.type === 'matching' || task.type === 'task13';
    const percent = Math.round(((session.index + (checked ? 1 : 0)) / session.ids.length) * 100);
    const topic = TOPIC_BY_CODE.get(task.topicCodes[0]);
    return `
      <section class="view session-shell">
        <header class="session-head">
          <button class="icon-button" type="button" data-action="leave-session" aria-label="Закрыть занятие">×</button>
          <div class="session-progress"><strong>${session.index + 1} из ${session.ids.length}</strong><div class="progress-track"><span style="width:${percent}%"></span></div></div>
          <div class="session-spacer"></div>
        </header>
        <article class="task-card">
          <div class="task-meta"><span class="tag">${escapeHtml(TYPE_META[task.type].label)}</span><span class="tag tag--muted">КЭС ${escapeHtml(task.topicCodes.join(', '))}</span></div>
          <div class="task-prompt">${textHtml(task.prompt)}</div>
          ${(task.images || []).map((src, index) => `<div class="task-image-wrap"><img class="task-image" src="${escapeHtml(src)}" alt="Иллюстрация к заданию ${escapeHtml(task.id)}${task.images.length > 1 ? `, ${index + 1}` : ''}" loading="eager"></div>`).join('')}
          ${isMatching ? matchingAnswers(task, response, checked, details) : selectionAnswers(task, response, checked, details)}
          ${checked ? `<div class="result-box ${checked.correct ? 'result-box--success' : 'result-box--error'}"><strong>${checked.correct ? 'Верно' : isMatching ? `Верно позиций: ${checked.earned} из ${checked.total}` : 'Есть ошибка'}</strong><p>Правильная комбинация: ${escapeHtml(answerCombination(task))}</p></div>` : ''}
          <div class="task-actions">
            ${checked ? `<button class="button" type="button" data-action="next-task">${session.index + 1 === session.ids.length ? 'Завершить' : 'Следующее'}</button>` : `<button class="button" type="button" data-action="check-answer">Проверить</button>`}
          </div>
        </article>
        <p class="source-note">${topic ? `${escapeHtml(topic.code)} · ${escapeHtml(topic.name)}` : ''}</p>
      </section>`;
  }

  function selectionAnswers(task, response, checked, details) {
    const selected = new Set(Array.isArray(response) ? response.map(String) : String(response || '').split(''));
    return `<div class="answer-list">${task.options.map(option => {
      const id = String(option.n);
      const detail = details.get(id);
      const classNames = ['answer-option'];
      if (selected.has(id)) classNames.push('is-selected');
      if (checked && detail) {
        if (detail.correct && detail.selected) classNames.push('is-correct');
        else if (!detail.correct && detail.selected) classNames.push('is-wrong');
        else if (detail.correct && !detail.selected) classNames.push('is-missed');
      }
      return `<button class="${classNames.join(' ')}" type="button" data-action="select-option" data-option="${id}" aria-pressed="${selected.has(id)}" ${checked ? 'disabled' : ''}><span class="answer-number">${id}</span><span class="answer-text">${escapeHtml(option.text)}</span></button>`;
    }).join('')}</div>`;
  }

  function matchingAnswers(task, response, checked, details) {
    return `<div class="matching-list">${task.targets.map(target => {
      const value = String(response[target.label] || '');
      const detail = details.get(target.label);
      const rowClass = checked ? (detail && detail.correct ? ' is-correct' : ' is-wrong') : '';
      return `<div class="matching-row${rowClass}"><div class="matching-target"><b>${escapeHtml(target.label)})</b><span>${escapeHtml(target.text)}</span></div><select data-match="${escapeHtml(target.label)}" aria-label="Ответ для позиции ${escapeHtml(target.label)}" ${checked ? 'disabled' : ''}><option value="">Выберите вариант</option>${task.options.map(option => `<option value="${option.n}" ${value === String(option.n) ? 'selected' : ''}>${option.n}) ${escapeHtml(option.text)}</option>`).join('')}</select>${checked && detail && !detail.correct ? `<div class="matching-correction">Правильно: ${escapeHtml(detail.expected)}) ${escapeHtml((task.options.find(option => String(option.n) === detail.expected) || {}).text || '')}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  function summaryView() {
    const exact = session.exactCorrect;
    const total = session.ids.length;
    const partAccuracy = accuracy(session.earned, session.possible);
    const seconds = Math.max(1, Math.round((Date.now() - session.startedAt) / 1000));
    return `
      <section class="view session-shell">
        <article class="task-card summary">
          <div class="summary-badge">${partAccuracy}%</div>
          <p class="eyebrow">Занятие завершено</p>
          <h1>${partAccuracy >= 80 ? 'Сильный результат' : partAccuracy >= 55 ? 'Хорошая основа' : 'Есть что закрепить'}</h1>
          <p>Ошибки уже добавлены в отдельный режим, а верные ответы — в график повторения.</p>
          <div class="summary-grid"><div><strong>${exact}/${total}</strong><small>полностью верно</small></div><div><strong>${session.earned}/${session.possible}</strong><small>позиций</small></div><div><strong>${Math.ceil(seconds / 60)}</strong><small>минут</small></div></div>
          <button class="button button--wide" type="button" data-action="finish-session">На главную</button>
        </article>
      </section>`;
  }

  function sessionView() {
    if (!session) return homeView();
    if (session.completed) return summaryView();
    const task = TASK_BY_ID.get(session.ids[session.index]);
    return task ? sessionTaskView(task) : `<div class="empty-state"><h3>Задание не найдено</h3><button class="button" data-action="finish-session">На главную</button></div>`;
  }

  function activeTrainer() {
    return TASK13_TRAINER_BY_ID.get(activeTrainerId) || null;
  }

  function masteryDots(saved, trainer) {
    const state = saved.cardState[saved.currentId];
    const errorFlash = saved.feedback && !saved.feedback.correct;
    return `<div class="lab-mastery-dots" aria-label="Серия: ${state.streak} из ${state.targetStreak}">${Array.from({ length: state.targetStreak }, (_, index) => {
      const className = errorFlash && index === 0 ? ' is-error' : index < state.streak ? ' is-earned' : '';
      return `<span class="lab-mastery-dot${className}"></span>`;
    }).join('')}</div>`;
  }

  function labFeedback(saved, trainer) {
    const feedback = saved.feedback;
    if (!feedback) return '';
    if (feedback.correct) {
      const state = saved.cardState[saved.currentId];
      const left = Math.max(0, state.targetStreak - state.streak);
      return `<div class="result-box result-box--success lab-result"><strong>${feedback.mastered ? 'Факт выучен' : 'Верно'}</strong><p>${feedback.mastered ? 'Карточка вышла из колоды.' : `Осталось верных ответов подряд: ${left}.`}</p></div>`;
    }
    return `<div class="result-box result-box--error lab-result"><strong>Пока нет</strong><p>${trainer.mechanics.revealCorrectOnMistake ? 'Правильный вариант отмечен зелёным. ' : ''}Карточка вернётся позже. Теперь нужна серия из ${feedback.targetStreak}.</p></div>`;
  }

  function task13LabView() {
    const trainer = activeTrainer();
    const saved = trainer && task13Labs.sessions[trainer.id];
    if (!trainer || !saved) return `<div class="empty-state"><h3>Интенсив не найден</h3><button class="button" data-action="leave-task13-lab">На главную</button></div>`;
    if (saved.completed) {
      const stat = task13Labs.stats[trainer.id] || emptyLabStat();
      return `<section class="view session-shell"><article class="task-card summary lab-summary">
        <div class="summary-badge">13</div><p class="eyebrow">Интенсив завершён</p>
        <h1>Все ${trainer.cards.length} фактов выучены</h1>
        <p>${escapeHtml(trainer.title)}: каждая карточка прошла требуемую серию верных ответов.</p>
        <div class="summary-grid"><div><strong>${stat.correct}</strong><small>верных</small></div><div><strong>${stat.wrong}</strong><small>ошибок</small></div><div><strong>${stat.completions}</strong><small>прохождений</small></div></div>
        <div class="task-actions"><button class="button button--ghost" type="button" data-action="leave-task13-lab">На главную</button><button class="button" type="button" data-action="restart-task13-lab">Пройти снова</button></div>
      </article></section>`;
    }
    const card = trainer.cards.find(item => item.id === saved.currentId);
    if (!card) return `<div class="empty-state"><h3>Карточка не найдена</h3><button class="button" data-action="leave-task13-lab">На главную</button></div>`;
    const feedback = saved.feedback;
    const percent = Math.round((saved.mastered.length / trainer.cards.length) * 100);
    const queueCount = saved.queue.length + (!feedback || feedback.mastered ? 1 : 0);
    return `<section class="view session-shell task13-lab-shell">
      <header class="session-head">
        <button class="icon-button" type="button" data-action="leave-task13-lab" aria-label="Закрыть интенсив">×</button>
        <div class="session-progress"><strong>Выучено ${saved.mastered.length} из ${trainer.cards.length}</strong><div class="progress-track"><span style="width:${percent}%"></span></div></div>
        <span class="lab-queue-count" aria-label="Карточек в колоде">${saved.queue.length + 1}</span>
      </header>
      <article class="task-card lab-task-card${feedback ? ' is-answering' : ''}">
        <div class="task-meta"><span class="tag">Задание №13</span><span class="tag tag--muted">${escapeHtml(trainer.shortTitle)}</span></div>
        ${masteryDots(saved, trainer)}
        <div class="task-prompt lab-prompt"><p>${escapeHtml(card.text)}</p></div>
        <div class="lab-answer-grid lab-answer-grid--${trainer.answers.length}">${trainer.answers.map((answer, index) => {
          const classes = ['lab-answer'];
          if (feedback && feedback.selected === answer.id) classes.push(feedback.correct ? 'is-correct' : 'is-wrong');
          if (feedback && !feedback.correct && trainer.mechanics.revealCorrectOnMistake && feedback.expected === answer.id) classes.push('is-correct', 'is-revealed');
          return `<button class="${classes.join(' ')}" type="button" data-action="answer-task13-lab" data-answer="${answer.id}" aria-pressed="${Boolean(feedback && feedback.selected === answer.id)}" ${feedback ? 'disabled' : ''}><span class="lab-answer-number">${index + 1}</span><span><b>${escapeHtml(answer.label)}</b><small>${escapeHtml(answer.hint)}</small></span></button>`;
        }).join('')}</div>
        ${labFeedback(saved, trainer)}
        <p class="lab-rule">Карточка считается выученной после ${trainer.mechanics.initialTarget} верных ответов подряд. Ошибка увеличивает серию до ${trainer.mechanics.mistakeTarget}.</p>
      </article>
    </section>`;
  }

  function setupSheet() {
    if (!sheetOpen) return '';
    const filters = { mode: settings.mode, types: settings.types, blocks: settings.blocks, topics: settings.topics };
    const available = core.filterTasks(bank.tasks, filters, progress).length;
    const typeSet = new Set(settings.types);
    const blockSet = new Set(settings.blocks);
    return `
      <div class="sheet-backdrop" data-action="close-setup" role="presentation">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="setupTitle" data-sheet>
          <div class="sheet-handle"></div>
          <header class="sheet-head"><div><h2 id="setupTitle">Настройка занятия</h2><p>Фильтры можно сочетать</p></div><button class="close-button" type="button" data-action="close-setup" aria-label="Закрыть">×</button></header>
          <div class="field-group"><div class="field-label"><span>Режим</span></div><div class="mode-list">${Object.entries(MODE_META).map(([id, meta]) => `<button class="mode-option" type="button" data-action="set-mode" data-mode="${id}" aria-pressed="${settings.mode === id}"><span class="mode-glyph">${meta.icon}</span><span class="mode-copy"><b>${meta.label}</b><small>${meta.description}</small></span><span class="radio-dot"></span></button>`).join('')}</div></div>
          <div class="field-group"><div class="field-label"><span>Количество</span></div><div class="choice-grid choice-grid--three">${[5, 10, 20].map(count => `<button class="choice-pill" type="button" data-action="set-count" data-count="${count}" aria-pressed="${settings.count === count}">${count}</button>`).join('')}</div></div>
          <div class="field-group"><div class="field-label"><span>Тип задания</span><small>${settings.types.length ? `выбрано ${settings.types.length}` : 'все пять'}</small></div><div class="choice-grid">${Object.entries(TYPE_META).map(([id, meta]) => `<button class="choice-pill" type="button" data-action="toggle-type" data-type="${id}" aria-pressed="${typeSet.has(id)}">${escapeHtml(meta.label)}</button>`).join('')}</div></div>
          <div class="field-group"><div class="field-label"><span>Блок</span><small>${settings.blocks.length ? `выбрано ${settings.blocks.length}` : 'все блоки'}</small></div><div class="choice-grid">${bank.blocks.map(block => `<button class="choice-pill" type="button" data-action="toggle-block" data-block="${block.id}" aria-pressed="${blockSet.has(block.id)}">${escapeHtml(block.short)}</button>`).join('')}</div></div>
          <div class="field-group"><div class="field-label"><span>Темы КЭС</span><small>${settings.topics.length ? `выбрано ${settings.topics.length}` : 'без ограничения'}</small></div><button class="button button--ghost button--wide" type="button" data-action="pick-topics">${settings.topics.length ? 'Изменить темы' : 'Выбрать темы'}</button></div>
          <footer class="sheet-footer"><p class="available-note">Подходит ${available} ${plural(available, 'задание', 'задания', 'заданий')}</p><button class="button button--wide" type="button" data-action="start-custom" ${available ? '' : 'disabled'}>Начать ${Math.min(settings.count, available || settings.count)} ${plural(Math.min(settings.count, available || settings.count), 'вопрос', 'вопроса', 'вопросов')}</button></footer>
        </section>
      </div>`;
  }

  function setSessionChrome(active) {
    elements.shell.classList.toggle('app-shell--session', active);
    elements.topbar.hidden = active;
    elements.nav.hidden = active;
  }

  function render() {
    window.clearTimeout(labAdvanceTimer);
    const activeSession = view === 'session' || view === 'task13-lab';
    setSessionChrome(activeSession);
    if (view === 'topics') elements.main.innerHTML = topicsView();
    else if (view === 'stats') elements.main.innerHTML = statsView();
    else if (view === 'session') elements.main.innerHTML = sessionView();
    else if (view === 'task13-lab') elements.main.innerHTML = task13LabView();
    else elements.main.innerHTML = homeView();
    elements.overlay.innerHTML = setupSheet();
    document.body.style.overflow = sheetOpen ? 'hidden' : '';
    for (const button of elements.nav.querySelectorAll('[data-nav]')) {
      if (button.dataset.nav === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    updateThemeButton();
    if (view === 'task13-lab') scheduleLabAdvance();
  }

  function changeView(next) {
    if (!['home', 'topics', 'stats', 'session', 'task13-lab'].includes(next)) return;
    view = next;
    sheetOpen = false;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    elements.main.focus({ preventScroll: true });
  }

  function toggleInList(list, value) {
    const set = new Set(list);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set];
  }

  function startSession(overrides) {
    const filters = sanitizeSettings({ ...settings, ...(overrides || {}) });
    const tasks = core.buildSession(bank.tasks, filters, progress, filters.count);
    if (!tasks.length) {
      showToast(filters.mode === 'mistakes' ? 'Ошибок для тренировки пока нет' : filters.mode === 'review' ? 'На сегодня всё повторено' : 'По этим фильтрам заданий нет');
      return;
    }
    settings = filters;
    saveSettings();
    const now = Date.now();
    session = {
      version: 1,
      ids: tasks.map(task => task.id),
      index: 0,
      responses: {},
      checked: {},
      exactCorrect: 0,
      earned: 0,
      possible: 0,
      startedAt: now,
      taskShownAt: now,
      completed: false
    };
    saveSession();
    sheetOpen = false;
    changeView('session');
  }

  function startTask13Lab(trainerId, forceRestart) {
    const trainer = TASK13_TRAINER_BY_ID.get(trainerId);
    if (!trainer) return;
    let saved = task13Labs.sessions[trainer.id];
    if (!saved || saved.completed || forceRestart) {
      saved = core.createMasterySession(trainer);
      task13Labs.sessions[trainer.id] = saved;
      saveTask13Labs();
    }
    activeTrainerId = trainer.id;
    changeView('task13-lab');
  }

  function answerTask13Lab(selected) {
    const trainer = activeTrainer();
    const saved = trainer && task13Labs.sessions[trainer.id];
    if (!trainer || !saved || saved.feedback || saved.completed) return;
    const now = Date.now();
    const answered = core.answerMasteryCard(saved, trainer, selected, undefined, now);
    if (!answered) return;
    task13Labs.sessions[trainer.id] = answered.session;
    const stat = task13Labs.stats[trainer.id] || emptyLabStat();
    stat.attempts += 1;
    stat.correct += answered.outcome.correct ? 1 : 0;
    stat.wrong += answered.outcome.correct ? 0 : 1;
    stat.timeMs += Math.max(0, Math.min(60 * 60 * 1000, now - saved.cardShownAt));
    task13Labs.stats[trainer.id] = stat;
    progress = core.recordDailyActivity(progress, 1, now);
    saveTask13Labs();
    saveProgress();
    render();
  }

  function advanceTask13Lab() {
    const trainer = activeTrainer();
    const saved = trainer && task13Labs.sessions[trainer.id];
    if (!trainer || !saved || !saved.feedback) return;
    const next = core.advanceMasterySession(saved, trainer, Date.now());
    if (!next) return;
    if (!saved.completed && next.completed) {
      const stat = task13Labs.stats[trainer.id] || emptyLabStat();
      stat.completions += 1;
      stat.lastCompletedAt = Date.now();
      task13Labs.stats[trainer.id] = stat;
    }
    task13Labs.sessions[trainer.id] = next;
    saveTask13Labs();
    render();
  }

  function scheduleLabAdvance() {
    const trainer = activeTrainer();
    const saved = trainer && task13Labs.sessions[trainer.id];
    if (!trainer || !saved || !saved.feedback) return;
    const delay = Math.max(0, saved.feedback.advanceAt - Date.now());
    labAdvanceTimer = window.setTimeout(advanceTask13Lab, delay);
  }

  function leaveTask13Lab() {
    window.clearTimeout(labAdvanceTimer);
    saveTask13Labs();
    changeView('home');
    showToast('Прогресс интенсива сохранён');
  }

  function currentTask() {
    return session ? TASK_BY_ID.get(session.ids[session.index]) : null;
  }

  function toggleOption(value) {
    const task = currentTask();
    if (!task || session.checked[task.id]) return;
    const response = new Set(Array.isArray(session.responses[task.id]) ? session.responses[task.id].map(String) : []);
    if (response.has(value)) response.delete(value);
    else response.add(value);
    session.responses[task.id] = [...response].sort();
    saveSession();
    render();
  }

  function checkAnswer() {
    const task = currentTask();
    if (!task || session.checked[task.id]) return;
    const isMatching = task.type === 'matching' || task.type === 'task13';
    const response = session.responses[task.id] || (isMatching ? {} : []);
    if (isMatching && task.targets.some(target => !response[target.label])) {
      showToast('Выберите ответ для каждой позиции');
      return;
    }
    if (!isMatching && (!Array.isArray(response) || !response.length)) {
      showToast('Выберите хотя бы один вариант');
      return;
    }
    const outcome = core.recordAttempt(progress, task, response, Date.now() - session.taskShownAt, Date.now());
    progress = outcome.progress;
    session.checked[task.id] = outcome.result;
    session.exactCorrect += outcome.result.correct ? 1 : 0;
    session.earned += outcome.result.earned;
    session.possible += outcome.result.total;
    saveProgress();
    saveSession();
    render();
  }

  function nextTask() {
    const task = currentTask();
    if (!task || !session.checked[task.id]) return;
    if (session.index + 1 >= session.ids.length) {
      session.completed = true;
      saveJson(STORAGE.lastSession, session);
      saveSession();
      render();
      return;
    }
    session.index += 1;
    session.taskShownAt = Date.now();
    saveSession();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function finishSession() {
    session = null;
    saveSession();
    changeView('home');
  }

  function leaveSession() {
    saveSession();
    changeView('home');
    showToast('Занятие сохранено — можно продолжить позже');
  }

  function updateThemeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    elements.theme.querySelector('.theme-icon').textContent = dark ? '☾' : '☼';
    elements.theme.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE.theme, next); } catch (_) { /* noop */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = next === 'dark' ? '#181513' : '#f7f1e8';
    updateThemeButton();
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-nav]');
    if (!target) return;
    if (target.dataset.nav) {
      changeView(target.dataset.nav);
      return;
    }
    const action = target.dataset.action;
    if (action === 'open-task13-lab') startTask13Lab(target.dataset.trainer, false);
    else if (action === 'answer-task13-lab') answerTask13Lab(target.dataset.answer);
    else if (action === 'restart-task13-lab') startTask13Lab(activeTrainerId, true);
    else if (action === 'leave-task13-lab') leaveTask13Lab();
    else if (action === 'open-setup') { sheetOpen = true; render(); }
    else if (action === 'close-setup') {
      if (event.target.closest('[data-sheet]') && !event.target.closest('.close-button')) return;
      sheetOpen = false; render();
    } else if (action === 'quick-start') startSession({ mode: 'mixed', count: 10, types: [], blocks: [], topics: [] });
    else if (action === 'resume-session') changeView('session');
    else if (action === 'quick-type') startSession({ mode: 'mixed', count: 10, types: [target.dataset.type], blocks: [], topics: [] });
    else if (action === 'quick-mode') startSession({ mode: target.dataset.mode, count: 10, types: [], blocks: [], topics: [] });
    else if (action === 'set-mode') { settings.mode = target.dataset.mode; saveSettings(); render(); }
    else if (action === 'set-count') { settings.count = Number(target.dataset.count); saveSettings(); render(); }
    else if (action === 'toggle-type') { settings.types = toggleInList(settings.types, target.dataset.type); saveSettings(); render(); }
    else if (action === 'toggle-block') { settings.blocks = toggleInList(settings.blocks, target.dataset.block); saveSettings(); render(); }
    else if (action === 'pick-topics') { sheetOpen = false; changeView('topics'); }
    else if (action === 'start-custom') startSession();
    else if (action === 'topic-block') {
      settings.blocks = target.dataset.block ? [target.dataset.block] : [];
      saveSettings(); render();
    } else if (action === 'toggle-topic') { settings.topics = toggleInList(settings.topics, target.dataset.topic); saveSettings(); render(); }
    else if (action === 'select-option') toggleOption(target.dataset.option);
    else if (action === 'check-answer') checkAnswer();
    else if (action === 'next-task') nextTask();
    else if (action === 'leave-session') leaveSession();
    else if (action === 'finish-session') finishSession();
  });

  document.addEventListener('change', event => {
    const select = event.target.closest('select[data-match]');
    if (!select || !session) return;
    const task = currentTask();
    if (!task || session.checked[task.id]) return;
    const response = session.responses[task.id] && typeof session.responses[task.id] === 'object' ? session.responses[task.id] : {};
    response[select.dataset.match] = select.value;
    session.responses[task.id] = response;
    saveSession();
  });

  document.addEventListener('input', event => {
    if (event.target.id !== 'topicSearch') return;
    const caret = event.target.selectionStart;
    topicSearch = event.target.value;
    render();
    const next = document.getElementById('topicSearch');
    if (next) { next.focus(); next.setSelectionRange(caret, caret); }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sheetOpen) { sheetOpen = false; render(); return; }
    if (view === 'task13-lab') {
      if (event.key === 'Escape') { event.preventDefault(); leaveTask13Lab(); return; }
      const trainer = activeTrainer();
      const saved = trainer && task13Labs.sessions[trainer.id];
      if (!trainer || !saved || saved.feedback || saved.completed || !/^\d$/.test(event.key)) return;
      const answer = trainer.answers[Number(event.key) - 1];
      if (answer) { event.preventDefault(); answerTask13Lab(answer.id); }
      return;
    }
    if (view !== 'session' || !session || session.completed || event.altKey || event.ctrlKey || event.metaKey) return;
    const task = currentTask();
    const checked = task && session.checked[task.id];
    if (event.key === 'Enter') {
      event.preventDefault();
      if (checked) nextTask(); else checkAnswer();
      return;
    }
    if (!checked && task && task.type !== 'matching' && task.type !== 'task13' && /^\d$/.test(event.key) && task.options.some(option => String(option.n) === event.key)) {
      event.preventDefault();
      toggleOption(event.key);
    }
  });

  elements.theme.addEventListener('click', toggleTheme);

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isTelegram = /Telegram/i.test(ua) || Boolean(window.Telegram && window.Telegram.WebApp);
    if (isIOS && isTelegram) {
      try {
        const registrations = await Promise.race([
          navigator.serviceWorker.getRegistrations(),
          new Promise(resolve => window.setTimeout(() => resolve([]), 1000))
        ]);
        for (const registration of registrations) {
          if (registration.scope.startsWith(location.origin)) registration.unregister();
        }
        const keys = await Promise.race([caches.keys(), new Promise(resolve => window.setTimeout(() => resolve([]), 1000))]);
        for (const key of keys) if (key.startsWith('ege-social-')) caches.delete(key);
      } catch (_) { /* Telegram iOS continues without SW */ }
      return;
    }
    try { await navigator.serviceWorker.register(`service-worker.js?v=${RELEASE}`, { scope: './' }); } catch (_) { /* online app stays usable */ }
  }

  elements.shell.hidden = false;
  render();
  window.__EGE_SOCIAL_READY__ = true;
  window.setTimeout(registerServiceWorker, 700);
})();
