'use strict';
// Дуэль обязана заканчиваться вовремя — и на экране, и на сервере.
//
// 🔴 Жалоба владельца 26.08.2026: «дуэль не закончилась, я продолжил решать
// после времени». Классический режим считал матч ТИКАМИ: `timeLeft = 60` и
// `timeLeft--` раз в секунду. setInterval не обещает ни одного тика, пока
// вкладка в фоне — свернул Telegram, погас экран, — и шестьдесят «секунд»
// растягивались на реальные минуты. Свайп и подбор с самого начала считали по
// часам (endsAt), классика — нет, а попасть в неё легко: listenToDuel ставит
// `mode = data.mode || 'classic'`, то есть любой матч без режима идёт туда.
//
// Клиентского таймера мало в принципе: он замирает в фоне, его можно
// остановить отладчиком. Поэтому конец матча теперь стережёт и сервер, считая
// от СВОЕЙ отметки playingAt — startTime приходит от клиента, и у школьника со
// сбитыми часами сервер рвал бы концовку законных матчей.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const modes = strip(fs.readFileSync(path.join(root, 'modes.js'), 'utf8'));
const storeSrc = fs.readFileSync(path.join(root, 'server/api/src/store.js'), 'utf8');
const store = strip(storeSrc);

// ── 1. Классика считает по часам, а не по числу тиков ───────────────────────
const game = modes.slice(modes.indexOf('window.startDuelGame = function'),
  modes.indexOf('window.updateDuelUI = function'));
assert.ok(game.length > 200, 'startDuelGame не найдена');
assert.doesNotMatch(game, /timeLeft\s*--/,
  'Таймер снова уменьшает счётчик на каждом тике — в фоне он замирает и матч не кончается');
assert.doesNotMatch(game, /state\.timeLeft\s*=\s*60\b/,
  'Остаток снова задан числом секунд вместо отметки времени окончания');
assert.match(game, /endsAt\s*=\s*\(window\.state\.duel\.startTime\s*\|\|\s*Date\.now\(\)\)\s*\+\s*CLASSIC_DUEL_MS/,
  'Конец матча не привязан к startTime — стороны разойдутся во времени');
assert.match(game, /Math\.max\(0,\s*endsAt\s*-\s*Date\.now\(\)\)/,
  'Остаток не вычисляется по часам');
assert.match(game, /if\s*\(left\s*<=\s*0\)\s*window\.endDuel\(\)/,
  'По истечении времени матч не завершается');

// ── 2. Возврат из фона пересчитывает время сразу ────────────────────────────
assert.match(modes, /function _duelVisibilityWatch\(/, 'Нет пересчёта таймера при возврате на вкладку');
// Точка с запятой обязательна: без неё регулярка ловит и объявление функции,
// и проверка проходит даже при вырезанном вызове.
assert.match(game, /_duelVisibilityWatch\(tick\);/, 'Классическая дуэль не подписана на возврат из фона');
const vis = modes.slice(modes.indexOf('function _duelVisibilityWatch('));
assert.match(vis, /removeEventListener\('visibilitychange'/,
  'Слушатель возврата не снимается — накопится по одному на каждый матч');

// ── 3. Длительности клиента и сервера не разъезжаются ───────────────────────
const classicMs = /const CLASSIC_DUEL_MS = (\d+)/.exec(modes);
assert.ok(classicMs, 'CLASSIC_DUEL_MS не найдена в modes.js');
const swipeMs = /const DUEL_SECTIONS = \d+, DUEL_CARDS_PER_SECTION = \d+, DUEL_MS = (\d+)/
  .exec(strip(fs.readFileSync(path.join(root, 'swipe-mode.js'), 'utf8')));
const matchMs = /const DUEL_MS = (\d+)/.exec(strip(fs.readFileSync(path.join(root, 'match-mode.js'), 'utf8')));
assert.ok(swipeMs && matchMs, 'Не найдены длительности свайпа/подбора');
const table = /DUEL_DURATION_MS = Object\.freeze\(\{([^}]+)\}\)/.exec(store);
assert.ok(table, 'На сервере нет таблицы длительностей дуэли');
const serverMs = Object.fromEntries([...table[1].matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
assert.strictEqual(serverMs.classic, Number(classicMs[1]),
  'Классика: сервер и клиент разошлись по длительности матча');
assert.strictEqual(serverMs.swipe, Number(swipeMs[1]),
  'Свайп: сервер и клиент разошлись по длительности матча');
assert.strictEqual(serverMs.match, Number(matchMs[1]),
  'Подбор: сервер и клиент разошлись по длительности матча');

// ── 4. Отметку начала ставит СЕРВЕР, а не клиент ────────────────────────────
assert.match(store, /if \(Number\(current\.playingAt\) > 0\) next\.playingAt = current\.playingAt;/,
  'playingAt не переживает merge — отметка начала матча будет теряться');
assert.match(store, /next\.status === 'playing' && current\.status !== 'playing'\)\s*next\.playingAt = Date\.now\(\)/,
  'playingAt не ставится сервером при переходе в playing');
assert.doesNotMatch(store, /playingAt = Number\(patch/,
  'playingAt берётся из запроса клиента — часы игрока станут источником правды');
// Клиент не должен уметь прислать playingAt ни при создании, ни при обновлении.
const createFields = /MATCH_CREATE_FIELDS = new Set\(\[([^\]]+)\]/.exec(store);
assert.ok(createFields, 'MATCH_CREATE_FIELDS не найден');
assert.doesNotMatch(createFields[1], /playingAt/,
  'Клиент может задать playingAt при создании матча — замок обходится с порога');

// ── 5. Сервер режет ТОЛЬКО счёт и только после срока ────────────────────────
assert.match(store, /function duelWriteWindowOver\(before\)/, 'Нет серверной проверки срока матча');
const win = store.slice(store.indexOf('function duelWriteWindowOver(before)'));
assert.match(win, /if \(!Number\.isFinite\(startedAt\) \|\| startedAt <= 0\) return false/,
  'Матч без серверной отметки должен пропускаться, иначе сломаются старые матчи');
assert.match(win, /DUEL_DURATION_MS\[String\(before\?\.mode \|\| ''\)\] \|\| DUEL_MAX_DURATION_MS/,
  'Незнакомый режим не получает самый долгий срок — живой матч оборвётся');
assert.match(store, /const DUEL_WRITE_GRACE_MS = (\d+)/, 'Нет запаса на закрывающую запись');
assert.ok(Number(/const DUEL_WRITE_GRACE_MS = (\d+)/.exec(store)[1]) >= 10000,
  'Запас меньше 10 секунд — finalizeDuelScores не успеет дописать счёт');

const guard = /if \(patch\?\.\[actorKey\] !== undefined && duelWriteWindowOver\(before\)\) return false;/;
assert.match(store, guard, 'Счёт после конца матча по-прежнему принимается');
// Замок обязан стоять ПОСЛЕ разрешения status:'finished' — иначе доигранный матч
// навсегда застрянет в playing (поломка 12.08.2026).
const guardAt = store.search(guard);
const statusAt = store.indexOf("if (patch?.status && patch.status !== 'finished') return false;");
assert.ok(statusAt > 0 && guardAt > statusAt,
  'Замок стоит раньше проверки status — закрытие матча начнёт отбиваться, матчи застрянут в playing');

// Поведение, а не только текст: истёкший матч режет счёт, но пропускает закрытие.
// Соединение не открывается — authorizeWrite не ходит в базу на ветке матчей.
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const { authorizeWrite } = require(path.join(root, 'server/api/src/store.js'));
const ref = { collection: 'matches', docId: 'm1' };
const ctx = { docIds: new Set(['u1']) };
const started = ts => ({ data: { status: 'playing', mode: 'swipe', playingAt: ts, player1: { uid: 'u1' }, player2: { uid: 'u2' } } });
const fresh = started(Date.now());
const stale = started(Date.now() - 10 * 60 * 1000);

(async () => {
  const can = (cur, patch) => authorizeWrite(null, ref, ctx, cur, patch, 'update', {});
  assert.strictEqual(await can(fresh, { player1: { uid: 'u1', score: 5 } }), true,
    'Живой матч перестал принимать счёт — дуэли сломаны полностью');
  assert.strictEqual(await can(stale, { player1: { uid: 'u1', score: 5 } }), false,
    'Просроченный матч всё ещё принимает очки — доигрывание после времени не закрыто');
  assert.strictEqual(await can(stale, { status: 'finished' }), true,
    'Просроченный матч нельзя закрыть — он навсегда застрянет в playing');
  assert.strictEqual(await can(started(0), { player1: { uid: 'u1', score: 5 } }), true,
    'Матч без серверной отметки должен приниматься (старые записи)');
  console.log('duel-deadline.selftest: ok');
})().catch(e => { console.error(e); process.exit(1); });
