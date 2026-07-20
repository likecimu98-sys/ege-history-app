(function () {
    'use strict';

    const CLOUD_SYNC_MODULE = './cloud-sync.js';
    const OFFLINE_CACHE_MESSAGE = { type: 'CACHE_OFFLINE_ASSETS' };
    const OFFLINE_WARMUP_DELAY_MS = 12000;
    const OFFLINE_WARMUP_IDLE_TIMEOUT_MS = 8000;

    let cloudSyncPromise = null;
    let storageReadyPromise = null;
    let cloudSyncReady = false;

    function canUseServiceWorker() {
        return 'serviceWorker' in navigator && location.protocol !== 'file:';
    }

    // Откладываем прогрев офлайн-ассетов минимум на 12 секунд, а затем ждём простоя.
    // Так он не конкурирует с холодным запуском приложения и всё равно постепенно
    // наполняет офлайн-кэш, пока ученик работает.
    let _warmScheduled = false;
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

        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
            const readyRegistration = await navigator.serviceWorker.ready;
            const activeWorker = readyRegistration.active || registration.active || navigator.serviceWorker.controller;

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
        flushBeforePause
    };
})();
