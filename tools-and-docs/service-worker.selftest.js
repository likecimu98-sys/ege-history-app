/* Regression checks for the boot-critical Service Worker strategy. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const pwaSource = fs.readFileSync(path.join(__dirname, '..', 'pwa.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function makeWorker({ cachedResponse = null } = {}) {
    const handlers = {};
    let releaseCacheWriteResolve;
    let releaseCacheWrites = 0;
    let networkFetches = 0;
    let cacheDeletes = 0;

    const releaseCacheWrite = new Promise((resolve) => { releaseCacheWriteResolve = resolve; });
    const cache = {
        match: async () => cachedResponse,
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
        setTimeout,
        clearTimeout,
        fetch: async () => {
            networkFetches++;
            return new Response('window.booted = true;', {
                status: 200,
                headers: { 'Content-Type': 'application/javascript' }
            });
        },
        caches: {
            open: async () => cache,
            match: async () => cachedResponse,
            keys: async () => ['ege-history-static-old'],
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

async function coldCodeDoesNotWaitForCacheStorage() {
    const worker = makeWorker();
    let responsePromise;
    let lifetimePromise;
    const event = {
        request: {
            url: 'https://reshay-istoriyu.ru/app.js?v=20260723-2',
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
            url: 'https://reshay-istoriyu.ru/app.js?v=20260723-2',
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
            protocol: 'https:', pathname: '/', search: '',
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

function bootHtmlIsOneAtomicRelease() {
    const bootAssets = [];
    for (const match of indexSource.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi)) {
        const asset = match[1];
        if (/^(?:https?:|data:)/i.test(asset) || !/\.(?:js|css)(?:\?|$)/i.test(asset)) continue;
        bootAssets.push(asset);
    }
    assert.ok(bootAssets.length >= 20, 'boot asset list was unexpectedly short');
    assert.deepEqual(
        bootAssets.filter((asset) => !/[?&]v=20260723-2(?:&|$)/.test(asset)),
        [],
        'a boot JS/CSS file is not tied to the release URL'
    );

    for (const match of indexSource.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc=/i.test(match[1]) || /application\/ld\+json/i.test(match[1])) continue;
        new vm.Script(match[2], { filename: 'index.inline.js' });
    }
}

(async () => {
    await coldCodeDoesNotWaitForCacheStorage();
    await exactReleaseHitAvoidsNetwork();
    await activationKeepsPreviousReleaseAlive();
    await iosTelegramDoesNotInstallInterceptingWorker();
    bootHtmlIsOneAtomicRelease();
    console.log('service-worker.selftest: ok');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
