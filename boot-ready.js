'use strict';

// ── Финальный аккорд defer-цепочки: app:ready + самолечение недокачки ────────
// ВАЖНО: это ОТДЕЛЬНЫЙ файл, а не инлайн-<script defer> — defer у инлайн-скриптов
// браузером ИГНОРИРУЕТСЯ, из-за чего app:ready раньше стрелял ещё во время
// парсинга HTML: заставка снималась мгновенно, а кнопки оживали только после
// докачки всех скриптов. На холодном кэше это давало секунды «мёртвого» лобби
// (баг «открылось, но ничего не нажимается», 2026-07-18).
(function () {
    var coreOk = typeof window.quickStartGame === 'function'   // app.js доехал
        && typeof window.renderMainAction === 'function'        // ui.js доехал
        && !!window.state && typeof window.state === 'object';  // state.js доехал

    if (!coreOk && !sessionStorage.getItem('ege_boot_retry')) {
        // Скрипт ядра оборвался на загрузке (сеть/прокси) — один раз тихо
        // перезапускаемся: повторная загрузка добирает файлы из кэша/сети.
        sessionStorage.setItem('ege_boot_retry', '1');
        location.reload();
        return;
    }
    if (coreOk) sessionStorage.removeItem('ege_boot_retry');
    // Если и после перезапуска ядра нет — всё равно показываем страницу,
    // чтобы человек не смотрел на вечную заставку.
    document.dispatchEvent(new Event('app:ready'));
})();
