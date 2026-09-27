// «Летописчик» — рисунки питомца и всех вещей. Чистый SVG, без картинок.
//
// Каталог (что есть, сколько стоит, какой редкости) живёт на СЕРВЕРЕ
// (server/api/src/pet/catalog.js). Здесь — только как это выглядит: у каждой
// вещи в каталоге поле art = { t: шаблон, c: [цвета] }, и шаблон ищется в
// T ниже. tools-and-docs/pet-catalog.selftest.js сверяет, что для каждой вещи
// каталога шаблон есть — иначе на питомце было бы пустое место.
//
// Анатомия одна на всех четырёх зверьков (viewBox 0 0 200 200):
//   голова — круг (100, 88) r=46;  туловище — эллипс (100, 152) 40×34;
//   глаза — (82, 90) и (118, 90);  рот — (100, 106);  правая лапа — (140, 152);
//   ступни — (84, 186) и (116, 186);  земля — y≈188.
// Поэтому любая шапка садится на любого зверька, а новая вещь рисуется один раз.
(function () {
  'use strict';

  var OUT = '#2b2233';           // контур «наклейки»
  var SW = 'stroke="' + OUT + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"';

  // Темнее/светлее — для теней и бликов из одного цвета каталога.
  function shade(hex, k) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); }
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  function c0(c, i, d) { return (c && c[i]) || d; }
  // id градиентов и масок обязаны быть уникальны НА СТРАНИЦЕ: в топе рядом
  // десятки аватаров, и одинаковый id «sky» у всех красил бы небо первым же.
  var uidSeq = 0;
  function uid(base) { uidSeq += 1; return base + '-' + uidSeq; }

  // ── Зверьки ─────────────────────────────────────────────────────────────
  var SPECIES = {
    kitten:   { fur: '#f4a259', belly: '#fde2c4', inner: '#f7b7a3', nose: '#e0607e' },
    owl:      { fur: '#a0785a', belly: '#f1dfc6', inner: '#d9b48a', nose: '#f2b705' },
    hedgehog: { fur: '#e8c9a0', belly: '#fbead3', inner: '#d9a67a', nose: '#3a2a1e', spikes: '#6b4f3a' },
    dragon:   { fur: '#6cc070', belly: '#e9f5c9', inner: '#4f9a55', nose: '#3f7d45', spikes: '#f2b705' },
  };

  // ── Стадии роста ────────────────────────────────────────────────────────
  // Питомец растёт с уровнем (сервер: pet/wallet.js, STAGES): Малыш → Подросток
  // → Взрослый → Мудрец. Растёт буквально — масштаб тела, — и обрастает
  // приметами вида: полоски у котёнка, хохолок и узор у совы, длинные иглы у
  // ежа, крылья и рога у дракона. У Мудреца — золотой ореол и седые брови.
  // Вещи сидят на той же анатомии, поэтому масштаб их не ломает.
  var STAGE_SCALE = { baby: 0.82, teen: 0.91, adult: 1, sage: 1 };
  var STAGE_RANK = { baby: 0, teen: 1, adult: 2, sage: 3 };
  function atLeast(stage, need) { return (STAGE_RANK[stage] || 0) >= STAGE_RANK[need]; }

  // Задний план зверька: то, что за телом (иглы, хвост, крылья, ореол).
  function speciesBack(sp, p, stage) {
    var s = '';
    if (stage === 'sage') {
      s += '<g class="pet-halo"><circle cx="100" cy="88" r="60" fill="none" stroke="#ffd23f" stroke-width="3" stroke-dasharray="4 7" opacity=".75"/>' +
        '<circle cx="100" cy="88" r="66" fill="none" stroke="#ffe98a" stroke-width="1.5" opacity=".5"/></g>';
    }
    if (sp === 'hedgehog') {
      var n = atLeast(stage, 'adult') ? 15 : atLeast(stage, 'teen') ? 13 : 11;
      var len = atLeast(stage, 'adult') ? 72 : atLeast(stage, 'teen') ? 67 : 62;
      var span = 176 / n;
      for (var i = 0; i < n; i++) {
        var a = (-178 + i * span) * Math.PI / 180;
        var x1 = 100 + Math.cos(a) * 40, y1 = 92 + Math.sin(a) * 40;
        var x2 = 100 + Math.cos(a + span / 360 * Math.PI) * len, y2 = 92 + Math.sin(a + span / 360 * Math.PI) * len;
        var a2 = a + span * Math.PI / 180, x3 = 100 + Math.cos(a2) * 40, y3 = 92 + Math.sin(a2) * 40;
        s += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' L' + x3.toFixed(1) + ' ' + y3.toFixed(1) + 'Z" fill="' + (i % 2 ? p.spikes : shade(p.spikes, 0.12)) + '" ' + SW + '/>';
      }
      return s + '<ellipse cx="100" cy="150" rx="50" ry="36" fill="' + p.spikes + '" ' + SW + '/>' +
        '<path d="M58 140 l-8 -6 M60 158 l-10 0 M142 140 l8 -6 M140 158 l10 0" stroke="' + shade(p.spikes, -0.25) + '" stroke-width="3" stroke-linecap="round"/>';
    }
    if (sp === 'dragon') {
      if (atLeast(stage, 'teen')) {
        var big = atLeast(stage, 'adult');
        var wl = big ? 'M70 128 Q30 96 22 126 Q34 124 36 140 Q46 132 52 146 Q60 136 70 146Z' : 'M72 130 Q46 110 40 130 Q50 128 52 140 Q60 134 72 142Z';
        var wr = big ? 'M130 128 Q170 96 178 126 Q166 124 164 140 Q154 132 148 146 Q140 136 130 146Z' : 'M128 130 Q154 110 160 130 Q150 128 148 140 Q140 134 128 142Z';
        s += '<path class="pet-wing pet-wing-l" d="' + wl + '" fill="' + shade(p.fur, -0.18) + '" ' + SW + '/>';
        s += '<path class="pet-wing pet-wing-r" d="' + wr + '" fill="' + shade(p.fur, -0.18) + '" ' + SW + '/>';
      }
      s += '<path class="pet-tail" d="M130 170 Q170 178 176 150 Q178 140 186 138 Q180 158 168 172 Q150 190 126 182Z" fill="' + p.fur + '" ' + SW + '/>' +
        '<path d="M176 150 L186 138 L184 152Z" fill="' + p.spikes + '" ' + SW + '/>' +
        '<path d="M72 126 L64 116 L78 120Z M128 126 L136 116 L122 120Z" fill="' + p.spikes + '" ' + SW + '/>';
      return s;
    }
    if (sp === 'kitten') {
      var tip = atLeast(stage, 'teen') ? '<path d="M168 140 Q166 128 176 124" fill="none" stroke="' + shade(p.fur, -0.25) + '" stroke-width="7" stroke-linecap="round"/>' : '';
      return s + '<g class="pet-tail"><path d="M132 172 Q172 176 168 140 Q166 128 176 124" fill="none" stroke="' + OUT + '" stroke-width="12" stroke-linecap="round"/>' +
        '<path d="M132 172 Q172 176 168 140 Q166 128 176 124" fill="none" stroke="' + p.fur + '" stroke-width="7" stroke-linecap="round"/>' + tip + '</g>';
    }
    if (sp === 'owl' && atLeast(stage, 'adult')) {
      s += '<path class="pet-tail" d="M86 176 L78 194 L92 186 L100 198 L108 186 L122 194 L114 176Z" fill="' + shade(p.fur, -0.2) + '" ' + SW + '/>';
    }
    return s;
  }

  function speciesBody(sp, p, stage) {
    var s = '';
    // ступни
    s += '<ellipse cx="84" cy="186" rx="13" ry="7" fill="' + shade(p.fur, -0.12) + '" ' + SW + '/>';
    s += '<ellipse cx="116" cy="186" rx="13" ry="7" fill="' + shade(p.fur, -0.12) + '" ' + SW + '/>';
    if (sp === 'owl' || sp === 'dragon') s += '<path d="M78 190 v-4 M84 191 v-4 M90 190 v-4 M110 190 v-4 M116 191 v-4 M122 190 v-4" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>';
    // туловище + объём: тень справа, блик слева
    s += '<ellipse cx="100" cy="152" rx="40" ry="34" fill="' + p.fur + '" ' + SW + '/>';
    s += '<path d="M122 124 Q144 146 132 178 Q126 184 116 185 Q138 158 122 124Z" fill="#000" opacity=".07"/>';
    s += '<ellipse cx="100" cy="158" rx="25" ry="23" fill="' + p.belly + '"/>';
    s += '<ellipse cx="90" cy="148" rx="8" ry="5" fill="#fff" opacity=".35" transform="rotate(-30 90 148)"/>';
    if (sp === 'kitten' && atLeast(stage, 'teen')) {
      s += '<path d="M64 140 q8 3 12 0 M62 152 q9 3 13 0 M64 164 q8 3 12 0 M136 140 q-8 3 -12 0 M138 152 q-9 3 -13 0 M136 164 q-8 3 -12 0" fill="none" stroke="' + shade(p.fur, -0.28) + '" stroke-width="3" stroke-linecap="round"/>';
    }
    if (sp === 'owl' && atLeast(stage, 'teen')) {
      for (var r = 0; r < (atLeast(stage, 'adult') ? 3 : 2); r++) {
        for (var c = 0; c < 3; c++) {
          var x = 90 + c * 10, y = 148 + r * 9;
          s += '<path d="M' + (x - 3) + ' ' + y + ' L' + x + ' ' + (y + 3) + ' L' + (x + 3) + ' ' + y + '" fill="none" stroke="' + shade(p.fur, -0.1) + '" stroke-width="1.8" stroke-linecap="round"/>';
        }
      }
    }
    if (sp === 'dragon' && atLeast(stage, 'adult')) {
      s += '<path d="M82 146 Q100 150 118 146 M80 157 Q100 161 120 157 M82 168 Q100 172 118 168" fill="none" stroke="' + shade(p.belly, -0.2) + '" stroke-width="2"/>';
    }
    if (sp === 'hedgehog' && atLeast(stage, 'teen')) {
      s += '<circle cx="92" cy="152" r="2" fill="' + shade(p.belly, -0.2) + '"/><circle cx="108" cy="160" r="2" fill="' + shade(p.belly, -0.2) + '"/><circle cx="96" cy="168" r="2" fill="' + shade(p.belly, -0.2) + '"/>';
    }
    return s;
  }

  // Лапы — отдельными группами на «шарнирах»: машут, чешутся, держат вещь.
  function armL(sp, p) {
    if (sp === 'owl') return '<g class="pet-arm-l"><path d="M62 132 Q44 152 58 176 Q66 162 68 140Z" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/></g>';
    return '<g class="pet-arm-l"><ellipse cx="62" cy="152" rx="10" ry="15" transform="rotate(20 62 152)" fill="' + p.fur + '" ' + SW + '/></g>';
  }
  function armR(sp, p) {
    if (sp === 'owl') return '<path d="M138 132 Q156 152 142 176 Q134 162 132 140Z" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/>';
    return '<ellipse cx="138" cy="152" rx="10" ry="15" transform="rotate(-20 138 152)" fill="' + p.fur + '" ' + SW + '/>';
  }

  function speciesHead(sp, p, stage) {
    var s = '';
    if (sp === 'kitten') {
      s += '<g class="pet-ear-l"><path d="M60 70 L58 30 L90 50Z" fill="' + p.fur + '" ' + SW + '/><path d="M64 60 L63 40 L80 51Z" fill="' + p.inner + '"/>' +
        (atLeast(stage, 'adult') ? '<path d="M58 30 l-3 -7 M60 31 l1 -8" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>' : '') + '</g>';
      s += '<g class="pet-ear-r"><path d="M140 70 L142 30 L110 50Z" fill="' + p.fur + '" ' + SW + '/><path d="M136 60 L137 40 L120 51Z" fill="' + p.inner + '"/>' +
        (atLeast(stage, 'adult') ? '<path d="M142 30 l3 -7 M140 31 l-1 -8" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>' : '') + '</g>';
    } else if (sp === 'owl') {
      var tall = atLeast(stage, 'adult') ? 8 : 0;
      s += '<path class="pet-ear-l" d="M62 60 L' + (56 - tall / 2) + ' ' + (34 - tall) + ' L82 50Z" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/>';
      s += '<path class="pet-ear-r" d="M138 60 L' + (144 + tall / 2) + ' ' + (34 - tall) + ' L118 50Z" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/>';
    } else if (sp === 'hedgehog') {
      s += '<circle cx="66" cy="58" r="9" fill="' + p.fur + '" ' + SW + '/><circle cx="134" cy="58" r="9" fill="' + p.fur + '" ' + SW + '/>';
      s += '<circle cx="66" cy="58" r="4.5" fill="' + p.inner + '"/><circle cx="134" cy="58" r="4.5" fill="' + p.inner + '"/>';
    } else if (sp === 'dragon') {
      var h = atLeast(stage, 'adult') ? 10 : atLeast(stage, 'teen') ? 5 : 0;
      s += '<path d="M72 52 Q' + (62 - h / 2) + ' ' + (30 - h) + ' ' + (74 - h / 3) + ' ' + (22 - h) + ' Q74 38 84 48Z" fill="#f4e3b0" ' + SW + '/>';
      s += '<path d="M128 52 Q' + (138 + h / 2) + ' ' + (30 - h) + ' ' + (126 + h / 3) + ' ' + (22 - h) + ' Q126 38 116 48Z" fill="#f4e3b0" ' + SW + '/>';
    }
    s += '<circle cx="100" cy="88" r="46" fill="' + p.fur + '" ' + SW + '/>';
    s += '<path d="M128 56 Q150 82 136 116 Q126 128 110 132 Q144 100 128 56Z" fill="#000" opacity=".06"/>';
    if (sp === 'owl') s += '<path d="M60 92 Q62 58 100 62 Q138 58 140 92 Q138 122 100 124 Q62 122 60 92Z" fill="' + p.belly + '"/>';
    if (sp === 'owl' && atLeast(stage, 'teen')) s += '<path d="M92 44 Q96 30 100 42 Q104 28 108 44" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/>';
    if (sp === 'hedgehog') s += '<ellipse cx="100" cy="98" rx="34" ry="28" fill="' + p.belly + '"/>';
    if (sp === 'dragon') s += '<ellipse cx="100" cy="104" rx="28" ry="18" fill="' + p.belly + '"/>';
    if (sp === 'dragon' && atLeast(stage, 'teen')) s += '<path d="M92 46 L96 38 L100 46 L104 38 L108 46" fill="' + p.spikes + '" ' + SW + '/>';
    if (sp === 'kitten' && atLeast(stage, 'teen')) s += '<path d="M92 50 v8 M100 48 v10 M108 50 v8" stroke="' + shade(p.fur, -0.28) + '" stroke-width="3.5" stroke-linecap="round"/>';
    // блик на макушке — объём
    s += '<ellipse cx="80" cy="62" rx="15" ry="8" fill="#fff" opacity=".28" transform="rotate(-28 80 62)"/>';
    return s;
  }

  // Лицо: глаза (зрачки двигаются за пальцем), рот (жуёт, зевает), щёки.
  // Состояние: happy / ok / sad / hungry / sick / sleep.
  function face(sp, p, state, stage) {
    var s = '';
    var baby = stage === 'baby';
    var ex = baby ? 8 : 7, ey = baby ? 10 : 8.5;
    if (state === 'sleep') {
      s += '<path d="M74 91 Q82 97 90 91 M110 91 Q118 97 126 91" fill="none" stroke="' + OUT + '" stroke-width="3" stroke-linecap="round"/>';
    } else if (state === 'happy') {
      s += '<path d="M74 93 Q82 83 90 93 M110 93 Q118 83 126 93" fill="none" stroke="' + OUT + '" stroke-width="3.5" stroke-linecap="round"/>';
    } else if (state === 'sick') {
      s += '<path d="M76 86 L88 96 M88 86 L76 96 M112 86 L124 96 M124 86 L112 96" stroke="' + OUT + '" stroke-width="3" stroke-linecap="round"/>';
    } else {
      s += '<g class="pet-eyes"><g class="pet-pupils"><ellipse cx="82" cy="90" rx="' + ex + '" ry="' + ey + '" fill="' + OUT + '"/><ellipse cx="118" cy="90" rx="' + ex + '" ry="' + ey + '" fill="' + OUT + '"/>' +
        '<circle cx="85" cy="86.5" r="' + (baby ? 3.2 : 2.6) + '" fill="#fff"/><circle cx="121" cy="86.5" r="' + (baby ? 3.2 : 2.6) + '" fill="#fff"/>' +
        '<circle cx="79.5" cy="94" r="1.3" fill="#fff" opacity=".8"/><circle cx="115.5" cy="94" r="1.3" fill="#fff" opacity=".8"/></g></g>';
      if (state === 'sad') {
        // Брови «домиком» (внутренние концы выше) — грусть; наоборот было бы злостью.
        s += '<path d="M72 82 L90 76 M128 82 L110 76" stroke="' + OUT + '" stroke-width="2.5" stroke-linecap="round"/>';
        s += '<path class="pet-tear" d="M76 100 Q73 106 76 109 Q79 106 76 100Z" fill="#7fc8f8"/>';
      }
    }
    if (stage === 'sage' && state !== 'sick') s += '<path d="M70 76 Q80 70 90 76 M110 76 Q120 70 130 76" fill="none" stroke="#f4f4f4" stroke-width="4" stroke-linecap="round"/>';
    // щёчки
    if (state !== 'sick') s += '<g class="pet-cheeks"><ellipse cx="70" cy="104" rx="7" ry="4" fill="#ff8fa3" opacity=".45"/><ellipse cx="130" cy="104" rx="7" ry="4" fill="#ff8fa3" opacity=".45"/></g>';
    // нос / клюв
    if (sp === 'owl') {
      s += '<path d="M94 100 L106 100 L100 111Z" fill="' + p.nose + '" ' + SW + '/>';
    } else if (sp === 'dragon') {
      s += '<circle cx="93" cy="101" r="1.8" fill="' + OUT + '"/><circle cx="107" cy="101" r="1.8" fill="' + OUT + '"/>';
    } else {
      s += '<path d="M96 100 L104 100 L100 104Z" fill="' + p.nose + '" stroke="' + OUT + '" stroke-width="1.5" stroke-linejoin="round"/>';
    }
    var my = sp === 'owl' ? 116 : 107;
    var mouth;
    if (state === 'hungry') mouth = '<ellipse cx="100" cy="' + (my + 3) + '" rx="5" ry="6" fill="#7a2233" ' + SW + '/>';
    else if (state === 'sad' || state === 'sick') mouth = '<path d="M92 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 108 ' + (my + 5) + '" fill="none" stroke="' + OUT + '" stroke-width="2.5" stroke-linecap="round"/>';
    else if (state === 'sleep') mouth = '<ellipse cx="100" cy="' + (my + 2) + '" rx="3" ry="2.5" fill="' + OUT + '"/>';
    else if (state === 'happy') mouth = '<path d="M91 ' + my + ' Q100 ' + (my + 11) + ' 109 ' + my + 'Z" fill="#7a2233" ' + SW + '/><path d="M95 ' + (my + 5) + ' Q100 ' + (my + 9) + ' 105 ' + (my + 5) + '" fill="#ff8fa3"/>';
    else if (sp !== 'owl') mouth = '<path d="M92 ' + my + ' Q96 ' + (my + 5) + ' 100 ' + (my + 1) + ' Q104 ' + (my + 5) + ' 108 ' + my + '" fill="none" stroke="' + OUT + '" stroke-width="2.5" stroke-linecap="round"/>';
    else mouth = '';
    s += '<g class="pet-mouth">' + mouth + '</g>';
    // Открытый рот для еды и зевка — скрыт, пока не нужен (см. pet.css .eating / .act-yawn).
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#7a2233" ' + SW + '/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    if (sp === 'kitten' && state !== 'sick') s += '<path d="M60 98 L46 95 M60 103 L46 105 M140 98 L154 95 M140 103 L154 105" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>';
    return s;
  }

  // ── Шаблоны вещей ───────────────────────────────────────────────────────
  // Каждый — function(c) → SVG-строка в координатах питомца.
  var T = {};

  // Головные уборы
  T.skullcap = function (c) { return '<path d="M58 70 Q60 38 100 36 Q140 38 142 70 Q100 58 58 70Z" fill="' + c0(c, 0, '#333') + '" ' + SW + '/>'; };
  T.kolpak = function (c) { return '<path d="M58 66 Q66 30 100 24 Q140 18 158 44 Q138 36 128 50 L142 66 Q100 54 58 66Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M56 66 Q100 52 144 66 L144 72 Q100 60 56 72Z" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.kerchief = function (c) {
    var dots = '';
    if (c[1] && c[1] !== c[0]) for (var i = 0; i < 6; i++) dots += '<circle cx="' + (70 + i * 12) + '" cy="' + (48 + (i % 2) * 8) + '" r="3" fill="' + c[1] + '"/>';
    return '<path d="M52 82 Q52 36 100 34 Q148 36 148 82 Q126 64 100 64 Q74 64 52 82Z" fill="' + c0(c, 0) + '" ' + SW + '/>' + dots +
      '<path d="M140 76 L156 92 L146 96Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
  };
  T.cap = function (c) { return '<path d="M60 62 Q62 36 100 34 Q138 36 140 62Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M58 62 L150 62 Q160 66 150 70 L58 68Z" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.pilotka = function (c) { return '<path d="M60 58 L80 40 L120 40 L140 58 Q100 64 60 58Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M60 58 Q100 50 140 58" fill="none" ' + SW + '/><path d="M100 44 l3 6 6 1 -5 4 2 6 -6-3 -6 3 2-6 -5-4 6-1Z" fill="' + c0(c, 1) + '"/>'; };
  T.beret = function (c) { return '<path d="M54 60 Q58 30 104 30 Q150 34 146 56 Q120 66 54 60Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M104 30 l2 -8" ' + SW + ' fill="none"/>'; };
  T.ushanka = function (c) {
    return '<path d="M56 64 Q58 26 100 26 Q142 26 144 64Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M52 60 Q100 46 148 60 L148 70 Q100 58 52 70Z" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M50 64 Q44 86 54 104 Q62 96 60 68Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M150 64 Q156 86 146 104 Q138 96 140 68Z" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M94 36 h12 v12 h-12Z" fill="#e9c46a" ' + SW + '/>';
  };
  T.panama = function (c) { return '<path d="M44 64 Q100 46 156 64 Q150 74 100 70 Q50 74 44 64Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M64 62 Q66 34 100 34 Q134 34 136 62 Q100 56 64 62Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; };
  T.hardhat = function (c) { return '<path d="M58 62 Q60 26 100 26 Q140 26 142 62Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M50 62 L150 62 L150 70 L50 70Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M94 28 L106 28 L106 62 L94 62Z" fill="' + c0(c, 1) + '"/>'; };
  T.bowler = function (c) { return '<path d="M48 62 Q100 50 152 62 Q146 70 100 68 Q54 70 48 62Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M66 60 Q64 26 100 24 Q136 26 134 60 Q100 54 66 60Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M67 54 Q100 48 133 54 L133 60 Q100 54 67 60Z" fill="' + c0(c, 1) + '"/>'; };
  T.wreath = function (c) {
    var s = '';
    for (var i = 0; i < 9; i++) {
      var x = 58 + i * 10.5, y = 56 - Math.sin(i / 8 * Math.PI) * 12;
      s += '<ellipse cx="' + x + '" cy="' + y + '" rx="8" ry="5" transform="rotate(' + (i * 20 - 80) + ' ' + x + ' ' + y + ')" fill="' + c0(c, 0) + '" ' + SW + '/>';
      if (i % 2 === 0) s += '<circle cx="' + x + '" cy="' + (y - 6) + '" r="4.5" fill="' + (i % 4 === 0 ? c0(c, 1) : c0(c, 2)) + '" ' + SW + '/>';
    }
    return s;
  };
  T.helmet = function (c) {
    return '<path d="M58 66 Q60 36 100 22 Q140 36 142 66Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M100 22 L100 8" stroke="' + OUT + '" stroke-width="4"/><circle cx="100" cy="8" r="4" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M56 62 L144 62 L144 70 L56 70Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M96 70 L104 70 L102 96 L98 96Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M72 42 Q86 34 96 32" fill="none" stroke="#fff" stroke-width="3" opacity=".5" stroke-linecap="round"/>';
  };
  T.budenovka = function (c) {
    return '<path d="M58 66 Q60 36 100 14 Q140 36 142 66Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M100 14 L100 6" stroke="' + OUT + '" stroke-width="4"/><path d="M52 62 Q100 54 148 62 L150 72 Q100 64 50 72Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M100 32 l6 12 13 2 -10 9 3 13 -12-7 -12 7 3-13 -10-9 13-2Z" fill="' + c0(c, 1) + '" ' + SW + '/>';
  };
  T.tallfur = function (c) { return '<path d="M66 64 L70 6 Q100 -2 130 6 L134 64Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M74 60 L76 14 Q100 8 124 14 L126 60Z" fill="' + shade(c0(c, 0), 0.12) + '"/><path d="M58 60 Q100 50 142 60 L142 72 Q100 62 58 72Z" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.kokoshnik = function (c) {
    return '<path d="M56 70 Q56 20 100 10 Q144 20 144 70 Q100 58 56 70Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M66 64 Q68 30 100 22 Q132 30 134 64" fill="none" stroke="' + c0(c, 1) + '" stroke-width="4"/>' +
      '<circle cx="100" cy="36" r="6" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="80" cy="46" r="4" fill="#fff" ' + SW + '/><circle cx="120" cy="46" r="4" fill="#fff" ' + SW + '/>' +
      '<path d="M60 70 Q100 62 140 70" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/>';
  };
  T.tricorn = function (c) {
    return '<path d="M40 56 Q70 64 100 40 Q130 64 160 56 Q150 76 100 70 Q50 76 40 56Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M44 58 Q70 66 100 44 Q130 66 156 58" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3"/>';
  };
  T.tophat = function (c) { return '<path d="M46 62 Q100 52 154 62 Q150 70 100 68 Q50 70 46 62Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M70 60 L72 4 L128 4 L130 60Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M71 48 L129 48 L129 58 L71 58Z" fill="' + c0(c, 1) + '"/>'; };
  T.peaked = function (c) {
    return '<path d="M58 58 Q58 30 100 28 Q142 30 142 58Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M60 56 L140 56 L140 64 L60 64Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M60 64 Q100 60 140 64 Q140 76 100 74 Q64 76 60 64Z" fill="#15151a" ' + SW + '/>' +
      '<path d="M100 38 l4 8 9 1 -7 6 2 9 -8-5 -8 5 2-9 -7-6 9-1Z" fill="' + c0(c, 1) + '"/>';
  };
  T.tankcap = function (c) {
    return '<path d="M54 76 Q52 30 100 28 Q148 30 146 76 Q138 58 100 56 Q62 58 54 76Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M76 30 L76 56 M100 28 L100 56 M124 30 L124 56" stroke="' + c0(c, 1) + '" stroke-width="7"/><circle cx="54" cy="80" r="10" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="146" cy="80" r="10" fill="' + c0(c, 1) + '" ' + SW + '/>';
  };
  T.jester = function (c) {
    return '<path d="M58 64 Q60 44 100 42 Q140 44 142 64Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M64 52 Q40 30 30 50 Q46 40 74 50Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M100 44 Q100 10 86 6 Q96 24 90 44Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M136 52 Q160 30 170 50 Q154 40 126 50Z" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<circle cx="30" cy="52" r="5" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="86" cy="6" r="5" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="170" cy="52" r="5" fill="' + c0(c, 0) + '" ' + SW + '/>';
  };
  T.shako = function (c) {
    return '<path d="M68 64 L64 8 L136 8 L132 64Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M66 20 L134 20" stroke="' + c0(c, 1) + '" stroke-width="4"/><path d="M100 30 l6 10 -6 12 -6 -12Z" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M96 8 Q94 -8 100 -10 Q106 -8 104 8Z" fill="' + c0(c, 2) + '" ' + SW + '/><path d="M62 62 Q100 58 138 62 Q140 74 100 72 Q62 74 62 62Z" fill="#15151a" ' + SW + '/>';
  };
  T.klobuk = function (c) {
    return '<path d="M54 76 Q50 30 100 16 Q150 30 146 76 Q126 60 100 60 Q74 60 54 76Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M100 16 L100 0 M92 6 L108 6" stroke="' + c0(c, 1) + '" stroke-width="4" stroke-linecap="round"/><circle cx="100" cy="38" r="7" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M54 76 Q48 100 58 120 L66 110 Q60 94 62 80Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M146 76 Q152 100 142 120 L134 110 Q140 94 138 80Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
  };
  T.spacehelm = function (c) {
    return '<circle cx="100" cy="92" r="60" fill="' + c0(c, 2) + '" opacity=".22" ' + SW + '/>' +
      '<path d="M50 70 Q60 40 100 32" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".7"/>' +
      '<path d="M46 126 Q100 150 154 126 L150 140 Q100 162 50 140Z" fill="' + c0(c, 0) + '" ' + SW + '/><text x="100" y="146" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1) + '" font-family="Arial">СССР</text>';
  };
  T.papakha = function (c) {
    var s = '<path d="M56 66 L60 20 Q100 10 140 20 L144 66Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
    for (var i = 0; i < 12; i++) s += '<circle cx="' + (64 + (i % 6) * 14) + '" cy="' + (30 + Math.floor(i / 6) * 18) + '" r="6" fill="' + shade(c0(c, 0), 0.15) + '"/>';
    return s + '<path d="M76 20 Q100 26 124 20 L120 12 Q100 16 80 12Z" fill="' + c0(c, 1) + '" ' + SW + '/>';
  };
  T.crown = function (c) {
    return '<path d="M60 64 L60 30 Q80 6 100 20 Q120 6 140 30 L140 64Z" fill="' + c0(c, 2) + '" ' + SW + '/>' +
      '<path d="M100 20 L100 64" stroke="' + c0(c, 0) + '" stroke-width="6"/><path d="M60 30 Q80 6 100 20 Q120 6 140 30" fill="none" stroke="' + c0(c, 0) + '" stroke-width="5"/>' +
      '<path d="M100 20 L100 2 M92 8 L108 8" stroke="' + c0(c, 0) + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M56 58 L144 58 L144 70 L56 70Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<g fill="' + c0(c, 1) + '"><circle cx="68" cy="64" r="3"/><circle cx="82" cy="64" r="3"/><circle cx="118" cy="64" r="3"/><circle cx="132" cy="64" r="3"/></g><circle cx="100" cy="64" r="5" fill="' + c0(c, 2) + '" ' + SW + '/>';
  };
  T.bicorne = function (c) {
    return '<path d="M30 64 Q60 20 100 26 Q140 20 170 64 Q100 52 30 64Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M36 60 Q100 46 164 60" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3"/><circle cx="100" cy="42" r="7" fill="#fff" ' + SW + '/><circle cx="100" cy="42" r="3" fill="#c62828"/>';
  };
  T.laurel = function (c) {
    var s = '';
    for (var side = -1; side <= 1; side += 2) for (var i = 0; i < 6; i++) {
      var a = (200 + i * 22) * Math.PI / 180, x = 100 + side * Math.cos(a) * -46, y = 76 + Math.sin(a) * 36;
      s += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" rx="9" ry="4.5" transform="rotate(' + (side * (i * 22 - 40)) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')" fill="' + c0(c, 0) + '" ' + SW + '/>';
    }
    return '<g class="it-shine">' + s + '</g>';
  };
  T.monomakh = function (c) {
    return '<g class="it-mythic">' +
      '<path d="M58 70 Q56 40 70 30 Q100 12 130 30 Q144 40 142 70Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M70 30 Q100 50 130 30 M62 48 Q100 64 138 48" fill="none" stroke="' + shade(c0(c, 0), -0.3) + '" stroke-width="2.5"/>' +
      '<circle cx="84" cy="42" r="4" fill="' + c0(c, 2) + '"/><circle cx="116" cy="42" r="4" fill="#b3123a"/><circle cx="100" cy="30" r="4" fill="#2f63c9"/>' +
      '<path d="M100 14 L100 -2 M92 4 L108 4" stroke="' + c0(c, 0) + '" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M52 66 Q100 52 148 66 Q148 82 100 76 Q52 82 52 66Z" fill="' + c0(c, 1) + '" ' + SW + '/></g>';
  };

  // Одежда (туловище 60…140 × 118…186)
  function torso(fill, extra) { return '<path d="M62 136 Q66 118 100 118 Q134 118 138 136 L140 170 Q100 190 60 170Z" fill="' + fill + '" ' + SW + '/>' + (extra || ''); }
  // Рукава — в тех же «шарнирах», что и лапы: машет лапа — машет и рукав.
  function sleeves(fill) { return '<g class="pet-arm-l"><ellipse cx="62" cy="150" rx="11" ry="16" transform="rotate(20 62 150)" fill="' + fill + '" ' + SW + '/></g><g class="pet-arm-r"><ellipse cx="138" cy="150" rx="11" ry="16" transform="rotate(-20 138 150)" fill="' + fill + '" ' + SW + '/></g>'; }
  T.shirt = function (c) { return torso(c0(c, 0), '<path d="M100 120 L100 150" stroke="' + c0(c, 1) + '" stroke-width="3"/><path d="M84 120 Q100 128 116 120" fill="none" stroke="' + c0(c, 1) + '" stroke-width="4"/><path d="M60 168 Q100 186 140 168" fill="none" stroke="' + c0(c, 1) + '" stroke-width="4"/>') + sleeves(c0(c, 0)); };
  T.coat = function (c) { return torso(c0(c, 0), '<path d="M100 118 L100 184" stroke="' + OUT + '" stroke-width="2"/><path d="M78 118 Q100 136 122 118" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M62 166 Q100 184 138 166 L140 174 Q100 192 60 174Z" fill="' + c0(c, 1) + '" ' + SW + '/>') + sleeves(c0(c, 0)); };
  T.stripes = function (c) {
    var s = '';
    for (var y = 126; y < 184; y += 9) s += '<path d="M58 ' + y + ' L142 ' + y + '" stroke="' + c0(c, 1) + '" stroke-width="4.5"/>';
    var id = uid('clip');
    return '<clipPath id="' + id + '"><path d="M62 136 Q66 118 100 118 Q134 118 138 136 L140 170 Q100 190 60 170Z"/></clipPath>' + torso(c0(c, 0), '<g clip-path="url(#' + id + ')">' + s + '</g>') + sleeves(c0(c, 0));
  };
  T.uniform = function (c) { return torso(c0(c, 0), '<path d="M86 120 L100 138 L114 120" fill="#fff" ' + SW + '/><g fill="' + c0(c, 1) + '"><circle cx="100" cy="148" r="2.6"/><circle cx="100" cy="160" r="2.6"/><circle cx="100" cy="172" r="2.6"/></g>') + sleeves(c0(c, 0)); };
  T.quilt = function (c) {
    var s = '';
    for (var y = 128; y < 186; y += 11) s += '<path d="M60 ' + y + ' L140 ' + y + '" stroke="' + c0(c, 1) + '" stroke-width="2"/>';
    return torso(c0(c, 0), s + '<path d="M100 118 L100 184" stroke="' + OUT + '" stroke-width="2"/>') + sleeves(c0(c, 0));
  };
  T.dress = function (c) { return '<path d="M74 122 Q100 116 126 122 L146 184 Q100 196 54 184Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M58 172 Q100 184 142 172" fill="none" stroke="' + c0(c, 1) + '" stroke-width="5"/><path d="M86 122 L86 140 M114 122 L114 140" stroke="' + c0(c, 1) + '" stroke-width="3"/>' + sleeves('#ffffff'); };
  T.sweater = function (c) {
    var s = '';
    for (var i = 0; i < 5; i++) s += '<path d="M' + (70 + i * 15) + ' 150 l5 -7 5 7 -5 7Z" fill="' + c0(c, 1) + '"/>';
    return torso(c0(c, 0), '<path d="M62 142 L138 142 M62 158 L138 158" stroke="' + c0(c, 1) + '" stroke-width="3"/>' + s + '<path d="M82 120 Q100 130 118 120" fill="none" stroke="' + c0(c, 1) + '" stroke-width="5"/>') + sleeves(c0(c, 0));
  };
  T.apron = function (c) { return '<path d="M76 128 L124 128 L128 184 Q100 192 72 184Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M76 128 Q70 110 88 112 M124 128 Q130 110 112 112" fill="none" stroke="' + c0(c, 0) + '" stroke-width="4"/><path d="M84 150 h32 v18 h-32Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; };
  T.hoodie = function (c) { return torso(c0(c, 0), '<path d="M76 120 Q100 142 124 120" fill="' + shade(c0(c, 0), 0.15) + '" ' + SW + '/><path d="M92 128 L90 146 M108 128 L110 146" stroke="#fff" stroke-width="2"/><text x="100" y="170" text-anchor="middle" font-size="10" font-weight="900" fill="' + c0(c, 1) + '" font-family="Arial">ЕГЭ</text>') + sleeves(c0(c, 0)); };
  T.mail = function (c) {
    var s = '';
    for (var y = 126; y < 186; y += 7) for (var x = 62 + (y % 14 ? 3.5 : 0); x < 140; x += 7) s += '<circle cx="' + x + '" cy="' + y + '" r="3" fill="none" stroke="' + c0(c, 1) + '" stroke-width="1.2"/>';
    var id = uid('clip');
    return '<clipPath id="' + id + '"><path d="M62 136 Q66 118 100 118 Q134 118 138 136 L140 170 Q100 190 60 170Z"/></clipPath>' + torso(c0(c, 0), '<g clip-path="url(#' + id + ')">' + s + '</g>') + sleeves(c0(c, 0));
  };
  T.kaftan = function (c) { return torso(c0(c, 0), '<path d="M92 118 L92 186 M108 118 L108 186" stroke="' + c0(c, 1) + '" stroke-width="3"/><g stroke="' + c0(c, 1) + '" stroke-width="3" stroke-linecap="round"><path d="M86 132 h28 M86 146 h28 M86 160 h28 M86 174 h28"/></g>') + sleeves(c0(c, 0)); };
  T.tailcoat = function (c) { return torso(c0(c, 0), '<path d="M86 118 L100 150 L114 118Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M94 124 l6 4 6 -4 v8 l-6 -4 -6 4Z" fill="' + OUT + '"/>') + '<path d="M74 176 L66 196 L86 186Z M126 176 L134 196 L114 186Z" fill="' + c0(c, 0) + '" ' + SW + '/>' + sleeves(c0(c, 0)); };
  T.tunic = function (c) { return torso(c0(c, 0), '<path d="M60 158 L140 158" stroke="#3a2a1e" stroke-width="7"/><rect x="94" y="154" width="12" height="9" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M100 118 L100 150" stroke="' + OUT + '" stroke-width="1.5"/><path d="M76 132 h14 v8 h-14Z M110 132 h14 v8 h-14Z" fill="none" ' + SW + '/>') + sleeves(c0(c, 0)); };
  T.leather = function (c) { return torso(c0(c, 0), '<path d="M78 118 L96 146 L100 184 M122 118 L104 146" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3"/><path d="M70 130 Q80 124 84 132" fill="none" stroke="#fff" stroke-width="2" opacity=".35"/><path d="M112 154 l4 8 8 1 -6 5 2 8 -8-4 -8 4 2-8 -6-5 8-1Z" fill="#c62828"/>') + sleeves(c0(c, 0)); };
  T.greatcoat = function (c) { return '<path d="M62 132 Q66 118 100 118 Q134 118 138 132 L148 190 L52 190Z" fill="' + c0(c, 0) + '" ' + SW + '/><g fill="' + c0(c, 1) + '"><circle cx="90" cy="140" r="2.6"/><circle cx="110" cy="140" r="2.6"/><circle cx="90" cy="158" r="2.6"/><circle cx="110" cy="158" r="2.6"/><circle cx="90" cy="176" r="2.6"/><circle cx="110" cy="176" r="2.6"/></g><path d="M78 120 L100 132 L122 120" fill="' + shade(c0(c, 0), -0.15) + '" ' + SW + '/>' + sleeves(c0(c, 0)); };
  T.robe = function (c) { return '<path d="M66 128 Q70 118 100 118 Q130 118 134 128 L150 192 L50 192Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M100 124 L100 190" stroke="' + c0(c, 1) + '" stroke-width="3"/><path d="M94 134 h12 M100 128 v14" stroke="#e9c46a" stroke-width="3" stroke-linecap="round"/>' + sleeves(c0(c, 0)); };
  T.sailor = function (c) { return torso(c0(c, 0), '<path d="M76 118 L100 146 L124 118 L130 132 L100 154 L70 132Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M78 124 L100 148 L122 124" fill="none" stroke="#fff" stroke-width="2"/><path d="M94 150 l6 10 6 -10" fill="#c62828" ' + SW + '/>') + sleeves(c0(c, 0)); };
  T.guard = function (c) { return torso(c0(c, 0), '<path d="M86 118 L86 186 M114 118 L114 186" stroke="' + c0(c, 1) + '" stroke-width="6"/><g fill="' + c0(c, 2) + '"><circle cx="86" cy="134" r="3"/><circle cx="86" cy="150" r="3"/><circle cx="86" cy="166" r="3"/><circle cx="114" cy="134" r="3"/><circle cx="114" cy="150" r="3"/><circle cx="114" cy="166" r="3"/></g><path d="M86 118 Q100 128 114 118" fill="' + c0(c, 1) + '" ' + SW + '/>') + sleeves(c0(c, 0)) + '<path d="M50 136 l16 -4 M150 136 l-16 -4" stroke="' + c0(c, 2) + '" stroke-width="5" stroke-linecap="round"/>'; };
  T.hussar = function (c) {
    var s = '';
    for (var y = 130; y < 180; y += 8) s += '<path d="M78 ' + y + ' Q100 ' + (y + 5) + ' 122 ' + y + '" fill="none" stroke="' + c0(c, 1) + '" stroke-width="2.5"/>';
    return torso(c0(c, 0), s + '<g fill="' + c0(c, 1) + '"><circle cx="100" cy="132" r="2.5"/><circle cx="100" cy="147" r="2.5"/><circle cx="100" cy="162" r="2.5"/><circle cx="100" cy="177" r="2.5"/></g>') + sleeves(c0(c, 0)) +
      '<path d="M130 124 Q160 130 156 170 L140 172 Q144 142 124 132Z" fill="' + shade(c0(c, 0), -0.2) + '" ' + SW + '/><path d="M140 168 Q148 172 156 168" stroke="#fff" stroke-width="5"/>';
  };
  T.furcoat = function (c) {
    return '<path d="M60 134 Q64 118 100 118 Q136 118 140 134 L146 188 L54 188Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M88 120 L90 188 L110 188 L112 120Z" fill="' + c0(c, 2) + '" opacity=".35"/>' +
      '<path d="M66 120 Q100 108 134 120 Q134 134 100 134 Q66 134 66 120Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M54 182 L146 182 L146 192 L54 192Z" fill="' + c0(c, 1) + '" ' + SW + '/>' + sleeves(c0(c, 0)) +
      '<g fill="' + c0(c, 2) + '"><circle cx="100" cy="146" r="3"/><circle cx="100" cy="160" r="3"/><circle cx="100" cy="174" r="3"/></g>';
  };
  T.spacesuit = function (c) { return torso(c0(c, 0), '<rect x="84" y="138" width="32" height="24" rx="4" fill="#dfe6ee" ' + SW + '/><circle cx="92" cy="146" r="3" fill="' + c0(c, 1) + '"/><circle cx="100" cy="146" r="3" fill="#2f63c9"/><circle cx="108" cy="146" r="3" fill="#18a058"/><path d="M88 156 h24" stroke="' + OUT + '" stroke-width="2"/>') + sleeves(c0(c, 0)) + '<path d="M54 146 h14 M132 146 h14" stroke="' + c0(c, 1) + '" stroke-width="4"/>'; };
  T.plate = function (c) { return torso(c0(c, 0), '<path d="M72 124 Q100 116 128 124 L126 150 Q100 160 74 150Z" fill="' + c0(c, 1) + '" opacity=".6"/><path d="M94 130 h12 v26 h-12Z M84 138 h32 v10 h-32Z" fill="' + c0(c, 2) + '"/><path d="M70 164 Q100 174 130 164" fill="none" ' + SW + '/>') + sleeves(c0(c, 0)); };
  T.mantle = function (c) {
    var s = '';
    for (var i = 0; i < 14; i++) s += '<path d="M' + (52 + (i % 7) * 16) + ' ' + (140 + Math.floor(i / 7) * 24) + ' q2 -5 4 0 q-2 4 -4 0Z" fill="' + c0(c, 2) + '"/>';
    return '<g class="it-shine"><path d="M40 190 Q44 128 70 118 L130 118 Q156 128 160 190Z" fill="' + c0(c, 1) + '" ' + SW + '/>' + s +
      '<path d="M66 118 Q100 132 134 118 L134 130 Q100 144 66 130Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M40 190 Q44 128 70 118" fill="none" stroke="' + c0(c, 0) + '" stroke-width="6"/><path d="M160 190 Q156 128 130 118" fill="none" stroke="' + c0(c, 0) + '" stroke-width="6"/>' +
      '<path d="M84 124 L100 184 L116 124Z" fill="' + c0(c, 0) + '" opacity=".5"/></g>' + sleeves(c0(c, 0));
  };
  T.marshal = function (c) { return torso(c0(c, 0), '<path d="M86 118 L100 134 L114 118" fill="' + c0(c, 2) + '" ' + SW + '/><g fill="' + c0(c, 1) + '"><circle cx="100" cy="146" r="3"/><circle cx="100" cy="160" r="3"/><circle cx="100" cy="174" r="3"/></g><path d="M112 142 l3 6 7 1 -5 5 1 7 -6-3 -6 3 1-7 -5-5 7-1Z" fill="' + c0(c, 1) + '" ' + SW + '/><rect x="72" y="142" width="16" height="4" fill="' + c0(c, 2) + '"/><rect x="72" y="148" width="16" height="4" fill="#2f63c9"/><rect x="72" y="154" width="16" height="4" fill="' + c0(c, 1) + '"/>') + sleeves(c0(c, 0)) + '<path d="M48 136 l20 -4 M152 136 l-20 -4" stroke="' + c0(c, 1) + '" stroke-width="6" stroke-linecap="round"/>'; };
  T.firecloak = function (c) {
    var s = '';
    for (var i = 0; i < 9; i++) {
      var x = 44 + i * 14;
      s += '<path d="M' + x + ' 190 Q' + (x - 6) + ' 150 ' + (x + 7) + ' 128 Q' + (x + 18) + ' 156 ' + (x + 12) + ' 190Z" fill="' + (i % 2 ? c0(c, 0) : c0(c, 2)) + '" ' + SW + '/>';
      s += '<path d="M' + (x + 6) + ' 186 Q' + (x + 2) + ' 160 ' + (x + 7) + ' 146" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3"/>';
    }
    return '<g class="it-mythic it-flicker">' + s + '</g>' + sleeves(c0(c, 0));
  };

  // Лицо
  T.roundglasses = function (c) { return '<g fill="rgba(255,255,255,.25)" stroke="' + c0(c, 0) + '" stroke-width="3"><circle cx="82" cy="90" r="12"/><circle cx="118" cy="90" r="12"/></g><path d="M94 90 Q100 85 106 90 M70 88 L56 84 M130 88 L144 84" fill="none" stroke="' + c0(c, 0) + '" stroke-width="3"/>'; };
  T.shades = function (c) { return '<path d="M66 82 L98 82 Q98 102 84 102 Q66 102 66 82Z M102 82 L134 82 Q134 102 116 102 Q102 102 102 82Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M98 86 L102 86 M66 84 L54 80 M134 84 L146 80" stroke="' + OUT + '" stroke-width="3"/><path d="M72 86 L80 86" stroke="#fff" stroke-width="2.5" opacity=".6"/>'; };
  T.blush = function (c) { return '<ellipse cx="70" cy="104" rx="10" ry="6" fill="' + c0(c, 0) + '" opacity=".75"/><ellipse cx="130" cy="104" rx="10" ry="6" fill="' + c0(c, 0) + '" opacity=".75"/>'; };
  T.mustache = function (c) {
    var col = c0(c, 0), kind = c[1];
    if (kind === 'wide') return '<path d="M100 106 Q82 96 60 110 Q62 100 74 98 Q90 96 100 102 Q110 96 126 98 Q138 100 140 110 Q118 96 100 106Z" fill="' + col + '" ' + SW + '/>';
    if (kind === 'peter') return '<path d="M100 104 Q88 100 78 104 Q70 96 66 98 Q74 110 100 108 Q126 110 134 98 Q130 96 122 104 Q112 100 100 104Z" fill="' + col + '" ' + SW + '/>';
    return '<path d="M100 105 Q90 100 84 106 Q92 104 100 108 Q108 104 116 106 Q110 100 100 105Z" fill="' + col + '" stroke="' + OUT + '" stroke-width="1.5"/>';
  };
  T.plaster = function (c) { return '<g transform="rotate(-20 126 72)"><rect x="112" y="66" width="28" height="11" rx="4" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M122 70 v4 M126 70 v4 M130 70 v4" stroke="' + shade(c0(c, 0), -0.3) + '" stroke-width="1.4"/></g>'; };
  T.freckles = function (c) { var s = ''; [[66, 100], [72, 104], [68, 108], [134, 100], [128, 104], [132, 108]].forEach(function (p) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.8" fill="' + c0(c, 0) + '"/>'; }); return s; };
  T.pincenez = function (c) { return '<g fill="rgba(255,255,255,.3)" stroke="' + c0(c, 0) + '" stroke-width="2.5"><ellipse cx="84" cy="94" rx="10" ry="8"/><ellipse cx="116" cy="94" rx="10" ry="8"/></g><path d="M94 92 Q100 88 106 92" fill="none" stroke="' + c0(c, 0) + '" stroke-width="2.5"/><path d="M126 96 Q140 116 128 138" fill="none" stroke="' + c0(c, 0) + '" stroke-width="1.5"/>'; };
  T.monocle = function (c) { return '<circle cx="118" cy="90" r="13" fill="rgba(255,255,255,.3)" stroke="' + c0(c, 0) + '" stroke-width="3.5"/><path d="M130 96 Q146 120 132 146" fill="none" stroke="' + c0(c, 0) + '" stroke-width="1.8"/>'; };
  T.beard = function (c) { return '<path d="M64 106 Q66 150 100 160 Q134 150 136 106 Q120 118 100 116 Q80 118 64 106Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M86 130 Q90 142 96 148 M104 148 Q110 142 114 130" fill="none" stroke="' + shade(c0(c, 0), -0.3) + '" stroke-width="2"/><ellipse cx="100" cy="112" rx="6" ry="3" fill="#7a2233"/>'; };
  T.goggles = function (c) { return '<path d="M54 84 L146 84" stroke="' + c0(c, 0) + '" stroke-width="8"/><g fill="' + c0(c, 1) + '" ' + SW + '><circle cx="82" cy="88" r="14"/><circle cx="118" cy="88" r="14"/></g><path d="M74 82 Q78 78 84 80 M110 82 Q114 78 120 80" stroke="#fff" stroke-width="2.5" fill="none"/>'; };
  T.mask = function (c) { return '<g class="it-shine"><path d="M60 84 Q70 72 86 78 Q100 86 114 78 Q130 72 140 84 Q136 102 118 102 Q106 100 100 94 Q94 100 82 102 Q64 102 60 84Z" fill="' + c0(c, 1) + '" ' + SW + '/><ellipse cx="83" cy="89" rx="8" ry="6" fill="' + OUT + '"/><ellipse cx="117" cy="89" rx="8" ry="6" fill="' + OUT + '"/><path d="M60 84 Q46 60 56 50 M140 84 Q154 60 144 50" fill="none" stroke="' + c0(c, 0) + '" stroke-width="4"/><circle cx="56" cy="48" r="5" fill="' + c0(c, 0) + '"/><circle cx="144" cy="48" r="5" fill="' + c0(c, 0) + '"/></g>'; };
  T.stareyes = function (c) {
    function star(x, y) { return '<path class="it-twinkle" d="M' + x + ' ' + (y - 12) + ' L' + (x + 3.5) + ' ' + (y - 3.5) + ' L' + (x + 12) + ' ' + y + ' L' + (x + 3.5) + ' ' + (y + 3.5) + ' L' + x + ' ' + (y + 12) + ' L' + (x - 3.5) + ' ' + (y + 3.5) + ' L' + (x - 12) + ' ' + y + ' L' + (x - 3.5) + ' ' + (y - 3.5) + 'Z" fill="' + c0(c, 0) + '" stroke="' + c0(c, 1) + '" stroke-width="1.5"/>'; }
    return '<g class="it-mythic">' + star(82, 90) + star(118, 90) + '</g>';
  };

  // Шея (под подбородком, y≈126…150)
  T.tie = function (c) { return '<path d="M84 124 L100 134 L116 124 L112 134 L100 138 L88 134Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M96 136 L88 164 L96 160 L100 138Z M104 136 L112 164 L104 160 L100 138Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; };
  T.scarf = function (c) {
    return '<path d="M66 124 Q100 140 134 124 L136 136 Q100 152 64 136Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M114 136 L120 170 L132 168 L126 134Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M80 130 L80 144 M96 136 L96 148 M118 144 L128 142 M120 156 L130 154" stroke="' + c0(c, 1) + '" stroke-width="4"/>';
  };
  T.bowtie = function (c) { return '<path d="M100 132 L82 122 L82 142Z M100 132 L118 122 L118 142Z" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="100" cy="132" r="5" fill="' + shade(c0(c, 0), 0.2) + '" ' + SW + '/>'; };
  T.beads = function (c) { var s = ''; for (var i = 0; i < 9; i++) { var a = (20 + i * 17.5) * Math.PI / 180; s += '<circle cx="' + (100 - Math.cos(a) * 30).toFixed(1) + '" cy="' + (124 + Math.sin(a) * 16).toFixed(1) + '" r="4.5" fill="' + (i % 2 ? '#f2c14e' : c0(c, 0)) + '" ' + SW + '/>'; } return s; };
  T.badge = function (c) { return '<path d="M112 138 L118 128 L124 138Z" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="118" cy="146" r="9" fill="' + c0(c, 0) + '" ' + SW + '/><text x="118" y="149.5" text-anchor="middle" font-size="7" font-weight="900" fill="' + OUT + '" font-family="Arial">ГТО</text>'; };
  T.jabot = function (c) { var s = ''; for (var i = 0; i < 4; i++) s += '<path d="M' + (88 - i * 2) + ' ' + (126 + i * 9) + ' Q100 ' + (136 + i * 9) + ' ' + (112 + i * 2) + ' ' + (126 + i * 9) + ' Q100 ' + (144 + i * 9) + ' ' + (88 - i * 2) + ' ' + (126 + i * 9) + 'Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; return s; };
  T.sash = function (c) { return '<path d="M70 124 L80 120 L136 178 L126 184Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M126 176 l6 8 -2 10 -6 -6 -6 6 -2 -10Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M118 158 l4 8 9 1 -7 6 2 9 -8-5 -8 5 2-9 -7-6 9-1Z" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.fur = function (c) { var s = ''; for (var i = 0; i < 10; i++) { var a = (15 + i * 16.7) * Math.PI / 180; s += '<circle cx="' + (100 - Math.cos(a) * 36).toFixed(1) + '" cy="' + (126 + Math.sin(a) * 14).toFixed(1) + '" r="8" fill="' + (i % 2 ? c0(c, 1) : c0(c, 0)) + '" ' + SW + '/>'; } return s; };
  T.barmy = function (c) {
    var s = '<path d="M64 124 Q100 168 136 124 Q134 140 100 156 Q66 140 64 124Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
    [[78, 138], [100, 148], [122, 138]].forEach(function (p, i) { s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="6" fill="' + (i === 1 ? c0(c, 1) : c0(c, 2)) + '" ' + SW + '/>'; });
    return '<g class="it-shine">' + s + '</g>';
  };
  T.order = function (c) { return '<path d="M76 122 L100 140 L124 122" fill="none" stroke="' + c0(c, 0) + '" stroke-width="6"/><path d="M100 136 L110 146 L100 168 L90 146Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M88 150 L112 150 M100 138 L100 164" stroke="' + c0(c, 1) + '" stroke-width="4"/><circle cx="100" cy="150" r="5" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.chain = function (c) { var s = ''; for (var i = 0; i < 11; i++) { var a = (15 + i * 15) * Math.PI / 180; s += '<ellipse cx="' + (100 - Math.cos(a) * 34).toFixed(1) + '" cy="' + (124 + Math.sin(a) * 24).toFixed(1) + '" rx="5" ry="3.5" fill="none" stroke="' + c0(c, 0) + '" stroke-width="3"/>'; } return '<g class="it-shine">' + s + '<circle cx="100" cy="154" r="9" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="100" cy="154" r="4" fill="' + c0(c, 1) + '"/></g>'; };

  // В руке (правая лапа ≈ 140,152; предмет поднимается вверх-вправо)
  function held(inner) { return '<g class="pet-held">' + inner + '</g>'; }
  T.quill = function (c) { return held('<path d="M142 160 Q150 118 176 96 Q170 130 146 162Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M142 162 L176 96" stroke="' + OUT + '" stroke-width="1.5"/><path d="M140 166 L143 158" stroke="' + c0(c, 1) + '" stroke-width="3"/>'); };
  T.scroll = function (c) { return held('<rect x="134" y="130" width="34" height="40" rx="3" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M140 140 h22 M140 148 h18 M140 156 h22" stroke="' + c0(c, 1) + '" stroke-width="2"/><circle cx="134" cy="130" r="5" fill="' + shade(c0(c, 0), -0.2) + '" ' + SW + '/><circle cx="134" cy="170" r="5" fill="' + shade(c0(c, 0), -0.2) + '" ' + SW + '/>'); };
  T.book = function (c) { return held('<path d="M132 132 L166 126 L170 168 L136 174Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M138 134 L138 172" stroke="' + shade(c0(c, 0), -0.3) + '" stroke-width="3"/><text x="153" y="154" text-anchor="middle" font-size="9" font-weight="900" fill="' + c0(c, 1) + '" font-family="Arial" transform="rotate(-9 153 154)">ЕГЭ</text>'); };
  T.abacus = function (c) { var s = '<rect x="132" y="128" width="40" height="36" rx="3" fill="' + c0(c, 1) + '" ' + SW + '/>'; for (var r = 0; r < 4; r++) { s += '<path d="M134 ' + (136 + r * 8) + ' h36" stroke="' + OUT + '" stroke-width="1.2"/>'; for (var i = 0; i < 4; i++) s += '<circle cx="' + (140 + i * 6 + (r % 2) * 10) + '" cy="' + (136 + r * 8) + '" r="2.8" fill="' + c0(c, 0) + '"/>'; } return held(s); };
  T.balalaika = function (c) { return held('<path d="M136 176 L178 160 L160 136Z" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="160" cy="158" r="4" fill="' + OUT + '"/><path d="M160 136 L178 92" stroke="' + c0(c, 1) + '" stroke-width="5" stroke-linecap="round"/><path d="M172 92 L184 96 L180 86Z" fill="' + c0(c, 1) + '" ' + SW + '/>'); };
  T.cup = function (c) { return held('<path d="M134 142 L162 142 L158 168 Q148 174 138 168Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M162 148 Q172 150 168 158 Q164 162 159 160" fill="none" ' + SW + '/><path d="M138 152 h20" stroke="' + c0(c, 1) + '" stroke-width="3"/><path class="it-steam" d="M142 136 q-4 -8 2 -14 M152 136 q-4 -8 2 -14" fill="none" stroke="#bbb" stroke-width="2" stroke-linecap="round"/>'); };
  T.flag = function (c) { return held('<path d="M146 168 L152 90" stroke="' + c0(c, 1) + '" stroke-width="4" stroke-linecap="round"/><path class="it-wave" d="M152 92 Q168 86 184 94 L182 118 Q166 112 150 118Z" fill="' + c0(c, 0) + '" ' + SW + '/>'); };
  T.saber = function (c) { return held('<path d="M144 160 Q170 120 176 74 Q162 116 138 154Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M134 150 L152 162" stroke="' + c0(c, 1) + '" stroke-width="5" stroke-linecap="round"/><path d="M142 158 L136 172" stroke="' + OUT + '" stroke-width="6" stroke-linecap="round"/>'); };
  T.bow = function (c) { return held('<path d="M152 88 Q184 130 152 176" fill="none" stroke="' + c0(c, 0) + '" stroke-width="6" stroke-linecap="round"/><path d="M152 88 L152 176" stroke="' + c0(c, 1) + '" stroke-width="1.5"/>'); };
  T.clock = function (c) { return held('<circle cx="154" cy="146" r="16" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="154" cy="146" r="11" fill="' + c0(c, 1) + '"/><path d="M154 146 L154 138 M154 146 L160 148" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/><circle cx="142" cy="130" r="5" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="166" cy="130" r="5" fill="' + c0(c, 0) + '" ' + SW + '/>'); };
  T.guitar = function (c) { return held('<ellipse cx="146" cy="164" rx="14" ry="12" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="154" cy="146" rx="10" ry="9" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="149" cy="158" r="4" fill="' + OUT + '"/><path d="M156 144 L180 96" stroke="' + c0(c, 1) + '" stroke-width="5" stroke-linecap="round"/>'); };
  T.spyglass = function (c) { return held('<path d="M138 164 L178 118" stroke="' + c0(c, 1) + '" stroke-width="9" stroke-linecap="round"/><path d="M158 140 L182 112" stroke="' + c0(c, 0) + '" stroke-width="12" stroke-linecap="round"/><circle cx="184" cy="110" r="5" fill="#7fc8f8" ' + SW + '/>'); };
  T.gusli = function (c) { var s = '<path d="M130 172 L176 150 L168 124 L136 140Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; for (var i = 0; i < 5; i++) s += '<path d="M' + (138 + i * 7) + ' ' + (166 - i * 3) + ' L' + (140 + i * 6) + ' ' + (140 - i * 2) + '" stroke="#f4f1e6" stroke-width="1.2"/>'; return held(s + '<circle cx="152" cy="152" r="4" fill="' + c0(c, 1) + '"/>'); };
  T.sword = function (c) { return held('<g class="it-shine"><path d="M146 150 L174 70 L180 74 L152 152Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M136 146 L164 160" stroke="' + c0(c, 1) + '" stroke-width="6" stroke-linecap="round"/><path d="M148 156 L142 172" stroke="' + OUT + '" stroke-width="6" stroke-linecap="round"/><circle cx="141" cy="174" r="4" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M166 96 L172 80" stroke="' + c0(c, 2) + '" stroke-width="2.5"/></g>'); };
  T.scepter = function (c) { return held('<g class="it-shine"><path d="M146 168 L166 90" stroke="' + c0(c, 0) + '" stroke-width="6" stroke-linecap="round"/><circle cx="167" cy="84" r="9" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M167 72 L167 64 M162 68 L172 68" stroke="' + c0(c, 0) + '" stroke-width="3" stroke-linecap="round"/><path d="M150 132 h12" stroke="' + c0(c, 0) + '" stroke-width="8" stroke-linecap="round"/></g>'); };
  T.torch = function (c) { return held('<path d="M142 168 L154 118 L166 122 L150 170Z" fill="' + c0(c, 0) + '" ' + SW + '/><path class="it-flicker" d="M160 118 Q146 100 160 80 Q162 94 170 96 Q176 110 160 118Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M160 114 Q154 104 161 96 Q164 106 160 114Z" fill="#ffe066"/>'); };
  T.orb = function (c) { return held('<g class="it-shine"><circle cx="156" cy="150" r="16" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M140 150 h32 M156 134 v32" stroke="' + shade(c0(c, 0), -0.3) + '" stroke-width="2"/><circle cx="156" cy="150" r="5" fill="' + c0(c, 1) + '"/><path d="M156 134 L156 120 M150 126 L162 126" stroke="' + c0(c, 0) + '" stroke-width="4" stroke-linecap="round"/><path d="M146 142 Q148 138 152 137" stroke="#fff" stroke-width="2.5" fill="none"/></g>'); };
  T.sputnik = function (c) { return held('<g class="it-mythic it-float"><circle cx="160" cy="112" r="12" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M150 120 L128 164 M156 124 L146 170 M166 122 L172 168 M170 118 L190 158" stroke="' + c0(c, 1) + '" stroke-width="2"/><path d="M154 106 Q158 102 164 103" stroke="#fff" stroke-width="2.5" fill="none"/><circle class="it-twinkle" cx="178" cy="92" r="2.5" fill="#fff"/></g>'); };

  // Место (фон целиком, 200×200; земля у y≈188)
  function sky(top, bottom) { var id = uid('sky'); return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/></linearGradient></defs><rect width="200" height="200" fill="url(#' + id + ')"/>'; }
  function ground(col) { return '<path d="M0 176 Q100 166 200 176 L200 200 L0 200Z" fill="' + col + '"/>'; }
  T.bg_izba = function (c) { return sky(c0(c, 0), '#fff8ea') + '<path d="M18 120 L60 88 L102 120Z" fill="#6b3f22"/><rect x="24" y="118" width="72" height="56" fill="' + c0(c, 1) + '"/><g stroke="#6b3f22" stroke-width="2">' + [128, 140, 152, 164].map(function (y) { return '<path d="M24 ' + y + ' H96"/>'; }).join('') + '</g><rect x="48" y="132" width="22" height="18" fill="#bfe3ff" stroke="#6b3f22" stroke-width="3"/>' + ground('#8fc26a'); };
  T.bg_field = function (c) { var s = sky(c0(c, 0), '#f4fbff') + '<circle cx="160" cy="36" r="16" fill="#ffd23f"/>' + ground(c0(c, 1)); for (var i = 0; i < 26; i++) s += '<path d="M' + (i * 8) + ' 190 q2 -18 0 -30" stroke="#b8912f" stroke-width="2" fill="none"/>'; return s; };
  T.bg_class = function (c) { return '<rect width="200" height="200" fill="' + c0(c, 0) + '"/><rect x="20" y="24" width="160" height="80" rx="4" fill="' + c0(c, 1) + '" stroke="#8a5a2b" stroke-width="5"/><text x="100" y="58" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial">1242 — Ледовое</text><text x="100" y="78" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial">побоище</text><rect x="0" y="170" width="200" height="30" fill="#c9a877"/>'; };
  T.bg_birch = function (c) { var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/>'; [20, 58, 150, 184].forEach(function (x, i) { s += '<rect x="' + x + '" y="0" width="12" height="190" fill="' + c0(c, 1) + '" stroke="#ccc"/><path d="M' + x + ' ' + (40 + i * 10) + ' h6 M' + (x + 6) + ' ' + (90 + i * 7) + ' h6 M' + x + ' ' + (130 + i * 5) + ' h7" stroke="#333" stroke-width="3"/>'; }); return s + ground('#9fd08a'); };
  T.bg_river = function (c) { return sky(c0(c, 0), '#eaf6ff') + '<path d="M0 132 Q60 124 120 134 T200 130 L200 200 L0 200Z" fill="' + c0(c, 1) + '"/><path class="it-wave" d="M20 150 q10 -4 20 0 M90 160 q10 -4 20 0 M150 146 q10 -4 20 0" stroke="#fff" stroke-width="2" fill="none"/><path d="M0 178 Q100 168 200 178 L200 200 L0 200Z" fill="#e3c98f"/>'; };
  T.bg_room = function (c) { var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/>'; for (var x = 0; x < 200; x += 20) s += '<path d="M' + x + ' 0 V170" stroke="' + shade(c0(c, 0), -0.08) + '" stroke-width="8"/>'; return s + '<rect x="120" y="30" width="56" height="70" fill="' + c0(c, 1) + '" stroke="#6b3f22" stroke-width="4"/><path d="M130 40 h36 v50 h-36Z" fill="none" stroke="#e9c46a" stroke-width="2"/><rect x="0" y="170" width="200" height="30" fill="#8a5a2b"/>'; };
  T.bg_veche = function (c) { return sky(c0(c, 0), '#fff') + '<path d="M130 60 L160 40 L190 60 L190 170 L130 170Z" fill="' + c0(c, 1) + '"/><path d="M152 70 h16 v24 h-16Z" fill="#6b3f22"/><path d="M160 20 L160 40" stroke="#6b3f22" stroke-width="3"/><path d="M152 30 q8 -10 16 0 v10 h-16Z" fill="#e9c46a"/>' + ground('#b9a26a'); };
  T.bg_kremlin = function (c) { var s = sky(c0(c, 0), '#fff'); s += '<rect x="0" y="120" width="200" height="60" fill="' + c0(c, 1) + '"/>'; for (var x = 0; x < 200; x += 16) s += '<path d="M' + x + ' 120 l4 -8 h8 l4 8Z" fill="' + c0(c, 1) + '"/>'; s += '<rect x="136" y="56" width="30" height="70" fill="' + c0(c, 1) + '"/><path d="M130 58 L151 20 L172 58Z" fill="#2f5a3a"/><path d="M151 20 v-10" stroke="#e9c46a" stroke-width="3"/><path d="M146 8 l5 -6 5 6 -5 6Z" fill="#e0344b"/><circle cx="151" cy="76" r="8" fill="#fff" stroke="#e9c46a" stroke-width="2"/>'; return s + ground('#d7c9a8'); };
  T.bg_bam = function (c) { var s = sky(c0(c, 0), '#fff') + '<path d="M0 120 L40 70 L80 110 L120 60 L170 110 L200 90 L200 170 L0 170Z" fill="' + c0(c, 1) + '"/>' + ground('#cdb58b'); for (var x = -10; x < 210; x += 14) s += '<rect x="' + x + '" y="180" width="8" height="14" fill="#6b3f22"/>'; return s + '<path d="M0 182 H200 M0 190 H200" stroke="#555" stroke-width="3"/>'; };
  T.bg_piter = function (c) { return sky(c0(c, 0), '#f4f8ff') + '<path d="M130 20 L136 110 L124 110Z" fill="' + c0(c, 1) + '"/><circle cx="130" cy="18" r="3" fill="' + c0(c, 1) + '"/><rect x="100" y="104" width="80" height="30" fill="#e9dcc4"/><path d="M0 134 Q100 128 200 134 L200 200 L0 200Z" fill="#6d9cc8"/><path class="it-wave" d="M20 152 q10 -4 20 0 M110 164 q10 -4 20 0" stroke="#fff" stroke-width="2" fill="none"/><path d="M0 180 Q100 172 200 180 L200 200 L0 200Z" fill="#b8b8b0"/>'; };
  T.bg_metro = function (c) { var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/>'; for (var x = 10; x < 200; x += 60) s += '<path d="M' + x + ' 170 V60 Q' + (x + 20) + ' 30 ' + (x + 40) + ' 60 V170" fill="none" stroke="#c9b58a" stroke-width="10"/>'; return s + '<circle cx="100" cy="26" r="12" fill="' + c0(c, 1) + '"/><text x="100" y="31" text-anchor="middle" font-size="14" font-weight="900" fill="#fff" font-family="Arial">М</text><rect x="0" y="170" width="200" height="30" fill="#8e8e8e"/>'; };
  T.bg_senate = function (c) { return sky(c0(c, 0), '#fff') + '<rect x="0" y="100" width="200" height="70" fill="#f1e2bd"/><g fill="#fff">' + [10, 34, 58, 142, 166, 190].map(function (x) { return '<rect x="' + (x - 4) + '" y="104" width="8" height="60"/>'; }).join('') + '</g><path d="M60 100 L100 70 L140 100Z" fill="#f1e2bd"/><path d="M100 70 V30" stroke="' + c0(c, 1) + '" stroke-width="4"/><path d="M40 170 L50 120 L60 170Z" fill="#6b3f22"/><path d="M44 116 q6 -18 20 -10 q-8 4 -6 14Z" fill="' + c0(c, 1) + '"/>' + ground('#d9e4ec'); };
  T.bg_winter = function (c) { var s = sky(c0(c, 0), '#fff') + '<rect x="0" y="90" width="200" height="84" fill="' + c0(c, 1) + '"/>'; for (var x = 8; x < 200; x += 16) s += '<rect x="' + x + '" y="100" width="7" height="66" fill="#fff"/><rect x="' + (x - 1) + '" y="96" width="9" height="4" fill="#e9c46a"/>'; return s + '<path d="M0 90 H200" stroke="#e9c46a" stroke-width="4"/>' + ground('#eef3f7'); };
  T.bg_baikonur = function (c) { return sky(c0(c, 0), '#fff4e0') + '<path d="M150 170 L150 50 Q160 20 170 50 L170 170Z" fill="' + c0(c, 1) + '" stroke="#999" stroke-width="2"/><path d="M150 150 L138 172 L150 172Z M170 150 L182 172 L170 172Z" fill="#cc2d2d"/><path d="M186 60 L186 170 M190 60 L190 170" stroke="#777" stroke-width="3"/><text x="160" y="110" text-anchor="middle" font-size="7" font-weight="900" fill="#cc2d2d" font-family="Arial" transform="rotate(-90 160 110)">СССР</text>' + ground('#e2c79a'); };
  T.bg_amber = function (c) { var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/>'; for (var i = 0; i < 20; i++) s += '<rect x="' + ((i % 5) * 40 + 4) + '" y="' + (Math.floor(i / 5) * 44 + 4) + '" width="32" height="36" rx="4" fill="' + (i % 2 ? shade(c0(c, 0), 0.2) : shade(c0(c, 0), -0.15)) + '" stroke="' + c0(c, 1) + '" stroke-width="2"/>'; return '<g class="it-shine">' + s + '</g><rect x="0" y="176" width="200" height="24" fill="#6b3f22"/>'; };
  T.bg_space = function (c) {
    var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/><circle cx="40" cy="160" r="60" fill="#1b2a6b" opacity=".6"/>';
    var pts = [[20, 20], [60, 40], [100, 16], [150, 30], [180, 60], [30, 90], [170, 110], [120, 70], [80, 110], [186, 180], [10, 140]];
    pts.forEach(function (p, i) { s += '<circle class="it-twinkle" style="animation-delay:' + (i * 0.3) + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i % 3 ? 1.6 : 2.6) + '" fill="' + c0(c, 1) + '"/>'; });
    s += '<circle cx="160" cy="160" r="26" fill="#3a86c8"/><path d="M140 150 q10 -6 18 2 q8 8 18 2" stroke="#5bb04a" stroke-width="6" fill="none"/>';
    return '<g class="it-mythic">' + s + '</g>';
  };

  // Спутники (левый нижний угол, ≈ 14…56 × 140…190)
  function buddy(inner) { return '<g class="pet-buddy">' + inner + '</g>'; }
  T.c_bird = function (c) { return buddy('<ellipse cx="34" cy="168" rx="16" ry="13" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="26" cy="160" r="9" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="23" cy="158" r="2" fill="' + OUT + '"/><path d="M17 161 L10 163 L17 165Z" fill="#f2b705" stroke="' + OUT + '" stroke-width="1.5"/><path d="M38 164 Q48 158 50 170 Q44 172 38 168Z" fill="' + c0(c, 1) + '" ' + SW + '/><path d="M30 181 v6 M38 181 v6" stroke="' + OUT + '" stroke-width="2"/>'); };
  T.c_mouse = function (c) { return buddy('<ellipse cx="34" cy="174" rx="18" ry="12" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="20" cy="164" r="7" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="18" cy="172" r="1.8" fill="' + OUT + '"/><path d="M52 176 Q64 178 60 166" fill="none" stroke="' + OUT + '" stroke-width="2"/><circle cx="12" cy="176" r="2" fill="' + c0(c, 1) + '"/><rect x="30" y="160" width="10" height="8" fill="#e7d3a8" stroke="' + OUT + '" stroke-width="1.5"/>'); };
  T.c_frog = function (c) { return buddy('<ellipse cx="34" cy="174" rx="20" ry="13" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="24" cy="160" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="44" cy="160" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="24" cy="160" r="2.5" fill="' + OUT + '"/><circle cx="44" cy="160" r="2.5" fill="' + OUT + '"/><path d="M26 176 Q34 182 42 176" fill="none" stroke="' + OUT + '" stroke-width="2"/><path d="M26 152 l4 -6 4 5 4 -5 4 6Z" fill="' + c0(c, 1) + '" stroke="' + OUT + '" stroke-width="1.5"/>'); };
  T.c_bear = function (c) { return buddy('<circle cx="22" cy="152" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="46" cy="152" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="34" cy="162" r="14" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="34" cy="184" rx="15" ry="9" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="34" cy="167" rx="6" ry="4.5" fill="' + c0(c, 1) + '"/><circle cx="34" cy="165" r="2" fill="' + OUT + '"/><circle cx="28" cy="158" r="2" fill="' + OUT + '"/><circle cx="40" cy="158" r="2" fill="' + OUT + '"/>'); };
  T.c_dog = function (c) { return buddy('<ellipse cx="36" cy="178" rx="18" ry="11" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="26" cy="162" r="11" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M18 156 L16 144 L24 152Z M34 156 L36 144 L28 152Z" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="22" cy="161" r="1.8" fill="' + OUT + '"/><circle cx="30" cy="161" r="1.8" fill="' + OUT + '"/><circle cx="26" cy="167" r="2.2" fill="' + OUT + '"/><path d="M18 172 h16" stroke="#c62828" stroke-width="3"/>'); };
  T.c_horse = function (c) { return buddy('<ellipse cx="36" cy="172" rx="22" ry="12" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M16 170 Q10 146 20 140 L28 150 Q24 160 28 168Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M20 140 Q12 138 10 146 L20 148Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M22 140 Q30 142 30 154" fill="none" stroke="' + c0(c, 1) + '" stroke-width="5"/><circle cx="16" cy="145" r="1.8" fill="' + OUT + '"/><path d="M22 182 v8 M32 183 v8 M44 183 v8 M52 181 v8" stroke="' + OUT + '" stroke-width="3"/><path d="M58 166 Q66 170 62 182" fill="none" stroke="' + c0(c, 1) + '" stroke-width="4"/><path class="it-flicker" d="M12 150 q-6 -4 -4 -10" stroke="#ffd23f" stroke-width="2" fill="none"/>'); };
  T.c_cat = function (c) { return buddy('<ellipse cx="34" cy="176" rx="18" ry="12" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="30" cy="158" r="12" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M20 152 L18 140 L27 148Z M40 152 L42 140 L33 148Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M24 158 q3 -3 6 0 M32 158 q3 -3 6 0" stroke="' + OUT + '" stroke-width="1.8" fill="none"/><path d="M20 164 h20" stroke="' + c0(c, 1) + '" stroke-width="3"/><circle cx="30" cy="167" r="2.5" fill="' + c0(c, 1) + '"/><path d="M52 178 Q64 170 58 158" fill="none" stroke="' + OUT + '" stroke-width="3"/>'); };
  T.c_eagle = function (c) { return buddy('<g class="it-shine"><ellipse cx="34" cy="170" rx="14" ry="16" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M20 164 Q4 150 8 138 Q18 150 24 156Z M48 164 Q64 150 60 138 Q50 150 44 156Z" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="26" cy="150" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="42" cy="150" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M20 150 L16 152 L20 154Z M48 150 L52 152 L48 154Z" fill="#f2b705"/><path d="M26 142 l2 -4 2 4 M38 142 l2 -4 2 4" stroke="' + c0(c, 1) + '" stroke-width="2" fill="none"/></g>'); };
  T.c_firebird = function (c) { return buddy('<g class="it-mythic it-float"><path d="M40 170 Q70 180 64 150 Q58 164 50 164 Q70 150 60 130 Q52 150 44 156Z" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="32" cy="166" rx="13" ry="10" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="22" cy="156" r="7" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="20" cy="155" r="1.8" fill="' + OUT + '"/><path d="M15 157 L9 159 L15 160Z" fill="' + c0(c, 0) + '"/><path class="it-flicker" d="M22 149 q-2 -8 4 -12 q-1 6 2 8" fill="' + c0(c, 0) + '"/></g>'); };

  // Сияние (поверх всего, но прозрачное)
  T.a_stars = function (c) { var s = ''; for (var i = 0; i < 10; i++) { var x = 14 + (i * 37) % 176, y = 12 + (i * 53) % 150; s += '<path class="it-fall" style="animation-delay:' + (i * 0.45) + 's" d="M' + x + ' ' + (y - 5) + ' l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6Z" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; } return s; };
  T.a_snow = function (c) { var s = ''; for (var i = 0; i < 16; i++) s += '<circle class="it-fall" style="animation-delay:' + (i * 0.35) + 's" cx="' + ((i * 41) % 200) + '" cy="' + ((i * 29) % 120) + '" r="' + (i % 3 + 1.5) + '" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; return s; };
  T.a_salute = function (c) { var s = ''; [[40, 40], [160, 30], [110, 20]].forEach(function (p, j) { for (var i = 0; i < 10; i++) { var a = i / 10 * Math.PI * 2; s += '<path class="it-burst" style="animation-delay:' + (j * 0.6) + 's" d="M' + p[0] + ' ' + p[1] + ' L' + (p[0] + Math.cos(a) * 16).toFixed(1) + ' ' + (p[1] + Math.sin(a) * 16).toFixed(1) + '" stroke="' + c0(c, j % 3) + '" stroke-width="2.5" stroke-linecap="round"/>'; } }); return s; };
  T.a_sparks = function (c) { var s = ''; for (var i = 0; i < 14; i++) { var a = i / 14 * Math.PI * 2, x = 100 + Math.cos(a) * 78, y = 110 + Math.sin(a) * 78; s += '<circle class="it-twinkle" style="animation-delay:' + (i * 0.2) + 's" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (i % 2 ? 2 : 3.2) + '" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; } return '<g class="it-spin">' + s + '</g>'; };
  T.a_fire = function (c) { var s = ''; for (var i = 0; i < 9; i++) { var x = 24 + i * 19; s += '<path class="it-flicker" style="animation-delay:' + (i * 0.15) + 's" d="M' + x + ' 196 Q' + (x - 10) + ' 176 ' + x + ' 156 Q' + (x + 10) + ' 176 ' + x + ' 196Z" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '" opacity=".75"/>'; } return s; };
  T.a_vortex = function (c) { return '<g class="it-spin" opacity=".7"><path d="M100 110 m-80 0 a80 80 0 1 1 160 0" fill="none" stroke="' + c0(c, 0) + '" stroke-width="4" stroke-dasharray="10 12" stroke-linecap="round"/><path d="M100 110 m-66 0 a66 66 0 1 0 132 0" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3" stroke-dasharray="6 10" stroke-linecap="round"/></g>'; };

  // Спецэффекты состояния, которые висят в воздухе (не на голове).
  function extras(state) {
    if (state === 'sleep') return '<g class="pet-zzz" font-family="Arial" font-weight="900" fill="#6b7cff"><text x="140" y="56" font-size="16">z</text><text x="152" y="40" font-size="20">z</text><text x="166" y="22" font-size="24">Z</text></g>';
    if (state === 'hungry') return '<g class="pet-bowl" transform="translate(150 178)"><path d="M-15 0 Q0 15 15 0Z" fill="#c9b89a" ' + SW + '/><path d="M-17 0 H17" ' + SW + '/></g>' +
      '<g class="pet-think"><circle cx="146" cy="58" r="3" fill="#fff" ' + SW + '/><circle cx="154" cy="46" r="5" fill="#fff" ' + SW + '/><ellipse cx="170" cy="26" rx="18" ry="14" fill="#fff" ' + SW + '/><text x="170" y="32" text-anchor="middle" font-size="16">🍲</text></g>';
    if (state === 'sad') return '<g class="pet-think"><circle cx="146" cy="58" r="3" fill="#fff" ' + SW + '/><circle cx="154" cy="46" r="5" fill="#fff" ' + SW + '/><ellipse cx="170" cy="26" rx="18" ry="14" fill="#fff" ' + SW + '/><text x="170" y="32" text-anchor="middle" font-size="16">🎲</text></g>';
    if (state === 'happy') return '<g class="pet-hearts"><path d="M156 60 c-3 -6 -12 -3 -8 4 l8 7 8 -7 c4 -7 -5 -10 -8 -4Z" fill="#ff6b8a"/></g>';
    return '';
  }
  // Пузырь со льдом у больного — на голове, поэтому рисуется внутри головы.
  function sickHead() {
    return '<g class="pet-icebag"><path d="M78 52 Q100 34 124 50 Q128 62 100 64 Q74 64 78 52Z" fill="#9fd3f7" ' + SW + '/><path d="M96 40 L104 36 L108 44 L100 46Z" fill="#dff1fd" stroke="' + OUT + '" stroke-width="1.5"/><path d="M84 54 Q92 50 100 54" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></g>' +
      '<path class="pet-tear" d="M134 72 Q130 80 134 83 Q138 80 134 72Z" fill="#7fc8f8"/>';
  }

  // Сцена по умолчанию, пока нет купленного «места»: днём — небо с облаками и
  // лужайка, ночью — звёзды и луна. Питомец живёт в том же времени, что ученик.
  function scene(night) {
    var id = uid('scene');
    if (night) {
      var stars = '';
      [[24, 22], [58, 40], [92, 16], [138, 30], [176, 50], [30, 70], [168, 94], [120, 58], [70, 96], [186, 16]].forEach(function (pt, i) {
        stars += '<circle class="it-twinkle" style="animation-delay:' + (i * 0.37).toFixed(2) + 's" cx="' + pt[0] + '" cy="' + pt[1] + '" r="' + (i % 3 ? 1.3 : 2) + '" fill="#fff"/>';
      });
      return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2150"/><stop offset="1" stop-color="#3a3f7a"/></linearGradient></defs>' +
        '<rect width="200" height="200" fill="url(#' + id + ')"/>' + stars +
        '<circle cx="160" cy="36" r="14" fill="#fff4c2"/><circle cx="166" cy="31" r="12" fill="url(#' + id + ')"/>' +
        '<path d="M0 176 Q100 166 200 176 L200 200 L0 200Z" fill="#2c3263"/>';
    }
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff"/><stop offset="1" stop-color="#f3fbff"/></linearGradient></defs>' +
      '<rect width="200" height="200" fill="url(#' + id + ')"/>' +
      '<g class="it-drift"><ellipse cx="40" cy="36" rx="18" ry="7" fill="#fff"/><ellipse cx="52" cy="31" rx="12" ry="7" fill="#fff"/></g>' +
      '<g class="it-drift" style="animation-delay:-9s"><ellipse cx="150" cy="56" rx="16" ry="6" fill="#fff"/><ellipse cx="160" cy="52" rx="10" ry="6" fill="#fff"/></g>' +
      '<path d="M0 176 Q100 166 200 176 L200 200 L0 200Z" fill="#a8d88a"/>' +
      '<path d="M20 182 l2 -6 2 6 M60 186 l2 -6 2 6 M150 184 l2 -6 2 6 M180 188 l2 -6 2 6" stroke="#6fb453" stroke-width="2" fill="none"/>';
  }

  function escAttr(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }

  // Порядок слоёв: фон → спутник → тень → [зад зверька → тело → одежда → левая
  // лапа → голова (лицо, очки, шапка) → шея → правая лапа с вещью] → сияние.
  // Всё в квадратных скобках растёт со стадией — от земли, чтобы ступни стояли.
  function render(opts) {
    opts = opts || {};
    var items = opts.items || {};                    // id → {art:{t,c}, rarity}
    var eq = opts.sick ? {} : (opts.equipped || {});  // больной лежит без одежды
    var sp = SPECIES[opts.species] ? opts.species : 'kitten';
    var p = SPECIES[sp];
    var state = opts.state || 'ok';
    var stage = STAGE_SCALE[opts.stage] ? opts.stage : 'adult';
    var k = STAGE_SCALE[stage];
    function layer(slot) {
      var id = eq[slot]; if (!id || !items[id]) return '';
      var art = items[id].art || {}; var fn = T[art.t];
      return fn ? '<g class="slot-' + slot + ' r-' + items[id].rarity + '">' + fn(art.c || []) + '</g>' : '';
    }
    var body = '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)"><g class="pet-body">' +
      speciesBack(sp, p, stage) + speciesBody(sp, p, stage) + layer('body') + armL(sp, p) +
      '<g class="pet-head">' + speciesHead(sp, p, stage) + face(sp, p, state, stage) + layer('face') + layer('head') +
      (state === 'sick' ? sickHead() : '') + '</g>' +
      layer('neck') + '<g class="pet-arm-r">' + armR(sp, p) + layer('hand') + '</g></g></g>';
    var bg = '';
    if (eq.bg) bg = layer('bg');
    else if (opts.scene) bg = scene(opts.scene === 'night');
    // Фон режем по рамке: у питомца overflow виден (шапки и сияние выходят за край),
    // а у фона — нет, иначе круг «Открытого космоса» вылезал бы на соседей.
    if (bg) bg = '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + bg + '</svg>';
    var shadow = '<ellipse class="pet-shadow" cx="100" cy="191" rx="' + (46 * k).toFixed(1) + '" ry="5" fill="#000" opacity=".13"/>';
    var cls = 'pet-svg st-' + state + ' stage-' + stage + ' sp-' + sp + (opts.anim === false ? ' no-anim' : '') + (opts.mini ? ' mini' : '');
    return '<svg class="' + cls + '" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escAttr(opts.label || 'Питомец') + '">' +
      bg + layer('pet') + shadow + body + layer('aura') + (opts.mini ? '' : extras(state)) + '</svg>';
  }

  // Одна вещь отдельно — для карточек лавки и гардероба. Для вещей на голову,
  // лицо и шею показываем их на «манекене» — бледном силуэте зверька.
  function renderItem(item, opts) {
    opts = opts || {};
    var art = (item && item.art) || {}; var fn = T[art.t];
    if (!fn) return '';
    var ghost = '';
    var slot = item.slot;
    if (slot === 'head' || slot === 'face' || slot === 'neck' || slot === 'body') {
      ghost = '<g opacity=".1"><circle cx="100" cy="88" r="46" fill="#8a8aa0"/><ellipse cx="100" cy="152" rx="40" ry="34" fill="#8a8aa0"/></g>';
    }
    var vb = { head: '30 -14 140 140', face: '44 44 112 112', neck: '50 100 100 100', hand: '100 60 100 130', pet: '0 124 76 76', body: '28 100 144 100' }[slot] || '0 0 200 200';
    return '<svg class="item-svg r-' + item.rarity + '" viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + ghost + fn(art.c || []) + '</svg>';
  }

  // Еда, лекарства, игрушки и коробки — простые значки.
  var ICONS = {
    food_suhar: '🍞', food_shchi: '🍲', food_pirog: '🥧', food_pryanik: '🍪', food_pir: '🍗',
    med_otvar: '🍵', med_mikstura: '💊', toy_volchok: '🌀', toy_babki: '🎲', toy_lapta: '🏏',
    box_chest: '🧰', box_tsar: '👑', box_week: '🏆',
  };

  window.PetArt = { render: render, renderItem: renderItem, templates: T, species: SPECIES, icons: ICONS, shade: shade, stageScale: STAGE_SCALE };
})();
