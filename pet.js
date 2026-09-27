// «Летописчик» — питомец ученика: виджет в лобби, экран питомца, лавка,
// гардероб, сундуки, вылупление из яйца, цветной ник.
//
// Сервер — источник правды обо всём, что стоит денег (server/api/src/pet/).
// Здесь только отрисовка и запросы. Файл грузится лениво после старта
// приложения (см. loadPetModule в ui.js) и в стартовую загрузку не входит.
//
// Питомца видит только тот, кто уже порешал ~10 минут: новичка на первом
// экране не пугаем ещё одной сущностью (решение владельца 27.09.2026).
(function () {
  'use strict';

  var API = '/api/v1/pet';
  // Монета — своя картинка, а не эмодзи монеты (U+1FA99): на Windows 10 его нет в шрифте,
  // и вместо монеты ученик видел пустой квадрат.
  var COIN = '<i class="coin" aria-label="монет"></i>';
  var S = { catalog: null, items: {}, state: null, loading: false, lastFetch: 0, tab: 'care', shopSlot: 'all', wardSlot: 'all', busy: false };

  // ── Утилиты ─────────────────────────────────────────────────────────────
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function fmt(n) { return (Number(n) || 0).toLocaleString('ru-RU'); }
  function $(id) { return document.getElementById(id); }
  function haptic(t) { try { if (typeof window.haptic === 'function') window.haptic(t); } catch (_) {} }
  function toast(emoji, text, tone) {
    try {
      var tones = { ok: ['bg-emerald-500', 'border-emerald-700'], warn: ['bg-amber-500', 'border-amber-700'], bad: ['bg-rose-500', 'border-rose-700'], gold: ['bg-yellow-500', 'border-yellow-700'] };
      var t = tones[tone || 'ok'];
      if (typeof window.showToast === 'function') window.showToast(emoji, text, t[0], t[1]);
    } catch (_) {}
  }
  function csrf() {
    var item = document.cookie.split(';').map(function (v) { return v.trim(); }).find(function (v) { return v.indexOf('ege_csrf=') === 0; });
    if (!item) return '';
    try { return decodeURIComponent(item.slice(item.indexOf('=') + 1)); } catch (_) { return ''; }
  }
  function api(path, body) {
    var opts = { credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; opts.headers['X-CSRF-Token'] = csrf(); }
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || ('http_' + r.status)); e.status = r.status; e.details = data.details; throw e; }
        return data;
      });
    });
  }

  // Сколько ученик уже порешал: время на игровом экране базовых заданий.
  // totalTimeSpent тикает и в лобби, поэтому одного его мало.
  function solvingSeconds() {
    var st = (window.state && window.state.stats) || {};
    var byTask = st.timeByTask || {};
    var sum = 0; Object.keys(byTask).forEach(function (k) { sum += Number(byTask[k]) || 0; });
    if ((Number(st.totalSolvedEver) || 0) >= 40) sum = Math.max(sum, Number(st.totalTimeSpent) || 0);
    return sum;
  }
  function eligible() {
    var need = (S.catalog && S.catalog.economy && S.catalog.economy.hatchMinSeconds) || 600;
    return solvingSeconds() >= need;
  }

  function loadCatalog() {
    if (S.catalog) return Promise.resolve(S.catalog);
    return fetch(API + '/catalog', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cat) {
      S.catalog = cat; S.items = {};
      (cat.items || []).forEach(function (i) { S.items[i.id] = i; });
      (cat.consumables || []).forEach(function (i) { S.items[i.id] = i; });
      (cat.boxes || []).forEach(function (i) { S.items[i.id] = i; });
      return cat;
    });
  }

  function rarityLabel(r) { var f = (S.catalog.rarities || []).find(function (x) { return x.id === r; }); return f ? f.label : r; }
  function slotLabel(s) { var f = (S.catalog.slots || []).find(function (x) { return x.id === s; }); return f ? f.label : s; }

  // ── Состояние ───────────────────────────────────────────────────────────
  function refresh(force) {
    if (S.loading) return Promise.resolve(S.state);
    if (!force && Date.now() - S.lastFetch < 20000) return Promise.resolve(S.state);
    S.loading = true;
    return loadCatalog().then(function () { return api('/'); }).then(function (st) {
      S.lastFetch = Date.now();
      apply(st);
      return st;
    }).catch(function (e) {
      if (e && e.status === 401) S.state = null;
      return S.state;
    }).then(function (st) { S.loading = false; return st; });
  }

  function apply(st) {
    var prev = S.state;
    S.state = st;
    window._petAwards = st && st.awards || {};
    if (st && Array.isArray(st.events)) announce(st.events, prev);
    if (st && st.hatched) syncAchievements();
    renderWidget();
    if (isOpen()) renderModal();
  }

  var REASON = { solve: 'за решение', daily: 'за первый день', streak: 'серия дней', welcome: 'подарок', cap: '' };
  function announce(events) {
    var total = 0, streak = null, capped = 0;
    events.forEach(function (e) { total += Number(e.delta) || 0; if (e.reason === 'streak') streak = e.streak; if (e.reason === 'cap') capped = e.lost; });
    if (total > 0) {
      floatCoins(total);
      toast('💰', '+' + fmt(total) + ' монет' + (streak ? ' · серия ' + streak + ' дн.!' : ''), 'gold');
    }
    if (capped) setTimeout(function () { toast('⛔', 'Дневной потолок монет достигнут — завтра снова', 'warn'); }, 2200);
  }

  function floatCoins(n) {
    var host = $('lobby-pet'); if (!host) return;
    var el = document.createElement('div');
    el.className = 'petw-float'; el.innerHTML = '+' + fmt(n) + ' ' + COIN;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 1600);
  }

  // Ачивки: сервер платит ОДИН раз за каждую, повтор ему не страшен.
  // Шлём список разово за сессию и при каждой новой ачивке.
  var achSynced = false;
  function syncAchievements(ids) {
    var all = (window.state && window.state.stats && window.state.stats.achievements) || [];
    var list = ids || (achSynced ? null : all);
    if (!list || !list.length || !S.state || !S.state.hatched) return;
    achSynced = true;
    api('/achievements', { ids: list.slice(0, 50) }).then(function (st) {
      var paid = st.paid || [];
      S.state = Object.assign({ hatched: true }, st); window._petAwards = st.awards || {};
      renderWidget(); if (isOpen()) renderModal();
      if (paid.length) {
        var sum = paid.reduce(function (a, p) { return a + p.delta; }, 0);
        floatCoins(sum);
      }
    }).catch(function () {});
  }

  // ── Виджет в лобби ──────────────────────────────────────────────────────
  var STATE_TEXT = {
    sick: 'Заболел — нужно лекарство',
    hungry: 'Проголодался',
    sad: 'Скучает — поиграй с ним',
    sleep: 'Спит до 7:00',
    happy: 'Счастлив! Решай — будет ещё веселее',
    ok: 'Сыт и доволен',
  };

  function mountWidget() {
    var host = $('lobby-pet');
    if (!host) {
      var anchor = $('main-action');
      if (!anchor || !anchor.parentNode) return null;
      host = document.createElement('div');
      host.id = 'lobby-pet';
      anchor.parentNode.insertBefore(host, anchor.nextSibling);
    }
    return host;
  }

  function bar(label, v, cls) {
    return '<span class="petw-bar ' + cls + '" title="' + label + ' ' + v + '%"><span style="width:' + Math.max(3, v) + '%"></span></span>';
  }

  // Ачивки питомца и топа недели зависят от состояния питомца — перепроверяем
  // после каждого его обновления (не чаще раза в секунду).
  var achCheckAt = 0;
  function recheckAchievements() {
    if (Date.now() - achCheckAt < 1000) return;
    achCheckAt = Date.now();
    try { if (typeof window.checkAchievements === 'function') window.checkAchievements(); } catch (_) {}
  }

  function renderWidget() {
    recheckAchievements();
    var host = mountWidget(); if (!host) return;
    var st = S.state;
    if (!st || !S.catalog) { host.innerHTML = ''; return; }
    if (!st.hatched) {
      if (!eligible() || !st.canHatch) { host.innerHTML = ''; return; }
      host.innerHTML = '<button type="button" class="petw petw-egg" onclick="PetUI.openHatch()">' +
        '<span class="petw-ava egg-wobble">' + eggSvg() + '</span>' +
        '<span class="petw-txt"><b>Из летописи что-то вылупляется…</b><i>Нажми — у тебя появится питомец</i></span>' +
        '<span class="petw-go">›</span></button>';
      return;
    }
    var p = st.pet;
    var line = STATE_TEXT[p.state] || '';
    if (p.state === 'hungry' || (p.sat < 35 && p.state !== 'sleep')) {
      var shchi = S.items.food_shchi;
      var need = shchi ? shchi.price - st.balance : 0;
      line = need > 0 ? 'Голодный · на щи нужно ещё ' + need + ' строк' : 'Проголодался — покорми';
    }
    host.innerHTML = '<button type="button" class="petw st-' + p.state + '" onclick="PetUI.open()">' +
      '<span class="petw-ava">' + PetArt.render({ species: p.species, state: p.state, items: S.items, equipped: st.equipped, sick: p.sick, label: p.name }) + '</span>' +
      '<span class="petw-txt"><b>' + esc(p.name) + '</b><i>' + esc(line) + '</i>' +
      '<span class="petw-bars">' + bar('Сытость', p.sat, 'b-sat') + bar('Настроение', p.mood, 'b-mood') + bar('Здоровье', p.health, 'b-hp') + '</span></span>' +
      '<span class="petw-coins">' + COIN + ' ' + fmt(st.balance) + '</span></button>';
  }

  function eggSvg() {
    return '<svg viewBox="0 0 100 100" class="pet-egg"><ellipse cx="50" cy="56" rx="30" ry="38" fill="#fff4dc" stroke="#2b2233" stroke-width="3"/>' +
      '<path d="M26 50 l8 -6 8 6 8 -6 8 6 8 -6 8 6" fill="none" stroke="#e0a458" stroke-width="3"/><circle cx="40" cy="68" r="4" fill="#f4a259"/><circle cx="60" cy="76" r="3" fill="#6cc070"/><circle cx="58" cy="36" r="3" fill="#a0785a"/></svg>';
  }

  // ── Экран питомца ───────────────────────────────────────────────────────
  function ensureModal() {
    if ($('pet-modal')) return $('pet-modal');
    var m = document.createElement('div');
    m.id = 'pet-modal';
    m.className = 'pet-modal hidden';
    m.innerHTML = '<div class="pet-sheet" role="dialog" aria-label="Питомец"><div id="pet-sheet-body"></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    document.body.appendChild(m);
    return m;
  }
  function isOpen() { var m = $('pet-modal'); return !!(m && !m.classList.contains('hidden')); }
  function open(tab) {
    if (tab) S.tab = tab;
    var m = ensureModal();
    m.classList.remove('hidden');
    requestAnimationFrame(function () { m.classList.add('open'); });
    if (typeof window.pushBackHandler === 'function') window.pushBackHandler('modal:pet', close);
    renderModal();
    refresh(true);
  }
  function close() {
    var m = $('pet-modal'); if (!m) return;
    m.classList.remove('open');
    setTimeout(function () { m.classList.add('hidden'); }, 220);
    if (typeof window.popBackHandler === 'function') window.popBackHandler('modal:pet');
  }

  var TABS = [['care', 'Уход'], ['wardrobe', 'Гардероб'], ['shop', 'Лавка'], ['boxes', 'Сундуки'], ['nick', 'Ник']];

  function renderModal() {
    var body = $('pet-sheet-body'); if (!body) return;
    var st = S.state;
    if (!st || !st.hatched || !S.catalog) { body.innerHTML = '<div class="pet-empty">Загружаем питомца…</div>'; return; }
    var p = st.pet;
    var daily = st.daily || {};
    var html = '<div class="pet-head">' +
      '<button type="button" class="pet-name" onclick="PetUI.rename()">' + esc(p.name) + ' <span>✎</span></button>' +
      '<span class="pet-coins">' + COIN + ' ' + fmt(st.balance) + '</span>' +
      '<button type="button" class="pet-x" onclick="PetUI.close()" aria-label="Закрыть">×</button></div>' +
      '<div class="pet-stage" id="pet-stage">' + PetArt.render({ species: p.species, state: p.state, items: S.items, equipped: st.equipped, sick: p.sick, label: p.name }) + '</div>' +
      '<div class="pet-stats">' +
        statRow('🍲', 'Сытость', p.sat, 'b-sat') + statRow('😊', 'Настроение', p.mood, 'b-mood') + statRow('❤️', 'Здоровье', p.health, 'b-hp') +
      '</div>' +
      '<div class="pet-earn">Сегодня заработано <b>' + fmt(daily.earned) + '</b> из ' + fmt(daily.cap) + ' ' + COIN + (daily.streak > 1 ? ' · серия <b>' + daily.streak + '</b> дн.' : '') +
      '<br><span>1 решённая строка = 1 монета · 1 балл ЕГЭ = 1 монета · победа в дуэли = 10</span></div>' +
      '<div class="pet-tabs">' + TABS.map(function (t) { return '<button type="button" class="' + (S.tab === t[0] ? 'on' : '') + '" onclick="PetUI.tab(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pet-pane">' + pane() + '</div>';
    body.innerHTML = html;
  }

  function statRow(ico, label, v, cls) {
    return '<div class="pet-stat"><span>' + ico + ' ' + label + '</span><span class="petw-bar big ' + cls + '"><span style="width:' + Math.max(3, v) + '%"></span></span><b>' + v + '</b></div>';
  }

  function pane() {
    if (S.tab === 'wardrobe') return paneWardrobe();
    if (S.tab === 'shop') return paneShop();
    if (S.tab === 'boxes') return paneBoxes();
    if (S.tab === 'nick') return paneNick();
    return paneCare();
  }

  function fxText(fx) {
    var parts = [];
    if (fx.sat) parts.push('+' + fx.sat + ' сытость');
    if (fx.mood) parts.push('+' + fx.mood + ' настроение');
    if (fx.health) parts.push('+' + fx.health + ' здоровье');
    return parts.join(' · ');
  }

  function paneCare() {
    var st = S.state, inv = st.inventory || {};
    var now = Date.now();
    var hint = st.pet.sick ? '<div class="pet-hint bad">Питомец заболел: одежду он не носит, пока не вылечишь. Отвар — если слегка, микстура — сразу на ноги.</div>'
      : st.pet.state === 'sleep' ? '<div class="pet-hint">Ночью питомец спит и голодает вдвое медленнее. Играть можно утром.</div>' : '';
    return hint + '<div class="pet-grid">' + S.catalog.consumables.map(function (c) {
      var own = inv[c.id] || 0;
      var btn;
      if (c.kind === 'toy') {
        var last = (st.pet.toys || {})[c.id] || 0;
        var ready = last + 3 * 3600 * 1000;
        if (!own) btn = buyBtn(c.price, 'PetUI.buy(\'' + c.id + '\')');
        else if (ready > now) btn = '<button type="button" disabled>через ' + Math.ceil((ready - now) / 60000) + ' мин</button>';
        else btn = '<button type="button" class="go" onclick="PetUI.use(\'' + c.id + '\')">Играть</button>';
      } else {
        btn = own ? '<button type="button" class="go" onclick="PetUI.use(\'' + c.id + '\')">' + (c.kind === 'med' ? 'Лечить' : 'Дать') + '</button>'
          : buyBtn(c.price, 'PetUI.use(\'' + c.id + '\', true)');
      }
      return '<div class="pet-card"><div class="pet-ico">' + (PetArt.icons[c.id] || '•') + (own && c.kind !== 'toy' ? '<em>×' + own + '</em>' : '') + '</div>' +
        '<b>' + esc(c.name) + '</b><i>' + fxText(c.fx) + (c.kind === 'toy' ? ' · раз в 3 часа' : '') + '</i>' + btn + '</div>';
    }).join('') + '</div>';
  }

  function buyBtn(price, onclick) {
    var bal = S.state.balance;
    if (bal >= price) return '<button type="button" onclick="' + onclick + '">' + COIN + ' ' + fmt(price) + '</button>';
    return '<button type="button" disabled title="Не хватает монет">' + COIN + ' ' + fmt(price) + '<small>ещё ' + fmt(price - bal) + '</small></button>';
  }

  function slotChips(cur, fn, counts) {
    var list = [['all', 'Все']].concat(S.catalog.slots.map(function (s) { return [s.id, s.label]; }));
    return '<div class="pet-chips">' + list.map(function (s) {
      var n = counts ? counts[s[0]] : null;
      return '<button type="button" class="' + (cur === s[0] ? 'on' : '') + '" onclick="' + fn + '(\'' + s[0] + '\')">' + s[1] + (n != null ? ' <span>' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }

  function itemCard(item, extra, onclick, cls) {
    return '<button type="button" class="pet-item rar-' + item.rarity + ' ' + (cls || '') + '" onclick="' + onclick + '">' +
      '<span class="pet-item-art">' + PetArt.renderItem(item) + '</span>' +
      '<b>' + esc(item.name) + '</b><i>' + rarityLabel(item.rarity) + ' · ' + esc(item.era) + '</i>' + (extra || '') + '</button>';
  }

  function paneWardrobe() {
    var st = S.state, inv = st.inventory || {};
    var owned = S.catalog.items.filter(function (i) { return inv[i.id]; });
    if (!owned.length) return '<div class="pet-hint">Гардероб пуст. Загляни в Лавку или открой сундук — там бывают очень редкие вещи.</div>';
    var counts = { all: owned.length };
    owned.forEach(function (i) { counts[i.slot] = (counts[i.slot] || 0) + 1; });
    var list = owned.filter(function (i) { return S.wardSlot === 'all' || i.slot === S.wardSlot; });
    var eq = st.equipped || {};
    return slotChips(S.wardSlot, 'PetUI.wardSlot', counts) +
      (Object.keys(eq).length ? '<button type="button" class="pet-link" onclick="PetUI.undressAll()">Снять всё</button>' : '') +
      '<div class="pet-grid items">' + list.map(function (i) {
        var on = eq[i.slot] === i.id;
        return itemCard(i, '<span class="pet-tag' + (on ? ' on' : '') + '">' + (on ? 'Надето ✓' : 'Надеть') + '</span>', 'PetUI.toggle(\'' + i.id + '\')', on ? 'worn' : '');
      }).join('') + '</div>';
  }

  function paneShop() {
    var st = S.state, inv = st.inventory || {};
    var list = S.catalog.items.filter(function (i) { return i.price && !inv[i.id] && (S.shopSlot === 'all' || i.slot === S.shopSlot); })
      .sort(function (a, b) { return a.price - b.price; });
    var owners = S.catalog.owners || {};
    return '<div class="pet-hint">Нажми на вещь — примеришь на питомца перед покупкой.</div>' + slotChips(S.shopSlot, 'PetUI.shopSlot') +
      '<div class="pet-grid items">' + list.map(function (i) {
        var afford = st.balance >= i.price;
        var n = owners[i.id];
        return itemCard(i, '<span class="pet-price' + (afford ? '' : ' no') + '">' + COIN + ' ' + fmt(i.price) + '</span>' + (n != null && (i.rarity === 'legendary' || i.rarity === 'mythic') ? '<small class="pet-own">есть у ' + n + '</small>' : ''),
          'PetUI.tryOn(\'' + i.id + '\')');
      }).join('') + '</div>' +
      '<div class="pet-hint">Мифические вещи в лавке не продаются — только в сундуках.</div>';
  }

  function paneBoxes() {
    var st = S.state, inv = st.inventory || {}, pity = st.pity || {};
    return '<div class="pet-boxes">' + S.catalog.boxes.map(function (b) {
      var own = inv[b.id] || 0;
      var odds = Object.keys(b.odds).filter(function (r) { return b.odds[r] > 0; }).map(function (r) {
        return '<span class="rar-' + r + '"><i></i>' + rarityLabel(r) + ' ' + String(b.odds[r]).replace('.', ',') + '%</span>';
      }).join('');
      var pityLine = b.pity ? '<div class="pet-pity">Гарантия: ' + rarityLabel(b.pity.atLeast).toLowerCase() + ' или лучше через <b>' + Math.max(1, b.pity.every - (pity[b.id] || 0)) + '</b></div>' : '';
      var btn = own ? '<button type="button" class="go" onclick="PetUI.openBox(\'' + b.id + '\')">Открыть · есть ' + own + '</button>'
        : b.price ? buyBtn(b.price, 'PetUI.openBox(\'' + b.id + '\')') : '<button type="button" disabled>Только за топ недели</button>';
      return '<div class="pet-box"><div class="pet-box-ico">' + (PetArt.icons[b.id] || '🎁') + '</div><div class="pet-box-body"><b>' + esc(b.name) + '</b>' +
        '<div class="pet-odds">' + odds + '</div>' + pityLine + btn + '</div></div>';
    }).join('') + '</div><div class="pet-hint">Шансы честные и показаны полностью. Повтор вещи превращается в монеты — 40% её цены. Монеты зарабатываются только решением заданий.</div>';
  }

  function paneNick() {
    var st = S.state, style = st.nameStyle;
    var me = (localStorage.getItem('student_manual_name') || 'Ты').slice(0, 40);
    var cur = style ? '<div class="pet-hint">Сейчас: ' + nickHtml(me, style) + ' до ' + new Date(style.until).toLocaleDateString('ru-RU') + '</div>' : '';
    var paint = S.catalog.nickPaint;
    return cur + '<div class="pet-hint">Цветной ник видят все в недельном топе, в общем топе и в дуэлях.</div>' +
      '<div class="pet-nicks">' + Object.keys(paint.colors).map(function (c) {
        return '<button type="button" class="pet-nick" onclick="PetUI.paint(\'' + c + '\')"><span class="nick-' + c + '">' + esc(me) + '</span><small>' + COIN + ' ' + fmt(paint.price) + ' · ' + paint.days + ' дн.</small></button>';
      }).join('') + '</div>' +
      '<div class="pet-hint">🥇 Золотой переливающийся ник с короной — только за 1 место недели (на 30 дней). 🥈🥉 Серебро и бронза — за 2 и 3 место. 4–10 место — фиолетовый на неделю.</div>';
  }

  function nickClass(style) { return style ? 'nick-' + style.color : ''; }

  // ── Действия ────────────────────────────────────────────────────────────
  function act(path, body, okFn) {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    return api(path, body).then(function (st) {
      // Занятость снимаем ДО okFn: цепочки вроде «купить → надеть» зовут act
      // повторно прямо отсюда, и второй шаг иначе молча отбрасывался.
      S.busy = false;
      S.state = Object.assign({ hatched: true }, st);
      window._petAwards = st.awards || {};
      renderWidget(); if (isOpen()) renderModal();
      if (okFn) okFn(st);
      return st;
    }).catch(function (e) {
      var d = e.details || {};
      var msg = {
        not_enough_coins: 'Не хватает монет — реши ещё несколько строк',
        already_owned: 'Уже есть в гардеробе',
        not_owned: 'Сначала нужно купить',
        pet_sleeping: 'Питомец спит — поиграете утром',
        toy_cooldown: 'Он ещё не соскучился по этой игрушке',
        top_color_active: 'У тебя заслуженный цвет за топ — перекрашивать жалко',
        too_early: 'Порешай ещё немного — питомец пока в яйце',
        rate_limited: 'Слишком часто — секунду',
      }[e.message] || 'Не получилось: ' + e.message;
      S.busy = false;
      toast('⚠️', msg, 'warn');
      void d;
    });
  }

  function jump() {
    var stage = $('pet-stage'); if (!stage) return;
    stage.classList.remove('pet-jump'); void stage.offsetWidth; stage.classList.add('pet-jump');
  }

  function use(id, buy) {
    haptic('light');
    act('/use', { item: id, buy: !!buy }, function () {
      jump();
      var it = S.items[id];
      toast(it && it.kind === 'med' ? '💊' : it && it.kind === 'toy' ? '🎉' : '😋', it ? it.name + ' — спасибо!' : 'Готово', 'ok');
    });
  }
  function buy(id) { act('/buy', { item: id }, function () { toast('🛍️', 'Куплено: ' + S.items[id].name, 'ok'); }); }
  function toggle(id) {
    var it = S.items[id]; var eq = S.state.equipped || {};
    var ch = {}; ch[it.slot] = eq[it.slot] === id ? null : id;
    act('/equip', { changes: ch }, jump);
  }
  function undressAll() {
    var ch = {}; Object.keys(S.state.equipped || {}).forEach(function (s) { ch[s] = null; });
    act('/equip', { changes: ch });
  }

  // Примерка: питомец на весь экран в этой вещи + кнопка «Купить».
  function tryOn(id) {
    var it = S.items[id]; var st = S.state;
    var eq = Object.assign({}, st.equipped || {}); eq[it.slot] = id;
    var afford = st.balance >= it.price;
    sheet('<div class="pet-try rar-' + it.rarity + '">' +
      '<div class="pet-try-stage">' + PetArt.render({ species: st.pet.species, state: 'happy', items: S.items, equipped: eq }) + '</div>' +
      '<b>' + esc(it.name) + '</b><i>' + rarityLabel(it.rarity) + ' · ' + slotLabel(it.slot) + ' · ' + esc(it.era) + '</i>' +
      (afford ? '<button type="button" class="go" onclick="PetUI.buyWear(\'' + id + '\')">Купить и надеть · ' + COIN + ' ' + fmt(it.price) + '</button>'
        : '<button type="button" disabled>' + COIN + ' ' + fmt(it.price) + ' · не хватает ' + fmt(it.price - st.balance) + '</button><div class="pet-hint">Это примерно ' + fmt(it.price - st.balance) + ' решённых строк</div>') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Не сейчас</button></div>');
  }
  function buyWear(id) {
    var it = S.items[id];
    act('/buy', { item: id }, function () {
      var ch = {}; ch[it.slot] = id;
      closeSheet();
      act('/equip', { changes: ch }, function () { jump(); toast('✨', it.name + ' — теперь твоё!', 'gold'); });
    });
  }

  function sheet(html) {
    var s = $('pet-sub'); if (s) s.remove();
    s = document.createElement('div'); s.id = 'pet-sub'; s.className = 'pet-sub';
    s.innerHTML = '<div class="pet-sub-card">' + html + '</div>';
    s.addEventListener('click', function (e) { if (e.target === s) closeSheet(); });
    document.body.appendChild(s);
    requestAnimationFrame(function () { s.classList.add('open'); });
  }
  function closeSheet() { var s = $('pet-sub'); if (s) s.remove(); }

  function rename() {
    var cur = S.state && S.state.pet ? S.state.pet.name : '';
    var name = window.prompt('Как зовут питомца?', cur);
    if (name == null) return;
    act('/rename', { name: name });
  }

  function paint(color) {
    var p = S.catalog.nickPaint;
    if (S.state.balance < p.price) { toast('💰', 'Нужно ' + fmt(p.price) + ' монет', 'warn'); return; }
    if (!window.confirm('Покрасить ник на ' + p.days + ' дней за ' + fmt(p.price) + ' монет?')) return;
    act('/paint-nick', { color: color }, function () { toast('🎨', 'Ник покрашен — загляни в топ', 'gold'); });
  }

  // ── Сундук: рулетка ─────────────────────────────────────────────────────
  function openBox(id) {
    if (S.busy) return;
    var box = S.items[id];
    haptic('medium');
    act('/open-box', { box: id }, function (st) { roulette(box, st.drop); });
  }

  function roulette(box, drop) {
    if (!drop) return;
    var pool = S.catalog.items;
    var odds = box.odds;
    function pick() {
      var roll = Math.random() * 100, acc = 0, rar = 'common';
      for (var r in odds) { acc += odds[r]; if (roll < acc) { rar = r; break; } }
      var list = pool.filter(function (i) { return i.rarity === rar; });
      return list[Math.floor(Math.random() * list.length)] || pool[0];
    }
    var strip = [];
    for (var i = 0; i < 34; i++) strip.push(pick());
    var WIN = 29;
    strip[WIN] = S.items[drop.id];
    // пара «почти выпало» рядом с выигрышем — для азарта
    var shiny = pool.filter(function (x) { return x.rarity === 'legendary' || x.rarity === 'mythic'; });
    strip[WIN + 1] = shiny[Math.floor(Math.random() * shiny.length)];
    var cells = strip.map(function (it) { return '<span class="rl-cell rar-' + it.rarity + '">' + PetArt.renderItem(it) + '</span>'; }).join('');
    sheet('<div class="pet-roll"><b>' + esc(box.name) + '</b><div class="rl-window"><div class="rl-strip" id="rl-strip">' + cells + '</div><div class="rl-mark"></div></div><div id="rl-result"></div></div>');
    var el = $('rl-strip');
    var cell = 92; // ширина ячейки с отступом (см. pet.css .rl-cell)
    var win = el.parentNode.clientWidth;
    var target = WIN * cell - (win / 2 - cell / 2) + (Math.random() * 40 - 20);
    requestAnimationFrame(function () {
      el.style.transition = 'transform 4.6s cubic-bezier(.12,.72,.12,1)';
      el.style.transform = 'translateX(' + (-target) + 'px)';
    });
    var ticks = 0, tk = setInterval(function () { ticks++; if (ticks < 26) haptic('light'); else clearInterval(tk); }, 170);
    setTimeout(function () {
      clearInterval(tk);
      el.style.transition = 'transform .35s ease-out';
      el.style.transform = 'translateX(' + (-(WIN * cell - (win / 2 - cell / 2))) + 'px)';
      showDrop(box, drop);
    }, 4700);
  }

  function showDrop(box, drop) {
    var it = S.items[drop.id];
    haptic(drop.rarity === 'mythic' || drop.rarity === 'legendary' ? 'heavy' : 'medium');
    try { if (window.Sfx && window.Sfx.play) window.Sfx.play(drop.rarity === 'common' ? 'ok' : 'win'); } catch (_) {}
    var res = $('rl-result'); if (!res) return;
    var own = (S.state.inventory || {})[box.id] || 0;
    var again = own ? 'Открыть ещё · есть ' + own : box.price && S.state.balance >= box.price ? 'Ещё один · ' + COIN + ' ' + fmt(box.price) : '';
    res.innerHTML = '<div class="rl-drop rar-' + it.rarity + '"><div class="rl-flash"></div>' +
      '<div class="rl-art">' + PetArt.renderItem(it) + '</div><b>' + esc(it.name) + '</b><i>' + rarityLabel(it.rarity) + ' · ' + slotLabel(it.slot) + '</i>' +
      (drop.duplicate ? '<div class="pet-hint">Уже было — превращено в <b>+' + fmt(drop.shards) + ' ' + COIN + '</b></div>'
        : '<button type="button" class="go" onclick="PetUI.wearDrop(\'' + it.id + '\')">Надеть</button>') +
      (drop.owners != null && !drop.duplicate ? '<div class="pet-own">Такая есть всего у ' + drop.owners + ' ' + plural(drop.owners, 'человека', 'человек', 'человек') + '</div>' : '') +
      (again ? '<button type="button" onclick="PetUI.openBox(\'' + box.id + '\')">' + again + '</button>' : '') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Закрыть</button></div>';
    if (drop.rarity === 'legendary' || drop.rarity === 'mythic') confetti();
  }
  function wearDrop(id) {
    var it = S.items[id]; var ch = {}; ch[it.slot] = id;
    closeSheet(); act('/equip', { changes: ch }, jump);
  }
  function plural(n, one, few, many) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many); }

  function confetti() {
    var c = document.createElement('div'); c.className = 'pet-confetti';
    var colors = ['#ffd23f', '#ff4d6d', '#4dabf7', '#18a058', '#a855f7'];
    for (var i = 0; i < 40; i++) {
      var s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.6) + 's';
      s.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      c.appendChild(s);
    }
    document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 3200);
  }

  // ── Вылупление ──────────────────────────────────────────────────────────
  var hatchPick = 'kitten';
  function openHatch() {
    loadCatalog().then(function () {
      sheet('<div class="pet-hatch"><b>Кто вылупится?</b><i>Питомец живёт на твоих решениях: каждая верная строка — монета на еду, лечение и наряды.</i>' +
        '<div class="pet-species">' + S.catalog.species.map(function (s) {
          return '<button type="button" class="' + (s.id === hatchPick ? 'on' : '') + '" onclick="PetUI.pickSpecies(\'' + s.id + '\')">' +
            PetArt.render({ species: s.id, state: 'happy', items: S.items, equipped: {} }) + '<span>' + s.name + '</span></button>';
        }).join('') + '</div>' +
        '<input id="pet-hatch-name" maxlength="20" placeholder="Имя питомца" value="Летописчик">' +
        '<button type="button" class="go" onclick="PetUI.hatch()">Вылупить 🥚</button></div>');
    });
  }
  function pickSpecies(id) {
    hatchPick = id;
    var name = $('pet-hatch-name') ? $('pet-hatch-name').value : '';
    openHatch();
    setTimeout(function () { if ($('pet-hatch-name')) $('pet-hatch-name').value = name || 'Летописчик'; }, 0);
  }
  function hatch() {
    var name = $('pet-hatch-name') ? $('pet-hatch-name').value : '';
    var known = (window.state && window.state.stats && window.state.stats.achievements) || [];
    act('/hatch', { species: hatchPick, name: name, knownAchievements: known }, function (st) {
      closeSheet(); confetti(); achSynced = true;
      var g = st.gift || {};
      sheet('<div class="pet-hatch"><div class="pet-try-stage">' + PetArt.render({ species: st.pet.species, state: 'happy', items: S.items, equipped: {} }) + '</div>' +
        '<b>Привет, я ' + esc(st.pet.name) + '!</b><i>Подарок на новоселье: ' + COIN + ' ' + fmt(g.coins) + ' и две тарелки щей' + (g.boxes ? ' · 🧰 ' + g.boxes + ' ' + plural(g.boxes, 'сундук', 'сундука', 'сундуков') + ' за твой стаж' : '') + '.</i>' +
        '<i>Корми меня, лечи и наряжай. Монеты — за каждую решённую строку.</i>' +
        '<button type="button" class="go" onclick="PetUI.closeSheet();PetUI.open(\'care\')">Познакомиться</button></div>');
    });
  }

  // ── Для рейтингов (cloud-sync.js) ───────────────────────────────────────
  // Имя в топе с цветом ника. Всё экранируется здесь — имя задаёт сам ученик.
  function nickHtml(name, style) {
    var safe = esc(name);
    if (!style || !style.color || Number(style.until) < Date.now()) return safe;
    return (style.crown ? '<span class="nick-crown-ico">👑</span>' : '') + '<span class="' + nickClass(style) + '">' + safe + '</span>';
  }
  function miniAvatar(avatar) {
    if (!avatar || !avatar.species || !window.PetArt) return '';
    return '<span class="lb-ava">' + PetArt.render({ species: avatar.species, state: avatar.sick ? 'sick' : 'ok', items: S.items, equipped: avatar.equipped || {}, mini: true, noBg: false }) + '</span>';
  }

  // Вызывается из updateGlobalUI (лобби показалось) — не чаще раза в 20 секунд.
  function onLobby() {
    if (!S.catalog) { loadCatalog().then(function () { refresh(true); }).catch(function () {}); return; }
    refresh(false);
  }

  function onAchievements(ids) { if (ids && ids.length) syncAchievements(ids); }

  window.PetUI = {
    open: open, close: close, tab: function (t) { S.tab = t; renderModal(); },
    shopSlot: function (s) { S.shopSlot = s; renderModal(); }, wardSlot: function (s) { S.wardSlot = s; renderModal(); },
    use: use, buy: buy, toggle: toggle, undressAll: undressAll, tryOn: tryOn, buyWear: buyWear, closeSheet: closeSheet,
    rename: rename, paint: paint, openBox: openBox, wearDrop: wearDrop, openHatch: openHatch, pickSpecies: pickSpecies, hatch: hatch,
    onLobby: onLobby, onAchievements: onAchievements, refresh: refresh, nickHtml: nickHtml, miniAvatar: miniAvatar,
    get state() { return S.state; }, get catalog() { return S.catalog; },
  };
  onLobby();
})();
