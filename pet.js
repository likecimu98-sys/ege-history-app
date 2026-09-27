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

  // version — какой каталог назвал сервер в состоянии кошелька. Если он новее
  // загруженного, берём свежий мимо HTTP-кэша: иначе после выкладки новых вещей
  // надетая обнова минут пять не рисовалась бы (каталог кэшируется на 5 минут).
  function loadCatalog(version) {
    if (S.catalog && (!version || S.catalog.version === version)) return Promise.resolve(S.catalog);
    return fetch(API + '/catalog' + (version ? '?v=' + encodeURIComponent(version) : ''), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cat) {
      S.catalog = cat; S.items = {};
      (cat.items || []).forEach(function (i) { S.items[i.id] = i; });
      (cat.consumables || []).forEach(function (i) { S.items[i.id] = i; });
      (cat.boxes || []).forEach(function (i) { S.items[i.id] = i; });
      return cat;
    });
  }

  function rarityLabel(r) { var f = (S.catalog.rarities || []).find(function (x) { return x.id === r; }); return f ? f.label : r; }
  // Звёзды редкости: ★ обычное … ★★★★★ миф — считываются быстрее цвета рамки.
  var RAR_STARS = { common: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
  function stars(r) { var n = RAR_STARS[r] || 1; return new Array(n + 1).join('★'); }
  function slotLabel(s) { var f = (S.catalog.slots || []).find(function (x) { return x.id === s; }); return f ? f.label : s; }

  // ── Живая сцена питомца ──────────────────────────────────────────────────
  // Одна «Сцена» на каждое место, где живёт питомец: большая в окне питомца и
  // маленькая в лобби. Сцена НЕ перерисовывает SVG, пока не изменилось то, что
  // видно (вид, стадия, состояние, одежда, день/ночь): иначе каждое обновление
  // монет обрывало бы моргание, взмах лапой и полёт еды на середине.
  //
  // Что питомец делает сам (idle), зависит от состояния:
  //   спит — сопит; болеет — дрожит и вздыхает; голоден — гладит живот и
  //   просит есть; грустит — вздыхает; в духе — машет, чешется, зевает,
  //   оглядывается, виляет хвостом, пританцовывает, иногда делает пируэт
  //   и рассказывает исторический факт.
  var SPECIES_SOUND = { kitten: ['Мур!', 'Мяу!', 'Муррр 💛'], owl: ['Уху!', 'Ух-ух!', 'Уху-у 💛'], hedgehog: ['Фыр!', 'Фыр-фыр!', 'Пых 💛'], dragon: ['Рррр! 🔥', 'Фшшш!', 'Ррр 💛'],
    ghoul: ['zxc', '1000-7…', '993… 986…'], tsar: ['Бог в помощь!', 'Ну-с, учимся?', 'Весьма похвально!'] };
  // Свои реплики у редких видов — иногда вместо общих.
  var SPECIES_SAY = {
    ghoul: ['1000-7… 993… 986…', 'Я просто хочу решить ЕГЭ', 'Мир — это таблица, где все ответы неверны', 'zxc', 'Я гуль. Но историю знаю', 'Тьма внутри. Строки — снаружи'],
    tsar: ['1894 — начало моего царствования. Запомни!', '1905 — Манифест 17 октября. Моя подпись', 'Дома меня звали Ники', 'Хозяин земли Русской — и твоей подготовки', 'Ну-с, ещё таблицу?', 'Весьма похвально, сударь!'],
  };
  var FACTS = [
    '862 — призвание варягов. С него всё и началось!',
    '988 — Крещение Руси. Запомнил?',
    '1242 — Ледовое побоище. Бррр, холодно!',
    '1380 — Куликовская битва. Дмитрий Донской — красавчик',
    '1480 — стояние на Угре. Конец ига!',
    '1549 — первый Земский собор',
    '1613 — Михаил Романов на престоле',
    '1703 — Пётр I основал Петербург',
    '1709 — Полтавская битва. Швед, держись!',
    '1762 — манифест о вольности дворянства',
    '1812 — Бородино. Кутузов, я горжусь!',
    '1825 — восстание декабристов на Сенатской',
    '1861 — отмена крепостного права',
    '1905 — Манифест 17 октября',
    '1922 — образован СССР',
    '1941 — началась Великая Отечественная',
    '1945 — Победа! 🎉',
    '1957 — первый спутник. Он у меня в сундуке может быть!',
    '1961 — Гагарин: «Поехали!»',
    '1991 — распад СССР',
  ];
  var SAY = {
    hungry: ['Я голодный… 🍲', 'Щи бы сейчас…', 'Живот урчит!', 'Покормишь? 🥺'],
    sick: ['Мне плохо… 🤒', 'Микстурку бы…', 'Полечи меня…'],
    sad: ['Поиграй со мной!', 'Скучно…', 'Давай поиграем? 🎲'],
    sleep: ['Хррр…', 'Zzz…'],
    ok: ['Решим ещё пару строк?', 'Люблю историю!', 'Как дела?', 'Кто сегодня в топе? Мы!', 'Мне нравится моя одёжка'],
    happy: ['Ура! Всё отлично!', 'Лучший день!', 'Ты мой любимый ученик 💛', 'Я счастлив!'],
    tickle: ['Ахаха, щекотно!', 'Хи-хи-хи! Хватит!', 'Ой-ой, щекотно!'],
    wake: ['Тсс… я сплю 😴', 'Ммм… ещё пять минуток…'],
    full: ['Я сыт! 🙂', 'Больше не лезет!'],
    healthy: ['Я здоров как бык! 💪', 'Лечить нечего!'],
    fed: ['Вкуснотища! 😋', 'Спасибо!', 'Ням-ням!', 'Добавки?'],
    healed: ['Мне лучше! Спасибо!', 'Ожил! 💚'],
    played: ['Ещё! Ещё!', 'Как весело!', 'Ура-а-а!'],
    dressed: ['Мне идёт?', 'Красота!', 'Я модник!', 'Сфоткай меня!'],
    coins: ['Ура, монетки!', 'Ты молодец!', 'Так держать!'],
  };
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function isNightNow() { var h = new Date(Date.now() + 3 * 3600e3).getUTCHours(); return h >= 23 || h < 7; }

  var stages = [];
  function Stage(host, kind) {
    this.host = host; this.kind = kind; this.sig = ''; this.eq = null; this.busy = 0; this.nextIdle = Date.now() + 2500 + Math.random() * 2000;
    this.say$ = document.createElement('div'); this.say$.className = 'pet-say'; host.appendChild(this.say$);
    stages.push(this);
  }
  Stage.prototype.alive = function () { return document.body.contains(this.host) && this.host.offsetParent !== null && document.visibilityState !== 'hidden'; };
  Stage.prototype.svg = function () { return this.host.querySelector('svg.pet-svg'); };
  Stage.prototype.draw = function (st, opts) {
    opts = opts || {};
    var p = st.pet; if (!p) return;
    var eq = p.sick ? {} : (st.equipped || {});
    var scene = p.night || isNightNow() ? 'night' : 'day';
    var sig = [p.species, p.stage, p.state, p.sick, JSON.stringify(eq), scene, S.catalog && S.catalog.version].join('|');
    if (sig === this.sig && !opts.force) return;
    var prevEq = this.eq;
    this.sig = sig; this.eq = eq;
    var old = this.svg();
    var holder = document.createElement('div');
    holder.innerHTML = PetArt.render({ species: p.species, stage: p.stage, state: p.state, items: S.items, equipped: eq, sick: p.sick, label: p.name, scene: scene, styleIcon: !!st.styleIcon });
    var svg = holder.firstChild;
    if (old) this.host.replaceChild(svg, old); else this.host.insertBefore(svg, this.host.firstChild);
    // Надели новую вещь — она «вспыхивает» на месте и из-под неё облачко.
    if (prevEq) {
      var self = this;
      Object.keys(eq).forEach(function (slot) {
        if (eq[slot] !== prevEq[slot]) {
          var g = svg.querySelector('.slot-' + slot);
          if (g) g.classList.add('pop-in');
          self.poof(SLOT_AT[slot] || [50, 50]);
        }
      });
    }
  };
  // Где на рисунке (в процентах сцены) какая часть тела — для частиц и еды.
  var SLOT_AT = { head: [50, 26], face: [50, 45], neck: [50, 66], body: [50, 76], hand: [73, 70], pet: [17, 86], aura: [50, 50], bg: [50, 50] };
  var MOUTH = [50, 55];
  Stage.prototype.act = function (name, ms) {
    var svg = this.svg(); if (!svg) return;
    var cls = name === 'eating' ? 'eating' : 'act-' + name;
    svg.classList.remove(cls); void svg.getBoundingClientRect(); svg.classList.add(cls);
    var self = this;
    this.busy = Date.now() + (ms || 1600);
    setTimeout(function () { var s = self.svg(); if (s) s.classList.remove(cls); }, ms || 1600);
  };
  Stage.prototype.jump = function () { this.act('hop', 650); };
  Stage.prototype.say = function (text, ms) {
    var el = this.say$; if (!el || !text) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._sayT);
    this._sayT = setTimeout(function () { el.classList.remove('on'); }, ms || 2600);
  };
  // Частица: эмодзи или число, взлетает от точки [x%, y%].
  Stage.prototype.fx = function (content, at, opts) {
    opts = opts || {};
    var el = document.createElement('span');
    el.className = 'pet-fx' + (opts.num ? ' num' : '');
    if (opts.html) el.innerHTML = content; else el.textContent = content;
    el.style.left = 'calc(' + at[0] + '% - 10px)';
    el.style.top = 'calc(' + at[1] + '% - 12px)';
    el.style.setProperty('--dx', (opts.dx != null ? opts.dx : (Math.random() * 40 - 20)) + 'px');
    el.style.setProperty('--dy', (opts.dy != null ? opts.dy : -50 - Math.random() * 20) + 'px');
    if (opts.delay) el.style.animationDelay = opts.delay + 'ms';
    this.host.appendChild(el);
    setTimeout(function () { el.remove(); }, 1300 + (opts.delay || 0));
  };
  Stage.prototype.burst = function (content, at, n) {
    for (var i = 0; i < (n || 5); i++) {
      var a = Math.PI * 2 * i / (n || 5) - Math.PI / 2;
      this.fx(content, at, { dx: Math.cos(a) * 44, dy: Math.sin(a) * 38 - 18, delay: i * 40 });
    }
  };
  Stage.prototype.poof = function (at) {
    for (var i = 0; i < 7; i++) {
      var el = document.createElement('span'); el.className = 'pet-poof';
      el.style.left = at[0] + '%'; el.style.top = at[1] + '%';
      var a = Math.PI * 2 * i / 7;
      el.style.setProperty('--dx', (Math.cos(a) * 26) + 'px'); el.style.setProperty('--dy', (Math.sin(a) * 22) + 'px');
      this.host.appendChild(el);
      setTimeout(function (e) { return function () { e.remove(); }; }(el), 700);
    }
  };
  // Взгляд: зрачки к точке экрана (или прямо, если null).
  Stage.prototype.look = function (x, y) {
    var svg = this.svg(); if (!svg) return;
    if (x == null) { svg.style.setProperty('--lx', '0px'); svg.style.setProperty('--ly', '0px'); return; }
    var r = this.host.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    var dx = Math.max(-1, Math.min(1, (x - cx) / Math.max(120, r.width)));
    var dy = Math.max(-1, Math.min(1, (y - cy) / Math.max(120, r.height)));
    svg.style.setProperty('--lx', (dx * 3.6).toFixed(2) + 'px');
    svg.style.setProperty('--ly', (dy * 3).toFixed(2) + 'px');
  };
  // Полёт еды/лекарства от кнопки ко рту.
  Stage.prototype.fly = function (emoji, fromEl, done) {
    var r0 = fromEl ? fromEl.getBoundingClientRect() : null;
    var r1 = this.host.getBoundingClientRect();
    var tx = r1.left + r1.width * MOUTH[0] / 100, ty = r1.top + r1.height * MOUTH[1] / 100;
    if (!r0 || !r1.width) { if (done) done(); return; }
    var el = document.createElement('div'); el.className = 'pet-fly'; el.textContent = emoji;
    el.style.left = (r0.left + r0.width / 2 - 16) + 'px'; el.style.top = (r0.top + r0.height / 2 - 18) + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.transform = 'translate(' + (tx - r0.left - r0.width / 2) + 'px,' + (ty - r0.top - r0.height / 2) + 'px) scale(.55)';
      el.style.opacity = '0';
    });
    setTimeout(function () { el.remove(); if (done) done(); }, 640);
  };

  function mySigs() {
    var st = S.state; if (!st || !st.pet || st.pet.sick || !window.PetArt || !PetArt.signatures) return [];
    return PetArt.signatures(st.equipped || {}, S.items);
  }
  // Фирменное действие легенды: своё движение + частицы от самой вещи + реплика.
  // Частицы — цветные кусочки, а не эмодзи: новые эмодзи на Windows 10 и старых
  // телефонах рисуются пустыми квадратами (так было с «бревном» у бензопилы).
  Stage.prototype.sigAct = function (sig, big) {
    if (Math.random() < 0.45) {
      this.act(sig.act, 1800);
      if (sig.fx) this.chips(sig.fx, 10);
      if (big || Math.random() < 0.3) this.say(pick(sig.say), 2400);
    } else {
      this.act(pick(['wave', 'look', 'tail', 'hop']), 1600);
    }
  };
  Stage.prototype.chips = function (fx, n) {
    var self = this;
    for (var i = 0; i < n; i++) (function (i) {
      setTimeout(function () {
        var el = document.createElement('span');
        el.className = 'pet-chip';
        el.style.left = fx.at[0] + '%'; el.style.top = fx.at[1] + '%';
        el.style.background = fx.colors[i % fx.colors.length];
        var dx = fx.dx[0] + Math.random() * (fx.dx[1] - fx.dx[0]);
        var dy = fx.dy[0] + Math.random() * (fx.dy[1] - fx.dy[0]);
        el.style.setProperty('--dx', dx.toFixed(0) + 'px'); el.style.setProperty('--dy', dy.toFixed(0) + 'px');
        el.style.setProperty('--r', (Math.random() * 360).toFixed(0) + 'deg');
        self.host.appendChild(el);
        setTimeout(function () { el.remove(); }, 900);
      }, i * 60);
    })(i);
  };

  // Что питомец делает сам, пока на него смотрят.
  Stage.prototype.idle = function () {
    var st = S.state; if (!st || !st.pet) return;
    var p = st.pet, big = this.kind === 'modal';
    var r = Math.random();
    if (p.state === 'sleep') { if (big && r < 0.3) this.say(pick(SAY.sleep), 1800); return; }
    if (p.state === 'sick') { this.act(r < 0.5 ? 'shiver' : 'sigh', 1900); if (r < (big ? 0.5 : 0.25)) this.say(pick(SAY.sick)); return; }
    if (p.state === 'hungry') { this.act('rub', 2100); if (r < (big ? 0.6 : 0.3)) this.say(pick(SAY.hungry)); return; }
    if (p.state === 'sad') { this.act('sigh', 1900); if (r < (big ? 0.5 : 0.25)) this.say(pick(SAY.sad)); return; }
    var acts = ['wave', 'scratch', 'look', 'tail', 'ears', 'look', 'hop'];
    if (p.state === 'happy') acts.push('dance', 'dance', 'wave');
    // Легендарная вещь даёт своё движение — и оно частое: это и есть «видно, что круто».
    var sig = mySigs().filter(function (x) { return x.act; })[0];
    if (sig) { this.sigAct(sig, big); return; }
    var h = new Date(Date.now() + 3 * 3600e3).getUTCHours();
    if (h >= 21 || h < 9) acts.push('yawn', 'yawn');
    if (Math.random() < 0.08) acts.push('spin');
    var a = pick(acts);
    if (a === 'look') { var self = this, svg = this.svg(); if (!svg) return;
      svg.style.setProperty('--lx', '-3.4px'); setTimeout(function () { svg.style.setProperty('--lx', '3.4px'); }, 700);
      setTimeout(function () { self.look(null); }, 1400); this.busy = Date.now() + 1500;
    } else if (a === 'hop') { this.jump(); this.busy = Date.now() + 800; }
    else this.act(a, a === 'yawn' ? 1800 : a === 'dance' ? 2300 : a === 'spin' ? 900 : 1900);
    if (big && Math.random() < 0.3) {
      var own = SPECIES_SAY[p.species];
      this.say(own && Math.random() < 0.45 ? pick(own) : Math.random() < 0.55 ? pick(FACTS) : pick(SAY[p.state] || SAY.ok), 3600);
    }
  };

  // Общий такт: раз в полсекунды решаем, не пора ли кому-то что-то сделать.
  setInterval(function () {
    var now = Date.now();
    stages = stages.filter(function (s) { return document.body.contains(s.host); });
    stages.forEach(function (s) {
      if (!s.alive() || now < s.busy || now < s.nextIdle) return;
      s.nextIdle = now + (s.kind === 'modal' ? 4200 : 7000) + Math.random() * 4000;
      try { s.idle(); } catch (_) {}
    });
  }, 500);
  // Глаза следят за пальцем/мышью.
  var lookRaf = 0, lookX = null, lookY = null;
  document.addEventListener('pointermove', function (e) {
    lookX = e.clientX; lookY = e.clientY;
    if (lookRaf) return;
    lookRaf = requestAnimationFrame(function () {
      lookRaf = 0;
      stages.forEach(function (s) { if (s.alive() && Date.now() > s.busy) s.look(lookX, lookY); });
    });
  }, { passive: true });
  document.addEventListener('pointerleave', function () { stages.forEach(function (s) { s.look(null); }); });


  // ── Состояние ───────────────────────────────────────────────────────────
  function refresh(force) {
    if (S.loading) return Promise.resolve(S.state);
    if (!force && Date.now() - S.lastFetch < 20000) return Promise.resolve(S.state);
    S.loading = true;
    return loadCatalog().then(function () { return api('/'); }).then(function (st) {
      return loadCatalog(st && st.catalogVersion).then(function () { return st; });
    }).then(function (st) {
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
    if (st && Array.isArray(st.events)) { announce(st.events, prev); celebrateLevels(st.events); }
    if (st && st.hatched) showNoticeOnce(st);
    if (st && st.hatched) syncAchievements();
    renderWidget();
    if (isOpen()) renderModal();
  }

  function itemsText(items) {
    return (items || []).map(function (x) { var it = S.items[x[0]]; return (x[1] > 1 ? x[1] + ' × ' : '') + (it ? it.name : x[0]); }).join(', ');
  }
  function announce(events) {
    var total = 0, capped = 0, boosted = false;
    events.forEach(function (e) {
      if (e.reason !== 'level') total += Number(e.delta) || 0;
      if (e.reason === 'cap') capped = e.lost;
      if (e.boosted) boosted = true;
    });
    if (total > 0) {
      floatCoins(total);
      var stg = widgetStage || modalStage;
      if (stg) setTimeout(function () { stg.act('dance', 2200); stg.say('+' + fmt(total) + '! ' + pick(SAY.coins), 2400); stg.burst('⭐', [50, 45], 5); }, 400);
      toast('💰', '+' + fmt(total) + ' монет' + (boosted ? ' · ⚡×1,5' : ''), 'gold');
    }
    var delay = 2200;
    events.forEach(function (e) {
      var msg = null;
      if (e.reason === 'quest') msg = ['🎯', 'Задание дня: ' + e.text + ' · +' + e.delta];
      if (e.reason === 'quests_all') msg = ['🧰', 'Все задания дня выполнены — сундук в кладовой!'];
      if (e.reason === 'freeze') msg = ['🧊', 'Заморозка спасла твою серию входов!'];
      if (e.reason === 'login') msg = ['🔥', 'Серия ' + e.streak + ' дн.! В кладовой: ' + itemsText(e.items) + (e.fragment ? ' + осколок Фаберже' : '')];
      if (msg) { setTimeout(function () { toast(msg[0], msg[1], 'gold'); }, delay); delay += 2300; }
    });
    if (capped) setTimeout(function () { toast('⛔', 'Дневной потолок монет достигнут — завтра снова', 'warn'); }, delay);
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

  var widgetStage = null;
  function statusLine(st) {
    var p = st.pet;
    var line = STATE_TEXT[p.state] || '';
    if (p.state === 'hungry' || (p.sat < 35 && p.state !== 'sleep')) {
      var shchi = S.items.food_shchi;
      var need = shchi ? shchi.price - st.balance : 0;
      line = need > 0 ? 'Голодный · на щи нужно ещё ' + need + ' строк' : 'Проголодался — покорми';
    }
    return line;
  }
  function renderWidget() {
    recheckAchievements();
    var host = mountWidget(); if (!host) return;
    var st = S.state;
    if (!st || !S.catalog) { host.innerHTML = ''; widgetStage = null; return; }
    if (!st.hatched) {
      widgetStage = null;
      if (!eligible() || !st.canHatch) { host.innerHTML = ''; return; }
      host.innerHTML = '<button type="button" class="petw petw-egg" onclick="PetUI.openHatch()">' +
        '<span class="petw-ava egg-wobble">' + eggSvg() + '</span>' +
        '<span class="petw-txt"><b>Из летописи что-то вылупляется…</b><i>Нажми — у тебя появится питомец' +
        (st.balance ? ' · его уже ждут ' + fmt(st.balance) + ' монет' : '') + '</i></span>' +
        '<span class="petw-go">›</span></button>';
      return;
    }
    var p = st.pet;
    // Каркас виджета строим один раз: сцена внутри живёт своей жизнью, и
    // перестраивать её на каждое обновление монет — значит обрывать анимации.
    if (!widgetStage || !host.contains(widgetStage.host)) {
      host.innerHTML = '<button type="button" class="petw" onclick="PetUI.widgetTap(event)">' +
        '<span class="petw-ava" id="petw-ava"></span>' +
        '<span class="petw-txt"><b id="petw-name"></b><i id="petw-line"></i><span class="petw-bars" id="petw-bars"></span></span>' +
        '<span class="petw-coins" id="petw-coins"></span></button>';
      widgetStage = new Stage($('petw-ava'), 'widget');
    }
    host.firstChild.className = 'petw st-' + p.state;
    $('petw-name').innerHTML = esc(p.name) + '<span class="petw-lv">ур. ' + p.level + '</span>';
    var extras = [];
    if (st.boostUntil && st.boostUntil > Date.now()) extras.push('⚡ ускоритель');
    if (st.daily && st.daily.spinReady) extras.push('🎡 колесо ждёт');
    var q = st.quests && st.quests.list && st.quests.list.find(function (x) { return !x.done; });
    if (q) extras.push('🎯 ' + q.progress + '/' + q.target);
    $('petw-line').textContent = statusLine(st) + (extras.length ? ' · ' + extras.join(' · ') : '');
    $('petw-bars').innerHTML = bar('Сытость', p.sat, 'b-sat') + bar('Настроение', p.mood, 'b-mood') + bar('Здоровье', p.health, 'b-hp');
    $('petw-coins').innerHTML = COIN + ' ' + fmt(st.balance);
    widgetStage.draw(st);
    newsLine(host);
  }

  // Тап по виджету: питомец откликается и открывается его окно.
  function widgetTap() {
    if (widgetStage && S.state && S.state.pet) {
      var p = S.state.pet;
      widgetStage.act(p.state === 'sleep' ? 'ears' : 'giggle', 600);
      widgetStage.say(p.state === 'sleep' ? pick(SAY.wake) : pick(SPECIES_SOUND[p.species] || SPECIES_SOUND.kitten), 1200);
    }
    haptic('light');
    setTimeout(function () { open(); }, 260);
  }

  function eggSvg() {
    return '<svg viewBox="0 0 100 100" class="pet-egg"><ellipse cx="50" cy="56" rx="30" ry="38" fill="#fff4dc" stroke="#2b2233" stroke-width="3"/>' +
      '<path d="M26 50 l8 -6 8 6 8 -6 8 6 8 -6 8 6" fill="none" stroke="#e0a458" stroke-width="3"/><circle cx="40" cy="68" r="4" fill="#f4a259"/><circle cx="60" cy="76" r="3" fill="#6cc070"/><circle cx="58" cy="36" r="3" fill="#a0785a"/></svg>';
  }

  // ── Экран питомца ───────────────────────────────────────────────────────
  var modalStage = null;
  function ensureModal() {
    if ($('pet-modal')) return $('pet-modal');
    var m = document.createElement('div');
    m.id = 'pet-modal';
    m.className = 'pet-modal hidden';
    // Сцена — постоянный узел: её не трогает перерисовка остального окна.
    m.innerHTML = '<div class="pet-sheet" role="dialog" aria-label="Питомец">' +
      '<div id="pet-headbox"></div>' +
      '<div class="pet-stage" id="pet-stage" title="Погладь меня"></div>' +
      '<div id="pet-sheet-body"></div></div>';
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    document.body.appendChild(m);
    modalStage = new Stage($('pet-stage'), 'modal');
    $('pet-stage').addEventListener('click', tapPet);
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
    refresh(true).then(function () {
      if (!guideSeen() && S.state && S.state.pet && !$('pet-sub')) setTimeout(function () { guide(0); }, 900);
    });
    // Встречает хозяина.
    setTimeout(function () {
      if (!modalStage || !S.state || !S.state.pet) return;
      var p = S.state.pet;
      if (p.state === 'sleep') return modalStage.say(pick(SAY.sleep));
      if (p.state === 'hungry' || p.state === 'sick' || p.state === 'sad') return modalStage.say(pick(SAY[p.state]));
      var myth = mySigs().filter(function (x) { return x.tier === 'mythic'; })[0];
      if (myth) {
        var sv = modalStage.svg(); if (sv) { sv.classList.remove('sig-enter'); void sv.getBoundingClientRect(); sv.classList.add('sig-enter'); }
        modalStage.burst('✨', [50, 40], 8);
        modalStage.say(myth.say[0], 3000);
        return;
      }
      modalStage.act('wave', 1700);
      modalStage.say(pick(['Привет!', 'О, ты пришёл!', 'Я скучал!', 'Привет-привет!']));
    }, 350);
  }
  function close() {
    var m = $('pet-modal'); if (!m) return;
    m.classList.remove('open');
    setTimeout(function () { m.classList.add('hidden'); }, 220);
    if (typeof window.popBackHandler === 'function') window.popBackHandler('modal:pet');
  }

  var TABS = [['care', 'Уход'], ['yard', 'Двор'], ['wardrobe', 'Гардероб'], ['shop', 'Лавка'], ['boxes', 'Сундуки'], ['stable', 'Питомник'], ['nick', 'Ник']];

  function renderModal() {
    var body = $('pet-sheet-body'); if (!body) return;
    var st = S.state;
    if (!st || !st.hatched || !S.catalog) { $('pet-headbox').innerHTML = ''; body.innerHTML = '<div class="pet-empty">Загружаем питомца…</div>'; return; }
    var p = st.pet;
    var daily = st.daily || {};
    var lvlSpan = Math.max(1, p.xpTo - p.xpFrom), lvlIn = Math.max(0, p.xp - p.xpFrom);
    $('pet-headbox').innerHTML = '<div class="pet-head">' +
      '<button type="button" class="pet-name" onclick="PetUI.rename()">' + esc(p.name) + ' <span>✎</span></button>' +
      '<span class="pet-coins">' + COIN + ' ' + fmt(st.balance) + '</span>' +
      '<button type="button" class="pet-x pet-help" onclick="PetUI.guide(0)" aria-label="Как всё устроено">?</button>' +
      '<button type="button" class="pet-x" onclick="PetUI.close()" aria-label="Закрыть">×</button></div>' +
      '<div class="pet-level"><b>' + esc(p.stageName) + ' · ' + p.level + ' ур.</b>' + bar('Опыт', Math.round(lvlIn / lvlSpan * 100), '') +
      '<span>' + fmt(lvlIn) + ' / ' + fmt(lvlSpan) + '</span></div>';
    modalStage.draw(st);
    var need = needs(st);
    body.innerHTML =
      '<div class="pet-grow">' + (p.nextStage ? 'На ' + p.nextStage.level + '-м уровне ' + esc(p.name) + ' вырастет: станет «' + esc(p.nextStage.name) + '»' : esc(p.name) + ' — мудрец. Выше только звёзды ✨') + '</div>' +
      roundCard(st) +
      '<div class="pet-quick">' +
        quickBtn('feed', '🍲', 'Покормить', need.feed) + quickBtn('heal', '💊', 'Лечить', need.heal) +
        quickBtn('play', '🎲', 'Играть', need.play) + quickBtn('tap', '✋', 'Погладить', false) +
      '</div>' +
      '<div class="pet-stats mini">' +
        statRow('🍲', 'Сытость', p.sat, 'b-sat') + statRow('😊', 'Настроение', p.mood, 'b-mood') + statRow('❤️', 'Здоровье', p.health, 'b-hp') +
      '</div>' +
      todayFold(st, daily) +
      '<div class="pet-tabs">' + TABS.map(function (t) { return '<button type="button" class="' + (S.tab === t[0] ? 'on' : '') + '" onclick="PetUI.tab(\'' + t[0] + '\')">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<div class="pet-pane">' + pane() + '</div>';
  }

  // Сколько за что — прямо из каталога, чтобы текст не разъезжался со ставками.
  function ratesText() {
    var r = (S.catalog.economy || {}).rates || {};
    return 'Строка — ' + r.solved + ' · выученный факт — ' + r.facts + ' · балл пробника — ' + r.mockPoints +
      ' (+' + r.mocksDone + ' за пробник) · балл ФИПИ — ' + r.fipiPoints + ' · победа в дуэли — ' + r.duelWins +
      ' · домашка в срок — ' + r.hwOnTime + ' монет';
  }

  // «Сегодня»: колесо, серия входов, ускоритель и задания дня — поводы решать сейчас.
  function dayPanel(st) {
    var d = st.daily || {}, q = st.quests, now = Date.now();
    var inv = st.inventory || {};
    var boost = st.boostUntil && st.boostUntil > now
      ? '<button type="button" class="pet-day-chip on" disabled>⚡ <span data-boost-until="' + st.boostUntil + '">' + clock(st.boostUntil - now) + '</span></button>'
      : '<button type="button" class="pet-day-chip" onclick="PetUI.boost(this)">⚡ Ускоритель' + (inv.boost_elixir ? ' ×' + inv.boost_elixir : ' · ' + COIN + ' 250') + '</button>';
    var streakDots = '';
    var goal = d.nextChest || 3;
    var from = Math.max(0, goal - 7);
    for (var i = from + 1; i <= goal; i++) streakDots += '<i class="' + (i <= d.loginStreak ? 'on' : '') + (i === goal ? ' chest' : '') + '"></i>';
    var html = '<div class="pet-day">' +
      '<div class="pet-day-row">' +
        (d.spinReady ? '<button type="button" class="pet-day-chip hot" onclick="PetUI.openWheel()">🎡 Крутить колесо</button>' : '<button type="button" class="pet-day-chip" disabled>🎡 Завтра снова</button>') +
        boost +
      '</div>' +
      '<div class="pet-streak"><b>🔥 Серия входов: ' + (d.loginStreak || 0) + ' дн.</b><span class="dots">' + streakDots + '</span>' +
        '<small>' + (goal - (d.loginStreak || 0) > 0 ? 'до сундука ' + (goal - d.loginStreak) + ' дн.' : 'сундук сегодня!') + (inv.streak_freeze ? ' · 🧊 заморозка есть' : '') + '</small></div>';
    if (q && q.list) {
      html += '<div class="pet-quests"><b>🎯 Задания дня' + (q.allDone ? ' — все выполнены!' : ' · за все три — сундук') + '</b>' + q.list.map(function (it) {
        var pct = Math.round(it.progress / Math.max(1, it.target) * 100);
        return '<button type="button" class="pet-quest' + (it.done ? ' done' : '') + '"' + (it.done ? ' disabled' : ' onclick="PetUI.questGo(\'' + it.kind + '\')"') + '><span>' + (it.done ? '✅ ' : '') + esc(it.text) + (it.done ? '' : ' ›') + '</span>' +
          '<span class="petw-bar"><span style="width:' + Math.max(4, pct) + '%"></span></span><em>' + it.progress + '/' + it.target + ' · +' + it.reward + '</em></button>';
      }).join('') + '</div>';
    }
    return html + '</div>';
  }
  // «Ежедневный круг»: четыре шага, каждый — кнопка туда, где его сделать.
  var ROUND_STEPS = {
    spin: { ico: '🎡', text: 'Колесо удачи', go: 'PetUI.openWheel()' },
    quests: { ico: '🎯', text: '3 задания дня', go: 'PetUI.questGo()' },
    votes: { ico: '⚔️', text: '«Кто круче?»', go: 'PetUI.battle()' },
    react: { ico: '🔥', text: 'Реакция в топе', go: 'PetUI.openTop()' },
  };
  function roundCard(st) {
    var r = st.round; if (!r || !r.steps) return '';
    var n = r.steps.filter(function (x) { return x.done; }).length;
    var head = r.claimed ? '✅ Круг пройден — сундук твой. Завтра новый!'
      : r.done ? '🎁 Круг пройден — забирай сундук!'
      : '🔄 Ежедневный круг · ' + n + '/4 — за все шаги сундук';
    var steps = r.steps.map(function (x) {
      var m = ROUND_STEPS[x.id] || {};
      var label = m.text + (x.target ? ' · ' + (x.progress || 0) + '/' + x.target : '');
      return '<button type="button" class="pet-round-step' + (x.done ? ' done' : '') + '"' + (x.done ? ' disabled' : ' onclick="' + m.go + '"') + '>' +
        '<span>' + (x.done ? '✅' : m.ico) + '</span>' + esc(label) + (x.done ? '' : '<em>›</em>') + '</button>';
    }).join('');
    return '<div class="pet-round' + (r.done && !r.claimed ? ' ready' : '') + '"><b>' + head + '</b>' +
      (r.claimed ? '' : '<div class="pet-round-grid">' + steps + '</div>') +
      (r.done && !r.claimed ? '<button type="button" class="go" onclick="PetUI.claimRound()">Забрать сундук 🧰</button>' : '') +
      (r.streak > 1 ? '<small>Кругов подряд: ' + r.streak + '</small>' : '') + '</div>';
  }
  function claimRound() {
    act('/round', {}, function (st) {
      confetti(); toast('🧰', 'Сундук летописца — в кладовой! Открой во вкладке «Сундуки»', 'gold');
      var rr = st.roundReward || {};
      if (rr.fragment) setTimeout(function () { toast('🖤', rr.streak + ' кругов подряд — осколок тьмы! Собери 6 — и у тебя Гуль', 'gold'); }, 1600);
    });
  }
  // Задание дня → прямо в задание. Без kind — первое невыполненное.
  var QUEST_GO = {
    duelGames: function () { if (window.startDuelSearch) window.startDuelSearch(); },
    duelWins: function () { if (window.startDuelSearch) window.startDuelSearch(); },
    fipiPoints: function () { if (window.openExamMode) window.openExamMode(); },
    mocksDone: function () { if (window.openExamMode) window.openExamMode(); },
  };
  function questGo(kind) {
    var q = S.state && S.state.quests;
    if (!kind && q && q.list) { var first = q.list.find(function (x) { return !x.done; }); kind = first ? first.kind : 'solved'; }
    close();
    setTimeout(function () {
      var fn = QUEST_GO[kind];
      if (fn) fn(); else if (window.mainActionGo) window.mainActionGo();
    }, 260);
  }
  function openTop() {
    close();
    if (typeof window.openGlobalTopModal === 'function') window.openGlobalTopModal('weekly');
  }
  // Ответы голоса и реакции несут свежий круг — подставляем его без перезапроса.
  function takeRound(r) {
    if (r && r.round && S.state) { S.state.round = r.round; if (isOpen()) renderModal(); }
  }

  // ── Питомец рядом во время решения ─────────────────────────────────────────
  // Вся идея — «решаю, и моему питомцу хорошо». Раньше это было видно только в
  // лобби, всплывашкой; теперь на каждый верный ответ питомец выскакивает в
  // углу экрана задания, радуется и показывает монеты. Тапы проходят сквозь
  // него — мешать решению он не должен. Цифра монет — оценка по ставке каталога
  // (сервер начислит по счётчикам профиля при следующем заходе в лобби).
  var buddy = { el: null, hide: 0, lines: 0 };
  var BUDDY_SAY = ['Ням! Сытость растёт', 'Так держать!', 'Ещё строчку!', 'Копим на обновку 😎', 'Я расту!', 'Умница!', 'Вкусно решаешь!'];
  function gameBuddy(n) {
    var st = S.state;
    if (!st || !st.hatched || !st.pet || !S.catalog || isOpen() || !window.PetArt) return;
    if (!buddy.el) {
      buddy.el = document.createElement('div');
      buddy.el.className = 'pet-game-buddy';
      buddy.el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(buddy.el);
    }
    var eq = st.pet.sick ? {} : (st.equipped || {});
    var sig = [st.pet.species, st.pet.stage, st.pet.sick, JSON.stringify(eq), !!st.styleIcon].join('|');
    if (buddy.el._sig !== sig) {
      buddy.el.innerHTML = '<div class="pgb-art">' + PetArt.render({ species: st.pet.species, stage: st.pet.stage, state: 'happy', items: S.items, equipped: eq, mini: true, styleIcon: !!st.styleIcon }) + '</div>';
      buddy.el._sig = sig;
    }
    var rates = (S.catalog.economy || {}).rates || {};
    var boost = st.boostUntil && st.boostUntil > Date.now() ? 1.5 : 1;
    var d = st.daily || {};
    var coins = Math.round(n * (rates.solved || 2) * boost);
    if (d.cap && d.earned >= d.cap) coins = 0;
    if (coins) { d.earned = (d.earned || 0) + coins; st.balance = (st.balance || 0) + coins; }
    st.pet.sat = Math.min(100, (st.pet.sat || 0) + n * 0.4);
    var el = buddy.el;
    el.classList.remove('hop'); void el.offsetWidth; el.classList.add('show', 'hop');
    if (coins) {
      var f = document.createElement('span'); f.className = 'pgb-coin'; f.innerHTML = '+' + coins + ' ' + COIN;
      el.appendChild(f); setTimeout(function () { f.remove(); }, 1300);
    }
    var before = buddy.lines; buddy.lines += n;
    var old = el.querySelector('.pgb-say'); if (old) old.remove();
    if (Math.floor(before / 10) !== Math.floor(buddy.lines / 10) || before === 0) {
      var b = document.createElement('span'); b.className = 'pgb-say';
      if (before === 0) b.innerHTML = esc(st.pet.name || '') + ' рядом! +' + (rates.solved || 2) + ' ' + COIN + ' за строку'; else b.textContent = pick(BUDDY_SAY);
      el.appendChild(b); setTimeout(function () { b.remove(); }, 2600);
    }
    clearTimeout(buddy.hide);
    buddy.hide = setTimeout(function () { el.classList.remove('show'); }, 5000);
  }
  window.addEventListener('pet:solved', function (e) { try { gameBuddy(Math.max(1, Number(e.detail && e.detail.n) || 1)); } catch (_) {} });

  // ── Микро-гайд: пять карточек, один раз после знакомства и по кнопке «?» ──
  var GUIDE_KEY = 'pet_guide_v3';
  function guideSlides() {
    var st = S.state || {}, p = st.pet || {};
    var r = (S.catalog && S.catalog.economy && S.catalog.economy.rates) || {};
    var drops = (S.catalog && S.catalog.rareSpeciesDrops) || {};
    var art = function (opts) { return '<div class="pet-guide-art">' + PetArt.render(Object.assign({ items: S.items, equipped: {}, state: 'happy', scene: 'day', mini: true }, opts)) + '</div>'; };
    return [
      { art: art({ species: p.species || 'kitten', stage: p.stage || 'baby', equipped: st.equipped || {} }), title: 'Питомец живёт на твоих решениях',
        text: 'Каждая верная строка — ' + (r.solved || 2) + ' монеты, выученный факт — ' + (r.facts || 10) + ', победа в дуэли — ' + (r.duelWins || 30) + '. Решаешь — питомец сыт и растёт: Малыш → Подросток → Взрослый → Мудрец.' },
      { art: '<div class="pet-guide-emoji">🍲 💊 🎲 ✋</div>', title: 'Уход — пара секунд в день',
        text: 'Корми, лечи, играй и гладь. Голодный питомец грустит, а заболевший не носит одежду. Ночью он спит.' },
      { art: '<div class="pet-guide-pair">' + art({ species: 'tsar', stage: 'adult' }) + art({ species: 'squid', stage: 'adult' }) + art({ species: 'ghoul', stage: 'adult' }) + '</div>', title: 'Сундуки и редкие питомцы',
        text: 'В сундуках ' + ((S.catalog && S.catalog.items) || []).length + ' вещей от обычных до мифических. А ещё там живут редкие питомцы: Николай II, Сквидвард и Гуль — лучше всего шансы в Императорском ларце (' + pctText((drops.box_emperor || {}).tsar) + ', ' + pctText((drops.box_emperor || {}).squid) + ' и ' + pctText((drops.box_emperor || {}).ghoul) + '). Их можно собрать и из осколков — смотри «Питомник».',
        go: ['Смотреть сундуки', "PetUI.guideGo('boxes')"] },
      { art: '<div class="pet-guide-emoji">⚔️ 👀 🔥 📣</div>', title: 'Двор: похвастаться и сравнить',
        text: 'Тапни по питомцу в любом топе — откроется его профиль, поставь 🔥 👑 😂 💯. В «Кто круче?» выбирай лучший образ — победитель недели получает 500 монет и корону. Позови друга ссылкой — обоим сундук.',
        go: ['Во двор', "PetUI.guideGo('yard')"] },
      { art: '<div class="pet-guide-emoji">🎡 🎯 ⚔️ 🔥</div>', title: 'Каждый день — круг и сундук',
        text: 'Колесо, три задания дня, 5 голосов и одна реакция — и сундук твой. Заходи подряд: на 3-й, 7-й, 14-й и 30-й день серии — ещё сундуки и ларцы.',
        go: ['Начать круг', "PetUI.guideGo('care')"] },
    ];
  }
  function guide(i) {
    if (!S.catalog || !S.state || !S.state.pet) return;
    var list = guideSlides();
    i = Math.max(0, Math.min(list.length - 1, i || 0));
    var sl = list[i];
    var dots = list.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('');
    sheet('<div class="pet-guide">' + sl.art + '<b>' + esc(sl.title) + '</b><p>' + esc(sl.text) + '</p>' +
      '<div class="pet-guide-dots">' + dots + '</div>' +
      '<div class="pet-guide-nav">' +
        (i > 0 ? '<button type="button" onclick="PetUI.guide(' + (i - 1) + ')">‹ Назад</button>' : '<button type="button" class="pet-link" onclick="PetUI.guideDone()">Пропустить</button>') +
        (i < list.length - 1 ? '<button type="button" class="go" onclick="PetUI.guide(' + (i + 1) + ')">Дальше ›</button>' : '<button type="button" class="go" onclick="PetUI.guideDone()">Понятно!</button>') +
      '</div>' + (sl.go ? '<button type="button" class="pet-link" onclick="' + sl.go[1] + '">' + sl.go[0] + ' →</button>' : '') + '</div>');
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (_) {}
  }
  function guideDone() { closeSheet(); }
  function guideGo(tab) { closeSheet(); open(tab); }
  function guideSeen() { try { return !!localStorage.getItem(GUIDE_KEY); } catch (_) { return true; } }

  // ── Бегущая строка под питомцем в лобби: новости двора и подсказки ─────────
  // Одна строка, меняется раз в 7 секунд; по тапу ведёт к делу.
  function tickerItems() {
    var st = S.state || {}, out = [];
    (S.news || []).slice(0, 3).forEach(function (n) { var t = newsText(n); if (t) out.push({ html: t, go: "PetUI.open('yard')" }); });
    var r = st.round;
    if (st.daily && st.daily.spinReady) out.push({ html: '🎡 Колесо удачи ждёт — одно вращение в день', go: 'PetUI.openWheel()' });
    if (r && !r.claimed) {
      var left = r.steps.filter(function (x) { return !x.done; }).length;
      out.push({ html: r.done ? '🎁 Круг пройден — забери сундук!' : '🔄 Ежедневный круг: осталось ' + left + ' ' + plural(left, 'шаг', 'шага', 'шагов') + ' до сундука', go: "PetUI.open('care')" });
    }
    var v = r && r.steps && r.steps.find(function (x) { return x.id === 'votes'; });
    if (v && !v.done) out.push({ html: '⚔️ «Кто круче?» — выбери образ, за голос опыт', go: 'PetUI.battle()' });
    var owned = {}; if (st.pet) owned[st.pet.species] = 1; (st.stable || []).forEach(function (x) { owned[x.species] = 1; });
    if (!owned.tsar) out.push({ html: '👑 Николай II живёт в Царском ларце — шанс 2%', go: "PetUI.open('stable')" });
    if (!owned.ghoul) out.push({ html: '🖤 Гуль «дед инсайд» — 5% в Царском ларце или 6 осколков тьмы', go: "PetUI.open('stable')" });
    if (!owned.squid) out.push({ html: '🦑 Сквидвард вырастает в Красавчика — 6% в Императорском ларце', go: "PetUI.open('boxes')" });
    out.push({ html: '👀 Тапни по питомцу в топе — профиль и реакции', go: 'PetUI.openTop()' });
    return out;
  }
  var tickerAt = 0;
  function newsLine(host) {
    if (!S.newsAt || Date.now() - S.newsAt > 10 * 60 * 1000) loadNews(false);
    var items = tickerItems(); if (!items.length) return;
    var line = host.querySelector('.petw-news');
    if (!line) { line = document.createElement('button'); line.type = 'button'; line.className = 'petw-news'; host.appendChild(line); }
    var it = items[tickerAt % items.length];
    line.innerHTML = it.html + ' <em>›</em>';
    line.setAttribute('onclick', it.go);
  }
  setInterval(function () {
    var host = document.getElementById('lobby-pet');
    if (!host || !host.querySelector('.petw-news') || document.hidden) return;
    tickerAt++; newsLine(host);
  }, 7000);

  function clock(ms) { var m = Math.max(0, Math.floor(ms / 60000)), sec = Math.max(0, Math.floor(ms / 1000) % 60); return m + ':' + (sec < 10 ? '0' : '') + sec; }
  // Таймер ускорителя тикает сам, без перерисовки окна.
  setInterval(function () {
    var nodes = document.querySelectorAll('[data-boost-until]');
    for (var i = 0; i < nodes.length; i++) {
      var left = Number(nodes[i].getAttribute('data-boost-until')) - Date.now();
      nodes[i].textContent = clock(left);
      if (left <= 0) { refresh(true); }
    }
  }, 1000);

  function boost(el) {
    var st = S.state; if (!st) return;
    var own = (st.inventory || {}).boost_elixir;
    if (!own && st.balance < 250) { toast('⚡', 'На ускоритель нужно 250 монет', 'warn'); return; }
    act('/use', { item: 'boost_elixir', buy: !own }, function () {
      var stg = modalStage; if (stg) { stg.act('dance', 2000); stg.say('⚡ Заряжен! 30 минут ×2 опыта — решаем!', 3200); stg.burst('⚡', [50, 45], 6); }
      toast('⚡', 'Ускоритель на 30 минут: монеты ×1,5, опыт ×2', 'gold');
    });
  }

  // ── Колесо удачи ──────────────────────────────────────────────────────
  function wheelSvg(rot) {
    var W = S.catalog.wheel || [], n = W.length, s = '';
    var colors = ['#f59e0b', '#3b82f6', '#22a35a', '#a855f7', '#ef4444', '#0ea5a4', '#f97316', '#6366f1', '#ec4899', '#eab308'];
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      var x0 = 100 + Math.cos(a0) * 92, y0 = 100 + Math.sin(a0) * 92, x1 = 100 + Math.cos(a1) * 92, y1 = 100 + Math.sin(a1) * 92;
      s += '<path d="M100 100 L' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A92 92 0 0 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'Z" fill="' + colors[i % colors.length] + '" stroke="#fff" stroke-width="2"/>';
      var am = (a0 + a1) / 2, tx = 100 + Math.cos(am) * 64, ty = 100 + Math.sin(am) * 64;
      s += '<text x="' + tx.toFixed(1) + '" y="' + (ty + 5).toFixed(1) + '" text-anchor="middle" font-size="15" font-weight="900" fill="#fff" transform="rotate(' + ((am * 180 / Math.PI) + 90).toFixed(1) + ' ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ')">' + esc(W[i].label) + '</text>';
    }
    return '<svg viewBox="0 0 200 200" class="pet-wheel-svg"><g id="pet-wheel-rot" style="transform-origin:100px 100px;transform:rotate(' + (rot || 0) + 'deg)">' + s + '</g><circle cx="100" cy="100" r="14" fill="#fff" stroke="#1f2330" stroke-width="3"/></svg>';
  }
  function openWheel() {
    sheet('<div class="pet-wheel"><b>🎡 Колесо удачи</b><i>Одно вращение в день. Бывает даже осколок Фаберже или тьмы!</i>' +
      '<div class="pet-wheel-box"><div class="pet-wheel-pin"></div>' + wheelSvg(0) + '</div>' +
      '<div id="pet-wheel-res"></div><button type="button" class="go" id="pet-wheel-go" onclick="PetUI.spin()">Крутить!</button></div>');
  }
  function spin() {
    var btn = $('pet-wheel-go'); if (btn) btn.disabled = true;
    haptic('medium');
    act('/spin', {}, function (st) {
      var r = st.spin; var n = (S.catalog.wheel || []).length || 10;
      // Сектор i — от угла i/n; стрелка сверху. Докручиваем 5 оборотов и ставим центр сектора под стрелку.
      var target = 360 * 5 + (360 - (r.index + 0.5) * (360 / n)) + (Math.random() * 10 - 5);
      var g = $('pet-wheel-rot');
      if (g) { g.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.1,1)'; requestAnimationFrame(function () { g.style.transform = 'rotate(' + target + 'deg)'; }); }
      var ticks = 0, tk = setInterval(function () { if (++ticks < 22) haptic('light'); else clearInterval(tk); }, 180);
      setTimeout(function () {
        clearInterval(tk); haptic('success');
        var prize = r.coins ? '+' + fmt(r.coins) + ' монет' : r.fragment ? (r.fragment === 'dark' ? 'Осколок тьмы! 🖤' : 'Осколок Фаберже! 🥚') : (S.items[r.item] ? S.items[r.item].name : r.item);
        var res = $('pet-wheel-res'); if (res) res.innerHTML = '<div class="pet-wheel-prize">' + esc(prize) + '</div>';
        if (btn) { btn.disabled = false; btn.textContent = 'Забрать'; btn.onclick = function () { closeSheet(); }; }
        if (r.fragment || r.item === 'box_tsar') confetti();
      }, 4300);
    }, function () { if (btn) btn.disabled = false; });
  }

  function itemsNotice(n) {
    var key = 'pet_notice_' + n.at;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { return; }
    setTimeout(function () {
      sheet('<div class="pet-hatch"><b>Вещи стали круче!</b>' +
        '<i>Теперь легенда меняет поведение питомца, а миф превращает его целиком — это видно всем, даже в топе.</i>' +
        '<i>Некоторые легенды стали эпиками, и ты купил такую раньше — возвращаем разницу: <b>+' + fmt(n.diff) + ' монет</b>. Вещь остаётся твоей.</i>' +
        '<button type="button" class="go" onclick="PetUI.closeSheet()">Отлично!</button></div>');
    }, 1200);
  }
  // Питомец объясняет пересчёт экономики — один раз.
  function showNoticeOnce(st) {
    var n = st && st.counters && st.counters.notice;
    if (n && n.kind === 'items4') return itemsNotice(n);
    if (!n || n.kind !== 'rebalance') return;
    var key = 'pet_notice_' + n.at;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { return; }
    setTimeout(function () {
      sheet('<div class="pet-hatch"><b>Экономика обновилась!</b>' +
        '<i>Теперь монеты — за решение, и щедрее: 2 за строку, 10 за выученный факт, 10 за балл пробника, 30 за победу в дуэли. Плюс колесо удачи, серия входов с сундуками и задания дня.</i>' +
        '<i>Ачивки стали приятным бонусом, а не главным доходом — поэтому монеты пересчитаны' + (n.diff ? ' (' + (n.diff > 0 ? '+' : '') + fmt(n.diff) + ')' : '') + '. Всё купленное остаётся твоим.</i>' +
        '<button type="button" class="go" onclick="PetUI.closeSheet()">Понятно, решаем!</button></div>');
    }, 1200);
  }

  function quickBtn(kind, ico, label, needNow) {
    return '<button type="button" id="pq-' + kind + '" class="' + (needNow ? 'need' : '') + '" onclick="PetUI.quick(\'' + kind + '\', this)"><span>' + ico + '</span>' + label + '</button>';
  }
  // Чего питомец хочет прямо сейчас — подсветка кнопок.
  function needs(st) {
    var p = st.pet;
    return { feed: p.sat < 40 && !p.night, heal: p.sick || p.health < 50, play: p.mood < 40 && !p.night };
  }

  function statRow(ico, label, v, cls) {
    return '<div class="pet-stat" title="' + label + '"><span>' + ico + '</span><span class="petw-bar big ' + cls + '"><span style="width:' + Math.max(3, v) + '%"></span></span><b>' + v + '</b></div>';
  }
  // «Сегодня» — колесо, ускоритель, серия, задания дня, заработок. Свёрнуто в
  // одну строку-сводку: самое срочное видно и так, остальное — по тапу.
  function todayFold(st, daily) {
    var d = st.daily || {}, q = st.quests, bits = [];
    if (d.spinReady) bits.push('🎡 колесо ждёт');
    if (st.boostUntil && st.boostUntil > Date.now()) bits.push('⚡ ускоритель');
    bits.push('🔥 ' + (d.loginStreak || 0) + ' дн.');
    if (q && q.list) bits.push('🎯 ' + q.list.filter(function (x) { return x.done; }).length + '/' + q.list.length);
    bits.push(COIN + ' ' + fmt(daily.earned) + ' сегодня');
    return '<div class="pet-today' + (S.todayOpen ? ' open' : '') + '">' +
      '<button type="button" class="pet-today-head" onclick="PetUI.toggleToday()"><b>📅 Сегодня</b><span>' + bits.join(' · ') + '</span><em>' + (S.todayOpen ? '▴' : '▾') + '</em></button>' +
      (S.todayOpen ? dayPanel(st) + '<div class="pet-earn">Сегодня заработано <b>' + fmt(daily.earned) + '</b> из ' + fmt(daily.cap) + ' ' + COIN +
        '<br><span>' + ratesText() + '</span></div>' : '') + '</div>';
  }
  function toggleToday() { S.todayOpen = !S.todayOpen; renderModal(); }

  function pane() {
    if (S.tab === 'wardrobe') return paneWardrobe();
    if (S.tab === 'shop') return paneShop();
    if (S.tab === 'boxes') return paneBoxes();
    if (S.tab === 'nick') return paneNick();
    if (S.tab === 'stable') return paneStable();
    if (S.tab === 'yard') return paneYard();
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
      if (c.kind === 'boost') {
        btn = st.boostUntil > now ? '<button type="button" disabled>действует</button>'
          : own ? '<button type="button" class="go" onclick="PetUI.boost(this)">Выпить</button>' : buyBtn(c.price, 'PetUI.boost(this)');
      } else if (c.kind === 'freeze') {
        btn = own ? '<button type="button" disabled>есть в запасе</button>' : buyBtn(c.price, 'PetUI.buy(\'' + c.id + '\')');
      } else if (c.kind === 'toy') {
        var last = (st.pet.toys || {})[c.id] || 0;
        var ready = last + 3 * 3600 * 1000;
        if (!own) btn = buyBtn(c.price, 'PetUI.buy(\'' + c.id + '\')');
        else if (ready > now) btn = '<button type="button" disabled>через ' + Math.ceil((ready - now) / 60000) + ' мин</button>';
        else btn = '<button type="button" class="go" onclick="PetUI.use(\'' + c.id + '\', false, this)">Играть</button>';
      } else {
        btn = own ? '<button type="button" class="go" onclick="PetUI.use(\'' + c.id + '\', false, this)">' + (c.kind === 'med' ? 'Лечить' : 'Дать') + '</button>'
          : buyBtn(c.price, 'PetUI.use(\'' + c.id + '\', true, this)');
      }
      return '<div class="pet-card"><div class="pet-ico">' + (PetArt.icons[c.id] || '•') + (own && c.kind !== 'toy' ? '<em>×' + own + '</em>' : '') + '</div>' +
        '<b>' + esc(c.name) + '</b><i>' + (c.kind === 'boost' ? '30 минут: монеты ×1,5, опыт ×2' : c.kind === 'freeze' ? 'Спасёт серию входов, если пропустишь день' : fxText(c.fx) + (c.kind === 'toy' ? ' · раз в 3 часа' : '')) + '</i>' + btn + '</div>';
    }).join('') + '</div>';
  }

  // ── Питомник: кто ждёт своей очереди и какие редкие виды можно добыть ──────
  function speciesOf(id) { return (S.catalog.species || []).find(function (x) { return x.id === id; }) || { id: id, name: id }; }
  function pctText(v) { return String(v).replace('.', ',') + '%'; }
  function paneStable() {
    var st = S.state, stable = st.stable || [];
    var owned = {}; owned[st.pet.species] = true; stable.forEach(function (x) { owned[x.species] = true; });
    var mini = function (sp, stage, eq) { return '<span class="pet-item-art">' + PetArt.render({ species: sp, stage: stage, state: 'ok', items: S.items, equipped: eq || {}, mini: true }) + '</span>'; };
    var html = '<div class="pet-hint">В питомнике время стоит: пока питомец отдыхает, он не голодает и не грустит. Опыт и уровень у каждого свои.</div>';
    html += '<div class="pet-grid items">' +
      '<div class="pet-item worn rar-' + (speciesOf(st.pet.species).rare ? 'mythic' : 'common') + '">' + mini(st.pet.species, st.pet.stage, st.equipped) +
        '<b>' + esc(st.pet.name) + '</b><i>' + esc(st.pet.stageName) + ' · ' + st.pet.level + ' ур.</i><span class="pet-tag">Сейчас со мной</span></div>' +
      stable.map(function (x) {
        return '<button type="button" class="pet-item rar-' + (speciesOf(x.species).rare ? 'mythic' : 'common') + '" onclick="PetUI.switchPet(' + x.index + ')">' + mini(x.species, x.stage, x.equipped) +
          '<b>' + esc(x.name) + '</b><i>' + esc(x.stageName) + ' · ' + x.level + ' ур.</i><span class="pet-tag">Выпустить</span></button>';
      }).join('') + '</div>';
    var drops = S.catalog.rareSpeciesDrops || {}, frags = S.catalog.fragments || {}, have = st.fragments || {}, owners = S.catalog.owners || {};
    html += '<div class="pet-rare-list">' + (S.catalog.species || []).filter(function (x) { return x.rare; }).map(function (sp) {
      var f = frags[sp.fragment] || { need: 10, icon: '•', name: '' };
      var n = have[sp.fragment] || 0;
      var n2 = owners['species:' + sp.id];
      var chest = (drops.box_chest || {})[sp.id], tsar = (drops.box_tsar || {})[sp.id];
      var btn = owned[sp.id] ? '<span class="pet-tag">✓ Уже в питомнике</span>'
        : n >= f.need ? '<button type="button" class="go" onclick="PetUI.craft(\'' + sp.id + '\', this)">Собрать из осколков</button>'
        : '<span class="pet-tag">' + f.icon + ' ' + n + ' / ' + f.need + '</span>';
      return '<div class="pet-rare rar-mythic' + (owned[sp.id] ? ' got' : '') + '">' +
        '<span class="pet-rare-art">' + PetArt.render({ species: sp.id, stage: 'adult', state: 'ok', items: S.items, equipped: {}, mini: true }) + '</span>' +
        '<div><b>' + esc(sp.name) + '</b>' +
        '<i>Не продаётся. Сундук — ' + pctText(chest) + ', Царский ларец — ' + pctText(tsar) + ', или собери ' + f.need + ' ' + f.icon + ' ' + plural(f.need, 'осколок', 'осколка', 'осколков') + '.</i>' +
        (f.sources ? '<i>' + f.icon + ' Осколки: ' + esc(f.sources) + '</i>' : '') +
        (n2 != null ? '<i>Есть у ' + n2 + ' ' + plural(n2, 'человека', 'человек', 'человек') + '</i>' : '') +
        '<span class="petw-bar"><span style="width:' + Math.min(100, Math.round(n / f.need * 100)) + '%;background:var(--r-mythic)"></span></span>' + btn + '</div></div>';
    }).join('') + '</div>';
    return html;
  }
  function switchPet(index) {
    act('/switch', { index: index }, function (st) {
      var s = stageNow(); if (s) { s.act('wave', 1500); s.say(pick(SPECIES_SAY[st.pet.species] || ['Я тут!', 'Привет, соскучился!'])); }
    });
  }
  function craft(species) {
    act('/craft', { species: species }, function (st) {
      S.catalog.owners = S.catalog.owners || {};
      if (st.crafted) S.catalog.owners['species:' + species] = st.crafted.owners;
      speciesReveal(species, st.crafted ? st.crafted.owners : null, null);
    });
  }
  // Показ нового редкого питомца — из сундука или из осколков.
  function speciesReveal(species, owners, box) {
    var sp = speciesOf(species);
    var st = S.state, idx = (st.stable || []).findIndex(function (x) { return x.species === species; });
    haptic('heavy');
    try { if (window.Sfx && window.Sfx.play) window.Sfx.play('win'); } catch (_) {}
    var html = '<div class="rl-drop rar-mythic pet-new-species"><div class="rl-flash"></div>' +
      '<div class="rl-art big">' + PetArt.render({ species: species, stage: 'baby', state: 'happy', items: S.items, equipped: {}, scene: 'day' }) + '</div>' +
      '<b>Новый питомец: ' + esc(sp.name) + '!</b><i>' + (species === 'tsar' ? 'Самый редкий вид в игре' : 'Редкий вид') + ' · ' + esc((sp.stages || {}).baby || '') + '</i>' +
      (owners != null ? '<div class="pet-own">Есть всего у ' + owners + ' ' + plural(owners, 'человека', 'человек', 'человек') + '</div>' : '') +
      (idx >= 0 ? '<button type="button" class="go" onclick="PetUI.closeSheet();PetUI.switchPet(' + idx + ')">Выпустить сейчас</button>' : '') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet();PetUI.tab(\'stable\')">Пусть ждёт в питомнике</button></div>';
    if (box) { var res = $('rl-result'); if (res) res.innerHTML = html; } else sheet('<div class="pet-roll">' + html + '</div>');
    confetti();
  }

  // ── Двор: хвастаться без шума ─────────────────────────────────────────────
  // Общей ленты нет: профиль по тапу в топе, «Кто круче?», карточка для друзей и
  // три-пять громких новостей за сутки.
  function paneYard() {
    var st = S.state;
    if (!S.newsAt || Date.now() - S.newsAt > 5 * 60 * 1000) loadNews(true);
    var soc = S.catalog.social || {};
    return '<div class="pet-yard">' +
      '<button type="button" class="pet-yard-btn" onclick="PetUI.battle()"><span>⚔️</span><b>Кто круче?</b><i>Два случайных питомца — выбери образ круче. ' + (soc.battleDaily || 20) + ' голосов в день, за каждый опыт. Лучший образ недели получит ' + fmt((soc.stylePrize || {}).coins || 500) + ' ' + COIN + ' и корону</i></button>' +
      '<button type="button" class="pet-yard-btn" onclick="PetUI.share()"><span>📣</span><b>Похвастаться друзьям</b><i>Картинка с твоим питомцем и ссылкой. Друг вылупит своего — вам обоим по сундуку</i></button>' +
      (st.publicId ? '<button type="button" class="pet-yard-btn" onclick="PetUI.profile(\'' + st.publicId + '\')"><span>👀</span><b>Мой профиль</b><i>Как питомца видят другие и сколько реакций собрал</i></button>' : '') +
      '<div class="pet-news"><b>Новости двора</b>' + newsList() + '</div>' +
      '<div class="pet-hint">Тапни по питомцу в топе — откроется его профиль. Там можно поставить 🔥 👑 😂 💯 — одну реакцию в день.</div>' +
    '</div>';
  }
  function newsText(n) {
    var who = esc(n.who || 'Кто-то'), pet = esc(n.pet || '');
    if (n.kind === 'species') return '🥚 ' + who + ': новый редкий питомец — ' + esc(speciesOf(n.species).name) + (n.crafted ? ' (собран из осколков)' : '') + '!';
    if (n.kind === 'mythic') { var it = S.items[n.item]; return '🔥 ' + who + ': мифическая вещь «' + esc(it ? it.name : n.item) + '»!'; }
    if (n.kind === 'sage') { var sp = speciesOf(n.species); return '✨ ' + who + ': ' + pet + ' — теперь «' + esc((sp.stages || {}).sage || 'Мудрец') + '»'; }
    if (n.kind === 'style') return '👑 Икона стиля недели — ' + pet + ' (' + who + ')';
    return '';
  }
  function newsList() {
    var list = (S.news || []).map(newsText).filter(Boolean);
    if (!list.length) return '<i>Пока тихо. Выбей мифическую вещь или вырасти Мудреца — и про тебя узнает весь двор.</i>';
    return list.map(function (t) { return '<div>' + t + '</div>'; }).join('');
  }
  function loadNews(rerender) {
    S.newsAt = Date.now();
    return api('/news').then(function (r) {
      S.news = (r && r.news) || [];
      if (rerender && isOpen() && S.tab === 'yard') renderModal();
      var host = mountWidget(); if (host && S.state && S.state.hatched) newsLine(host);
    }).catch(function () {});
  }

  // Профиль питомца: свой или чужой (из топа).
  var REACT_LABEL = { '🔥': 'Огонь', '👑': 'Король', '😂': 'Ору', '💯': 'Сотка' };
  function profile(publicId) {
    loadCatalog().then(function () { return api('/profile/' + encodeURIComponent(publicId)); }).then(function (r) {
      S.profile = r.profile; profileSheet();
    }).catch(function (e) {
      toast('🐾', e && e.message === 'no_pet' ? 'Питомца у этого ученика пока нет' : 'Профиль не открылся — попробуй ещё раз', 'bad');
    });
  }
  function profileSheet() {
    var pr = S.profile; if (!pr) return;
    var c = pr.collection || {}, by = c.byRarity || {};
    var best = pr.bestItem && S.items[pr.bestItem];
    var chips = (pr.rareSpecies || []).map(function (id) { return '<span class="pp-chip rar-mythic">' + esc(speciesOf(id).name) + '</span>'; });
    if (pr.styleIcon) chips.unshift('<span class="pp-chip rar-legendary">👑 Икона стиля</span>');
    if (pr.awards && pr.awards.top1) chips.push('<span class="pp-chip">🥇 ×' + pr.awards.top1 + '</span>');
    var reacts = (S.catalog.social && S.catalog.social.reactions || ['🔥', '👑', '😂', '💯']).map(function (e) {
      var n = (pr.reactions || {})[e] || 0, mine = pr.myReaction === e;
      var dis = pr.self || !!pr.myReaction;
      return '<button type="button" class="pp-react' + (mine ? ' on' : '') + '"' + (dis ? ' disabled' : '') + ' title="' + REACT_LABEL[e] + '" onclick="PetUI.react(\'' + e + '\')"><span>' + e + '</span><b>' + n + '</b></button>';
    }).join('');
    sheet('<div class="pet-profile">' +
      '<div class="pet-try-stage">' + PetArt.render({ species: pr.species, stage: pr.stage, state: 'happy', items: S.items, equipped: pr.equipped || {}, scene: 'day', styleIcon: !!pr.styleIcon, label: pr.name }) + '</div>' +
      '<b class="pp-name">' + esc(pr.name) + '</b><i>' + esc(pr.stageName) + ' · ' + pr.level + ' ур. · хозяин ' + esc(pr.owner) + '</i>' +
      (chips.length ? '<div class="pp-chips">' + chips.join('') + '</div>' : '') +
      '<div class="pp-stats"><span><b>' + (c.owned || 0) + '</b>/' + (c.total || 0) + ' вещей</span><span class="rar-mythic"><b>' + (by.mythic || 0) + '</b> миф</span><span class="rar-legendary"><b>' + (by.legendary || 0) + '</b> легенд</span>' +
        (pr.styleVotes ? '<span><b>' + pr.styleVotes + '</b> голосов за неделю</span>' : '') + '</div>' +
      (best ? '<div class="pp-best rar-' + best.rarity + '"><span class="pet-item-art">' + PetArt.renderItem(best) + '</span><div><i>Самая редкая вещь</i><b>' + esc(best.name) + '</b><span class="pet-rarity">' + rarityLabel(best.rarity) + '</span></div></div>' : '') +
      '<div class="pp-reacts">' + reacts + '</div>' +
      '<i class="pp-note">' + (pr.self ? 'Так твоего питомца видят другие. Реакции ставят те, кто открыл тебя в топе.' : pr.myReaction ? 'Сегодня твоя реакция уже стоит' : 'Одна реакция в день — выбирай!') + '</i>' +
      (pr.self ? '<button type="button" class="go" onclick="PetUI.share()">📣 Похвастаться друзьям</button>' : '') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Закрыть</button></div>');
  }
  function react(emoji) {
    var pr = S.profile; if (!pr || pr.self || pr.myReaction) return;
    haptic('light');
    api('/react', { publicId: pr.publicId, emoji: emoji }).then(function (r) {
      S.profile = r.profile; profileSheet(); takeRound(r);
      var b = document.querySelector('.pp-react.on'); if (b) b.classList.add('pop');
    }).catch(function (e) { toast('🐾', e && e.message === 'already_reacted' ? 'Сегодня реакция этому питомцу уже стоит' : 'Не получилось', 'bad'); });
  }

  // «Кто круче?» — два случайных питомца, голос за образ.
  function battle() {
    api('/battle').then(function (r) { S.battle = r.battle; battleSheet(); })
      .catch(function () { toast('⚔️', 'Баттл не открылся — попробуй ещё раз', 'bad'); });
  }
  function battleCard(p, side) {
    return '<button type="button" class="pb-card" id="pb-' + side + '" onclick="PetUI.vote(\'' + side + '\')">' +
      PetArt.render({ species: p.species, stage: p.stage, state: 'happy', items: S.items, equipped: p.equipped || {}, scene: 'day', styleIcon: !!p.styleIcon, label: p.name }) +
      '<b>' + esc(p.name) + '</b><i>' + esc(p.stageName) + ' · ' + p.level + ' ур.</i></button>';
  }
  function battleSheet() {
    var b = S.battle || {};
    var body = !b.left ? '<div class="pet-hint">Голоса на сегодня закончились — возвращайся завтра. Итоги недели — в понедельник.</div>'
      : !b.a ? '<div class="pet-hint">Пока не с кем сравнить — позови друзей завести питомца!</div>'
      : '<div class="pb-pair">' + battleCard(b.a, 'a') + '<span class="pb-vs">VS</span>' + battleCard(b.b, 'b') + '</div>';
    sheet('<div class="pet-battle"><b>Кто круче?</b><i>Выбери образ, который нравится больше. Осталось голосов: ' + (b.left || 0) + ' из ' + (b.daily || 20) + ' · за голос +' + ((S.catalog.social || {}).battleXp || 2) + ' опыта</i>' +
      body + '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Закрыть</button></div>');
  }
  function vote(side) {
    if (S.voting) return; S.voting = true;
    haptic('light');
    var el = $('pb-' + side); if (el) el.classList.add('win');
    var other = $('pb-' + (side === 'a' ? 'b' : 'a')); if (other) other.classList.add('lose');
    api('/battle', { pick: side }).then(function (r) {
      setTimeout(function () { S.voting = false; S.battle = r.battle; battleSheet(); }, 420);
      takeRound(r);
      if (Array.isArray(r.events) && r.events.length) celebrateLevels(r.events);
    }).catch(function () { S.voting = false; battle(); });
  }

  // Карточка «Похвастаться»: картинка из SVG питомца + ссылка-приглашение.
  function shareUrl() { return location.origin + '/?ref=' + encodeURIComponent(S.state.publicId || ''); }
  function share() {
    var st = S.state; if (!st || !st.pet) return;
    var p = st.pet, url = shareUrl();
    var text = 'Мой питомец ' + p.name + ' (' + p.stageName + ', ' + p.level + ' ур.) растёт, пока я готовлюсь к ЕГЭ по истории. Заведи своего — по ссылке нам обоим сундук!';
    var svg = PetArt.render({ species: p.species, stage: p.stage, state: 'happy', items: S.items, equipped: st.equipped || {}, scene: 'day', anim: false, styleIcon: !!st.styleIcon });
    svg = svg.replace(/^<svg([^>]*)>/, '<svg$1 width="820" height="820"><style>.pet-chomp{display:none}</style>');
    var img = new Image();
    img.onload = function () {
      try {
        var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
        var g = cv.getContext('2d');
        var bgr = g.createLinearGradient(0, 0, 1080, 1350); bgr.addColorStop(0, '#2b1260'); bgr.addColorStop(1, '#0f766e');
        g.fillStyle = bgr; g.fillRect(0, 0, 1080, 1350);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(540, 560, 470, 0, Math.PI * 2); g.fill();
        g.drawImage(img, 130, 120, 820, 820);
        g.textAlign = 'center'; g.fillStyle = '#fff';
        g.font = '900 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(p.name, 540, 1040);
        g.font = '700 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = '#ffe98a'; g.fillText(p.stageName + ' · ' + p.level + ' уровень', 540, 1105);
        g.font = '700 38px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)';
        g.fillText('Растёт, пока я готовлюсь к ЕГЭ по истории', 540, 1190);
        g.font = '900 42px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = '#fff'; g.fillText('reshay-istoriyu.ru', 540, 1270);
        cv.toBlob(function (blob) { shareSheet(blob, url, text); }, 'image/png');
      } catch (_) { shareSheet(null, url, text); }
    };
    img.onerror = function () { shareSheet(null, url, text); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function shareSheet(blob, url, text) {
    S.shareBlob = blob; S.shareUrl = url; S.shareText = text;
    var preview = blob ? '<img class="pet-share-img" alt="Карточка питомца" src="' + URL.createObjectURL(blob) + '">' : '';
    var canFiles = false;
    try { canFiles = !!(blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'pet.png', { type: 'image/png' })] })); } catch (_) {}
    sheet('<div class="pet-share"><b>Похвастаться питомцем</b>' + preview +
      '<i>Друг откроет ссылку, порешает 10 минут и вылупит своего питомца — вам обоим по сундуку.</i>' +
      (canFiles ? '<button type="button" class="go" onclick="PetUI.shareSend(\'files\')">Отправить картинку</button>' : '') +
      '<button type="button" class="' + (canFiles ? '' : 'go') + '" onclick="PetUI.shareSend(\'tg\')">Ссылка в Telegram</button>' +
      (blob ? '<button type="button" onclick="PetUI.shareSend(\'save\')">Сохранить картинку</button>' : '') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Закрыть</button></div>');
  }
  function shareSend(kind) {
    var url = S.shareUrl, text = S.shareText, blob = S.shareBlob;
    if (kind === 'files' && blob) {
      navigator.share({ files: [new File([blob], 'pet.png', { type: 'image/png' })], text: text + ' ' + url }).catch(function () {});
      return;
    }
    if (kind === 'save' && blob) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'moy-pitomec.png';
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
    var link = 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
    var tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank', 'noopener');
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
      '<span class="pet-stars" aria-hidden="true">' + stars(item.rarity) + '</span>' + (sigOf(item) ? '<span class="pet-sig-badge">✨ эффект</span>' : '') +
      '<b>' + esc(item.name) + '</b><span class="pet-rarity">' + rarityLabel(item.rarity) + '</span><i>' + esc(item.era) + '</i>' + (extra || '') + '</button>';
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
    var drops = S.catalog.rareSpeciesDrops || {};
    var rare = '<button type="button" class="pet-rare-banner" onclick="PetUI.tab(\'stable\')">' +
      '<span class="pet-rare-banner-art">' + PetArt.render({ species: 'tsar', stage: 'sage', state: 'happy', items: S.items, equipped: {}, mini: true }) + '</span>' +
      '<span class="pet-rare-banner-art">' + PetArt.render({ species: 'ghoul', stage: 'sage', state: 'ok', items: S.items, equipped: {}, mini: true }) + '</span>' +
      '<span class="pet-rare-banner-art">' + PetArt.render({ species: 'squid', stage: 'adult', state: 'ok', items: S.items, equipped: {}, mini: true }) + '</span>' +
      '<span><b>В сундуках живут редкие питомцы</b><i>Николай II, Сквидвард и Гуль: в Императорском ларце — ' + pctText((drops.box_emperor || {}).tsar) + ', ' +
      pctText((drops.box_emperor || {}).squid) + ' и ' + pctText((drops.box_emperor || {}).ghoul) + ', в Царском — ' + pctText((drops.box_tsar || {}).tsar) + ', ' + pctText((drops.box_tsar || {}).squid) + ' и ' + pctText((drops.box_tsar || {}).ghoul) + '. Или собери из осколков →</i></span></button>';
    return rare + '<div class="pet-boxes">' + S.catalog.boxes.map(function (b) {
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
  var ERR = {
    not_enough_coins: 'Не хватает монет — реши ещё несколько строк',
    already_owned: 'Уже есть в гардеробе',
    not_enough_fragments: 'Осколков пока не хватает',
    stable_full: 'Питомник полон',
    bad_index: 'Этого питомца уже нет в питомнике',
    not_owned: 'Сначала нужно купить',
    pet_sleeping: 'Питомец спит — поиграете утром',
    toy_cooldown: 'Он ещё не соскучился по этой игрушке',
    top_color_active: 'У тебя заслуженный цвет за топ — перекрашивать жалко',
    too_early: 'Порешай ещё немного — питомец пока в яйце',
    rate_limited: 'Слишком часто — секунду',
  };
  function act(path, body, okFn, failFn) {
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
      if (Array.isArray(st.events)) celebrateLevels(st.events);
      return st;
    }).catch(function (e) {
      S.busy = false;
      if (failFn && failFn(e) === true) return;
      toast('⚠️', ERR[e.message] || 'Не получилось: ' + e.message, 'warn');
    });
  }

  function stageNow() { return isOpen() ? modalStage : widgetStage; }

  // Кормить / лечить / играть из кладовой или с покупкой. Анимация начинается
  // сразу — еда уже летит, пока идёт запрос; отказ сервера питомец «объясняет».
  function use(id, buy, fromEl) {
    var it = S.items[id]; if (!it) return;
    var stg = stageNow();
    haptic('light');
    var fly = it.kind !== 'toy' && stg && fromEl;
    var landed = !fly, answered = null;
    function finish() {
      if (!landed || !answered) return;
      if (answered.error) { if (stg) { stg.act('sigh', 1500); stg.say(answered.error === 'not_enough_coins' ? 'Монеток не хватает… Порешаем?' : ERR[answered.error] || 'Не вышло…'); } return; }
      if (!stg) return;
      var fx = it.fx || {};
      if (it.kind === 'food') {
        stg.act('eating', 1300);
        stg.fx('✨', MOUTH, { dy: -30 });
        setTimeout(function () {
          stg.jump(); stg.say(pick(SAY.fed));
          if (fx.sat) stg.fx('+' + fx.sat + ' 🍲', [50, 30], { num: true, dx: -26 });
          if (fx.mood) stg.fx('+' + fx.mood + ' 😊', [50, 30], { num: true, dx: 26, delay: 150 });
        }, 1250);
      } else if (it.kind === 'med') {
        stg.act('heal', 1600); stg.burst('💚', [50, 50], 6);
        setTimeout(function () { stg.jump(); stg.say(pick(SAY.healed)); stg.fx('+' + (fx.health || 0) + ' ❤️', [50, 30], { num: true }); }, 900);
      } else {
        stg.fx(PetArt.icons[id] || '🎲', [50, 20], { dy: -70 });
        stg.act('dance', 2200); stg.say(pick(SAY.played));
        stg.fx('+' + (fx.mood || 0) + ' 😊', [50, 30], { num: true, delay: 300 });
      }
    }
    if (fly) stg.fly(PetArt.icons[id] || '🍲', fromEl, function () { landed = true; finish(); });
    act('/use', { item: id, buy: !!buy }, function () { answered = { ok: true }; finish(); },
      function (e) { answered = { error: e.message }; finish(); return landed || !fly ? false : true; });
  }

  // Быстрые кнопки под питомцем: сами выбирают, чем кормить и чем лечить.
  // Сначала то, что уже лежит в кладовой, потом самое дешёвое из доступного.
  function quick(kind, el) {
    var st = S.state; if (!st || !st.pet) return;
    var p = st.pet, inv = st.inventory || {}, stg = modalStage;
    var foods = S.catalog.consumables.filter(function (c) { return c.kind === 'food'; });
    if (kind === 'tap') return tapPet();
    if (kind === 'feed') {
      if (p.sat >= 92) { stg.say(pick(SAY.full)); stg.act('wave', 1200); return; }
      var want = 100 - p.sat;
      var owned = foods.filter(function (c) { return inv[c.id]; }).sort(function (a, b) { return a.fx.sat - b.fx.sat; });
      var choice = owned.find(function (c) { return c.fx.sat >= want - 15; }) || owned[owned.length - 1];
      var buy = false;
      if (!choice) {
        var afford = foods.filter(function (c) { return c.price <= st.balance; }).sort(function (a, b) { return a.price - b.price; });
        choice = afford.find(function (c) { return c.fx.sat >= Math.min(want, 40); }) || afford[afford.length - 1];
        buy = true;
      }
      if (!choice) { stg.act('rub', 1800); stg.say('Нужно ' + fmt(S.items.food_suhar.price - st.balance) + ' монет — реши пару строк!'); return; }
      return use(choice.id, buy, el);
    }
    if (kind === 'heal') {
      if (!p.sick && p.health >= 90) { stg.say(pick(SAY.healthy)); stg.act('dance', 1500); return; }
      var med = inv.med_mikstura && p.sick ? 'med_mikstura' : inv.med_otvar ? 'med_otvar' : inv.med_mikstura ? 'med_mikstura' : null;
      var buyMed = false;
      if (!med) {
        med = (p.sick || p.health < 40) && st.balance >= S.items.med_mikstura.price ? 'med_mikstura' : 'med_otvar';
        buyMed = true;
        if (st.balance < S.items[med].price) { stg.act('shiver', 1500); stg.say('На лекарство нужно ' + fmt(S.items[med].price - st.balance) + ' монет…'); return; }
      }
      return use(med, buyMed, el);
    }
    if (kind === 'play') {
      if (p.night) { stg.say(pick(SAY.wake)); return; }
      var now = Date.now();
      var toys = S.catalog.consumables.filter(function (c) { return c.kind === 'toy' && inv[c.id]; });
      var ready = toys.filter(function (c) { return now - ((p.toys || {})[c.id] || 0) >= 3 * 3600e3; }).sort(function (a, b) { return b.fx.mood - a.fx.mood; });
      if (ready.length) return use(ready[0].id, false, el);
      if (toys.length) { stg.say('Наигрался. Погладь меня пока!'); stg.act('wave', 1200); return; }
      stg.say('Купи мне игрушку в «Уходе»! 🎲'); S.tab = 'care'; renderModal(); return;
    }
  }

  // Погладить: реакция — всегда, награда (настроение и опыт) — раз в минуту.
  // Много быстрых касаний подряд — щекотка: смех и пируэт.
  var taps = [];
  function tapPet(e) {
    var st = S.state; if (!st || !st.pet || !modalStage) return;
    var p = st.pet, now = Date.now();
    taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    haptic('light');
    var at = [50, 50];
    if (e && e.clientX != null) {
      var r = modalStage.host.getBoundingClientRect();
      at = [((e.clientX - r.left) / r.width * 100), ((e.clientY - r.top) / r.height * 100)];
    }
    if (p.state === 'sleep') { modalStage.act('ears', 700); modalStage.say(pick(SAY.wake)); return; }
    if (taps.length >= 4) {
      taps = [];
      var lg = mySigs().filter(function (x) { return x.act; })[0];
      if (lg && Math.random() < 0.5) { modalStage.sigAct(lg, true); return; }
      modalStage.act('spin', 850); modalStage.say(pick(SAY.tickle)); modalStage.burst('😆', [50, 45], 5);
    } else {
      modalStage.act('giggle', 600);
      modalStage.fx(p.sick ? '💧' : '💗', at);
      if (Math.random() < 0.6) modalStage.say(pick(SPECIES_SOUND[p.species] || SPECIES_SOUND.kitten), 1200);
    }
    if (now >= (Number(p.tapReadyAt) || 0) && !S.busy) {
      api('/tap', {}).then(function (st2) {
        S.state = Object.assign({ hatched: true }, st2);
        if (st2.tapped) modalStage.fx('+1 опыт', [50, 22], { num: true });
        renderWidget(); renderModal();
        celebrateLevels(st2.events || []);
      }).catch(function () {});
    }
  }

  // Новый уровень и рост: отдельное окно, а при смене стадии — «было → стало».
  function celebrateLevels(events) {
    var lv = (events || []).filter(function (e) { return e.reason === 'level'; });
    if (!lv.length || !S.state || !S.state.pet) return;
    var last = lv[lv.length - 1];
    var grew = lv.find(function (e) { return e.stageUp; });
    var coins = lv.reduce(function (a, e) { return a + (e.delta || 0); }, 0);
    var boxes = lv.filter(function (e) { return e.box; }).map(function (e) { return S.items[e.box] ? S.items[e.box].name : e.box; });
    var p = S.state.pet;
    var eq = S.state.equipped || {};
    var prevStage = { teen: 'baby', adult: 'teen', sage: 'adult' }[grew ? grew.stage : ''];
    var art = grew
      ? '<div class="grow"><div>' + PetArt.render({ species: p.species, stage: prevStage, state: 'ok', items: S.items, equipped: eq }) + '</div><i>→</i><div>' +
        PetArt.render({ species: p.species, stage: grew.stage, state: 'happy', items: S.items, equipped: eq }) + '</div></div>'
      : '<div class="pet-try-stage">' + PetArt.render({ species: p.species, stage: p.stage, state: 'happy', items: S.items, equipped: eq, scene: 'day' }) + '</div>';
    setTimeout(function () {
      confetti(); haptic('success');
      try { if (window.Sfx && window.Sfx.play) window.Sfx.play('win'); } catch (_) {}
      sheet('<div class="pet-lvlup"><div class="lv">' + last.level + ' уровень!</div>' + art +
        (grew ? '<b>' + esc(p.name) + ' вырос — теперь ' + esc(grew.stageName) + '!</b>' : '<b>' + esc(p.name) + ' стал опытнее</b>') +
        '<i>Награда: ' + COIN + ' ' + fmt(coins) + (boxes.length ? ' · ' + boxes.map(esc).join(', ') : '') + '</i>' +
        '<button type="button" class="go" onclick="PetUI.closeSheet()">Ура!</button></div>');
      var card = document.querySelector('#pet-sub .pet-sub-card');
      if (card) card.classList.add('pet-try');
    }, 900);
  }

  function buy(id) { act('/buy', { item: id }, function () { toast('🛍️', 'Куплено: ' + S.items[id].name, 'ok'); var s = stageNow(); if (s) { s.act('dance', 1400); s.say('Спасибо!'); } }); }
  function afterDress(it) {
    var s = stageNow(); if (!s) return;
    setTimeout(function () { s.act('spin', 850); s.say(pick(SAY.dressed)); }, 350);
  }
  function toggle(id) {
    var it = S.items[id]; var eq = S.state.equipped || {};
    var ch = {}; ch[it.slot] = eq[it.slot] === id ? null : id;
    act('/equip', { changes: ch }, function () { if (ch[it.slot]) afterDress(it); });
  }
  function undressAll() {
    var ch = {}; Object.keys(S.state.equipped || {}).forEach(function (s) { ch[s] = null; });
    act('/equip', { changes: ch }, function () { var s = stageNow(); if (s) { s.act('shiver', 900); s.say('Брр, прохладно!'); } });
  }

  // Примерка: питомец на весь экран в этой вещи + кнопка «Купить».
  function sigOf(it) { return it && it.art && window.PetArt && PetArt.SIGNATURES ? PetArt.SIGNATURES[it.art.t] : null; }
  function tryOn(id) {
    var it = S.items[id]; var st = S.state;
    var eq = Object.assign({}, st.equipped || {}); eq[it.slot] = id;
    var afford = st.balance >= it.price;
    sheet('<div class="pet-try rar-' + it.rarity + '">' +
      '<div class="pet-try-stage">' + PetArt.render({ species: st.pet.species, stage: st.pet.stage, state: 'happy', items: S.items, equipped: eq, scene: 'day' }) + '</div>' +
      '<b>' + esc(it.name) + '</b><i>' + rarityLabel(it.rarity) + ' · ' + slotLabel(it.slot) + ' · ' + esc(it.era) + '</i>' +
      (sigOf(it) ? '<div class="pet-sig-note rar-' + it.rarity + '">✨ ' + esc(sigOf(it).desc) + '</div>' : '') +
      (it.note ? '<div class="pet-note">📜 ' + esc(it.note) + '</div>' : '') +
      (afford ? '<button type="button" class="go" onclick="PetUI.buyWear(\'' + id + '\')">Купить и надеть · ' + COIN + ' ' + fmt(it.price) + '</button>'
        : '<button type="button" disabled>' + COIN + ' ' + fmt(it.price) + ' · не хватает ' + fmt(it.price - st.balance) + '</button><div class="pet-hint">Это примерно ' + fmt(Math.ceil((it.price - st.balance) / (((S.catalog.economy || {}).rates || {}).solved || 2))) + ' решённых строк — или меньше с ускорителем и заданиями дня</div>') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Не сейчас</button></div>');
  }
  function buyWear(id) {
    var it = S.items[id];
    act('/buy', { item: id }, function () {
      var ch = {}; ch[it.slot] = id;
      closeSheet();
      act('/equip', { changes: ch }, function () { afterDress(it); toast('✨', it.name + ' — теперь твоё!', 'gold'); });
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
    strip[WIN] = drop.species ? { species: drop.species, rarity: 'mythic' } : S.items[drop.id];
    // пара «почти выпало» рядом с выигрышем — для азарта
    var shiny = pool.filter(function (x) { return x.rarity === 'legendary' || x.rarity === 'mythic'; });
    strip[WIN + 1] = shiny[Math.floor(Math.random() * shiny.length)];
    var cells = strip.map(function (it) {
      var art = it.species ? PetArt.render({ species: it.species, stage: 'baby', state: 'happy', items: S.items, equipped: {}, mini: true }) : PetArt.renderItem(it);
      return '<span class="rl-cell rar-' + it.rarity + '">' + art + '</span>';
    }).join('');
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

  function fragmentsLine(fr) {
    var f = S.catalog.fragments || {};
    var parts = Object.keys(fr || {}).map(function (k) { return (f[k] ? f[k].icon + ' ' + f[k].name : k) + ' +' + fr[k]; });
    return parts.length ? '<div class="pet-own">И ещё: ' + esc(parts.join(', ')) + '</div>' : '';
  }
  function showDrop(box, drop) {
    if (drop.species) {
      S.catalog.owners = S.catalog.owners || {};
      S.catalog.owners['species:' + drop.species] = drop.owners;
      return speciesReveal(drop.species, drop.owners, box);
    }
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
      fragmentsLine(drop.fragments) +
      (again ? '<button type="button" onclick="PetUI.openBox(\'' + box.id + '\')">' + again + '</button>' : '') +
      '<button type="button" class="pet-link" onclick="PetUI.closeSheet()">Закрыть</button></div>';
    if (drop.rarity === 'legendary' || drop.rarity === 'mythic') confetti();
  }
  function wearDrop(id) {
    var it = S.items[id]; var ch = {}; ch[it.slot] = id;
    closeSheet(); act('/equip', { changes: ch }, function () { afterDress(it); });
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
      sheet('<div class="pet-hatch"><b>Кто вылупится?</b><i>Питомец живёт на твоих решениях: каждая верная строка — 2 монеты и сытость, выученный факт — 10 монет. На них — еда, лечение, наряды и сундуки.</i>' +
        '<div class="pet-species">' + S.catalog.species.filter(function (s) { return !s.rare; }).map(function (s) {
          return '<button type="button" class="' + (s.id === hatchPick ? 'on' : '') + '" onclick="PetUI.pickSpecies(\'' + s.id + '\')">' +
            PetArt.render({ species: s.id, stage: 'baby', state: 'happy', items: S.items, equipped: {}, scene: 'day' }) + '<span>' + s.name + '</span></button>';
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
    var ref = null; try { ref = localStorage.getItem('pet_ref'); } catch (_) {}
    act('/hatch', { species: hatchPick, name: name, knownAchievements: known, ref: ref }, function (st) {
      closeSheet(); confetti(); achSynced = true;
      try { localStorage.removeItem('pet_ref'); } catch (_) {}
      var g = st.gift || {};
      sheet('<div class="pet-hatch"><div class="pet-try-stage">' + PetArt.render({ species: st.pet.species, stage: 'baby', state: 'happy', items: S.items, equipped: {}, scene: 'day' }) + '</div>' +
        '<b>Привет, я ' + esc(st.pet.name) + '!</b><i>Подарок на новоселье: ' + COIN + ' ' + fmt(g.coins) + ' и две тарелки щей' + (g.boxes ? ' · 🧰 ' + g.boxes + ' ' + plural(g.boxes, 'сундук', 'сундука', 'сундуков') + ' за твой стаж' : '') + '.</i>' +
        (g.invited ? '<i>🎁 Приглашение друга сработало — вам обоим по сундуку!</i>' : '') +
        '<i>Корми меня, лечи и наряжай. Монеты — за каждую решённую строку.</i>' +
        '<button type="button" class="go" onclick="PetUI.closeSheet();PetUI.open(\'care\');PetUI.guide(0)">Познакомиться</button></div>');
    });
  }

  // ── Для рейтингов (cloud-sync.js) ───────────────────────────────────────
  // Имя в топе с цветом ника. Всё экранируется здесь — имя задаёт сам ученик.
  function nickHtml(name, style) {
    var safe = esc(name);
    if (!style || !style.color || Number(style.until) < Date.now()) return safe;
    return (style.crown ? '<span class="nick-crown-ico">👑</span>' : '') + '<span class="' + nickClass(style) + '">' + safe + '</span>';
  }
  function topHint() {
    return '<p style="text-align:center;font-size:11px;font-weight:800;color:#7c3aed;margin:0 0 8px">🐾 Тапни по питомцу — профиль и реакции 🔥👑😂💯</p>';
  }
  function miniAvatar(avatar) {
    if (!avatar || !avatar.species || !window.PetArt) return '';
    var art = PetArt.render({ species: avatar.species, stage: avatar.stage, state: avatar.sick ? 'sick' : 'ok', items: S.items, equipped: avatar.equipped || {}, mini: true, styleIcon: !!avatar.styleIcon });
    // Рамка по самой редкой надетой вещи: легенда — золото, миф — живое пламя.
    var rank = { legendary: 1, mythic: 2 }, top = null;
    Object.keys(avatar.equipped || {}).forEach(function (k) { var it = S.items[avatar.equipped[k]]; if (it && rank[it.rarity] && (!top || rank[it.rarity] > rank[top])) top = it.rarity; });
    var frame = top ? ' lb-' + top : '';
    // С публичным id аватар — кнопка: тап открывает профиль питомца с реакциями.
    if (avatar.publicId && /^[a-f0-9]{6,32}$/.test(avatar.publicId)) {
      return '<button type="button" class="lb-ava tap' + frame + '" title="Профиль питомца" onclick="event.stopPropagation();PetUI.profile(\'' + avatar.publicId + '\')">' + art + '</button>';
    }
    return '<span class="lb-ava' + frame + '">' + art + '</span>';
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
    quick: quick, tapPet: tapPet, widgetTap: widgetTap, boost: boost, openWheel: openWheel, spin: spin, switchPet: switchPet, craft: craft,
    profile: profile, react: react, battle: battle, vote: vote, share: share, shareSend: shareSend,
    claimRound: claimRound, openTop: openTop, questGo: questGo, toggleToday: toggleToday, guide: guide, guideDone: guideDone, guideGo: guideGo, topHint: topHint,
    rename: rename, paint: paint, openBox: openBox, wearDrop: wearDrop, openHatch: openHatch, pickSpecies: pickSpecies, hatch: hatch,
    onLobby: onLobby, onAchievements: onAchievements, refresh: refresh, nickHtml: nickHtml, miniAvatar: miniAvatar,
    get state() { return S.state; }, get catalog() { return S.catalog; },
  };
  onLobby();
})();
