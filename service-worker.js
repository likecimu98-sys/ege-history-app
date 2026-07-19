'use strict';

const APP_VERSION = '2026-07-19-8';
const STATIC_CACHE = `ege-history-static-${APP_VERSION}`;
const ASSET_CACHE = `ege-history-assets-${APP_VERSION}`;
const CACHE_NAMES = [STATIC_CACHE, ASSET_CACHE];
const ASSET_WARMUP_PAUSE_MS = 300;

const CORE_URLS = [
    './',
    './index.html',
    './cram.html',
    './manifest.webmanifest',
    './pwa.js',
    './vendor/telegram-web-app.js',
    './config.js',
    './utils.js',
    './exam-scoring.js',
    './state.js',
    './table.js',
    './ui.js',
    './modes.js',
    './swipe-data.js',
    './swipe-mode.js',
    './match-mode.js',
    './vov-mode.js',
    './visual-trainer.js',
    './exam-mode.js',
    './app.js',
    './firebase-sync.js',
    // Тяжёлые visual*.generated.js НЕ прекэшируем на install: они загружаются только
    // при открытии визуальных режимов и затем кэшируются fetch-handler'ом.
    './data.js',
    './tokens.css',
    './output.css',
    './theme-aurora.css',
    './styles.css',
    './offline-assets.json',
    './assets/icons/icon-48.png',
    './assets/icons/icon-72.png',
    './assets/icons/icon-96.png',
    './assets/icons/icon-144.png',
    './assets/icons/icon-180.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/icons/maskable-512.png',
    './assets/sounds/yes.mp3',
    './assets/sounds/wow.mp3',
    './assets/sounds/fah.mp3',
    './assets/sounds/dun.mp3',
    './assets/sounds/duel.mp3'
];

const ASSET_MANIFEST_URL = './offline-assets.json';
let warmAssetsPromise = null;

function scopedUrl(path) {
    return new URL(path, self.registration.scope).toString();
}

function scopedRequest(path, cacheMode = 'reload') {
    return new Request(scopedUrl(path), { cache: cacheMode });
}

async function addCoreFiles() {
    const cache = await caches.open(STATIC_CACHE);
    for (const path of CORE_URLS) {
        const request = scopedRequest(path);
        try {
            const response = await fetch(request);
            if (!response.ok) {
                console.warn('[SW] Core file is not available:', path, response.status);
                continue;
            }
            await cache.put(request, response.clone());
        } catch (error) {
            // Один недоступный файл не должен отменять установку всего Service Worker.
            console.warn('[SW] Failed to cache core file:', path, error);
        }
    }
}

async function putIfOk(cache, request, response) {
    if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
    }
}

async function cacheOfflineAssets() {
    if (warmAssetsPromise) return warmAssetsPromise;

    warmAssetsPromise = (async () => {
        const manifestRequest = scopedRequest(ASSET_MANIFEST_URL);
        const manifestCache = await caches.open(STATIC_CACHE);
        let manifestResponse = null;

        try {
            manifestResponse = await fetch(manifestRequest);
        } catch (error) {
            manifestResponse = await manifestCache.match(manifestRequest);
        }

        if (!manifestResponse) return;

        const manifestClone = manifestResponse.clone();
        const manifestData = await manifestResponse.json();
        const assetUrls = Array.isArray(manifestData)
            ? [...new Set(manifestData.filter(path => typeof path === 'string' && path.length > 0))]
            : [];
        await putIfOk(manifestCache, manifestRequest, manifestClone);

        const cache = await caches.open(ASSET_CACHE);
        for (const assetPath of assetUrls) {
            const request = scopedRequest(assetPath, 'default');
            const cached = await cache.match(request);
            if (cached) continue;

            try {
                const response = await fetch(request);
                if (!response.ok) {
                    console.warn('[SW] Asset is not available:', assetPath, response.status);
                } else {
                    await cache.put(request, response.clone());
                }
            } catch (error) {
                console.warn('[SW] Failed to cache asset:', assetPath, error);
            }

            // Один запрос за раз и короткая пауза: прогрев идёт постепенно и не
            // отбирает канал у интерфейса, Firebase и других открытых устройств.
            await new Promise(resolve => setTimeout(resolve, ASSET_WARMUP_PAUSE_MS));
        }
    })().finally(() => {
        warmAssetsPromise = null;
    });

    return warmAssetsPromise;
}

async function cleanupOldCaches() {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
        if (CACHE_NAMES.includes(name)) return null;
        if (!name.startsWith('ege-history-')) return null;
        return caches.delete(name);
    }));
}

async function networkFirstNavigation(request) {
    const cache = await caches.open(STATIC_CACHE);
    // cram.html и другие под-страницы (iframe) кэшируем под их собственным URL,
    // а не под index.html — иначе навигация iframe затирала бы кэш главной страницы.
    const url = new URL(request.url);
    const isRootNav = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    // cram.html открывается с ?cb=<timestamp> (форс-перезагрузка iframe для диплинка) —
    // нормализуем ключ кэша к ./cram.html, иначе каждый запуск плодил бы новую запись.
    const isCramNav = url.pathname.endsWith('/cram.html');
    const cacheKey = isRootNav ? scopedRequest('./index.html')
        : (isCramNav ? scopedRequest('./cram.html') : request);

    try {
        const response = await fetch(request);
        await putIfOk(cache, cacheKey, response);
        return response;
    } catch (error) {
        return (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match(scopedRequest('./index.html'))) ||
            Response.error();
    }
}

async function cacheFirst(request, cacheName) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const response = await fetch(request);
    const cache = await caches.open(cacheName);
    await putIfOk(cache, request, response);
    return response;
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch: true });
    const networkFetch = fetch(request)
        .then(async (response) => {
            await putIfOk(cache, request, response);
            return response;
        })
        .catch(() => null);

    if (cached) return cached;
    return (await networkFetch) || Response.error();
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(addCoreFiles());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await cleanupOldCaches();
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_OFFLINE_ASSETS') {
        event.waitUntil(cacheOfflineAssets().catch((error) => {
            console.warn('[SW] Offline asset cache warmup failed:', error);
        }));
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isInScope = url.href.startsWith(self.registration.scope);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (!isSameOrigin || !isInScope) return;

    if (request.destination === 'image') {
        event.respondWith(cacheFirst(request, ASSET_CACHE));
        return;
    }

    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
