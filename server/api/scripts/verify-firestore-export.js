'use strict';

const fs = require('fs');
const path = require('path');
const { hash } = require('./firestore-common');

function loadRows(file) {
  const body = fs.readFileSync(file, 'utf8').trim();
  return body ? body.split(/\r?\n/).map(line => JSON.parse(line)) : [];
}

function main() {
  const inputArg = process.argv.find(value => value.startsWith('--input='));
  if (!inputArg) throw new Error('Usage: node verify-firestore-export.js --input=/secure/directory');
  const input = path.resolve(inputArg.slice(8));
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'manifest.json'), 'utf8'));
  const results = {};
  for (const [name, expected] of Object.entries(manifest.collections || {})) {
    const rows = loadRows(path.join(input, expected.file));
    const actual = { count: rows.length, sha256: hash(rows) };
    actual.ok = actual.count === expected.count && actual.sha256 === expected.sha256;
    results[name] = actual;
  }
  const report = { ok: Object.values(results).every(item => item.ok), appId: manifest.appId, results };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
