// ui.js — UI: модалки, тосты, тема, онбординг, настройки, статистика
// Загружается первым (нет зависимостей от app.js)
'use strict';

// ── Минимальный CSS для шапки (без скрытия элементов) ──
(function() {
    const s = document.createElement('style');
    s.id = '_topbar_css';
    s.textContent =
        '#top-stats-bar [data-card]{transition:opacity .15s,transform .15s;cursor:pointer}' +
        '#top-stats-bar [data-card]:active{opacity:.75;transform:scale(.95)}';
    (document.head || document.documentElement).appendChild(s);
})();

// ── Скрыть чекбокс "скрывать выученное" — он больше не нужен ──
function patchHeaderDOM() {
    const hll = document.getElementById('pg-hide-learned-container');
    if (hll) hll.style.display = 'none';
}

// Запускаем максимально рано
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchHeaderDOM, { once: true });
} else {
    patchHeaderDOM();
}

window.showModal = function(id) {
    const m = document.getElementById(id); if(!m) return;
    m.classList.remove('hidden'); m.classList.add('flex');
    setTimeout(() => m.classList.remove('opacity-0'), 10);
};
window.hideModal = function(id) {
    const m = document.getElementById(id); if(!m) return;
    m.classList.add('opacity-0');
    setTimeout(() => { m.classList.add('hidden'); m.classList.remove('flex'); }, 300);
};

// Карта по географическому объекту: метка на координатах из geoDict ([lng, lat]).
// Функция отсутствовала — клик по гео в задании №4 не открывал карту (ReferenceError).
window.openMapModal = function(geo) {
    const coords = (typeof geoDict !== 'undefined') ? geoDict[geo] : null;
    if (!coords || coords.length !== 2) return;
    if (typeof haptic === 'function') haptic('light');
    const [lng, lat] = coords;
    const title = document.getElementById('map-modal-title');
    if (title) title.textContent = geo;
    const iframe = document.getElementById('yandex-map-iframe');
    if (iframe) {
        // Yandex Maps widget: центр + красная метка ровно на точке.
        iframe.src = `https://yandex.ru/map-widget/v1/?ll=${lng}%2C${lat}&z=7&l=map&pt=${lng},${lat},pm2rdm`;
    }
    window.showModal('map-modal');
};

// ═══ КОМПОЗЕР ДЗ (учитель): набор подзаданий с разными метриками ═══
// _hwComposer = { target:{type:'class'|'student', id, name}, items:[{task,period,metric,goal}], deadline }
window._hwComposer = null;

const HWC_TASKS = [
    { v: 'task1', t: '⏳ №1 Хронология' },
    { v: 'task4', t: '📍 №4 География' },
    { v: 'task3', t: '🔗 №3 Процессы' },
    { v: 'task5', t: '👤 №5 Личности' },
    { v: 'task7', t: '🎨 №7 Культура' },
    { v: 'cram',  t: '⚡ Зубрёжка дат' }
];
const HWC_PERIODS = [
    { v: 'all', t: 'Вся история' }, { v: 'early', t: 'До XVIII в.' },
    { v: '18th', t: 'XVIII век' }, { v: '19th', t: 'XIX век' }, { v: '20th', t: 'XX век' },
    { v: 'custom', t: '📅 Свои годы' }
];
// Диапазоны лет для пресетов периодов (совпадают с порогами .c: y<1700=early и т.д.)
const HWC_PERIOD_YEARS = { all: [862, 2026], early: [862, 1699], '18th': [1700, 1799], '19th': [1800, 1899], '20th': [1900, 2026] };
const HWC_METRICS = [
    { v: 'lines', t: 'Строки (решить)' },
    { v: 'points', t: 'Баллы ЕГЭ (набрать)' },
    { v: 'learned', t: 'Выученные факты' }
];

window.promptAssignHw = function(studentId, name) {
    window.openHwComposer({ type: 'student', id: studentId, name: name || 'Ученик' });
};
window.promptAssignHwClass = function() {
    const students = (window._cachedStudents || []);
    if (!students.length) return showToast('⚠️', 'Сначала загрузите класс', 'bg-rose-500', 'border-rose-700');
    window.openHwComposer({ type: 'class', count: students.length });
};

window.openHwComposer = function(target) {
    window._hwComposer = { target, items: [], deadline: null,
        draft: { task: 'task4', period: 'all', metric: 'lines', goal: '', yearStart: 862, yearEnd: 2026 } };
    let overlay = document.getElementById('hw-composer-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'hw-composer-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center';
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }
    _renderHwComposer();
};

// ─── Список выданных ДЗ + отмена (вариант А): весь класс или конкретный ученик ───
let _hwListCache = [];
let _hwlCtx = { mode: 'class', code: '', uid: '', name: '' };
const _HWL_TASK = { task1: '⏳№1', task3: '🔗№3', task4: '📍№4', task5: '👤№5', task7: '🎨№7', cram: '⚡Зубрёжка' };
const _HWL_UNIT = { lines: 'строк', points: 'баллов', learned: 'фактов' };
function _hwlEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _hwlItemSummary(it) {
    const scope = it.task === 'cram'
        ? (it.yearStart && it.yearEnd ? `${it.yearStart}–${it.yearEnd}` : 'любые')
        : (it.period === 'custom' ? `${it.yearStart || '?'}–${it.yearEnd || '?'}` : (it.period || 'all'));
    return `${_HWL_TASK[it.task] || it.task} ${it.goal} ${_HWL_UNIT[it.metric] || ''} · ${scope}`;
}
function _hwlStateBadge(state) {
    if (state === 'done') return '<span style="font-size:9px;font-weight:900;color:#059669;background:rgba(16,185,129,0.14);border-radius:6px;padding:2px 6px">сдано ✓</span>';
    if (state === 'pending') return '<span style="font-size:9px;font-weight:900;color:#a16207;background:rgba(245,158,11,0.16);border-radius:6px;padding:2px 6px">ожидает</span>';
    return '<span style="font-size:9px;font-weight:900;color:#4338ca;background:rgba(99,102,241,0.14);border-radius:6px;padding:2px 6px">в работе</span>';
}
function _hwlCancellable(a) { return _hwlCtx.mode === 'student' ? a.state !== 'done' : true; }
function _hwlOverlay() {
    let overlay = document.getElementById('hw-list-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'hw-list-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center';
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }
    return overlay;
}
function _hwlRenderShell(titleTxt, subTxt, noteTxt) {
    const overlay = _hwlOverlay();
    overlay.innerHTML = `
    <div style="background:#f7f7f8;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;border-radius:24px 24px 0 0;padding:18px 16px 28px;box-shadow:0 -8px 40px rgba(0,0,0,0.25)" class="dark:bg-[#141414]">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:16px;font-weight:900;color:#111" class="dark:text-white">${_hwlEsc(titleTxt)}</div>
        <button onclick="document.getElementById('hw-list-overlay').remove()" style="font-size:22px;color:#aaa;background:none;border:none;cursor:pointer;padding:2px 8px">✕</button>
      </div>
      <div style="font-size:11px;color:#6b7280;font-weight:700;margin-bottom:4px">${_hwlEsc(subTxt)}</div>
      <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:12px;line-height:1.4">${_hwlEsc(noteTxt)}</div>
      <div id="hw-list-actions" style="margin-bottom:10px"></div>
      <div id="hw-list-body"><div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">Загрузка…</div></div>
    </div>`;
}
window.openClassAssignmentsList = function() {
    const code = (document.getElementById('teacher-class-code-input')?.value || localStorage.getItem('teacher_class_code') || '').trim();
    if (!code) return showToast('⚠️', 'Не задан код класса', 'bg-rose-500', 'border-rose-700');
    if (!window.listClassAssignments) return showToast('⚠️', 'Нет подключения к серверу', 'bg-rose-500', 'border-rose-700');
    _hwlCtx = { mode: 'class', code, uid: '', name: '' };
    _hwlRenderShell('📋 Выданные ДЗ', `Класс ${code}`, 'Отмена убирает ДЗ из журнала и у тех, кто его ещё не сдал (применится при следующем входе ученика). У сдавших отметка сохраняется.');
    _hwlLoad();
};
window.openStudentAssignmentsList = function(uid, name) {
    if (!uid) return;
    if (!window.listStudentAssignments) return showToast('⚠️', 'Нет подключения к серверу', 'bg-rose-500', 'border-rose-700');
    _hwlCtx = { mode: 'student', code: '', uid, name: name || 'Ученик' };
    _hwlRenderShell('📋 ДЗ ученика', name || 'Ученик', 'Отмена убирает невыполненные ДЗ у этого ученика (применится при его следующем входе). Сданные остаются с отметкой.');
    _hwlLoad();
};
async function _hwlLoad() {
    let list = [];
    try {
        list = _hwlCtx.mode === 'student'
            ? await window.listStudentAssignments(_hwlCtx.uid)
            : await window.listClassAssignments(_hwlCtx.code);
    } catch (e) { console.error(e); }
    _hwListCache = Array.isArray(list) ? list : [];
    _hwlPaint();
}
function _hwlPaint() {
    const body = document.getElementById('hw-list-body');
    const actions = document.getElementById('hw-list-actions');
    if (!body) return;
    if (actions) {
        const n = _hwListCache.filter(_hwlCancellable).length;
        if (_hwlCtx.mode === 'class') {
            // Для класса кнопка «с чистого листа» доступна ВСЕГДА: старые ДЗ (выданные до появления
            // журнала) в списке не значатся, но метка revokeBefore снимает и их. Если показывать
            // кнопку только при заполненном журнале — именно старьё было бы «не убрать».
            actions.innerHTML = `<button onclick="window._hwlAskCancelAll()" style="width:100%;background:rgba(244,63,94,0.08);color:var(--c-danger,#e11d48);border:1px solid rgba(244,63,94,0.35);border-radius:10px;padding:9px;font-size:11px;font-weight:900;cursor:pointer">🧹 С чистого листа — снять все невыполненные ДЗ класса${n ? ` (в журнале: ${n})` : ', включая старые'}</button>
              <div style="display:flex;gap:6px;margin-top:6px;align-items:stretch">
                <input type="date" id="hwl-sweep-date" value="${new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]}" style="flex:0 0 auto;background:#fff;border:1px solid rgba(128,128,128,0.3);border-radius:10px;padding:7px 8px;font-size:11px;font-weight:800;color:#374151" class="dark:!bg-[#1e1e1e] dark:!text-gray-300">
                <button onclick="window._hwlSweepOld()" style="flex:1;background:rgba(245,158,11,0.1);color:#b45309;border:1px solid rgba(245,158,11,0.4);border-radius:10px;padding:7px;font-size:11px;font-weight:900;cursor:pointer">🗓 Снять долги, выданные ДО этой даты</button>
              </div>
              <div style="font-size:9.5px;color:#9ca3af;font-weight:700;margin-top:4px;line-height:1.35">Новые ДЗ (после даты) остаются. Снимает и «невидимые» старые долги с карточек учеников — в т.ч. у тех, кто давно не заходил.</div>`;
        } else {
            const cancelBtn = n > 1
                ? `<button onclick="window._hwlAskCancelAll()" style="width:100%;background:rgba(244,63,94,0.08);color:var(--c-danger,#e11d48);border:1px solid rgba(244,63,94,0.35);border-radius:10px;padding:9px;font-size:11px;font-weight:900;cursor:pointer">🗑 Отменить все (${n}) — с чистого листа</button>`
                : '';
            // «Выпустить из группы» — для окончивших ЕГЭ / ушедших. Прогресс сохраняется,
            // уходит только принадлежность к группе (учитель перестаёт его видеть).
            const releaseBtn = `<div id="hwl-release-slot" style="margin-top:${cancelBtn ? '6px' : '0'}">
                <button onclick="window._hwlAskRelease()" style="width:100%;background:rgba(59,130,246,0.08);color:#2563eb;border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:9px;font-size:11px;font-weight:900;cursor:pointer">🎓 Выпустить из группы (после ЕГЭ)</button>
            </div>`;
            actions.innerHTML = cancelBtn + releaseBtn;
        }
    }
    if (!_hwListCache.length) {
        body.innerHTML = `<div style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">${_hwlCtx.mode === 'student'
            ? 'У ученика нет активных ДЗ.'
            : 'Журнал ДЗ пуст. Старые ДЗ (выданные до журнала) в списке не видны — их снимает кнопка «С чистого листа» выше.'}</div>`;
        return;
    }
    body.innerHTML = _hwListCache.map(a => {
        const id = a.id;
        const title = a.title || `ДЗ · ${(a.items || []).length || 1} ${((a.items || []).length === 1) ? 'этап' : 'этап.'}`;
        const dl = a.deadline ? 'срок до ' + new Date(a.deadline + 'T00:00:00').toLocaleDateString('ru-RU') : 'без срока';
        const issued = a.assignedAt ? 'выдано ' + new Date(a.assignedAt).toLocaleDateString('ru-RU') : '';
        const items = (a.items || []).map(_hwlItemSummary).join(' · ');
        const badge = _hwlCtx.mode === 'student' ? ' ' + _hwlStateBadge(a.state) : '';
        const action = _hwlCancellable(a)
            ? `<button onclick="window._hwlAskCancel('${id}')" style="background:rgba(244,63,94,0.1);color:var(--c-danger,#e11d48);border:1px solid rgba(244,63,94,0.35);border-radius:9px;padding:6px 10px;font-size:11px;font-weight:900;cursor:pointer">Отменить</button>`
            : `<span style="font-size:10px;color:#9ca3af;font-weight:800">остаётся</span>`;
        return `
        <div data-row="${id}" style="background:#fff;border:1px solid rgba(128,128,128,0.18);border-radius:14px;padding:10px 12px;margin-bottom:8px" class="dark:bg-[#1e1e1e]">
          <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:2px" class="dark:text-gray-100">${_hwlEsc(title)}${badge}</div>
          <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${_hwlEsc(items)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="font-size:10px;color:#9ca3af;font-weight:700">${dl} · ${issued}</div>
            <div class="hwl-actions" style="flex-shrink:0">${action}</div>
          </div>
        </div>`;
    }).join('');
}
window._hwlAskCancel = function(id) {
    const cell = document.querySelector(`#hw-list-body [data-row="${id}"] .hwl-actions`);
    if (!cell) return;
    cell.innerHTML = `
      <span style="font-size:10px;color:#6b7280;font-weight:800;margin-right:6px">Точно?</span>
      <button onclick="window._hwlDoCancel('${id}')" style="background:var(--c-danger,#e11d48);color:#fff;border:none;border-radius:9px;padding:6px 10px;font-size:11px;font-weight:900;cursor:pointer;margin-right:4px">Да, отменить</button>
      <button onclick="window._hwlRepaint()" style="background:#eee;color:#444;border:none;border-radius:9px;padding:6px 10px;font-size:11px;font-weight:900;cursor:pointer">Нет</button>`;
};
window._hwlRepaint = function() { _hwlPaint(); };
window._hwlAskRelease = function() {
    const slot = document.getElementById('hwl-release-slot');
    if (!slot) return;
    slot.innerHTML = `<div style="display:flex;gap:6px;align-items:center;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.3);border-radius:10px;padding:8px">
        <span style="font-size:11px;font-weight:800;color:#334155;flex:1">Выпустить «${_hwlEsc(_hwlCtx.name || 'ученика')}»? Прогресс сохранится, из группы уйдёт.</span>
        <button onclick="window._hwlDoRelease()" style="background:#2563eb;color:#fff;border:none;border-radius:9px;padding:7px 11px;font-size:11px;font-weight:900;cursor:pointer">Да</button>
        <button onclick="window._hwlPaint&&window._hwlPaint()" style="background:#e5e7eb;color:#444;border:none;border-radius:9px;padding:7px 11px;font-size:11px;font-weight:900;cursor:pointer">Нет</button>
    </div>`;
};
window._hwlDoRelease = async function() {
    const uid = _hwlCtx.uid;
    if (!uid || !window.removeStudentFromClass) return;
    const slot = document.getElementById('hwl-release-slot');
    if (slot) slot.innerHTML = '<div style="text-align:center;font-size:11px;color:#9ca3af;font-weight:800;padding:8px">Выпускаю…</div>';
    const ok = await window.removeStudentFromClass(uid);
    if (ok) {
        showToast('🎓', 'Ученик выпущен из группы', 'bg-blue-500', 'border-blue-700');
        const ov = document.getElementById('hw-list-overlay'); if (ov) ov.remove();
        if (window.loadClassProgress) window.loadClassProgress();
    } else {
        showToast('❌', 'Не удалось выпустить', 'bg-rose-500', 'border-rose-700');
        _hwlPaint();
    }
};
window._hwlDoCancel = async function(id) {
    const cell = document.querySelector(`#hw-list-body [data-row="${id}"] .hwl-actions`);
    if (cell) cell.innerHTML = '<span style="font-size:10px;color:#9ca3af;font-weight:800">Отменяю…</span>';
    let ok = false;
    try {
        ok = _hwlCtx.mode === 'student'
            ? await window.cancelStudentAssignment(_hwlCtx.uid, id)
            : await window.cancelClassAssignment(_hwlCtx.code, id);
    } catch (e) { console.error(e); }
    if (ok) {
        _hwListCache = _hwListCache.filter(a => a.id !== id);
        _hwlPaint();
        showToast('🗑', _hwlCtx.mode === 'student' ? 'ДЗ отменено у ученика.' : 'ДЗ отменено. Ученики обновят при входе.', 'bg-emerald-500', 'border-emerald-700');
    } else {
        showToast('❌', 'Не удалось отменить ДЗ', 'bg-rose-500', 'border-rose-700');
        _hwlPaint();
    }
};
window._hwlAskCancelAll = function() {
    const actions = document.getElementById('hw-list-actions');
    if (!actions) return;
    actions.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;justify-content:center;flex-wrap:wrap">
        <span style="font-size:11px;color:#6b7280;font-weight:800">Отменить все${_hwlCtx.mode === 'student' ? ' у ученика' : ''}?</span>
        <button onclick="window._hwlDoCancelAll()" style="background:var(--c-danger,#e11d48);color:#fff;border:none;border-radius:9px;padding:7px 12px;font-size:11px;font-weight:900;cursor:pointer">Да, всё</button>
        <button onclick="window._hwlRepaint()" style="background:#eee;color:#444;border:none;border-radius:9px;padding:7px 12px;font-size:11px;font-weight:900;cursor:pointer">Нет</button>
      </div>`;
};
// «Снять долги до даты»: мягкий чистый лист — ДЗ после даты остаются в силе.
window._hwlSweepOld = async function() {
    const inp = document.getElementById('hwl-sweep-date');
    const dateStr = inp && inp.value;
    if (!dateStr) return showToast('⚠️', 'Выбери дату', 'bg-amber-500', 'border-amber-700');
    if (!window.sweepClassDebtsBefore) return showToast('⚠️', 'Нет подключения к серверу', 'bg-rose-500', 'border-rose-700');
    const actions = document.getElementById('hw-list-actions');
    if (actions) actions.innerHTML = `<div style="text-align:center;font-size:11px;color:#9ca3af;font-weight:800">Снимаю долги до ${dateStr}… (обхожу учеников класса)</div>`;
    let res = null;
    try { res = await window.sweepClassDebtsBefore(_hwlCtx.code, dateStr); } catch (e) { console.error(e); }
    await _hwlLoad();
    if (res) {
        showToast('🗓', `Долги до ${new Date(dateStr + 'T00:00:00').toLocaleDateString('ru-RU')} сняты: журнал −${res.journal}, очищено карточек учеников: ${res.students}.`, 'bg-emerald-500', 'border-emerald-700');
        if (window.loadClassProgress) window.loadClassProgress(); // кабинет пересчитает долги сразу
    } else {
        showToast('❌', 'Не удалось снять долги', 'bg-rose-500', 'border-rose-700');
    }
};

window._hwlDoCancelAll = async function() {
    const actions = document.getElementById('hw-list-actions');
    if (actions) actions.innerHTML = '<div style="text-align:center;font-size:11px;color:#9ca3af;font-weight:800">Отменяю все…</div>';
    let n = 0;
    try {
        n = _hwlCtx.mode === 'student'
            ? await window.cancelAllStudentAssignments(_hwlCtx.uid)
            : await window.cancelAllClassAssignments(_hwlCtx.code);
    } catch (e) { console.error(e); }
    await _hwlLoad();
    // Для класса счётчик журнала не показываем: снимаются и старые ДЗ, которых в журнале нет.
    showToast('🧹', _hwlCtx.mode === 'class'
        ? 'Чистый лист: все невыполненные ДЗ класса снимутся у учеников при следующем входе.'
        : `Отменено ДЗ: ${n}. Чистый лист.`, 'bg-emerald-500', 'border-emerald-700');
};

// Считать текущее состояние формы в черновик (чтобы переменные не сбрасывались при ре-рендере).
function _hwcSyncDraft() {
    const c = window._hwComposer; if (!c) return;
    const d = c.draft;
    const g = id => document.getElementById(id);
    if (g('hwc-task')) d.task = g('hwc-task').value;
    if (g('hwc-period')) d.period = g('hwc-period').value;
    if (g('hwc-metric')) d.metric = g('hwc-metric').value;
    if (g('hwc-goal')) d.goal = g('hwc-goal').value;
    if (g('hwc-year-start')) d.yearStart = parseInt(g('hwc-year-start').value) || 0;
    if (g('hwc-year-end')) d.yearEnd = parseInt(g('hwc-year-end').value) || 3000;
}
window._hwcSyncDraft = _hwcSyncDraft;

// Смена пресета периода: подставляем годы пресета в поля (поля всегда видны).
window._hwcPeriodChange = function() {
    const c = window._hwComposer; if (!c) return;
    _hwcSyncDraft();
    const preset = HWC_PERIOD_YEARS[c.draft.period];
    if (preset) { c.draft.yearStart = preset[0]; c.draft.yearEnd = preset[1]; }
    _renderHwComposer();
};

// Ручная правка годов → период становится «Свои годы».
window._hwcYearInput = function() {
    const c = window._hwComposer; if (!c) return;
    _hwcSyncDraft();
    c.draft.period = 'custom';
    const sel = document.getElementById('hwc-period');
    if (sel) sel.value = 'custom';
    _hwcAvail();
};

function _hwcAvail() {
    const c = window._hwComposer; if (!c) return;
    _hwcSyncDraft();
    const { task, period, metric, yearStart, yearEnd } = c.draft;
    const hint = document.getElementById('hwc-avail');
    // Зубрёжка: период/метрика не нужны — цель всегда «вызубрить N дат». Прячем лишние контролы.
    const isCram = task === 'cram';
    const periodRow = document.getElementById('hwc-period-row');
    const metricRow = document.getElementById('hwc-metric-row');
    if (periodRow) periodRow.style.display = isCram ? 'none' : '';
    if (metricRow) metricRow.style.display = isCram ? 'none' : '';
    // Год-диапазон («Годы от—до») показываем И для зубрёжки — это выбор дат для ДЗ.
    if (isCram) {
        c.draft.metric = 'learned';
        if (hint) {
            let ys2 = Number(yearStart) || 862, ye2 = Number(yearEnd) || 2026;
            if (ys2 > ye2) { const t = ys2; ys2 = ye2; ye2 = t; }
            const narrowed = !(ys2 <= 862 && ye2 >= 2026);
            hint.style.display = '';
            hint.textContent = '⚡ Зубрёжка дат — считаю даты…';
            const token = (_hwcAvail._t = (_hwcAvail._t || 0) + 1);
            (window.cramDateCount ? window.cramDateCount(ys2, ye2) : Promise.resolve(null)).then(n => {
                if (_hwcAvail._t !== token) return; // пришёл устаревший ответ — игнорируем
                const h = document.getElementById('hwc-avail'); if (!h) return;
                if (n == null) { h.textContent = '⚡ Зубрёжка дат. Годы (от—до) необязательно: 862–2026 = все даты.'; return; }
                const scope = narrowed ? `диапазон ${ys2}–${ye2}` : 'все даты';
                h.textContent = `⚡ Зубрёжка дат · ${scope}: ${_ruDates(n)}. Цель — сколько из них вызубрить.`;
            });
        }
        return;
    }
    if (!hint) return;
    const isCustom = period === 'custom';
    const ys = isCustom ? yearStart : undefined, ye = isCustom ? yearEnd : undefined;
    if (metric === 'learned' && window.learnedCountInPeriod) {
        const { total } = window.learnedCountInPeriod(task, period, ys, ye);
        hint.textContent = `Доступно фактов: ${total}`;
        hint.style.display = '';
    } else if (isCustom) {
        const cfg = window.TASK_CONFIG && window.TASK_CONFIG[task];
        if (cfg && cfg.data) {
            const count = cfg.data().filter(f => { const y = getYearFromFact(f); return y >= yearStart && y <= yearEnd; }).length;
            hint.textContent = `Фактов в диапазоне ${yearStart}–${yearEnd}: ${count}`;
            hint.style.display = '';
        } else { hint.style.display = 'none'; }
    } else { hint.style.display = 'none'; }
}
window._hwcAvail = _hwcAvail;

window._hwcAddItem = function() {
    const c = window._hwComposer; if (!c) return;
    _hwcSyncDraft();
    const { task, period, metric } = c.draft;
    let goal = parseInt(c.draft.goal);
    if (isNaN(goal) || goal <= 0) return showToast('⚠️', 'Укажите цель (> 0)', 'bg-rose-500', 'border-rose-700');
    // Зубрёжка — отдельный этап без периода: «вызубрить N дат» (любые блоки тренажёра).
    if (task === 'cram') {
        const cit = { task: 'cram', metric: 'learned', goal };
        // Диапазон лет для зубрёжки (необязательно): сохраняем, только если сужен относительно полного 862–2026.
        const ys = c.draft.yearStart, ye = c.draft.yearEnd;
        if (ys && ye && !(ys <= 862 && ye >= 2026)) { cit.yearStart = Math.min(ys, ye); cit.yearEnd = Math.max(ys, ye); }
        c.items.push(cit);
        c.draft.goal = '';
        return _renderHwComposer();
    }
    const item = { task, period, metric, goal };
    if (period === 'custom') {
        item.yearStart = c.draft.yearStart;
        item.yearEnd = c.draft.yearEnd;
        if (item.yearStart > item.yearEnd) return showToast('⚠️', 'Начальный год больше конечного', 'bg-rose-500', 'border-rose-700');
    }
    if (metric === 'learned' && window.learnedCountInPeriod) {
        const { total } = window.learnedCountInPeriod(task, period, item.yearStart, item.yearEnd);
        if (goal > total) goal = total;
        item.goal = goal;
    }
    c.items.push(item);
    c.draft.goal = ''; // сбрасываем только цель — остальное удобно оставить для следующего этапа
    _renderHwComposer();
};
window._hwcRemoveItem = function(i) { if (window._hwComposer) { _hwcSyncDraft(); window._hwComposer.items.splice(i, 1); _renderHwComposer(); } };
window._hwcSetDeadline = function(days) {
    const c = window._hwComposer; if (!c) return;
    _hwcSyncDraft();
    if (days === null) c.deadline = null;
    else { const d = new Date(); d.setDate(d.getDate() + days); c.deadline = d.toISOString().split('T')[0]; }
    _renderHwComposer();
};
window._hwcSetDeadlineDate = function(val) { if (window._hwComposer) window._hwComposer.deadline = val || null; };

window._hwcSubmit = function() {
    const c = window._hwComposer; if (!c) return;
    if (!c.items.length) return showToast('⚠️', 'Добавьте хотя бы один этап', 'bg-rose-500', 'border-rose-700');
    const overlay = document.getElementById('hw-composer-overlay');
    if (overlay) overlay.remove();
    if (c.target.type === 'class') {
        if (window._assignBundleToClassDb) window._assignBundleToClassDb(c.items, c.deadline, null);
    } else {
        if (window._assignBundleToStudentDb) window._assignBundleToStudentDb(c.target.id, c.items, c.deadline, null);
    }
    window._hwComposer = null;
};

function _renderHwComposer() {
    const c = window._hwComposer;
    const overlay = document.getElementById('hw-composer-overlay');
    if (!c || !overlay) return;
    const targetName = c.target.type === 'class'
        ? `Весь класс — ${c.target.count} ${c.target.count === 1 ? 'ученик' : 'учеников'}`
        : c.target.name;
    const metricUnit = { lines: 'строк', points: 'баллов', learned: 'фактов' };
    const taskShort = { task1: '⏳№1', task3: '🔗№3', task4: '📍№4', task5: '👤№5', task7: '🎨№7', cram: '⚡Зубрёжка' };
    const periodShort = Object.fromEntries(HWC_PERIODS.map(p => [p.v, p.t]));
    const itemScope = it => it.task === 'cram'
        ? (it.yearStart && it.yearEnd ? `даты ${it.yearStart}–${it.yearEnd} гг.` : 'даты (любые блоки)')
        : (it.period === 'custom' ? (it.yearStart || '?') + '–' + (it.yearEnd || '?') + ' гг.' : (periodShort[it.period] || it.period));

    const itemsHtml = c.items.length ? c.items.map((it, i) => `
        <div style="display:flex;align-items:center;gap:8px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:10px;padding:8px 10px;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:800;color:#111" class="dark:text-gray-100">Этап ${i + 1}: ${taskShort[it.task] || it.task}</div>
            <div style="font-size:10px;color:#6b7280">${it.goal} ${metricUnit[it.metric]} · ${itemScope(it)}</div>
          </div>
          <button onclick="window._hwcRemoveItem(${i})" style="background:none;border:none;color:var(--c-danger);font-size:16px;cursor:pointer;padding:2px 6px">🗑</button>
        </div>`).join('')
        : '<div style="font-size:12px;color:#9ca3af;text-align:center;padding:10px 0">Этапов пока нет — добавьте ниже</div>';

    const d = c.draft;
    const sel = (id, opts, onchange, selected) => `<select id="${id}" ${onchange ? `onchange="${onchange}"` : ''} style="width:100%;padding:9px;border:1px solid rgba(128,128,128,0.3);border-radius:10px;font-size:12px;font-weight:700;background:#fff;color:#111">${opts.map(o => `<option value="${o.v}"${o.v === selected ? ' selected' : ''}>${o.t}</option>`).join('')}</select>`;

    const dl = c.deadline;
    const dlBtn = (label, days) => {
        const active = (days === null && !dl) || (days !== null && dl === (() => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; })());
        return `<button onclick="window._hwcSetDeadline(${days})" style="flex:1;padding:8px;border-radius:9px;font-size:11px;font-weight:800;cursor:pointer;border:1px solid ${active ? '#7c3aed' : 'rgba(128,128,128,0.3)'};background:${active ? '#f5f3ff' : '#fff'};color:${active ? '#6d28d9' : '#6b7280'}">${label}</button>`;
    };

    overlay.innerHTML = `
    <div style="background:#f7f7f8;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;border-radius:24px 24px 0 0;padding:18px 16px 28px;box-shadow:0 -8px 40px rgba(0,0,0,0.25)" class="dark:bg-[#141414]">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:16px;font-weight:900;color:#111" class="dark:text-white">📝 Новое ДЗ</div>
        <button onclick="document.getElementById('hw-composer-overlay').remove()" style="font-size:22px;color:#aaa;background:none;border:none;cursor:pointer;padding:2px 8px">✕</button>
      </div>
      <div style="font-size:12px;color:#6b7280;font-weight:700;margin-bottom:12px">${targetName}</div>

      <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin-bottom:6px">Этапы (решаются по очереди)</div>
      ${itemsHtml}

      <div style="background:var(--card,#fff);border:1px solid rgba(128,128,128,0.18);border-radius:14px;padding:12px;margin:10px 0" class="dark:bg-[#1e1e1e]">
        <div style="margin-bottom:8px">${sel('hwc-task', HWC_TASKS, 'window._hwcAvail()', d.task)}</div>
        <div id="hwc-period-row" style="margin-bottom:8px">${sel('hwc-period', HWC_PERIODS, 'window._hwcPeriodChange()', d.period)}</div>
        <div id="hwc-year-row">
          <label style="display:block;font-size:10px;color:#9ca3af;font-weight:700;margin-bottom:4px">Годы (от — до)</label>
          <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:8px">
            <input id="hwc-year-start" type="number" inputmode="numeric" min="800" max="2030" value="${d.yearStart}" placeholder="от" oninput="window._hwcYearInput()" style="width:100%;padding:8px;border:1px solid rgba(128,128,128,0.3);border-radius:10px;font-size:13px;font-weight:800;text-align:center;background:#fff;color:#111">
            <span style="font-size:12px;color:#9ca3af;font-weight:800">—</span>
            <input id="hwc-year-end" type="number" inputmode="numeric" min="800" max="2030" value="${d.yearEnd}" placeholder="до" oninput="window._hwcYearInput()" style="width:100%;padding:8px;border:1px solid rgba(128,128,128,0.3);border-radius:10px;font-size:13px;font-weight:800;text-align:center;background:#fff;color:#111">
          </div>
        </div>
        <div id="hwc-metric-row" style="margin-bottom:8px">${sel('hwc-metric', HWC_METRICS, 'window._hwcAvail()', d.metric)}</div>
        <label style="display:block;font-size:10px;color:#9ca3af;font-weight:700;margin-bottom:4px">Цель (сколько)</label>
        <input id="hwc-goal" type="number" inputmode="numeric" min="1" placeholder="N" value="${d.goal}" oninput="window._hwcSyncDraft()" style="width:100%;padding:9px;border:1px solid rgba(128,128,128,0.3);border-radius:10px;font-size:13px;font-weight:800;text-align:center;background:#fff;color:#111">
        <div id="hwc-avail" style="display:none;font-size:10px;color:var(--c-brand-strong);font-weight:700;margin-top:6px"></div>
        <button onclick="window._hwcAddItem()" style="margin-top:10px;width:100%;background:rgba(59,130,246,0.12);color:var(--c-brand-strong);border:1px dashed var(--c-brand);border-radius:10px;padding:10px;font-size:12px;font-weight:900;cursor:pointer">＋ Добавить этап</button>
      </div>

      <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin:8px 0 6px">Срок сдачи</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        ${dlBtn('3 дня', 3)} ${dlBtn('Неделя', 7)} ${dlBtn('2 нед.', 14)} ${dlBtn('Без срока', null)}
      </div>
      <input type="date" value="${dl || ''}" onchange="window._hwcSetDeadlineDate(this.value)" style="width:100%;padding:9px;border:1px solid rgba(128,128,128,0.3);border-radius:10px;font-size:12px;margin-bottom:14px">

      <button onclick="window._hwcSubmit()" style="width:100%;background:var(--c-success);color:#fff;border:none;border-radius:14px;padding:14px;font-size:14px;font-weight:900;cursor:pointer">
        ✅ Выдать ДЗ${c.items.length ? ` (${c.items.length} этап.)` : ''}
      </button>
    </div>`;
    _hwcAvail();
}

// Свежий заход на ПК (не из Telegram, без личности и прогресса). Считаем ЛОКАЛЬНО,
// не через window.isPcWebFresh — тот живёт в ES-модуле и может ещё не загрузиться к
// моменту checkOnboarding (классический скрипт выполняется раньше модуля).
function _isPcWebFreshLocal() {
    try {
        // Строго «реально в Telegram»: непустой initData ИЛИ наличие user. НЕ проверяем
        // was_telegram_device — SDK-стаб выставляет его '1' в любом браузере (ложно-«телеграмный»).
        const tg = window.Telegram && window.Telegram.WebApp;
        const inTg = !!(tg && ((tg.initData && String(tg.initData).length > 0) || (tg.initDataUnsafe && tg.initDataUnsafe.user)));
        if (inTg) return false;
        if (localStorage.getItem('known_tg_id') || localStorage.getItem('google_uid')) return false;
        const solved = (window.state && window.state.stats && window.state.stats.totalSolvedEver) || 0;
        return solved === 0;
    } catch (e) { return false; }
}
function checkOnboarding() {
    if (localStorage.getItem('ege_onboarding_done')) return;
    // Свежий заход на ПК (не из Telegram) — сначала спросим, есть ли уже аккаунт.
    if (_isPcWebFreshLocal()) { showPcWelcome(); return; }
    $('onboarding-overlay').classList.remove('hidden');
    $('onboarding-overlay').classList.add('flex');
}

function showPcWelcome() {
    const ov = $('pc-welcome-overlay'); if (!ov) return;
    if ($('pcw-choice')) $('pcw-choice').classList.remove('hidden');
    if ($('pcw-qr')) $('pcw-qr').classList.add('hidden');
    ov.classList.remove('hidden'); ov.classList.add('flex');
}
function hidePcWelcome() {
    const ov = $('pc-welcome-overlay'); if (!ov) return;
    ov.classList.add('hidden'); ov.classList.remove('flex');
    if (window.cancelPcLoginSession) window.cancelPcLoginSession();
}
window.pcwHasAccount = async function() {
    haptic('light');
    $('pcw-choice').classList.add('hidden');
    $('pcw-qr').classList.remove('hidden');
    const img = $('pcw-qr-img'), status = $('pcw-qr-status');
    if (img) img.innerHTML = '<div class="text-xs text-gray-400 font-bold">Генерирую код…</div>';
    if (status) { status.textContent = '⏳ Жду подтверждения из Telegram…'; status.className = 'text-xs font-black text-amber-600 dark:text-amber-400 mb-3'; }
    let link = null;
    if (window.startPcLoginSession) {
        link = await window.startPcLoginSession(() => {
            localStorage.setItem('ege_onboarding_done', '1');
            const st = $('pcw-qr-status');
            if (st) { st.textContent = '✅ Есть! Прогресс загружен'; st.className = 'text-xs font-black text-emerald-600 dark:text-emerald-400 mb-3'; }
            setTimeout(() => { hidePcWelcome(); if (window.showToast) showToast('✅', 'С возвращением! Прогресс из Telegram загружен', 'bg-emerald-500', 'border-emerald-700'); }, 900);
        });
    }
    if (!link) {
        if (img) img.innerHTML = '<div class="text-xs text-rose-500 font-bold px-4">Не удалось создать код — проверь интернет и нажми «Назад», потом снова.</div>';
        return;
    }
    if (img) {
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=' + encodeURIComponent(link);
        img.innerHTML = '';
        const el = document.createElement('img');
        el.width = 210; el.height = 210; el.alt = 'QR';
        el.style.cssText = 'border-radius:12px;background:#fff;padding:8px';
        el.src = qrSrc;
        el.onerror = () => {
            // QR-сервис недоступен — показываем ссылку кликом (открыть в этом же браузере нельзя,
            // т.к. это t.me; но можно скопировать). Правильнее — воспользоваться /pc из подсказки ниже.
            const a = document.createElement('a');
            a.href = link; a.target = '_blank'; a.textContent = link;
            a.style.cssText = 'font-size:11px;word-break:break-all;color:#2563eb';
            img.innerHTML = ''; img.appendChild(a);
        };
        img.appendChild(el);
    }
};
window.pcwNewUser = function() {
    haptic('light');
    if (window.cancelPcLoginSession) window.cancelPcLoginSession();
    const ov = $('pc-welcome-overlay'); if (ov) { ov.classList.add('hidden'); ov.classList.remove('flex'); }
    // Обычный онбординг: слайд с именем.
    $('onboarding-overlay').classList.remove('hidden');
    $('onboarding-overlay').classList.add('flex');
};
window.pcwBack = function() {
    haptic('light');
    if (window.cancelPcLoginSession) window.cancelPcLoginSession();
    $('pcw-qr').classList.add('hidden');
    $('pcw-choice').classList.remove('hidden');
};
window.nextOnbStep = function(step) {
    haptic('light');
    for (let i = 1; i <= 6; i++) {
        const s = $('onb-step-' + i); if (s) s.classList.toggle('hidden', i !== step);
        const d = $('onb-dot-' + i); if (d) { 
            d.classList.toggle('bg-blue-500', i === step); 
            d.classList.toggle('bg-gray-300', i !== step && i > step); 
            d.classList.toggle('bg-blue-200', i < step);
            d.classList.toggle('dark:bg-gray-600', i !== step);
        }
    }
};
window.finishOnboarding = function() {
    haptic('medium');
    // Класс назначает учитель по ссылке-приглашению; ученик вводит только имя.
    const onbName = $('onb-name-input') ? $('onb-name-input').value.trim() : '';
    const assignedClass = localStorage.getItem('student_class_code') || '';
    if (onbName) { localStorage.setItem('student_manual_name', onbName); localStorage.setItem('student_manual_name_at', String(Date.now())); }
    localStorage.setItem('ege_onboarding_done', '1');
    $('onboarding-overlay').classList.add('hidden');
    $('onboarding-overlay').classList.remove('flex');
    if (onbName || assignedClass) {
        if (window.syncProgressToCloud) window.syncProgressToCloud();
        showToast('✅', 'Профиль сохранён! Удачи на ЕГЭ!', 'bg-emerald-500', 'border-emerald-700');
    }
    if (assignedClass && window.pullClassAssignments) window.pullClassAssignments(assignedClass);
};

// === PULL-TO-REFRESH ===
document.addEventListener('app:ready', function initPullToRefresh() {
    let startY = 0, pulling = false;
    const lobby = document.getElementById('lobby-area');
    if (!lobby) return;
    lobby.addEventListener('touchstart', function(e) {
        if (window.scrollY === 0 && !document.body.classList.contains('in-game')) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });
    lobby.addEventListener('touchmove', function(e) {
        if (!pulling) return;
        const diff = e.touches[0].clientY - startY;
        if (diff > 80) {
            pulling = false;
            if (typeof haptic === 'function') haptic('medium');
            if (window.loadProgressFromCloud) window.loadProgressFromCloud();
            if (typeof updateProgressBars === 'function') updateProgressBars();
            if (typeof updateGlobalUI === 'function') updateGlobalUI();
            showToast('🔄', 'Обновлено!', 'bg-blue-500', 'border-blue-700');
        }
    }, { passive: true });
    lobby.addEventListener('touchend', function() { pulling = false; }, { passive: true });
}, { once: true });

document.addEventListener('app:ready', function() {
    patchHeaderDOM();
    if (typeof updateGlobalUI === 'function') updateGlobalUI();
    // data.js уже загружен — можно корректно посчитать дела
    if (typeof window.refreshDetectiveCaseOptions === 'function') window.refreshDetectiveCaseOptions();
}, { once: true });

// Обновляет лейблы опций в #pg-filter-case, добавляя счётчик «N дел».
// Категории с числом дел < MIN_CASES_TO_SHOW скрываются, остальные получают пометку «· N дел».
// Чтобы вернуть одиночные категории — изменить MIN_CASES_TO_SHOW на 1.
window.refreshDetectiveCaseOptions = function() {
    const MIN_CASES_TO_SHOW = 2;
    const select = $('pg-filter-case');
    if (!select || typeof detectiveCases === 'undefined') return;
    Array.from(select.options).forEach(opt => {
        // Сохраняем исходный текст один раз
        if (!opt.dataset.baseLabel) opt.dataset.baseLabel = opt.textContent.replace(/\s·\s.*$/, '').trim();
        const key = opt.value;
        const arr = detectiveCases[key];
        const count = Array.isArray(arr) ? arr.length : 0;
        if (count < MIN_CASES_TO_SHOW) {
            opt.hidden = true;
            opt.disabled = true;
            opt.textContent = opt.dataset.baseLabel + (count === 0 ? ' · пусто' : ' · 1 дело');
        } else {
            opt.hidden = false;
            opt.disabled = false;
            opt.textContent = opt.dataset.baseLabel + ` · ${count} дел`;
        }
    });
    // Если текущий выбранный пункт оказался скрыт — переключимся на первый видимый
    if (select.selectedOptions[0] && select.selectedOptions[0].hidden) {
        const firstVisible = Array.from(select.options).find(o => !o.hidden);
        if (firstVisible) {
            select.value = firstVisible.value;
            // Синхронизируем системный #filter-case, чтобы игра стартовала с валидной категорией
            const sysSelect = $('filter-case');
            if (sysSelect) sysSelect.value = firstVisible.value;
        }
    }
};

window.openGlobalSettings = function() {
    // Настройки блокируем только пока РЕШАЕШЬ ДЗ (activeHw / легаси-поток по ссылке),
    // а не при самом факте наличия ДЗ: раньше isHomeworkMode оставался true навсегда,
    // и настройки были заперты «режимом ДЗ» даже без единого задания.
    if (window.state.activeHw || (window.state.isHomeworkMode && window.state.hwTargetIndices && window.state.hwTargetIndices.length > 0)) {
        if (typeof showToast === 'function') showToast('🔒', 'В режиме ДЗ настройки задаёт преподаватель', 'bg-indigo-500', 'border-indigo-700');
        return;
    }
    $('pre-game-title').innerText = 'Глобальные настройки';
    window.refreshDetectiveCaseOptions();
    
    $('pg-period-container').classList.remove('hidden');
    $('pg-rows-container').classList.remove('hidden');
    $('pg-case-container').classList.add('hidden'); 
    if ($('pg-hide-learned-container')) $('pg-hide-learned-container').classList.add('hidden');
    
    if (window.state.currentMode === 'detective') {
        $('pg-period-container').classList.add('hidden');
        $('pg-rows-container').classList.add('hidden');
        if ($('pg-hide-learned-container')) $('pg-hide-learned-container').classList.add('hidden');
        $('pg-case-container').classList.remove('hidden');
    }
    if (window.state.currentMode === 'redpencil') {
        $('pg-rows-container').classList.add('hidden');
    }
    
    if ($('filter-period')) $('pg-filter-period').value = $('filter-period').value || 'all';
    if ($('filter-case')) $('pg-filter-case').value = $('filter-case').value || 'rtw';
    if ($('filter-rows')) window.setPgRows($('filter-rows').value || '4');
    
    if ($('pg-filter-period').value === 'custom') {
        if (!$('pg-custom-year-start').value || $('pg-custom-year-start').value === '0') $('pg-custom-year-start').value = '862';
        if (!$('pg-custom-year-end').value || $('pg-custom-year-end').value === '0') $('pg-custom-year-end').value = '2026';
    }
    checkCustomPeriod(); 
    showModal('pre-game-modal'); 
    setTimeout(() => $('pg-sheet').classList.remove('translate-y-full'), 10);
};

window.closePreGameModal = function() { hideModal('pre-game-modal'); $('pg-sheet').classList.add('translate-y-full'); };
window.checkCustomPeriod = function() {
    const isCustom = $('pg-filter-period').value === 'custom';
    $('pg-custom-period-container').classList.toggle('hidden', !isCustom);
    // Кнопка «точные годы» видна при любой выбранной эпохе — новички должны знать,
    // что период можно задать годами, даже если случайно выбрали век.
    const yrBtn = $('pg-year-range-btn');
    if (yrBtn) yrBtn.classList.toggle('hidden', isCustom);
    // Чип «как в классе» — если учитель отметил «дошли до года».
    const upto = parseInt(localStorage.getItem('class_current_upto'), 10);
    const clsBtn = $('pg-class-upto-btn');
    if (clsBtn) {
        const show = upto >= 862 && upto <= 2026;
        clsBtn.classList.toggle('hidden', !show);
        if (show && $('pg-class-upto-year')) $('pg-class-upto-year').textContent = upto;
    }
};

// «Задать точные годы»: переключаем эпоху → свой период, преднаполняем границы выбранной эпохи.
window.pgShowYearRange = function() {
    haptic('light');
    const sel = $('pg-filter-period');
    const era = sel.value;
    const y = (window.EPOCH_YEARS && window.EPOCH_YEARS[era]) || [862, 2026];
    sel.value = 'custom';
    $('pg-custom-year-start').value = y[0];
    $('pg-custom-year-end').value = y[1];
    checkCustomPeriod();
};

// «Как в классе»: диапазон 862..«дошли до» (граница потока от учителя).
window.pgApplyClassUpto = function() {
    haptic('light');
    const upto = parseInt(localStorage.getItem('class_current_upto'), 10);
    if (!(upto >= 862 && upto <= 2026)) return;
    $('pg-filter-period').value = 'custom';
    $('pg-custom-year-start').value = 862;
    $('pg-custom-year-end').value = upto;
    checkCustomPeriod();
    showToast('🏫', `Период класса: 862–${upto} гг.`, 'bg-indigo-500', 'border-indigo-700');
};
window.setPgRows = function(rows) { $$('.pg-row-btn').forEach(btn => btn.className = "pg-row-btn bg-white border-gray-200 text-gray-600 dark:bg-[#2c2c2c] dark:border-[#3f3f46] dark:text-gray-400 border-2 rounded-xl py-3 font-black text-sm transition-colors"); const active = $(`btn-row-${rows}`); if (active) active.className = "pg-row-btn bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-2 rounded-xl py-3 font-black text-sm transition-colors"; $('filter-rows').value = rows; };

window.applyGlobalSettings = function() {
    haptic('medium');
    $('filter-period').value = $('pg-filter-period').value;
    $('custom-year-start').value = $('pg-custom-year-start').value;
    $('custom-year-end').value = $('pg-custom-year-end').value;
    $('filter-case').value = $('pg-filter-case').value;
    // Ученик явно выбрал период — теперь плашка показывает выбранные годы вместо «Выбрать период».
    window.state.periodChosen = true;
    try { localStorage.setItem('ege_period_chosen', '1'); } catch (e) {}

    saveProgress();
    closePreGameModal();
    
    if (document.body.classList.contains('in-game')) {
        window.handleSettingsChange();
    } else {
        showToast('⚙️', 'Настройки сохранены', 'bg-blue-500', 'border-blue-700');
    }
};

function toggleTheme() {
    const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    if (typeof window.applyEgeTheme === 'function') {
        window.applyEgeTheme(nextTheme, true);
    } else {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark');
        localStorage.setItem('ege_theme', nextTheme);
    }
}

/* ──────────────────────────────────────────────────────────
   ТЕМА — только классика (2026-07-18). Класс skin-classic задан прямо на <body>
   в index.html и не зависит от загрузки JS: раньше его вешал этот файл, и пока
   скрипты качались (или один оборвался), лобби стояло «авророй» с мёртвыми
   кнопками. Пикер тем удалён из профиля; чужой сохранённый выбор игнорируем.
   ────────────────────────────────────────────────────────── */
(function() {
    // У старых пользователей мог остаться выбранный скин — принудительно классика.
    document.body.classList.add('skin-classic');
    ['aurora','constructivism','coffee','sakura','forest','scholar']
        .forEach(s => document.body.classList.remove('skin-' + s));
    localStorage.setItem('ege_skin', 'classic');
})();


window.toggleFocusMode = function() {
    window.state.focusMode = !window.state.focusMode; 
    const header = $('main-header'), bottomNav = $('bottom-nav'), body = document.body;
    
    if (window.state.focusMode) { 
        body.classList.add('zen-mode-active'); 
        header.classList.add('hidden'); 
        bottomNav.classList.add('hide-nav'); 
        if (!body.classList.contains('in-game')) body.classList.add('in-game'); 
        showToast('🧘', 'Режим Дзен активирован', 'bg-teal-500', 'border-teal-700'); 
    } else { 
        body.classList.remove('zen-mode-active'); 
        header.classList.remove('hidden'); 
        if (!$('lobby-area').classList.contains('hidden')) { 
            bottomNav.classList.remove('hide-nav'); 
            body.classList.remove('in-game'); 
        }
        showToast('🧘', 'Дзен отключен', 'bg-gray-500', 'border-gray-700'); 
    }
    window.updateZenButton();
};

function toggleHideLearned() { window.state.hideLearned = $('toggle-hide-learned').checked; saveProgress(); handleSettingsChange(); }

window.startHwFromBanner = function() {
    // Баннер теперь открывает вкладку ДЗ со списком заданий
    if (window.openHwTab) return window.openHwTab();
    haptic('light');
    const s = window.state.stats;
    const tasks = [
        { key: 'task1', cnt: s.hwTask1||0 },
        { key: 'task3', cnt: s.hwTask3||0 },
        { key: 'task4', cnt: s.hwTask4||0 },
        { key: 'task5', cnt: s.hwTask5||0 },
        { key: 'task7', cnt: s.hwTask7||0 },
    ];
    const best = tasks.reduce((a,b) => b.cnt > a.cnt ? b : a, tasks[0]);
    quickStartGame(best.cnt > 0 ? best.key : 'task4', 'normal');
};

window.showHwTasksSequential = function() {
    haptic('light');
    const s = window.state.stats;
    const tasks = [];
    if ((s.hwTask1||0) > 0) tasks.push({ key: 'task1', emoji: '⏳', name: 'Задание №1 — Хронология', cnt: s.hwTask1 });
    if ((s.hwTask3||0) > 0) tasks.push({ key: 'task3', emoji: '🔗', name: 'Задание №3 — Процессы', cnt: s.hwTask3 });
    if ((s.hwTask4||0) > 0) tasks.push({ key: 'task4', emoji: '📍', name: 'Задание №4 — География', cnt: s.hwTask4 });
    if ((s.hwTask5||0) > 0) tasks.push({ key: 'task5', emoji: '👤', name: 'Задание №5 — Личности', cnt: s.hwTask5 });
    if ((s.hwTask7||0) > 0) tasks.push({ key: 'task7', emoji: '🎨', name: 'Задание №7 — Культура', cnt: s.hwTask7 });
    if (!tasks.length) return;

    const total = tasks.reduce((a, t) => a + t.cnt, 0);
    const dlRaw = localStorage.getItem('teacher_hw_deadline');
    const dlStr = dlRaw ? ' · срок: ' + new Date(dlRaw + 'T00:00:00').toLocaleDateString('ru-RU', {day:'numeric',month:'long'}) : '';

    const overlayId = 'hw-seq-overlay';
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;padding:0';
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }

    let idx = 0;
    function renderStep() {
        const t = tasks[idx];
        const isLast = idx === tasks.length - 1;
        overlay.innerHTML = `
        <div style="background:#fff;width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:20px 20px 28px;box-shadow:0 -8px 40px rgba(0,0,0,0.2)" class="dark:bg-[#1e1e1e]">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <div>
              <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#9ca3af">Домашнее задание</div>
              <div style="font-size:13px;font-weight:900;color:#111;margin-top:2px" class="dark:text-white">${t.emoji} ${t.name}</div>
            </div>
            <button onclick="document.getElementById('${overlayId}').remove()" style="font-size:20px;color:#aaa;background:none;border:none;cursor:pointer;padding:4px 8px">✕</button>
          </div>

          <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:14px;padding:14px 16px;margin-bottom:14px">
            <div style="font-size:28px;font-weight:900;color:var(--c-danger);line-height:1">${t.cnt} <span style="font-size:14px;font-weight:600;color:#9ca3af">строк</span></div>
            <div style="font-size:11px;color:#9ca3af;margin-top:4px">Задание ${idx+1} из ${tasks.length} · всего ${total} строк${dlStr}</div>
            <div style="display:flex;gap:4px;margin-top:10px">
              ${tasks.map((tt, i) => `<div style="flex:1;height:4px;border-radius:2px;background:${i < idx ? 'var(--c-success)' : i === idx ? 'var(--c-danger)' : 'rgba(0,0,0,0.1)'}"></div>`).join('')}
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px">
            <button onclick="(function(){document.getElementById('${overlayId}').remove();quickStartGame('${t.key}','normal');})()"
              style="width:100%;background:var(--c-danger);color:#fff;border:none;border-radius:14px;padding:14px;font-size:14px;font-weight:900;cursor:pointer;letter-spacing:.02em">
              ▶ Начать ${t.emoji} ${t.name}
            </button>
            ${!isLast ? `<button onclick="(function(){window._hwSeqIdx=(window._hwSeqIdx||0)+1;document.getElementById('${overlayId}')._nextStep&&document.getElementById('${overlayId}')._nextStep();})()"
              style="width:100%;background:rgba(0,0,0,0.05);color:#374151;border:none;border-radius:14px;padding:12px;font-size:13px;font-weight:700;cursor:pointer" class="dark:bg-white/10 dark:text-gray-300">
              Следующее задание →
            </button>` : ''}
          </div>
        </div>`;
        overlay._nextStep = () => { idx = Math.min(idx + 1, tasks.length - 1); renderStep(); };
    }
    renderStep();
};

// ── Вкладка «ДЗ» ученика: набор подзаданий (этапов) с автопереходом ──
const HW_TASK_META = {
    task1: { emoji: '⏳', name: 'Задание №1 — Хронология' },
    task3: { emoji: '🔗', name: 'Задание №3 — Процессы' },
    task4: { emoji: '📍', name: 'Задание №4 — География' },
    task5: { emoji: '👤', name: 'Задание №5 — Личности' },
    task7: { emoji: '🎨', name: 'Задание №7 — Культура' },
    cram:  { emoji: '⚡', name: 'Зубрёжка дат' }
};
const HW_PERIOD_LABEL = { all: 'Вся история', early: 'До XVIII в.', '18th': 'XVIII век', '19th': 'XIX век', '20th': 'XX век', custom: 'Свои годы' };
const HW_METRIC_META = {
    lines:   { unit: 'строк',  verb: 'Решить',  mode: 'normal', color: 'var(--c-brand)' },
    points:  { unit: 'баллов', verb: 'Набрать', mode: 'normal', color: 'var(--c-purple)' },
    // Выучивание идёт В САМОМ ЗАДАНИИ (строки 3/4/5/7): ученик «заходит решать», факты периода
    // учитываются общей системой приложения (isFactLearned). Уже выученные — автозачёт. Прогресс — живой счёт.
    learned: { unit: 'фактов', verb: 'Выучить', mode: 'normal', color: 'var(--c-success)' }
};

// Плашка прогресса режима выучивания (learned-ДЗ): показывается на игровом экране над заданием.
window.hwLearnBannerHtml = function() {
    const ah = window.state.activeHw;
    if (!ah) return '';
    const a = (window.state.stats.assignments || []).find(x => x.id === ah.id);
    if (!a) return '';
    const it = (a.items || [])[ah.itemIndex];
    if (!it || it.metric !== 'learned') return '';
    const done = window.hwItemProgress(it), goal = it.goal || 0;
    const pct = goal ? Math.round(done / goal * 100) : 0;
    return `<div style="width:100%;padding:8px 12px;margin-bottom:8px;background:rgba(16,185,129,0.10);border:1px solid rgba(16,185,129,0.35);border-radius:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:#059669;margin-bottom:5px">
        <span>📚 Выучивание · ДЗ</span><span>Выучено ${done} / ${goal}</span></div>
      <div style="height:7px;background:rgba(16,185,129,0.18);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--c-success);border-radius:6px;transition:width .3s"></div></div>
    </div>`;
};

// Показать/скрыть и обновить плашку выучивания на игровом экране (#hw-learn-bar).
window.updateHwLearnBar = function() {
    const el = document.getElementById('hw-learn-bar');
    if (!el) return;
    const html = window.hwLearnBannerHtml();
    if (html) { el.innerHTML = html; el.classList.remove('hidden'); }
    else { el.innerHTML = ''; el.classList.add('hidden'); }
};

// Человекочитаемое название текущего периода (учитывает кастомные годы).
window.currentPeriodLabel = function() {
    const p = ($('filter-period') && $('filter-period').value) || 'all';
    if (p === 'custom') {
        const a = ($('custom-year-start') && $('custom-year-start').value) || '?';
        const b = ($('custom-year-end') && $('custom-year-end').value) || '?';
        return `${a}–${b} гг.`;
    }
    return HW_PERIOD_LABEL[p] || 'Вся история';
};

// В обычном задании (НЕ ДЗ) показываем красивую плашку периода вместо шестерёнки.
window.updateGamePeriodChip = function() {
    const chip = document.getElementById('game-period-chip');
    const gear = document.getElementById('game-settings-btn');
    if (!chip || !gear) return;
    const inHw = !!window.state.activeHw || !!window.state.isHomeworkMode;
    if (inHw) {
        // В ДЗ всё задано преподавателем — прячем и плашку периода, и шестерёнку.
        chip.classList.add('hidden'); chip.classList.remove('flex');
        gear.classList.add('hidden');
        return;
    }
    const txt = document.getElementById('game-period-chip-text');
    // До первого осознанного выбора — призыв «Выбрать период»; после выбора ИЛИ когда
    // границу применило приложение (кнопка «Продолжить» по «дошли до») — реальные годы.
    const chosen = window.state.periodChosen || window.state._wpApplied
        || (() => { try { return localStorage.getItem('ege_period_chosen') === '1'; } catch (e) { return false; } })();
    if (txt) txt.textContent = chosen ? window.currentPeriodLabel() : 'Период';
    gear.classList.add('hidden');
    chip.classList.remove('hidden'); chip.classList.add('flex');
};

// ── Режим «Зубрёжка» (изолированный iframe cram.html) ──
// Открываем полноэкранный тренажёр дат. Необязательный arg — id колоды (для ДЗ-диплинка).
// Сколько дат в диапазоне для зубрёжки: данные дат лежат в cram.html (<script id="app-data">),
// поэтому подгружаем их один раз и считаем тем же правилом, что и buildPeriodDeck в тренажёре.
let _cramEventsCache = null;
let _cramEventsPromise = null;
async function _loadCramEvents() {
    if (_cramEventsCache) return _cramEventsCache;
    if (_cramEventsPromise) return _cramEventsPromise;
    _cramEventsPromise = (async () => {
    try {
        const html = await (await fetch('cram.html', { cache: 'force-cache' })).text();
        const m = html.match(/<script[^>]*id="app-data"[^>]*>([\s\S]*?)<\/script>/);
        const data = m ? JSON.parse(m[1]) : {};
        _cramEventsCache = (data.events || []).filter(e => !e.isVov);
    } catch (e) { console.error('cramDateCount: не удалось загрузить даты', e); _cramEventsCache = []; }
    return _cramEventsCache;
    })();
    return _cramEventsPromise;
}
function _cramEventYear(e) {
    const pick = s => { const m = (String(s || '').match(/\d{3,4}/g) || []).map(Number).filter(y => y >= 800 && y <= 2100); return m.length ? m[0] : null; };
    let y = pick(e.date);
    if (y == null) y = pick((e.event || '') + ' ' + (e.know || ''));
    if (y == null) y = pick(e.section);
    return y;
}
window.cramDateCount = async function(from, to) {
    const evs = await _loadCramEvents();
    return evs.filter(e => { const y = _cramEventYear(e); return y != null && y >= from && y <= to; }).length;
};
function _refreshCramDependentUi() {
    if (window.refreshHwState) window.refreshHwState();
    if (window.updateGlobalUI) window.updateGlobalUI();
    if (window.updateHwNavBadge) window.updateHwNavBadge();
    const teacherModal = document.getElementById('teacher-modal');
    if (teacherModal && !teacherModal.classList.contains('hidden') && window.loadClassProgress) window.loadClassProgress();
}
window.cramEventIdsInRange = function(from, to) {
    const a = Number(from), b = Number(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (!_cramEventsCache) {
        _loadCramEvents().then(_refreshCramDependentUi);
        return null;
    }
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return new Set(_cramEventsCache
        .filter(e => { const y = _cramEventYear(e); return y != null && y >= lo && y <= hi; })
        .map(e => String(e.id)));
};
function _ruDates(n) {
    const a = Math.abs(n) % 100, b = n % 10;
    if (a >= 11 && a <= 14) return n + ' дат';
    if (b === 1) return n + ' дата';
    if (b >= 2 && b <= 4) return n + ' даты';
    return n + ' дат';
}

window.openCram = function(deckId) {
    haptic('light');
    const ov = document.getElementById('cram-overlay');
    const frame = document.getElementById('cram-frame');
    if (!ov || !frame) return;
    const hash = deckId ? ('#deck=' + encodeURIComponent(deckId)) : '';
    // ВАЖНО: при изменении только #hash (или том же URL) iframe НЕ перезагружается —
    // диплинк (startDeck) не срабатывает и остаётся старый экран (меню «Зубрёжки»).
    // Меняем не-фрагментную часть (?cb=…), чтобы каждый раз была полная перезагрузка:
    // диплинк отрабатывает всегда и подхватывается свежий прогресс «выучено».
    frame.src = 'cram.html?cb=' + Date.now() + hash;
    ov.style.display = ''; // сбрасываем инлайн display:none, если он остался от запасного выхода
    ov.classList.remove('hidden');
    document.body.classList.add('cram-open');
};

window.closeCram = function() {
    const ov = document.getElementById('cram-overlay');
    if (ov) { ov.classList.add('hidden'); ov.style.display = ''; }
    document.body.classList.remove('cram-open');
    // Прогресс «выучено» мог измениться — обновим интерфейс и ДЗ.
    if (window.refreshHwState) window.refreshHwState();
    if (window.updateGlobalUI) window.updateGlobalUI();
    if (window.updateHwNavBadge) window.updateHwNavBadge();
    // Этап-зубрёжка выполнен → сразу запускаем следующий этап ДЗ (иначе остаёмся в меню).
    // Только если зубрёжку открывали ИЗ ДЗ: выход из «просто зубрёжки» не должен
    // внезапно кидать ученика в застрявший этап старого ДЗ.
    if (window._cramHwFlow) {
        window._cramHwFlow = false;
        if (window.maybeAdvanceHw) window.maybeAdvanceHw();
    }
};

// Запасной канал выхода из iframe «Зубрёжки» (если прямой вызов closeCram недоступен).
window.addEventListener('message', function(e) {
    if (e && e.data && e.data.type === 'cram-exit') window.closeCram();
});

// Вызывается из iframe при полном освоении факта (фаза ввода пройдена).
// Засчитываем факт в общую систему «выучено» (factStreaks), чтобы он шёл в SRS и счётчик.
window.cramMastered = function(payload) {
    try {
        if (!payload || !payload.key || !window.state || !window.state.stats) return;
        const fs = window.state.stats.factStreaks = window.state.stats.factStreaks || {};
        const k = 'cram:' + String(payload.key);
        const now = Date.now();
        const cur = fs[k] || {};
        // Помечаем как выученный (level≥1, points≥3) с интервалом повторения ~3 дня.
        fs[k] = {
            points: Math.max(3, cur.points || 0),
            level: Math.max(1, cur.level || 0),
            nextReview: now + 3 * 86400000,
            lastUpdated: now,
            cram: true,
            label: payload.label || ''
        };
        if (window.saveProgress) window.saveProgress();
        if (window.refreshHwState) window.refreshHwState();
        if (window.updateGlobalUI) window.updateGlobalUI();
        if (window.updateHwNavBadge) window.updateHwNavBadge();
    } catch (e) { console.warn('cramMastered error', e); }
};

// Сколько фактов зубрёжки выучено (для ДЗ-метрики). Опционально по префиксу колоды.
window.cramLearnedCount = function(deckPrefixOrFrom, maybeTo) {
    const fs = (window.state && window.state.stats && window.state.stats.factStreaks) || {};
    const isRange = Number.isFinite(Number(deckPrefixOrFrom)) && Number.isFinite(Number(maybeTo));
    const rangeIds = isRange ? window.cramEventIdsInRange(deckPrefixOrFrom, maybeTo) : null;
    const deckPrefix = isRange ? null : deckPrefixOrFrom;
    let n = 0;
    for (const k in fs) {
        if (k.indexOf('cram:') !== 0) continue;
        if (rangeIds && !rangeIds.has(k.slice(5))) continue;
        if (isRange && !rangeIds) continue;
        if (deckPrefix && k.indexOf('cram:' + deckPrefix) !== 0) continue;
        if (window.isFactLearned && window.isFactLearned(fs[k])) n++;
    }
    return n;
};

function _hwFmtDate(dl) {
    if (!dl) return 'без срока';
    return new Date(dl + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}
function _hwAssignmentActive(a) {
    return a.status === 'active' && (a.items || []).some(it => !window.hwItemDone(it));
}
function _hwAssignmentRemainingItems(a) {
    return (a.items || []).filter(it => !window.hwItemDone(it)).length;
}

window.countActiveAssignments = function() {
    const arr = window.state.stats.assignments || [];
    return arr.filter(_hwAssignmentActive).length;
};

// Обновить красный бейдж с числом активных ДЗ на кнопке нижнего меню
window.updateHwNavBadge = function() {
    const badge = document.getElementById('hw-nav-badge');
    if (!badge) return;
    const n = window.countActiveAssignments();
    if (n > 0) { badge.textContent = n > 9 ? '9+' : String(n); badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
};

function _hwItemRow(it, idx, kind) {
    const m = HW_TASK_META[it.task] || { emoji: '📝', name: it.task };
    const mm = HW_METRIC_META[it.metric] || HW_METRIC_META.lines;
    const prog = window.hwItemProgress(it), goal = it.goal || 0;
    const pct = goal ? Math.min(100, Math.round(prog / goal * 100)) : 0;
    const done = window.hwItemDone(it);
    const periodLabel = it.task === 'cram'
        ? (it.yearStart && it.yearEnd ? `даты ${it.yearStart}–${it.yearEnd} гг.` : 'тренажёр дат')
        : (it.period === 'custom' ? (it.yearStart || '?') + '–' + (it.yearEnd || '?') + ' гг.' : (HW_PERIOD_LABEL[it.period] || ''));
    const tick = done ? '✅' : '▢';
    return `
      <div style="display:flex;gap:8px;align-items:center;padding:6px 0">
        <span style="font-size:14px;width:18px;flex-shrink:0">${tick}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:800;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="dark:text-gray-100">${m.emoji} ${m.name}</div>
          <div style="font-size:10px;color:#9ca3af;margin:1px 0 3px">${mm.verb} ${goal} ${mm.unit} · ${periodLabel}</div>
          <div style="width:100%;height:5px;background:rgba(128,128,128,0.15);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${done ? 'var(--c-success)' : mm.color};border-radius:3px;transition:width .3s"></div>
          </div>
        </div>
        <span style="font-size:11px;font-weight:900;color:${done ? 'var(--c-success)' : '#6b7280'};flex-shrink:0;min-width:42px;text-align:right">${prog}/${goal}</span>
      </div>`;
}

window.openHwTab = function() {
    haptic('light');
    if (window.refreshHwState) window.refreshHwState();
    const arr = (window.state.stats.assignments || []).slice();
    const now = Date.now();
    const isOverdue = a => a.deadline && new Date(a.deadline + 'T23:59:59').getTime() < now;

    const active  = arr.filter(a => _hwAssignmentActive(a) && !isOverdue(a))
        .sort((a, b) => (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity));
    const overdue = arr.filter(a => _hwAssignmentActive(a) && isOverdue(a))
        .sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
    const done    = arr.filter(a => a.status === 'done')
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 30);

    const card = (a, kind) => {
        const items = a.items || [];
        let headBadge, btn = '';
        if (kind === 'done') {
            headBadge = a.onTime
                ? '<span style="background:var(--c-success);color:#fff;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px">✅ Сдано вовремя</span>'
                : '<span style="background:var(--c-warn);color:#fff;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px">⌛ Сдано с опозданием</span>';
        } else {
            const od = kind === 'overdue';
            headBadge = od
                ? '<span style="background:var(--c-danger);color:#fff;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px">🔴 Просрочено</span>'
                : `<span style="background:rgba(16,185,129,0.15);color:#059669;font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px">🟢 Срок: ${_hwFmtDate(a.deadline)}</span>`;
            const restN = _hwAssignmentRemainingItems(a);
            const started = items.some(it => !window.hwItemDone(it) && (it.progress || 0) > 0) || items.some(it => window.hwItemDone(it));
            const label = od ? 'Доделать' : (started ? 'Продолжить' : 'Начать');
            btn = `<button onclick="window.startAssignment&&window.startAssignment('${a.id}')"
                style="margin-top:10px;width:100%;background:${od ? 'var(--c-danger)' : 'var(--c-brand)'};color:#fff;border:none;border-radius:12px;padding:12px;font-size:13px;font-weight:900;cursor:pointer">
                ▶ ${label} · ${restN} ${restN === 1 ? 'этап' : 'этапа+'} </button>`;
        }
        const title = a.title || (items.length > 1 ? `Домашнее задание · ${items.length} этапов` : 'Домашнее задание');
        return `
        <div style="background:var(--card,#fff);border:1px solid rgba(128,128,128,0.18);border-radius:16px;padding:14px;margin-bottom:10px" class="dark:bg-[#1e1e1e]">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
            <div style="font-size:13px;font-weight:900;color:#111" class="dark:text-white">${title}</div>
            ${headBadge}
          </div>
          ${kind === 'done' ? `<div style="font-size:10px;color:#9ca3af;margin-bottom:4px">Выполнено ${a.completedAt ? new Date(a.completedAt).toLocaleDateString('ru-RU') : ''} · срок: ${_hwFmtDate(a.deadline)}</div>` : ''}
          <div>${items.map((it, i) => _hwItemRow(it, i, kind)).join('')}</div>
          ${btn}
        </div>`;
    };

    const section = (title, items, kind) => items.length
        ? `<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin:6px 2px 8px">${title}</div>${items.map(a => card(a, kind)).join('')}</div>`
        : '';

    const empty = (!active.length && !overdue.length && !done.length)
        ? `<div style="text-align:center;padding:40px 16px;color:#9ca3af">
             <div style="font-size:42px;margin-bottom:8px">🎉</div>
             <div style="font-size:14px;font-weight:800;color:#374151" class="dark:text-gray-300">Домашних заданий нет</div>
             <div style="font-size:12px;margin-top:4px">Учитель пока ничего не задал</div>
           </div>` : '';

    const streak = window.state.stats.achievementsData?.hwStreakMax || 0;
    const onTime = window.state.stats.achievementsData?.hwOnTime || 0;
    const statsLine = (onTime || streak)
        ? `<div style="display:flex;gap:8px;margin-bottom:12px">
             <div style="flex:1;background:rgba(16,185,129,0.1);border-radius:12px;padding:10px;text-align:center">
               <div style="font-size:20px;font-weight:900;color:#059669">${onTime}</div>
               <div style="font-size:10px;color:#6b7280;font-weight:700">сдано вовремя</div></div>
             <div style="flex:1;background:rgba(245,158,11,0.1);border-radius:12px;padding:10px;text-align:center">
               <div style="font-size:20px;font-weight:900;color:#d97706">🔥 ${streak}</div>
               <div style="font-size:10px;color:#6b7280;font-weight:700">лучшая серия вовремя</div></div>
           </div>` : '';

    const overlayId = 'hw-tab-overlay';
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center';
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
    <div style="background:#f7f7f8;width:100%;max-width:480px;max-height:88vh;overflow-y:auto;border-radius:24px 24px 0 0;padding:18px 16px calc(28px + env(safe-area-inset-bottom, 0px));box-shadow:0 -8px 40px rgba(0,0,0,0.25)" class="dark:bg-[#141414]">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:16px;font-weight:900;color:#111" class="dark:text-white">📚 Домашние задания</div>
        <button onclick="document.getElementById('${overlayId}').remove()" style="font-size:22px;color:#aaa;background:none;border:none;cursor:pointer;padding:2px 8px">✕</button>
      </div>
      ${statsLine}
      ${section('🔴 Просроченные — доделать', overdue, 'overdue')}
      ${section('🟢 Активные', active, 'active')}
      ${section('Выполненные', done, 'done')}
      ${empty}
    </div>`;
};

// Начать ДЗ: запускаем поток с первого невыполненного этапа.
window.startAssignment = function(id) {
    const a = (window.state.stats.assignments || []).find(x => x.id === id);
    const ov = document.getElementById('hw-tab-overlay');
    if (ov) ov.remove();
    if (!a) return;
    const idx = (a.items || []).findIndex(it => !window.hwItemDone(it));
    if (idx === -1) return showToast('✅', 'Это ДЗ уже выполнено', 'bg-emerald-500', 'border-emerald-700');
    window.startHwItem(id, idx);
};

// Запустить конкретный этап ДЗ (настраивает задание/период/режим и фокус прогресса).
window.startHwItem = function(id, idx) {
    const a = (window.state.stats.assignments || []).find(x => x.id === id);
    if (!a) return;
    const it = (a.items || [])[idx];
    if (!it) return;
    window.state.activeHw = { id, itemIndex: idx };
    // Зубрёжка: запускаем тренажёр дат вместо обычного задания.
    if (it.task === 'cram') {
        const total = (a.items || []).length;
        // Всегда открываем колоду периода сразу в тренировку (диапазон учителя или весь, если не сужен).
        const ys = it.yearStart || 862, ye = it.yearEnd || 2026;
        const rangeTxt = (it.yearStart && it.yearEnd) ? ` (${it.yearStart}–${it.yearEnd})` : '';
        showToast('⚡', `Этап ${idx + 1} из ${total}: вызубрить ${it.goal} дат${rangeTxt}`, 'bg-indigo-500', 'border-indigo-700');
        window._cramHwFlow = true; // зубрёжка открыта ИЗ ДЗ → на выходе можно двигать этапы
        if (window.openCram) window.openCram('period:' + ys + '-' + ye);
        return;
    }
    const mm = HW_METRIC_META[it.metric] || HW_METRIC_META.lines;
    if ($('filter-period')) $('filter-period').value = it.period || 'all';
    if (it.period === 'custom') {
        if ($('custom-year-start')) $('custom-year-start').value = it.yearStart || 862;
        if ($('custom-year-end')) $('custom-year-end').value = it.yearEnd || 2026;
    }
    const total = (a.items || []).length;
    const m = HW_TASK_META[it.task] || { emoji: '📝', name: it.task };
    showToast('📚', `Этап ${idx + 1} из ${total}: ${mm.verb.toLowerCase()} ${it.goal} ${mm.unit}`, 'bg-indigo-500', 'border-indigo-700');
    quickStartGame(it.task || 'task4', mm.mode);
};

// Вызывается после засчитанного прогресса. Если активный этап выполнен — автопереход к следующему,
// либо завершение ДЗ. Возвращает true, если поток ДЗ перехватил управление.
window.maybeAdvanceHw = function() {
    const ah = window.state.activeHw;
    if (!ah) return false;
    if (window.refreshHwState) window.refreshHwState();
    const a = (window.state.stats.assignments || []).find(x => x.id === ah.id);
    if (!a) { window.state.activeHw = null; return false; }
    const curItem = (a.items || [])[ah.itemIndex];
    if (curItem && !window.hwItemDone(curItem)) return false; // этап ещё не завершён — продолжаем его

    // следующий невыполненный этап
    const nextIdx = (a.items || []).findIndex(it => !window.hwItemDone(it));
    if (nextIdx !== -1) {
        haptic('success');
        setTimeout(() => window.startHwItem(a.id, nextIdx), 700);
        return true;
    }
    // все этапы выполнены → ДЗ завершено (статус выставит refreshHwState/completeAssignment)
    window.state.activeHw = null;
    haptic('success');
    setTimeout(() => {
        if (window.backToLobby) window.backToLobby();
        showToast('🎉', 'Домашнее задание выполнено!', 'bg-emerald-500', 'border-emerald-700');
        setTimeout(() => window.openHwTab && window.openHwTab(), 900);
    }, 600);
    return true;
};

// ── Всплывающий вызов на дуэль (сверху, не мешает решать) ──
let _challengeHideTimer = null;
let _challengeAudioCtx = null;
let _lastChallengeShownId = null;
const _dismissedChallenges = new Set();

// Зов на дуэль: зацикленный звук (assets/sounds/duel.mp3), играет пока висит
// баннер, и обрывается при «Принять» / «✕» / авто-скрытии (см. hideDuelChallenge).
// Заглушить: localStorage duel_challenge_muted=1.
function _playChallengeChime() {
    try {
        if (localStorage.getItem('duel_challenge_muted') === '1') return;
        if (window.Sfx && window.Sfx.loop) { window.Sfx.loop('duel'); return; }
        // Фолбэк — короткий синтетический «дзынь», если Sfx недоступен
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        _challengeAudioCtx = _challengeAudioCtx || new Ctx();
        if (_challengeAudioCtx.state === 'suspended') _challengeAudioCtx.resume();
        const ctx = _challengeAudioCtx, t = ctx.currentTime;
        [[880, 0], [1318.5, 0.10]].forEach(([f, dt]) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t + dt);
            g.gain.exponentialRampToValueAtTime(0.11, t + dt + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.18);
            o.connect(g); g.connect(ctx.destination);
            o.start(t + dt); o.stop(t + dt + 0.2);
        });
    } catch (e) {}
}
function _stopChallengeChime() {
    try { if (window.Sfx && window.Sfx.stop) window.Sfx.stop('duel'); } catch (e) {}
}

window.showDuelChallenge = function(ch) {
    if (!ch || !ch.matchId) return;
    if (_dismissedChallenges.has(ch.matchId)) return;
    // matchId ловит и окно «соперник найден → отсчёт», когда searching уже false, а active ещё false
    if (window.state.duel && (window.state.duel.active || window.state.duel.searching || window.state.duel.matchId)) return;
    const name = String(ch.name || 'Игрок').replace(/[<>&]/g, '');
    const isNew = ch.matchId !== _lastChallengeShownId;   // привлекаем внимание только для нового вызова
    _lastChallengeShownId = ch.matchId;
    if (!document.getElementById('_duel_chal_css')) {
        const st = document.createElement('style');
        st.id = '_duel_chal_css';
        st.textContent = '@keyframes duelChalPulse{0%,100%{box-shadow:0 10px 30px rgba(79,70,229,.45)}50%{box-shadow:0 12px 44px rgba(124,58,237,.9)}}';
        document.head.appendChild(st);
    }
    let el = document.getElementById('duel-challenge-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'duel-challenge-banner';
        el.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%) translateY(-140%);z-index:9500;display:flex;align-items:center;gap:10px;max-width:94vw;padding:9px 12px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;box-shadow:0 10px 30px rgba(79,70,229,.45);font-size:12px;font-weight:800;transition:transform .35s cubic-bezier(.2,.9,.3,1.2);pointer-events:auto';
        document.body.appendChild(el);
    }
    el.dataset.matchId = ch.matchId;
    el.innerHTML = `
        <span style="font-size:16px;flex-shrink:0">${ch.mode === 'swipe' ? '🃏' : '🗡️'}</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${name}</b> зовёт: ${ch.mode === 'swipe' ? 'свайп-дуэль' : 'дуэль'}!</span>
        <button onclick="window.acceptDuelChallenge&&window.acceptDuelChallenge('${ch.matchId}')" style="flex-shrink:0;background:#fff;color:#4f46e5;border:none;border-radius:9px;padding:6px 12px;font-size:12px;font-weight:900;cursor:pointer">Принять</button>
        <button onclick="window.dismissDuelChallenge&&window.dismissDuelChallenge('${ch.matchId}')" style="flex-shrink:0;background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:9px;width:26px;height:26px;font-size:13px;font-weight:900;cursor:pointer;line-height:1">✕</button>`;
    requestAnimationFrame(() => { el.style.transform = 'translateX(-50%) translateY(0)'; });
    if (isNew) {
        el.style.animation = 'duelChalPulse 1.1s ease-in-out 3';
        if (typeof haptic === 'function') haptic('warning');
        _playChallengeChime();
    }
    clearTimeout(_challengeHideTimer);
    _challengeHideTimer = setTimeout(() => window.hideDuelChallenge(), 26000);
};
window.hideDuelChallenge = function() {
    clearTimeout(_challengeHideTimer);
    _stopChallengeChime();
    const el = document.getElementById('duel-challenge-banner');
    if (!el) return;
    el.style.transform = 'translateX(-50%) translateY(-140%)';
    setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, 350);
};
window.dismissDuelChallenge = function(matchId) {
    if (matchId) { _dismissedChallenges.add(matchId); setTimeout(() => _dismissedChallenges.delete(matchId), 40000); }
    window.hideDuelChallenge();
};

window.openEGEModal = function() {
    haptic('light');
    const r = estimateEGEScore(window.state.stats);
    const score = r.score;
    const color = score >= 85 ? '#0F6E56' : score >= 70 ? '#185FA5' : score >= 55 ? '#BA7517' : '#A32D2D';
    const grade = score >= 85 ? 'Отлично' : score >= 70 ? 'Хорошо' : score >= 55 ? 'Средне' : 'Слабо';

    const rows = [
        { label:'База', val:'+20', pct:29, color:'#888' },
        { label:'Задание №1 (хронология)', val:'+'+Math.round(r.s1), pct:Math.round((r.s1/10)*100), color:'#0891b2' },
        { label:'Задание №4 (факты)', val:'+'+Math.round(r.s4), pct:Math.round((r.s4/20)*100), color:'#185FA5' },
        { label:'Задание №3 (процессы)', val:'+'+Math.round(r.s3), pct:Math.round((r.s3/17)*100), color:'#1D9E75' },
        { label:'Задание №5 (даты)', val:'+'+Math.round(r.s5), pct:Math.round((r.s5/16)*100), color:'var(--c-purple)' },
        { label:'Задание №7 (культура)', val:'+'+Math.round(r.s7), pct:Math.round((r.s7/12)*100), color:'#d97706' },
        { label:'Штраф за эпохи', val:'−'+r.pen, pct:Math.round((r.pen/25)*100), color:'#E24B4A', neg:true },
        { label:'Точность'+(r.accuracy?` (${r.accuracy}%)`:''), val:(r.accAdj>=0?'+':'')+r.accAdj, pct:Math.round((Math.abs(r.accAdj)/15)*100), color: r.accAdj >= 0 ? '#1D9E75' : '#E24B4A', neg: r.accAdj < 0 },
    ];

    const rowsHtml = rows.map(row => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:11px;color:#888;min-width:160px;flex-shrink:0">${row.label}</span>
        <div style="flex:1;height:5px;background:rgba(128,128,128,0.15);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${row.pct}%;background:${row.color};border-radius:3px;transition:width .3s"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:${row.neg?'#E24B4A':row.color};min-width:36px;text-align:right">${row.val}</span>
      </div>`).join('');

    const potentialRow = r.ceiling < 100 && r.weakEra ? `
      <div style="background:rgba(234,179,8,0.12);border:0.5px solid rgba(234,179,8,0.4);border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-top:12px">
        ⚠ Слабое место: <b>${r.weakEra}</b>. Потолок = ${r.ceiling}. Прокачай эту эпоху — выйдешь на ${Math.min(100, r.score + (100 - r.ceiling))}+.
      </div>` : '';

    const ceilRow = r.ceiling < 100 ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;opacity:.7">
        <span style="font-size:11px;color:#888;min-width:160px;flex-shrink:0">Потолок (слаб. эпоха)</span>
        <div style="flex:1;height:5px;background:rgba(128,128,128,0.15);border-radius:3px;overflow:hidden"><div style="height:100%;width:${r.ceiling}%;background:#888;border-radius:3px"></div></div>
        <span style="font-size:12px;font-weight:700;color:#888;min-width:36px;text-align:right">≤${r.ceiling}</span></div>` : '';

    const factsRow = `<div style="margin:12px 0 8px;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Выучено фактов</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${(function(){
          const mx4 = typeof bigData !== 'undefined' ? bigData.length : 500;
          const mx1 = typeof task1Data !== 'undefined' ? task1Data.length : (window.task1Data || []).length || 150;
          const mx5 = typeof task5Data !== 'undefined' ? task5Data.length : 250;
          const mx3 = typeof task3Data !== 'undefined' ? task3Data.length : 150;
          const mx7 = typeof window.task7Data !== 'undefined' ? window.task7Data.length : 180;
          return [['⏳ №1',r.d1,mx1,'#0891b2'],['📍 №4',r.d4,mx4,'#185FA5'],['👤 №5',r.d5,mx5,'var(--c-purple)'],['🔗 №3',r.d3,mx3,'#1D9E75'],['🎨 №7',r.d7,mx7,'#d97706']].map(([lbl,cnt,mx,clr])=>`
          <div style="background:rgba(128,128,128,0.07);border-radius:8px;padding:8px 10px">
            <div style="font-size:11px;color:#888;margin-bottom:4px">${lbl}</div>
            <div style="font-size:16px;font-weight:700;color:${clr}">${cnt}<span style="font-size:10px;font-weight:400;color:#aaa"> / ${mx}</span></div>
            <div style="margin-top:4px;height:3px;background:rgba(128,128,128,0.15);border-radius:2px"><div style="height:100%;width:${Math.min(100,Math.round(cnt/mx*100))}%;background:${clr};border-radius:2px"></div></div>
          </div>`).join('');
        })()}
      </div>`;

    const overlayId = 'ege-score-overlay';
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = overlayId;
        // z-index выше модалок (10001/10006): прогноз открывается ИЗ окна статистики и должен лечь поверх него
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,0.55);display:flex;align-items:flex-end;justify-content:center;padding:0';
        overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="background:var(--tw-bg-opacity,1);background-color:#fff;width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:24px 20px 32px;max-height:90vh;overflow-y:auto" class="dark:bg-[#1e1e1e]">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:#888">Прогноз ЕГЭ по истории</div>
          <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px">
            <span style="font-size:48px;font-weight:500;color:${color};line-height:1">${score}</span>
            <span style="font-size:13px;color:${color};font-weight:700">${grade}</span>
          </div>
        </div>
        <button onclick="document.getElementById('${overlayId}').remove()" style="font-size:20px;color:#aaa;background:none;border:none;cursor:pointer;padding:4px 8px">✕</button>
      </div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;color:#888;margin-bottom:8px">Из чего складывается</div>
      ${rowsHtml}${ceilRow}${potentialRow}${factsRow}
      <div style="margin-top:16px;font-size:10px;color:#aaa;text-align:center">Факты — основной сигнал (65 оч.), точность — до ±15 оч., база — 20. Не учитывает задания 18–24.</div>
    </div>`;
};

// ═══ Главная кнопка «Продолжить» ═══════════════════════════════════════════
// Одно действие, которое приложение выбирает за ученика. Приоритет:
// ДЗ (ближайший дедлайн) → повторение SRS (≥5 фактов) → цель дня (продолжить
// последний режим) → всё сделано (награда). Новичок — отдельная ветка «Начать».

const DAILY_GOAL_LINES = 30; // дневная норма нового материала (≈10 заданий)

// Сколько фактов «к повтору» (SRS: level>0, nextReview прошёл) по заданиям таблицы.
// Зубрёжка (cram:) и визуальные (vp_/va_/vm_) сюда не входят — у них свои тренажёры.
function _dueReviewCounts() {
    const now = Date.now();
    const fs = window.state.stats.factStreaks || {};
    const by = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
    let total = 0;
    for (const k in fs) {
        const d = fs[k];
        if (!d || !(d.level > 0) || !(d.nextReview <= now)) continue;
        let t;
        if (k.indexOf('t1_') === 0) t = 'task1';
        else if (k.indexOf('t3_') === 0) t = 'task3';
        else if (k.indexOf('t5_') === 0) t = 'task5';
        else if (k.indexOf('t7_') === 0) t = 'task7';
        else if (k.indexOf('vp_') === 0 || k.indexOf('va_') === 0 || k.indexOf('vm_') === 0 || k.indexOf('cram:') === 0) continue;
        else t = 'task4';
        by[t]++; total++;
    }
    return { by, total };
}

// «Рабочий период» ученика: период активного ДЗ → «дошли до года» потока
// (задаёт учитель: повторяем ВСЁ от 862 до границы, а не один век) →
// легаси-период потока → последний период самого ученика.
// Возвращает { era: 'early'|... } либо { upto: год }, null — если ничего нет.
function _workingPeriod() {
    const s = window.state.stats;
    const act = (s.assignments || []).find(a => a.status === 'active');
    const it = act && (act.items || []).find(i => !window.hwItemDone(i));
    if (it && it.period && it.period !== 'all' && it.period !== 'custom') return { era: it.period };
    const upto = parseInt(localStorage.getItem('class_current_upto'), 10);
    if (upto >= 862 && upto <= 2026) return { upto };
    const cp = localStorage.getItem('class_current_period');
    if (cp && TASK_EPOCHS.includes(cp)) return { era: cp };
    const lp = localStorage.getItem('ege_last_period');
    if (lp && TASK_EPOCHS.includes(lp)) return { era: lp };
    return null;
}

function _wpLabel(wp) {
    if (!wp) return '';
    if (wp.upto) return `до ${wp.upto} г.`;
    return (TASK_EPOCH_SHORT && TASK_EPOCH_SHORT[wp.era]) || '';
}

// Границы эпох в годах — единая точка для пресетов диапазона.
const EPOCH_YEARS = { early: [862, 1699], '18th': [1700, 1799], '19th': [1800, 1899], '20th': [1900, 2026] };
window.EPOCH_YEARS = EPOCH_YEARS;

// Рабочий период → диапазон лет { from, to } (для свайпа и пресетов), null — нет ограничения.
function _wpYearRange(wp) {
    if (!wp) return null;
    if (wp.upto) return { from: 862, to: wp.upto };
    const y = EPOCH_YEARS[wp.era];
    return y ? { from: y[0], to: y[1] } : null;
}

// Диапазон лет рабочего периода для свайпа — чтобы кнопка «Свайп» в лобби по
// умолчанию тренировала годы, отмеченные учителем. Глобальна, т.к. swipe-mode.js
// не видит внутренние хелперы ui.js. null — нет ограничения (полный пул).
window.getWorkingSwipeRange = function () { return _wpYearRange(_workingPeriod()); };

// Применить рабочий период к фильтру: граница года → кастомный диапазон 862..год.
function _applyWpFilter(wp) {
    const sel = $('filter-period');
    if (!sel) return;
    if (wp && wp.upto) {
        sel.value = 'custom';
        if ($('custom-year-start')) $('custom-year-start').value = 862;
        if ($('custom-year-end')) $('custom-year-end').value = wp.upto;
    } else {
        sel.value = (wp && TASK_EPOCHS.includes(wp.era)) ? wp.era : 'all';
    }
    // Плашка периода в игре должна показывать реально применённые годы,
    // а не «Выбрать период», когда границу подставило приложение.
    window.state._wpApplied = !!wp;
}

// Сколько ошибок (mistakesPool) по каждому текстовому заданию. bestTask — где больше.
function _mistakeCounts() {
    // Держим пул честным: убираем уже выученные факты (level≥1) — иначе счётчик ошибок
    // «не уменьшался» бы, а кнопка предлагала бы разбор того, что уже освоено.
    if (window.pruneLearnedMistakes) window.pruneLearnedMistakes();
    const by = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
    let total = 0;
    (window.state.mistakesPool || []).forEach(m => {
        if (m && by[m.task] !== undefined) { by[m.task]++; total++; }
    });
    let bestTask = 'task4', bestN = -1;
    for (const t in by) if (by[t] > bestN) { bestN = by[t]; bestTask = t; }
    return { by, total, bestTask };
}

// Данные задания целиком (task7 — отдельный массив).
function _taskDataAll(task) {
    if (task === 'task7') return window.task7Data || [];
    return ((TASK_CONFIG[task] || TASK_CONFIG.task4).data)() || [];
}
// Факты в рамках рабочего периода (эпоха / диапазон 862..upto / всё).
function _factsInPeriod(data, wp) {
    if (!wp) return data;
    if (wp.upto) return data.filter(d => { const y = getYearFromFact(d); return y >= 862 && y <= wp.upto; });
    if (wp.era && TASK_EPOCHS.includes(wp.era)) return data.filter(d => d.c === wp.era);
    return data;
}
// Сколько НЕвыученного (level 0 / не тронуто) по каждому заданию в периоде — это «новый
// материал», который кнопка выдаёт до дневной нормы. bestTask — тип с наибольшим запасом
// нового (естественная ротация типов: исчерпал один — кнопка сама переходит к следующему).
function _unlearnedCountsByTask(wp) {
    const fs = window.state.stats.factStreaks || {};
    const by = { task1: 0, task3: 0, task4: 0, task5: 0, task7: 0 };
    let total = 0;
    for (const task of ['task1', 'task3', 'task4', 'task5', 'task7']) {
        const facts = _factsInPeriod(_taskDataAll(task), wp);
        const seen = new Set();
        for (const f of facts) {
            const k = factKey(f, task);
            if (seen.has(k)) continue;
            seen.add(k);
            const d = fs[k];
            if (!(d && d.level >= 1)) { by[task]++; total++; }
        }
    }
    let bestTask = 'task1', bestN = -1;
    for (const t in by) if (by[t] > bestN) { bestN = by[t]; bestTask = t; }
    return { by, total, bestTask };
}

// Ротация типов заданий: ~30 строк на тип, потом следующий. task7 не первым (там
// таблицы по 4 строки). Выбираем тип с невыученным материалом, у которого сегодня
// решено МЕНЬШЕ всего строк (при равенстве — по порядку, task7 последним). Так после
// 30 строк одного типа кнопка сама переходит к следующему, и цикл повторяется.
const NEW_ROTATION = ['task4', 'task1', 'task3', 'task5', 'task7'];
const LINES_PER_TASK = 30;
function _dtSolvedKey(t) { return 'solved' + t.charAt(0).toUpperCase() + t.slice(1); }
function _pickNewTask(unlearned) {
    const today = (window.state.stats.dailyStats && window.state.stats.dailyStats[getTodayString()]) || {};
    const cand = NEW_ROTATION.filter(t => (unlearned.by[t] || 0) > 0);
    if (!cand.length) return null;
    let best = cand[0], bestLines = today[_dtSolvedKey(cand[0])] || 0;
    for (const t of cand) {
        const lines = today[_dtSolvedKey(t)] || 0;
        if (lines < bestLines) { best = t; bestLines = lines; } // строгое < → при равенстве раньше по порядку
    }
    let rem = LINES_PER_TASK - (bestLines % LINES_PER_TASK);
    if (rem === LINES_PER_TASK && bestLines > 0) rem = LINES_PER_TASK; // ровно кратно — новый цикл
    const left = Math.max(1, Math.min(rem, unlearned.by[best] || 1));
    return { task: best, left };
}

// Самая слабая пара (задание, эпоха): минимум точности при ≥10 попытках.
function _weakestSpot() {
    const es = window.state.stats.eraStats || {};
    let worst = null;
    ['task1', 'task3', 'task4', 'task5', 'task7'].forEach(tk => {
        TASK_EPOCHS.forEach(era => {
            const e = (es[tk] || {})[era];
            if (!e || (e.total || 0) < 10) return;
            const acc = (e.correct || 0) / e.total;
            if (!worst || acc < worst.acc) worst = { task: tk, era, acc };
        });
    });
    return worst;
}

function computeMainAction() {
    const s = window.state.stats;
    const due = _dueReviewCounts();
    const active = (s.assignments || []).filter(a => a.status === 'active');
    const hwRemaining = active.reduce((n, a) => n + (a.items || []).reduce((m, it) => m + window.hwItemRemaining(it), 0), 0);
    const doneToday = (s.dailyStats && s.dailyStats[getTodayString()] && s.dailyStats[getTodayString()].solved) || 0;
    const wp = _workingPeriod();
    const unlearned = _unlearnedCountsByTask(wp);
    const mistakes = _mistakeCounts();
    const base = { due, hwCount: active.length, hwRemaining, doneToday, unlearned, mistakes };

    // Новичок — вся история, если учитель или сам ученик не задал ограничение.
    if (!(s.totalSolvedEver > 0)) return { ...base, kind: 'start', period: wp };

    // Порядок: 1) ДЗ  2) ошибки  3) повтор выпавшего из выученного  4) новое  5) слабое  6) готово

    // 1) ДЗ учителя (последовательно, ближайший дедлайн)
    if (active.length && hwRemaining > 0) {
        const sorted = active.slice().sort((a, b) => String(a.deadline || '9999') < String(b.deadline || '9999') ? -1 : 1);
        const a = sorted.find(x => (x.items || []).some(it => !window.hwItemDone(it))) || sorted[0];
        const idx = Math.max(0, (a.items || []).findIndex(it => !window.hwItemDone(it)));
        const overdue = !!(a.deadline && a.deadline < getTodayString());
        return { ...base, kind: overdue ? 'hw-overdue' : 'hw', hwId: a.id, hwIdx: idx, deadline: a.deadline };
    }

    // 2) ДНЕВНОЙ ПЛАН (Q1). Раньше кнопка тасовала новое/ошибки/повтор на КАЖДЫЙ тап
    // (_ladderTick) — режимы прыгали, смысл терялся. Теперь просто:
    //   • обычный день → ведём НОВОЕ (повтор и ошибки подмешиваются блендингом ВНУТРИ
    //     сессии — каждая 3-я таблица, см. getFilteredPool в state.js);
    //   • каждый 4-й АКТИВНЫЙ день → «День повторения»: чистый разбор ошибок и забытого.
    // Индекс дня — по числу ПРОШЛЫХ активных дней (стабилен в течение суток, не гуляет от тапа).
    const today = getTodayString();
    const pastActiveDays = Object.keys(s.dailyStats || {})
        .filter(d => d < today && ((s.dailyStats[d] || {}).solved || 0) > 0).length;
    const isRepeatDay = (pastActiveDays % 4) === 3;
    const hasBacklog = mistakes.total >= 1 || due.total >= 3;

    const pickReview = (rep) => {
        if (mistakes.total >= 1) return { ...base, kind: 'mistakes', task: mistakes.bestTask, repeatDay: !!rep };
        let bestTask = 'task4', bestN = -1;
        for (const t in due.by) if (due.by[t] > bestN) { bestN = due.by[t]; bestTask = t; }
        return { ...base, kind: 'review', task: bestTask, period: wp, repeatDay: !!rep };
    };

    // «День повторения» — если есть что разбирать
    if (isRepeatDay && hasBacklog) return pickReview(true);

    // Обычный день → новое
    const pick = _pickNewTask(unlearned);
    if (pick) return { ...base, kind: 'continue',
        task: pick.task,
        period: wp || { era: localStorage.getItem('ege_last_period') || 'all' },
        left: pick.left };

    // Нового в периоде не осталось → разбираем ошибки/повтор
    if (hasBacklog) return pickReview(false);

    // 3) Слабое место
    const weak = _weakestSpot();
    if (weak) return { ...base, kind: 'weak', weak, period: { era: weak.era } };

    // 4) Всё честно закрыто на сегодня
    return { ...base, kind: 'done', period: wp,
        streak: (window.computeDayStreak && window.computeDayStreak()) || 0 };
}

window.mainActionGo = function(kind) {
    const a = computeMainAction();
    const act = kind || a.kind;
    // Прокрутка ротации лестницы: следующий раз главная кнопка предложит другой пункт
    // цикла (новое↔ошибки↔повтор), чтобы не застревать на одном. Только для нажатий самой
    // кнопки (без явного kind от чипов) и только для ротируемых пунктов.
    if (!kind && (act === 'mistakes' || act === 'review' || act === 'continue')) {
        window.state._ladderTick = ((window.state._ladderTick || 0) + 1) % 1000000;
    }
    haptic('medium');
    if (act === 'hw' || act === 'hw-overdue') {
        if (a.hwId != null && window.startHwItem) return window.startHwItem(a.hwId, a.hwIdx);
        return window.openHwTab && window.openHwTab();
    }
    if (act === 'mistakes') {
        const mc = _mistakeCounts();
        if (!mc.total) return showToast('✅', 'Ошибок нет — чисто!', 'bg-emerald-500', 'border-emerald-700');
        if ($('filter-period')) $('filter-period').value = 'all';
        // Фокус на ошибках: в таблицу — именно факты из пула ошибок.
        window.state.mistakeFocus = true;
        window.state.reviewFocus = false;
        return quickStartGame(mc.bestTask, 'mistakes');
    }
    if (act === 'review') {
        if (a.due.total === 0) return showToast('🎉', 'Повторять пока нечего — всё свежо!', 'bg-emerald-500', 'border-emerald-700');
        let bestTask = a.task || 'task4', bestN = -1;
        if (!a.task) { for (const t in a.due.by) if (a.due.by[t] > bestN) { bestN = a.due.by[t]; bestTask = t; } }
        if ($('filter-period')) $('filter-period').value = 'all';
        // Кнопка обещает «Повторить N фактов» — в таблицу должны попадать именно
        // просроченные факты, а не случайные ошибки (иначе счётчик «не уменьшался»).
        window.state.reviewFocus = true;
        window.state.mistakeFocus = false;
        return quickStartGame(bestTask, 'mistakes');
    }
    if (act === 'continue' || act === 'start') {
        // continue хранит период строкой (свой последний), start — объект рабочего периода
        const wp = (typeof a.period === 'string') ? { era: a.period } : a.period;
        _applyWpFilter(wp);
        return quickStartGame(act === 'start' ? 'task1' : a.task, 'normal');
    }
    if (act === 'weak') {
        const w = _weakestSpot();
        if (!w) return showToast('💪', 'Слабых мест не видно — решай дальше!', 'bg-blue-500', 'border-blue-700');
        if ($('filter-period')) $('filter-period').value = w.era;
        return quickStartGame(w.task, 'normal');
    }
    if (act === 'done') {
        // Цель дня закрыта → лёгкое повторение свайпом (не дуэль): правители
        // пройденных периодов, если учитель отметил границу «дошли до».
        if (!window.openSwipeMode) return;
        return window.openSwipeMode(_wpYearRange(_workingPeriod()));
    }
    if (act === 'hwtab') return window.openHwTab && window.openHwTab();
};

const _MAIN_ACTION_META = {
    'hw':         { bg: 'linear-gradient(135deg,#f43f5e,#e11d48)', icon: '📚', title: 'Продолжить ДЗ' },
    'hw-overdue': { bg: 'linear-gradient(135deg,#e11d48,#9f1239)', icon: '🔥', title: 'Догони ДЗ' },
    'mistakes':   { bg: 'linear-gradient(135deg,#f43f5e,#e11d48)', icon: '🔧', title: 'Разбор ошибок' },
    'review':     { bg: 'linear-gradient(135deg,#6366f1,#4f46e5)', icon: '🧠', title: 'Повторить' },
    'continue':   { bg: 'linear-gradient(135deg,#3b82f6,#2563eb)', icon: '▶️', title: 'Учим новое' },
    'weak':       { bg: 'linear-gradient(135deg,#f97316,#ea580c)', icon: '🎯', title: 'Слабое место' },
    'done':       { bg: 'linear-gradient(135deg,#10b981,#059669)', icon: '🏆', title: 'На сегодня всё!' },
    'start':      { bg: 'linear-gradient(135deg,#f59e0b,#d97706)', icon: '🚀', title: 'Начать обучение' }
};

function renderMainAction() {
    const box = $('main-action');
    if (!box) return;
    const a = computeMainAction();
    const m = _MAIN_ACTION_META[a.kind];
    const periodName = p => (TASK_EPOCH_SHORT && TASK_EPOCH_SHORT[p]) || '';
    let title = m.title, sub = '';
    if (a.kind === 'hw' || a.kind === 'hw-overdue') {
        const dl = a.deadline ? ' · до ' + new Date(a.deadline + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
        sub = `осталось ${a.hwRemaining}${a.hwCount > 1 ? ` · заданий: ${a.hwCount}` : ''}${dl}`;
    } else if (a.kind === 'mistakes') {
        const cfg = TASK_CONFIG[a.task] || TASK_CONFIG.task4;
        title = a.repeatDay ? `🧠 День повторения` : `Разбор ошибок · ${a.mistakes.total}`;
        sub = a.repeatDay ? `сегодня закрепляем · ошибок: ${a.mistakes.total}` : `${cfg.shortLabel} · разберём то, в чём ошибся`;
    } else if (a.kind === 'review') {
        const shown = Math.min(a.due.total, 20);
        title = a.repeatDay ? `🧠 День повторения` : `Повторить ${shown} фактов`;
        sub = a.repeatDay ? `сегодня закрепляем · ${shown} фактов к повтору` : (a.period ? `твой материал: ${_wpLabel(a.period)}` : 'память просит освежить');
        if (!a.repeatDay && a.due.total > shown) sub += ` · всего ${a.due.total}`;
    } else if (a.kind === 'continue') {
        const cfg = TASK_CONFIG[a.task] || TASK_CONFIG.task4;
        const pl = (typeof a.period === 'string')
            ? (TASK_EPOCHS.includes(a.period) ? periodName(a.period) : 'все периоды')
            : (_wpLabel(a.period) || 'все периоды');
        title = 'Учим новое';
        sub = `${cfg.shortLabel} · ${pl} · ещё ${a.left} до смены задания`;
    } else if (a.kind === 'weak') {
        const cfg = TASK_CONFIG[a.weak.task] || TASK_CONFIG.task4;
        title = `Слабое место: ${cfg.shortLabel}`;
        sub = `точность ${Math.round((a.weak.acc || 0) * 100)}%${a.weak.era ? ` · ${periodName(a.weak.era)}` : ''} · подтянем`;
    } else if (a.kind === 'done') {
        const moreNew = a.unlearned && a.unlearned.total > 0;
        title = moreNew ? 'Норма дня выполнена! 🎉' : 'Всё в периоде выучено! 🎉';
        sub = moreNew
            ? `стрик ${a.streak} дн. · новое продолжим завтра · можно закрепить свайпом`
            : `стрик ${a.streak} дн. · закрепи свайпом или повтори (кнопки ниже)`;
    } else if (a.kind === 'start') {
        title = `Начать: ${_wpLabel(a.period) || 'Вся история'}`;
        sub = 'первые факты за 2 минуты';
    }
    const chip = (label, val, act, dim) => `
        <button onclick="window.mainActionGo('${act}')" style="flex:1;min-width:0;background:${dim ? 'rgba(255,255,255,0.6)' : '#fff'};border:1px solid rgba(0,0,0,0.08);border-radius:999px;padding:10px 8px;font-size:11px;font-weight:900;color:#475569;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="dark:!bg-[#1e1e1e] dark:!text-gray-300 active:scale-95 transition-transform">${label}${val != null ? ` · ${val}` : ''}</button>`;
    box.innerHTML = `
        <div onclick="window.mainActionGo()" style="background:${m.bg};border-radius:18px;padding:16px 18px;cursor:pointer;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.18)" class="active:scale-[0.98] transition-transform">
            <div style="display:flex;align-items:center;gap:14px">
                <div style="font-size:30px;line-height:1;flex-shrink:0">${m.icon}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-size:17px;font-weight:900;letter-spacing:.01em">${title}</div>
                    ${sub ? `<div style="font-size:12px;font-weight:700;opacity:.85;margin-top:2px">${sub}</div>` : ''}
                </div>
                <div style="font-size:20px;opacity:.8;flex-shrink:0">›</div>
            </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
            ${chip('📚 ДЗ', a.hwCount || null, 'hwtab', !a.hwCount)}
            ${chip('🔧 Ошибки', a.mistakes.total || null, 'mistakes', !a.mistakes.total)}
            ${chip('🧠 Повтор', a.due.total || null, 'review', !a.due.total)}
            ${chip('🎯 Слабое', null, 'weak', false)}
        </div>`;
}
window.renderMainAction = renderMainAction;

function updateGlobalUI() {
    renderMainAction();
    const now = Date.now();
    let totalL = 0, freshL = 0;
    Object.values(window.state.stats.factStreaks || {}).forEach(d => {
        if (window.isFactLearned(d)) { totalL++; if (d.nextReview > now) freshL++; }
    });

    const EGE_DATE = new Date('2026-06-01T07:00:00Z');
    const daysLeft = Math.max(0, Math.ceil((EGE_DATE - now) / 86400000));

    let totalCorrect = 0, totalAttempts = 0;
    const es = window.state.stats.eraStats || {};
    ['task1','task3','task4','task5','task7'].forEach(tk => {
        ['early','18th','19th','20th'].forEach(era => {
            const e = (es[tk] || {})[era] || {};
            totalCorrect += e.correct || 0;
            totalAttempts += e.total || 0;
        });
    });
    const accuracy = totalAttempts >= 10 ? Math.round(totalCorrect / totalAttempts * 100) : null;

    const egePoints = window.state.stats.egePoints || 0;
    const egeResult = estimateEGEScore(window.state.stats);
    const sc = egeResult.score;

    const hwTotal = window.state.stats.hwFlashcardsToSolve || 0;
    const hwMode = hwTotal > 0 ? {
        total: hwTotal,
        t1: window.state.stats.hwTask1 || 0,
        t3: window.state.stats.hwTask3 || 0,
        t4: window.state.stats.hwTask4 || 0,
        t5: window.state.stats.hwTask5 || 0,
        t7: window.state.stats.hwTask7 || 0,
    } : null;
    renderTopBar({ daysLeft, sc, egePoints, totalL, totalSolved: window.state.stats.totalSolvedEver || 0, hwMode });

    // Кольцо цели дня: заполняется решёнными сегодня строками, в центре — стрик.
    // Прогноз ЕГЭ переехал в статистику (в баре он менялся слишком редко и демотивировал новичков).
    const goalEl = $('stat-goal');
    const goalRing = $('goal-ring');
    if (goalEl || goalRing) {
        const doneToday = (window.state.stats.dailyStats && window.state.stats.dailyStats[getTodayString()] &&
            window.state.stats.dailyStats[getTodayString()].solved) || 0;
        const goalPct = Math.min(1, doneToday / DAILY_GOAL_LINES);
        if (goalRing) {
            goalRing.style.strokeDashoffset = 97.4 * (1 - goalPct);
            goalRing.style.stroke = goalPct >= 1 ? '#fbbf24' : '#34d399'; // выполнено — золото
        }
        // Дневной стрик (дни подряд с решёнными строками), НЕ серия верных ответов
        if (goalEl) updateText(goalEl, `🔥${(window.computeDayStreak && window.computeDayStreak()) || 0}`);
    }
    // Дни до ЕГЭ — только когда их ≤150: раньше это шум, ближе к экзамену — мотивация.
    const daysBox = $('stat-days-box');
    if (daysBox) {
        const showDays = daysLeft > 0 && daysLeft <= 150;
        daysBox.classList.toggle('hidden', !showDays);
        daysBox.classList.toggle('flex', showDays);
        if (showDays) updateText($('stat-days'), daysLeft);
    }

    updateText($('stat-streak'), window.state.stats.streak);
    updateText($('stat-solved'), window.state.stats.egePoints || 0);
    if ($('zen-stat-solved')) updateText($('zen-stat-solved'), window.state.stats.egePoints || 0);
    updateText($('stat-learned'), totalL);
    updateText($('modal-stat-solved'), window.state.stats.totalSolvedEver);
    updateText($('modal-stat-mistakes'), window.state.mistakesPool.length + ((window.state.stats.mockExamMistakes || []).length));

    // Вместо счётчиков по заданиям — два понятных показателя: время за решением
    // (totalTimeSpent тикает по секунде в app.js) и % выученных фактов по всем заданиям.
    if ($('modal-stat-time')) {
        const sec = window.state.stats.totalTimeSpent || 0;
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
        updateText($('modal-stat-time'), h > 0 ? `${h} ч ${m} мин` : `${m} мин`);
    }
    if ($('modal-stat-learned-pct') && window.learnedCountInPeriod) {
        let learnedAll = 0, totalAll = 0;
        ['task1', 'task3', 'task4', 'task5', 'task7'].forEach(t => {
            const r = window.learnedCountInPeriod(t, 'all');
            learnedAll += r.learned; totalAll += r.total;
        });
        const pct = totalAll ? Math.round(learnedAll * 100 / totalAll) : 0;
        updateText($('modal-stat-learned-pct'), pct + '%');
        if ($('modal-stat-learned-abs')) $('modal-stat-learned-abs').textContent = `${learnedAll} из ${totalAll}`;
    }

    if (window.state.isHomeworkMode && window.state.hwTargetIndices && window.state.hwTargetIndices.length > 0 && $('hw-remaining'))
        updateText($('hw-remaining'), window.state.hwCurrentPool.length);

    if (window.state.stats.hwFlashcardsToSolve > 0) {
        if ($('lobby-hw-banner')) $('lobby-hw-banner').classList.remove('hidden');
        const activeN = window.countActiveAssignments ? window.countActiveAssignments() : 0;
        if ($('lobby-hw-remaining')) updateText($('lobby-hw-remaining'), activeN || window.state.stats.hwFlashcardsToSolve);
        const dlRawL = localStorage.getItem('teacher_hw_deadline');
        if ($('lobby-hw-deadline')) $('lobby-hw-deadline').textContent = dlRawL
            ? ('до ' + new Date(dlRawL + 'T00:00:00').toLocaleDateString('ru-RU', {day:'numeric',month:'long'})) : '';
    } else {
        if ($('lobby-hw-banner')) $('lobby-hw-banner').classList.add('hidden');
    }
    if (window.updateHwNavBadge) window.updateHwNavBadge();

    let h = totalL === 0 ? 100 : Math.round((freshL / totalL) * 100);
    if ($('stat-memory')) {
        const mem = $('stat-memory');
        mem.classList.remove('text-emerald-400','text-rose-400','text-yellow-400');
        if (h < 50) mem.classList.add('text-rose-400');
        else if (h < 80) mem.classList.add('text-yellow-400');
        else mem.classList.add('text-emerald-400');
        updateText(mem, h + '%');
    }
}

let _headerCenterBackup = null;
function renderTopBar({ daysLeft, sc, egePoints, totalL, totalSolved, hwMode }) {
    const center = document.getElementById('header-center');
    if (!center) return;

    if (_headerCenterBackup) {
        center.innerHTML = _headerCenterBackup;
        _headerCenterBackup = null;
    }
}

let toastTimeout = null;
function showToast(emoji, text, bg, border) { const t = $('joke-toast'), c = $('toast-content'); c.innerHTML = `<span>${emoji}</span><span>${text}</span>`; c.className = `${bg} ${border} text-slate-50 font-bold text-xs sm:text-sm px-4 py-2 rounded-l-lg shadow-lg flex items-center gap-2 border-y-2 border-l-2`; t.classList.remove('translate-x-full'); if (toastTimeout) clearTimeout(toastTimeout); toastTimeout = setTimeout(() => t.classList.add('translate-x-full'), 2000); }

function endGame() {
    clearInterval(window.state.timerInterval); $('modal-score').innerText = window.state.stats.streak;
    if (window.state.currentMode === 'speedrun') { if (window.state.stats.streak > (window.state.stats.bestSpeedrunScore || 0)) { window.state.stats.bestSpeedrunScore = window.state.stats.streak; checkAchievements(); } }
    saveLocal(); 
    syncNow();   
    showModal('game-over-modal'); $('board-overlay').classList.remove('hidden');
}

window.closeGameOverModal = function() { 
    if (window.state.isHomeworkMode) window.location.href = window.location.pathname; 
    else { hideModal('game-over-modal'); $('board-overlay').classList.add('hidden'); backToLobby(); } 
};

function shareTelegram() { const text = `🔥 Мой стрик в тренажере ЕГЭ по истории — ${(window.computeDayStreak && window.computeDayStreak()) || 0} дн. подряд! Попробуй побить: `; window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`); }

window.openStatsModal = function() {
    updateGlobalUI();
    if ($('stats-era-container')) {
        const tasks = [
            { key: 'task1', label: '⏳ Задание №1', color: 'text-cyan-600 dark:text-cyan-400' },
            { key: 'task3', label: '🔗 Задание №3', color: 'text-emerald-600 dark:text-emerald-400' },
            { key: 'task4', label: '📍 Задание №4', color: 'text-blue-600 dark:text-blue-400' },
            { key: 'task5', label: '👤 Задание №5', color: 'text-purple-600 dark:text-purple-400' },
            { key: 'task7', label: '🎨 Задание №7', color: 'text-amber-600 dark:text-amber-400' },
        ];
        // Прогноз ЕГЭ живёт здесь (из шапки убран): показываем только при достаточных данных.
        const _egeR = estimateEGEScore(window.state.stats);
        let _attempts = 0;
        Object.values(window.state.stats.eraStats || {}).forEach(t => Object.values(t || {}).forEach(e => { _attempts += (e && e.total) || 0; }));
        let eH = `<div onclick="window.openEGEModal&&window.openEGEModal()" class="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/15 border border-yellow-200 dark:border-yellow-900/40 rounded-xl p-3 mb-3 cursor-pointer active:scale-[0.98] transition-transform">
            <div>
                <div class="text-[10px] font-black text-yellow-700 dark:text-yellow-400 uppercase tracking-widest">🎯 Прогноз ЕГЭ</div>
                <div class="text-[10px] font-bold text-gray-400 mt-0.5">${_attempts >= 300 ? 'нажми — из чего складывается' : 'пока копим данные — реши ещё ' + Math.max(0, 300 - _attempts) + ' строк для точности'}</div>
            </div>
            <div class="text-2xl font-black ${_attempts >= 300 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-300 dark:text-gray-600'}">${_attempts >= 300 ? _egeR.score : '~' + _egeR.score}</div>
        </div>`;
        tasks.forEach(({ key, label, color }) => {
            const taskEra = (window.state.stats.eraStats || {})[key] || {};
            const totalAttempts = Object.values(taskEra).reduce((s, e) => s + (e.total || 0), 0);
            if (!totalAttempts) return;
            eH += `<div class="mb-3"><div class="text-[10px] font-black ${color} uppercase tracking-widest mb-2 px-1">${label}</div>`;
            for (const [eKey, eName] of Object.entries(TASK_EPOCH_NAMES)) {
                const e = taskEra[eKey] || { correct: 0, total: 0 };
                if (!e.total) continue;
                const pc = Math.round((e.correct / e.total) * 100);
                const pcColor = pc > 80 ? 'text-emerald-500' : pc > 50 ? 'text-yellow-500' : 'text-rose-500';
                const barColor = pc > 80 ? 'var(--c-success)' : pc > 50 ? 'var(--c-warn)' : 'var(--c-danger-soft)';
                eH += `<div class="flex items-center gap-3 bg-gray-50 dark:bg-[#181818] p-2.5 rounded-xl border border-gray-100 dark:border-[#2c2c2c] mb-1.5">
                    <span class="text-[10px] font-black text-gray-500 dark:text-gray-400 min-w-[90px]">${eName}</span>
                    <div class="flex-1 h-1.5 bg-gray-200 dark:bg-[#2c2c2c] rounded-full overflow-hidden">
                        <div style="width:${pc}%;background:${barColor}" class="h-full rounded-full"></div>
                    </div>
                    <span class="text-xs font-black ${pcColor} min-w-[42px] text-right">${pc}% <span class="text-gray-400 font-normal text-[10px]">(${e.correct}/${e.total})</span></span>
                </div>`;
            }
            eH += '</div>';
        });
        $('stats-era-container').innerHTML = eH || '<p class="text-[11px] font-bold text-gray-400 uppercase tracking-widest text-center py-4">Ещё нет данных</p>';
    }
    if ($('stats-daily-container')) { const dStat = window.state.stats.dailyStats || {}; const dts = Object.keys(dStat).sort((a,b) => new Date(b) - new Date(a)).slice(0, 7); if (dts.length > 0) { let dH = ''; dts.forEach(d => { const day = dStat[d]; const mins = Math.floor((day.timeSpent || 0) / 60); const t1 = day.solvedTask1 || 0; const t3 = day.solvedTask3 || 0; const t4 = day.solvedTask4 || 0; const t5 = day.solvedTask5 || 0; const t7 = day.solvedTask7 || 0; const total = day.solved || 0; const taskParts = []; if (t1) taskParts.push(`<span class="text-cyan-600 dark:text-cyan-400">⏳${t1}</span>`); if (t3) taskParts.push(`<span class="text-emerald-500">🔗${t3}</span>`); if (t4) taskParts.push(`<span class="text-blue-500">📍${t4}</span>`); if (t5) taskParts.push(`<span class="text-purple-500">👤${t5}</span>`); if (t7) taskParts.push(`<span class="text-amber-500">🎨${t7}</span>`); const taskStr = taskParts.length > 0 ? taskParts.join(' ') : `<span class="text-examBlue dark:text-blue-400">${total}</span>`; dH += `<div class="bg-gray-50 dark:bg-[#181818] p-3 rounded-xl border border-gray-100 dark:border-[#2c2c2c]"><div class="flex justify-between items-center"><span class="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">${new Date(d).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</span><span class="font-bold text-yellow-600 dark:text-yellow-500 text-[11px]">⏱ ${mins} мин</span></div><div class="flex gap-3 mt-1.5 text-[11px] font-black">${taskStr}<span class="text-gray-400 ml-auto">Всего: ${total}</span></div></div>`; }); $('stats-daily-container').innerHTML = dH; } else $('stats-daily-container').innerHTML = '<p class="text-[11px] font-bold text-gray-500 text-center py-4 uppercase tracking-widest">Пока нет данных.</p>'; }
    showModal('stats-modal');
};

window.openMistakesListModal = function() {
    const cont = $('mistakes-list-container');
    const pool = window.state.mistakesPool || [];
    const examPool = (window.state.stats && Array.isArray(window.state.stats.mockExamMistakes))
        ? window.state.stats.mockExamMistakes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        : [];
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    if (pool.length === 0 && examPool.length === 0) {
        cont.innerHTML = '<div class="text-center p-8 text-gray-500 font-bold text-sm uppercase tracking-widest bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#2c2c2c]">Ошибок нет! Вы молодец 🎉</div>';
    } else {
        let ht = '';
        if (examPool.length) {
            ht += `<div class="mb-5"><div class="flex items-center justify-between mb-2 px-1"><div class="text-[11px] font-black text-rose-500 uppercase tracking-widest">Пробники и задания ФИПИ</div><div class="text-[10px] font-black text-gray-400">${examPool.length} за всё время</div></div><div class="flex flex-col gap-2">`;
            examPool.forEach((m, idx) => {
                const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                const source = m.source === 'trainer' ? 'Тренажёр · открытый банк' : 'Пробник ЕГЭ';
                const soft = m.acceptedWithWarning ? '<span class="text-amber-600 dark:text-amber-400">Балл засчитан учебной проверкой</span>' : `<span class="text-rose-600 dark:text-rose-400">${Number(m.points) || 0}/${Number(m.max) || 0} балла</span>`;
                ht += `<button type="button" data-action="openExamMistake" data-arg="${esc(m.id)}" class="w-full bg-white dark:bg-[#1e1e1e] p-3 rounded-xl border border-rose-200 dark:border-rose-900/40 shadow-sm text-left active:scale-[.99] transition-transform">
                    <div class="flex items-start gap-3"><div class="font-black text-rose-300 w-5 text-right shrink-0">${idx + 1}.</div><div class="min-w-0 flex-1">
                    <div class="flex flex-wrap justify-between gap-1"><span class="text-[9px] font-black text-gray-400 uppercase tracking-widest">${source} · №${Number(m.kim) || '?'}</span><span class="text-[9px] font-bold text-gray-400">${esc(date)}</span></div>
                    <div class="font-bold text-gray-800 dark:text-gray-200 leading-snug mt-1 line-clamp-3">${esc(m.condition || 'Условие задания')}</div>
                    <div class="mt-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-[11px]"><b class="text-rose-500">Ваш ответ:</b> ${esc(m.answerText || 'Нет ответа')}</div>
                    <div class="mt-1 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-[11px]"><b class="text-emerald-600">Правильно:</b> ${esc(m.correctText || '')}</div>
                    <div class="mt-2 text-[10px] font-black">${soft} <span class="text-blue-500 ml-2">Открыть полный разбор →</span></div>
                    </div></div></button>`;
            });
            ht += '</div></div>';
        }
        if (pool.length) {
            ht += `<div><div class="flex items-center justify-between mb-2 px-1"><div class="text-[11px] font-black text-gray-500 uppercase tracking-widest">Ошибки основных тренажёров</div><div class="text-[10px] font-black text-gray-400">${pool.length} сейчас в повторении</div></div><div class="flex flex-col gap-2">`;
            pool.forEach((m, idx) => {
                const fact = m.fact || {};
                const mTitle = m.task === 'task7' ? '🎨 Задание 7' : (m.task === 'task5' ? '👤 Задание 5' : (m.task === 'task3' ? '🔗 Задание 3' : (m.task === 'task1' ? '⏳ Задание 1' : '📍 Задание 4')));
                const parts = m.task === 'task7' ? [fact.culture, fact.trait] : m.task === 'task5' ? [fact.person, fact.event] : m.task === 'task3' ? [fact.process, fact.fact] : m.task === 'task1' ? [fact.event, fact.year] : [fact.geo, fact.year, fact.event];
                ht += `<div class="bg-white dark:bg-[#1e1e1e] p-3 rounded-xl border border-rose-100 dark:border-rose-900/30 shadow-sm flex gap-3 text-sm"><div class="font-black text-rose-300 w-4 text-right shrink-0">${idx + 1}.</div><div class="flex flex-col"><span class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">${mTitle}</span><span class="font-medium text-gray-800 dark:text-gray-300 leading-tight">${parts.filter(Boolean).map(esc).join(' ➡️ ')}</span></div></div>`;
            });
            ht += '</div></div>';
        }
        cont.innerHTML = ht;
    }
    showModal('mistakes-list-modal');
};

// ─── Модалка «лимит на сегодня исчерпан» (пейволл клуба) ─────────────────
window.showDailyLimitModal = function() {
    if (document.getElementById('limit-overlay')) return;
    const info = window._dailyLimitInfo || {};
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const msg = info.message || `Ты решил сегодня максимум — ${info.limit} строк. Мозгу нужен отдых, возвращайся завтра!`;
    // Кнопку клуба показываем только с безопасной ссылкой (https или t.me)
    const url = String(info.clubUrl || '');
    const safeUrl = /^https:\/\//.test(url) ? url : '';
    const clubBtn = safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="block w-full bg-blue-600 text-white rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:13px;margin-top:14px;font-size:13px">🚀 Хочу безлимит</a>` : '';
    const ov = document.createElement('div');
    ov.id = 'limit-overlay';
    ov.className = 'fixed inset-0 flex items-center justify-center';
    ov.style.cssText = 'z-index:10008;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px)';
    ov.innerHTML = `
        <div class="bg-white dark:bg-[#1e1e1e] rounded-3xl shadow-2xl text-center" style="padding:26px 22px;width:88%;max-width:340px">
            <div style="font-size:52px;line-height:1">⏳</div>
            <div class="font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest" style="font-size:15px;margin-top:8px">Лимит на сегодня</div>
            <div class="text-[13px] font-bold text-gray-500 dark:text-gray-400" style="margin-top:8px;line-height:1.45">${esc(msg)}</div>
            ${clubBtn}
            <button id="limit-close" class="w-full bg-gray-100 dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-2xl font-black uppercase tracking-wider active:scale-95 transition-transform" style="padding:11px;margin-top:8px;font-size:12px">Понятно</button>
        </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#limit-close').onclick = () => ov.remove();
};

window.openProfileModal = function() {
    $('profile-name-input').value = localStorage.getItem('student_manual_name') || '';
    const gEmail = localStorage.getItem('google_email');
    if ($('profile-google-status')) {
        $('profile-google-status').textContent = gEmail ? '✅ Привязан: ' + gEmail : 'Не привязан';
        $('profile-google-status').className = gEmail ? 'text-[11px] font-bold text-emerald-600 mt-1' : 'text-[11px] font-bold text-gray-400 mt-1';
    }
    // Кнопка Google: внутри Telegram попап-вход не работает — прячем и подсказываем.
    // Вне Telegram: если уже есть tg-личность — кнопка «привязать» (email станет вторым
    // входом в ТОТ ЖЕ аккаунт), если личности нет — обычный вход.
    {
        const gBtn = $('profile-google-btn'), gHint = $('profile-google-hint'), gLbl = $('profile-google-btn-label');
        const tgw = window.Telegram && window.Telegram.WebApp;
        const inTgApp = !!(tgw && ((tgw.initData && String(tgw.initData).length > 0) || (tgw.initDataUnsafe && tgw.initDataUnsafe.user)));
        const hasTgIdentity = !!localStorage.getItem('known_tg_id');
        if (gBtn) gBtn.classList.toggle('hidden', inTgApp || !!gEmail);
        if (gLbl) gLbl.textContent = hasTgIdentity ? '🔗 Привязать Google к аккаунту' : 'Войти через Google';
        if (gHint) {
            let hint = '';
            if (inTgApp && !gEmail) hint = 'Чтобы входить и с компьютера по почте: открой сайт на ПК, войди по QR, затем нажми «Привязать Google» в профиле.';
            else if (!inTgApp && hasTgIdentity && !gEmail) hint = 'Привяжи Google — сможешь входить по почте на любом устройстве, прогресс и роль общие с Telegram.';
            gHint.textContent = hint;
            gHint.classList.toggle('hidden', !hint);
        }
    }
    // «Сменить аккаунт» — только вне реального Telegram (там личность из initData,
    // выход бессмыслен) и только если устройство к кому-то привязано.
    const logoutBtn = $('profile-logout-btn');
    if (logoutBtn) {
        const tg = window.Telegram && window.Telegram.WebApp;
        const inTg = !!(tg && ((tg.initData && String(tg.initData).length > 0) || (tg.initDataUnsafe && tg.initDataUnsafe.user)));
        const bound = !!(localStorage.getItem('known_tg_id') || localStorage.getItem('google_uid'));
        logoutBtn.classList.toggle('hidden', inTg || !bound);
    }
    showModal('profile-modal');
};
window.saveProfileName = function() {
    const nm = $('profile-name-input').value.trim();
    const prevNm = localStorage.getItem('student_manual_name') || '';
    if (nm) {
        localStorage.setItem('student_manual_name', nm);
        if (nm !== prevNm) localStorage.setItem('student_manual_name_at', String(Date.now()));
    }
    showToast('✅', 'Профиль сохранён!', 'bg-emerald-500', 'border-emerald-700');
    hideModal('profile-modal');
    if (window.syncProgressToCloud) window.syncProgressToCloud();
};

window.openAchievementsModal = function() {
    const gr = $('achievements-grid'); if (gr && typeof achievementsList !== 'undefined') { let ht = ''; achievementsList.forEach(a => { const isU = window.state.stats.achievements.includes(a.id); ht += `<div class="achievement-card bg-white dark:bg-[#1e1e1e] border ${isU ? 'border-yellow-400 shadow-[0_4px_15px_rgba(250,204,21,0.2)]' : 'border-gray-100 dark:border-[#2c2c2c]'} rounded-2xl p-4 flex flex-col items-center text-center relative ${isU ? '' : 'achievement-locked'}"><div class="text-4xl mb-3 drop-shadow-sm">${a.icon}</div><h4 class="font-black text-[10px] sm:text-xs text-gray-800 dark:text-gray-300 mb-1 leading-tight uppercase tracking-wide">${a.name}</h4><p class="text-[9px] font-bold text-gray-400 leading-tight mt-1">${a.desc}</p></div>`; }); gr.innerHTML = ht; }
    showModal('achievements-modal');
};

window.openTeacherModal = async function() {
    const authorized = window.checkTeacherRole ? await window.checkTeacherRole() : false;
    if (!authorized) {
        hideModal('teacher-modal');
        return false;
    }
    let tc = localStorage.getItem('teacher_class_code'); if(!tc) { tc = Math.floor(1000 + Math.random() * 9000).toString(); localStorage.setItem('teacher_class_code', tc); } $('teacher-class-code-input').value = tc;
    if (window.populateTeacherGroups) window.populateTeacherGroups();
    switchTeacherTab('stats'); showModal('teacher-modal');
    return true;
};

// Заполнить дропдаун группами учителя (window._teacherGroups = [{code,name}]).
// Не-админ: показываем только дропдаун (свои группы), ручной ввод кода прячем и
// прячем галочку «только мой класс» (для него фильтр всегда включён).
window.populateTeacherGroups = function() {
    const sel = $('teacher-group-select'); if (!sel) return;
    const wrap = $('teacher-group-wrap'), codeWrap = $('teacher-code-wrap');
    const filterLabel = $('teacher-filter-class') ? $('teacher-filter-class').closest('label') : null;
    const groups = Array.isArray(window._teacherGroups) ? window._teacherGroups : [];
    const isAdmin = !!window._isGlobalAdmin;

    if (groups.length) {
        const cur = localStorage.getItem('teacher_class_code') || groups[0].code;
        sel.innerHTML = groups.map(g => `<option value="${(g.code||'').replace(/"/g,'&quot;')}">${(g.name||g.code)}</option>`).join('');
        const chosen = groups.some(g => g.code === cur) ? cur : groups[0].code;
        sel.value = chosen;
        // Сохранённый код мог устареть (не входит в группы) — синхронизируем на выбранную группу,
        // иначе loadClassProgress запросил бы пустой старый код.
        if (chosen !== cur) {
            localStorage.setItem('teacher_class_code', chosen);
            const inp2 = $('teacher-class-code-input'); if (inp2) inp2.value = chosen;
        }
        if (wrap) { wrap.classList.remove('hidden'); wrap.classList.add('flex'); }
        // не-админ управляет только своими группами → ручной код и общий фильтр прячем
        if (!isAdmin) {
            if (codeWrap) codeWrap.classList.add('hidden');
            if (filterLabel) filterLabel.classList.add('hidden');
        } else {
            if (codeWrap) codeWrap.classList.remove('hidden');
            if (filterLabel) filterLabel.classList.remove('hidden');
        }
    } else {
        // групп нет: дропдаун прячем, оставляем ручной код (для админа/старых учителей)
        if (wrap) { wrap.classList.add('hidden'); wrap.classList.remove('flex'); }
        if (codeWrap) codeWrap.classList.remove('hidden');
        if (filterLabel) filterLabel.classList.remove('hidden');
    }
};

window.onTeacherGroupChange = function(code) {
    if (!code) return;
    localStorage.setItem('teacher_class_code', code);
    const inp = $('teacher-class-code-input'); if (inp) inp.value = code;
    if (window.loadClassProgress) window.loadClassProgress();
};

window.saveTeacherClassCode = function() { const cd = $('teacher-class-code-input').value.trim(); if(cd) localStorage.setItem('teacher_class_code', cd); if (window.loadClassProgress) window.loadClassProgress(); };

// Ссылка-приглашение в класс через TG-бота: ученик нажимает → бот пишет inviteClassCode
// в его облачный документ → приложение само подключает класс. Кириллица кодируется base64url (cb_).
window.copyClassInvite = function() {
    const BOT = 'Reshay_istoriyu_bot';
    const code = ($('teacher-class-code-input').value || '').trim().replace(/[\/#?%]/g, '_');
    if (!code) { showToast('⚠️', 'Сначала укажи код класса', 'bg-amber-500', 'border-amber-700'); return; }
    let payload;
    if (/^[A-Za-z0-9_-]{1,48}$/.test(code)) payload = 'c_' + code;
    else {
        try {
            const bytes = new TextEncoder().encode(code);
            let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
            const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            if (b64.length > 60) { showToast('⚠️', 'Код класса слишком длинный для ссылки', 'bg-amber-500', 'border-amber-700'); return; }
            payload = 'cb_' + b64;
        } catch (e) { showToast('❌', 'Не удалось построить ссылку', 'bg-rose-500', 'border-rose-700'); return; }
    }
    const link = `https://t.me/${BOT}?start=${payload}`;
    const done = () => showToast('🔗', 'Ссылка-приглашение скопирована! Отправь её ученикам', 'bg-emerald-500', 'border-emerald-700');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = link; ta.style.position = 'fixed'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done).catch(fallback); else fallback();
};
window.switchTeacherTab = function(tab) { ['stats', 'weekly'].forEach(t => { $(`teacher-tab-${t}`).classList.add('hidden'); $(`teacher-tab-${t}`).classList.remove('flex'); $(`tab-btn-${t}`).className = "py-3 text-[9px] sm:text-xs font-black border-b-2 border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 transition-colors uppercase tracking-wide leading-none truncate"; }); $(`teacher-tab-${tab}`).classList.remove('hidden'); $(`teacher-tab-${tab}`).classList.add('flex'); $(`tab-btn-${tab}`).className = "py-3 text-[9px] sm:text-xs font-black border-b-2 border-examBlue text-examBlue dark:text-blue-400 transition-colors uppercase tracking-wide leading-none truncate"; if (window.loadClassProgress) window.loadClassProgress(); };

window.openGlobalTopModal = function() {
    showModal('global-top-modal');
    if (window.loadGlobalLeaderboard) window.loadGlobalLeaderboard();
};

window.copyTextReport = function() {
    const s = window.state.stats;
    let t = `🏛 Решай Историю — тренажёр ЕГЭ\n\n`;
    t += `📊 Всего решено: ${s.totalSolvedEver || 0}\n`;
    t += `🔥 Текущий стрик: ${s.streak || 0}\n`;
    
    if (typeof estimateEGEScore === 'function') {
        const egeResult = estimateEGEScore(s);
        t += `🎓 Прогноз ЕГЭ: ${egeResult.score} баллов\n\n`;
    }

    t += `📈 Точность по эпохам:\n`;
    const tasks = ['task1', 'task3', 'task4', 'task5', 'task7'];
    const eMap = { 'early': 'Древность', '18th': 'XVIII в.', '19th': 'XIX в.', '20th': 'XX в.' };
    const combinedEra = { 'early': {c:0,t:0}, '18th': {c:0,t:0}, '19th': {c:0,t:0}, '20th': {c:0,t:0} };
    
    tasks.forEach(tk => {
        if (!s.eraStats || !s.eraStats[tk]) return;
        Object.keys(eMap).forEach(eKey => {
            if (s.eraStats[tk][eKey]) {
                combinedEra[eKey].c += s.eraStats[tk][eKey].correct || 0;
                combinedEra[eKey].t += s.eraStats[tk][eKey].total || 0;
            }
        });
    });
    
    Object.keys(eMap).forEach(eKey => {
        const correct = combinedEra[eKey].c;
        const total = combinedEra[eKey].t;
        if (total === 0) return;
        const pct = Math.round((correct / total) * 100);
        t += `- ${eMap[eKey]}: ${pct}% (${correct} из ${total})\n`;
    });

    if (window.state.mistakesPool && window.state.mistakesPool.length > 0) { 
        t += `\n⚠️ Ошибки:\n`; 
        window.state.mistakesPool.forEach((m, i) => { 
            if (m.task === 'task7') t += `${i + 1}. ${m.fact.culture} ➡️ ${m.fact.trait}\n`;
            else if (m.task === 'task5') t += `${i + 1}. ${m.fact.event} ➡️ ${m.fact.person}\n`;
            else if (m.task === 'task3') t += `${i + 1}. ${m.fact.process} ➡️ ${m.fact.fact}\n`;
            else if (m.task === 'task1') t += `${i + 1}. ${m.fact.event} ➡️ ${m.fact.year}\n`;
            else t += `${i + 1}. ${m.fact.geo} | ${m.fact.event} | ${m.fact.year}\n`; 
        }); 
    } else t += `\n🎉 Ошибок нет!\n`; 
    
    const copyFn = () => { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('📋', 'Скопировано!', 'bg-emerald-500', 'border-emerald-700'); }; 
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => showToast('📋', 'Скопировано!', 'bg-emerald-500', 'border-emerald-700')).catch(copyFn); else copyFn();
};

window.handleLogoClick = function() {
    if (typeof haptic === 'function') haptic('light');
    showToast('🏛️', 'Решай Историю', 'bg-blue-500', 'border-blue-700');
};
