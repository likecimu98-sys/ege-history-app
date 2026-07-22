'use strict';

const APP_VERSION = '2026-07-23-vps-14';
const RELEASE_ASSET_VERSION = '20260723-2';
const STATIC_CACHE = `ege-history-static-${APP_VERSION}`;
const ASSET_CACHE = `ege-history-assets-${APP_VERSION}`;
const CACHE_NAMES = [STATIC_CACHE, ASSET_CACHE];
const ASSET_WARMUP_PAUSE_MS = 300;
// Железное правило после серии iOS-инцидентов: НИ ОДИН ответ страницы не должен ждать
// CacheStorage. На iOS WKWebView cache.match/cache.put под нагрузкой (20 defer-скриптов
// разом) сериализуются и могут не ответить никогда → respondWith висит → белый экран.
// Чтение кэша ограничено таймаутом (норма — единицы мс; дольше = «залип» → идём в сеть),
// запись кэша всегда фоновая (waitUntil), install не блокирует активацию на кэшировании.
const CACHE_READ_TIMEOUT_MS = 1500;
const INSTALL_WARMUP_TIMEOUT_MS = 4000;

// Installation must stay tiny: Telegram WebView can suspend a worker that
// competes with the first page load. The complete app shell is cached shortly
// after the UI becomes interactive instead of blocking activation.
const INSTALL_URLS = [
    './index.html',
    `./pwa.js?v=${RELEASE_ASSET_VERSION}`,
    `./output.css?v=${RELEASE_ASSET_VERSION}`,
    `./styles.css?v=${RELEASE_ASSET_VERSION}`
];

const CORE_URLS = [
    './',
    './index.html',
    './cram.html',
    './manifest.webmanifest',
    `./pwa.js?v=${RELEASE_ASSET_VERSION}`,
    `./vendor/telegram-web-app.js?v=${RELEASE_ASSET_VERSION}`,
    `./config.js?v=${RELEASE_ASSET_VERSION}`,
    `./utils.js?v=${RELEASE_ASSET_VERSION}`,
    `./exam-scoring.js?v=${RELEASE_ASSET_VERSION}`,
    `./state.js?v=${RELEASE_ASSET_VERSION}`,
    `./table.js?v=${RELEASE_ASSET_VERSION}`,
    `./ui.js?v=${RELEASE_ASSET_VERSION}`,
    `./modes.js?v=${RELEASE_ASSET_VERSION}`,
    `./swipe-data.js?v=${RELEASE_ASSET_VERSION}`,
    `./swipe-mode.js?v=${RELEASE_ASSET_VERSION}`,
    `./match-mode.js?v=${RELEASE_ASSET_VERSION}`,
    `./vov-mode.js?v=${RELEASE_ASSET_VERSION}`,
    `./visual-trainer.js?v=${RELEASE_ASSET_VERSION}`,
    `./exam-mode.js?v=${RELEASE_ASSET_VERSION}`,
    `./app.js?v=${RELEASE_ASSET_VERSION}`,
    `./cloud-sync.js?v=${RELEASE_ASSET_VERSION}`,
    `./vps-sync-compat.js?v=${RELEASE_ASSET_VERSION}`,
    // Тяжёлые visual*.generated.js НЕ прекэшируем на install: они загружаются только
    // при открытии визуальных режимов и затем кэшируются fetch-handler'ом.
    `./data.js?v=${RELEASE_ASSET_VERSION}`,
    `./tokens.css?v=${RELEASE_ASSET_VERSION}`,
    `./output.css?v=${RELEASE_ASSET_VERSION}`,
    `./theme-aurora.css?v=${RELEASE_ASSET_VERSION}`,
    `./styles.css?v=${RELEASE_ASSET_VERSION}`,
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
let warmAppShellPromise = null;

function scopedUrl(path) {
    return new URL(path, self.registration.scope).toString();
}

function scopedRequest(path, cacheMode = 'reload') {
    return new Request(scopedUrl(path), { cache: cacheMode });
}

async function cachePaths(paths, cacheMode = 'default', concurrency = 4) {
    const cache = await caches.open(STATIC_CACHE);
    const queue = [...new Set(paths)];
    const worker = async () => {
        while (queue.length) {
            const path = queue.shift();
            const request = scopedRequest(path, cacheMode);
            try {
                const response = await fetch(request);
                if (!response.ok) {
                    console.warn('[SW] App file is not available:', path, response.status);
                    continue;
                }
                await cache.put(request, response.clone());
            } catch (error) {
                console.warn('[SW] Failed to cache app file:', path, error);
            }
        }
    };
    const count = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(Array.from({ length: count }, () => worker()));
}

async function addCoreFiles() {
    await cachePaths(INSTALL_URLS, 'reload', 4);
}

async function cacheAppShell() {
    if (warmAppShellPromise) return warmAppShellPromise;
    warmAppShellPromise = cachePaths(CORE_URLS, 'default', 4).finally(() => {
        warmAppShellPromise = null;
    });
    return warmAppShellPromise;
}

async function putIfOk(cache, request, response) {
    if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
    }
}

async function cacheOfflineAssets() {
    if (warmAssetsPromise) return warmAssetsPromise;

    warmAssetsPromise = (async () => {
        await cacheAppShell();
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
            // отбирает канал у интерфейса, синхронизации и других открытых устройств.
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

const NAV_NETWORK_TIMEOUT_MS = 3000;

async function networkFirstNavigation(request) {
    // cram.html и другие под-страницы (iframe) кэшируем под их собственным URL,
    // а не под index.html — иначе навигация iframe затирала бы кэш главной страницы.
    const url = new URL(request.url);
    const isRootNav = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    // cram.html открывается с ?cb=<timestamp> (форс-перезагрузка iframe для диплинка) —
    // нормализуем ключ кэша к ./cram.html, иначе каждый запуск плодил бы новую запись.
    const isCramNav = url.pathname.endsWith('/cram.html');
    const cacheKey = isRootNav ? scopedRequest('./index.html')
        : (isCramNav ? scopedRequest('./cram.html') : request);

    // Сеть — основной источник и НИКОГДА не ждёт CacheStorage: запись в кэш фоновая
    // (fire-and-forget), иначе на холодном кэше iOS завис бы на cache.put(index.html).
    const network = fetch(new Request(request, { cache: 'no-cache' }))
        .then((response) => {
            caches.open(STATIC_CACHE)
                .then((cache) => putIfOk(cache, cacheKey, response.clone()))
                .catch(() => {});
            return response;
        });

    // Чтение кэша тоже под защитой: если CacheStorage залип, сеть всё равно приедет.
    const cachedLookup = caches.open(STATIC_CACHE)
        .then((cache) => cache.match(cacheKey).then((hit) => hit || cache.match(scopedRequest('./index.html'))))
        .catch(() => null);

    // Быстрая сеть → сразу свежий HTML. Медленная сеть, но есть кэш → отдаём кэш через
    // NAV_NETWORK_TIMEOUT_MS (не держим белый экран). Сеть упала → кэш, иначе Response.error().
    return await Promise.race([
        network.catch(async () => (await cachedLookup) || Response.error()),
        new Promise((resolve) => {
            setTimeout(async () => {
                const cached = await cachedLookup;
                if (cached) resolve(cached);
            }, NAV_NETWORK_TIMEOUT_MS);
        })
    ]);
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

// JS/CSS immutable inside one release: exact URL + release query string. On a cold
// cache the network response must reach the page IMMEDIATELY. CacheStorage writes are
// deliberately detached from respondWith: iOS WKWebView can serialize concurrent
// cache.put calls for many defer scripts and otherwise keep the page on the loader
// even though Nginx has already completed every 200 response.
function respondWithReleaseCode(event) {
    const request = event.request;
    const cachePromise = caches.open(STATIC_CACHE).catch(() => null);
    const cachedPromise = cachePromise
        .then((cache) => (cache ? cache.match(request) : null))
        .catch(() => null);
    let networkPairPromise = null;

    const networkPair = () => {
        if (!networkPairPromise) {
            networkPairPromise = fetch(request).then((response) => ({
                client: response,
                cache: response.clone()
            }));
        }
        return networkPairPromise;
    };

    // Кэш-хит быстро → отдаём из кэша (сеть НЕ дёргаем: скорость + офлайн сохранены).
    // Кэш-промах → сеть. Кэш «завис» дольше CACHE_READ_TIMEOUT_MS → не ждём его, идём в сеть,
    // чтобы CacheStorage на iOS не мог удержать страницу на загрузчике.
    const responsePromise = (async () => {
        const cached = await Promise.race([
            cachedPromise,
            new Promise((resolve) => setTimeout(() => resolve('__cache_timeout__'), CACHE_READ_TIMEOUT_MS))
        ]);
        if (cached && cached !== '__cache_timeout__') return cached;
        try {
            return (await networkPair()).client;
        } catch (error) {
            const late = (cached === '__cache_timeout__') ? await cachedPromise.catch(() => null) : null;
            return late || Response.error();
        }
    })();

    const cacheWritePromise = cachedPromise.then(async (cached) => {
        if (cached) return;
        const pair = await networkPair();
        if (!pair.cache || (!pair.cache.ok && pair.cache.type !== 'opaque')) return;
        const cache = await cachePromise;
        if (cache) await cache.put(request, pair.cache);
    }).catch((error) => {
        console.warn('[SW] Release asset cache write failed:', request.url, error);
    });

    event.respondWith(responsePromise);
    event.waitUntil(cacheWritePromise);
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    // Кэширование оболочки не должно уметь подвесить установку: если CacheStorage на iOS
    // залипнет, install всё равно завершится по таймауту и новый (безопасный) SW активируется.
    event.waitUntil(Promise.race([
        addCoreFiles().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, INSTALL_WARMUP_TIMEOUT_MS))
    ]));
});

self.addEventListener('activate', (event) => {
    // Do not delete the previous release while its page can still be executing.
    // Old caches are removed only after the new page has loaded and warmed its shell.
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_APP_SHELL') {
        event.waitUntil(cacheAppShell()
            .then(() => cleanupOldCaches())
            .catch((error) => {
                console.warn('[SW] App shell cache warmup failed:', error);
            }));
        return;
    }
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

    // API always goes directly to the VPS and is never stored in the PWA cache.
    if (isSameOrigin && (url.pathname.startsWith('/api/') || url.pathname === '/auth/telegram')) {
        event.respondWith(fetch(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (!isSameOrigin || !isInScope) return;

    if (request.destination === 'image') {
        event.respondWith(cacheFirst(request, ASSET_CACHE));
        return;
    }

    if (request.destination === 'script' || request.destination === 'style' || request.destination === 'worker') {
        respondWithReleaseCode(event);
        return;
    }

    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
