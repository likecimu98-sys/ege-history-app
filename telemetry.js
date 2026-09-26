// telemetry.js — отправка ошибок и продуктовых событий на свой сервер.
// Загружается рано и НЕ зависит ни от чего: если приложение сломается на старте,
// именно этот файл должен об этом сообщить.
'use strict';

(function initTelemetry() {
    const ENDPOINT = '/api/v1/telemetry';
    const RELEASE = (function () {
        // Версию берём из адреса собственного тега — отдельной константы, которую
        // легко забыть поднять, заводить не хочется.
        const self = document.currentScript && document.currentScript.src;
        const match = self && self.match(/[?&]v=([^&]+)/);
        return match ? match[1] : '';
    })();

    // Ошибки шлём с задержкой и не чаще, чем нужно: один сломанный экран не должен
    // превращаться в шквал запросов с телефона ученика.
    const seen = new Set();
    let queue = [];
    let flushTimer = null;
    let sentErrors = 0;
    const MAX_ERRORS_PER_SESSION = 10;

    function send(payload) {
        try {
            const body = JSON.stringify(payload);
            // sendBeacon переживает закрытие вкладки — а самые интересные ошибки
            // случаются ровно перед тем, как человек уходит.
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
                return;
            }
            fetch(ENDPOINT, {
                method: 'POST', body, keepalive: true,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
            }).catch(() => {});
        } catch (e) { /* телеметрия не имеет права ломать приложение */ }
    }

    function flush() {
        flushTimer = null;
        if (!queue.length) return;
        const events = queue;
        queue = [];
        send({ events });
    }

    // ⚠️ Чистка идёт и здесь, и на сервере. Дублирование намеренное: на клиенте
    // мы не отправляем лишнего вовсе, на сервере не доверяем клиенту.
    function scrub(value, limit) {
        return String(value == null ? '' : value)
            .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
            .replace(/\b\d{7,}\b/g, '<id>')
            .replace(/@[A-Za-z0-9_]{4,}/g, '<username>')
            .slice(0, limit || 300);
    }

    function reportError(message, source, line) {
        if (sentErrors >= MAX_ERRORS_PER_SESSION) return;
        const text = scrub(message, 300);
        if (!text) return;
        const where = scrub(String(source || '').split('?')[0], 200) + (line ? ':' + line : '');
        const key = text + '|' + where;
        if (seen.has(key)) return;      // одна и та же ошибка — один раз за сессию
        seen.add(key);
        sentErrors++;
        send({ error: { message: text, source: where, release: RELEASE } });
    }

    // 🔴 ПРОГЛОЧЕННЫЕ ОШИБКИ. В клиенте полсотни мест вида `catch (e) {}` — операция
    // падает, а следа не остаётся нигде: ни у человека на экране, ни в логах. Именно
    // поэтому разбор жалоб «не работает» превращался в гадание. Здесь даём таким
    // местам голос, НЕ меняя поток выполнения: код по-прежнему не падает, но факт
    // сбоя виден в консоли и уезжает в диагностику.
    //
    // Защита от лавины уже есть: MAX_ERRORS_PER_SESSION и дедупликация по тексту —
    // повторяющийся сбой уйдёт один раз за сессию.
    //
    // ⚠️ Сама эта функция не должна уметь сломать то, что диагностирует: любое
    // исключение внутри неё гасится молча — здесь это оправдано.
    window.reportSilent = function (context, error) {
        try {
            const message = error && (error.message || String(error)) || 'без сообщения';
            console.warn('[тихий сбой]', context, message);
            reportError('тихий сбой · ' + String(context || '?') + ' · ' + message, location.pathname, 0);
        } catch (e) { /* диагностика не имеет права падать */ }
    };

    window.addEventListener('error', event => {
        // Ошибки загрузки картинок и скриптов приходят сюда же, но без message.
        if (event && event.message) reportError(event.message, event.filename, event.lineno);
    });

    window.addEventListener('unhandledrejection', event => {
        const reason = event && event.reason;
        const message = reason && (reason.message || String(reason));
        if (message) reportError('Unhandled rejection: ' + message, reason && reason.stack ? '' : location.pathname, 0);
    });

    // Продуктовые события. Имя должно быть из перечня, который знает сервер, —
    // всё остальное он просто отбросит.
    // Метка устройства: случайные 16 знаков, придуманные здесь же. Не имя и не
    // Telegram ID — по ней нельзя узнать человека, но можно связать его первые
    // шаги (пришёл → дождался загрузки → решил → вернулся), пока он не вошёл.
    let vid = '', firstVisit = false;
    try {
        vid = localStorage.getItem('ege_vid') || '';
        if (!/^[0-9a-f]{16}$/.test(vid)) {
            // Новое устройство — но не новый человек, если у него уже есть прогресс
            // (метку завели позже, чем он начал заниматься).
            firstVisit = !localStorage.getItem('ege_onboarding_done') && !localStorage.getItem('ege_final_storage_v4');
            const bytes = new Uint8Array(8);
            (window.crypto || window.msCrypto).getRandomValues(bytes);
            vid = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem('ege_vid', vid);
        }
    } catch (e) { vid = ''; }

    window.trackEvent = function (name, props) {
        const p = Object.assign({}, props || {});
        if (vid) p.vid = vid;
        queue.push({ name: String(name || ''), props: p });
        if (queue.length >= 10) { clearTimeout(flushTimer); flush(); return; }
        if (!flushTimer) flushTimer = setTimeout(flush, 5000);
    };

    // 🔴 «Открыл» — САМЫМ первым делом, до загрузки остального приложения.
    // Из поиска почти половина уходила, не дождавшись загрузки (лог 11–25.09),
    // а увидеть это можно только если событие ушло раньше, чем человек закрыл
    // вкладку. Отправка — через sendBeacon при уходе, сессия для него не нужна.
    // Откуда пришёл — только категория, адрес страницы не отправляется.
    function entryOf() {
        let host = '';
        try { host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ''; } catch (e) {}
        if (!host) return 'direct';
        if (/(^|\.)(google\.[a-z.]+|yandex\.[a-z.]+|ya\.ru|bing\.com|duckduckgo\.com|go\.mail\.ru|rambler\.ru|yahoo\.com)$/.test(host)) return 'search';
        if (/(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/.test(host)) return 'vk';
        if (/(^|\.)(t\.me|telegram\.org|telegram\.me)$/.test(host)) return 'tg';
        if (host === location.hostname || /(^|\.)reshay-istoriyu\.ru$/.test(host)) return 'site';
        return 'other';
    }
    function sourceOf() {
        try {
            const tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.initData) return 'tg';
            if ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone) return 'pwa';
        } catch (e) {}
        return 'web';
    }
    const source = sourceOf();
    window.trackEvent('app_open', {
        source, mode: source === 'tg' ? 'tg' : entryOf(), result: firstVisit ? 'new' : 'back',
    });
    // Дождался ли загрузки и сколько секунд ждал — то, от чего уходят новички.
    document.addEventListener('app:ready', function () {
        const seconds = Math.round((performance.now ? performance.now() : 0) / 100) / 10;
        window.trackEvent('app_ready', { source, seconds });
    }, { once: true });

    // Хвост очереди не должен теряться при уходе со страницы.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { clearTimeout(flushTimer); flush(); }
    });
})();
