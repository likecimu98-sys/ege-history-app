'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'ege-social-app');

function loadBank() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(APP, 'bank.js'), 'utf8'), sandbox, { filename: 'bank.js' });
  return sandbox.window.EGE_SOCIAL_BANK;
}

const bank = loadBank();
const core = require(path.join(APP, 'core.js'));
const manual = JSON.parse(fs.readFileSync(path.join(__dirname, 'manual-answers.json'), 'utf8')).answers;

assert(bank && Array.isArray(bank.tasks), 'bank.js must expose EGE_SOCIAL_BANK');
assert.strictEqual(bank.tasks.length, 1058, 'all parsed tasks must be included');
assert.strictEqual(new Set(bank.tasks.map(task => task.id)).size, 1058, 'stable task IDs must be unique');
assert.strictEqual(bank.blocks.length, 5, 'five subject blocks expected');
assert.strictEqual(bank.topics.length, 65, '65 KES topics expected');
assert.strictEqual(Object.keys(manual).length, 85, '80 task 1 keys and five matching keys expected');

const typeCounts = bank.tasks.reduce((result, task) => {
  result[task.type] = (result[task.type] || 0) + 1;
  return result;
}, {});
assert.deepStrictEqual(JSON.parse(JSON.stringify(typeCounts)), {
  choice: 709,
  task1: 80,
  task12: 51,
  task13: 49,
  matching: 169
});

for (const task of bank.tasks) {
  assert(task.id && task.prompt && task.answer, `complete card expected: ${task.id}`);
  assert(Array.isArray(task.blockIds) && task.blockIds.length, `block tags expected: ${task.id}`);
  assert(Array.isArray(task.topicCodes) && task.topicCodes.length, `topic tags expected: ${task.id}`);
  assert(Array.isArray(task.options) && task.options.length, `answer variants expected: ${task.id}`);
  assert(!/<\/?[a-z][^>]*>/i.test(task.prompt), `prompt must be plain safe text: ${task.id}`);
  assert(task.options.every(option => option.text && option.text.length >= 2 && !/<\/?[a-z][^>]*>/i.test(option.text)), `broken variant: ${task.id}`);
  if (task.type === 'task1') {
    assert.strictEqual(task.options.length, 6, `task 1 has six terms: ${task.id}`);
    assert(/^\d{2}$/.test(task.answer), `task 1 has two excluded terms: ${task.id}`);
  } else if (task.type === 'matching' || task.type === 'task13') {
    assert.strictEqual(task.targets.length, task.answer.length, `one answer per matching position: ${task.id}`);
    assert(task.targets.every(target => target.label && target.text), `matching target text: ${task.id}`);
  } else {
    assert(task.answer.split('').every(value => task.options.some(option => String(option.n) === value)), `choice key fits variants: ${task.id}`);
  }
}

const imageRefs = new Set(bank.tasks.flatMap(task => task.images || []));
assert.strictEqual(imageRefs.size, 155, '155 referenced images expected');
for (const ref of imageRefs) {
  const file = path.join(APP, ...ref.split('/'));
  assert(fs.existsSync(file), `image exists: ${ref}`);
  assert(fs.statSync(file).size > 100, `image is non-empty: ${ref}`);
}
const imageFiles = fs.readdirSync(path.join(APP, 'assets', 'questions')).filter(name => /\.(?:jpe?g|png|webp)$/i.test(name));
assert.strictEqual(imageFiles.length, 155, 'no missing or stale question images');

for (const id of ['5055FB', 'F7E513', '0CB588']) {
  const task = bank.tasks.find(item => item.id === id);
  assert(task, `diagram task retained: ${id}`);
  assert.strictEqual(task.options.length, 5, `five restored diagram variants: ${id}`);
  assert(task.options.every(option => option.text.length > 45), `diagram variants are not truncated: ${id}`);
}

assert.strictEqual(manual.FB8C48, '46');
assert.strictEqual(manual['316e08'], '35');
assert.strictEqual(manual.CC554F, '42113');
assert.strictEqual(manual.A43AE5, '41312');

const setTask = bank.tasks.find(task => task.type === 'choice' && task.answer.length >= 2);
const reversed = setTask.answer.split('').reverse().join('');
assert(core.evaluate(setTask, reversed).correct, 'choice grading ignores digit order');
const wrongDigit = setTask.options.map(option => String(option.n)).find(value => !setTask.answer.includes(value));
assert(!core.evaluate(setTask, [wrongDigit]).correct, 'choice grading rejects another set');

const matchingTask = bank.tasks.find(task => task.type === 'task13');
const partial = matchingTask.answer.split('');
partial[0] = matchingTask.options.map(option => String(option.n)).find(value => value !== partial[0]);
const partialResult = core.evaluate(matchingTask, partial);
assert(!partialResult.correct, 'matching requires every position');
assert.strictEqual(partialResult.earned, matchingTask.answer.length - 1, 'matching awards each correct position');

const multiTagTask = bank.tasks.find(task => task.topicCodes.length > 1);
assert(multiTagTask, 'multi-topic tasks expected');
for (const code of multiTagTask.topicCodes) {
  assert(core.filterTasks(bank.tasks, { topics: [code], mode: 'mixed' }, core.createProgress()).some(task => task.id === multiTagTask.id), `task is available in topic ${code}`);
}
const combined = core.filterTasks(bank.tasks, { topics: multiTagTask.topicCodes, mode: 'mixed' }, core.createProgress());
assert.strictEqual(combined.filter(task => task.id === multiTagTask.id).length, 1, 'multi-topic task is not duplicated in a session pool');

const now = Date.UTC(2026, 7, 11, 9, 0, 0);
let progress = core.createProgress();
assert(core.filterTasks([setTask], { mode: 'new' }, progress, now).length === 1, 'unseen task starts in new mode');
let attempt = core.recordAttempt(progress, setTask, [wrongDigit], 1200, now);
progress = attempt.progress;
assert(core.filterTasks([setTask], { mode: 'mistakes' }, progress, now).length === 1, 'wrong task enters mistakes');
attempt = core.recordAttempt(progress, setTask, setTask.answer, 900, now + 1000);
progress = attempt.progress;
assert(core.filterTasks([setTask], { mode: 'mistakes' }, progress, now + 1000).length === 0, 'correct retry clears pending mistake');
assert(core.filterTasks([setTask], { mode: 'review' }, progress, now + 2 * 86400000).length === 1, 'task becomes due for review');
assert.strictEqual(progress.daily[core.moscowDayKey(now)], 2, 'daily goal counts attempts in Moscow time');
assert.deepStrictEqual(core.sanitizeProgress(JSON.parse(JSON.stringify(progress))), progress, 'progress survives JSON save and restore');

const randomValues = [0.9, 0.1, 0.7, 0.2, 0.5];
let randomIndex = 0;
const built = core.buildSession(bank.tasks, { mode: 'mixed', topics: multiTagTask.topicCodes }, progress, 10, () => randomValues[(randomIndex++) % randomValues.length], now);
assert(built.length <= 10 && new Set(built.map(task => task.id)).size === built.length, 'mixed session has requested size and no duplicate IDs');

const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
assert.strictEqual(manifest.name, 'Решай обществознание');
assert.strictEqual(manifest.scope, '/');
assert(manifest.icons.some(icon => icon.sizes === '192x192') && manifest.icons.some(icon => icon.sizes === '512x512'), 'installable PWA icons expected');
for (const icon of manifest.icons) assert(fs.existsSync(path.join(APP, ...icon.src.split('/'))), `manifest icon exists: ${icon.src}`);
const sw = fs.readFileSync(path.join(APP, 'service-worker.js'), 'utf8');
assert(sw.includes("key.startsWith('ege-social-')"), 'service worker only cleans its own cache namespace');
assert(sw.includes('CACHE_READ_TIMEOUT_MS'), 'CacheStorage reads have a timeout');
assert(!/install[\s\S]{0,220}caches\.open/.test(sw), 'install does not wait for CacheStorage');
assert(!/return\s+await\s+putInBackground/.test(sw), 'cache writes never block response delivery');
const boot = fs.readFileSync(path.join(APP, 'boot.js'), 'utf8');
assert(boot.includes('window.setTimeout(watchBoot, 300)'), 'boot watcher continues after delayed recovery appears');
const app = fs.readFileSync(path.join(APP, 'app.js'), 'utf8');
assert(app.includes('isIOS && isTelegram'), 'service worker is disabled in Telegram on iOS');
assert(!app.includes('ege_history_'), 'social app does not use history storage keys');
const recovery = fs.readFileSync(path.join(APP, 'sw-recover.html'), 'utf8');
assert(!recovery.includes('localStorage.'), 'recovery never deletes local progress or identity');

const socialDeploy = fs.readFileSync(path.join(ROOT, 'deploy-social-static.ps1'), 'utf8');
assert(!/[^\x00-\x7f]/.test(socialDeploy), 'social deploy script stays ASCII-only');
assert(socialDeploy.includes('StrictHostKeyChecking=yes') && socialDeploy.includes('HostKeyAlgorithms=ssh-ed25519'), 'social deploy pins strict ED25519 SSH checks');
assert(socialDeploy.includes('HEAD:ege-social-app'), 'social deploy archives only its own app');
assert(socialDeploy.includes('/var/www/ege-social-app'), 'social deploy uses an isolated webroot');
assert(socialDeploy.includes('ege-social-app-static-rollback.sh'), 'social deploy prepares one-command rollback');
const historyDeploy = fs.readFileSync(path.join(ROOT, 'deploy-static.ps1'), 'utf8');
assert(historyDeploy.includes("':(exclude)ege-social-app'"), 'history archive explicitly excludes social app');
assert(historyDeploy.includes('ege-social-app/ must use deploy-social-static.ps1'), 'history archive fails if social app leaks in');
const socialNginx = fs.readFileSync(path.join(ROOT, 'server', 'infra', 'nginx-social-site.conf'), 'utf8');
assert(socialNginx.includes('server_name obschestvo.reshay-istoriyu.ru'), 'dedicated social hostname configured');
assert(socialNginx.includes('root /var/www/ege-social-app'), 'dedicated social webroot configured');
assert(socialNginx.includes('error_page 418 =418 /sw-recover.html'), 'independent HTTP 418 recovery route configured');
assert((socialNginx.match(/add_header Cache-Control "no-cache" always/g) || []).length >= 3, 'HTML, JS/CSS entry and PWA metadata revalidate');

console.log('social-bank.selftest: ok');
