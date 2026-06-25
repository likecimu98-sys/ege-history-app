'use strict';

const APP_VERSION = '2026-06-25-2';
const STATIC_CACHE = `ege-history-static-${APP_VERSION}`;
const ASSET_CACHE = `ege-history-assets-${APP_VERSION}`;
const CACHE_NAMES = [STATIC_CACHE, ASSET_CACHE];

const CORE_URLS = [
    './',
    './index.html',
    './cram.html',
    './manifest.webmanifest',
    './pwa.js',
    './config.js',
    './utils.js',
    './state.js',
    './table.js',
    './ui.js',
    './modes.js',
    './swipe-data.js',
    './swipe-mode.js',
    './visual-trainer.js',
    './app.js',
    './firebase-sync.js',
    './visualArchitectureData.generated.js',
    './visualPaintingData.generated.js',
    './mapLegendData.generated.js',
    './visualStudyData.generated.js',
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
    './assets/sounds/fah.mp3'
];

const ASSET_MANIFEST_URL = './offline-assets.json';
let warmAssetsPromise = null;

function scopedUrl(path) {
    return new URL(path, self.registration.scope).toString();
}

function scopedRequest(path) {
    return new Request(scopedUrl(path), { cache: 'reload' });
}

async function addCoreFiles() {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(CORE_URLS.map(scopedRequest));
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
        const assetUrls = await manifestResponse.json();
        await putIfOk(manifestCache, manifestRequest, manifestClone);

        const cache = await caches.open(ASSET_CACHE);
        let cursor = 0;
        const workers = Array.from({ length: 6 }, async () => {
            while (cursor < assetUrls.length) {
                const assetPath = assetUrls[cursor++];
                const request = scopedRequest(assetPath);
                const cached = await cache.match(request);
                if (cached) continue;

                try {
                    const response = await fetch(request);
                    await putIfOk(cache, request, response);
                } catch (error) {
                    console.warn('[SW] Failed to cache asset:', assetPath, error);
                }
            }
        });

        await Promise.all(workers);
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
    const cacheKey = isRootNav ? scopedRequest('./index.html') : request;

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
