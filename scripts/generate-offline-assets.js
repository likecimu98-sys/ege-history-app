'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
const outputFile = path.join(rootDir, 'offline-assets.json');

const allowedExtensions = new Set([
    '.avif', '.gif', '.ico', '.jpg', '.jpeg', '.png', '.svg', '.webp'
]);

function walk(dir, files) {
    if (!fs.existsSync(dir)) return files;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, files);
        } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
            files.push('./' + path.relative(rootDir, fullPath).replace(/\\/g, '/'));
        }
    }

    return files;
}

const assets = walk(assetsDir, []).sort((a, b) => a.localeCompare(b));
fs.writeFileSync(outputFile, JSON.stringify(assets, null, 2) + '\n', 'utf8');

console.log(`Wrote ${assets.length} offline assets to ${path.relative(rootDir, outputFile)}`);
