'use strict';

const fs = require('fs');
const path = require('path');
const { env } = require('../src/env');
const { initFirestore, readCollection, hash } = require('./firestore-common');
const { FIRESTORE_COLLECTIONS } = require('./firestore-collections');

async function main() {
  const outputArg = process.argv.find(value => value.startsWith('--output='));
  if (!outputArg) throw new Error('Usage: node export-firestore.js --output=/secure/directory');
  const output = path.resolve(outputArg.slice(9));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const firestore = initFirestore();
  const manifest = { format: 1, appId: env.firebaseAppId, exportedAt: new Date().toISOString(), collections: {} };

  for (const [visibility, name] of FIRESTORE_COLLECTIONS) {
    const rows = await readCollection(firestore, visibility, name);
    const file = `${visibility}__${name}.ndjson`;
    const body = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
    fs.writeFileSync(path.join(output, file), body, { mode: 0o600 });
    manifest.collections[`${visibility}/${name}`] = { file, count: rows.length, sha256: hash(rows) };
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
