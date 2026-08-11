'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const trainerFile = path.join(root, 'ege-social-app', 'task13-trainers.js');
delete global.EGE_SOCIAL_TASK13_TRAINERS;
require(trainerFile);

const core = require(path.join(root, 'ege-social-app', 'core.js'));
const data = global.EGE_SOCIAL_TASK13_TRAINERS;
assert(data && Array.isArray(data.trainers), 'task13 trainer data must load');
assert.strictEqual(data.trainers.length, 2, 'exactly two task 13 trainers are required');

const byId = new Map(data.trainers.map(trainer => [trainer.id, trainer]));
const federal = byId.get('federal');
const authorities = byId.get('authorities');
assert(federal && authorities, 'both source trainers must be present');
assert.strictEqual(federal.cards.length, 51, 'articles 71/72 deck must keep all 51 cards');
assert.strictEqual(authorities.cards.length, 78, 'authority deck must keep all 78 cards');
assert.strictEqual(new Set(data.trainers.flatMap(trainer => trainer.cards.map(card => card.id))).size, 129, 'stable card ids must be globally unique');

function counts(trainer) {
  return Object.fromEntries(trainer.answers.map(answer => [answer.id, trainer.cards.filter(card => card.answer === answer.id).length]));
}

assert.deepStrictEqual(counts(federal), { rf: 33, joint: 18 });
assert.deepStrictEqual(counts(authorities), { p: 33, pr: 16, sf: 10, gd: 13, ks: 4, vs: 2 });
for (const trainer of data.trainers) {
  const allowed = new Set(trainer.answers.map(answer => answer.id));
  assert(trainer.cards.every(card => card.text.trim() === card.text && allowed.has(card.answer)), `${trainer.id}: every card needs exact text and a valid answer`);
  const hash = crypto.createHash('sha256').update(JSON.stringify(trainer.cards)).digest('hex');
  assert.strictEqual(hash, trainer.contentSha256, `${trainer.id}: content hash changed`);
}
assert.strictEqual(federal.contentSha256, 'efa9ca9da72cefff995770b23eb5fd0e7aefe7dce0b4831b84b5c0f3f6326ac6');
assert.strictEqual(authorities.contentSha256, '13a5c92fec6a2dfe355126b023f2064232555c228fd0754f55f4cf0b702a989c');
assert.strictEqual(federal.sourceSha256, '79d7dd0dc0a2f6849f501ec96fcf0a5d5745c23a16bcaf845e5805a5f58967e4');
assert.strictEqual(authorities.sourceSha256, 'b715fb19e4df2849dfd9242d692a2ab0cd717b25668c272f0e72a195323c3322');
assert.strictEqual(authorities.cards.find(card => card.id === 'authority-8').text, 'Назначает Председателя Правительства');
assert.strictEqual(federal.cards.find(card => card.id === 'federal-51').text, 'Защита исконной среды обитания и традиционного образа жизни малочисленных этнических общностей');

function oneCardTrainer(source, id) {
  return { ...source, cards: [{ id, text: 'Карточка', answer: source.answers[0].id }] };
}

const federalMini = oneCardTrainer(federal, 'federal-mini');
let federalSession = core.createMasterySession(federalMini, () => 0, 1000);
let answered = core.answerMasteryCard(federalSession, federalMini, 'joint', () => 0, 1100);
assert.strictEqual(answered.session.cardState['federal-mini'].targetStreak, 2, 'first federal mistake must not raise the target');
assert.strictEqual(answered.session.cardState['federal-mini'].errorStreak, 1);
federalSession = core.advanceMasterySession(answered.session, federalMini, 1200);
answered = core.answerMasteryCard(federalSession, federalMini, 'rf', () => 0, 1300);
assert.strictEqual(answered.session.cardState['federal-mini'].errorStreak, 0, 'correct answer resets consecutive federal mistakes');
federalSession = core.advanceMasterySession(answered.session, federalMini, 1400);
answered = core.answerMasteryCard(federalSession, federalMini, 'joint', () => 0, 1500);
assert.strictEqual(answered.session.cardState['federal-mini'].targetStreak, 2);
federalSession = core.advanceMasterySession(answered.session, federalMini, 1600);
answered = core.answerMasteryCard(federalSession, federalMini, 'joint', () => 0, 1700);
assert.strictEqual(answered.session.cardState['federal-mini'].targetStreak, 3, 'second consecutive federal mistake raises the target to three');

const authorityMini = oneCardTrainer(authorities, 'authority-mini');
let authoritySession = core.createMasterySession(authorityMini, () => 0, 2000);
answered = core.answerMasteryCard(authoritySession, authorityMini, 'pr', () => 0, 2100);
assert.strictEqual(answered.session.cardState['authority-mini'].targetStreak, 3, 'first authority mistake raises the target to three');
assert.strictEqual(authorities.mechanics.revealCorrectOnMistake, true);
assert.strictEqual(federal.mechanics.revealCorrectOnMistake, false);

let mastery = core.createMasterySession(federalMini, () => 0, 3000);
answered = core.answerMasteryCard(mastery, federalMini, 'rf', () => 0, 3100);
assert.strictEqual(answered.outcome.mastered, false, 'one correct answer is not enough');
mastery = core.advanceMasterySession(answered.session, federalMini, 3200);
answered = core.answerMasteryCard(mastery, federalMini, 'rf', () => 0, 3300);
assert.strictEqual(answered.outcome.mastered, true, 'the second consecutive correct answer masters the card');
const restoredFeedback = core.sanitizeMasterySession(JSON.parse(JSON.stringify(answered.session)), federalMini, 3350);
assert.strictEqual(restoredFeedback.currentId, 'federal-mini', 'reload during final feedback must not skip the mastered card transition');
mastery = core.advanceMasterySession(restoredFeedback, federalMini, 3400);
assert.strictEqual(mastery.completed, true, 'the one-card deck completes after feedback');

function distanceTrainer(source, id) {
  return { ...source, id, cards: ['a', 'b', 'c', 'd', 'e'].map(cardId => ({ id: `${id}-${cardId}`, text: cardId, answer: source.answers[0].id })) };
}

for (const [source, expectedIndex] of [[federal, 2], [authorities, 3]]) {
  const trainer = distanceTrainer(source, `distance-${source.id}`);
  let saved = core.createMasterySession(trainer, () => 0, 4000);
  saved.currentId = trainer.cards[0].id;
  saved.queue = trainer.cards.slice(1).map(card => card.id);
  saved.mastered = [];
  answered = core.answerMasteryCard(saved, trainer, source.answers[0].id, () => 0, 4100);
  assert.strictEqual(answered.session.queue.indexOf(trainer.cards[0].id), expectedIndex, `${source.id}: card must return after the original minimum distance`);
  const advanced = core.advanceMasterySession(answered.session, trainer, 4200);
  assert.strictEqual(advanced.queue.indexOf(trainer.cards[0].id), expectedIndex - 1, `${source.id}: feedback transition must preserve the reinsertion distance`);
}

const baseProgress = core.createProgress();
const activity = core.recordDailyActivity(baseProgress, 1, new Date('2026-08-11T10:00:00Z'));
assert.strictEqual(activity.daily['2026-08-11'], 1, 'lab answer must count toward the daily goal');
assert.deepStrictEqual(activity.totals, baseProgress.totals, 'lab answers must not pollute FIPI bank totals');

const indexHtml = fs.readFileSync(path.join(root, 'ege-social-app', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'ege-social-app', 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'ege-social-app', 'service-worker.js'), 'utf8');
assert(indexHtml.includes('task13-trainers.js?v=2026-08-11-social-2'), 'trainer data must load with the shared release');
assert(indexHtml.indexOf('task13-trainers.js') < indexHtml.indexOf('app.js'), 'trainer data must load before the app');
assert(appJs.includes("task13Labs: 'ege_social_task13_labs_v1'"), 'lab state must use the social namespace');
assert(appJs.includes("const RELEASE = '2026-08-11-social-2'"));
assert(sw.includes("const APP_VERSION = '2026-08-11-social-2'"));
assert(!appJs.includes('iframe'), 'task 13 trainers must be integrated, not embedded');
assert(!appJs.includes('window.open'), 'task 13 trainers must not launch separate apps');

console.log('task13-trainers.selftest: ok');
