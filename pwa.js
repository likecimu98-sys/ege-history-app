(function () {
    'use strict';

    const FIREBASE_SYNC_MODULE = './firebase-sync.js';
    const OFFLINE_CACHE_MESSAGE = { type: 'CACHE_OFFLINE_ASSETS' };

    let firebaseSyncPromise = null;
    let storageReadyPromise = null;
    let firebaseSyncReady = false;

    function canUseServiceWorker() {
        return 'serviceWorker' in navigator && location.protocol !== 'file:';
    }

    // Откладываем прогрев офлайн-ассетов до простоя браузера — чтобы канал в первые
    // секунды доставался ядру приложения, а не фоновой закачке сотен картинок.
    let _warmScheduled = false;
    function scheduleOfflineWarmup(worker) {
        if (_warmScheduled) return;
        _warmScheduled = true;
        const fire = () => {
            const target = worker || (navigator.serviceWorker && navigator.serviceWorker.controller);
            if (target) target.postMessage(OFFLINE_CACHE_MESSAGE);
        };
        if ('requestIdleCallback' in window) requestIdleCallback(fire, { timeout: 6000 });
        else setTimeout(fire, 5000);
    }

    function setOfflineFlag() {
        document.documentElement.toggleAttribute('data-offline', navigator.onLine === false);
    }

    async function loadFirebaseSync() {
        if (navigator.onLine === false) return null;
        await waitForAppStorage();
        if (firebaseSyncPromise) return firebaseSyncPromise;

        firebaseSyncPromise = import(FIREBASE_SYNC_MODULE)
            .then((module) => {
                firebaseSyncReady = true;
                try { localStorage.setItem('ege_firebase_loaded_at', String(Date.now())); } catch (e) {}
                return module;
            })
            .catch((error) => {
                firebaseSyncPromise = null;
                firebaseSyncReady = false;
                console.warn('[PWA] Firebase sync module is not available yet:', error);
                return null;
            });

        return firebaseSyncPromise;
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
        const module = await loadFirebaseSync();
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
        if (!canUseServiceWorker()) {
            console.warn('[PWA] Service worker needs http:// or https://. Open the app through a local server or hosting.');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js');
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
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage(OFFLINE_CACHE_MESSAGE);
        }
    });
    window.addEventListener('offline', setOfflineFlag);

    function flushBeforePause() {
        if (navigator.onLine === false) return;
        try {
            if (typeof window.saveLocal === 'function') window.saveLocal();
            if (firebaseSyncReady && typeof window.syncNow === 'function') {
                window.syncNow();
                return;
            }
            if (firebaseSyncReady && typeof window.syncProgressToCloud === 'function') {
                window.syncProgressToCloud();
            } else {
                loadFirebaseSync().then(() => window.syncNow?.() || window.syncProgressToCloud?.()).catch(() => {});
            }
        } catch (error) {
            console.warn('[PWA] Pause sync failed:', error);
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushBeforePause();
    });
    window.addEventListener('pagehide', flushBeforePause);

    setOfflineFlag();
    registerServiceWorker();
    waitForAppStorage().then(() => {
        if (navigator.onLine !== false) loadFirebaseSync();
    });

    window.egePwa = {
        loadFirebaseSync,
        syncAfterReconnect,
        flushBeforePause
    };
})();
