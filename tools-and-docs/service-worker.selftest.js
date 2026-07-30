/* Regression checks for the boot-critical Service Worker strategy. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(__dirname, '..', 'pwa.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function makeWorker({
    cachedResponse = null,
    hangFetch = false,
    hangCacheOpen = false,
    hangCacheMatch = false,
    hangCacheKeys = false,
    timerCapMs = null
} = {}) {
    const handlers = {};
    let releaseCacheWriteResolve;
    let releaseCacheWrites = 0;
    let networkFetches = 0;
    let cacheDeletes = 0;
    const never = () => new Promise(() => {});
    const workerSetTimeout = timerCapMs === null
        ? setTimeout
        : (callback, delay, ...args) => setTimeout(callback, Math.min(delay, timerCapMs), ...args);

    const releaseCacheWrite = new Promise((resolve) => { releaseCacheWriteResolve = resolve; });
    const cache = {
        match: async () => (hangCacheMatch ? never() : cachedResponse),
        put: async () => {
            releaseCacheWrites++;
            await releaseCacheWrite;
        }
    };
    const context = vm.createContext({
        URL,
        Request,
        Response,
        Promise,
        Set,
        console,
        setTimeout: workerSetTimeout,
        clearTimeout,
        fetch: async () => {
            networkFetches++;
            if (hangFetch) return never();
            return new Response('window.booted = true;', {
                status: 200,
                headers: { 'Content-Type': 'application/javascript' }
            });
        },
        caches: {
            open: async () => (hangCacheOpen ? never() : cache),
            match: async () => cachedResponse,
            keys: async () => (hangCacheKeys ? never() : ['ege-history-static-old']),
            delete: async () => { cacheDeletes++; return true; }
        },
        self: {
            location: new URL('https://reshay-istoriyu.ru/service-worker.js'),
            registration: { scope: 'https://reshay-istoriyu.ru/' },
            clients: { claim: async () => undefined },
            skipWaiting: () => undefined,
            addEventListener(type, handler) { handlers[type] = handler; }
        }
    });
    vm.runInContext(source, context, { filename: 'service-worker.js' });

    return {
        handlers,
        releaseCacheWriteResolve,
        stats: () => ({ releaseCacheWrites, networkFetches, cacheDeletes })
    };
}

function makeNavigationRequest(url = 'https://reshay-istoriyu.ru/') {
    const request = new Request(url);
    Object.defineProperty(request, 'mode', { value: 'navigate' });
    Object.defineProperty(request, 'destination', { value: 'document' });
    return request;
}

function dispatchNavigation(worker, request = makeNavigationRequest()) {
    let responsePromise;
    worker.handlers.fetch({
        request,
        respondWith(promise) { responsePromise = Promise.resolve(promise); },
        waitUntil() {}
    });
    return responsePromise;
}

async function coldCodeDoesNotWaitForCacheStorage() {
    const worker = makeWorker();
    let responsePromise;
    let lifetimePromise;
    const event = {
        request: {
            url: 'https://reshay-istoriyu.ru/app.js?v=20260727-1',
            method: 'GET', mode: 'cors', destination: 'script'
        },
        respondWith(promise) { responsePromise = Promise.resolve(promise); },
        waitUntil(promise) { lifetimePromise = Promise.resolve(promise); }
    };

    worker.handlers.fetch(event);
    const winner = await Promise.race([
        responsePromise.then(() => 'response'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 50))
    ]);
    assert.equal(winner, 'response', 'cold JS response was blocked by CacheStorage.put');
    assert.equal(worker.stats().releaseCacheWrites, 1);

    worker.releaseCacheWriteResolve();
    await lifetimePromise;
}

async function exactReleaseHitAvoidsNetwork() {
    const worker = makeWorker({
        cachedResponse: new Response('window.cached = true;', {
            headers: { 'Content-Type': 'application/javascript' }
        })
    });
    let responsePromise;
    const event = {
        request: {
            url: 'https://reshay-istoriyu.ru/app.js?v=20260727-1',
            method: 'GET', mode: 'cors', destination: 'script'
        },
        respondWith(promise) { responsePromise = Promise.resolve(promise); },
        waitUntil() {}
    };

    worker.handlers.fetch(event);
    const response = await responsePromise;
    assert.match(await response.text(), /cached/);
    assert.equal(worker.stats().networkFetches, 0);
    assert.equal(worker.stats().releaseCacheWrites, 0);
}

async function activationKeepsPreviousReleaseAlive() {
    const worker = makeWorker();
    let lifetimePromise;
    worker.handlers.activate({ waitUntil(promise) { lifetimePromise = Promise.resolve(promise); } });
    await lifetimePromise;
    assert.equal(worker.stats().cacheDeletes, 0, 'activate deleted a cache used by an open page');
    worker.releaseCacheWriteResolve();
}

async function navigationNeverWaitsForHungFetchAndCacheOpen() {
    const worker = makeWorker({
        hangFetch: true,
        hangCacheOpen: true,
        timerCapMs: 5
    });
    const response = await Promise.race([
        dispatchNavigation(worker),
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('navigation stayed pending with hung fetch + caches.open')),
            200
        ))
    ]);
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Повторить загрузку/);
}

async function navigationNeverWaitsForHungPreviousCacheLookup() {
    const worker = makeWorker({
        hangFetch: true,
        hangCacheKeys: true,
        timerCapMs: 5
    });
    const response = await Promise.race([
        dispatchNavigation(worker),
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('navigation stayed pending with hung caches.keys')),
            200
        ))
    ]);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
}

async function navigationUsesCachedHtmlWhenNetworkHangs() {
    const worker = makeWorker({
        cachedResponse: new Response('<!doctype html><title>cached app</title>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }),
        hangFetch: true,
        timerCapMs: 5
    });
    const response = await dispatchNavigation(worker);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /cached app/);
}

async function iosTelegramDoesNotInstallInterceptingWorker() {
    let registrations = 0;
    let unregisters = 0;
    const context = vm.createContext({
        console,
        Promise,
        setTimeout: () => 1,
        clearTimeout: () => undefined,
        localStorage: { getItem: () => null, setItem: () => undefined },
        location: {
            protocol: 'https:', hostname: 'reshay-istoriyu.ru', pathname: '/', search: '',
            hash: '#tgWebAppData=signed&tgWebAppVersion=8.0&tgWebAppPlatform=ios'
        },
        navigator: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
            onLine: false,
            serviceWorker: {
                controller: {},
                register: async () => { registrations++; },
                getRegistrations: async () => [{ unregister: async () => { unregisters++; } }]
            }
        },
        document: {
            readyState: 'complete', visibilityState: 'visible',
            documentElement: { toggleAttribute: () => undefined },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        },
        window: {
            TelegramWebviewProxy: {},
            addEventListener: () => undefined
        }
    });
    context.window.window = context.window;
    vm.runInContext(pwaSource, context, { filename: 'pwa.js' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registrations, 0, 'iOS Telegram installed an intercepting Service Worker');
    assert.equal(unregisters, 1, 'iOS Telegram did not unregister the old Service Worker');
    assert.equal(context.window.__egeServiceWorkerDisabledReason, 'ios-telegram-webview');
}

async function wwwFallbackDoesNotInstallInterceptingWorker() {
    let registrations = 0;
    let unregisters = 0;
    const context = vm.createContext({
        console,
        Promise,
        setTimeout: () => 1,
        clearTimeout: () => undefined,
        localStorage: { getItem: () => null, setItem: () => undefined },
        location: {
            protocol: 'https:', hostname: 'www.reshay-istoriyu.ru',
            pathname: '/', search: '', hash: ''
        },
        navigator: {
            userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36',
            onLine: false,
            serviceWorker: {
                controller: {},
                register: async () => { registrations++; },
                getRegistrations: async () => [{ unregister: async () => { unregisters++; } }]
            }
        },
        document: {
            readyState: 'complete', visibilityState: 'visible',
            documentElement: { toggleAttribute: () => undefined },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        },
        window: {
            addEventListener: () => undefined
        }
    });
    context.window.window = context.window;
    vm.runInContext(pwaSource, context, { filename: 'pwa.js' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(registrations, 0, 'www fallback installed an intercepting Service Worker');
    assert.equal(unregisters, 1, 'www fallback did not unregister the old Service Worker');
    assert.equal(context.window.__egeServiceWorkerDisabledReason, 'direct-fallback-host');
}

function bootHtmlIsOneAtomicRelease() {
    const bootAssets = [];
    for (const match of indexSource.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi)) {
        const asset = match[1];
        if (/^(?:https?:|data:)/i.test(asset) || !/\.(?:js|css)(?:\?|$)/i.test(asset)) continue;
        bootAssets.push(asset);
    }
    assert.ok(bootAssets.length >= 20, 'boot asset list was unexpectedly short');
    // Версию берём из service-worker.js, а НЕ пишем сюда строкой. Раньше номер
    // релиза был захардкожен в самой проверке, и каждый выкат требовал править
    // ещё и тест — то есть проверка ловила не рассинхрон index.html и SW, а факт
    // «агент забыл обновить тест». Теперь SW — единственный источник версии, и
    // тест падает ровно тогда, когда файл в index.html реально отстал.
    const releaseMatch = source.match(/const RELEASE_ASSET_VERSION = '([^']+)'/);
    assert.ok(releaseMatch, 'RELEASE_ASSET_VERSION не найден в service-worker.js');
    const release = releaseMatch[1];
    assert.deepEqual(
        bootAssets.filter((asset) => !asset.includes(`v=${release}`)),
        [],
        `boot-файл не привязан к текущему релизу ${release}`
    );
    // BOOT_RELEASE уезжает в каждый диагностический пинг. Он был захардкожен и
    // отстал на два релиза — в логе версия загрузки врала, и разбор поля шёл
    // по несуществующей сборке. Держим его на той же версии, что и ассеты.
    const bootRelease = indexSource.match(/var BOOT_RELEASE = '([^']+)'/);
    assert.ok(bootRelease, 'BOOT_RELEASE не найден в index.html');
    assert.equal(bootRelease[1], release,
        `BOOT_RELEASE (${bootRelease[1]}) отстал от релиза ассетов (${release}) — пинги загрузки будут врать`);
    // Маяк-картинка: на устройствах со сломанным fetch это ЕДИНСТВЕННЫЙ сигнал,
    // что страница вообще выполнилась. Без него такое устройство неотличимо от
    // «страница не доехала».
    assert.match(indexSource, /if \(phase === 'html'\) bootBeacon\(qs\);/,
        'маяк на фазе html пропал — диагностика снова ослепнет при мёртвом fetch');

    for (const match of indexSource.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc=/i.test(match[1]) || /application\/ld\+json/i.test(match[1])) continue;
        new vm.Script(match[2], { filename: 'index.inline.js' });
    }
}

function slowCoreStillDismissesRecoveryScreen() {
    const watchBootSource = indexSource.match(
        /\(function watchBoot\(\) \{[\s\S]*?\n        \}\)\(\);/
    );
    assert.ok(watchBootSource, 'watchBoot не найден в index.html');

    const scheduled = [];
    const dispatched = [];
    let dismissed = 0;
    let recoveryVisible = false;
    const windowObject = {};
    const context = vm.createContext({
        window: windowObject,
        document: {
            readyState: 'complete',
            getElementById(id) {
                if (id !== 'app-boot-recovery') return null;
                return { classList: { add() { recoveryVisible = true; } } };
            },
            querySelector() { return { textContent: '' }; },
            dispatchEvent(event) { dispatched.push(event.type); }
        },
        Date: { now: () => 13001 },
        bootT0: 0,
        isIosTelegramLaunch: () => false,
        sessionStorage: { removeItem: () => undefined, getItem: () => null, setItem: () => undefined },
        dismissSkeleton: () => { dismissed++; },
        bootSignal: () => undefined,
        navigator: {},
        Event: function Event(type) { this.type = type; },
        setTimeout(callback) { scheduled.push(callback); return scheduled.length; }
    });

    vm.runInContext(watchBootSource[0], context, { filename: 'watch-boot.inline.js' });
    assert.equal(recoveryVisible, true, 'slow load did not show the recovery screen');
    assert.equal(scheduled.length, 1,
        'watchBoot stopped forever after 12 seconds instead of waiting for the late core');

    windowObject.quickStartGame = () => undefined;
    scheduled.shift()();
    assert.ok(dispatched.includes('app:ready'), 'late core never emitted app:ready');
    assert.equal(dismissed, 1, 'recovery screen stayed over the already loaded app');
}

// Кэш картинок не должен зависеть от версии приложения.
//
// Инвариант введён 27.07.2026. До него ASSET_CACHE звался
// `ege-history-assets-${APP_VERSION}`, а cleanupOldCaches сносит любой кэш вне
// CACHE_NAMES — то есть каждый бамп версии выбрасывал весь кэш картинок, и
// пользователи заново качали 41 МБ (244 файла), хотя ни один не менялся.
// Проверка стоит здесь, потому что глазом такое не видно вообще: приложение
// работает, просто у людей молча уходит мобильный трафик.
function assetCacheIsIndependentOfAppVersion() {
    const assetCacheLine = source.match(/const ASSET_CACHE = [^\n]+/);
    assert.ok(assetCacheLine, 'ASSET_CACHE не найден');
    assert.ok(
        !/APP_VERSION/.test(assetCacheLine[0]),
        'имя кэша картинок снова завязано на APP_VERSION — каждый релиз будет стоить пользователю 41 МБ'
    );
    assert.match(assetCacheLine[0], /ASSET_MANIFEST_VERSION/,
        'кэш картинок должен версионироваться составом набора, а не версией приложения');
    assert.match(source, /const ASSET_MANIFEST_VERSION = '[^']+'/,
        'ASSET_MANIFEST_VERSION должен быть объявлен явной строкой');
    // Статический кэш кода, наоборот, ОБЯЗАН зависеть от версии приложения:
    // иначе новый релиз собрался бы из старых файлов.
    const staticCacheLine = source.match(/const STATIC_CACHE = [^\n]+/);
    assert.match(staticCacheLine[0], /APP_VERSION/,
        'кэш кода обязан версионироваться версией приложения');
}

(async () => {
    assetCacheIsIndependentOfAppVersion();
    previousReleaseHtmlSurvivesVersionBump();
    await coldCodeDoesNotWaitForCacheStorage();
    await exactReleaseHitAvoidsNetwork();
    await activationKeepsPreviousReleaseAlive();
    await navigationNeverWaitsForHungFetchAndCacheOpen();
    await navigationNeverWaitsForHungPreviousCacheLookup();
    await navigationUsesCachedHtmlWhenNetworkHangs();
    await iosTelegramDoesNotInstallInterceptingWorker();
    await wwwFallbackDoesNotInstallInterceptingWorker();
    bootHtmlIsOneAtomicRelease();
    slowCoreStillDismissesRecoveryScreen();
    console.log('service-worker.selftest: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// Офлайн-страховка при смене версии не должна пропадать.
//
// 🔴 Инцидент 27.07.2026. STATIC_CACHE называется по APP_VERSION, поэтому бамп
// версии создаёт ПУСТОЙ кэш, а cleanupOldCaches сносил прежний. До первой
// успешной загрузки по сети у человека не оставалось офлайн-копии вообще: сеть
// моргнула — Response.error(), «не открывается», и ни строчки в логах сервера,
// потому что запрос до него не дошёл. В тот день выкатили четыре релиза — четыре
// таких окна, и жалобы пришли именно оттуда.
//
// ⚠️ Проверка смотрит на ДВА условия сразу: фолбэк на прошлый релиз существует И
// прошлый кэш переживает уборку. Починить одно без другого бесполезно.
function previousReleaseHtmlSurvivesVersionBump() {
    assert.match(source, /function previousReleaseHtml/,
        'нет фолбэка на HTML прошлого релиза — после бампа версии офлайн-копии не будет');
    assert.match(source, /\|\| previousReleaseHtml\(/,
        'фолбэк объявлен, но не подключён к поиску кэша при навигации');

    const cleanup = source.match(/async function cleanupOldCaches\(\)[\s\S]*?\n}/);
    assert.ok(cleanup, 'cleanupOldCaches не найден');
    // ⚠️ Проверяем именно ВЕТКУ ПРОПУСКА, а не упоминание переменной. Первая
    // редакция этой проверки искала просто /keepStatic/ и прошла на коде, где
    // объявление осталось, а `return null` для него удалили — то есть тест
    // «зелёный», кэш сносится, страховки нет. Ищи то, что делает работу.
    assert.match(cleanup[0], /if \(name === keepStatic\) return null;/,
        'уборка снова сносит ВСЕ прошлые статик-кэши — страховка исчезнет при следующем же релизе');
    assert.match(cleanup[0], /const keepStatic = /, 'keepStatic не вычисляется');

    // Имя строится от префикса: иначе фильтр в фолбэке разъедется с именем кэша
    // и перестанет что-либо находить — молча, без единой ошибки.
    assert.match(source, /const STATIC_CACHE_PREFIX = 'ege-history-static-';/);
    assert.match(source, /const STATIC_CACHE = `\$\{STATIC_CACHE_PREFIX\}\$\{APP_VERSION\}`;/);
}
