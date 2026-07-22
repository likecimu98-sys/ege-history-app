(function () {
    'use strict';

    const CLOUD_SYNC_MODULE = './cloud-sync.js?v=20260722-4';
    const APP_SHELL_CACHE_MESSAGE = { type: 'CACHE_APP_SHELL' };
    const OFFLINE_CACHE_MESSAGE = { type: 'CACHE_OFFLINE_ASSETS' };
    const APP_SHELL_WARMUP_DELAY_MS = 45000;
    const OFFLINE_WARMUP_DELAY_MS = 90000;
    const OFFLINE_WARMUP_IDLE_TIMEOUT_MS = 8000;

    let cloudSyncPromise = null;
    let storageReadyPromise = null;
    let cloudSyncReady = false;

    function canUseServiceWorker() {
        return 'serviceWorker' in navigator && location.protocol !== 'file:';
    }

    function isIosTelegramMiniApp() {
        const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
        if (!isIos) return false;
        const tg = window.Telegram && window.Telegram.WebApp;
        const signedTelegram = !!(tg && (
            (typeof tg.initData === 'string' && tg.initData.length > 0) ||
            (tg.initDataUnsafe && tg.initDataUnsafe.user)
        ));
        const launchParams = /(?:^|[?#&])tgWebApp(?:Data|Version|Platform)=/i
            .test(`${location.search || ''}${location.hash || ''}`);
        return signedTelegram || launchParams || !!window.TelegramWebviewProxy;
    }

    async function disableEmbeddedIosServiceWorkers() {
        if (!('serviceWorker' in navigator)) return;
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
        } catch (error) {
            console.warn('[PWA] iOS Telegram service worker cleanup failed:', error);
        }
    }

    // Прогрев оболочки и офлайн-ассетов начинается только после устойчивого запуска,
    // а затем ждёт простоя. CacheStorage не конкурирует с холодной загрузкой и первыми
    // действиями ученика; кэш постепенно наполняется во время длинной сессии.
    let _warmScheduled = false;
    let _shellWarmScheduled = false;
    function scheduleAppShellWarmup(worker) {
        if (_shellWarmScheduled) return;
        _shellWarmScheduled = true;
        setTimeout(() => {
            if (document.visibilityState === 'hidden' || navigator.onLine === false) {
                _shellWarmScheduled = false;
                return;
            }
            const target = worker || (navigator.serviceWorker && navigator.serviceWorker.controller);
            if (target) target.postMessage(APP_SHELL_CACHE_MESSAGE);
            else _shellWarmScheduled = false;
        }, APP_SHELL_WARMUP_DELAY_MS);
    }

    function scheduleOfflineWarmup(worker) {
        if (_warmScheduled) return;
        _warmScheduled = true;
        const fire = () => {
            if (document.visibilityState === 'hidden' || navigator.onLine === false) {
                _warmScheduled = false;
                return;
            }
            const target = worker || (navigator.serviceWorker && navigator.serviceWorker.controller);
            if (target) {
                target.postMessage(OFFLINE_CACHE_MESSAGE);
            } else {
                _warmScheduled = false;
            }
        };
        setTimeout(() => {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(fire, { timeout: OFFLINE_WARMUP_IDLE_TIMEOUT_MS });
            } else {
                fire();
            }
        }, OFFLINE_WARMUP_DELAY_MS);
    }

    function setOfflineFlag() {
        document.documentElement.toggleAttribute('data-offline', navigator.onLine === false);
    }

    async function loadCloudSync() {
        if (navigator.onLine === false) return null;
        await waitForAppStorage();
        if (cloudSyncPromise) return cloudSyncPromise;

        cloudSyncPromise = import(CLOUD_SYNC_MODULE)
            .then((module) => {
                cloudSyncReady = true;
                try { localStorage.setItem('ege_cloud_loaded_at', String(Date.now())); } catch (e) {}
                if (typeof window.__egeBootSignal === 'function') window.__egeBootSignal('cloud');
                return module;
            })
            .catch((error) => {
                cloudSyncPromise = null;
                cloudSyncReady = false;
                console.warn('[PWA] Cloud sync module is not available yet:', error);
                return null;
            });

        return cloudSyncPromise;
    }

    function waitForAppStorage() {
        if (window.egeAppStorageReady) return Promise.resolve();
        if (storageReadyPromise) return storageReadyPromise;
        storageReadyPromise = new Promise((resolve) => {
            const done = () => {
                window.egeAppStorageReady = true;
                document.removeEventListener('ege:storage-ready', done);
                resolve();
            };
            document.addEventListener('ege:storage-ready', done);
            if (document.readyState === 'complete') setTimeout(done, 0);
            setTimeout(done, 3000);
        });
        return storageReadyPromise;
    }

    async function syncAfterReconnect() {
        const module = await loadCloudSync();
        if (!module) return;

        try {
            if (typeof window.loadProgressFromCloud === 'function') {
                await window.loadProgressFromCloud();
            }
            if (typeof window.syncProgressToCloud === 'function') {
                await window.syncProgressToCloud();
            }
        } catch (error) {
            console.warn('[PWA] Cloud sync after reconnect failed:', error);
        }
    }

    async function registerServiceWorker() {
        // The isolated migration preview shares the production origin. It must
        // never replace or purge the currently installed production PWA cache.
        if (location.pathname.startsWith('/migration-preview/')) return;
        if (!canUseServiceWorker()) {
            console.warn('[PWA] Service worker needs http:// or https://. Open the app through a local server or hosting.');
            return;
        }

        // Telegram on iOS runs in WKWebView. Its CacheStorage can serialize or stall
        // concurrent writes from a Service Worker while defer scripts are waiting.
        // Telegram itself cannot launch the Mini App without a network connection,
        // so reliability wins here: keep localStorage/offline-in-open-page behavior,
        // but do not install an intercepting worker in this embedded environment.
        if (isIosTelegramMiniApp()) {
            window.__egeServiceWorkerDisabledReason = 'ios-telegram-webview';
            await disableEmbeddedIosServiceWorkers();
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
            const readyRegistration = await navigator.serviceWorker.ready;
            const activeWorker = readyRegistration.active || registration.active || navigator.serviceWorker.controller;

            // Быстро установленный SW не скачивает второй экземпляр всего приложения
            // параллельно первому запуску. Полную оболочку прогреваем уже после отрисовки.
            scheduleAppShellWarmup(activeWorker);

            // Прогрев офлайн-кэша (~300 картинок) НЕ должен конкурировать за канал в
            // первые секунды первой загрузки. Ждём простоя (requestIdleCallback) или
            // тайм-аут, чтобы сначала отрисовалось и стало интерактивным приложение.
            scheduleOfflineWarmup(activeWorker);
        } catch (error) {
            console.warn('[PWA] Service worker registration failed:', error);
        }
    }

    window.addEventListener('online', () => {
        setOfflineFlag();
        syncAfterReconnect();
        _shellWarmScheduled = false;
        scheduleAppShellWarmup(navigator.serviceWorker && navigator.serviceWorker.controller);
        _warmScheduled = false;
        scheduleOfflineWarmup(navigator.serviceWorker && navigator.serviceWorker.controller);
    });
    window.addEventListener('offline', setOfflineFlag);

    function flushBeforePause() {
        if (navigator.onLine === false) return;
        try {
            if (typeof window.saveLocal === 'function') window.saveLocal();
            if (cloudSyncReady && typeof window.syncNow === 'function') {
                window.syncNow();
                return;
            }
            if (cloudSyncReady && typeof window.syncProgressToCloud === 'function') {
                window.syncProgressToCloud();
            } else {
                loadCloudSync().then(() => window.syncNow?.() || window.syncProgressToCloud?.()).catch(() => {});
            }
        } catch (error) {
            console.warn('[PWA] Pause sync failed:', error);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushBeforePause();
        } else if (navigator.onLine !== false) {
            scheduleOfflineWarmup(navigator.serviceWorker && navigator.serviceWorker.controller);
        }
    });
    window.addEventListener('pagehide', flushBeforePause);

    setOfflineFlag();
    registerServiceWorker();
    waitForAppStorage().then(() => {
        if (navigator.onLine !== false) loadCloudSync();
    });

    window.egePwa = {
        loadCloudSync,
        loadFirebaseSync: loadCloudSync,
        syncAfterReconnect,
        flushBeforePause,
        isIosTelegramMiniApp
    };
})();
