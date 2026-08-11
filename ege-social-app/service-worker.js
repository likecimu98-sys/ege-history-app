'use strict';

const APP_VERSION = '2026-08-11-social-2';
const SHELL_CACHE = `ege-social-shell-${APP_VERSION}`;
const RUNTIME_CACHE = `ege-social-runtime-${APP_VERSION}`;
const CACHE_READ_TIMEOUT_MS = 350;
const NETWORK_TIMEOUT_MS = 9000;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ege-social-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);
}

async function cacheMatch(request) {
  try {
    return await withTimeout(caches.match(request), CACHE_READ_TIMEOUT_MS);
  } catch (_) {
    return null;
  }
}

async function putInBackground(cacheName, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (_) {
    // CacheStorage can be unavailable in private mode; the network response is already returned.
  }
}

function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function offlineResponse() {
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Нет сети</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;padding:28px;background:#f7f1e8;color:#25211f;font:16px system-ui;text-align:center}main{max-width:360px}a{color:#a9472b;font-weight:700}</style><main><h1>Нет соединения</h1><p>Откройте приложение один раз при доступной сети — после этого тренажёр сможет запускаться офлайн.</p><p><a href="/">Попробовать снова</a></p></main></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname === '/sw-recover') return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetchWithTimeout(request);
        event.waitUntil(putInBackground(SHELL_CACHE, request, response));
        return response;
      } catch (_) {
        const cached = await cacheMatch(request) || await cacheMatch(new Request(new URL('/', self.location.origin)));
        return cached || offlineResponse();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await cacheMatch(request);
    const network = fetch(request).then(response => {
      event.waitUntil(putInBackground(RUNTIME_CACHE, request, response));
      return response;
    });
    if (cached) {
      event.waitUntil(network.catch(() => undefined));
      return cached;
    }
    try {
      return await network;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
