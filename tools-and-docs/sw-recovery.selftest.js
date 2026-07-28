'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'sw-recover.html'), 'utf8');
const nginx = fs.readFileSync(path.join(root, 'server', 'infra', 'nginx-site.conf'), 'utf8');

assert.match(nginx, /location = \/sw-recover\s*\{[\s\S]*?error_page 418 =418 \/sw-recover\.html;[\s\S]*?return 418;/);
assert.match(nginx, /location = \/sw-recover\.html\s*\{[\s\S]*?internal;[\s\S]*?Cache-Control "no-store, no-cache, must-revalidate"/);

assert.doesNotMatch(page, /<script[^>]+\bsrc=/i, 'Recovery page must not depend on external scripts');
assert.doesNotMatch(page, /<link[^>]+\brel=["']?stylesheet/i, 'Recovery page must not depend on external styles');
assert.match(page, /navigator\.serviceWorker\.getRegistrations\(\)/);
assert.match(page, /registration\.unregister\(\)/);
assert.match(page, /name\.indexOf\('ege-history-'\) === 0/);
assert.doesNotMatch(page, /localStorage\.(?:clear|removeItem)/, 'Recovery must preserve local progress');
assert.doesNotMatch(page, /indexedDB\.deleteDatabase/, 'Recovery must preserve IndexedDB');
assert.doesNotMatch(page, /document\.cookie\s*=/, 'Recovery must preserve the session');
assert.match(page, /telegramPost\('web_app_ready', \{\}\)/, 'Recovery must dismiss Telegram loading UI');
assert.match(page, /telegramPost\('web_app_close', \{\}\)/, 'Recovery must destroy the controlled Telegram WebView');
assert.match(page, /setTimeout\(finishRecovery, 5200\)/, 'Recovery must have a hard completion deadline');

const recoveryScript = page.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
assert.ok(recoveryScript, 'Recovery page must contain its inline recovery script');

async function runRecovery({ telegram }) {
    const events = [];
    const replacements = [];
    const timers = [];
    const window = {};

    if (telegram) {
        window.TelegramWebviewProxy = {
            postEvent(type, payload) {
                events.push({ type, payload });
            }
        };
    }

    const context = vm.createContext({
        window,
        document: {
            getElementById() {
                return { textContent: '' };
            }
        },
        navigator: {
            serviceWorker: {
                async getRegistrations() {
                    return [{ async unregister() { return true; } }];
                }
            }
        },
        caches: {
            async keys() { return ['ege-history-old', 'unrelated-cache']; },
            async delete() { return true; }
        },
        location: {
            href: telegram
                ? 'https://reshay-istoriyu.ru/sw-recover#tgWebAppVersion=8.0'
                : 'https://reshay-istoriyu.ru/sw-recover',
            origin: 'https://reshay-istoriyu.ru',
            search: '',
            hash: telegram ? '#tgWebAppVersion=8.0' : '',
            replace(url) { replacements.push(url); }
        },
        URL,
        URLSearchParams,
        JSON,
        Promise,
        setTimeout(fn, delay) {
            timers.push({ fn, delay });
            return timers.length;
        }
    });
    window.window = window;

    vm.runInContext(recoveryScript, context);
    await new Promise((resolve) => setImmediate(resolve));
    for (const timer of timers.filter((item) => item.delay < 1000)) timer.fn();

    return { events, replacements };
}

async function legacyPutIfOk(cache, request, response) {
    if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
    }
}

(async () => {
    const telegramRecovery = await runRecovery({ telegram: true });
    assert.deepEqual(
        telegramRecovery.events.map((event) => event.type),
        ['web_app_ready', 'web_app_ready', 'web_app_close'],
        'Telegram recovery must reveal and then close its current controlled WebView'
    );
    assert.equal(
        telegramRecovery.replacements.length,
        0,
        'Telegram recovery must not redirect inside the still-controlled WebView'
    );

    const browserRecovery = await runRecovery({ telegram: false });
    assert.equal(browserRecovery.replacements.length, 1, 'Ordinary browser recovery must reopen the app');
    assert.match(browserRecovery.replacements[0], /_sw_recovered=/);

    let putCalls = 0;
    const cache = {
        put() {
            putCalls += 1;
            return new Promise(() => {});
        }
    };
    const response418 = { ok: false, type: 'basic', clone() { return this; } };

    await Promise.race([
        legacyPutIfOk(cache, {}, response418),
        new Promise((_, reject) => setTimeout(() => reject(new Error('418 response waited for CacheStorage')), 50))
    ]);

    assert.equal(putCalls, 0, 'Non-2xx recovery response must bypass the legacy cache.put');
    console.log('SW recovery self-test passed');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
