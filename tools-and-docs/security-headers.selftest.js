'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIGS = [
  {
    file: 'server/infra/security-headers.conf',
    header: 'Content-Security-Policy',
  },
  {
    file: 'server/infra/security-headers-report-only.conf',
    header: 'Content-Security-Policy-Report-Only',
  },
];

function readPolicy({ file, header }) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(
    new RegExp(`add_header\\s+${escapedHeader}\\s+"([^"]+)"\\s+always;`)
  );
  assert.ok(match, `${file}: заголовок ${header} не найден`);
  return match[1];
}

function parseDirectives(policy) {
  const result = new Map();
  for (const rawDirective of policy.split(';')) {
    const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) result.set(tokens[0], tokens.slice(1));
  }
  return result;
}

const policies = CONFIGS.map((config) => ({
  ...config,
  policy: readPolicy(config),
}));

assert.equal(
  policies[0].policy,
  policies[1].policy,
  'боевой и Report-Only CSP разошлись'
);

for (const { file, policy } of policies) {
  const directives = parseDirectives(policy);
  const frameSources = directives.get('frame-src') || [];
  const frameAncestors = directives.get('frame-ancestors') || [];

  assert.ok(
    frameSources.includes("'self'"),
    `${file}: frame-src обязан разрешать собственный cram.html для выполнения ДЗ`
  );
  assert.ok(
    frameSources.includes('https://yandex.ru') &&
      frameSources.includes('https://*.yandex.ru'),
    `${file}: frame-src обязан сохранять карты Яндекса`
  );
  assert.ok(
    frameAncestors.includes("'self'") &&
      frameAncestors.includes('https://web.telegram.org') &&
      frameAncestors.includes('https://*.telegram.org'),
    `${file}: frame-ancestors обязан сохранять встраивание в приложение и Telegram`
  );
}

console.log('Security headers self-test passed.');
