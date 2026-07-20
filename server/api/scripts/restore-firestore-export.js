'use strict';

const fs = require('fs');
const path = require('path');
const { initFirestore } = require('./firestore-common');

function loadRows(file) {
  const body = fs.readFileSync(file, 'utf8').trim();
  return body ? body.split(/\r?\n/).map(line => JSON.parse(line)) : [];
}

async function main() {
  const inputArg = process.argv.find(value => value.startsWith('--input='));
  const targetArg = process.argv.find(value => value.startsWith('--target-app='));
  const apply = process.argv.includes('--apply');
  if (!inputArg || !targetArg) throw new Error('Usage: node restore-firestore-export.js --input=DIR --target-app=APP_ID [--apply --confirm=RESTORE:APP_ID]');
  const input = path.resolve(inputArg.slice(8));
  const targetApp = targetArg.slice(13).trim();
  if (!/^[A-Za-z0-9_-]{3,120}$/.test(targetApp)) throw new Error('Invalid target app id');
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'));
  if (apply && targetApp === manifest.appId && !process.argv.includes('--allow-source-overwrite')) {
    throw new Error('Refusing to overwrite the source namespace');
  }
  if (apply && !process.argv.includes(`--confirm=RESTORE:${targetApp}`)) throw new Error('Restore confirmation is missing');
  const plan = Object.entries(manifest.collections || {}).map(([name, item]) => ({ name, count: item.count }));
  if (!apply) return console.log(JSON.stringify({ dryRun: true, targetApp, plan }, null, 2));

  const firestore = initFirestore();
  for (const [name, item] of Object.entries(manifest.collections || {})) {
    const [visibility, collection] = name.split('/');
    const rows = loadRows(path.join(input, item.file));
    for (let offset = 0; offset < rows.length; offset += 400) {
      const batch = firestore.batch();
      for (const row of rows.slice(offset, offset + 400)) {
        batch.set(firestore.doc(`artifacts/${targetApp}/${visibility}/data/${collection}/${row.id}`), row.data);
      }
      await batch.commit();
    }
  }
  console.log(JSON.stringify({ restored: true, targetApp, plan }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
