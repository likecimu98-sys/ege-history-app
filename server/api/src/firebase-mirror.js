'use strict';

const fs = require('fs');
const { env } = require('./env');

function startFirebaseMirror(store, log = console) {
  if (!env.mirrorFirebase) return { enabled: false };
  if (!fs.existsSync(env.firebaseServiceAccount)) throw new Error('FIREBASE_SERVICE_ACCOUNT not found for mirror mode');
  const admin = require('firebase-admin');
  const app = admin.apps.length ? admin.app() : admin.initializeApp({
    credential: admin.credential.cert(require(env.firebaseServiceAccount)),
  });
  const firestore = app.firestore();
  const queue = new Map();

  async function mirror(path) {
    const item = queue.get(path);
    if (!item || item.running) return;
    item.running = true;
    do {
      item.dirty = false;
      try {
        const current = await store.get(path, null, { internal: true });
        if (current.exists) await firestore.doc(path).set(current.data);
        else await firestore.doc(path).delete();
        log.log(JSON.stringify({ level: 'info', event: 'firebase.mirror.ok', path, at: new Date().toISOString() }));
      } catch (error) {
        item.dirty = true;
        log.error(JSON.stringify({ level: 'error', event: 'firebase.mirror.failed', path, message: error.message, at: new Date().toISOString() }));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } while (item.dirty);
    queue.delete(path);
  }

  store.on('change', change => {
    const existing = queue.get(change.path);
    if (existing) {
      existing.dirty = true;
      return;
    }
    queue.set(change.path, { dirty: true, running: false });
    setTimeout(() => mirror(change.path), 100).unref?.();
  });
  return { enabled: true };
}

module.exports = { startFirebaseMirror };
