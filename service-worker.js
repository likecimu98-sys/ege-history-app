'use strict';

const APP_VERSION = '2026-08-12-vps-90';
const RELEASE_ASSET_VERSION = '20260812-3';
// ⚠️ Версия НАБОРА КАРТИНОК, а не версия приложения. Поднимай её ТОЛЬКО когда
// меняется состав offline-assets.json — добавились, удалились или переснялись
// файлы. От бампа APP_VERSION она не зависит и зависеть не должна.
//
// Зачем разделили (27.07.2026): ASSET_CACHE звался
// `ege-history-assets-${APP_VERSION}`, а cleanupOldCaches сносит любой кэш, не
// перечисленный в CACHE_NAMES. То есть КАЖДЫЙ бамп версии приложения выбрасывал
// весь кэш картинок, и пользователи заново качали 41 МБ (244 файла), хотя ни
// один из них не менялся. Бампов к этому дню было уже 41 — то есть в среднем
// каждый, кто пользуется приложением, скачал эти сорок мегабайт не по разу.
// Для мобильного трафика это самая дорогая строчка во всём проекте.
const ASSET_MANIFEST_VERSION = 'assets-1';

const STATIC_CACHE_PREFIX = 'ege-history-static-';
const STATIC_CACHE = `${STATIC_CACHE_PREFIX}${APP_VERSION}`;
const ASSET_CACHE = `ege-history-assets-${ASSET_MANIFEST_VERSION}`;
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
    `./telemetry.js?v=${RELEASE_ASSET_VERSION}`,
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
    `./theme-classic.css?v=${RELEASE_ASSET_VERSION}`,
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

// HTML из кэша ПРЕДЫДУЩЕГО релиза. Живёт отдельной функцией, а не внутри
// networkFirstNavigation, чтобы её вызов оставался под общим таймаутом чтения
// кэша: iOS-инвариант «ответ страницы не ждёт CacheStorage» здесь не нарушается —
// это ветка ФОЛБЭКА, сеть по-прежнему отвечает первой и никого не ждёт.
async function previousReleaseHtml(cacheKey) {
    const names = (await caches.keys())
        .filter((name) => name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE)
        .reverse(); // caches.keys() отдаёт в порядке создания — начинаем со свежего
    for (const name of names) {
        const cache = await caches.open(name);
        const hit = (await cache.match(cacheKey)) || (await cache.match(scopedRequest('./index.html')));
        if (hit) return hit;
    }
    return null;
}

// Файл кода из кэша ЛЮБОГО релиза — последняя надежда, когда сеть не далась даже
// с повторами. Подмены версий тут быть не может: адрес несёт `?v=<релиз>`, поэтому
// найдётся ровно тот же файл, просто сохранённый кэшем другого релиза. Старая копия
// скрипта всё равно лучше несостоявшегося запуска — на заставке навсегда человек
// не может вообще ничего, а с файлом из соседнего кэша приложение стартует.
async function findInAnyStaticCache(request) {
    const names = (await caches.keys())
        .filter((name) => name.startsWith(STATIC_CACHE_PREFIX))
        .reverse(); // caches.keys() отдаёт в порядке создания — начинаем со свежего
    for (const name of names) {
        try {
            const cache = await caches.open(name);
            const hit = await cache.match(request);
            if (hit) return hit;
        } catch (error) { /* повреждённый кэш не должен обрывать перебор */ }
    }
    return null;
}

async function cleanupOldCaches() {
    const names = await caches.keys();
    // Кэш ОДНОГО предыдущего релиза оставляем намеренно — это страховка выше.
    // Раньше сносились все, и сразу после бампа офлайн-копии не было ни у кого.
    const keepStatic = names.filter((name) => name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE).pop();
    await Promise.all(names.map((name) => {
        if (CACHE_NAMES.includes(name)) return null;
        if (name === keepStatic) return null;
        if (!name.startsWith('ege-history-')) return null;
        // ⚠️ Ассет-кэш сюда больше не попадает на каждом релизе: его имя
        // построено на ASSET_MANIFEST_VERSION, а не на APP_VERSION, и от бампа
        // версии приложения не меняется. Правка именно в имени — здесь ничего
        // особенного делать не нужно, и не надо «чинить» этот метод обратно.
        // Единственный раз, когда старый ассет-кэш придёт сюда, — переход на
        // новую схему имён: тогда легаси-копия удаляется, и это осознанная
        // разовая цена (одна перекачка вместо перекачки на каждом релизе).
        return caches.delete(name);
    }));
}

const NAV_NETWORK_TIMEOUT_MS = 3000;
const NAV_HARD_TIMEOUT_MS = 8000;

function settleWithin(promise, timeoutMs, fallbackValue = null) {
    return new Promise((resolve) => {
        let finished = false;
        const finish = (value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => finish(fallbackValue), timeoutMs);
        Promise.resolve(promise).then(finish, () => finish(fallbackValue));
    });
}

function emergencyNavigationResponse(requestUrl) {
    const url = new URL(requestUrl);
    const retryUrl = new URL(url.toString());
    retryUrl.searchParams.set('_sw_retry', String(Date.now()));
    const alternateHost = self.location.hostname === 'www.reshay-istoriyu.ru'
        ? 'reshay-istoriyu.ru'
        : 'www.reshay-istoriyu.ru';
    const alternateUrl = new URL(url.toString());
    alternateUrl.hostname = alternateHost;
    alternateUrl.searchParams.set('_sw_retry', String(Date.now()));
    const escapeAttribute = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Решай историю! ЕГЭ</title><style>
html{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef8ff;color:#152238}
main{box-sizing:border-box;width:min(92vw,440px);padding:28px;border:1px solid #cfe3ef;border-radius:14px;background:#fff;text-align:center}
h1{margin:0 0 12px;font-size:24px}p{margin:0 0 20px;line-height:1.5}
a{display:block;margin-top:12px;padding:14px 18px;border-radius:14px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700}
a.secondary{background:#e7eef8;color:#17324d}
@media(prefers-color-scheme:dark){body{background:#101622;color:#eef6ff}main{background:#182131;border-color:#33435a}a.secondary{background:#2a3850;color:#eef6ff}}
</style></head><body><main><h1>Не удалось загрузить приложение</h1>
<p>Мы остановили зависшую загрузку. Прогресс на устройстве не удалён.</p>
<a href="${escapeAttribute(retryUrl)}">Повторить загрузку</a>
<a class="secondary" href="${escapeAttribute(alternateUrl)}">Открыть запасной адрес</a>
</main></body></html>`;
    return new Response(html, {
        status: 503,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

async function lookupCachedNavigation(cacheKey) {
    const cache = await caches.open(STATIC_CACHE);
    const currentHit = (await cache.match(cacheKey))
        || (await cache.match(scopedRequest('./index.html')));
    return currentHit || previousReleaseHtml(cacheKey);
}

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
            return { response };
        })
        .catch(() => ({ response: null }));

    // Ограничиваем ВСЮ цепочку чтения, включая caches.open(), caches.keys() и поиск
    // прошлого релиза. Раньше таймаут был только в комментарии: ветка 3 секунд сама
    // делала `await cachedLookup`, поэтому зависшие одновременно fetch и CacheStorage
    // оставляли respondWith pending навсегда.
    const cachedLookup = settleWithin(
        lookupCachedNavigation(cacheKey),
        CACHE_READ_TIMEOUT_MS,
        null
    );
    const first = await settleWithin(network, NAV_NETWORK_TIMEOUT_MS, { timedOut: true });
    if (!first.timedOut) {
        if (first.response) return first.response;
        return (await cachedLookup) || emergencyNavigationResponse(request.url);
    }

    const cached = await cachedLookup;
    if (cached) return cached;

    // Первая часть уже заняла не больше NAV_NETWORK_TIMEOUT_MS; чтение кэша
    // стартовало одновременно и гарантированно завершилось за 1,5 секунды.
    // Поэтому оставшийся таймаут даёт общий предел ровно NAV_HARD_TIMEOUT_MS.
    const lateNetwork = await settleWithin(
        network,
        NAV_HARD_TIMEOUT_MS - NAV_NETWORK_TIMEOUT_MS,
        { response: null, timedOut: true }
    );
    return lateNetwork.response || emergencyNavigationResponse(request.url);
}

// 🔴 Картинки: тот же инвариант, что у навигации, — ЧТЕНИЕ кэша под таймаутом,
// ЗАПИСЬ только фоном, сеть с фолбэком. Раньше здесь было три мины сразу, и все
// три давали один симптом: «в пробнике нет изображений» (жалоба ученика 30.07).
//   1. `await putIfOk(...)` стоял НА ПУТИ ОТВЕТА. На iOS WKWebView зависший
//      CacheStorage оставляет respondWith pending навсегда — картинка не
//      появляется вообще, хотя Nginx ответ уже отдал. Ровно из-за этого класса
//      бага был белый экран на айфонах; для страниц починили, для картинок нет.
//   2. `caches.match` без таймаута — тот же залипший CacheStorage вешает ответ
//      ещё до сети.
//   3. `fetch()` без catch: моргнула сеть → промис отклонён → respondWith reject
//      → битая картинка, хотя в кэше могла лежать годная копия.
async function cacheFirst(request, cacheName) {
    const cached = await settleWithin(
        caches.match(request, { ignoreSearch: true }),
        CACHE_READ_TIMEOUT_MS,
        null
    );
    if (cached) return cached;

    let response = null;
    try {
        response = await fetch(request);
    } catch (error) {
        response = null;
    }
    if (!response) {
        // Сеть не дала ответа. Кэш мог «проснуться» после таймаута — последняя попытка.
        const late = await settleWithin(
            caches.match(request, { ignoreSearch: true }),
            CACHE_READ_TIMEOUT_MS,
            null
        );
        return late || Response.error();
    }

    // Запись отцеплена от выдачи: страница получает картинку сразу.
    const copy = response.clone();
    caches.open(cacheName)
        .then((cache) => putIfOk(cache, request, copy))
        .catch(() => {});
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

    // 🔴 ОДНА сорванная попытка НЕ должна убивать скрипт. Раньше здесь было
    // «fetch упал → Response.error()», и этого хватало, чтобы приложение не
    // запустилось вовсе: файл помечается несостоявшимся, `quickStartGame` может
    // не определиться, человек остаётся на заставке навсегда. На мобильной связи
    // (LTE в дороге, слабый сигнал, пересадка Wi-Fi↔сеть) один обрыв из двадцати
    // параллельных defer-запросов — рядовое событие. По маячкам за 30–31.07:
    // из 248 запусков до ядра доехало 122, и в отказах видны именно ошибки
    // ЗАГРУЗКИ файлов (lineno=0) — table.js, ui.js, state.js, pwa.js и другие.
    // Поэтому пробуем сеть ещё дважды с короткими паузами. Промис попытки
    // сбрасываем — иначе повтор вернул бы ту же самую отвергнутую сеть.
    const NETWORK_RETRIES = 2;
    const RETRY_DELAY_MS = 250;
    const networkWithRetries = async () => {
        for (let attempt = 0; ; attempt++) {
            try {
                return (await networkPair()).client;
            } catch (error) {
                if (attempt >= NETWORK_RETRIES) throw error;
                networkPairPromise = null;
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
            }
        }
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
            return await networkWithRetries();
        } catch (error) {
            // Сеть не далась и после повторов — последняя надежда на кэш любого
            // соседнего релиза: старый файл лучше несостоявшегося запуска.
            const late = await cachedPromise.catch(() => null);
            return late || (await findInAnyStaticCache(request)) || Response.error();
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
