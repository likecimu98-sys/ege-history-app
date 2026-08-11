'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT = path.join(ROOT, 'ege-social-app', 'assets', 'icons');
const sizes = [48, 180, 192, 512];

function sourceSvg(size) {
  const radius = Math.round(size * 0.225);
  const inset = Math.round(size * 0.085);
  const innerRadius = Math.round(size * 0.19);
  const fontSize = Math.round(size * 0.31);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#f7f1e8"/>
      <circle cx="${Math.round(size * .13)}" cy="${Math.round(size * .16)}" r="${Math.round(size * .21)}" fill="#e8c9b8"/>
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${innerRadius}" fill="#a9472b"/>
      <circle cx="${Math.round(size * .80)}" cy="${Math.round(size * .20)}" r="${Math.round(size * .18)}" fill="none" stroke="#f7f1e8" stroke-opacity=".42" stroke-width="${Math.max(1, Math.round(size * .012))}"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#fffdf9" font-family="Georgia,serif" font-size="${fontSize}" font-weight="700" letter-spacing="-${Math.round(size * .018)}">ОБ</text>
      <path d="M${Math.round(size * .26)} ${Math.round(size * .73)}H${Math.round(size * .74)}" stroke="#f7f1e8" stroke-opacity=".52" stroke-width="${Math.max(1, Math.round(size * .012))}" stroke-linecap="round"/>
    </svg>`);
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const size of sizes) {
    await sharp(sourceSvg(size)).png({ compressionLevel: 9 }).toFile(path.join(OUTPUT, `icon-${size}.png`));
  }
  console.log(`social icons: ${sizes.join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
