'use strict';

const WebSocket = require('ws');

const [url, cookie, origin, ownPath, forbiddenPath, internalToken] = process.argv.slice(2);
if (![url, cookie, origin, ownPath, forbiddenPath, internalToken].every(Boolean)) {
  throw new Error('smoke-websocket arguments are missing');
}

function timeout(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

async function rejectsForeignOrigin() {
  await Promise.race([new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: 'https://attacker.invalid' } });
    ws.once('open', () => { ws.close(); reject(new Error('foreign websocket origin accepted')); });
    ws.once('unexpected-response', () => resolve());
    ws.once('error', () => resolve());
    ws.once('close', () => resolve());
  }), timeout(5000, 'foreign websocket origin test timed out')]);
}

async function authorizedSubscriptionAndEvent() {
  await Promise.race([new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    let forbiddenRejected = false;
    ws.once('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'subscribe', path: forbiddenPath })));
    ws.on('message', async raw => {
      const message = JSON.parse(String(raw));
      console.log('WebSocket smoke event:', message.type, message.error || '', message.path || '');
      if (message.type === 'error' && !forbiddenRejected) {
        forbiddenRejected = true;
        ws.send(JSON.stringify({ type: 'subscribe', path: ownPath }));
        return;
      }
      if (message.type === 'subscribed' && message.path === ownPath) {
        const response = await fetch('http://127.0.0.1:8793/internal/v1/store/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${internalToken}` },
          body: JSON.stringify({ path: ownPath, data: { websocketSmokeAt: Date.now() }, mode: 'merge' }),
        });
        console.log('WebSocket trigger status:', response.status);
        if (!response.ok) reject(new Error(`internal websocket trigger failed: ${response.status}`));
        return;
      }
      if (message.type === 'change' && message.path === ownPath) {
        ws.close();
        resolve();
      }
    });
  }), timeout(8000, 'authorized websocket event test timed out')]);
}

async function reconnectsAndPongs() {
  await Promise.race([new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    ws.once('error', reject);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'ping' })));
    ws.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type === 'pong') { ws.close(); resolve(); }
    });
  }), timeout(5000, 'websocket reconnect test timed out')]);
}

(async () => {
  await rejectsForeignOrigin();
  await authorizedSubscriptionAndEvent();
  await reconnectsAndPongs();
  console.log('WebSocket smoke test passed');
})().catch(error => { console.error(error); process.exit(1); });
