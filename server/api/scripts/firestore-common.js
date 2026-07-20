'use strict';

const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { env } = require('../src/env');

function initFirestore() {
  if (!fs.existsSync(env.firebaseServiceAccount)) throw new Error(`Service account not found: ${env.firebaseServiceAccount}`);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({
    credential: admin.credential.cert(require(env.firebaseServiceAccount)),
  });
  return app.firestore();
}

function plain(value) {
  if (value == null) return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    if (typeof value.path === 'string' && value.firestore) return value.path;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  let normalized = value;
  if (typeof value === 'string') {
    try { normalized = JSON.parse(value); } catch (_) {}
  }
  return crypto.createHash('sha256').update(stable(normalized)).digest('hex');
}

async function readCollection(firestore, visibility, collection) {
  const path = `artifacts/${env.firebaseAppId}/${visibility}/data/${collection}`;
  const snapshot = await firestore.collection(path).get();
  return snapshot.docs.map(doc => ({ id: doc.id, data: plain(doc.data()) }));
}

module.exports = { initFirestore, plain, stable, hash, readCollection };
