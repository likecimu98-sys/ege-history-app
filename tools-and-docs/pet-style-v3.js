// Пробник облика v3: «не детский» стиль питомцев — объём, взгляд с характером,
// пропорции подростка, а не младенца. Вещи v2 садятся без перерисовки: у каждого
// слота своя «привязка» (transform), которая переносит старые координаты вещи на
// новую анатомию. Только для согласования стиля с владельцем.
(function () {
  'use strict';
  var uidN = 0; function uid(b) { uidN += 1; return b + uidN; }
  function shade(hex, k) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); }
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }

  var SP = {
    kitten: { fur: '#e8894a', belly: '#fbe3cc', ink: '#5a2c12', iris: '#7fd35a', mark: '#b85a22' },
    owl: { fur: '#8a6a52', belly: '#efdcc2', ink: '#3a2618', iris: '#ffb319', mark: '#5f4533' },
    hedgehog: { fur: '#d8b38a', belly: '#f6e6d0', ink: '#4a3120', iris: '#6b3f1f', mark: '#5a4030', spikes: '#5b4636' },
    dragon: { fur: '#3fae6e', belly: '#e6f3c4', ink: '#123d27', iris: '#ffd23f', mark: '#1f7a48', spikes: '#e2a92b' },
  };

  function grad(id, top, bottom) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/></linearGradient>';
  }
  function rgrad(id, c1, c2) {
    return '<radialGradient id="' + id + '" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></radialGradient>';
  }

  // ── Анатомия v3 ─────────────────────────────────────────────────────────
  // Голова меньше и выше (подросток, не младенец), есть шея, ноги и кисти.
  // Голова рисуется в «старых» координатах (центр 100,88, r46) и ужимается
  // трансформом — поэтому шапки, очки и маски v2 садятся на неё как раньше.
  var HEAD_T = 'translate(100 70) scale(0.8) translate(-100 -88)';
  var BODY_T = 'translate(100 101) scale(0.84 0.92) translate(-100 -118)';
  var NECK_T = 'translate(100 104) scale(0.84) translate(-100 -126)';

  function body(sp, p, ids) {
    var o = 'stroke="' + p.ink + '" stroke-width="2.6" stroke-linejoin="round"';
    var s = '';
    // хвост / крылья / иглы сзади
    if (sp === 'kitten') s += '<path class="pet-tail" d="M128 158 C160 164 170 132 158 112 C152 102 162 94 170 100" fill="none" stroke="' + p.ink + '" stroke-width="11" stroke-linecap="round"/><path class="pet-tail" d="M128 158 C160 164 170 132 158 112 C152 102 162 94 170 100" fill="none" stroke="url(#' + ids.fur + ')" stroke-width="6.5" stroke-linecap="round"/><path d="M150 150 l6 -3 M160 128 l6 1 M157 110 l6 -2" stroke="' + p.mark + '" stroke-width="3" stroke-linecap="round"/>';
    if (sp === 'dragon') s += '<path class="pet-wing pet-wing-l" d="M76 116 C44 86 22 100 20 124 C30 118 38 126 38 136 C46 128 56 132 60 142 C64 132 72 130 80 134Z" fill="' + shade(p.fur, -0.25) + '" ' + o + '/><path class="pet-wing pet-wing-r" d="M124 116 C156 86 178 100 180 124 C170 118 162 126 162 136 C154 128 144 132 140 142 C136 132 128 130 120 134Z" fill="' + shade(p.fur, -0.25) + '" ' + o + '/>' +
      '<path class="pet-tail" d="M122 160 C150 170 170 160 176 138 C178 132 186 130 190 126 C186 146 176 170 150 180 C136 184 124 180 118 172Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M184 128 L192 120 L190 134Z" fill="' + p.spikes + '" ' + o + '/>';
    if (sp === 'hedgehog') { for (var i = 0; i < 9; i++) { var a = (-160 + i * 18) * Math.PI / 180; s += '<path d="M' + (100 + Math.cos(a) * 30).toFixed(1) + ' ' + (130 + Math.sin(a) * 26).toFixed(1) + ' L' + (100 + Math.cos(a + 0.16) * 52).toFixed(1) + ' ' + (130 + Math.sin(a + 0.16) * 46).toFixed(1) + ' L' + (100 + Math.cos(a + 0.32) * 30).toFixed(1) + ' ' + (130 + Math.sin(a + 0.32) * 26).toFixed(1) + 'Z" fill="' + (i % 2 ? p.spikes : shade(p.spikes, 0.15)) + '" ' + o + '/>'; } }
    if (sp === 'owl') s += '<path d="M88 170 L82 188 L94 180 L100 190 L106 180 L118 188 L112 170Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/>';
    // ноги
    s += '<path d="M84 160 C82 176 80 182 76 186 C84 190 94 190 96 184 C96 176 96 168 96 160Z" fill="url(#' + ids.furD + ')" ' + o + '/>';
    s += '<path d="M116 160 C118 176 120 182 124 186 C116 190 106 190 104 184 C104 176 104 168 104 160Z" fill="url(#' + ids.furD + ')" ' + o + '/>';
    // туловище: груша, а не шар
    s += '<path d="M100 98 C124 98 136 116 136 136 C136 160 122 172 100 172 C78 172 64 160 64 136 C64 116 76 98 100 98Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
    s += '<path d="M100 110 C114 110 122 124 122 140 C122 156 112 166 100 166 C88 166 78 156 78 140 C78 124 86 110 100 110Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'owl') { for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) { var x = 90 + c * 10, y = 128 + r * 10; s += '<path d="M' + (x - 3) + ' ' + y + ' L' + x + ' ' + (y + 3) + ' L' + (x + 3) + ' ' + y + '" fill="none" stroke="' + shade(p.belly, -0.3) + '" stroke-width="1.6" stroke-linecap="round"/>'; } }
    if (sp === 'dragon') s += '<path d="M84 128 Q100 132 116 128 M82 140 Q100 144 118 140 M84 152 Q100 156 116 152" fill="none" stroke="' + shade(p.belly, -0.25) + '" stroke-width="2"/>';
    if (sp === 'kitten') s += '<path d="M66 126 q8 2 11 -2 M64 138 q9 2 12 -2 M134 126 q-8 2 -11 -2 M136 138 q-9 2 -12 -2" fill="none" stroke="' + p.mark + '" stroke-width="3" stroke-linecap="round"/>';
    // контровой свет справа — объём
    s += '<path d="M126 112 C136 124 138 146 128 162" fill="none" stroke="#fff" stroke-width="2.5" opacity=".35" stroke-linecap="round"/>';
    return s;
  }

  function arm(side, p, ids) {
    var o = 'stroke="' + p.ink + '" stroke-width="2.6" stroke-linejoin="round"';
    if (side === 'l') return '<g class="pet-arm-l"><path d="M70 112 C60 120 56 136 58 150 C60 156 68 158 72 152 C72 140 74 128 80 118Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M59 150 q2 5 6 5 M63 152 q2 5 6 3" fill="none" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round"/></g>';
    return '<path d="M130 112 C140 120 144 136 142 150 C140 156 132 158 128 152 C128 140 126 128 120 118Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M141 150 q-2 5 -6 5 M137 152 q-2 5 -6 3" fill="none" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round"/>';
  }

  // Голова — в координатах v2 (центр 100,88), ужимается HEAD_T.
  function head(sp, p, ids, state) {
    var o = 'stroke="' + p.ink + '" stroke-width="3" stroke-linejoin="round"';
    var s = '';
    if (sp === 'kitten') {
      s += '<path d="M58 72 L52 22 L94 46Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M62 62 L58 34 L84 50Z" fill="#f4a6a0"/><path d="M52 22 l-4 -10 M54 24 l2 -11" stroke="' + p.ink + '" stroke-width="2" stroke-linecap="round"/>';
      s += '<path d="M142 72 L148 22 L106 46Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M138 62 L142 34 L116 50Z" fill="#f4a6a0"/><path d="M148 22 l4 -10 M146 24 l-2 -11" stroke="' + p.ink + '" stroke-width="2" stroke-linecap="round"/>';
    } else if (sp === 'owl') {
      s += '<path d="M60 58 L46 18 L86 44Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/><path d="M140 58 L154 18 L114 44Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/>';
    } else if (sp === 'hedgehog') {
      for (var i = 0; i < 9; i++) { var a = (-172 + i * 20) * Math.PI / 180; s += '<path d="M' + (100 + Math.cos(a) * 40).toFixed(1) + ' ' + (88 + Math.sin(a) * 40).toFixed(1) + ' L' + (100 + Math.cos(a + 0.18) * 68).toFixed(1) + ' ' + (88 + Math.sin(a + 0.18) * 68).toFixed(1) + ' L' + (100 + Math.cos(a + 0.35) * 40).toFixed(1) + ' ' + (88 + Math.sin(a + 0.35) * 40).toFixed(1) + 'Z" fill="' + (i % 2 ? p.spikes : shade(p.spikes, 0.15)) + '" ' + o + '/>'; }
    } else if (sp === 'dragon') {
      s += '<path d="M70 50 C58 30 60 12 72 4 C70 22 78 36 88 44Z" fill="#f2e2b0" ' + o + '/><path d="M130 50 C142 30 140 12 128 4 C130 22 122 36 112 44Z" fill="#f2e2b0" ' + o + '/>';
      s += '<path d="M88 44 L94 30 L100 42 L106 30 L112 44" fill="' + p.spikes + '" ' + o + '/>';
    }
    // череп: чуть вытянутый, со скулами, а не идеальный круг
    s += '<path d="M100 42 C130 42 148 62 148 88 C148 112 132 132 100 134 C68 132 52 112 52 88 C52 62 70 42 100 42Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
    if (sp === 'owl') s += '<path d="M60 92 C62 62 88 60 100 70 C112 60 138 62 140 92 C138 118 118 126 100 126 C82 126 62 118 60 92Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'kitten') s += '<path d="M100 96 C114 96 126 106 126 116 C120 126 110 130 100 130 C90 130 80 126 74 116 C74 106 86 96 100 96Z" fill="url(#' + ids.belly + ')"/><path d="M90 50 v10 M100 47 v12 M110 50 v10" stroke="' + p.mark + '" stroke-width="3.5" stroke-linecap="round"/>';
    if (sp === 'hedgehog') s += '<path d="M100 72 C122 72 136 88 136 104 C130 122 116 130 100 130 C84 130 70 122 64 104 C64 88 78 72 100 72Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'dragon') s += '<path d="M100 98 C118 98 130 108 130 118 C124 128 112 132 100 132 C88 132 76 128 70 118 C70 108 82 98 100 98Z" fill="url(#' + ids.belly + ')"/>';
    s += face(sp, p, state);
    s += '<ellipse cx="78" cy="58" rx="14" ry="6" fill="#fff" opacity=".22" transform="rotate(-24 78 58)"/>';
    return s;
  }

  // Глаза миндалём с веком: характер даёт веко, а не размер зрачка.
  function eye(cx, cy, p, mirror, lid) {
    var d = mirror ? -1 : 1;
    var s = '<path d="M' + (cx - 11 * d) + ' ' + cy + ' C' + (cx - 6 * d) + ' ' + (cy - 9) + ' ' + (cx + 7 * d) + ' ' + (cy - 9) + ' ' + (cx + 12 * d) + ' ' + (cy - 1) + ' C' + (cx + 6 * d) + ' ' + (cy + 7) + ' ' + (cx - 6 * d) + ' ' + (cy + 7) + ' ' + (cx - 11 * d) + ' ' + cy + 'Z" fill="#fff" stroke="' + p.ink + '" stroke-width="2.4"/>';
    s += '<g class="pet-pupils"><circle cx="' + (cx + 1 * d) + '" cy="' + (cy - 0.5) + '" r="6" fill="' + p.iris + '"/><circle cx="' + (cx + 1 * d) + '" cy="' + (cy - 0.5) + '" r="3" fill="' + p.ink + '"/><circle cx="' + (cx + 3 * d) + '" cy="' + (cy - 3) + '" r="1.6" fill="#fff"/></g>';
    // верхнее веко: 0 — открыт, 0.35 — уверенный прищур
    if (lid) s += '<path d="M' + (cx - 12 * d) + ' ' + (cy - 1) + ' C' + (cx - 6 * d) + ' ' + (cy - 10) + ' ' + (cx + 7 * d) + ' ' + (cy - 10) + ' ' + (cx + 13 * d) + ' ' + (cy - 2) + ' L' + (cx + 12 * d) + ' ' + (cy - 2 + lid * 10) + ' C' + (cx + 6 * d) + ' ' + (cy - 7 + lid * 10) + ' ' + (cx - 6 * d) + ' ' + (cy - 7 + lid * 10) + ' ' + (cx - 11 * d) + ' ' + (cy + lid * 8) + 'Z" fill="' + shade(p.fur, -0.12) + '" stroke="' + p.ink + '" stroke-width="2.4" stroke-linejoin="round"/>';
    return s;
  }
  function face(sp, p, state) {
    var s = '';
    if (state === 'happy') {
      s += '<path d="M70 90 Q81 78 92 90 M108 90 Q119 78 130 90" fill="none" stroke="' + p.ink + '" stroke-width="3.5" stroke-linecap="round"/>';
    } else if (state === 'sleep') {
      s += '<path d="M70 90 Q81 96 92 90 M108 90 Q119 96 130 90" fill="none" stroke="' + p.ink + '" stroke-width="3" stroke-linecap="round"/>';
    } else {
      var lid = state === 'cool' ? 0.4 : state === 'sad' ? 0.25 : 0.12;
      s += '<g class="pet-eyes">' + eye(81, 90, p, false, lid) + eye(119, 90, p, true, lid) + '</g>';
      // брови — главный носитель характера
      if (state === 'cool') s += '<path d="M68 76 L92 79 M108 78 L132 73" stroke="' + p.ink + '" stroke-width="3.2" stroke-linecap="round"/>';
      else if (state === 'sad') s += '<path d="M70 80 L91 74 M130 80 L109 74" stroke="' + p.ink + '" stroke-width="3" stroke-linecap="round"/>';
      else s += '<path d="M70 76 Q81 71 92 76 M108 76 Q119 71 130 76" fill="none" stroke="' + p.ink + '" stroke-width="3" stroke-linecap="round"/>';
    }
    // нос/клюв/морда
    if (sp === 'owl') s += '<path d="M94 100 L106 100 L100 114Z" fill="#f2b705" stroke="' + p.ink + '" stroke-width="2.4" stroke-linejoin="round"/>';
    else if (sp === 'dragon') s += '<path d="M92 104 q2 -2 4 0 M104 104 q2 -2 4 0" stroke="' + p.ink + '" stroke-width="2.2" stroke-linecap="round" fill="none"/>';
    else s += '<path d="M95 102 L105 102 L100 108Z" fill="#3a2020" stroke="' + p.ink + '" stroke-width="1.6" stroke-linejoin="round"/>';
    var my = sp === 'owl' ? 120 : 114;
    var mouth = state === 'happy' ? '<path d="M88 ' + my + ' Q100 ' + (my + 12) + ' 112 ' + my + 'Z" fill="#6a1e2c" stroke="' + p.ink + '" stroke-width="2.2"/>'
      : state === 'sad' ? '<path d="M91 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 109 ' + (my + 5) + '" fill="none" stroke="' + p.ink + '" stroke-width="2.4" stroke-linecap="round"/>'
      : state === 'cool' ? '<path d="M90 ' + (my + 2) + ' Q100 ' + (my + 5) + ' 110 ' + (my - 2) + '" fill="none" stroke="' + p.ink + '" stroke-width="2.4" stroke-linecap="round"/>'
      : '<path d="M91 ' + my + ' Q95 ' + (my + 4) + ' 100 ' + (my + 1) + ' Q105 ' + (my + 4) + ' 109 ' + my + '" fill="none" stroke="' + p.ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    if (sp !== 'owl') s += '<g class="pet-mouth">' + mouth + '</g>';
    if (sp === 'kitten') s += '<path d="M62 104 L42 100 M62 110 L42 112 M138 104 L158 100 M138 110 L158 112" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>';
    return s;
  }

  // Сияние редкости — у самой вещи и вокруг питомца.
  var AURA = {
    epic: function () { return '<g class="rar-aura-epic"><ellipse cx="100" cy="190" rx="46" ry="7" fill="#a855f7" opacity=".35"/></g>'; },
    legendary: function () {
      var s = '<g class="rar-aura-leg"><ellipse cx="100" cy="190" rx="52" ry="8" fill="#f59e0b" opacity=".45"/>';
      for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; s += '<path class="it-twinkle" style="animation-delay:' + (i * 0.25) + 's" d="M' + (100 + Math.cos(a) * 70).toFixed(1) + ' ' + (110 + Math.sin(a) * 70).toFixed(1) + ' l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#ffd23f"/>'; }
      return s + '</g>';
    },
    mythic: function () {
      var s = '<g class="rar-aura-myth"><ellipse cx="100" cy="190" rx="58" ry="9" fill="#ef4444" opacity=".45"/><circle cx="100" cy="112" r="84" fill="none" stroke="#ff7b00" stroke-width="2" stroke-dasharray="3 9" opacity=".7" class="it-spin"/>';
      for (var i = 0; i < 10; i++) { var a = i / 10 * Math.PI * 2; s += '<circle class="it-fall" style="animation-delay:' + (i * 0.3) + 's" cx="' + (100 + Math.cos(a) * 60).toFixed(1) + '" cy="' + (100 + Math.sin(a) * 40).toFixed(1) + '" r="2.2" fill="' + (i % 2 ? '#ffd23f' : '#ff4d1a') + '"/>'; }
      return s + '</g>';
    },
  };

  function render(opts) {
    var sp = opts.species, p = SP[sp];
    var ids = { fur: uid('fur'), furD: uid('furd'), belly: uid('bel') };
    var defs = '<defs>' + rgrad(ids.fur, shade(p.fur, 0.22), shade(p.fur, -0.18)) + grad(ids.furD, shade(p.fur, -0.05), shade(p.fur, -0.3)) + rgrad(ids.belly, '#ffffff', p.belly) + '</defs>';
    var items = opts.items || {}, eq = opts.equipped || {}, T = window.PetArt.templates;
    function layer(slot) {
      var id = eq[slot]; if (!id || !items[id]) return '';
      var art = items[id].art; var fn = T[art.t]; if (!fn) return '';
      return '<g class="slot-' + slot + ' r-' + items[id].rarity + '">' + fn(art.c || []) + '</g>';
    }
    var best = null, order = ['common', 'rare', 'epic', 'legendary', 'mythic'];
    Object.keys(eq).forEach(function (s) { var it = items[eq[s]]; if (it && (!best || order.indexOf(it.rarity) > order.indexOf(best))) best = it.rarity; });
    var state = opts.state || 'ok';
    var bg = eq.bg ? '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + layer('bg') + '</svg>' : '';
    return '<svg class="pet-svg v3 st-' + state + '" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' + defs + bg +
      (best && AURA[best] ? AURA[best]() : '<ellipse cx="100" cy="191" rx="42" ry="5" fill="#000" opacity=".14"/>') +
      layer('pet') +
      '<g class="pet-body">' + body(sp, p, ids) +
      '<g transform="' + BODY_T + '">' + layer('body') + '</g>' + arm('l', p, ids) +
      '<g transform="' + NECK_T + '">' + layer('neck') + '</g>' +
      '<g class="pet-head"><g transform="' + HEAD_T + '">' + head(sp, p, ids, state) + layer('face') + layer('head') + '</g></g>' +
      '<g class="pet-arm-r">' + arm('r', p, ids) + layer('hand') + '</g></g>' + layer('aura') + '</svg>';
  }
  window.PetStyleV3 = { render: render };
})();
