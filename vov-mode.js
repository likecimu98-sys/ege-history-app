// vov-mode.js — учебный режим «ВОВ» (задание 8, старый образец: вставь пропущенные
// элементы в предложения о Великой Отечественной войне). Это ТОЛЬКО практика:
//   • не даёт строк и баллов (не трогает checkAnswers/egePoints/dailyStats/лимиты);
//   • у каждого задания свой статус «выучено» (state.stats.vovLearned[id]);
//   • выученные задания уходят из пула, пока не сброшены.
// Самодостаточный оверлей (как match-mode.js / swipe-mode.js): не трогает currentMode/таблицу.
// Данные (task8Data.js, ~30 КБ) грузятся лениво при первом открытии — не тянем на старте.
'use strict';

(function () {
    let _v = null;
    const Z = 10007;
    const DATA_URL = './task8Data.js';
    let _dataPromise = null;

    function _h(t) { try { if (typeof haptic === 'function') haptic(t); } catch (e) {} }
    function _play(ok) { try { if (window.Sfx) window.Sfx.play(ok ? 'wow' : 'fah'); } catch (e) {} }
    function _esc(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s))
            : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function _shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

    function _loadData() {
        if (window.task8Data && window.task8Data.length) return Promise.resolve(window.task8Data);
        if (_dataPromise) return _dataPromise;
        _dataPromise = new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = DATA_URL;
            // При успехе — данные; при любой осечке ОБНУЛЯЕМ _dataPromise, чтобы «Повторить»
            // мог перезапросить (иначе закэшированный null навсегда ломал бы режим).
            s.onload = () => {
                if (window.task8Data && window.task8Data.length) resolve(window.task8Data);
                else { _dataPromise = null; resolve(null); }
            };
            s.onerror = () => { _dataPromise = null; resolve(null); };
            document.body.appendChild(s);
        });
        return _dataPromise;
    }

    function _learnedMap() {
        const st = window.state && window.state.stats;
        if (!st) return {};
        if (!st.vovLearned || typeof st.vovLearned !== 'object') st.vovLearned = {};
        return st.vovLearned;
    }
    function _pool() {
        const learned = _learnedMap();
        return (window.task8Data || []).filter(t => t && t.id && !learned[t.id]);
    }
    function _saveProgress() { try { if (typeof saveProgress === 'function') saveProgress(); } catch (e) {} }

    window.openVovMode = async function () {
        if (_v) return;
        try { if (window.Sfx) window.Sfx.unlock(); } catch (e) {}
        // Оверлей открываем СРАЗУ (мгновенный отклик) — на холодной загрузке task8Data.js
        // может тянуться по сети пару секунд, и без этого кнопка казалась «мёртвой».
        _v = { task: null, opts: [], slot: [], used: new Set(), sel: -1, checked: false, loading: true };
        _ensureData();
    };

    async function _ensureData() {
        _renderLoading();
        const data = await _loadData();
        if (!_v) return;                 // закрыли, пока грузилось
        if (!data || !data.length) { _renderError(); return; }
        _v.loading = false;
        _next(true);
    }

    window.closeVovMode = function () {
        const ov = document.getElementById('vov-overlay');
        if (ov) ov.remove();
        _v = null;
    };

    // Берём случайное НЕвыученное задание. null → всё выучено.
    function _pickTask() {
        const pool = _pool();
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function _next(first) {
        const task = _pickTask();
        if (!task) { _renderDone(); return; }
        _v.task = task;
        _v.opts = _shuffle((task.options || []).slice());
        _v.slot = task.sentences.map(() => null);
        _v.used = new Set();
        _v.sel = -1;
        _v.checked = false;
        _render();
        if (first) _h('light');
    }

    function _total() { return (window.task8Data || []).length; }
    function _learnedCount() { return Object.keys(_learnedMap()).length; }

    function _shell(innerHtml) {
        const old = document.getElementById('vov-overlay');
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = 'vov-overlay';
        ov.className = 'fixed inset-0 flex flex-col bg-gray-50 dark:bg-[#121212]';
        ov.style.cssText = `z-index:${Z};padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))`;
        ov.innerHTML = `
            <div class="vv-col" style="width:100%;max-width:640px;margin:0 auto;display:flex;flex-direction:column;flex-grow:1;min-height:0">
                <div class="flex items-center justify-between shrink-0 mb-2" style="gap:8px">
                    <div class="text-left" style="min-width:96px">
                        <div class="text-[9px] font-black uppercase tracking-widest" style="color:#4d7c0f">🎖️ ВОВ · практика</div>
                        <div class="text-[10px] font-bold text-gray-400">Выучено ${_learnedCount()} / ${_total()}</div>
                    </div>
                    <button id="vv-exit" class="font-black text-xs bg-white dark:bg-[#2c2c2c] text-gray-600 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-[#3f3f46] shadow-sm active:scale-95 transition-transform" style="padding:8px 12px">✕ Выйти</button>
                </div>
                <div id="vv-body" class="flex-grow" style="overflow-y:auto;min-height:0">${innerHtml}</div>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#vv-exit').onclick = () => { _h('light'); window.closeVovMode(); };
        return ov;
    }

    function _renderDone() {
        const ov = _shell(`
            <div class="flex flex-col items-center justify-center text-center h-full" style="gap:14px;padding:24px 10px">
                <div style="font-size:60px;line-height:1">🎖️</div>
                <div class="font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest" style="font-size:16px">Все задания ВОВ выучены!</div>
                <div class="text-xs font-bold text-gray-400" style="max-width:320px">Ты прошёл все ${_total()} заданий про Великую Отечественную войну. Можно сбросить прогресс и повторить.</div>
                <button id="vv-reset" class="bg-white dark:bg-[#2c2c2c] text-gray-700 dark:text-gray-300 rounded-2xl font-black uppercase tracking-wider border border-gray-200 dark:border-[#3f3f46] active:scale-95 transition-transform" style="padding:12px 18px;font-size:12px;margin-top:6px">🔁 Сбросить прогресс ВОВ</button>
            </div>`);
        ov.querySelector('#vv-reset').onclick = () => {
            const st = window.state && window.state.stats;
            if (st) { st.vovLearned = {}; _saveProgress(); }
            _h('medium');
            _next(true);
        };
    }

    function _renderLoading() {
        _shell(`
            <div class="flex flex-col items-center justify-center text-center h-full" style="gap:14px;padding:24px 10px">
                <div class="vv-spinner"></div>
                <div class="text-xs font-bold text-gray-400">Загрузка заданий ВОВ…</div>
            </div>`);
    }

    function _renderError() {
        const ov = _shell(`
            <div class="flex flex-col items-center justify-center text-center h-full" style="gap:14px;padding:24px 10px">
                <div style="font-size:44px;line-height:1">📡</div>
                <div class="font-black text-gray-800 dark:text-gray-200" style="font-size:14px">Не удалось загрузить задания</div>
                <div class="text-xs font-bold text-gray-400" style="max-width:300px">Проверь интернет и попробуй ещё раз.</div>
                <button id="vv-retry" class="vv-btn vv-btn-green" style="max-width:220px">Повторить</button>
            </div>`);
        const rb = ov.querySelector('#vv-retry');
        if (rb) rb.onclick = () => { _h('light'); _ensureData(); };
    }

    function _render() {
        const t = _v.task;
        const kes = (t.kes && t.kes[0]) ? `<div class="text-[10px] font-bold text-gray-400 mb-2" style="line-height:1.3">📚 ${_esc(t.kes[0])}</div>` : '';
        const sentences = t.sentences.map((s, i) => {
            const parts = String(s.text).split(/_{3,}/);
            const before = _esc(parts[0] || '');
            const after = _esc(parts.slice(1).join(' '));
            const filled = _v.slot[i] != null;
            const label = filled ? _esc(_v.opts[_v.slot[i]]) : '…';
            let cls = 'vv-slot', extra = '';
            if (_v.checked && filled) {
                const ok = _v.opts[_v.slot[i]] === s.answer;
                cls += ok ? ' vv-ok' : ' vv-bad';
                if (!ok) extra = `<span class="vv-correct"> ✓ ${_esc(s.answer)}</span>`;
            }
            return `<div class="vv-sentence"><span class="vv-letter">${_esc(s.letter)})</span> ${before}<button class="${cls}" data-slot="${i}">${label}</button>${after}${extra}</div>`;
        }).join('');

        const chips = _v.opts.map((o, i) => {
            const used = _v.used.has(i);
            const selCls = _v.sel === i ? ' vv-sel' : '';
            return `<button class="vv-chip${selCls}" data-chip="${i}" ${used ? 'data-used="1"' : ''}>${_esc(o)}</button>`;
        }).join('');

        const allFilled = _v.slot.every(x => x != null);
        const allCorrect = _v.checked && t.sentences.every((s, i) => _v.slot[i] != null && _v.opts[_v.slot[i]] === s.answer);

        let footer;
        if (allCorrect) {
            footer = `<div class="vv-result vv-win">🎖️ Всё верно — задание выучено!</div>
                <button id="vv-nextbtn" class="vv-btn vv-btn-green">Следующее →</button>`;
        } else if (_v.checked) {
            footer = `<div class="vv-result vv-lose">Не всё верно. Исправь красное и проверь снова.</div>
                <button id="vv-checkbtn" class="vv-btn vv-btn-blue" ${allFilled ? '' : 'disabled'}>Проверить</button>
                <button id="vv-skipbtn" class="vv-btn vv-btn-ghost">Пропустить это задание</button>`;
        } else {
            footer = `<button id="vv-checkbtn" class="vv-btn vv-btn-blue" ${allFilled ? '' : 'disabled'}>Проверить</button>
                <button id="vv-skipbtn" class="vv-btn vv-btn-ghost">Пропустить</button>`;
        }

        const ov = _shell(`
            ${kes}
            <div class="vv-card">${sentences}</div>
            <div class="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-3 mb-1">Элементы — нажми, потом на пропуск</div>
            <div class="vv-chips">${chips}</div>
            <div class="vv-footer">${footer}</div>`);

        ov.querySelectorAll('.vv-chip').forEach(b => {
            b.onclick = () => _pickChip(parseInt(b.dataset.chip, 10));
        });
        ov.querySelectorAll('.vv-slot').forEach(b => {
            b.onclick = () => _tapSlot(parseInt(b.dataset.slot, 10));
        });
        const cb = ov.querySelector('#vv-checkbtn'); if (cb) cb.onclick = _check;
        const nb = ov.querySelector('#vv-nextbtn'); if (nb) nb.onclick = () => { _h('light'); _next(false); };
        const sb = ov.querySelector('#vv-skipbtn'); if (sb) sb.onclick = () => { _h('light'); _next(false); };
    }

    function _pickChip(i) {
        if (!_v || _v.used.has(i)) return;
        _h('light');
        _v.checked = false;               // изменил ответ — сбрасываем прежнюю проверку
        _v.sel = (_v.sel === i) ? -1 : i;
        _render();
    }

    function _tapSlot(k) {
        if (!_v) return;
        _h('light');
        _v.checked = false;
        if (_v.slot[k] != null) {
            // очистить слот — вернуть элемент в пул
            _v.used.delete(_v.slot[k]);
            _v.slot[k] = null;
        } else if (_v.sel >= 0) {
            _v.slot[k] = _v.sel;
            _v.used.add(_v.sel);
            _v.sel = -1;
        }
        _render();
    }

    function _check() {
        if (!_v || !_v.slot.every(x => x != null)) return;
        _v.checked = true;
        const t = _v.task;
        const allCorrect = t.sentences.every((s, i) => _v.opts[_v.slot[i]] === s.answer);
        if (allCorrect) {
            const lm = _learnedMap();
            lm[t.id] = true;
            _saveProgress();
            _play(true); _h('medium');
        } else {
            _play(false); _h('heavy');
        }
        _render();
    }

    // Стили режима
    try {
        const st = document.createElement('style');
        st.textContent = `
        #vov-overlay .vv-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:14px 14px 6px}
        .dark #vov-overlay .vv-card,html.dark #vov-overlay .vv-card{background:#1e1e1e;border-color:#2c2c2c}
        #vov-overlay .vv-sentence{font-size:14px;line-height:1.7;color:#1f2937;margin-bottom:12px}
        .dark #vov-overlay .vv-sentence{color:#d1d5db}
        #vov-overlay .vv-letter{font-weight:900;color:#4d7c0f;margin-right:2px}
        #vov-overlay .vv-slot{display:inline-block;min-width:64px;padding:1px 8px;margin:0 2px;border:2px dashed #9ca3af;border-radius:8px;background:rgba(77,124,15,0.06);font-weight:800;color:#111827;vertical-align:baseline;cursor:pointer;transition:all .12s}
        .dark #vov-overlay .vv-slot{color:#f3f4f6}
        #vov-overlay .vv-slot.vv-ok{border-style:solid;border-color:#10b981;background:rgba(16,185,129,0.14);color:#047857}
        #vov-overlay .vv-slot.vv-bad{border-style:solid;border-color:#f43f5e;background:rgba(244,63,94,0.14);color:#be123c}
        #vov-overlay .vv-correct{color:#059669;font-weight:800;font-size:12px}
        #vov-overlay .vv-chips{display:flex;flex-wrap:wrap;gap:8px}
        #vov-overlay .vv-chip{padding:9px 13px;border-radius:12px;border:2px solid #e5e7eb;background:#fff;color:#1f2937;font-weight:800;font-size:13px;cursor:pointer;transition:transform .1s,border-color .1s,opacity .15s}
        .dark #vov-overlay .vv-chip{background:#1e1e1e;border-color:#3f3f46;color:#e5e7eb}
        #vov-overlay .vv-chip.vv-sel{border-color:#4d7c0f;box-shadow:0 0 0 3px rgba(77,124,15,0.22);transform:scale(1.04)}
        #vov-overlay .vv-chip[data-used]{opacity:.32;pointer-events:none}
        #vov-overlay .vv-footer{margin-top:14px;display:flex;flex-direction:column;gap:8px}
        #vov-overlay .vv-btn{width:100%;padding:13px;border-radius:14px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;font-size:13px;border:none;cursor:pointer;transition:transform .1s,opacity .1s}
        #vov-overlay .vv-btn:active{transform:scale(.97)}
        #vov-overlay .vv-btn[disabled]{opacity:.4;pointer-events:none}
        #vov-overlay .vv-btn-blue{background:#2563eb;color:#fff}
        #vov-overlay .vv-btn-green{background:#4d7c0f;color:#fff}
        #vov-overlay .vv-btn-ghost{background:transparent;color:#9ca3af;font-size:11px;padding:8px}
        #vov-overlay .vv-result{text-align:center;font-weight:800;font-size:13px;padding:4px}
        #vov-overlay .vv-win{color:#4d7c0f}
        #vov-overlay .vv-lose{color:#f43f5e}
        #vov-overlay .vv-spinner{width:34px;height:34px;border-radius:50%;border:4px solid rgba(77,124,15,0.2);border-top-color:#4d7c0f;animation:vvspin .8s linear infinite}
        @keyframes vvspin{to{transform:rotate(360deg)}}
        /* Десктоп: не «пустая страница на весь экран», а центрированная панель-модалка
           поверх затемнённого фона; крупнее шрифты — мелкий мобильный текст на мониторе
           смотрелся отвратительно. Мобильную (full-bleed) раскладку не трогаем. */
        @media (min-width:700px){
          #vov-overlay{justify-content:center;background:rgba(17,24,39,0.55)!important;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);padding:28px!important}
          .dark #vov-overlay,html.dark #vov-overlay{background:rgba(0,0,0,0.62)!important}
          #vov-overlay .vv-col{flex-grow:0!important;max-width:680px;max-height:88vh;background:#fff;border-radius:24px;box-shadow:0 24px 64px rgba(0,0,0,0.30);padding:26px 30px 24px}
          .dark #vov-overlay .vv-col,html.dark #vov-overlay .vv-col{background:#1a1a1a;box-shadow:0 24px 64px rgba(0,0,0,0.6)}
          #vov-overlay .vv-card{background:#f9fafb;border-radius:18px;padding:20px 22px 12px}
          .dark #vov-overlay .vv-card,html.dark #vov-overlay .vv-card{background:#232323}
          #vov-overlay .vv-sentence{font-size:16px;line-height:1.85;margin-bottom:14px}
          #vov-overlay .vv-slot{font-size:15px;min-width:76px;padding:2px 11px}
          #vov-overlay .vv-chip{font-size:15px;padding:11px 16px}
          #vov-overlay .vv-chips{gap:10px}
          #vov-overlay .vv-btn{font-size:14px;padding:15px}
          #vov-overlay .vv-result{font-size:14px}
        }`;
        document.head.appendChild(st);
    } catch (e) {}

    // Фоновый предзагруз данных на простое: чтобы к моменту тапа по «ВОВ» они уже были
    // готовы и оверлей открывался мгновенно. Не конкурирует со стартом (idle/тайм-аут).
    function _preload() { if (!(window.task8Data && window.task8Data.length)) _loadData(); }
    if ('requestIdleCallback' in window) requestIdleCallback(_preload, { timeout: 4000 });
    else setTimeout(_preload, 2500);
})();
