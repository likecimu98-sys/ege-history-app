'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
assert.match(page, /setTimeout\(openApp, 5200\)/, 'Recovery must have a hard navigation deadline');

async function legacyPutIfOk(cache, request, response) {
    if (response && (response.ok || response.type === 'opaque')) {
        await cache.put(request, response.clone());
    }
}

(async () => {
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
