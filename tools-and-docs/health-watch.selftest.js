'use strict';
// Обёртка: сам тест сторожа написан на bash, потому что проверяет НАСТОЯЩИЙ
// health-watch.sh, а не его пересказ. Здесь только поиск интерпретатора, чтобы
// `npm run check` работал и на Windows (npm запускает скрипты через cmd, а bash
// из состава Git там не лежит в PATH), и на сервере.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const script = path.join(__dirname, 'health-watch.selftest.sh');

function findBash() {
  const probe = spawnSync('bash', ['--version'], { stdio: 'ignore' });
  if (!probe.error) return 'bash';
  const candidates = [];
  const git = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' });
  if (git.status === 0) {
    for (const line of String(git.stdout).split(/\r?\n/).filter(Boolean)) {
      // …/Git/cmd/git.exe → …/Git/bin/bash.exe
      candidates.push(path.join(path.dirname(path.dirname(line.trim())), 'bin', 'bash.exe'));
    }
  }
  candidates.push('C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'));
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}

const bash = findBash();
if (!bash) {
  // Проверять нечего, но молчать об этом нельзя: строка обязана быть видна.
  console.log('health-watch.selftest: ПРОПУЩЕН — не найден bash (поставьте Git for Windows)');
  process.exit(0);
}

const run = spawnSync(bash, [script], { stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
