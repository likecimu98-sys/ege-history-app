// exam-mode.js — полноэкранный пробник тестовой части ЕГЭ по истории (1–12)
(function() {
    'use strict';

    const BANK_SRC = 'exam-bank.generated.js?v=20260719-2';
    const ORDERED_KIMS = new Set([1, 2, 3, 4, 5, 7]);
    const CHOICE_KIMS = new Set([6, 12]);
    const TASK_ICONS = Object.freeze({ 1: '⏳', 2: '🗓️', 3: '🔗', 4: '📍', 5: '👤', 6: '📜', 7: '🎨', 8: '🪙', 9: '🗺️', 10: '🗺️', 11: '🗺️', 12: '🗺️' });
    let bankPromise = null;
    let overlay = null;
    let view = 'dashboard';
    let currentIndex = 0;
    let reviewRecord = null;
    let resultRecord = null;
    let timerId = null;
    let runtimeStartedAt = 0;
    let previousBodyOverflow = '';
    let selectedExamChip = null;
    let selectedExamChipTaskId = null;
    let trainingTask = null;
    let trainingAnswer = null;
    let trainingScore = null;
    let trainingSourceTask = '';
    let singleMistakeEntry = null;
    let skipMixOnce = false;
    let reviewIssuesOnly = true;
    let returnToMistakePool = false;

    function examMistakes() {
        const stats = window.state && window.state.stats;
        if (!stats) return [];
        if (!Array.isArray(stats.mockExamMistakes)) stats.mockExamMistakes = [];
        return stats.mockExamMistakes;
    }

    function examState() {
        const stats = window.state && window.state.stats;
        if (!stats) return { active: null, history: [] };
        if (!stats.mockExams || typeof stats.mockExams !== 'object') stats.mockExams = { active: null, history: [] };
        if (!Array.isArray(stats.mockExams.history)) stats.mockExams.history = [];
        return stats.mockExams;
    }

    function saveExam() {
        if (typeof window.saveProgress === 'function') window.saveProgress();
        else if (typeof saveProgress === 'function') saveProgress();
    }

    function ensureBank() {
        const prepareBank = bank => {
            if (window.EgeScoring?.setKnownTextAnswers) {
                window.EgeScoring.setKnownTextAnswers((bank.tasks || [])
                    .filter(task => task.kim >= 8 && task.kim <= 11)
                    .flatMap(task => Array.isArray(task.acceptedAnswers) && task.acceptedAnswers.length ? task.acceptedAnswers : [task.answer]));
            }
            return bank;
        };
        if (window.EGE_EXAM_BANK) return Promise.resolve(prepareBank(window.EGE_EXAM_BANK));
        if (bankPromise) return bankPromise;
        bankPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = BANK_SRC;
            script.async = true;
            script.onload = () => window.EGE_EXAM_BANK ? resolve(prepareBank(window.EGE_EXAM_BANK)) : reject(new Error('Банк не инициализирован'));
            script.onerror = () => reject(new Error('Не удалось загрузить банк заданий'));
            document.head.appendChild(script);
        }).catch(error => { bankPromise = null; throw error; });
        return bankPromise;
    }

    function randomIndex(length) {
        if (length <= 1) return 0;
        if (window.crypto && window.crypto.getRandomValues) {
            const limit = Math.floor(0x100000000 / length) * length;
            const buf = new Uint32Array(1);
            do { window.crypto.getRandomValues(buf); } while (buf[0] >= limit);
            return buf[0] % length;
        }
        return Math.floor(Math.random() * length);
    }

    function createVariant(bank) {
        const chosen = [];
        for (let kim = 1; kim <= 8; kim++) {
            const pool = bank.tasks.filter(task => task.kim === kim);
            if (!pool.length) throw new Error(`Пустой пул задания ${kim}`);
            chosen.push(pool[randomIndex(pool.length)]);
        }
        const mapGroups = new Map();
        bank.tasks.filter(task => task.kim >= 9 && task.kim <= 12).forEach(task => {
            if (!mapGroups.has(task.groupId)) mapGroups.set(task.groupId, []);
            mapGroups.get(task.groupId).push(task);
        });
        const groups = [...mapGroups.values()].filter(group => group.length === 4);
        if (!groups.length) throw new Error('Нет полных комплектов заданий 9–12');
        chosen.push(...groups[randomIndex(groups.length)].sort((a, b) => a.kim - b.kim));
        return chosen.sort((a, b) => a.kim - b.kim);
    }

    function taskMap() {
        return new Map((window.EGE_EXAM_BANK?.tasks || []).map(task => [task.id, task]));
    }

    function tasksForRecord(record) {
        const currentBank = window.EGE_EXAM_BANK;
        if (currentBank && record?.bankVersion && record.bankVersion !== currentBank.version && Array.isArray(record.taskIds)) {
            const byId = taskMap();
            const refreshed = record.taskIds.map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.kim - b.kim);
            if (refreshed.length === 12) return refreshed;
        }
        if (Array.isArray(record?.tasks) && record.tasks.length === 12) {
            return record.tasks.slice().sort((a, b) => a.kim - b.kim);
        }
        const byId = taskMap();
        return (record?.taskIds || []).map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.kim - b.kim);
    }

    function activeTasks() {
        return tasksForRecord(examState().active);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function formatDuration(ms) {
        const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    }

    function formatDate(timestamp) {
        if (!timestamp) return '—';
        return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
    }

    function normalizedOrderedAnswer(task, value) {
        const length = window.EgeScoring.normalizeSymbols(task.answer).length;
        const arr = Array.isArray(value) ? value.slice(0, length) : window.EgeScoring.normalizeSymbols(value).slice(0, length);
        while (arr.length < length) arr.push('');
        return arr;
    }

    function isAnswered(task, value) {
        if (ORDERED_KIMS.has(task.kim)) return normalizedOrderedAnswer(task, value).every(Boolean);
        if (CHOICE_KIMS.has(task.kim)) return window.EgeScoring.normalizeSymbols(value).length > 0;
        return window.EgeScoring.normalizeTextAnswer(value).length > 0;
    }

    function answeredCount(record, tasks) {
        return tasks.filter(task => isAnswered(task, record?.answers?.[task.id])).length;
    }

    function currentElapsed() {
        const active = examState().active;
        if (!active) return 0;
        return (Number(active.elapsedMs) || 0) + (runtimeStartedAt ? Date.now() - runtimeStartedAt : 0);
    }

    function startTimer() {
        stopTimer(false);
        if (!examState().active || view !== 'work') return;
        runtimeStartedAt = Date.now();
        timerId = setInterval(updateTimer, 1000);
        updateTimer();
    }

    function stopTimer(commit) {
        if (timerId) clearInterval(timerId);
        timerId = null;
        const active = examState().active;
        if (active && runtimeStartedAt) {
            active.elapsedMs = (Number(active.elapsedMs) || 0) + (Date.now() - runtimeStartedAt);
            active.updatedAt = Date.now();
            if (commit !== false) saveExam();
        }
        runtimeStartedAt = 0;
    }

    function updateTimer() {
        const el = overlay?.querySelector('#em-timer');
        if (el) el.textContent = formatDuration(currentElapsed());
    }

    function injectStyle() {
        if (document.getElementById('em-style')) return;
        const style = document.createElement('style');
        style.id = 'em-style';
        style.textContent = `
          #exam-mode-overlay{position:fixed;inset:0;z-index:10080;background:#f9fafb;color:#1f2937;display:none;font-family:Inter,Arial,sans-serif}
          #exam-mode-overlay.em-open{display:flex;flex-direction:column}
          .dark #exam-mode-overlay{background:#121212;color:#d1d5db}
          .em-top{height:58px;flex:0 0 58px;display:flex;align-items:center;gap:10px;padding:7px 14px;background:#fff;border-bottom:1px solid #e5e7eb;box-shadow:0 2px 10px rgba(15,23,42,.05);z-index:5}
          .dark .em-top{background:#1e1e1e;border-color:#2c2c2c}
          .em-title{font-weight:950;font-size:15px;letter-spacing:.08em;text-transform:uppercase}.em-sub{font-size:10px;color:#9ca3af;font-weight:800}
          .em-back{display:flex;align-items:center;gap:6px;white-space:nowrap}.em-back-icon{font-size:17px;line-height:1}.em-back-label{font-size:10px;text-transform:uppercase;letter-spacing:.04em}
          .em-spacer{flex:1}.em-time{font-variant-numeric:tabular-nums;font-weight:950;background:#eef2ff;color:#4338ca;border-radius:12px;padding:8px 12px}
          .em-btn{border:0;border-radius:12px;padding:10px 15px;font-weight:900;cursor:pointer;background:#e5e7eb;color:#374151;transition:.15s transform,.15s background}
          .em-btn:hover{transform:translateY(-1px)}.em-btn:active{transform:scale(.97)}.em-btn.primary{background:#2563eb;color:#fff}.em-btn.finish{background:#dc2626;color:#fff}.em-btn.ghost{background:transparent}.em-btn.danger{background:#fee2e2;color:#b91c1c}
          .dark .em-btn{background:#2c2c2c;color:#e5e7eb}.dark .em-btn.danger{background:#4c1d1d;color:#fecaca}
          .em-dashboard{height:100%;overflow:auto;padding:22px 16px 55px}.em-dashboard-inner{max-width:1000px;margin:auto}.em-hero{background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:22px;box-shadow:0 4px 14px rgba(15,23,42,.05)}.dark .em-hero{background:#1e1e1e;border-color:#2c2c2c}.em-hero h2{font-size:24px;margin:0 0 8px;font-weight:1000;color:#1f2937}.dark .em-hero h2{color:#e5e7eb}.em-hero p{margin:0;max-width:720px;line-height:1.55;color:#6b7280;font-weight:700}.em-hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.em-hero .em-btn{background:#2563eb;color:#fff}.em-hero .em-btn.secondary{background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe}
          .em-card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:17px;margin-top:16px;box-shadow:0 3px 12px rgba(15,23,42,.04)}.dark .em-card{background:#1e1e1e;border-color:#2c2c2c}.em-card h3{margin:0 0 12px;font-size:16px;font-weight:950}.em-progress{height:8px;border-radius:999px;background:#e5e7eb;overflow:hidden}.em-progress span{display:block;height:100%;background:#22c55e;border-radius:inherit}.em-active-row,.em-history-row{display:flex;align-items:center;gap:12px}.em-active-info,.em-history-info{flex:1;min-width:0}.em-muted{font-size:12px;color:#6b7280;font-weight:700}.em-history-list{display:grid;gap:9px}.em-history-row{padding:12px;border-radius:14px;background:#f9fafb;border:1px solid #e5e7eb}.dark .em-history-row{background:#181818;border-color:#2c2c2c}.em-score-pill{font-size:18px;font-weight:1000;color:#2563eb;white-space:nowrap}
          .em-workspace{display:flex;flex-direction:column;height:calc(100vh - 58px);min-height:0}.em-nav{flex:0 0 auto;display:flex;gap:7px;padding:9px 14px;background:#fff;border-bottom:1px solid #e5e7eb;overflow-x:auto}.dark .em-nav{background:#1e1e1e;border-color:#2c2c2c}.em-nav-btn{width:35px;height:35px;flex:0 0 35px;border-radius:10px;border:1px solid #d1d5db;background:#fff;font-weight:950;color:#4b5563;cursor:pointer}.dark .em-nav-btn{background:#27272a;border-color:#3f3f46;color:#d1d5db}.em-nav-btn.answered,.em-nav-btn.review-full{background:#dcfce7;border-color:#86efac;color:#166534}.dark .em-nav-btn.answered,.dark .em-nav-btn.review-full{background:#143b2a;border-color:#24744d;color:#86efac}.em-nav-btn.review-part,.em-nav-btn.review-warning{background:#fef3c7;border-color:#fbbf24;color:#92400e}.dark .em-nav-btn.review-part,.dark .em-nav-btn.review-warning{background:#422006;border-color:#b45309;color:#fde68a}.em-nav-btn.review-zero{background:#fee2e2;border-color:#fca5a5;color:#b91c1c}.dark .em-nav-btn.review-zero{background:#450a0a;border-color:#991b1b;color:#fecaca}.em-nav-btn.current{background:#2563eb;border-color:#2563eb;color:#fff;box-shadow:0 0 0 3px rgba(37,99,235,.12)}.em-nav-btn.partial{box-shadow:inset 0 -3px #f59e0b}.em-review-toolbar{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb}.dark .em-review-toolbar{background:#181818;border-color:#2c2c2c}.em-review-toolbar-label{margin-left:auto;font-size:11px;font-weight:900;color:#6b7280}.em-filter-btn{border:1px solid #d1d5db;background:#fff;color:#4b5563;border-radius:999px;padding:7px 11px;font-size:11px;font-weight:900;cursor:pointer}.dark .em-filter-btn{background:#27272a;border-color:#3f3f46;color:#d1d5db}.em-filter-btn.active{background:#2563eb;border-color:#2563eb;color:#fff}
          .em-work{flex:1;min-height:0;overflow:auto;padding:14px;background:#f3f4f6}.dark .em-work{background:#121212}.em-classic-task{width:100%;max-width:1200px;min-height:100%;margin:0 auto;display:flex;align-items:stretch;gap:14px}.em-board-card,.em-pool-panel,.em-media-card,.em-answer-panel{background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 2px 8px rgba(15,23,42,.04);min-width:0}.dark .em-board-card,.dark .em-pool-panel,.dark .em-media-card,.dark .em-answer-panel{background:#1e1e1e;border-color:#2c2c2c}.em-board-card{flex:1 1 55%;overflow:auto}.em-pool-panel{flex:1 1 45%;padding:15px;display:flex;flex-direction:column}.em-panel-title{display:flex;align-items:center;gap:8px;margin:0 0 13px;padding:0 3px;font-size:14px;font-weight:1000;text-transform:uppercase;letter-spacing:.12em}.em-board-table{width:100%;border-collapse:collapse;table-layout:fixed}.em-board-table th{padding:12px 10px;background:#e5ebf2;color:#374151;font-size:13px;font-weight:950;text-align:center;border-bottom:1px solid #d1d5db}.dark .em-board-table th{background:#2c2c2c;color:#e5e7eb;border-color:#3f3f46}.em-board-table td{padding:11px 10px;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;text-align:center;font-size:13px;line-height:1.45;vertical-align:middle}.dark .em-board-table td{border-color:#2c2c2c}.em-board-table td:last-child{border-right:0}.em-board-table tr:last-child td{border-bottom:0}.em-board-label{font-weight:1000;color:#6b7280;margin-right:5px}.em-dnd-slot{width:100%;min-height:50px}.em-dnd-slot .dnd-chip{pointer-events:none}.em-options{display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:8px;overflow:auto;padding:1px 1px 10px}.em-dnd-chip{font-family:inherit;max-width:100%;white-space:normal;overflow-wrap:anywhere}.em-dnd-chip.selected{border-color:#2563eb!important;background:#eff6ff!important;box-shadow:0 0 0 3px rgba(37,99,235,.17)!important}.dark .em-dnd-chip.selected{background:#172554!important}.em-choice-chip{width:100%;display:flex;align-items:flex-start;gap:9px;text-align:left;line-height:1.4;padding:10px 11px}.em-choice-number{width:25px;height:25px;flex:0 0 25px;border-radius:7px;background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-weight:1000}.em-choice-chip.selected .em-choice-number{background:#2563eb;color:#fff}.em-panel-actions{margin-top:auto;padding-top:13px;border-top:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;gap:9px}.dark .em-panel-actions{border-color:#2c2c2c}.em-panel-progress{font-size:11px;font-weight:850;color:#9ca3af;text-align:center}.em-task-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px}.em-kim-badge{background:#dbeafe;color:#1d4ed8;padding:7px 10px;border-radius:10px;font-weight:1000}.em-points{font-size:11px;color:#6b7280;font-weight:850}
          .em-media-task{width:100%;max-width:1200px;height:100%;min-height:0;margin:0 auto;display:grid;grid-template-columns:minmax(320px,50%) minmax(0,50%);gap:14px}.em-media-card{min-height:0;padding:12px;display:flex;align-items:center;justify-content:center;background:#eef2f7}.dark .em-media-card{background:#181818}.em-media-button{width:100%;height:100%;border:0;background:transparent;padding:0;cursor:zoom-in}.em-media-card img{width:100%;height:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 5px 12px rgba(15,23,42,.15))}.em-answer-panel{min-height:0;padding:15px;display:flex;flex-direction:column}.em-panel-body{min-height:0;overflow:auto;padding:1px 2px 12px}.em-fipi{font-size:15px;line-height:1.55;color:#1f2937}.dark .em-fipi{color:#e5e7eb}.em-fipi table{border-collapse:collapse;max-width:100%!important;width:auto}.em-fipi td,.em-fipi th{padding:4px 6px;vertical-align:top}.em-fipi table[border] td,.em-fipi table[border] th{border:1px solid #9ca3af}.em-fipi p{margin:0 0 9px}.em-fipi img{max-width:100%;height:auto}.em-text-input{width:100%;border:2px solid #cbd5e1;border-radius:14px;padding:13px 14px;font-size:17px;font-weight:750;outline:none;background:#fff;color:#1f2937}.em-text-input:focus{border-color:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.1)}.dark .em-text-input{background:#27272a;border-color:#52525b;color:#fff}.em-clear-note{font-size:11px;color:#6b7280;margin-top:8px}.em-answer-box{margin-top:15px;padding:14px;border-radius:15px;background:#f9fafb;border:1px solid #e5e7eb}.dark .em-answer-box{background:#181818;border-color:#2c2c2c}.em-answer-title{font-size:11px;text-transform:uppercase;letter-spacing:.1em;font-weight:950;color:#6b7280;margin-bottom:10px}
          .em-result{height:100%;overflow:auto;padding:22px 16px 60px}.em-result-inner{max-width:900px;margin:auto}.em-result-score{text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:20px;padding:22px;box-shadow:0 3px 12px rgba(15,23,42,.04)}.dark .em-result-score{background:#1e1e1e;border-color:#2c2c2c}.em-result-number{font-size:60px;font-weight:1000;letter-spacing:-.05em;color:#2563eb}.em-result-number span{font-size:25px;color:#6b7280}.em-result-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:15px}.em-result-overview{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:13px}.em-overview-pill{padding:7px 11px;border-radius:999px;font-size:11px;font-weight:950}.em-overview-pill.issue{background:#fee2e2;color:#b91c1c}.em-overview-pill.ok{background:#dcfce7;color:#166534}.dark .em-overview-pill.issue{background:#450a0a;color:#fecaca}.dark .em-overview-pill.ok{background:#052e16;color:#bbf7d0}.em-result-notice{margin:15px auto 0;max-width:680px;padding:12px 14px;border-radius:14px;background:#fffbeb;border:1px solid #fbbf24;color:#92400e;text-align:left;font-size:13px;font-weight:750;line-height:1.45}.dark .em-result-notice{background:#422006;border-color:#b45309;color:#fde68a}.em-breakdown{display:grid;gap:7px;margin-top:15px}.em-break-row{display:grid;grid-template-columns:56px 1fr 80px;align-items:center;gap:10px;padding:11px 13px;border-radius:13px;background:#f9fafb;border:1px solid #e5e7eb}.dark .em-break-row{background:#181818;border-color:#2c2c2c}.em-break-button{width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}.em-break-button:hover{border-color:#93c5fd;background:#eff6ff;transform:translateY(-1px)}.dark .em-break-button:hover{background:#172554;border-color:#3b82f6}.em-break-score{text-align:right;font-weight:1000}.em-break-score.full{color:#15803d}.em-break-score.part{color:#d97706}.em-break-score.zero{color:#dc2626}.em-correct-details{margin-top:14px;border-top:1px solid #e5e7eb;padding-top:12px}.dark .em-correct-details{border-color:#2c2c2c}.em-correct-details summary{cursor:pointer;font-size:13px;font-weight:950;color:#166534}.dark .em-correct-details summary{color:#86efac}
          .em-review-answer{margin-top:12px;border-radius:13px;padding:12px;background:#f3f4f6;border-left:4px solid #2563eb;font-size:13px}.dark .em-review-answer{background:#181818}.em-review-status{margin-bottom:11px;padding:9px 11px;border-radius:11px;font-size:12px;font-weight:1000}.em-review-status.full{background:#dcfce7;color:#166534}.em-review-status.part,.em-review-status.warning{background:#fef3c7;color:#92400e}.em-review-status.zero{background:#fee2e2;color:#b91c1c}.dark .em-review-status.full{background:#052e16;color:#bbf7d0}.dark .em-review-status.part,.dark .em-review-status.warning{background:#422006;color:#fde68a}.dark .em-review-status.zero{background:#450a0a;color:#fecaca}.em-review-line+ .em-review-line{margin-top:10px}.em-review-label{display:block;font-size:10px;font-weight:1000;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:4px}.em-answer-detail{line-height:1.5;font-weight:700}.em-review-points{font-weight:1000;margin-top:10px}.em-exam-warning{margin-top:11px;padding:11px 12px;border-radius:12px;background:#fffbeb;border:1px solid #fbbf24;color:#92400e;font-size:12px;font-weight:750;line-height:1.45}.dark .em-exam-warning{background:#422006;border-color:#b45309;color:#fde68a}.em-warning-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.em-warning-tag{padding:3px 7px;border-radius:999px;background:#fef3c7;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.05em}.dark .em-warning-tag{background:#78350f}.em-zoom{position:fixed;inset:0;z-index:10120;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;padding:16px}.em-zoom img{max-width:100%;max-height:100%;object-fit:contain}.em-zoom button{position:absolute;right:16px;top:16px;border:0;background:#fff;color:#111;width:44px;height:44px;border-radius:50%;font-size:22px;font-weight:1000;cursor:pointer}
          .em-review-value{display:block;padding:8px 10px;border-radius:10px;border:1px solid transparent}.em-review-value+ .em-review-value{margin-top:5px}.em-review-value.wrong{background:#fef2f2;border-color:#fca5a5;color:#b91c1c}.em-review-value.correct{background:#f0fdf4;border-color:#86efac;color:#166534}.dark .em-review-value.wrong{background:#450a0a;border-color:#991b1b;color:#fecaca}.dark .em-review-value.correct{background:#052e16;border-color:#166534;color:#bbf7d0}.em-dnd-slot.review-wrong{background:#fef2f2!important;border-color:#ef4444!important;box-shadow:0 0 0 3px rgba(239,68,68,.12)}.em-dnd-slot.review-wrong .dnd-chip{background:#fee2e2!important;border-color:#ef4444!important;color:#b91c1c!important}.em-dnd-slot.review-correct{background:#f0fdf4!important;border-color:#22c55e!important}.dark .em-dnd-slot.review-wrong{background:#450a0a!important}.dark .em-dnd-slot.review-correct{background:#052e16!important}
          .em-zoom{padding:0;display:block;overflow:hidden;touch-action:none;user-select:none}.em-zoom-stage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:grab}.em-zoom-stage.is-dragging{cursor:grabbing}.em-zoom-canvas{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}.em-zoom-canvas img{display:block;max-width:none;max-height:none;pointer-events:none;filter:drop-shadow(0 10px 28px rgba(0,0,0,.45))}.em-zoom-toolbar{position:absolute;z-index:3;right:14px;top:max(14px,env(safe-area-inset-top));display:flex;gap:8px}.em-zoom-toolbar button{position:static;width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.94);color:#111;font-size:21px;font-weight:1000;box-shadow:0 6px 20px rgba(0,0,0,.25)}.em-zoom-toolbar .em-zoom-close{margin-left:5px}.em-zoom-hint{position:absolute;z-index:2;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:8px 12px;border-radius:999px;background:rgba(15,23,42,.78);color:#fff;font-size:11px;font-weight:850;white-space:nowrap;pointer-events:none;transition:opacity .25s}.em-zoom-hint.hidden{opacity:0}.em-media-button{position:relative}.em-media-button::after{content:'Нажмите, чтобы увеличить';position:absolute;left:50%;bottom:7px;transform:translateX(-50%);padding:6px 9px;border-radius:999px;background:rgba(15,23,42,.72);color:#fff;font-size:10px;font-weight:850;white-space:nowrap;opacity:.82;pointer-events:none}
          @media(min-width:1000px){.em-dashboard-inner{max-width:1160px}.em-work{padding:18px 24px 24px}.em-classic-task{max-width:1380px;min-height:0;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,.65fr);align-items:start;gap:18px}.em-board-card{width:100%}.em-pool-panel{width:100%;align-self:start;max-height:calc(100vh - 154px);overflow:auto;padding:18px;position:sticky;top:0}.em-pool-panel .em-panel-actions{margin-top:18px}.em-media-task{max-width:1440px;grid-template-columns:minmax(0,1.45fr) minmax(390px,.85fr);gap:18px}.em-media-card{min-height:calc(100vh - 154px);padding:16px}.em-answer-panel{max-height:calc(100vh - 154px);padding:18px}.em-fipi{font-size:16px;line-height:1.62}.em-top{padding-left:22px;padding-right:22px}.em-nav{padding-left:22px;padding-right:22px}}
          @media(max-width:760px){.em-top{padding:7px 9px;gap:6px}.em-title{font-size:12px}.em-sub{display:none}.em-top .em-btn{padding:9px 10px}.em-back-label{display:none}.em-time{padding:7px 9px;font-size:12px}.em-nav{padding:8px}.em-nav-btn{width:33px;height:33px;flex-basis:33px}.em-review-toolbar{padding:7px 8px;gap:6px}.em-filter-btn{padding:6px 8px;font-size:10px}.em-review-toolbar-label{font-size:10px}.em-work{padding:8px}.em-classic-task{min-height:auto;display:flex;flex-direction:column;gap:8px}.em-board-card,.em-pool-panel{flex:none}.em-board-table th{padding:9px 6px;font-size:11px}.em-board-table td{padding:7px 5px;font-size:11px}.em-dnd-slot{min-height:43px}.em-pool-panel{padding:11px}.em-panel-title{font-size:12px;margin-bottom:10px}.em-media-task{grid-template-columns:1fr;grid-template-rows:minmax(190px,38vh) minmax(0,1fr);gap:8px}.em-work.has-fixed-media{overflow:hidden}.em-media-card{padding:7px}.em-answer-panel{padding:11px}.em-fipi{font-size:14px}.em-panel-actions{padding-top:9px}.em-panel-progress{display:none}.em-hero{padding:18px}.em-hero h2{font-size:21px}.em-dashboard{padding:14px 10px 45px}.em-active-row,.em-history-row{align-items:flex-start;flex-wrap:wrap}.em-active-info,.em-history-info{flex-basis:100%}.em-result-number{font-size:50px}.em-break-row{grid-template-columns:50px minmax(0,1fr) 60px;padding:10px 9px;gap:7px}}
        `;
        document.head.appendChild(style);
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        injectStyle();
        overlay = document.createElement('div');
        overlay.id = 'exam-mode-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = '<div class="em-dashboard"><div class="em-dashboard-inner"><div class="em-card">Загружаем банк заданий…</div></div></div>';
        overlay.addEventListener('click', handleClick);
        overlay.addEventListener('input', handleInput);
        document.body.appendChild(overlay);
        return overlay;
    }

    function topBar(title, subtitle, showFinish) {
        const back = view === 'dashboard' ? { action: 'close', label: 'Выйти' }
            : view === 'work' ? { action: 'dashboard', label: 'К пробникам' }
            : view === 'result' ? { action: 'dashboard', label: 'К истории' }
            : view === 'review' ? { action: returnToMistakePool ? 'back-error-pool' : 'result', label: returnToMistakePool ? 'К ошибкам' : 'К итогу' }
            : view === 'mistake-review' ? { action: 'back-error-pool', label: 'К ошибкам' }
            : { action: 'close', label: 'Назад' };
        return `<div class="em-top">
          <button class="em-btn ghost em-back" data-em-action="${back.action}" aria-label="${back.label}" title="${back.label}"><span class="em-back-icon">←</span><span class="em-back-label">${back.label}</span></button>
          <div><div class="em-title">${title}</div><div class="em-sub">${subtitle || ''}</div></div>
          <div class="em-spacer"></div>
          ${view === 'work' ? '<div class="em-time" id="em-timer">0:00</div>' : ''}
          ${showFinish ? '<button class="em-btn finish" data-em-action="finish">Сдать</button>' : ''}
        </div>`;
    }

    function renderDashboard() {
        stopTimer(true);
        view = 'dashboard';
        const state = examState();
        const errorCount = examMistakes().length;
        const tasks = tasksForRecord(state.active);
        const done = state.active ? answeredCount(state.active, tasks) : 0;
        const activeHtml = state.active ? `<div class="em-card">
          <h3>Незавершённый пробник</h3>
          <div class="em-active-row"><div class="em-active-info">
            <div style="font-weight:950;margin-bottom:7px">Выполнено ${done} из 12</div>
            <div class="em-progress"><span style="width:${Math.round(done / 12 * 100)}%"></span></div>
            <div class="em-muted" style="margin-top:7px">Начат ${formatDate(state.active.startedAt)} · ${formatDuration(state.active.elapsedMs)}</div>
          </div><button class="em-btn primary" data-em-action="resume">Продолжить</button><button class="em-btn danger" data-em-action="discard">Удалить</button></div>
        </div>` : '';
        const history = state.history.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
        const historyHtml = history.length ? `<div class="em-card"><h3>Результаты пробников</h3><div class="em-history-list">${history.slice(0, 20).map(item => `
          <div class="em-history-row"><div class="em-history-info"><div style="font-weight:900">${formatDate(item.completedAt)}</div><div class="em-muted">${formatDuration(item.durationMs)} · ответы сохранены</div></div><div class="em-score-pill">${item.score}/20</div><button class="em-btn" data-em-action="open-history" data-id="${item.id}">Открыть</button></div>`).join('')}</div></div>` : '<div class="em-card"><h3>Результаты пробников</h3><div class="em-muted">Здесь появятся завершённые попытки.</div></div>';
        overlay.innerHTML = topBar('Пробник ЕГЭ', 'Тестовая часть · задания 1–12 · максимум 20 первичных баллов', false) + `
          <div class="em-dashboard"><div class="em-dashboard-inner">
            <div class="em-hero"><h2>Честный пробник 1–12</h2><p>По одному случайному заданию каждого типа. Задания 9–12 берутся единым блоком к одной карте. Правильные ответы появятся только после сдачи.</p><div class="em-hero-actions"><button class="em-btn" data-em-action="new">${state.active ? 'Начать заново' : 'Начать пробник'}</button>${state.active ? '<button class="em-btn secondary" data-em-action="resume">Продолжить текущий</button>' : ''}${errorCount ? `<button class="em-btn secondary" data-em-action="open-error-pool">Ошибки пробников · ${errorCount}</button>` : ''}</div></div>
            ${activeHtml}${historyHtml}
          </div></div>`;
    }

    function beginNewAttempt() {
        const state = examState();
        if (state.active && !window.confirm('Удалить незавершённый пробник и создать новый?')) return;
        const tasks = createVariant(window.EGE_EXAM_BANK);
        const now = Date.now();
        const idPart = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`;
        state.active = {
            id: `mock-${idPart}`,
            bankVersion: window.EGE_EXAM_BANK.version,
            taskIds: tasks.map(task => task.id),
            tasks: clone(tasks),
            mapGroupId: tasks.find(task => task.kim === 9)?.groupId || '',
            answers: {},
            current: 0,
            startedAt: now,
            updatedAt: now,
            elapsedMs: 0
        };
        currentIndex = 0;
        view = 'work';
        saveExam();
        renderWork();
        startTimer();
    }

    function resumeAttempt() {
        const active = examState().active;
        if (!active) return renderDashboard();
        const tasks = activeTasks();
        if (tasks.length !== 12) {
            window.alert('Сохранённый пробник относится к старой версии банка и не может быть продолжен. Создайте новый.');
            return renderDashboard();
        }
        currentIndex = Math.max(0, Math.min(11, Number(active.current) || 0));
        view = 'work';
        renderWork();
        startTimer();
    }

    function navHtml(tasks, record) {
        return `<div class="em-nav">${tasks.map((task, index) => {
            const value = record?.answers?.[task.id];
            const some = ORDERED_KIMS.has(task.kim)
                ? normalizedOrderedAnswer(task, value).some(Boolean)
                : (CHOICE_KIMS.has(task.kim) ? window.EgeScoring.normalizeSymbols(value).length > 0 : window.EgeScoring.normalizeTextAnswer(value).length > 0);
            const full = isAnswered(task, value);
            return `<button class="em-nav-btn ${full ? 'answered' : some ? 'partial' : ''} ${index === currentIndex ? 'current' : ''}" data-em-action="nav" data-index="${index}">${task.kim}</button>`;
        }).join('')}</div>`;
    }

    function scoreForTask(record, task) {
        return record?.scoreByKim?.[task.kim] || window.EgeScoring.scoreTask(task, record?.answers?.[task.id]);
    }

    function reviewIssueIndices(record, tasks) {
        return (tasks || tasksForRecord(record)).map((task, index) => ({ index, result: scoreForTask(record, task) }))
            .filter(item => item.result.points < item.result.max || item.result.acceptedWithWarning)
            .map(item => item.index);
    }

    function currentReviewSequence(record, tasks) {
        const all = (tasks || tasksForRecord(record)).map((_, index) => index);
        const issues = reviewIssueIndices(record, tasks);
        return reviewIssuesOnly && issues.length ? issues : all;
    }

    function reviewNavHtml(tasks, record) {
        const issues = reviewIssueIndices(record, tasks);
        const sequence = currentReviewSequence(record, tasks);
        const sequencePosition = Math.max(0, sequence.indexOf(currentIndex));
        const label = reviewIssuesOnly && issues.length
            ? `Ошибка ${sequencePosition + 1} из ${sequence.length}`
            : `Задание ${currentIndex + 1} из ${tasks.length}`;
        const nav = `<div class="em-nav">${tasks.map((task, index) => {
            const result = scoreForTask(record, task);
            const cls = result.acceptedWithWarning ? 'review-warning' : result.points === result.max ? 'review-full' : result.points > 0 ? 'review-part' : 'review-zero';
            return `<button class="em-nav-btn ${cls} ${index === currentIndex ? 'current' : ''}" data-em-action="nav" data-index="${index}" aria-label="Задание ${task.kim}: ${result.points} из ${result.max}">${task.kim}</button>`;
        }).join('')}</div>`;
        return nav + `<div class="em-review-toolbar"><button class="em-filter-btn ${reviewIssuesOnly && issues.length ? 'active' : ''}" data-em-action="review-filter" data-filter="issues" ${issues.length ? '' : 'disabled'}>Ошибки · ${issues.length}</button><button class="em-filter-btn ${!reviewIssuesOnly || !issues.length ? 'active' : ''}" data-em-action="review-filter" data-filter="all">Все 12</button><span class="em-review-toolbar-label">${label}</span></div>`;
    }

    function escapeAttr(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const EXAM_LETTERS = 'АБВГДЕЖЗИКЛМНОП'.split('');

    function optionForDigit(task, digit) {
        return (task.elements || []).find(item => String(item.n) === String(digit));
    }

    function optionText(task, digit) {
        return optionForDigit(task, digit)?.text || String(digit || '');
    }

    function taskTemplate(task) {
        const template = document.createElement('template');
        template.innerHTML = task.html || '';
        return template;
    }

    function cleanText(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function matchingTargets(task) {
        const template = taskTemplate(task);
        const found = new Map();
        template.content.querySelectorAll('b').forEach(labelNode => {
            const match = cleanText(labelNode.textContent).match(/^([А-З])\)$/);
            if (!match || found.has(match[1])) return;
            const labelCell = labelNode.closest('td');
            const row = labelCell?.parentElement;
            if (!labelCell || !row) return;
            const cells = Array.from(row.children).filter(node => node.tagName === 'TD');
            const labelIndex = cells.indexOf(labelCell);
            const valueCell = cells.slice(labelIndex + 1).find(cell => cleanText(cell.textContent));
            const text = cleanText(valueCell?.textContent);
            if (text) found.set(match[1], text);
        });
        return [...found.entries()]
            .sort((a, b) => EXAM_LETTERS.indexOf(a[0]) - EXAM_LETTERS.indexOf(b[0]))
            .map(([label, text]) => ({ label, text }));
    }

    function task4Structure(task) {
        const template = taskTemplate(task);
        const table = Array.from(template.content.querySelectorAll('table')).find(candidate => {
            const text = cleanText(candidate.textContent).toLocaleLowerCase('ru-RU');
            const wideRows = Array.from(candidate.rows || []).filter(row => row.cells && row.cells.length >= 3);
            return wideRows.length >= 2 && text.includes('географический объект') && text.includes('событие') && text.includes('время');
        });
        if (!table) return null;
        const rows = Array.from(table.rows || []).filter(row => row.cells && row.cells.length >= 3);
        if (rows.length < 2) return null;
        const dataRows = rows.slice(1).map(row => Array.from(row.cells).slice(0, 3).map(cell => {
            const text = cleanText(cell.textContent);
            const marker = text.match(/_+\s*\(([А-З])\)/) || text.match(/^\(([А-З])\)$/);
            return marker ? { slotIndex: EXAM_LETTERS.indexOf(marker[1]), label: marker[1] } : { html: cell.innerHTML, text };
        }));
        return dataRows.length ? dataRows : null;
    }

    function slotHtml(task, slots, index, readonly, label) {
        const digit = slots[index] || '';
        const content = digit ? `<span class="dnd-chip em-dnd-chip in-slot">${escapeAttr(optionText(task, digit))}</span>` : '';
        const action = readonly ? '' : `data-em-action="slot" data-index="${index}"`;
        const expected = window.EgeScoring.normalizeSymbols(task.answer)[index] || '';
        const reviewClass = readonly ? (digit && digit === expected ? 'review-correct' : 'review-wrong') : '';
        return `<div class="dnd-slot em-dnd-slot ${digit ? 'has-item' : ''} ${reviewClass} ${selectedExamChip && selectedExamChipTaskId === task.id && !readonly ? 'slot-ready' : ''}" data-letter="${escapeAttr(label || EXAM_LETTERS[index] || String(index + 1))}" ${action}>${content}</div>`;
    }

    function orderedHeaders(kim) {
        return {
            1: ['События', 'Годы'],
            2: ['Позиция', 'Событие'],
            3: ['Процессы (явления, события)', 'Факты'],
            5: ['События', 'Участники'],
            7: ['Памятники культуры', 'Характеристики']
        }[kim] || ['Позиция', 'Ответ'];
    }

    function orderedBoardHtml(task, slots, readonly) {
        if (task.kim === 4) {
            const rows = task4Structure(task);
            if (rows) return `<table class="em-board-table"><thead><tr><th>🗺️ Объект</th><th>📜 Событие</th><th>⏳ Дата</th></tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${Number.isInteger(cell.slotIndex) && cell.slotIndex >= 0 ? slotHtml(task, slots, cell.slotIndex, readonly, cell.label) : cell.html}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
        }

        const headers = orderedHeaders(task.kim);
        const count = window.EgeScoring.normalizeSymbols(task.answer).length;
        const targets = task.kim === 2
            ? Array.from({ length: count }, (_, index) => ({ label: String(index + 1), text: `${index + 1}-е место` }))
            : matchingTargets(task).slice(0, count);
        while (targets.length < count) targets.push({ label: EXAM_LETTERS[targets.length] || String(targets.length + 1), text: `Позиция ${EXAM_LETTERS[targets.length] || targets.length + 1}` });
        return `<table class="em-board-table"><thead><tr><th>${headers[0]}</th><th>${headers[1]}</th></tr></thead><tbody>${targets.map((target, index) => `<tr><td><span class="em-board-label">${escapeAttr(target.label)}${task.kim === 2 ? '' : ')'}</span>${task.kim === 2 ? '' : escapeAttr(target.text)}</td><td>${slotHtml(task, slots, index, readonly, task.kim === 2 ? String(index + 1) : target.label)}</td></tr>`).join('')}</tbody></table>`;
    }

    function orderedPoolHtml(task, slots, readonly) {
        const used = new Set(slots.filter(Boolean));
        const items = (task.elements || []).filter(item => readonly || !used.has(String(item.n)));
        return `<div class="em-options">${items.map(item => {
            const digit = String(item.n);
            const selected = !readonly && selectedExamChipTaskId === task.id && selectedExamChip === digit;
            return `<button class="dnd-chip em-dnd-chip ${selected ? 'selected' : ''}" ${readonly ? 'disabled' : `data-em-action="chip" data-value="${digit}"`}>${escapeAttr(item.text)}</button>`;
        }).join('') || '<div class="em-muted">Все варианты расставлены.</div>'}</div>`;
    }

    function detailedAnswerHtml(task, value, asCorrect) {
        if (ORDERED_KIMS.has(task.kim)) {
            const slots = normalizedOrderedAnswer(task, value);
            const expected = window.EgeScoring.normalizeSymbols(task.answer);
            return slots.map((digit, index) => {
                const label = task.kim === 2 ? `${index + 1}-е место` : `${EXAM_LETTERS[index] || index + 1}`;
                const cls = digit && digit === expected[index] ? 'correct' : 'wrong';
                return `<div class="em-review-value ${cls}"><b>${escapeAttr(label)}:</b> ${digit ? escapeAttr(optionText(task, digit)) : '<span>нет ответа</span>'}</div>`;
            }).join('');
        }
        if (CHOICE_KIMS.has(task.kim)) {
            const symbols = window.EgeScoring.normalizeSymbols(value).sort();
            const expected = new Set(window.EgeScoring.normalizeSymbols(task.answer));
            if (!symbols.length) return '<span class="em-review-value wrong">Нет ответа</span>';
            return symbols.map(digit => `<div class="em-review-value ${expected.has(digit) ? 'correct' : 'wrong'}"><b>${escapeAttr(digit)})</b> ${escapeAttr(optionText(task, digit))}</div>`).join('');
        }
        const text = window.EgeScoring.normalizeTextAnswer(value);
        const score = window.EgeScoring.scoreTask(task, value);
        return text
            ? `<span class="em-review-value ${asCorrect || (score.points === score.max && !score.acceptedWithWarning) ? 'correct' : 'wrong'}">${escapeAttr(String(value).trim())}</span>`
            : '<span class="em-review-value wrong">Нет ответа</span>';
    }

    function reviewSummary(task, value, scoreResult) {
        if (!scoreResult) return '';
        const warningKinds = Array.isArray(scoreResult.warningKinds) ? scoreResult.warningKinds : [];
        const warningLabels = { typo: 'Опечатка', spacing: 'Пробелы или знаки', case: 'Регистр', normalized: 'Форма записи' };
        const warning = scoreResult.acceptedWithWarning ? `<div class="em-exam-warning"><b>⚠️ Балл засчитан в учебном режиме.</b><br>На реальном ЕГЭ ответ нужно записать без опечаток, пробелов и лишних знаков, печатными заглавными буквами по образцу бланка №1.<div class="em-warning-tags">${warningKinds.map(kind => `<span class="em-warning-tag">${warningLabels[kind] || 'Форма записи'}</span>`).join('')}</div></div>` : '';
        const statusClass = scoreResult.acceptedWithWarning ? 'warning' : scoreResult.points === scoreResult.max ? 'full' : scoreResult.points > 0 ? 'part' : 'zero';
        const statusText = scoreResult.acceptedWithWarning ? '⚠️ Балл засчитан, но запись нужно исправить' : scoreResult.points === scoreResult.max ? '✓ Верно' : scoreResult.points > 0 ? '◐ Частично верно' : '✕ Ошибка';
        return `<div class="em-review-answer"><div class="em-review-status ${statusClass}">${statusText}</div><div class="em-review-line"><span class="em-review-label">Ваш ответ</span><div class="em-answer-detail">${detailedAnswerHtml(task, value, false)}</div></div><div class="em-review-line"><span class="em-review-label">Правильный ответ</span><div class="em-answer-detail">${detailedAnswerHtml(task, task.answer, true)}</div></div><div class="em-review-points">Баллы: ${scoreResult.points || 0} из ${scoreResult.max || window.EgeScoring.maxPoints(task.kim)}</div>${warning}</div>`;
    }

    function plainAnswerText(task, value) {
        if (ORDERED_KIMS.has(task.kim)) {
            return normalizedOrderedAnswer(task, value).map((digit, index) => {
                const label = task.kim === 2 ? String(index + 1) : (EXAM_LETTERS[index] || String(index + 1));
                return `${label}: ${digit ? optionText(task, digit) : 'нет ответа'}`;
            }).join(' · ');
        }
        if (CHOICE_KIMS.has(task.kim)) {
            const symbols = window.EgeScoring.normalizeSymbols(value).sort();
            return symbols.length ? symbols.map(digit => `${digit}) ${optionText(task, digit)}`).join(' · ') : 'Нет ответа';
        }
        return String(value || '').trim() || 'Нет ответа';
    }

    function recordExamMistake(task, value, scoreResult, meta) {
        if (!task || !scoreResult || (scoreResult.points === scoreResult.max && !scoreResult.acceptedWithWarning)) return null;
        meta = meta || {};
        const now = Number(meta.createdAt) || Date.now();
        const id = meta.id || `fipi-error-${window.crypto?.randomUUID ? window.crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`}`;
        const entry = {
            id,
            source: meta.source || 'mock-exam',
            attemptId: meta.attemptId || '',
            taskId: task.id,
            kim: task.kim,
            createdAt: now,
            condition: cleanText(taskTemplate(task).content.textContent).slice(0, 360),
            answer: clone(value == null ? '' : value),
            answerText: plainAnswerText(task, value),
            correctText: plainAnswerText(task, task.answer),
            points: scoreResult.points || 0,
            max: scoreResult.max || window.EgeScoring.maxPoints(task.kim),
            acceptedWithWarning: Boolean(scoreResult.acceptedWithWarning),
            warningKinds: Array.isArray(scoreResult.warningKinds) ? scoreResult.warningKinds.slice() : []
        };
        const list = examMistakes();
        const next = list.filter(item => item && item.id !== id);
        next.push(entry);
        window.state.stats.mockExamMistakes = next.slice(-1000);
        return entry;
    }

    function panelActions(readonly, task, scoreResult) {
        if (readonly && view === 'training-result') return `<div class="em-panel-actions"><div class="em-panel-progress">${scoreResult.points}/${scoreResult.max} балла</div><button class="em-btn primary" data-em-action="training-next">Дальше →</button></div>`;
        if (readonly && view === 'mistake-review') return `<div class="em-panel-actions"><div class="em-panel-progress">Ошибка из общей истории</div><button class="em-btn primary" data-em-action="back-error-pool">К списку ошибок</button></div>`;
        if (readonly) {
            const record = reviewRecord || resultRecord;
            const tasks = tasksForRecord(record);
            const sequence = currentReviewSequence(record, tasks);
            const position = Math.max(0, sequence.indexOf(currentIndex));
            const previous = position > 0 ? sequence[position - 1] : null;
            const next = position < sequence.length - 1 ? sequence[position + 1] : null;
            const center = reviewIssuesOnly && reviewIssueIndices(record, tasks).length ? `Ошибка ${position + 1} из ${sequence.length}` : `Задание ${task.kim} · ${scoreResult.points}/${scoreResult.max}`;
            const finalAction = returnToMistakePool ? 'back-error-pool' : 'result';
            const finalLabel = returnToMistakePool ? 'К ошибкам' : 'К результату';
            return `<div class="em-panel-actions"><button class="em-btn" data-em-action="review-go" data-index="${previous == null ? '' : previous}" ${previous == null ? 'disabled' : ''}>← Назад</button><div class="em-panel-progress">${center}</div><button class="em-btn primary" data-em-action="${next == null ? finalAction : 'review-go'}" ${next == null ? '' : `data-index="${next}"`}>${next == null ? finalLabel : 'Следующая →'}</button></div>`;
        }
        if (view === 'training') return `<div class="em-panel-actions"><div class="em-panel-progress">Цельное задание из открытого банка</div><button class="em-btn primary" data-em-action="training-check">Проверить ответ</button></div>`;
        const active = examState().active;
        const tasks = activeTasks();
        return `<div class="em-panel-actions"><button class="em-btn" data-em-action="prev" ${currentIndex === 0 ? 'disabled' : ''}>← Назад</button><div class="em-panel-progress">${answeredCount(active, tasks)} из 12 отвечено</div><button class="em-btn primary" data-em-action="${currentIndex === 11 ? 'finish' : 'next'}">${currentIndex === 11 ? 'Сдать пробник' : 'Далее →'}</button></div>`;
    }

    function taskHeading(task) {
        const max = window.EgeScoring.maxPoints(task.kim);
        return `<div class="em-task-heading"><span class="em-kim-badge">Задание ${task.kim}</span><span class="em-points">максимум ${max} ${max === 1 ? 'балл' : 'балла'}</span></div>`;
    }

    function renderOrderedTask(task, value, readonly, scoreResult) {
        const slots = normalizedOrderedAnswer(task, value);
        const panel = readonly
            ? `<h3 class="em-panel-title"><span>🔎</span> Работа над ошибками</h3>${reviewSummary(task, value, scoreResult)}`
            : `<h3 class="em-panel-title"><span>🧩</span> Варианты</h3>${orderedPoolHtml(task, slots, false)}`;
        return `<div class="em-classic-task"><section class="em-board-card">${orderedBoardHtml(task, slots, readonly)}</section><aside class="em-pool-panel">${panel}${panelActions(readonly, task, scoreResult)}</aside></div>`;
    }

    function choiceOptionsHtml(task, value, readonly) {
        const selected = new Set(window.EgeScoring.normalizeSymbols(value));
        return `<div class="em-options">${(task.elements || []).map(item => {
            const digit = String(item.n);
            return `<button class="dnd-chip em-dnd-chip em-choice-chip ${selected.has(digit) ? 'selected' : ''}" ${readonly ? 'disabled' : `data-em-action="choice" data-value="${digit}"`}><span class="em-choice-number">${digit}</span><span>${escapeAttr(item.text)}</span></button>`;
        }).join('')}</div>`;
    }

    function textAnswerHtml(task, value, readonly) {
        return `<div class="em-answer-box"><div class="em-answer-title">Ваш ответ</div><input class="em-text-input" data-task-id="${task.id}" value="${escapeAttr(String(value || ''))}" ${readonly ? 'disabled' : ''} autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="Введите слово или словосочетание"><div class="em-clear-note">Пробелы, регистр и Е/Ё не влияют на балл. Небольшую опечатку учебный режим тоже засчитает, но после сдачи предупредит о правилах ЕГЭ.</div></div>`;
    }

    function renderClassicQuestionTask(task, value, readonly, scoreResult) {
        const panel = readonly
            ? `<h3 class="em-panel-title"><span>🔎</span> Работа над ошибками</h3>${reviewSummary(task, value, scoreResult)}`
            : `<h3 class="em-panel-title"><span>${CHOICE_KIMS.has(task.kim) ? '🧩' : '✍️'}</span> ${CHOICE_KIMS.has(task.kim) ? 'Варианты' : 'Ответ'}</h3>${CHOICE_KIMS.has(task.kim) ? choiceOptionsHtml(task, value, false) : textAnswerHtml(task, value, false)}`;
        return `<div class="em-classic-task"><section class="em-board-card" style="padding:15px"><div class="em-panel-body">${taskHeading(task)}<div class="em-fipi">${task.html}</div></div></section><aside class="em-pool-panel">${panel}${panelActions(readonly, task, scoreResult)}</aside></div>`;
    }

    function renderMediaTask(task, value, readonly, scoreResult) {
        const answer = readonly
            ? reviewSummary(task, value, scoreResult)
            : CHOICE_KIMS.has(task.kim) ? choiceOptionsHtml(task, value, false) : textAnswerHtml(task, value, false);
        const alt = task.kim >= 9 ? 'Карта к заданиям 9–12' : 'Изображение к заданию';
        return `<div class="em-media-task"><section class="em-media-card"><button class="em-media-button" data-em-action="zoom" data-src="${escapeAttr(task.image)}" aria-label="Увеличить изображение"><img src="${escapeAttr(task.image)}" alt="${alt}"></button></section><aside class="em-answer-panel"><div class="em-panel-body">${taskHeading(task)}<div class="em-fipi">${task.html}</div>${readonly ? '<h3 class="em-panel-title"><span>🔎</span> Работа над ошибками</h3>' : ''}${answer}</div>${panelActions(readonly, task, scoreResult)}</aside></div>`;
    }

    function questionHtml(task, value, readonly, scoreResult) {
        if (ORDERED_KIMS.has(task.kim)) return renderOrderedTask(task, value, readonly, scoreResult);
        if (task.image) return renderMediaTask(task, value, readonly, scoreResult);
        return renderClassicQuestionTask(task, value, readonly, scoreResult);
    }

    function renderTraining() {
        if (!trainingTask) return closeTrainingTask();
        const readonly = view === 'training-result' || view === 'mistake-review';
        const subtitle = view === 'mistake-review' ? 'Сохранённая ошибка из пробника' : 'Открытый банк ФИПИ · цельное задание в обычной тренировке';
        overlay.innerHTML = topBar(`${TASK_ICONS[trainingTask.kim] || '📝'} Задание ФИПИ №${trainingTask.kim}`, subtitle, false)
            + `<div class="em-workspace"><div class="em-work ${trainingTask.image ? 'has-fixed-media' : ''}">${questionHtml(trainingTask, trainingAnswer, readonly, trainingScore)}</div></div>`;
    }

    function closeTrainingTask() {
        const shouldContinue = view === 'training' || view === 'training-result';
        trainingTask = null;
        trainingAnswer = null;
        trainingScore = null;
        trainingSourceTask = '';
        singleMistakeEntry = null;
        if (overlay) overlay.classList.remove('em-open');
        document.body.style.overflow = previousBodyOverflow;
        if (shouldContinue) {
            skipMixOnce = true;
            setTimeout(() => window.generateTable?.(), 0);
        }
    }

    async function openTrainingTask(taskKey, taskId) {
        ensureOverlay();
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        overlay.classList.add('em-open');
        returnToMistakePool = false;
        overlay.innerHTML = '<div class="em-dashboard"><div class="em-dashboard-inner"><div class="em-card">Загружаем цельное задание ФИПИ…</div></div></div>';
        try {
            const bank = await ensureBank();
            const kim = Number(String(taskKey || '').replace(/\D/g, ''));
            const pool = (bank.tasks || []).filter(task => task.kim === kim && (!taskId || task.id === taskId));
            if (!pool.length) throw new Error(`В банке нет задания №${kim}`);
            trainingTask = pool[randomIndex(pool.length)];
            trainingAnswer = ORDERED_KIMS.has(kim) ? normalizedOrderedAnswer(trainingTask, []) : '';
            trainingScore = null;
            trainingSourceTask = `task${kim}`;
            singleMistakeEntry = null;
            selectedExamChip = null;
            selectedExamChipTaskId = null;
            view = 'training';
            renderTraining();
        } catch (error) {
            console.error('[FIPI training]', error);
            if (typeof window.showToast === 'function') window.showToast('⚠️', 'Не удалось загрузить задание ФИПИ. Продолжаем обычную тренировку.', 'bg-rose-500', 'border-rose-700');
            view = 'training';
            closeTrainingTask();
        }
    }

    function maybeOpenTrainingTask(randomValue) {
        if (skipMixOnce) { skipMixOnce = false; return false; }
        if (!window.state || window.state.currentMode !== 'normal' || window.state.isHomeworkMode || window.state.activeHw) return false;
        if (overlay?.classList.contains('em-open')) return false;
        const period = document.getElementById('filter-period')?.value || 'all';
        if (period !== 'all') return false;
        const taskKey = window.state.currentTask;
        if (!['task1', 'task3', 'task4', 'task5', 'task7'].includes(taskKey)) return false;
        const roll = Number.isFinite(randomValue) ? randomValue : Math.random();
        if (roll >= 0.2) return false;
        openTrainingTask(taskKey);
        return true;
    }

    function finishTrainingTask() {
        if (!trainingTask || view !== 'training') return;
        if (!isAnswered(trainingTask, trainingAnswer)) {
            if (typeof window.showToast === 'function') window.showToast('⚠️', 'Сначала заполните ответ', 'bg-gray-800', 'border-black');
            return;
        }
        trainingScore = window.EgeScoring.scoreTask(trainingTask, trainingAnswer);
        if (trainingScore.points < trainingScore.max || trainingScore.acceptedWithWarning) {
            recordExamMistake(trainingTask, trainingAnswer, trainingScore, { source: 'trainer' });
        }
        if (typeof window.creditNorm === 'function') window.creditNorm(1, trainingSourceTask);
        if (window.state?.stats) window.state.stats.egePoints = (Number(window.state.stats.egePoints) || 0) + (trainingScore.points || 0);
        saveExam();
        if (typeof window.syncNow === 'function') window.syncNow();
        if (typeof window.updateGlobalUI === 'function') window.updateGlobalUI();
        if (typeof window.updateProgressBars === 'function') window.updateProgressBars();
        view = 'training-result';
        renderTraining();
    }

    const INTERACTION_SCROLL_SELECTORS = ['.em-work', '.em-board-card', '.em-pool-panel', '.em-panel-body', '.em-options', '.em-answer-panel'];

    function captureInteractionContext(target) {
        const scroll = INTERACTION_SCROLL_SELECTORS.flatMap(selector => Array.from(overlay?.querySelectorAll(selector) || []).map((element, index) => ({
            selector,
            index,
            top: element.scrollTop,
            left: element.scrollLeft
        })));
        return {
            scroll,
            focus: target ? {
                action: target.dataset.emAction || '',
                value: target.dataset.value || '',
                index: target.dataset.index || ''
            } : null
        };
    }

    function restoreInteractionContext(context) {
        if (!context || !overlay) return;
        context.scroll.forEach(item => {
            const element = overlay.querySelectorAll(item.selector)[item.index];
            if (!element) return;
            element.scrollTop = item.top;
            element.scrollLeft = item.left;
        });
        if (!context.focus?.action) return;
        const nextTarget = Array.from(overlay.querySelectorAll('[data-em-action]')).find(element =>
            element.dataset.emAction === context.focus.action
            && (element.dataset.value || '') === context.focus.value
            && (element.dataset.index || '') === context.focus.index
        );
        nextTarget?.focus({ preventScroll: true });
    }

    function rerenderKeepingContext(renderer, target) {
        const context = captureInteractionContext(target);
        renderer();
        restoreInteractionContext(context);
        requestAnimationFrame(() => restoreInteractionContext(context));
    }

    function renderWork() {
        const active = examState().active;
        const tasks = activeTasks();
        if (!active || tasks.length !== 12) return renderDashboard();
        currentIndex = Math.max(0, Math.min(tasks.length - 1, currentIndex));
        active.current = currentIndex;
        active.updatedAt = Date.now();
        const task = tasks[currentIndex];
        const value = active.answers?.[task.id];
        if (selectedExamChipTaskId && selectedExamChipTaskId !== task.id) {
            selectedExamChip = null;
            selectedExamChipTaskId = null;
        }
        overlay.innerHTML = topBar(`${TASK_ICONS[task.kim] || '📝'} Задание №${task.kim}`, 'Пробник ЕГЭ · задания 1–12', true) + `<div class="em-workspace">${navHtml(tasks, active)}<div class="em-work ${task.image ? 'has-fixed-media' : ''}">${questionHtml(task, value, false, null)}</div></div>`;
        updateTimer();
    }

    function updateAnswer(task, value) {
        const active = examState().active;
        if (!active) return;
        if (!active.answers) active.answers = {};
        active.answers[task.id] = value;
        active.updatedAt = Date.now();
        saveExam();
    }

    function renderResult(record) {
        stopTimer(false);
        view = 'result';
        resultRecord = record;
        reviewRecord = null;
        returnToMistakePool = false;
        const tasks = tasksForRecord(record);
        const rowFor = (task, index) => {
            const result = scoreForTask(record, task);
            const cls = result.acceptedWithWarning ? 'part' : result.points === result.max ? 'full' : result.points > 0 ? 'part' : 'zero';
            const status = result.acceptedWithWarning ? 'Засчитано в учебном режиме · проверьте запись' : result.points === result.max ? 'Выполнено полностью' : result.points > 0 ? 'Частичный балл' : 'Нет балла';
            return `<button class="em-break-row em-break-button" data-em-action="review-task" data-index="${index}" aria-label="Разобрать задание ${task.kim}"><strong>№ ${task.kim}</strong><span class="em-muted">${status} · нажмите, чтобы разобрать</span><span class="em-break-score ${cls}">${result.points} / ${result.max}</span></button>`;
        };
        const issues = reviewIssueIndices(record, tasks);
        const issueSet = new Set(issues);
        const issueRows = issues.map(index => rowFor(tasks[index], index)).join('');
        const correctRows = tasks.map((task, index) => ({ task, index })).filter(item => !issueSet.has(item.index)).map(item => rowFor(item.task, item.index)).join('');
        const correctCount = tasks.length - issues.length;
        const warningCount = Object.values(record.scoreByKim || {}).filter(item => item?.acceptedWithWarning).length;
        const notice = warningCount ? `<div class="em-result-notice"><b>⚠️ ${warningCount} ${warningCount === 1 ? 'ответ засчитан' : 'ответа засчитаны'} мягкой проверкой.</b><br>Это учебное послабление. Откройте работу над ошибками: там отмечено, что именно нужно исправить перед ЕГЭ.</div>` : '';
        const breakdown = issues.length
            ? `<h3>Сначала разберите ошибки</h3><div class="em-muted">Красным отмечены задания без балла, жёлтым — частичный балл или ответ, запись которого нужно исправить.</div><div class="em-breakdown">${issueRows}</div>${correctCount ? `<details class="em-correct-details"><summary>Верные задания · ${correctCount}</summary><div class="em-breakdown">${correctRows}</div></details>` : ''}`
            : `<h3>Все задания выполнены верно</h3><div class="em-muted">Можно открыть любое задание и сверить свой ответ с эталоном.</div><div class="em-breakdown">${correctRows}</div>`;
        overlay.innerHTML = topBar('Результат пробника', 'Первичный балл за задания 1–12', false) + `<div class="em-result"><div class="em-result-inner"><div class="em-result-score"><div class="em-muted">Тестовая часть ЕГЭ</div><div class="em-result-number">${record.score}<span> / 20</span></div><div style="font-weight:850">Время: ${formatDuration(record.durationMs)}</div><div class="em-result-overview"><span class="em-overview-pill issue">Требуют разбора: ${issues.length}</span><span class="em-overview-pill ok">Верно: ${correctCount}</span></div>${notice}<div class="em-result-actions"><button class="em-btn primary" data-em-action="review">${issues.length ? `Разобрать ошибки · ${issues.length}` : 'Просмотреть ответы'}</button><button class="em-btn" data-em-action="open-error-pool">Все ошибки пробников</button><button class="em-btn" data-em-action="new">Новый пробник</button><button class="em-btn" data-em-action="dashboard">Все результаты</button></div></div><div class="em-card">${breakdown}</div></div></div>`;
    }

    function renderReview() {
        view = 'review';
        const record = reviewRecord || resultRecord;
        if (!record) return renderDashboard();
        const tasks = tasksForRecord(record);
        currentIndex = Math.max(0, Math.min(tasks.length - 1, currentIndex));
        const task = tasks[currentIndex];
        const value = record.answers?.[task.id];
        const scoreResult = record.scoreByKim?.[task.kim] || window.EgeScoring.scoreTask(task, value);
        selectedExamChip = null;
        selectedExamChipTaskId = null;
        overlay.innerHTML = topBar(`${TASK_ICONS[task.kim] || '📝'} Разбор задания №${task.kim}`, `${record.score}/20 · ${formatDate(record.completedAt)}`, false) + `<div class="em-workspace">${reviewNavHtml(tasks, record)}<div class="em-work ${task.image ? 'has-fixed-media' : ''}">${questionHtml(task, value, true, scoreResult)}</div></div>`;
    }

    function finishAttempt() {
        const state = examState();
        const active = state.active;
        const tasks = activeTasks();
        if (!active || tasks.length !== 12) return;
        const missing = 12 - answeredCount(active, tasks);
        if (missing > 0 && !window.confirm(`Не отвечено заданий: ${missing}. Всё равно сдать пробник?`)) return;
        stopTimer(false);
        const score = window.EgeScoring.scoreVariant(tasks, active.answers || {});
        const completedAt = Date.now();
        const record = {
            id: active.id,
            bankVersion: active.bankVersion,
            taskIds: active.taskIds.slice(),
            mapGroupId: active.mapGroupId,
            answers: clone(active.answers || {}),
            startedAt: active.startedAt,
            updatedAt: completedAt,
            completedAt,
            durationMs: Number(active.elapsedMs) || 0,
            score: score.total,
            maxScore: score.max,
            scoreByKim: Object.fromEntries(Object.entries(score.byKim).map(([kim, item]) => [kim, {
                points: item.points,
                max: item.max,
                errorCount: item.errorCount,
                matchType: item.matchType,
                editDistance: item.editDistance,
                matchedAnswer: item.matchedAnswer,
                acceptedWithWarning: Boolean(item.acceptedWithWarning),
                warningKinds: Array.isArray(item.warningKinds) ? item.warningKinds.slice() : []
            }]))
        };
        tasks.forEach(task => {
            const taskScore = score.byKim[task.kim];
            recordExamMistake(task, active.answers?.[task.id], taskScore, {
                id: `${record.id}:${task.id}`,
                source: 'mock-exam',
                attemptId: record.id,
                createdAt: completedAt
            });
        });
        state.active = null;
        state.history = [...state.history.filter(item => item.id !== record.id), record].slice(-50);
        saveExam();
        returnToMistakePool = false;
        renderResult(record);
    }

    function openHistory(id) {
        const record = examState().history.find(item => item.id === id);
        if (record) {
            returnToMistakePool = false;
            renderResult(record);
        }
    }

    function handleInput(event) {
        const input = event.target.closest('.em-text-input');
        if (!input) return;
        if (view === 'training' && trainingTask && input.dataset.taskId === trainingTask.id) {
            trainingAnswer = input.value;
            return;
        }
        if (view !== 'work') return;
        const task = activeTasks().find(item => item.id === input.dataset.taskId);
        if (task) {
            updateAnswer(task, input.value);
            refreshNavMarkers();
        }
    }

    function refreshNavMarkers() {
        const active = examState().active;
        if (!active) return;
        const tasks = activeTasks();
        overlay.querySelectorAll('.em-nav-btn').forEach((button, index) => {
            const task = tasks[index];
            if (!task) return;
            const value = active.answers?.[task.id];
            button.classList.toggle('answered', isAnswered(task, value));
            const some = ORDERED_KIMS.has(task.kim) ? normalizedOrderedAnswer(task, value).some(Boolean)
                : CHOICE_KIMS.has(task.kim) ? window.EgeScoring.normalizeSymbols(value).length > 0
                : window.EgeScoring.normalizeTextAnswer(value).length > 0;
            button.classList.toggle('partial', some && !isAnswered(task, value));
        });
        const center = overlay.querySelector('.em-panel-progress');
        if (center && view === 'work') center.textContent = `${answeredCount(active, tasks)} из 12 отвечено`;
    }

    function showZoom(src) {
        const zoom = document.createElement('div');
        zoom.className = 'em-zoom';
        zoom.setAttribute('role', 'dialog');
        zoom.setAttribute('aria-label', 'Увеличенная карта');
        zoom.innerHTML = `<div class="em-zoom-stage"><div class="em-zoom-canvas"><img src="${escapeAttr(src)}" alt="Увеличенное изображение" draggable="false"></div></div><div class="em-zoom-toolbar"><button type="button" data-zoom-action="out" aria-label="Уменьшить">−</button><button type="button" data-zoom-action="reset" aria-label="Показать целиком">1×</button><button type="button" data-zoom-action="in" aria-label="Увеличить">+</button><button type="button" class="em-zoom-close" data-zoom-action="close" aria-label="Закрыть">×</button></div><div class="em-zoom-hint">Разведите два пальца · двойное касание увеличивает</div>`;
        document.body.appendChild(zoom);
        const stage = zoom.querySelector('.em-zoom-stage');
        const canvas = zoom.querySelector('.em-zoom-canvas');
        const image = canvas.querySelector('img');
        const hint = zoom.querySelector('.em-zoom-hint');
        const pointers = new Map();
        const transform = { x: 0, y: 0, scale: 1, baseWidth: 1, baseHeight: 1 };
        let dragStart = null;
        let pinchStart = null;
        let lastTouchTap = null;

        const stagePoint = (clientX, clientY) => {
            const rect = stage.getBoundingClientRect();
            return { x: clientX - rect.left, y: clientY - rect.top, width: rect.width, height: rect.height };
        };
        const clamp = () => {
            const rect = stage.getBoundingClientRect();
            const width = transform.baseWidth * transform.scale;
            const height = transform.baseHeight * transform.scale;
            transform.x = width <= rect.width ? (rect.width - width) / 2 : Math.min(0, Math.max(rect.width - width, transform.x));
            transform.y = height <= rect.height ? (rect.height - height) / 2 : Math.min(0, Math.max(rect.height - height, transform.y));
        };
        const apply = () => {
            clamp();
            canvas.style.transform = `translate3d(${transform.x}px,${transform.y}px,0) scale(${transform.scale})`;
            const reset = zoom.querySelector('[data-zoom-action="reset"]');
            if (reset) reset.textContent = `${Math.round(transform.scale * 10) / 10}×`;
        };
        const fit = () => {
            const rect = stage.getBoundingClientRect();
            const naturalWidth = image.naturalWidth || rect.width;
            const naturalHeight = image.naturalHeight || rect.height;
            const ratio = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
            transform.baseWidth = Math.max(1, naturalWidth * ratio);
            transform.baseHeight = Math.max(1, naturalHeight * ratio);
            image.style.width = `${transform.baseWidth}px`;
            image.style.height = `${transform.baseHeight}px`;
            transform.scale = 1;
            transform.x = (rect.width - transform.baseWidth) / 2;
            transform.y = (rect.height - transform.baseHeight) / 2;
            apply();
        };
        const zoomAt = (clientX, clientY, requestedScale) => {
            const point = stagePoint(clientX, clientY);
            const nextScale = Math.max(1, Math.min(6, requestedScale));
            const imageX = (point.x - transform.x) / transform.scale;
            const imageY = (point.y - transform.y) / transform.scale;
            transform.x = point.x - imageX * nextScale;
            transform.y = point.y - imageY * nextScale;
            transform.scale = nextScale;
            apply();
            hint.classList.add('hidden');
        };
        const reset = () => fit();
        const close = () => {
            window.removeEventListener('resize', fit);
            document.removeEventListener('keydown', onKeyDown);
            zoom.remove();
        };
        const pinchInfo = () => {
            const values = [...pointers.values()];
            if (values.length < 2) return null;
            const a = values[0], b = values[1];
            const midClientX = (a.x + b.x) / 2;
            const midClientY = (a.y + b.y) / 2;
            const point = stagePoint(midClientX, midClientY);
            return { distance: Math.hypot(a.x - b.x, a.y - b.y), point };
        };
        const startPinch = () => {
            const info = pinchInfo();
            if (!info) return;
            pinchStart = {
                distance: Math.max(1, info.distance),
                scale: transform.scale,
                imageX: (info.point.x - transform.x) / transform.scale,
                imageY: (info.point.y - transform.y) / transform.scale
            };
            dragStart = null;
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') close();
        };

        stage.addEventListener('pointerdown', event => {
            event.preventDefault();
            stage.setPointerCapture?.(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, startedAt: Date.now(), type: event.pointerType });
            stage.classList.add('is-dragging');
            if (pointers.size === 1) dragStart = { clientX: event.clientX, clientY: event.clientY, x: transform.x, y: transform.y };
            else startPinch();
        });
        stage.addEventListener('pointermove', event => {
            const pointer = pointers.get(event.pointerId);
            if (!pointer) return;
            event.preventDefault();
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            if (pointers.size >= 2) {
                if (!pinchStart) startPinch();
                const info = pinchInfo();
                if (!info || !pinchStart) return;
                const nextScale = Math.max(1, Math.min(6, pinchStart.scale * info.distance / pinchStart.distance));
                transform.scale = nextScale;
                transform.x = info.point.x - pinchStart.imageX * nextScale;
                transform.y = info.point.y - pinchStart.imageY * nextScale;
                apply();
                hint.classList.add('hidden');
            } else if (dragStart && transform.scale > 1) {
                transform.x = dragStart.x + event.clientX - dragStart.clientX;
                transform.y = dragStart.y + event.clientY - dragStart.clientY;
                apply();
                hint.classList.add('hidden');
            }
        });
        const endPointer = event => {
            const pointer = pointers.get(event.pointerId);
            pointers.delete(event.pointerId);
            if (pointer && pointer.type === 'touch' && Date.now() - pointer.startedAt < 260 && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 12) {
                const now = Date.now();
                if (lastTouchTap && now - lastTouchTap.time < 330 && Math.hypot(event.clientX - lastTouchTap.x, event.clientY - lastTouchTap.y) < 34) {
                    zoomAt(event.clientX, event.clientY, transform.scale > 1.2 ? 1 : 2.5);
                    lastTouchTap = null;
                } else lastTouchTap = { time: now, x: event.clientX, y: event.clientY };
            }
            pinchStart = null;
            if (pointers.size === 1) {
                const remaining = [...pointers.values()][0];
                dragStart = { clientX: remaining.x, clientY: remaining.y, x: transform.x, y: transform.y };
            } else if (!pointers.size) {
                dragStart = null;
                stage.classList.remove('is-dragging');
            } else startPinch();
        };
        stage.addEventListener('pointerup', endPointer);
        stage.addEventListener('pointercancel', endPointer);
        stage.addEventListener('wheel', event => {
            event.preventDefault();
            zoomAt(event.clientX, event.clientY, transform.scale * Math.exp(-event.deltaY * 0.002));
        }, { passive: false });
        stage.addEventListener('dblclick', event => {
            event.preventDefault();
            zoomAt(event.clientX, event.clientY, transform.scale > 1.2 ? 1 : 2.5);
        });
        zoom.querySelector('.em-zoom-toolbar').addEventListener('click', event => {
            const action = event.target.closest('[data-zoom-action]')?.dataset.zoomAction;
            if (!action) return;
            if (action === 'close') return close();
            if (action === 'reset') return reset();
            const rect = stage.getBoundingClientRect();
            zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, transform.scale * (action === 'in' ? 1.5 : 1 / 1.5));
        });
        image.addEventListener('load', fit, { once: true });
        if (image.complete) fit();
        window.addEventListener('resize', fit);
        document.addEventListener('keydown', onKeyDown);
        setTimeout(() => hint.classList.add('hidden'), 2600);
    }

    function handleClick(event) {
        const target = event.target.closest('[data-em-action]');
        if (!target) return;
        const action = target.dataset.emAction;
        if (action === 'close') return closeExamMode();
        if (action === 'back-error-pool') return backToMistakePool();
        if (action === 'new') return beginNewAttempt();
        if (action === 'resume') return resumeAttempt();
        if (action === 'dashboard') return renderDashboard();
        if (action === 'discard') {
            if (window.confirm('Удалить незавершённый пробник?')) { examState().active = null; saveExam(); renderDashboard(); }
            return;
        }
        if (action === 'open-history') return openHistory(target.dataset.id);
        if (action === 'zoom') return showZoom(target.dataset.src);
        if (action === 'open-error-pool') {
            closeExamMode();
            return window.openMistakesListModal?.();
        }
        if (action === 'training-check') return finishTrainingTask();
        if (action === 'training-next') return closeTrainingTask();
        if (action === 'finish') return finishAttempt();
        if (action === 'result') return renderResult(reviewRecord || resultRecord);
        if (action === 'review') {
            reviewRecord = resultRecord;
            const tasks = tasksForRecord(reviewRecord);
            const issues = reviewIssueIndices(reviewRecord, tasks);
            reviewIssuesOnly = issues.length > 0;
            currentIndex = issues[0] ?? 0;
            return renderReview();
        }
        if (action === 'review-task') {
            reviewRecord = resultRecord;
            reviewIssuesOnly = false;
            currentIndex = Math.max(0, Math.min(11, Number(target.dataset.index) || 0));
            return renderReview();
        }
        if (action === 'review-filter') {
            const record = reviewRecord || resultRecord;
            const tasks = tasksForRecord(record);
            reviewIssuesOnly = target.dataset.filter === 'issues' && reviewIssueIndices(record, tasks).length > 0;
            const sequence = currentReviewSequence(record, tasks);
            if (!sequence.includes(currentIndex)) currentIndex = sequence[0] || 0;
            return renderReview();
        }
        if (action === 'review-go') {
            currentIndex = Math.max(0, Math.min(11, Number(target.dataset.index) || 0));
            return renderReview();
        }
        if (action === 'nav') {
            currentIndex = Number(target.dataset.index) || 0;
            selectedExamChip = null;
            selectedExamChipTaskId = null;
            if (view === 'review') {
                const record = reviewRecord || resultRecord;
                const tasks = tasksForRecord(record);
                if (reviewIssuesOnly && !reviewIssueIndices(record, tasks).includes(currentIndex)) reviewIssuesOnly = false;
                return renderReview();
            }
            return renderWork();
        }
        if (action === 'prev' || action === 'next') {
            currentIndex += action === 'next' ? 1 : -1;
            selectedExamChip = null;
            selectedExamChipTaskId = null;
            return renderWork();
        }
        const isTraining = view === 'training';
        if (view !== 'work' && !isTraining) return;
        const active = isTraining ? null : examState().active;
        const task = isTraining ? trainingTask : activeTasks()[currentIndex];
        if ((!isTraining && !active) || !task) return;
        const currentValue = isTraining ? trainingAnswer : active.answers?.[task.id];
        const commitInteractiveAnswer = value => {
            if (isTraining) {
                trainingAnswer = value;
                rerenderKeepingContext(renderTraining, target);
            } else {
                updateAnswer(task, value);
                rerenderKeepingContext(renderWork, target);
            }
        };
        if (action === 'chip') {
            const digit = target.dataset.value;
            selectedExamChip = selectedExamChipTaskId === task.id && selectedExamChip === digit ? null : digit;
            selectedExamChipTaskId = selectedExamChip ? task.id : null;
            return rerenderKeepingContext(isTraining ? renderTraining : renderWork, target);
        }
        if (action === 'slot') {
            const slots = normalizedOrderedAnswer(task, currentValue);
            const index = Number(target.dataset.index) || 0;
            if (selectedExamChip && selectedExamChipTaskId === task.id) {
                const previousIndex = slots.indexOf(selectedExamChip);
                if (previousIndex !== -1) slots[previousIndex] = '';
                slots[index] = selectedExamChip;
                selectedExamChip = null;
                selectedExamChipTaskId = null;
            } else if (slots[index]) {
                slots[index] = '';
            }
            return commitInteractiveAnswer(slots);
        }
        if (action === 'clear-slot') {
            const slots = normalizedOrderedAnswer(task, currentValue);
            slots[Number(target.dataset.index) || 0] = '';
            return commitInteractiveAnswer(slots);
        }
        if (action === 'choice') {
            const values = window.EgeScoring.normalizeSymbols(currentValue);
            const digit = target.dataset.value;
            const index = values.indexOf(digit);
            if (index === -1) values.push(digit); else values.splice(index, 1);
            values.sort();
            return commitInteractiveAnswer(values);
        }
    }

    function closeExamMode() {
        if (view === 'training' || view === 'training-result' || view === 'mistake-review') return closeTrainingTask();
        stopTimer(true);
        if (overlay) overlay.classList.remove('em-open');
        document.body.style.overflow = previousBodyOverflow;
    }

    function backToMistakePool() {
        closeExamMode();
        returnToMistakePool = false;
        setTimeout(() => window.openMistakesListModal?.(), 0);
    }

    async function openSavedMistake(id) {
        const entry = examMistakes().find(item => item && item.id === id);
        if (!entry) return;
        ensureOverlay();
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        overlay.classList.add('em-open');
        returnToMistakePool = true;
        overlay.innerHTML = '<div class="em-dashboard"><div class="em-dashboard-inner"><div class="em-card">Открываем сохранённую ошибку…</div></div></div>';
        try {
            await ensureBank();
            const attempt = entry.attemptId ? examState().history.find(item => item.id === entry.attemptId) : null;
            if (attempt) {
                const tasks = tasksForRecord(attempt);
                const index = tasks.findIndex(task => task.id === entry.taskId);
                if (index !== -1) {
                    resultRecord = attempt;
                    reviewRecord = attempt;
                    reviewIssuesOnly = true;
                    currentIndex = index;
                    return renderReview();
                }
            }
            const task = window.EGE_EXAM_BANK?.tasks?.find(item => item.id === entry.taskId);
            if (!task) throw new Error('Задание больше не найдено в банке');
            trainingTask = task;
            trainingAnswer = clone(entry.answer == null ? '' : entry.answer);
            trainingScore = {
                points: Number(entry.points) || 0,
                max: Number(entry.max) || window.EgeScoring.maxPoints(task.kim),
                acceptedWithWarning: Boolean(entry.acceptedWithWarning),
                warningKinds: Array.isArray(entry.warningKinds) ? entry.warningKinds.slice() : []
            };
            trainingSourceTask = `task${task.kim}`;
            singleMistakeEntry = entry;
            selectedExamChip = null;
            selectedExamChipTaskId = null;
            view = 'mistake-review';
            renderTraining();
        } catch (error) {
            console.error('[Exam mistake]', error);
            overlay.classList.remove('em-open');
            document.body.style.overflow = previousBodyOverflow;
            returnToMistakePool = false;
            if (typeof window.showToast === 'function') window.showToast('⚠️', error.message || 'Не удалось открыть ошибку', 'bg-rose-500', 'border-rose-700');
        }
    }

    async function openExamMode() {
        ensureOverlay();
        previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        overlay.classList.add('em-open');
        returnToMistakePool = false;
        overlay.innerHTML = '<div class="em-dashboard"><div class="em-dashboard-inner"><div class="em-card">Загружаем задания ФИПИ…</div></div></div>';
        try {
            await ensureBank();
            renderDashboard();
        } catch (error) {
            console.error('[Exam mode]', error);
            overlay.innerHTML = topBar('Пробник ЕГЭ', '', false) + `<div class="em-dashboard"><div class="em-dashboard-inner"><div class="em-card"><h3>Не удалось открыть пробник</h3><div class="em-muted">${escapeAttr(error.message || 'Ошибка загрузки')}</div><div style="margin-top:12px"><button class="em-btn primary" data-em-action="close">Закрыть</button></div></div></div></div>`;
        }
    }

    window.addEventListener('pagehide', () => { if (view === 'work') stopTimer(true); });
    window.openExamMode = openExamMode;
    window.closeExamMode = closeExamMode;
    window.openExamMistake = openSavedMistake;
    window.EgeExamMode = Object.freeze({
        createVariant,
        isAnswered,
        open: openExamMode,
        close: closeExamMode,
        openMistake: openSavedMistake,
        openTrainingTask,
        maybeOpenTrainingTask
    });
})();
