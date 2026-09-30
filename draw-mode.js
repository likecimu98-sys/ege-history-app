// Рисование поверх тренажёра — для стрима и объяснений (владелец 30.09.2026).
//
// Только компьютер: модуль грузит ui.js лениво, если мышь/перо и экран шире 900px.
// Слой — два холста поверх всего приложения: нижний хранит готовые штрихи,
// верхний — то, что рисуется прямо сейчас (штрих, стрелка, лазер). Штрихи
// лежат в координатах СТРАНИЦЫ, поэтому при прокрутке рисунок едет вместе с
// таблицей, а не висит на месте.
//
// Инструменты: курсор (рисунок виден, приложение кликается), перо, маркер,
// стрелка, штампы ✓ ✗ ? ★, лазер (след гаснет сам, клики проходят насквозь),
// ластик по штрихам. Горячие клавиши — в подсказке панели.
(function () {
  'use strict';
  if (window.DrawMode) return;

  var COLORS = ['#ff3b5c', '#ffd23f', '#22c55e', '#38bdf8', '#ffffff', '#111827'];
  var SIZES = [3, 5, 8, 13];
  var STAMPS = ['check', 'cross', 'question', 'star'];
  var TOOLS = [
    { id: 'cursor', key: 'V', name: 'Курсор — рисунок остаётся, приложение кликается' },
    { id: 'pen', key: 'P', name: 'Перо' },
    { id: 'marker', key: 'M', name: 'Маркер' },
    { id: 'arrow', key: 'A', name: 'Стрелка' },
    { id: 'stamp', key: 'S', name: 'Штамп (S — следующий)' },
    { id: 'laser', key: 'L', name: 'Лазерная указка — след гаснет сам' },
    { id: 'eraser', key: 'E', name: 'Ластик — стирает штрих целиком' }
  ];

  var st = { on: false, tool: 'pen', color: COLORS[0], size: 1, stamp: 0, autoClear: true };
  try { var saved = JSON.parse(localStorage.getItem('draw_mode_prefs') || 'null'); if (saved) { st.color = saved.color || st.color; st.size = saved.size != null ? saved.size : st.size; st.autoClear = saved.autoClear !== false; } } catch (e) {}
  function savePrefs() { try { localStorage.setItem('draw_mode_prefs', JSON.stringify({ color: st.color, size: st.size, autoClear: st.autoClear })); } catch (e) {} }

  var strokes = [];          // готовое: {kind, color, w, pts[] | from,to | x,y,stamp, born}
  var cur = null;            // рисуемое сейчас
  var laser = [];            // точки лазера {x, y, t} — в координатах окна
  var fading = 0;            // «очистить» гасит рисунок плавно
  var dpr = 1, W = 0, H = 0;

  var root, base, live, bctx, lctx, bar, fab, dot;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function sx() { return window.scrollX || 0; }
  function sy() { return window.scrollY || 0; }
  function width() { return SIZES[st.size] || 5; }

  // ── Иконки панели: свой SVG, а не эмодзи — эмодзи на Windows 10 бывают квадратами.
  var ICON = {
    cursor: '<path d="M6 3l12 9-5.5 1.2L15 20l-2.4 1-2.6-6.6L6 18z"/>',
    pen: '<path d="M4 20l1.2-4.6L16 4.6a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z"/><path d="M14 6.6l3.4 3.4" fill="none"/>',
    marker: '<path d="M7 14l7-10 6 4-7 10z"/><path d="M7 14l-3 6h6l3-2z" opacity=".6"/>',
    arrow: '<path d="M5 19L19 5M19 5h-8M19 5v8" fill="none" stroke-width="2.6"/>',
    stamp: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke-width="3"/>',
    laser: '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5" fill="none" opacity=".45"/>',
    eraser: '<path d="M3 16l9-9 7 7-6 6H7z"/><path d="M13 20h8" fill="none"/>',
    undo: '<path d="M9 7L4 12l5 5" fill="none" stroke-width="2.4"/><path d="M4 12h10a6 6 0 010 12" fill="none" stroke-width="2.4" transform="translate(0 -5)"/>',
    clear: '<path d="M6 7h12M9 7V4h6v3M8 7l1 13h6l1-13" fill="none" stroke-width="2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke-width="2.6"/>'
  };
  function svg(name) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>'; }

  function build() {
    root = el('div', 'dm-root');
    base = el('canvas', 'dm-canvas'); live = el('canvas', 'dm-canvas dm-live');
    root.appendChild(base); root.appendChild(live);
    dot = el('div', 'dm-dot');
    root.appendChild(dot);
    document.body.appendChild(root);
    bctx = base.getContext('2d'); lctx = live.getContext('2d');

    fab = el('button', 'dm-fab', svg('pen'));
    fab.type = 'button'; fab.title = 'Рисовать поверх экрана (D)'; fab.setAttribute('aria-label', 'Рисовать поверх экрана');
    fab.onclick = function () { toggle(); };
    document.body.appendChild(fab);

    bar = el('div', 'dm-bar');
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Рисование');
    document.body.appendChild(bar);
    renderBar();

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', function () { redraw(); }, { passive: true });
    live.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, true);
    hookTables();
    requestAnimationFrame(tick);
  }

  function renderBar() {
    var h = '<div class="dm-grip" title="Рисование">✎</div>';
    TOOLS.forEach(function (t) {
      h += '<button type="button" class="dm-btn' + (st.tool === t.id ? ' on' : '') + '" data-tool="' + t.id + '" title="' + t.name + ' (' + t.key + ')">' +
        (t.id === 'stamp' ? stampIcon(STAMPS[st.stamp]) : svg(t.id)) + '</button>';
    });
    h += '<div class="dm-sep"></div>';
    COLORS.forEach(function (c, i) {
      h += '<button type="button" class="dm-color' + (st.color === c ? ' on' : '') + '" data-color="' + c + '" style="--dm-c:' + c + '" title="Цвет (Shift+' + (i + 1) + ')"></button>';
    });
    h += '<div class="dm-sep"></div>';
    SIZES.forEach(function (s, i) {
      h += '<button type="button" class="dm-size' + (st.size === i ? ' on' : '') + '" data-size="' + i + '" title="Толщина ([ и ])"><i style="width:' + (4 + i * 3) + 'px;height:' + (4 + i * 3) + 'px"></i></button>';
    });
    h += '<div class="dm-sep"></div>' +
      '<button type="button" class="dm-btn" data-act="undo" title="Отменить (Ctrl+Z)">' + svg('undo') + '</button>' +
      '<button type="button" class="dm-btn" data-act="clear" title="Очистить всё (C)">' + svg('clear') + '</button>' +
      '<button type="button" class="dm-auto' + (st.autoClear ? ' on' : '') + '" data-act="auto" title="Очищать при новой таблице">авто<br>очистка</button>' +
      '<button type="button" class="dm-btn dm-exit" data-act="exit" title="Выйти (Esc или D)">' + svg('close') + '</button>';
    bar.innerHTML = h;
    bar.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) { if (b.dataset.tool === 'stamp' && st.tool === 'stamp') st.stamp = (st.stamp + 1) % STAMPS.length; setTool(b.dataset.tool); }
      else if (b.dataset.color) { st.color = b.dataset.color; if (st.tool === 'cursor' || st.tool === 'eraser') setTool('pen'); savePrefs(); renderBar(); }
      else if (b.dataset.size) { st.size = +b.dataset.size; savePrefs(); renderBar(); cursorDot(); }
      else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'clear') clearAll();
      else if (b.dataset.act === 'auto') { st.autoClear = !st.autoClear; savePrefs(); renderBar(); }
      else if (b.dataset.act === 'exit') toggle(false);
    };
  }
  function stampIcon(kind) {
    var p = { check: '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke-width="3"/>', cross: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke-width="3"/>',
      question: '<path d="M8.5 9a3.5 3.5 0 117 0c0 2.5-3.5 3-3.5 5.5" fill="none" stroke-width="2.6"/><circle cx="12" cy="19" r="1.4"/>',
      star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>' }[kind];
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  function setTool(t) {
    st.tool = t;
    root.dataset.tool = t;
    document.documentElement.classList.toggle('dm-laser', st.on && t === 'laser');
    renderBar(); cursorDot();
  }
  function toggle(on) {
    st.on = on == null ? !st.on : !!on;
    root.classList.toggle('on', st.on);
    bar.classList.toggle('on', st.on);
    fab.classList.toggle('on', st.on);
    document.documentElement.classList.toggle('dm-drawing', st.on);
    root.dataset.tool = st.tool;
    document.documentElement.classList.toggle('dm-laser', st.on && st.tool === 'laser');
    if (!st.on) { cur = null; laser = []; clearLive(); dot.style.opacity = '0'; }
    cursorDot();
    try { if (window.Sfx && window.Sfx.play) window.Sfx.play(st.on ? 'tap' : 'pop'); } catch (e) {}
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    [base, live].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; });
    redraw();
  }

  // ── Ввод ─────────────────────────────────────────────────────────────────
  // Холст ловит указатель только для «рисующих» инструментов. Курсор и лазер
  // пропускают клики насквозь: можно показывать лазером и тут же отвечать.
  function drawing() { return st.on && st.tool !== 'cursor' && st.tool !== 'laser'; }
  function pt(e) { return { x: e.clientX + sx(), y: e.clientY + sy(), p: e.pointerType === 'pen' && e.pressure ? e.pressure : 0.5 }; }

  function down(e) {
    if (!drawing() || e.button > 0) return;
    e.preventDefault();
    try { live.setPointerCapture(e.pointerId); } catch (er) {}
    var p = pt(e);
    if (st.tool === 'eraser') { cur = { kind: 'erase' }; eraseAt(p); return; }
    if (st.tool === 'stamp') {
      strokes.push({ kind: 'stamp', stamp: STAMPS[st.stamp], color: st.color, w: width(), x: p.x, y: p.y, born: performance.now() });
      redraw(); boom(e.clientX, e.clientY); return;
    }
    if (st.tool === 'arrow') { cur = { kind: 'arrow', color: st.color, w: width(), from: p, to: p }; return; }
    cur = { kind: st.tool, color: st.color, w: width() * (st.tool === 'marker' ? 3.2 : 1), pts: [p] };
  }
  function move(e) {
    if (!st.on) return;
    moveDot(e);
    if (st.tool === 'laser') { laser.push({ x: e.clientX, y: e.clientY, t: performance.now() }); return; }
    if (!cur) return;
    var p = pt(e);
    if (cur.kind === 'erase') { eraseAt(p); return; }
    if (cur.kind === 'arrow') { cur.to = p; drawLive(); return; }
    var last = cur.pts[cur.pts.length - 1];
    if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) < 1.5) return;
    cur.pts.push(p); drawLive();
  }
  function up() {
    if (!cur) return;
    if (cur.kind !== 'erase') {
      var ok = cur.kind === 'arrow' ? Math.hypot(cur.to.x - cur.from.x, cur.to.y - cur.from.y) > 8 : cur.pts.length > 0;
      if (ok) { cur.born = performance.now(); strokes.push(cur); }
    }
    cur = null; clearLive(); redraw();
  }
  function eraseAt(p) {
    var r = 14, before = strokes.length;
    strokes = strokes.filter(function (s) {
      if (s.kind === 'stamp') return Math.hypot(s.x - p.x, s.y - p.y) > r + 16;
      if (s.kind === 'arrow') return distSeg(p, s.from, s.to) > r;
      for (var i = 0; i < s.pts.length; i++) if (Math.abs(s.pts[i].x - p.x) < r && Math.abs(s.pts[i].y - p.y) < r) return false;
      return true;
    });
    if (strokes.length !== before) redraw();
  }
  function distSeg(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy || 1;
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function undo() { strokes.pop(); redraw(); }
  function clearAll(silent) {
    if (!strokes.length) return;
    if (silent) { strokes = []; redraw(); return; }
    fading = performance.now();
  }

  function key(e) {
    var t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing || e.altKey || e.metaKey) return;
    var k = e.key;
    // Своё гасим целиком: Esc у тренажёра — «в лобби», а тут он лишь выключает рисование.
    function eat() { e.preventDefault(); e.stopPropagation(); }
    if (e.ctrlKey) { if (st.on && (k === 'z' || k === 'Z' || k === 'я' || k === 'Я')) { eat(); undo(); } return; }
    // Раскладка русская или английская — клавиша одна и та же (e.code).
    var code = (e.code || '').replace(/^Key/, '').replace(/^Digit/, '');
    if (code === 'D' && !e.shiftKey) { eat(); toggle(); return; }
    if (!st.on) return;
    if (k === 'Escape') { eat(); toggle(false); return; }
    // Цифры без Shift остаются тренажёру (1–9 ставят ответ), цвета — Shift+1…6.
    if (e.shiftKey && /^[1-6]$/.test(code)) { eat(); st.color = COLORS[+code - 1]; if (st.tool === 'cursor' || st.tool === 'eraser') st.tool = 'pen'; savePrefs(); setTool(st.tool); return; }
    if (e.shiftKey) return;
    var tool = { V: 'cursor', P: 'pen', M: 'marker', A: 'arrow', L: 'laser', E: 'eraser' }[code];
    if (tool) { eat(); setTool(tool); return; }
    if (code === 'S') { eat(); if (st.tool === 'stamp') st.stamp = (st.stamp + 1) % STAMPS.length; setTool('stamp'); return; }
    if (code === 'C') { eat(); clearAll(); return; }
    if (code === 'BracketLeft') { eat(); st.size = Math.max(0, st.size - 1); savePrefs(); renderBar(); cursorDot(); }
    if (code === 'BracketRight') { eat(); st.size = Math.min(SIZES.length - 1, st.size + 1); savePrefs(); renderBar(); cursorDot(); }
  }

  // Новая таблица — чистый лист (если не выключено): рисунок относится к той таблице.
  function hookTables() {
    var tries = 0;
    (function wrap() {
      if (typeof window.generateTable !== 'function') { if (tries++ < 40) setTimeout(wrap, 500); return; }
      if (window.generateTable._dm) return;
      var orig = window.generateTable;
      var wrapped = function () { var r = orig.apply(this, arguments); if (st.autoClear && strokes.length) clearAll(); return r; };
      wrapped._dm = true;
      window.generateTable = wrapped;
    })();
  }

  // ── Отрисовка ────────────────────────────────────────────────────────────
  function clearLive() { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); }
  function redraw() {
    if (!bctx) return;
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, base.width, base.height);
    bctx.setTransform(dpr, 0, 0, dpr, -sx() * dpr, -sy() * dpr);
    var now = performance.now();
    strokes.forEach(function (s) { paint(bctx, s, now); });
  }
  function drawLive() {
    clearLive();
    if (!cur || cur.kind === 'erase') return;
    lctx.setTransform(dpr, 0, 0, dpr, -sx() * dpr, -sy() * dpr);
    paint(lctx, cur, performance.now());
  }
  function paint(c, s, now) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (s.kind === 'pen' || s.kind === 'marker') {
      c.strokeStyle = s.color;
      if (s.kind === 'marker') { c.globalAlpha = 0.38; c.lineCap = 'butt'; }
      else { c.shadowColor = s.color; c.shadowBlur = 7; }   // неоновый отсвет — на стриме смотрится сочно
      var pts = s.pts;
      if (pts.length === 1) { c.fillStyle = s.color; c.beginPath(); c.arc(pts[0].x, pts[0].y, s.w / 2 + 1, 0, 7); c.fill(); }
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], m0 = i > 1 ? mid(pts[i - 2], a) : a, m1 = mid(a, b);
        c.lineWidth = s.kind === 'pen' ? s.w * (0.55 + b.p * 0.9) : s.w;
        c.beginPath(); c.moveTo(m0.x, m0.y); c.quadraticCurveTo(a.x, a.y, m1.x, m1.y); c.stroke();
      }
    } else if (s.kind === 'arrow') {
      arrow(c, s.from, s.to, s.color, s.w);
    } else if (s.kind === 'stamp') {
      var age = now - (s.born || 0), k = age < 260 ? 1 + 0.7 * Math.pow(1 - age / 260, 2) : 1;
      stamp(c, s.stamp, s.x, s.y, 22 + s.w * 2.2, s.color, k);
    }
    c.restore();
  }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function arrow(c, a, b, color, w) {
    var ang = Math.atan2(b.y - a.y, b.x - a.x), head = 12 + w * 2.2;
    c.strokeStyle = color; c.fillStyle = color; c.lineWidth = w + 1;
    c.shadowColor = color; c.shadowBlur = 8;
    var bx = b.x - Math.cos(ang) * head * 0.6, by = b.y - Math.sin(ang) * head * 0.6;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(bx, by); c.stroke();
    c.beginPath(); c.moveTo(b.x, b.y);
    c.lineTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head);
    c.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head);
    c.closePath(); c.fill();
  }
  function stamp(c, kind, x, y, r, color, k) {
    c.translate(x, y); c.scale(k, k);
    c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
    c.lineWidth = Math.max(4, r * 0.2); c.strokeStyle = color; c.fillStyle = color;
    if (kind === 'check') { c.beginPath(); c.moveTo(-r * 0.62, 0); c.lineTo(-r * 0.15, r * 0.48); c.lineTo(r * 0.7, -r * 0.55); c.stroke(); }
    else if (kind === 'cross') { c.beginPath(); c.moveTo(-r * 0.55, -r * 0.55); c.lineTo(r * 0.55, r * 0.55); c.moveTo(r * 0.55, -r * 0.55); c.lineTo(-r * 0.55, r * 0.55); c.stroke(); }
    else if (kind === 'question') {
      c.beginPath(); c.arc(0, -r * 0.3, r * 0.38, Math.PI * 1.05, Math.PI * 0.35); c.quadraticCurveTo(0, r * 0.1, 0, r * 0.3); c.stroke();
      c.beginPath(); c.arc(0, r * 0.72, c.lineWidth * 0.62, 0, 7); c.fill();
    } else {
      c.beginPath();
      for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r * 0.9; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      c.closePath(); c.fill();
    }
  }
  // Штамп «бьёт» по экрану: кольцо разлетается — видно и на маленьком окне стрима.
  function boom(x, y) {
    var b = el('span', 'dm-boom'); b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.setProperty('--dm-c', st.color);
    document.body.appendChild(b); setTimeout(function () { b.remove(); }, 520);
    try { if (window.Sfx && window.Sfx.play) window.Sfx.play('pop'); } catch (e) {}
  }

  function tick() {
    var now = performance.now();
    // Анимация «удара» свежих штампов.
    if (strokes.some(function (s) { return s.kind === 'stamp' && now - s.born < 280; })) redraw();
    // Плавное «очистить».
    if (fading) {
      var f = (now - fading) / 260;
      if (f >= 1) { fading = 0; strokes = []; base.style.opacity = ''; redraw(); }
      else base.style.opacity = String(1 - f);
    }
    // Лазер: след за 700 мс, голова светится.
    if (st.on && (laser.length || st.tool === 'laser')) {
      laser = laser.filter(function (p) { return now - p.t < 700; });
      if (!cur) {
        clearLive();
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lctx.lineCap = 'round'; lctx.lineJoin = 'round';
        for (var i = 1; i < laser.length; i++) {
          var a = laser[i - 1], b = laser[i], life = 1 - (now - b.t) / 700;
          lctx.strokeStyle = 'rgba(255,59,92,' + (life * 0.85).toFixed(3) + ')';
          lctx.shadowColor = '#ff3b5c'; lctx.shadowBlur = 16;
          lctx.lineWidth = 2 + life * 7;
          lctx.beginPath(); lctx.moveTo(a.x, a.y); lctx.lineTo(b.x, b.y); lctx.stroke();
        }
        var h = laser[laser.length - 1];
        if (h && now - h.t < 700) {
          lctx.fillStyle = '#fff'; lctx.shadowColor = '#ff3b5c'; lctx.shadowBlur = 22;
          lctx.beginPath(); lctx.arc(h.x, h.y, 5.5, 0, 7); lctx.fill();
        }
      }
    }
    requestAnimationFrame(tick);
  }

  // Кружок-прицел под курсором: видно цвет и толщину, как у настоящего маркера.
  function cursorDot() {
    if (!dot) return;
    var show = st.on && (st.tool === 'pen' || st.tool === 'marker' || st.tool === 'eraser');
    dot.style.display = show ? 'block' : 'none';
    var d = st.tool === 'eraser' ? 28 : Math.max(6, width() * (st.tool === 'marker' ? 3.2 : 1) + 2);
    dot.style.width = d + 'px'; dot.style.height = d + 'px';
    dot.style.setProperty('--dm-c', st.tool === 'eraser' ? '#ffffff' : st.color);
    dot.classList.toggle('eraser', st.tool === 'eraser');
  }
  function moveDot(e) { if (dot && dot.style.display === 'block') { dot.style.opacity = '1'; dot.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; } }

  window.DrawMode = { toggle: toggle, clear: function () { clearAll(true); }, isOn: function () { return st.on; } };
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
