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
    // Редкие виды рисуются своей анатомией (renderHuman); цвета — для значков.
    ghoul:    { fur: '#1d1d22', belly: '#ecebf2', inner: '#e0341a', nose: '#1d1b24' },
    tsar:     { fur: '#56633f', belly: '#f3d3ba', inner: '#e3b448', nose: '#7a5230' },
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


  // ── Анатомия v3: Подросток, Взрослый, Мудрец ───────────────────────────
  // Малыш — милый (анатомия выше). С ростом облик взрослеет: пропорции подростка
  // (шея, ноги, кисти), глаза миндалём с веком, брови с характером, объём и
  // контровой свет. Голова рисуется в координатах малыша (центр 100,88, r46) и
  // ужимается трансформом — поэтому все шапки, очки и маски садятся без
  // перерисовки. Одежда и шея переносятся своими привязками (V3_BODY_T, V3_NECK_T).
  var V3 = {
    kitten: { fur: '#e8894a', belly: '#fbe3cc', ink: '#5a2c12', iris: '#7fd35a', mark: '#b85a22' },
    owl: { fur: '#8a6a52', belly: '#efdcc2', ink: '#3a2618', iris: '#ffb319', mark: '#5f4533' },
    hedgehog: { fur: '#d8b38a', belly: '#f6e6d0', ink: '#4a3120', iris: '#7a4a24', mark: '#5a4030', spikes: '#5b4636' },
    dragon: { fur: '#3fae6e', belly: '#e6f3c4', ink: '#123d27', iris: '#ffd23f', mark: '#1f7a48', spikes: '#e2a92b' },
  };
  var V3_HEAD_T = 'translate(100 70) scale(0.8) translate(-100 -88)';
  var V3_BODY_T = 'translate(100 101) scale(0.84 0.92) translate(-100 -118)';
  var V3_NECK_T = 'translate(100 104) scale(0.84) translate(-100 -126)';

  function v3Defs(p, ids) {
    return '<defs><radialGradient id="' + ids.fur + '" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="' + shade(p.fur, 0.22) + '"/><stop offset="1" stop-color="' + shade(p.fur, -0.18) + '"/></radialGradient>' +
      '<linearGradient id="' + ids.furD + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + shade(p.fur, -0.05) + '"/><stop offset="1" stop-color="' + shade(p.fur, -0.3) + '"/></linearGradient>' +
      '<radialGradient id="' + ids.belly + '" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="' + p.belly + '"/></radialGradient></defs>';
  }
  function v3o(p, w) { return 'stroke="' + p.ink + '" stroke-width="' + (w || 2.6) + '" stroke-linejoin="round"'; }

  function v3Back(sp, p, ids, stage) {
    var s = '', o = v3o(p);
    if (stage === 'sage') s += '<g class="pet-halo"><circle cx="100" cy="72" r="54" fill="none" stroke="#ffd23f" stroke-width="3" stroke-dasharray="4 7" opacity=".75"/><circle cx="100" cy="72" r="60" fill="none" stroke="#ffe98a" stroke-width="1.5" opacity=".5"/></g>';
    if (sp === 'kitten') {
      s += '<g class="pet-tail"><path d="M128 158 C160 164 170 132 158 112 C152 102 162 94 170 100" fill="none" stroke="' + p.ink + '" stroke-width="11" stroke-linecap="round"/>' +
        '<path d="M128 158 C160 164 170 132 158 112 C152 102 162 94 170 100" fill="none" stroke="url(#' + ids.fur + ')" stroke-width="6.5" stroke-linecap="round"/>' +
        '<path d="M150 150 l6 -3 M160 128 l6 1 M157 110 l6 -2" stroke="' + p.mark + '" stroke-width="3" stroke-linecap="round"/></g>';
    }
    if (sp === 'dragon') {
      var big = stage !== 'teen';
      var wl = big ? 'M76 116 C44 86 22 100 20 124 C30 118 38 126 38 136 C46 128 56 132 60 142 C64 132 72 130 80 134Z' : 'M76 118 C56 102 40 110 38 126 C46 122 50 128 52 136 C58 130 66 132 78 134Z';
      var wr = big ? 'M124 116 C156 86 178 100 180 124 C170 118 162 126 162 136 C154 128 144 132 140 142 C136 132 128 130 120 134Z' : 'M124 118 C144 102 160 110 162 126 C154 122 150 128 148 136 C142 130 134 132 122 134Z';
      s += '<path class="pet-wing pet-wing-l" d="' + wl + '" fill="' + shade(p.fur, -0.25) + '" ' + o + '/><path class="pet-wing pet-wing-r" d="' + wr + '" fill="' + shade(p.fur, -0.25) + '" ' + o + '/>';
      s += '<path class="pet-tail" d="M122 160 C150 170 170 160 176 138 C178 132 186 130 190 126 C186 146 176 170 150 180 C136 184 124 180 118 172Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M184 128 L192 120 L190 134Z" fill="' + p.spikes + '" ' + o + '/>';
    }
    if (sp === 'hedgehog') {
      var n = stage === 'teen' ? 9 : 11, len = stage === 'teen' ? 48 : 56;
      for (var i = 0; i < n; i++) {
        var a = (-165 + i * (150 / (n - 1))) * Math.PI / 180, w = 0.17;
        s += '<path d="M' + (100 + Math.cos(a - w) * 30).toFixed(1) + ' ' + (132 + Math.sin(a - w) * 26).toFixed(1) + ' L' + (100 + Math.cos(a) * len).toFixed(1) + ' ' + (132 + Math.sin(a) * (len - 6)).toFixed(1) + ' L' + (100 + Math.cos(a + w) * 30).toFixed(1) + ' ' + (132 + Math.sin(a + w) * 26).toFixed(1) + 'Z" fill="' + (i % 2 ? p.spikes : shade(p.spikes, 0.15)) + '" ' + o + '/>';
      }
    }
    if (sp === 'owl' && stage !== 'teen') s += '<path class="pet-tail" d="M88 170 L82 188 L94 180 L100 190 L106 180 L118 188 L112 170Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/>';
    return s;
  }

  function v3Body(sp, p, ids, stage) {
    var s = '', o = v3o(p);
    s += '<path d="M84 160 C82 176 80 182 76 186 C84 190 94 190 96 184 C96 176 96 168 96 160Z" fill="url(#' + ids.furD + ')" ' + o + '/>';
    s += '<path d="M116 160 C118 176 120 182 124 186 C116 190 106 190 104 184 C104 176 104 168 104 160Z" fill="url(#' + ids.furD + ')" ' + o + '/>';
    if (sp === 'owl' || sp === 'dragon') s += '<path d="M78 188 v-4 M84 189 v-4 M90 188 v-4 M110 188 v-4 M116 189 v-4 M122 188 v-4" stroke="' + p.ink + '" stroke-width="1.6" stroke-linecap="round"/>';
    s += '<path d="M100 98 C124 98 136 116 136 136 C136 160 122 172 100 172 C78 172 64 160 64 136 C64 116 76 98 100 98Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
    s += '<path d="M100 110 C114 110 122 124 122 140 C122 156 112 166 100 166 C88 166 78 156 78 140 C78 124 86 110 100 110Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'owl') { var rows = stage === 'teen' ? 2 : 3; for (var r = 0; r < rows; r++) for (var c = 0; c < 3; c++) { var x = 90 + c * 10, y = 128 + r * 10; s += '<path d="M' + (x - 3) + ' ' + y + ' L' + x + ' ' + (y + 3) + ' L' + (x + 3) + ' ' + y + '" fill="none" stroke="' + shade(p.belly, -0.3) + '" stroke-width="1.6" stroke-linecap="round"/>'; } }
    if (sp === 'dragon' && stage !== 'teen') s += '<path d="M84 128 Q100 132 116 128 M82 140 Q100 144 118 140 M84 152 Q100 156 116 152" fill="none" stroke="' + shade(p.belly, -0.25) + '" stroke-width="2"/>';
    if (sp === 'kitten') s += '<path d="M66 126 q8 2 11 -2 M64 138 q9 2 12 -2 M134 126 q-8 2 -11 -2 M136 138 q-9 2 -12 -2' + (stage !== 'teen' ? ' M66 150 q8 2 11 -2 M134 150 q-8 2 -11 -2' : '') + '" fill="none" stroke="' + p.mark + '" stroke-width="3" stroke-linecap="round"/>';
    if (sp === 'hedgehog') s += '<circle cx="92" cy="132" r="2" fill="' + shade(p.belly, -0.2) + '"/><circle cx="108" cy="142" r="2" fill="' + shade(p.belly, -0.2) + '"/><circle cx="96" cy="154" r="2" fill="' + shade(p.belly, -0.2) + '"/>';
    s += '<path d="M126 112 C136 124 138 146 128 162" fill="none" stroke="#fff" stroke-width="2.5" opacity=".35" stroke-linecap="round"/>';
    return s;
  }
  function v3ArmL(sp, p, ids) {
    if (sp === 'owl') return '<g class="pet-arm-l"><path d="M72 110 C54 124 50 146 60 162 C66 150 72 134 80 118Z" fill="' + shade(p.fur, -0.18) + '" ' + v3o(p) + '/></g>';
    return '<g class="pet-arm-l"><path d="M70 112 C60 120 56 136 58 150 C60 156 68 158 72 152 C72 140 74 128 80 118Z" fill="url(#' + ids.fur + ')" ' + v3o(p) + '/><path d="M59 150 q2 5 6 5 M63 152 q2 5 6 3" fill="none" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round"/></g>';
  }
  function v3ArmR(sp, p, ids) {
    if (sp === 'owl') return '<path d="M128 110 C146 124 150 146 140 162 C134 150 128 134 120 118Z" fill="' + shade(p.fur, -0.18) + '" ' + v3o(p) + '/>';
    return '<path d="M130 112 C140 120 144 136 142 150 C140 156 132 158 128 152 C128 140 126 128 120 118Z" fill="url(#' + ids.fur + ')" ' + v3o(p) + '/><path d="M141 150 q-2 5 -6 5 M137 152 q-2 5 -6 3" fill="none" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round"/>';
  }

  function v3Head(sp, p, ids, stage) {
    var o = v3o(p, 3), s = '';
    if (sp === 'kitten') {
      var tuft = stage !== 'teen' ? '<path d="M52 22 l-4 -10 M54 24 l2 -11" stroke="' + p.ink + '" stroke-width="2" stroke-linecap="round"/>' : '';
      var tuftR = stage !== 'teen' ? '<path d="M148 22 l4 -10 M146 24 l-2 -11" stroke="' + p.ink + '" stroke-width="2" stroke-linecap="round"/>' : '';
      s += '<g class="pet-ear-l"><path d="M58 72 L52 22 L94 46Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M62 62 L58 34 L84 50Z" fill="#f4a6a0"/>' + tuft + '</g>';
      s += '<g class="pet-ear-r"><path d="M142 72 L148 22 L106 46Z" fill="url(#' + ids.fur + ')" ' + o + '/><path d="M138 62 L142 34 L116 50Z" fill="#f4a6a0"/>' + tuftR + '</g>';
    } else if (sp === 'owl') {
      var h = stage === 'teen' ? 8 : 0;
      s += '<path class="pet-ear-l" d="M60 58 L' + (46 + h / 2) + ' ' + (18 + h) + ' L86 44Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/><path class="pet-ear-r" d="M140 58 L' + (154 - h / 2) + ' ' + (18 + h) + ' L114 44Z" fill="' + shade(p.fur, -0.2) + '" ' + o + '/>';
    } else if (sp === 'hedgehog') {
      var n = stage === 'teen' ? 7 : 9;
      for (var i = 0; i < n; i++) { var a = (-172 + i * (164 / (n - 1))) * Math.PI / 180; s += '<path d="M' + (100 + Math.cos(a) * 40).toFixed(1) + ' ' + (88 + Math.sin(a) * 40).toFixed(1) + ' L' + (100 + Math.cos(a + 0.18) * (stage === 'teen' ? 62 : 70)).toFixed(1) + ' ' + (88 + Math.sin(a + 0.18) * (stage === 'teen' ? 62 : 70)).toFixed(1) + ' L' + (100 + Math.cos(a + 0.35) * 40).toFixed(1) + ' ' + (88 + Math.sin(a + 0.35) * 40).toFixed(1) + 'Z" fill="' + (i % 2 ? p.spikes : shade(p.spikes, 0.15)) + '" ' + o + '/>'; }
    } else if (sp === 'dragon') {
      var hh = stage === 'teen' ? 8 : 0;
      s += '<path d="M70 50 C58 30 60 ' + (12 + hh) + ' 72 ' + (4 + hh) + ' C70 22 78 36 88 44Z" fill="#f2e2b0" ' + o + '/><path d="M130 50 C142 30 140 ' + (12 + hh) + ' 128 ' + (4 + hh) + ' C130 22 122 36 112 44Z" fill="#f2e2b0" ' + o + '/>';
      s += '<path d="M88 44 L94 30 L100 42 L106 30 L112 44" fill="' + p.spikes + '" ' + o + '/>';
    }
    s += '<path d="M100 42 C130 42 148 62 148 88 C148 112 132 132 100 134 C68 132 52 112 52 88 C52 62 70 42 100 42Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
    s += '<path d="M128 56 Q150 82 136 116 Q126 128 110 132 Q144 100 128 56Z" fill="#000" opacity=".06"/>';
    if (sp === 'owl') s += '<path d="M60 92 C62 62 88 60 100 70 C112 60 138 62 140 92 C138 118 118 126 100 126 C82 126 62 118 60 92Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'kitten') s += '<path d="M100 96 C114 96 126 106 126 116 C120 126 110 130 100 130 C90 130 80 126 74 116 C74 106 86 96 100 96Z" fill="url(#' + ids.belly + ')"/><path d="M90 50 v10 M100 47 v12 M110 50 v10" stroke="' + p.mark + '" stroke-width="3.5" stroke-linecap="round"/>';
    if (sp === 'hedgehog') s += '<path d="M100 72 C122 72 136 88 136 104 C130 122 116 130 100 130 C84 130 70 122 64 104 C64 88 78 72 100 72Z" fill="url(#' + ids.belly + ')"/>';
    if (sp === 'dragon') s += '<path d="M100 98 C118 98 130 108 130 118 C124 128 112 132 100 132 C88 132 76 128 70 118 C70 108 82 98 100 98Z" fill="url(#' + ids.belly + ')"/>';
    s += '<ellipse cx="78" cy="58" rx="14" ry="6" fill="#fff" opacity=".22" transform="rotate(-24 78 58)"/>';
    return s;
  }

  // Глаз миндалём: характер даёт веко (lid 0 — открыт, 0.4 — уверенный прищур).
  function v3Eye(cx, cy, p, mirror, lid, iris) {
    var d = mirror ? -1 : 1;
    var s = '<path d="M' + (cx - 11 * d) + ' ' + cy + ' C' + (cx - 6 * d) + ' ' + (cy - 9) + ' ' + (cx + 7 * d) + ' ' + (cy - 9) + ' ' + (cx + 12 * d) + ' ' + (cy - 1) + ' C' + (cx + 6 * d) + ' ' + (cy + 7) + ' ' + (cx - 6 * d) + ' ' + (cy + 7) + ' ' + (cx - 11 * d) + ' ' + cy + 'Z" fill="#fff" stroke="' + p.ink + '" stroke-width="2.4"/>';
    s += '<g class="pet-pupils"><circle cx="' + (cx + d) + '" cy="' + (cy - 0.5) + '" r="6" fill="' + (iris || p.iris) + '"/><circle cx="' + (cx + d) + '" cy="' + (cy - 0.5) + '" r="3" fill="' + p.ink + '"/><circle cx="' + (cx + 3 * d) + '" cy="' + (cy - 3) + '" r="1.6" fill="#fff"/></g>';
    if (lid) s += '<path d="M' + (cx - 12 * d) + ' ' + (cy - 1) + ' C' + (cx - 6 * d) + ' ' + (cy - 10) + ' ' + (cx + 7 * d) + ' ' + (cy - 10) + ' ' + (cx + 13 * d) + ' ' + (cy - 2) + ' L' + (cx + 12 * d) + ' ' + (cy - 2 + lid * 10) + ' C' + (cx + 6 * d) + ' ' + (cy - 7 + lid * 10) + ' ' + (cx - 6 * d) + ' ' + (cy - 7 + lid * 10) + ' ' + (cx - 11 * d) + ' ' + (cy + lid * 8) + 'Z" fill="' + shade(p.fur, -0.12) + '" stroke="' + p.ink + '" stroke-width="2.4" stroke-linejoin="round"/>';
    return s;
  }
  function v3Face(sp, p, state, stage) {
    var s = '', ink = p.ink;
    // Взрослый в духе смотрит с уверенным прищуром — «сигма-взгляд» по умолчанию.
    var mood = state === 'ok' && stage !== 'teen' ? 'cool' : state;
    if (mood === 'happy') {
      s += '<path d="M70 90 Q81 78 92 90 M108 90 Q119 78 130 90" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>';
    } else if (mood === 'sleep') {
      s += '<path d="M70 90 Q81 96 92 90 M108 90 Q119 96 130 90" fill="none" stroke="' + ink + '" stroke-width="3" stroke-linecap="round"/>';
    } else {
      var lid = mood === 'cool' ? 0.42 : mood === 'sad' ? 0.28 : mood === 'sick' ? 0.55 : 0.12;
      s += '<g class="pet-eyes">' + v3Eye(81, 90, p, false, lid) + v3Eye(119, 90, p, true, lid) + '</g>';
    }
    var brow = stage === 'sage' ? '#f4f4f4' : ink, bw = stage === 'sage' ? 4.5 : 3.2;
    if (mood === 'cool') s += '<path d="M68 76 L92 79 M108 78 L132 73" stroke="' + brow + '" stroke-width="' + bw + '" stroke-linecap="round"/>';
    else if (mood === 'sad' || mood === 'sick' || mood === 'hungry') s += '<path d="M70 80 L91 74 M130 80 L109 74" stroke="' + brow + '" stroke-width="' + bw + '" stroke-linecap="round"/>';
    else if (mood !== 'happy' && mood !== 'sleep') s += '<path d="M70 76 Q81 71 92 76 M108 76 Q119 71 130 76" fill="none" stroke="' + brow + '" stroke-width="' + bw + '" stroke-linecap="round"/>';
    if (mood === 'sad') s += '<path class="pet-tear" d="M76 100 Q73 106 76 109 Q79 106 76 100Z" fill="#7fc8f8"/>';
    if (state !== 'sick') s += '<g class="pet-cheeks"><ellipse cx="68" cy="106" rx="7" ry="3.5" fill="#ff8fa3" opacity=".3"/><ellipse cx="132" cy="106" rx="7" ry="3.5" fill="#ff8fa3" opacity=".3"/></g>';
    if (sp === 'owl') s += '<path d="M94 100 L106 100 L100 114Z" fill="#f2b705" stroke="' + ink + '" stroke-width="2.4" stroke-linejoin="round"/>';
    else if (sp === 'dragon') s += '<path d="M92 104 q2 -2 4 0 M104 104 q2 -2 4 0" stroke="' + ink + '" stroke-width="2.2" stroke-linecap="round" fill="none"/>';
    else s += '<path d="M95 102 L105 102 L100 108Z" fill="#3a2020" stroke="' + ink + '" stroke-width="1.6" stroke-linejoin="round"/>';
    var my = sp === 'owl' ? 120 : 114, mouth = '';
    if (mood === 'happy') mouth = '<path d="M88 ' + my + ' Q100 ' + (my + 12) + ' 112 ' + my + 'Z" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'hungry') mouth = '<ellipse cx="100" cy="' + (my + 3) + '" rx="5" ry="6" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'sad' || mood === 'sick') mouth = '<path d="M91 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 109 ' + (my + 5) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else if (mood === 'sleep') mouth = '<ellipse cx="100" cy="' + (my + 2) + '" rx="3" ry="2.5" fill="' + ink + '"/>';
    else if (mood === 'cool') mouth = '<path d="M90 ' + (my + 2) + ' Q100 ' + (my + 5) + ' 110 ' + (my - 2) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else mouth = '<path d="M91 ' + my + ' Q95 ' + (my + 4) + ' 100 ' + (my + 1) + ' Q105 ' + (my + 4) + ' 109 ' + my + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    if (sp === 'owl' && mood !== 'hungry' && mood !== 'happy') mouth = '';
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    if (sp === 'kitten' && state !== 'sick') s += '<path d="M62 104 L42 100 M62 110 L42 112 M138 104 L158 100 M138 110 L158 112" stroke="' + ink + '" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>';
    if (stage === 'sage' && sp === 'owl') s += '<path d="M86 126 Q100 140 114 126" fill="none" stroke="#f4f4f4" stroke-width="3"/>';
    return s;
  }

  // Икона стиля недели («Кто круче?»): радужное кольцо на неделю.
  function styleAura() {
    var id = uid('sty');
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".33" stop-color="#ffd23f"/>' +
      '<stop offset=".66" stop-color="#4dabf7"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs>' +
      '<circle class="it-spin" cx="100" cy="112" r="88" fill="none" stroke="url(#' + id + ')" stroke-width="4.5" stroke-dasharray="14 8" opacity=".9"/>' +
      '<text x="100" y="22" text-anchor="middle" font-size="18">👑</text>';
  }

  // Сияние по самой редкой надетой вещи — чтобы редкость видели другие.
  var RANK_OF = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
  function rarityAura(best) {
    if (best === 'epic') return '<ellipse class="rar-glow" cx="100" cy="190" rx="50" ry="8" fill="#a855f7" opacity=".4"/>';
    if (best === 'legendary') {
      var s = '<ellipse class="rar-glow" cx="100" cy="190" rx="56" ry="9" fill="#f59e0b" opacity=".5"/>';
      for (var i = 0; i < 8; i++) { var a = i / 8 * Math.PI * 2; s += '<path class="it-twinkle" style="animation-delay:' + (i * 0.25) + 's" d="M' + (100 + Math.cos(a) * 72).toFixed(1) + ' ' + (110 + Math.sin(a) * 72).toFixed(1) + ' l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#ffd23f"/>'; }
      return s;
    }
    if (best === 'mythic') {
      var m = '<ellipse class="rar-glow" cx="100" cy="190" rx="60" ry="10" fill="#ef4444" opacity=".5"/><circle class="it-spin" cx="100" cy="112" r="86" fill="none" stroke="#ff7b00" stroke-width="2" stroke-dasharray="3 9" opacity=".7"/>';
      for (var j = 0; j < 10; j++) { var b = j / 10 * Math.PI * 2; m += '<circle class="it-fall" style="animation-delay:' + (j * 0.3) + 's" cx="' + (100 + Math.cos(b) * 62).toFixed(1) + '" cy="' + (100 + Math.sin(b) * 42).toFixed(1) + '" r="2.2" fill="' + (j % 2 ? '#ffd23f' : '#ff4d1a') + '"/>'; }
      return m;
    }
    return '';
  }


  // ── Редкие виды: Николай II и Гуль ─────────────────────────────────────
  // Люди, а не зверьки, поэтому своя анатомия — в тех же координатах, что v3:
  // голова рисуется в координатах головы малыша и садится трансформом, так что
  // шапки, очки и маски из лавки подходят без перерисовки. Встроенный костюм
  // вида (фуражка, маска) прячется, если в слот надета вещь.
  var HUMAN = {
    tsar: { skin: '#f3d3ba', ink: '#3a2a20', hair: '#7a5230', iris: '#6f9cc9', coat: '#56633f', coatD: '#3f4a2e',
      gold: '#e3b448', pants: '#2b2f3a', boots: '#1b1b1f' },
    ghoul: { skin: '#ecebf2', ink: '#1d1b24', hair: '#f4f4f8', hairD: '#c3c5d2', iris: '#8a8f9c', coat: '#1d1d22', coatD: '#101014',
      red: '#e0341a', pants: '#1d1d22', boots: '#0d0d10' },
  };
  function humanHeadT(stage) {
    return stage === 'baby' ? 'translate(100 72) scale(0.92) translate(-100 -88)' : V3_HEAD_T;
  }
  function hLine(p, w) { return 'stroke="' + p.ink + '" stroke-width="' + (w || 2.6) + '" stroke-linejoin="round"'; }

  function humanBack(sp, p, stage) {
    var s = '';
    if (sp === 'tsar' && stage === 'sage') {
      // Горностаевая мантия за плечами.
      s += '<path d="M66 104 C48 130 46 168 54 188 L146 188 C154 168 152 130 134 104Z" fill="#b3262d" ' + hLine(p) + '/>';
    }
    if (sp === 'ghoul' && stage === 'sage') {
      // Красные ленты-щупальца за спиной — «король» уже не прячется.
      var tips = [[34, 70], [46, 40], [154, 40], [166, 70]];
      tips.forEach(function (t, i) {
        var d = 'M' + (i < 2 ? 88 : 112) + ' 150 C' + (i < 2 ? 60 : 140) + ' 140 ' + (t[0] + (i < 2 ? 20 : -20)) + ' ' + (t[1] + 50) + ' ' + t[0] + ' ' + t[1];
        s += '<g class="pet-tail" style="animation-delay:' + (i * 0.3) + 's"><path d="' + d + '" fill="none" stroke="' + p.ink + '" stroke-width="11" stroke-linecap="round"/>' +
          '<path d="' + d + '" fill="none" stroke="' + p.red + '" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="' + d + '" fill="none" stroke="#ff8a70" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 10" opacity=".8"/></g>';
      });
    }
    if (sp === 'ghoul' && stage !== 'baby') s += '<ellipse class="rar-glow" cx="100" cy="188" rx="' + (stage === 'teen' ? 40 : 54) + '" ry="8" fill="#5b21b6" opacity=".45"/>';
    return s;
  }

  function humanBody(sp, p, stage) {
    var s = '', o = hLine(p);
    // Ноги: брюки и сапоги.
    s += '<path d="M80 156 L82 182 L98 182 L99 158Z" fill="' + p.pants + '" ' + o + '/><path d="M120 156 L118 182 L102 182 L101 158Z" fill="' + p.pants + '" ' + o + '/>';
    s += '<path d="M79 176 L99 176 L99 188 L74 188 Q74 180 79 176Z" fill="' + p.boots + '" ' + o + '/><path d="M121 176 L101 176 L101 188 L126 188 Q126 180 121 176Z" fill="' + p.boots + '" ' + o + '/>';
    // Шея.
    s += '<rect x="93" y="92" width="14" height="14" fill="' + p.skin + '" ' + o + '/>';
    if (sp === 'tsar' && stage === 'baby') {
      // Цесаревич в матроске.
      s += '<path d="M72 104 Q100 96 128 104 L132 160 Q100 166 68 160Z" fill="#f4f6fa" ' + o + '/>';
      s += '<path d="M76 104 L100 132 L124 104 L128 118 L100 140 L72 118Z" fill="#27458f" ' + o + '/><path d="M80 112 L100 134 L120 112" fill="none" stroke="#fff" stroke-width="1.8"/>';
      s += '<path d="M96 132 L100 142 L104 132Z" fill="#b3262d"/>';
      return s;
    }
    if (sp === 'tsar') {
      var coat = stage === 'sage' ? '#2f4a35' : p.coat;
      s += '<path d="M72 104 Q100 96 128 104 L134 160 Q100 168 66 160Z" fill="' + coat + '" ' + o + '/>';
      s += '<path d="M90 100 L100 108 L110 100" fill="none" stroke="' + p.coatD + '" stroke-width="3"/>';
      for (var i = 0; i < 4; i++) s += '<circle cx="100" cy="' + (114 + i * 10) + '" r="2.4" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width="1"/>';
      s += '<rect x="68" y="146" width="64" height="7" rx="2" fill="#5a3a22" ' + hLine(p, 2) + '/><rect x="95" y="145" width="10" height="9" rx="1.5" fill="' + p.gold + '" ' + hLine(p, 1.5) + '/>';
      s += '<path d="M84 114 h8 M84 118 h8" stroke="' + p.coatD + '" stroke-width="2"/>';
      if (stage === 'adult' || stage === 'sage') {
        s += '<rect x="66" y="100" width="18" height="8" rx="3" fill="' + p.gold + '" ' + hLine(p, 2) + ' transform="rotate(-14 75 104)"/>';
        s += '<rect x="116" y="100" width="18" height="8" rx="3" fill="' + p.gold + '" ' + hLine(p, 2) + ' transform="rotate(14 125 104)"/>';
      }
      if (stage === 'sage') {
        // Андреевская лента и звезда ордена, горностай на плечах.
        s += '<path d="M76 106 L126 156" stroke="#3a7bd5" stroke-width="7" stroke-linecap="round"/>';
        s += '<path d="M116 124 l3 7 7 0 -6 4 3 7 -7 -4 -7 4 3 -7 -6 -4 7 0Z" fill="#f5f0e0" stroke="' + p.gold + '" stroke-width="1.5"/>';
        s += '<path d="M64 108 Q100 90 136 108 Q126 120 100 116 Q74 120 64 108Z" fill="#fbfaf5" ' + o + '/>';
        for (var k = 0; k < 6; k++) s += '<path d="M' + (74 + k * 10) + ' ' + (106 + (k % 2) * 3) + ' l1.5 4 -3 0Z" fill="#15151a"/>';
      }
      return s;
    }
    // Гуль: худи (Новичок, Гуль) или чёрная куртка с высоким воротом.
    s += '<path d="M72 104 Q100 96 128 104 L134 160 Q100 168 66 160Z" fill="' + p.coat + '" ' + o + '/>';
    if (stage === 'baby' || stage === 'teen') {
      s += '<path d="M76 102 Q100 118 124 102 Q120 94 100 94 Q80 94 76 102Z" fill="' + p.coatD + '" ' + hLine(p, 2) + '/>';
      s += '<path d="M94 110 L92 126 M106 110 L108 126" stroke="#d4d4dc" stroke-width="1.6" stroke-linecap="round"/>';
      s += '<path d="M82 136 Q100 142 118 136 L116 150 Q100 154 84 150Z" fill="' + p.coatD + '" ' + hLine(p, 1.6) + '/>';
    } else {
      s += '<path d="M84 104 L92 92 L100 104 L108 92 L116 104" fill="' + p.coatD + '" ' + hLine(p, 2) + '/>';
      s += '<path d="M100 104 L100 160" stroke="#3a3a44" stroke-width="2"/>';
      for (var j = 0; j < 3; j++) s += '<path d="M' + (92 - j * 2) + ' ' + (120 + j * 12) + ' h-8" stroke="' + p.red + '" stroke-width="2" stroke-linecap="round"/>';
    }
    return s;
  }

  function humanArm(sp, p, stage, side) {
    var o = hLine(p), l = side === 'l';
    var sleeve = sp === 'tsar' ? (stage === 'baby' ? '#f4f6fa' : stage === 'sage' ? '#2f4a35' : p.coat) : p.coat;
    var d = l ? 'M74 106 C62 116 58 134 60 152 L71 152 C71 138 74 124 82 114Z' : 'M126 106 C138 116 142 134 140 152 L129 152 C129 138 126 124 118 114Z';
    var s = '<path d="' + d + '" fill="' + sleeve + '" ' + o + '/>';
    if (sp === 'tsar' && stage === 'baby') s += '<path d="' + (l ? 'M60 146 L71 146' : 'M129 146 L140 146') + '" stroke="#27458f" stroke-width="3"/>';
    var hx = l ? 65.5 : 134.5;
    s += '<circle cx="' + hx + '" cy="156" r="6.5" fill="' + p.skin + '" ' + hLine(p, 2.2) + '/>';
    if (sp === 'ghoul') s += '<path d="M' + (hx - 4) + ' 160 l1 2 M' + hx + ' 161 l0 2.2 M' + (hx + 4) + ' 160 l-1 2" stroke="#0b0b0b" stroke-width="2.2" stroke-linecap="round"/>';
    if (sp === 'ghoul' && stage !== 'baby') s += '<path d="M' + (hx - 6) + ' 150 h12 M' + (hx - 6) + ' 146 h12" stroke="#f4f1e6" stroke-width="3" opacity=".9"/>';
    // Держава в левой руке Императора.
    if (l && sp === 'tsar' && stage === 'sage') {
      s += '<g class="it-shine"><circle cx="62" cy="148" r="10" fill="' + p.gold + '" ' + hLine(p, 2.2) + '/><path d="M52 148 H72 M62 138 V158" stroke="#b8912f" stroke-width="1.6"/>' +
        '<path d="M62 138 V128 M58 132 H66" stroke="' + p.gold + '" stroke-width="3" stroke-linecap="round"/><circle cx="58" cy="144" r="2" fill="#fff" opacity=".7"/></g>';
    }
    return s;
  }

  function humanHead(sp, p, stage, eq) {
    var o = hLine(p, 3), s = '';
    s += '<circle cx="52" cy="94" r="7" fill="' + p.skin + '" ' + hLine(p, 2.4) + '/><circle cx="148" cy="94" r="7" fill="' + p.skin + '" ' + hLine(p, 2.4) + '/>';
    s += '<ellipse cx="100" cy="90" rx="44" ry="48" fill="' + p.skin + '" ' + o + '/>';
    s += '<path d="M128 56 Q150 86 136 118 Q126 132 110 136 Q144 104 128 56Z" fill="#000" opacity=".05"/>';
    if (sp === 'tsar') {
      // Волосы с пробором; у Мудреца — седина на висках.
      s += '<path d="M56 88 C52 58 72 40 100 40 C128 40 148 58 144 88 C140 72 132 62 116 58 C100 56 84 60 72 66 C62 72 58 80 56 88Z" fill="' + p.hair + '" ' + o + '/>';
      s += '<path d="M112 44 Q104 52 96 60" stroke="' + shade(p.hair, -0.25) + '" stroke-width="2" fill="none"/>';
      if (stage === 'sage') s += '<path d="M56 86 C56 76 60 70 64 66 M144 86 C144 76 140 70 136 66" stroke="#d9d9d9" stroke-width="4" fill="none" stroke-linecap="round"/>';
      if (stage === 'adult' || stage === 'sage') {
        var beard = stage === 'sage' ? shade(p.hair, 0.12) : p.hair;
        s += '<path d="M58 98 Q58 140 100 148 Q142 140 142 98 Q136 118 124 124 Q112 118 100 122 Q88 118 76 124 Q64 118 58 98Z" fill="' + beard + '" ' + o + '/>';
        if (stage === 'sage') s += '<path d="M88 132 Q100 140 112 132 M92 140 Q100 144 108 140" stroke="#e6e6e6" stroke-width="1.6" fill="none" opacity=".8"/>';
      }
    } else {
      // Белая чёлка на глаза.
      s += '<path d="M52 92 C48 54 72 36 100 36 C130 36 152 54 148 92 L140 72 L134 90 L126 68 L118 92 L110 66 L100 96 L92 66 L84 88 L76 68 L68 86 L62 70Z" fill="' + p.hair + '" ' + o + '/>';
      s += '<path d="M84 48 Q80 60 82 72 M106 44 Q106 56 108 64 M124 50 Q128 60 130 68" fill="none" stroke="' + p.hairD + '" stroke-width="2" stroke-linecap="round"/>';
    }
    return s;
  }

  // Глаз человека: миндаль с веком. dark — чёрный белок и красная радужка (какуган).
  function humanEye(cx, cy, p, mirror, lid, dark) {
    var q = { ink: p.ink, iris: dark ? p.red : p.iris, fur: p.skin };
    var s = v3Eye(cx, cy, q, mirror, lid, dark ? p.red : p.iris);
    if (dark) s = s.replace('fill="#fff" stroke="' + p.ink + '"', 'fill="#0b0b0b" stroke="' + p.ink + '"');
    return s;
  }

  function humanFace(sp, p, state, stage, eq) {
    var s = '', ink = p.ink;
    // Взрослый Николай смотрит спокойно; Гуль по умолчанию «инсайд» — пустой взгляд.
    var mood = state;
    if (state === 'ok' && sp === 'ghoul') mood = 'inside';
    else if (state === 'ok' && sp === 'tsar' && stage !== 'baby') mood = 'calm';
    var kakugan = sp === 'ghoul' && stage !== 'baby';
    if (mood === 'happy') {
      s += '<path d="M70 92 Q81 82 92 92 M108 92 Q119 82 130 92" fill="none" stroke="' + ink + '" stroke-width="3.5" stroke-linecap="round"/>';
    } else if (mood === 'sleep') {
      s += '<path d="M70 92 Q81 98 92 92 M108 92 Q119 98 130 92" fill="none" stroke="' + ink + '" stroke-width="3" stroke-linecap="round"/>';
    } else {
      var lid = mood === 'inside' ? 0.5 : mood === 'calm' ? 0.28 : mood === 'sad' ? 0.3 : mood === 'sick' ? 0.55 : 0.12;
      s += '<g class="pet-eyes">' + humanEye(81, 92, p, false, lid, false) + humanEye(119, 92, p, true, lid, kakugan) + '</g>';
      if (kakugan) s += '<path d="M112 102 Q116 110 113 118 M124 100 Q128 106 127 112" stroke="' + p.red + '" stroke-width="1.4" fill="none" opacity=".7"/>';
    }
    var brow = sp === 'tsar' ? (stage === 'sage' ? '#d9d9d9' : p.hair) : p.hairD;
    if (mood === 'sad' || mood === 'sick' || mood === 'hungry') s += '<path d="M70 80 L91 75 M130 80 L109 75" stroke="' + brow + '" stroke-width="3.2" stroke-linecap="round"/>';
    else if (mood === 'inside') s += '<path d="M70 79 L92 80 M108 80 L130 79" stroke="' + brow + '" stroke-width="3" stroke-linecap="round"/>';
    else if (mood !== 'happy' && mood !== 'sleep') s += '<path d="M70 78 Q81 73 92 78 M108 78 Q119 73 130 78" fill="none" stroke="' + brow + '" stroke-width="3.2" stroke-linecap="round"/>';
    if (mood === 'sad') s += '<path class="pet-tear" d="M76 102 Q73 108 76 111 Q79 108 76 102Z" fill="#7fc8f8"/>';
    // Нос.
    s += '<path d="M100 96 Q95 106 100 109" fill="none" stroke="' + shade(p.skin, -0.3) + '" stroke-width="2.2" stroke-linecap="round"/>';
    if (sp === 'tsar' && stage === 'baby') s += '<g class="pet-cheeks"><ellipse cx="70" cy="108" rx="7" ry="3.5" fill="#ff8fa3" opacity=".35"/><ellipse cx="130" cy="108" rx="7" ry="3.5" fill="#ff8fa3" opacity=".35"/></g>';
    var my = 118, mouth;
    if (mood === 'happy') mouth = '<path d="M89 ' + my + ' Q100 ' + (my + 11) + ' 111 ' + my + 'Z" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'hungry') mouth = '<ellipse cx="100" cy="' + (my + 3) + '" rx="5" ry="6" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'sad' || mood === 'sick') mouth = '<path d="M91 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 109 ' + (my + 5) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else if (mood === 'sleep') mouth = '<ellipse cx="100" cy="' + (my + 2) + '" rx="3" ry="2.5" fill="' + ink + '"/>';
    else if (mood === 'inside') mouth = '<path d="M92 ' + (my + 2) + ' Q102 ' + (my + 3) + ' 110 ' + (my - 2) + '" fill="none" stroke="' + ink + '" stroke-width="2.2" stroke-linecap="round"/>';
    else mouth = '<path d="M91 ' + my + ' Q100 ' + (my + 5) + ' 109 ' + my + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    // Усы — поверх рта: у Наследника тонкие, у Императора пышные.
    if (sp === 'tsar' && stage !== 'baby') {
      var mc = stage === 'sage' ? shade(p.hair, 0.12) : p.hair;
      s += stage === 'teen'
        ? '<path d="M100 111 Q90 110 82 115 Q92 113 100 114 Q108 113 118 115 Q110 110 100 111Z" fill="' + mc + '" ' + hLine(p, 1.4) + '/>'
        : '<path d="M100 110 Q88 106 76 116 Q70 120 66 116 Q72 124 84 118 Q94 115 100 116 Q106 115 116 118 Q128 124 134 116 Q130 120 124 116 Q112 106 100 110Z" fill="' + mc + '" ' + hLine(p, 1.8) + '/>';
    }
    // Встроенный облик вида — только если слот свободен.
    if (sp === 'ghoul' && !eq.face) {
      if (stage === 'adult' || stage === 'sage') s += T.eyepatch(['#15151a']);
      if (stage !== 'baby') s += T.ghoulmask(['#15151a', '#f4f1e6']);
    }
    return s;
  }

  function humanHat(sp, p, stage, eq) {
    if (eq.head) return '';
    if (sp === 'tsar') {
      if (stage === 'baby') {
        // Бескозырка с лентами.
        return '<path d="M134 48 L148 76 L141 78 L128 52Z M138 48 L154 72 L148 75 L132 50Z" fill="#15151a"/>' +
          '<ellipse cx="100" cy="42" rx="44" ry="11" fill="#f8f9fc" ' + hLine(p, 2.4) + '/><rect x="60" y="42" width="80" height="10" rx="3" fill="#15151a" ' + hLine(p, 2) + '/>' +
          '<text x="100" y="50.5" text-anchor="middle" font-size="6.5" font-weight="900" fill="' + p.gold + '" font-family="Arial">ШТАНДАРТЪ</text>';
      }
      if (stage === 'sage') return '';
      // Офицерская фуражка с кокардой.
      return '<path d="M52 50 Q100 20 148 50 Q100 60 52 50Z" fill="' + p.coat + '" ' + hLine(p, 2.6) + '/>' +
        '<rect x="58" y="48" width="84" height="11" rx="3" fill="#b3262d" ' + hLine(p, 2.2) + '/>' +
        '<path d="M60 58 Q100 72 140 58 L138 64 Q100 76 62 64Z" fill="#15151a" ' + hLine(p, 2) + '/>' +
        '<ellipse cx="100" cy="53" rx="4.5" ry="5.5" fill="' + p.gold + '" stroke="#15151a" stroke-width="1.5"/><ellipse cx="100" cy="53" rx="2" ry="2.6" fill="#15151a"/>';
    }
    if (sp === 'ghoul' && stage === 'sage') {
      // Корона из шипов.
      var s = '<path d="M58 60 Q100 44 142 60" fill="none" stroke="#15151a" stroke-width="6"/>';
      [[62, 36], [78, 24], [100, 16], [122, 24], [138, 36]].forEach(function (t, i) {
        s += '<path d="M' + (t[0] - 7) + ' ' + (56 - Math.abs(2 - i) * -1) + ' L' + t[0] + ' ' + t[1] + ' L' + (t[0] + 7) + ' ' + (54 - Math.abs(2 - i) * -1) + 'Z" fill="#15151a" stroke="' + p.red + '" stroke-width="1.2"/>';
      });
      return '<g class="it-mythic-lite">' + s + '</g>';
    }
    return '';
  }

  function renderHuman(sp, stage, state, layer, eq, sick) {
    var p = HUMAN[sp];
    var k = stage === 'baby' ? 0.82 : stage === 'teen' ? 0.92 : 1;
    var headT = humanHeadT(stage);
    return '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)"><g class="pet-body">' +
      humanBack(sp, p, stage) + humanBody(sp, p, stage) +
      '<g transform="' + V3_BODY_T + '">' + layer('body') + '</g>' +
      '<g class="pet-arm-l">' + humanArm(sp, p, stage, 'l') + '</g>' +
      '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
      '<g class="pet-head"><g transform="' + headT + '">' + humanHead(sp, p, stage, eq) + humanFace(sp, p, state, stage, eq) +
      layer('face') + humanHat(sp, p, stage, eq) + layer('head') + (sick ? sickHead() : '') + '</g></g>' +
      '<g class="pet-arm-r">' + humanArm(sp, p, stage, 'r') + layer('hand') + '</g></g></g>';
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
  T.c_frog = function (c) { return buddy('<ellipse cx="34" cy="174" rx="20" ry="13" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="24" cy="160" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="44" cy="160" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="24" cy="160" r="2.5" fill="' + OUT + '"/><circle cx="44" cy="160" r="2.5" fill="' + OUT + '"/><path d="M26 176 Q34 182 42 176" fill="none" stroke="' + OUT + '" stroke-width="2"/><path d="M26 152 l4 -6 4 5 4 -5 4 6Z" fill="' + c0(c, 1) + '" stroke="' + OUT + '" stroke-width="1.5"/>'); };
  T.c_bear = function (c) { return buddy('<circle cx="22" cy="152" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="46" cy="152" r="6" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="34" cy="162" r="14" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="34" cy="184" rx="15" ry="9" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="34" cy="167" rx="6" ry="4.5" fill="' + c0(c, 1) + '"/><circle cx="34" cy="165" r="2" fill="' + OUT + '"/><circle cx="28" cy="158" r="2" fill="' + OUT + '"/><circle cx="40" cy="158" r="2" fill="' + OUT + '"/>'); };
  T.c_dog = function (c) { return buddy('<ellipse cx="36" cy="178" rx="18" ry="11" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="26" cy="162" r="11" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M18 156 L16 144 L24 152Z M34 156 L36 144 L28 152Z" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="22" cy="161" r="1.8" fill="' + OUT + '"/><circle cx="30" cy="161" r="1.8" fill="' + OUT + '"/><circle cx="26" cy="167" r="2.2" fill="' + OUT + '"/><path d="M18 172 h16" stroke="#c62828" stroke-width="3"/>'); };
  T.c_cat = function (c) { return buddy('<ellipse cx="34" cy="176" rx="18" ry="12" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="30" cy="158" r="12" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M20 152 L18 140 L27 148Z M40 152 L42 140 L33 148Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M24 158 q3 -3 6 0 M32 158 q3 -3 6 0" stroke="' + OUT + '" stroke-width="1.8" fill="none"/><path d="M20 164 h20" stroke="' + c0(c, 1) + '" stroke-width="3"/><circle cx="30" cy="167" r="2.5" fill="' + c0(c, 1) + '"/><path d="M52 178 Q64 170 58 158" fill="none" stroke="' + OUT + '" stroke-width="3"/>'); };
  T.c_firebird = function (c) { return buddy('<g class="it-mythic it-float"><path d="M40 170 Q70 180 64 150 Q58 164 50 164 Q70 150 60 130 Q52 150 44 156Z" fill="' + c0(c, 0) + '" ' + SW + '/><ellipse cx="32" cy="166" rx="13" ry="10" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="22" cy="156" r="7" fill="' + c0(c, 1) + '" ' + SW + '/><circle cx="20" cy="155" r="1.8" fill="' + OUT + '"/><path d="M15 157 L9 159 L15 160Z" fill="' + c0(c, 0) + '"/><path class="it-flicker" d="M22 149 q-2 -8 4 -12 q-1 6 2 8" fill="' + c0(c, 0) + '"/></g>'); };

  // Сияние (поверх всего, но прозрачное)
  T.a_stars = function (c) { var s = ''; for (var i = 0; i < 10; i++) { var x = 14 + (i * 37) % 176, y = 12 + (i * 53) % 150; s += '<path class="it-fall" style="animation-delay:' + (i * 0.45) + 's" d="M' + x + ' ' + (y - 5) + ' l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6Z" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; } return s; };
  T.a_snow = function (c) { var s = ''; for (var i = 0; i < 16; i++) s += '<circle class="it-fall" style="animation-delay:' + (i * 0.35) + 's" cx="' + ((i * 41) % 200) + '" cy="' + ((i * 29) % 120) + '" r="' + (i % 3 + 1.5) + '" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; return s; };
  T.a_salute = function (c) { var s = ''; [[40, 40], [160, 30], [110, 20]].forEach(function (p, j) { for (var i = 0; i < 10; i++) { var a = i / 10 * Math.PI * 2; s += '<path class="it-burst" style="animation-delay:' + (j * 0.6) + 's" d="M' + p[0] + ' ' + p[1] + ' L' + (p[0] + Math.cos(a) * 16).toFixed(1) + ' ' + (p[1] + Math.sin(a) * 16).toFixed(1) + '" stroke="' + c0(c, j % 3) + '" stroke-width="2.5" stroke-linecap="round"/>'; } }); return s; };
  T.a_sparks = function (c) { var s = ''; for (var i = 0; i < 14; i++) { var a = i / 14 * Math.PI * 2, x = 100 + Math.cos(a) * 78, y = 110 + Math.sin(a) * 78; s += '<circle class="it-twinkle" style="animation-delay:' + (i * 0.2) + 's" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (i % 2 ? 2 : 3.2) + '" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '"/>'; } return '<g class="it-spin">' + s + '</g>'; };
  T.a_fire = function (c) { var s = ''; for (var i = 0; i < 9; i++) { var x = 24 + i * 19; s += '<path class="it-flicker" style="animation-delay:' + (i * 0.15) + 's" d="M' + x + ' 196 Q' + (x - 10) + ' 176 ' + x + ' 156 Q' + (x + 10) + ' 176 ' + x + ' 196Z" fill="' + (i % 2 ? c0(c, 0) : c0(c, 1)) + '" opacity=".75"/>'; } return s; };
  T.a_vortex = function (c) { return '<g class="it-spin" opacity=".7"><path d="M100 110 m-80 0 a80 80 0 1 1 160 0" fill="none" stroke="' + c0(c, 0) + '" stroke-width="4" stroke-dasharray="10 12" stroke-linecap="round"/><path d="M100 110 m-66 0 a66 66 0 1 0 132 0" fill="none" stroke="' + c0(c, 1) + '" stroke-width="3" stroke-dasharray="6 10" stroke-linecap="round"/></g>'; };


  // ── Мемные вещи и пак «Дед инсайд» (v3, 27.09.2026) ─────────────────────
  // Те же координаты, что у остальных вещей: вещь садится и на малыша, и на
  // взрослую анатомию через привязки слотов. Бренды и чужих персонажей не рисуем.

  // Голова
  T.foilhat = function (c) {
    return '<path d="M58 66 L100 6 L142 66 Q100 56 58 66Z" fill="' + c0(c, 0, '#cfd6de') + '" ' + SW + '/>' +
      '<path d="M100 6 L86 38 L104 34 L92 62 M100 6 L114 40 L126 38 L130 62 M74 50 L90 52" fill="none" stroke="' + c0(c, 1, '#8a96a3') + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M100 10 L94 30" stroke="#fff" stroke-width="3" opacity=".7" stroke-linecap="round"/>' +
      '<path d="M58 66 Q100 56 142 66 L142 72 Q100 62 58 72Z" fill="' + shade(c0(c, 0, '#cfd6de'), -0.1) + '" ' + SW + '/>';
  };
  T.sidecap = function (c) {
    return '<g transform="rotate(-24 100 52)"><path d="M62 62 Q62 30 100 28 Q138 30 138 62Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M100 28 v34" stroke="' + shade(c0(c, 0), -0.25) + '" stroke-width="2"/><circle cx="100" cy="28" r="3.5" fill="' + c0(c, 1) + '" ' + SW + '/>' +
      '<path d="M136 58 L178 62 Q182 68 174 70 L134 66Z" fill="' + c0(c, 1) + '" ' + SW + '/></g>';
  };
  T.panamaege = function (c) {
    return T.panama(c) + '<path d="M66 58 Q100 50 134 58 L134 63 Q100 55 66 63Z" fill="' + c0(c, 2, '#2f63c9') + '"/>' +
      '<text x="100" y="61" text-anchor="middle" font-size="7" font-weight="900" fill="#fff" font-family="Arial">Я СДАМ ЕГЭ</text>';
  };
  T.halo = function (c) {
    return '<g class="it-float"><ellipse cx="100" cy="30" rx="36" ry="9" fill="none" stroke="' + c0(c, 1, '#b8912f') + '" stroke-width="8"/>' +
      '<ellipse cx="100" cy="30" rx="36" ry="9" fill="none" stroke="' + c0(c, 0, '#ffd23f') + '" stroke-width="5"/>' +
      '<path d="M76 26 Q86 22 96 22" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/></g>';
  };
  T.horns = function (c) {
    return '<path d="M72 54 Q58 30 70 18 Q72 34 84 46Z" fill="' + c0(c, 0, '#d0342c') + '" ' + SW + '/><path d="M128 54 Q142 30 130 18 Q128 34 116 46Z" fill="' + c0(c, 0, '#d0342c') + '" ' + SW + '/>' +
      '<path d="M70 24 Q72 34 80 42" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/>';
  };
  T.papercrown = function (c) {
    return '<path d="M62 64 L62 36 L76 50 L88 28 L100 48 L112 28 L124 50 L138 36 L138 64Z" fill="' + c0(c, 0, '#fff4c2') + '" ' + SW + '/>' +
      '<path d="M66 58 L134 58" stroke="' + c0(c, 1, '#e0a458') + '" stroke-width="2" stroke-dasharray="4 3"/>' +
      '<text x="100" y="56" text-anchor="middle" font-size="12" font-weight="900" fill="' + c0(c, 1, '#e0a458') + '" font-family="Arial">5?</text>';
  };
  T.bucket = function (c) {
    return '<g class="it-shine"><path d="M60 68 L70 12 L130 12 L140 68Z" fill="' + c0(c, 0, '#b7c0c9') + '" ' + SW + '/>' +
      '<path d="M66 40 L134 40 M63 56 L137 56" stroke="' + shade(c0(c, 0, '#b7c0c9'), -0.25) + '" stroke-width="3"/>' +
      '<path d="M78 18 L74 60" stroke="#fff" stroke-width="4" opacity=".55" stroke-linecap="round"/>' +
      '<path d="M60 68 Q100 110 140 68" fill="none" stroke="' + shade(c0(c, 0, '#b7c0c9'), -0.35) + '" stroke-width="3"/>' +
      '<ellipse cx="100" cy="12" rx="30" ry="4" fill="' + shade(c0(c, 0, '#b7c0c9'), -0.2) + '" ' + SW + '/></g>';
  };
  T.whitebangs = function (c) {
    return '<path d="M52 92 Q48 40 100 36 Q152 40 148 92 Q140 70 124 64 Q126 84 114 102 Q110 80 100 70 Q96 92 78 106 Q84 82 76 68 Q60 76 52 92Z" fill="' + c0(c, 0, '#f4f4f6') + '" ' + SW + '/>' +
      '<path d="M84 44 Q80 60 82 74 M104 42 Q104 56 106 66 M122 48 Q126 58 128 66" fill="none" stroke="' + c0(c, 1, '#c9ccd6') + '" stroke-width="2" stroke-linecap="round"/>';
  };
  T.headphones = function (c) {
    return '<path d="M54 90 Q52 34 100 32 Q148 34 146 90" fill="none" stroke="' + c0(c, 0, '#15151a') + '" stroke-width="8"/>' +
      '<rect x="40" y="76" width="18" height="32" rx="8" fill="' + c0(c, 0, '#15151a') + '" ' + SW + '/><rect x="142" y="76" width="18" height="32" rx="8" fill="' + c0(c, 0, '#15151a') + '" ' + SW + '/>' +
      '<rect x="44" y="82" width="4" height="20" rx="2" fill="' + c0(c, 1, '#e0341a') + '"/><rect x="152" y="82" width="4" height="20" rx="2" fill="' + c0(c, 1, '#e0341a') + '"/>' +
      '<text x="100" y="30" text-anchor="middle" font-size="9" font-weight="900" fill="' + c0(c, 1, '#e0341a') + '" font-family="Arial">zxc</text>';
  };

  // Лицо
  T.thug = function () {
    var s = '', px = function (x, y, w, h, col) { s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + col + '"/>'; };
    px(58, 82, 84, 6, '#111'); px(64, 88, 28, 6, '#111'); px(108, 88, 28, 6, '#111'); px(68, 94, 20, 5, '#111'); px(112, 94, 20, 5, '#111');
    px(70, 88, 5, 5, '#fff'); px(114, 88, 5, 5, '#fff'); px(76, 94, 5, 4, '#fff'); px(120, 94, 5, 4, '#fff');
    return '<g class="it-drop">' + s + '</g>';
  };
  T.gigachad = function (c) {
    var dots = '';
    for (var i = 0; i < 16; i++) dots += '<circle cx="' + (76 + (i % 8) * 7) + '" cy="' + (120 + Math.floor(i / 8) * 7 + (i % 2) * 2) + '" r="1.1" fill="' + c0(c, 1, '#3a2a1e') + '" opacity=".7"/>';
    return '<g class="it-shine"><path d="M60 98 Q60 142 100 148 Q140 142 140 98 L132 100 Q130 134 100 138 Q70 134 68 100Z" fill="' + c0(c, 0, '#000') + '" opacity=".18"/>' +
      '<path d="M60 98 Q60 142 100 148 Q140 142 140 98" fill="none" stroke="' + OUT + '" stroke-width="3"/>' + dots +
      '<path d="M100 134 L100 146" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M68 76 L92 80 M108 80 L132 76" stroke="' + OUT + '" stroke-width="4.5" stroke-linecap="round"/></g>';
  };
  T.sigma = function (c) {
    return '<path d="M66 80 L94 84 L94 88 L66 86Z M134 80 L106 84 L106 88 L134 86Z" fill="' + c0(c, 0, '#15151a') + '"/>' +
      '<path d="M90 108 Q100 106 110 104" stroke="' + OUT + '" stroke-width="2.5" fill="none" stroke-linecap="round"/>';
  };
  T.bruise = function (c) { return '<ellipse cx="118" cy="91" rx="15" ry="12" fill="' + c0(c, 0, '#7b4bb3') + '" opacity=".55"/><ellipse cx="118" cy="92" rx="11" ry="9" fill="' + c0(c, 1, '#b04b8a') + '" opacity=".35"/>'; };
  T.lashes = function (c) {
    var s = '';
    [[82, 1], [118, -1]].forEach(function (e) { for (var i = -2; i <= 2; i++) s += '<path d="M' + (e[0] + i * 4) + ' 81 l' + (i * 2) + ' -7" stroke="' + c0(c, 0, '#15151a') + '" stroke-width="2" stroke-linecap="round"/>'; });
    return s;
  };
  T.unibrow = function (c) { return '<path d="M66 78 Q84 70 100 76 Q116 70 134 78 Q116 76 100 81 Q84 76 66 78Z" fill="' + c0(c, 0, '#2a1f18') + '" ' + SW + '/>'; };
  T.ghoulmask = function (c) {
    var teeth = '';
    for (var i = 0; i < 9; i++) teeth += '<rect x="' + (72 + i * 6.5) + '" y="108" width="5.5" height="11" rx="1.5" fill="' + c0(c, 1, '#f4f1e6') + '" stroke="#000" stroke-width="1"/>';
    return '<g class="it-shine"><path d="M58 100 Q60 136 100 140 Q140 136 142 100 Q122 96 100 98 Q78 96 58 100Z" fill="' + c0(c, 0, '#15151a') + '" ' + SW + '/>' + teeth +
      '<path d="M70 114 L130 114" stroke="#000" stroke-width="1.5"/><path d="M58 100 L46 96 M142 100 L154 96" stroke="' + c0(c, 0, '#15151a') + '" stroke-width="4" stroke-linecap="round"/></g>';
  };
  T.eyepatch = function (c) {
    return '<path d="M52 72 L148 104" stroke="' + c0(c, 0, '#15151a') + '" stroke-width="3"/><ellipse cx="82" cy="90" rx="13" ry="11" fill="' + c0(c, 0, '#15151a') + '" ' + SW + '/>' +
      '<path d="M76 86 Q80 83 86 84" stroke="#fff" stroke-width="1.5" opacity=".4" fill="none"/>';
  };
  T.redeye = function (c) {
    return '<g class="it-mythic-lite"><ellipse cx="118" cy="90" rx="9" ry="10" fill="' + c0(c, 1, '#0b0b0b') + '" stroke="' + OUT + '" stroke-width="2"/>' +
      '<circle cx="118" cy="90" r="5" fill="' + c0(c, 0, '#e0341a') + '"/><circle cx="118" cy="90" r="2" fill="#000"/><path d="M110 104 Q114 112 112 120" stroke="' + c0(c, 0, '#e0341a') + '" stroke-width="1.5" fill="none" opacity=".7"/></g>';
  };

  // Одежда
  T.tracksuit = function (c) {
    return torso(c0(c, 0), '<path d="M66 128 L70 182 M134 128 L130 182" stroke="#fff" stroke-width="3"/><path d="M71 128 L75 182 M129 128 L125 182" stroke="#fff" stroke-width="3"/>' +
      '<path d="M100 118 L100 184" stroke="' + shade(c0(c, 0), -0.4) + '" stroke-width="2"/><rect x="96" y="120" width="8" height="10" rx="2" fill="#c9ccd6" stroke="' + OUT + '" stroke-width="1.5"/>') + sleeves(c0(c, 0));
  };
  T.furjuly = function (c) {
    var fluff = '';
    for (var i = 0; i < 12; i++) fluff += '<circle cx="' + (58 + (i % 6) * 17) + '" cy="' + (128 + Math.floor(i / 6) * 50) + '" r="10" fill="' + c0(c, 0) + '" ' + SW + '/>';
    return T.furcoat([c0(c, 0), c0(c, 1), '#e9c46a']) + fluff +
      '<path class="pet-tear" d="M58 110 Q54 118 58 121 Q62 118 58 110Z" fill="#7fc8f8"/><path class="pet-tear" style="animation-delay:.8s" d="M142 114 Q138 122 142 125 Q146 122 142 114Z" fill="#7fc8f8"/>';
  };
  T.barejacket = function (c) {
    return '<path d="M60 136 Q62 118 86 118 L90 150 L82 184 Q66 180 60 170Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M140 136 Q138 118 114 118 L110 150 L118 184 Q134 180 140 170Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M86 118 L96 138 L90 150 M114 118 L104 138 L110 150" fill="' + shade(c0(c, 0), 0.2) + '" ' + SW + '/>' +
      '<path d="M122 132 l8 0" stroke="' + c0(c, 1, '#e0341a') + '" stroke-width="4"/>' + sleeves(c0(c, 0));
  };
  T.pajama = function (c) {
    var cats = '';
    [[78, 138], [112, 146], [86, 166], [120, 172]].forEach(function (p) {
      cats += '<g transform="translate(' + p[0] + ' ' + p[1] + ')"><circle r="5" fill="' + c0(c, 1, '#fff') + '"/><path d="M-5 -2 L-4 -8 L-1 -4 M5 -2 L4 -8 L1 -4" fill="' + c0(c, 1, '#fff') + '"/><circle cx="-1.8" cy="-.5" r=".9" fill="#333"/><circle cx="1.8" cy="-.5" r=".9" fill="#333"/></g>';
    });
    return torso(c0(c, 0), cats + '<path d="M100 118 L100 184" stroke="' + shade(c0(c, 0), -0.2) + '" stroke-width="2" stroke-dasharray="3 5"/>') + sleeves(c0(c, 0));
  };
  T.blackhoodie = function (c) {
    return '<path d="M70 124 Q100 104 130 124 L126 132 Q100 118 74 132Z" fill="' + shade(c0(c, 0), 0.12) + '" ' + SW + '/>' +
      torso(c0(c, 0), '<path d="M92 128 L90 150 M108 128 L110 150" stroke="#e8e8ea" stroke-width="2"/><circle cx="90" cy="151" r="2" fill="#e8e8ea"/><circle cx="110" cy="151" r="2" fill="#e8e8ea"/>' +
      '<path d="M78 164 Q100 170 122 164 L122 176 Q100 182 78 176Z" fill="' + shade(c0(c, 0), 0.08) + '" ' + SW + '/>') + sleeves(c0(c, 0));
  };
  T.scorpion = function (c) {
    return torso(c0(c, 0), '<path d="M84 118 L100 134 L116 118" fill="none" stroke="' + shade(c0(c, 0), -0.2) + '" stroke-width="3"/>' +
      '<g transform="translate(100 156)" fill="' + c0(c, 1, '#e9c46a') + '" stroke="' + OUT + '" stroke-width="1.2"><ellipse rx="7" ry="9"/><path d="M0 -9 Q10 -18 4 -24 Q2 -18 -2 -16"/><path d="M-7 -2 L-16 -8 L-14 -2Z M7 -2 L16 -8 L14 -2Z M-6 5 L-13 10 M6 5 L13 10" stroke-width="2"/></g>' +
      '<path d="M66 134 Q70 126 76 128" stroke="#fff" stroke-width="2.5" opacity=".6" fill="none"/>') + sleeves(c0(c, 0));
  };
  T.sigmasuit = function (c) {
    return torso(c0(c, 0), '<path d="M86 118 L100 150 L114 118Z" fill="#fff" ' + SW + '/><path d="M100 122 L96 132 L100 158 L104 132Z" fill="#15151a" ' + SW + '/>' +
      '<path d="M86 118 L96 146 L90 150 M114 118 L104 146 L110 150" fill="none" stroke="' + shade(c0(c, 0), 0.25) + '" stroke-width="2"/>' +
      '<path d="M116 136 l8 0 l-2 6 l-4 0Z" fill="' + c0(c, 1, '#e0341a') + '"/>') + sleeves(c0(c, 0));
  };

  // Шея
  T.chain100 = function (c) {
    var s = '';
    for (var i = 0; i < 13; i++) { var a = (15 + i * 12.5) * Math.PI / 180; s += '<ellipse cx="' + (100 - Math.cos(a) * 36).toFixed(1) + '" cy="' + (124 + Math.sin(a) * 26).toFixed(1) + '" rx="5.5" ry="4" fill="none" stroke="' + c0(c, 0, '#e9c46a') + '" stroke-width="3.5"/>'; }
    return '<g class="it-shine">' + s + '<circle cx="100" cy="162" r="14" fill="' + c0(c, 0, '#e9c46a') + '" ' + SW + '/><text x="100" y="167" text-anchor="middle" font-size="12" font-weight="900" fill="' + c0(c, 1, '#8a5a00') + '" font-family="Arial">100</text></g>';
  };
  T.freshener = function (c) {
    return '<path d="M100 128 L100 140" stroke="#fff" stroke-width="1.5"/><path d="M100 140 L88 156 L94 156 L84 170 L92 170 L80 184 L120 184 L108 170 L116 170 L106 156 L112 156Z" fill="' + c0(c, 0, '#2fa84f') + '" ' + SW + '/><path d="M96 180 v6" stroke="' + OUT + '" stroke-width="3"/>';
  };
  T.foilbow = function (c) { return '<g>' + T.bowtie([c0(c, 0, '#cfd6de')]) + '<path d="M86 126 L94 134 M114 126 L106 134 M88 136 L92 132" stroke="' + c0(c, 1, '#8a96a3') + '" stroke-width="1.4"/></g>'; };
  T.medalpatience = function (c) {
    return '<path d="M92 124 L100 150 L108 124" fill="' + c0(c, 1, '#2f63c9') + '" ' + SW + '/><circle cx="100" cy="158" r="11" fill="' + c0(c, 0, '#c0c7d0') + '" ' + SW + '/>' +
      '<text x="100" y="161" text-anchor="middle" font-size="5.5" font-weight="900" fill="' + OUT + '" font-family="Arial">ТЕРПЕНИЕ</text>';
  };
  T.choker = function (c) {
    var sp = '';
    for (var i = 0; i < 7; i++) sp += '<path d="M' + (78 + i * 7.3) + ' 131 l3 7 3 -7Z" fill="' + c0(c, 1, '#c0c7d0') + '" stroke="' + OUT + '" stroke-width="1"/>';
    return '<path d="M72 124 Q100 138 128 124 L128 131 Q100 145 72 131Z" fill="' + c0(c, 0, '#15151a') + '" ' + SW + '/>' + sp;
  };
  T.longscarf = function (c) {
    var s = '<path d="M66 124 Q100 140 134 124 L136 136 Q100 152 64 136Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M112 136 L118 200 L132 200 L126 134Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
    for (var y = 146; y < 200; y += 12) s += '<path d="M' + (113 + (y - 136) * 0.09) + ' ' + y + ' L' + (127 + (y - 136) * 0.09) + ' ' + y + '" stroke="' + c0(c, 1) + '" stroke-width="4"/>';
    return s;
  };

  // В руке
  T.slipper = function (c) {
    return held('<g class="it-shine"><path d="M140 160 Q144 110 166 92 Q184 96 180 118 Q170 148 150 166Z" fill="' + c0(c, 0, '#ff8fb1') + '" ' + SW + '/>' +
      '<path d="M162 100 Q178 104 176 118 Q166 116 160 108Z" fill="' + shade(c0(c, 0, '#ff8fb1'), -0.2) + '" ' + SW + '/><circle cx="170" cy="106" r="7" fill="' + c0(c, 1, '#fff') + '" ' + SW + '/>' +
      '<path d="M178 80 l4 -8 M186 90 l8 -2 M184 84 l6 -6" stroke="' + OUT + '" stroke-width="2.5" stroke-linecap="round"/></g>');
  };
  T.seeds = function (c) {
    var s = '<path d="M134 136 L170 136 L152 176Z" fill="' + c0(c, 0, '#f4f1e6') + '" ' + SW + '/>';
    [[142, 132], [150, 128], [158, 132], [154, 124], [146, 126]].forEach(function (p) { s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="3" ry="5" fill="' + c0(c, 1, '#2b2233') + '" transform="rotate(' + (p[0] - 150) * 4 + ' ' + p[0] + ' ' + p[1] + ')"/>'; });
    return held(s);
  };
  T.bagofbags = function (c) {
    return held('<path d="M132 138 Q130 176 154 178 Q180 176 176 138Z" fill="' + c0(c, 0, '#f4f4f6') + '" ' + SW + '/><path d="M140 138 Q142 122 150 138 M160 138 Q164 122 170 138" fill="none" ' + SW + '/>' +
      '<path d="M144 138 Q150 130 156 140 Q162 128 168 140" fill="' + c0(c, 1, '#2f63c9') + '" ' + SW + '/><path d="M140 150 Q154 160 170 150" fill="none" stroke="#c9ccd6" stroke-width="1.5"/>');
  };
  T.cheatsheet = function (c) {
    return held('<g transform="rotate(-12 156 142)"><rect x="140" y="124" width="34" height="42" rx="2" fill="' + c0(c, 0, '#fffbe6') + '" ' + SW + '/>' +
      '<path d="M144 132 h26 M144 138 h22 M144 144 h26 M144 150 h18 M144 156 h24" stroke="' + c0(c, 1, '#2f63c9') + '" stroke-width="1.3"/><text x="157" y="130" text-anchor="middle" font-size="5" font-weight="900" fill="#d0342c" font-family="Arial">1242 1380 1480</text></g>');
  };
  T.calculator = function (c) {
    var keys = '';
    for (var i = 0; i < 12; i++) keys += '<rect x="' + (140 + (i % 3) * 9) + '" y="' + (142 + Math.floor(i / 3) * 7) + '" width="7" height="5" rx="1" fill="' + (i % 3 === 2 ? '#e0a458' : '#dfe3ea') + '"/>';
    return held('<rect x="136" y="122" width="34" height="50" rx="4" fill="' + c0(c, 0, '#6b737c') + '" ' + SW + '/><rect x="140" y="127" width="26" height="11" fill="' + c0(c, 1, '#b8e0a0') + '"/>' +
      '<text x="164" y="136" text-anchor="end" font-size="8" font-family="monospace" fill="#1f3a1f">1242</text>' + keys);
  };
  T.shawarma = function (c) {
    return held('<g transform="rotate(-20 156 140)"><path d="M144 118 L168 118 L166 168 Q156 174 146 168Z" fill="' + c0(c, 0, '#e7d3a8') + '" ' + SW + '/>' +
      '<path d="M144 118 Q150 108 156 116 Q162 106 168 118" fill="' + c0(c, 1, '#5bb04a') + '" ' + SW + '/><path d="M146 140 L166 138 L166 168 Q156 174 146 168Z" fill="#dfe6ee" ' + SW + '/>' +
      '<path d="M148 126 h16 M148 132 h14" stroke="#b8743a" stroke-width="2"/></g>');
  };
  T.mughist = function (c) {
    return held('<path d="M136 132 L166 132 L163 170 Q151 176 139 170Z" fill="' + c0(c, 0, '#ffffff') + '" ' + SW + '/><path d="M166 140 Q178 142 175 154 Q172 160 164 158" fill="none" ' + SW + '/>' +
      '<text x="151" y="148" text-anchor="middle" font-size="5" font-weight="900" fill="' + c0(c, 1, '#d0342c') + '" font-family="Arial">ЛУЧШИЙ</text><text x="151" y="155" text-anchor="middle" font-size="5" font-weight="900" fill="' + c0(c, 1, '#d0342c') + '" font-family="Arial">ИСТОРИК</text>' +
      '<path class="it-steam" d="M144 126 q-4 -8 2 -14 M154 126 q-4 -8 2 -14" fill="none" stroke="#bbb" stroke-width="2" stroke-linecap="round"/>');
  };
  T.bandage = function (c) {
    return '<g><path d="M128 138 L148 136 M128 146 L150 144 M128 154 L148 152 M130 162 L146 160" stroke="' + c0(c, 0, '#f4f1e6') + '" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M128 138 L148 136 M128 146 L150 144 M128 154 L148 152 M130 162 L146 160" stroke="' + OUT + '" stroke-width="1" stroke-linecap="round" opacity=".35"/>' +
      '<path class="it-wave" d="M148 160 Q160 170 158 184 Q164 176 168 186" fill="none" stroke="' + c0(c, 0, '#f4f1e6') + '" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="138" cy="150" r="2" fill="' + c0(c, 1, '#d0342c') + '" opacity=".7"/></g>';
  };
  T.chainsaw = function (c) {
    var teeth = '';
    for (var i = 0; i < 9; i++) teeth += '<path d="M' + (158 + i * 3.6) + ' ' + (132 - i * 5.8) + ' l4 -1 -1 4Z" fill="' + OUT + '"/>';
    return held('<g class="it-shine"><path d="M156 138 L186 84 Q192 80 194 88 L166 142Z" fill="' + c0(c, 1, '#c3cad2') + '" ' + SW + '/>' + teeth +
      '<rect x="130" y="132" width="36" height="26" rx="6" fill="' + c0(c, 0, '#f08a24') + '" ' + SW + '/><path d="M136 132 Q140 120 152 122" fill="none" stroke="' + OUT + '" stroke-width="4"/>' +
      '<rect x="136" y="140" width="10" height="10" rx="2" fill="' + OUT + '"/></g>');
  };
  T.bluefire = function (c) {
    return held('<g class="it-mythic"><path class="it-flicker" d="M150 150 Q130 130 146 104 Q150 120 158 118 Q156 100 168 90 Q170 110 178 118 Q186 138 166 152Z" fill="' + c0(c, 0, '#3b82f6') + '" ' + SW + '/>' +
      '<path class="it-flicker" style="animation-delay:.2s" d="M156 148 Q146 134 156 120 Q160 132 166 130 Q170 140 162 150Z" fill="' + c0(c, 1, '#bfe3ff') + '"/>' +
      '<circle class="it-twinkle" cx="180" cy="100" r="2" fill="#bfe3ff"/><circle class="it-twinkle" style="animation-delay:.5s" cx="140" cy="110" r="1.6" fill="#bfe3ff"/></g>');
  };

  // Место
  T.bg_carpet = function (c) {
    var s = '<rect width="200" height="200" fill="#efe4d0"/><rect x="18" y="12" width="164" height="150" rx="6" fill="' + c0(c, 0, '#9b1c2c') + '" stroke="#5a0f18" stroke-width="4"/>';
    s += '<rect x="30" y="24" width="140" height="126" fill="none" stroke="' + c0(c, 1, '#e9c46a') + '" stroke-width="3" stroke-dasharray="6 4"/>';
    for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++) {
      var x = 60 + q * 40, y = 50 + r * 38;
      s += '<path d="M' + x + ' ' + (y - 14) + ' L' + (x + 14) + ' ' + y + ' L' + x + ' ' + (y + 14) + ' L' + (x - 14) + ' ' + y + 'Z" fill="' + ((r + q) % 2 ? '#1f4e79' : c0(c, 1, '#e9c46a')) + '" stroke="#5a0f18" stroke-width="1.5"/><circle cx="' + x + '" cy="' + y + '" r="4" fill="#fff"/>';
    }
    return s + '<rect x="0" y="176" width="200" height="24" fill="#8a5a2b"/>';
  };
  T.bg_panel = function (c) {
    var s = '<rect width="200" height="200" fill="#c7d4df"/><rect x="20" y="30" width="160" height="150" fill="' + c0(c, 0, '#b8b8b0') + '" stroke="#8a8a82" stroke-width="3"/>';
    for (var r = 0; r < 5; r++) for (var q = 0; q < 6; q++) s += '<rect x="' + (30 + q * 25) + '" y="' + (40 + r * 27) + '" width="16" height="16" fill="' + ((r * 6 + q) % 7 === 3 ? '#ffe98a' : '#6d8fb0') + '" stroke="#555" stroke-width="1.5"/>';
    return s + '<path d="M20 30 L180 30" stroke="#777" stroke-width="5"/>' + '<path d="M0 180 L200 180 L200 200 L0 200Z" fill="#7a7a72"/>';
  };
  T.bg_minibus = function (c) {
    return '<defs></defs><rect width="200" height="200" fill="#dcefff"/><path d="M0 150 L200 150 L200 200 L0 200Z" fill="#7a7a72"/><path d="M0 172 h24 M40 172 h24 M80 172 h24 M120 172 h24 M160 172 h24" stroke="#fff" stroke-width="3"/>' +
      '<rect x="14" y="70" width="172" height="76" rx="12" fill="' + c0(c, 0, '#f2c500') + '" stroke="#2b2233" stroke-width="3"/>' +
      '<rect x="26" y="80" width="30" height="26" rx="3" fill="#bfe3ff" stroke="#2b2233" stroke-width="2"/><rect x="62" y="80" width="30" height="26" rx="3" fill="#bfe3ff" stroke="#2b2233" stroke-width="2"/><rect x="98" y="80" width="30" height="26" rx="3" fill="#bfe3ff" stroke="#2b2233" stroke-width="2"/><rect x="134" y="80" width="40" height="26" rx="3" fill="#bfe3ff" stroke="#2b2233" stroke-width="2"/>' +
      '<rect x="140" y="112" width="30" height="12" fill="#fff" stroke="#2b2233" stroke-width="1.5"/><text x="155" y="121" text-anchor="middle" font-size="9" font-weight="900" font-family="Arial">№ 1242</text>' +
      '<circle cx="50" cy="148" r="13" fill="#2b2233"/><circle cx="150" cy="148" r="13" fill="#2b2233"/><circle cx="50" cy="148" r="5" fill="#aaa"/><circle cx="150" cy="148" r="5" fill="#aaa"/>';
  };
  T.bg_759 = function (c) {
    return '<rect width="200" height="200" fill="#e9efe6"/><rect x="16" y="30" width="120" height="70" rx="3" fill="' + c0(c, 0, '#2f5a3a') + '" stroke="#8a5a2b" stroke-width="4"/>' +
      '<text x="76" y="62" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial">Контрольная</text><text x="76" y="82" text-anchor="middle" font-size="10" fill="#fff" font-family="Comic Sans MS, Arial">по датам</text>' +
      '<circle cx="164" cy="50" r="22" fill="#fff" stroke="#2b2233" stroke-width="3"/><path d="M164 50 L164 34 M164 50 L176 50" stroke="#2b2233" stroke-width="3" stroke-linecap="round"/><path d="M164 50 L164 35" stroke="#d0342c" stroke-width="1.5" transform="rotate(354 164 50)"/>' +
      '<text x="164" y="86" text-anchor="middle" font-size="10" font-weight="900" font-family="Arial" fill="#d0342c">7:59</text><rect x="0" y="172" width="200" height="28" fill="#c9a877"/>';
  };
  T.bg_gym = function (c) {
    return '<rect width="200" height="200" fill="' + c0(c, 0, '#2a2d33') + '"/><rect x="120" y="20" width="66" height="120" fill="#9fb4c8" opacity=".35" stroke="#555" stroke-width="3"/>' +
      '<rect x="0" y="170" width="200" height="30" fill="#1b1d21"/><path d="M14 158 L96 158" stroke="#c3cad2" stroke-width="5"/><rect x="10" y="140" width="10" height="36" rx="3" fill="#111"/><rect x="90" y="140" width="10" height="36" rx="3" fill="#111"/>' +
      '<text x="153" y="84" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1, '#e0341a') + '" font-family="Arial">NO PAIN</text><text x="153" y="98" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1, '#e0341a') + '" font-family="Arial">NO ЕГЭ</text>';
  };
  T.bg_rainroof = function (c) {
    var s = '<rect width="200" height="200" fill="' + c0(c, 0, '#161a2b') + '"/>';
    [[10, 60, 30], [44, 44, 40], [90, 70, 30], [126, 36, 44], [174, 58, 30]].forEach(function (b, i) {
      s += '<rect x="' + b[0] + '" y="' + b[1] + '" width="' + b[2] + '" height="' + (160 - b[1]) + '" fill="#232842"/>';
      for (var k = 0; k < 6; k++) s += '<rect x="' + (b[0] + 6 + (k % 2) * 12) + '" y="' + (b[1] + 8 + Math.floor(k / 2) * 18) + '" width="6" height="8" fill="' + ((i + k) % 3 ? '#39406a' : '#ffd23f') + '"/>';
    });
    for (var i = 0; i < 18; i++) s += '<path class="it-fall" style="animation-delay:' + (i * 0.23).toFixed(2) + 's;animation-duration:1.4s" d="M' + ((i * 37) % 200) + ' ' + ((i * 53) % 120) + ' l-4 12" stroke="' + c0(c, 1, '#9fb4c8') + '" stroke-width="1.5" opacity=".7"/>';
    return s + '<path d="M0 160 L200 160 L200 200 L0 200Z" fill="#0e1120"/><path d="M0 160 L200 160" stroke="#39406a" stroke-width="3"/>';
  };

  // Спутники
  T.c_capybara = function (c) {
    return buddy('<ellipse cx="34" cy="172" rx="24" ry="14" fill="' + c0(c, 0, '#9c6b3f') + '" ' + SW + '/><path d="M14 168 Q10 150 26 148 Q36 150 34 162Z" fill="' + c0(c, 0, '#9c6b3f') + '" ' + SW + '/>' +
      '<circle cx="20" cy="152" r="1.8" fill="' + OUT + '"/><ellipse cx="12" cy="158" rx="4" ry="3" fill="' + shade(c0(c, 0, '#9c6b3f'), -0.3) + '"/><path d="M28 146 l2 -4 3 3" fill="' + c0(c, 0, '#9c6b3f') + '" ' + SW + '/>' +
      '<circle cx="24" cy="140" r="6" fill="' + c0(c, 1, '#f59e0b') + '" ' + SW + '/><path d="M24 134 l2 -3" stroke="#3f9a3a" stroke-width="2"/><path d="M22 184 v6 M44 184 v6" stroke="' + OUT + '" stroke-width="3"/>');
  };
  T.c_goose = function (c) {
    return buddy('<ellipse cx="38" cy="174" rx="18" ry="12" fill="' + c0(c, 0, '#f4f4f6') + '" ' + SW + '/><path d="M26 170 Q18 150 24 138" fill="none" stroke="' + OUT + '" stroke-width="10" stroke-linecap="round"/><path d="M26 170 Q18 150 24 138" fill="none" stroke="' + c0(c, 0, '#f4f4f6') + '" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M22 136 L12 139 L22 142Z" fill="#f08a24" ' + SW + '/><circle cx="25" cy="136" r="1.6" fill="' + OUT + '"/>' +
      '<path d="M18 130 Q24 120 32 130Z" fill="' + c0(c, 1, '#f2b705') + '" ' + SW + '/><path d="M34 186 v6 M44 186 v6" stroke="#f08a24" stroke-width="3"/>');
  };
  T.c_dumpling = function (c) {
    return buddy('<path d="M14 182 Q14 154 36 154 Q58 154 58 182Z" fill="' + c0(c, 0, '#f7f1e3') + '" ' + SW + '/><path d="M20 160 q4 -4 8 0 q4 -4 8 0 q4 -4 8 0 q4 -4 8 0" fill="none" stroke="' + shade(c0(c, 0, '#f7f1e3'), -0.2) + '" stroke-width="2"/>' +
      '<path d="M22 158 L20 148 L28 154 M50 158 L52 148 L44 154" fill="' + c0(c, 0, '#f7f1e3') + '" ' + SW + '/><circle cx="30" cy="170" r="1.8" fill="' + OUT + '"/><circle cx="42" cy="170" r="1.8" fill="' + OUT + '"/><path d="M33 175 q3 2 6 0" stroke="' + OUT + '" stroke-width="1.5" fill="none"/>');
  };
  T.c_pigeon = function (c) {
    return buddy('<ellipse cx="36" cy="172" rx="17" ry="12" fill="' + c0(c, 0, '#9aa3ad') + '" ' + SW + '/><circle cx="24" cy="158" r="8" fill="' + c0(c, 0, '#9aa3ad') + '" ' + SW + '/>' +
      '<path d="M18 164 Q24 170 32 164" fill="none" stroke="' + c0(c, 1, '#5bb04a') + '" stroke-width="4"/><path d="M17 158 L11 160 L17 162Z" fill="#e0a458"/><circle cx="23" cy="156" r="1.6" fill="#e0341a"/>' +
      '<path d="M44 168 Q56 164 54 176Z" fill="' + shade(c0(c, 0, '#9aa3ad'), -0.2) + '" ' + SW + '/><path d="M30 184 v6 M40 184 v6" stroke="#e07a6a" stroke-width="2.5"/>');
  };
  T.c_roach = function (c) {
    return buddy('<ellipse cx="36" cy="178" rx="16" ry="9" fill="' + c0(c, 0, '#7a4a24') + '" ' + SW + '/><path d="M36 170 L36 186" stroke="' + shade(c0(c, 0, '#7a4a24'), -0.3) + '" stroke-width="1.5"/>' +
      '<circle cx="20" cy="176" r="6" fill="' + c0(c, 0, '#7a4a24') + '" ' + SW + '/><path d="M16 172 Q6 160 12 152 M18 171 Q14 158 22 150" fill="none" stroke="' + OUT + '" stroke-width="1.5"/>' +
      '<circle cx="18" cy="175" r="1.5" fill="#fff"/><path d="M26 184 l-4 6 M36 186 l0 6 M46 184 l4 6" stroke="' + OUT + '" stroke-width="1.5"/>');
  };

  // Сияние
  T.a_friday = function () {
    var s = '', col = ['#ff4d6d', '#ffd23f', '#4dabf7', '#18a058', '#a855f7'];
    for (var i = 0; i < 16; i++) s += '<rect class="it-fall" style="animation-delay:' + (i * 0.27).toFixed(2) + 's" x="' + ((i * 41) % 200) + '" y="' + ((i * 29) % 110) + '" width="5" height="8" rx="1" fill="' + col[i % 5] + '" transform="rotate(' + (i * 37 % 90) + ' ' + ((i * 41) % 200) + ' ' + ((i * 29) % 110) + ')"/>';
    return s + '<circle class="it-twinkle" cx="170" cy="30" r="10" fill="#e9e3ff" opacity=".8"/>';
  };
  T.a_deadline = function () {
    return '<g class="it-pulse"><circle cx="100" cy="110" r="84" fill="none" stroke="#ef4444" stroke-width="4" opacity=".6"/><circle cx="100" cy="110" r="76" fill="none" stroke="#ef4444" stroke-width="2" opacity=".35"/></g>' +
      '<g class="it-float"><circle cx="30" cy="40" r="11" fill="#fff" stroke="#ef4444" stroke-width="2.5"/><path d="M30 40 v-7 M30 40 h6" stroke="#ef4444" stroke-width="2"/><text x="170" y="40" text-anchor="middle" font-size="14" font-weight="900" fill="#ef4444" font-family="Arial">23:59</text></g>';
  };
  T.a_zen = function () {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<circle class="it-ripple" style="animation-delay:' + (i * 1.2) + 's" cx="100" cy="186" r="30" fill="none" stroke="#7bd3c3" stroke-width="2"/>';
    return s + '<text class="it-float" x="100" y="24" text-anchor="middle" font-size="16" fill="#7bd3c3" font-family="serif">☯</text>';
  };
  T.a_thousand = function () {
    var nums = ['1000-7', '993', '986', '979', '972', '965', '958', '951'], s = '';
    for (var i = 0; i < nums.length; i++) s += '<text class="it-fall" style="animation-delay:' + (i * 0.5) + 's;animation-duration:4s" x="' + (18 + (i * 47) % 170) + '" y="' + (10 + (i * 23) % 60) + '" font-size="' + (i ? 11 : 13) + '" font-weight="900" fill="' + (i % 2 ? '#fff' : '#e0341a') + '" font-family="monospace" opacity=".85">' + nums[i] + '</text>';
    return '<g class="it-mythic">' + s + '</g>';
  };

  // Спецэффекты состояния, которые висят в воздухе (не на голове).
  // ── Перерисовано 27.09.2026 (отзыв владельца: «максимально кринжево») ────
  // Янтарная комната: янтарная мозаика в золочёных рамах, зеркальные пилястры со
  // свечами, лепной карниз и паркет — узнаваемо, а не «вафля из квадратиков».
  T.bg_amber = function (c) {
    var a = c0(c, 0, '#f2a93b'), d = c0(c, 1, '#8a4b12'), g = '#e9c46a', gd = '#b8912f';
    var glow = uid('amb'), mir = uid('mir');
    var s = '<defs><radialGradient id="' + glow + '" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#fff3c4" stop-opacity=".55"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + mir + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdfaf0"/><stop offset=".5" stop-color="#cfe3ea"/><stop offset="1" stop-color="#f6f0dc"/></linearGradient></defs>';
    s += '<rect width="200" height="200" fill="' + shade(a, -0.25) + '"/>';
    // Три янтарные панели: мозаика из неровных плиток разных оттенков.
    var panels = [[10, 30, 50, 116], [75, 30, 50, 116], [140, 30, 50, 116]];
    var seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    panels.forEach(function (p) {
      s += '<rect x="' + p[0] + '" y="' + p[1] + '" width="' + p[2] + '" height="' + p[3] + '" fill="' + a + '"/>';
      for (var y = 0; y < 6; y++) for (var x = 0; x < 3; x++) {
        var px = p[0] + 2 + x * 16 + (y % 2 ? 4 : 0), py = p[1] + 2 + y * 19;
        if (px + 12 > p[0] + p[2]) continue;
        var k = rnd() * 0.5 - 0.25;
        s += '<path d="M' + px + ' ' + (py + 3) + ' L' + (px + 6 + rnd() * 4).toFixed(1) + ' ' + py + ' L' + (px + 13) + ' ' + (py + 4) + ' L' + (px + 12) + ' ' + (py + 15) + ' L' + (px + 4) + ' ' + (py + 17) + ' L' + px + ' ' + (py + 11) + 'Z" fill="' + shade(a, k) + '" stroke="' + shade(d, 0.1) + '" stroke-width=".8" opacity=".95"/>';
      }
      // Золочёная рама с уголками-завитками.
      s += '<rect x="' + (p[0] - 2) + '" y="' + (p[1] - 2) + '" width="' + (p[2] + 4) + '" height="' + (p[3] + 4) + '" fill="none" stroke="' + g + '" stroke-width="3.5"/>' +
        '<rect x="' + (p[0] - 2) + '" y="' + (p[1] - 2) + '" width="' + (p[2] + 4) + '" height="' + (p[3] + 4) + '" fill="none" stroke="' + gd + '" stroke-width="1" />';
      [[p[0], p[1]], [p[0] + p[2], p[1]], [p[0], p[1] + p[3]], [p[0] + p[2], p[1] + p[3]]].forEach(function (q) {
        s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="4" fill="' + g + '" stroke="' + gd + '" stroke-width="1"/>';
      });
      // Картуш в центре панели.
      var cx = p[0] + p[2] / 2;
      s += '<ellipse cx="' + cx + '" cy="' + (p[1] + 58) + '" rx="13" ry="17" fill="' + shade(a, 0.25) + '" stroke="' + g + '" stroke-width="3"/>' +
        '<ellipse cx="' + cx + '" cy="' + (p[1] + 58) + '" rx="7" ry="10" fill="' + shade(a, -0.1) + '" opacity=".7"/>' +
        '<path d="M' + (cx - 6) + ' ' + (p[1] + 40) + ' l3 -5 3 4 3 -4 3 5Z" fill="' + g + '" stroke="' + gd + '" stroke-width=".8"/>';
    });
    // Зеркальные пилястры со свечами между панелями.
    [62, 127].forEach(function (x) {
      s += '<rect x="' + (x + 1) + '" y="30" width="9" height="116" fill="url(#' + mir + ')" stroke="' + g + '" stroke-width="2.5"/>' +
        '<path d="M' + (x + 3) + ' 40 L' + (x + 8) + ' 60" stroke="#fff" stroke-width="1.5" opacity=".8"/>' +
        '<path d="M' + (x - 2) + ' 84 Q' + (x + 5.5) + ' 92 ' + (x + 13) + ' 84" fill="none" stroke="' + g + '" stroke-width="2.5"/>' +
        '<rect x="' + (x - 3) + '" y="74" width="3" height="10" fill="#fffaf0" stroke="' + gd + '" stroke-width=".6"/><rect x="' + (x + 11) + '" y="74" width="3" height="10" fill="#fffaf0" stroke="' + gd + '" stroke-width=".6"/>' +
        '<path class="it-flicker" d="M' + (x - 1.5) + ' 67 q2 3 0 7 q-2 -3 0 -7Z M' + (x + 12.5) + ' 67 q2 3 0 7 q-2 -3 0 -7Z" fill="#ffcf4a"/>';
    });
    // Лепной карниз с арочками.
    s += '<rect x="0" y="0" width="200" height="22" fill="' + shade(a, -0.3) + '"/><rect x="0" y="18" width="200" height="6" fill="' + g + '" stroke="' + gd + '" stroke-width="1"/>';
    for (var i = 0; i < 10; i++) s += '<path d="M' + (i * 20 + 2) + ' 18 Q' + (i * 20 + 10) + ' 6 ' + (i * 20 + 18) + ' 18" fill="none" stroke="' + g + '" stroke-width="2"/>';
    // Паркет «ёлочкой» и плинтус.
    s += '<rect x="0" y="150" width="200" height="50" fill="' + shade(d, -0.05) + '"/>';
    for (var j = 0; j < 14; j++) for (var r = 0; r < 3; r++) {
      var fx = j * 15 - 4, fy = 154 + r * 16;
      s += '<path d="M' + fx + ' ' + fy + ' l8 6 l0 8 l-8 -6Z" fill="' + shade(d, 0.18) + '" stroke="' + shade(d, -0.3) + '" stroke-width=".6"/><path d="M' + (fx + 8) + ' ' + (fy + 6) + ' l8 -6 l0 8 l-8 6Z" fill="' + shade(d, 0.05) + '" stroke="' + shade(d, -0.3) + '" stroke-width=".6"/>';
    }
    s += '<rect x="0" y="148" width="200" height="5" fill="' + g + '" stroke="' + gd + '" stroke-width="1"/>';
    return '<g class="it-shine">' + s + '</g><rect width="200" height="200" fill="url(#' + glow + ')"/>';
  };

  // Мышь-архивариус: сидит боком, в круглых очках и со свитком в лапках.
  T.c_mouse = function (c) {
    var f = c0(c, 0, '#9aa3ad'), p = c0(c, 1, '#f2b8c6');
    return buddy('<path d="M16 186 Q2 186 4 172 Q6 162 14 166" fill="none" stroke="' + shade(f, -0.15) + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M22 191 C10 191 8 172 18 164 C26 157 42 156 48 165 C54 174 52 191 42 191Z" fill="' + f + '" ' + SW + '/>' +
      '<ellipse cx="38" cy="180" rx="8" ry="9" fill="' + shade(f, 0.35) + '"/>' +
      '<ellipse cx="25" cy="191" rx="6" ry="2.6" fill="' + p + '" ' + SW + '/><ellipse cx="43" cy="191" rx="6" ry="2.6" fill="' + p + '" ' + SW + '/>' +
      '<circle cx="45" cy="149" r="9" fill="' + f + '" ' + SW + '/><circle cx="45" cy="149" r="5.5" fill="' + p + '"/>' +
      '<path d="M40 166 C38 152 52 146 62 152 L71 158 C74 160 73 164 69 164 C64 170 54 172 46 170Z" fill="' + f + '" ' + SW + '/>' +
      '<circle cx="71" cy="161" r="2.4" fill="' + p + '" stroke="' + OUT + '" stroke-width="1"/>' +
      '<circle cx="57" cy="157" r="2.3" fill="' + OUT + '"/><circle cx="57.8" cy="156.2" r=".8" fill="#fff"/>' +
      '<circle cx="57" cy="157" r="5" fill="none" stroke="#c9a227" stroke-width="1.4"/><path d="M52 156 L46 154" stroke="#c9a227" stroke-width="1.2"/>' +
      '<path d="M66 165 L76 163 M66 166 L75 169" stroke="' + OUT + '" stroke-width=".8" opacity=".7"/>' +
      '<g transform="rotate(-12 58 178)"><rect x="50" y="171" width="16" height="13" rx="1.5" fill="#f3e6c4" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<rect x="48" y="170" width="3.5" height="15" rx="1.7" fill="#d9c28e" stroke="' + OUT + '" stroke-width="1.2"/><rect x="64.5" y="170" width="3.5" height="15" rx="1.7" fill="#d9c28e" stroke="' + OUT + '" stroke-width="1.2"/>' +
      '<path d="M54 175 h8 M54 178 h6 M54 181 h8" stroke="#8a6a44" stroke-width="1"/></g>' +
      '<circle cx="51" cy="180" r="2.6" fill="' + p + '" ' + SW + '/><circle cx="62" cy="182" r="2.6" fill="' + p + '" ' + SW + '/>');
  };

  // Сивка-бурка: лошадка в профиль, грива на ветру, дымок из ноздрей, искры.
  T.c_horse = function (c) {
    var f = c0(c, 0, '#8a6a44'), m = c0(c, 1, '#3a2a1e');
    var legs = '';
    [[17, 0], [25, 1], [45, 0], [53, 1]].forEach(function (l) {
      legs += '<path d="M' + l[0] + ' 174 L' + (l[0] + (l[1] ? 1 : -1)) + ' 188" stroke="' + (l[1] ? shade(f, -0.2) : f) + '" stroke-width="5" stroke-linecap="round"/>' +
        '<rect x="' + (l[0] - 3.5 + (l[1] ? 1 : -1)) + '" y="187" width="7" height="4" rx="1.2" fill="' + OUT + '"/>';
    });
    return buddy('<path d="M16 166 C4 166 2 180 7 190 C9 182 12 176 17 172Z" fill="' + m + '" ' + SW + '/>' +
      legs +
      '<ellipse cx="35" cy="168" rx="21" ry="11" fill="' + f + '" ' + SW + '/>' +
      '<ellipse cx="33" cy="164" rx="12" ry="4" fill="#fff" opacity=".18"/>' +
      '<path d="M46 166 C47 154 51 146 57 141 L65 147 C61 153 58 161 57 170Z" fill="' + f + '" ' + SW + '/>' +
      '<path d="M55 140 C60 133 69 135 73 144 C75 149 73 153 69 153 L63 151 C60 149 57 146 55 143Z" fill="' + f + '" ' + SW + '/>' +
      '<ellipse cx="70" cy="150" rx="3.6" ry="2.6" fill="' + shade(f, -0.15) + '"/><circle cx="71" cy="149.5" r=".9" fill="' + OUT + '"/>' +
      '<path d="M58 139 L59 130 L63 137Z" fill="' + f + '" ' + SW + '/>' +
      '<circle cx="63" cy="142" r="1.8" fill="' + OUT + '"/><circle cx="63.6" cy="141.4" r=".6" fill="#fff"/>' +
      '<path d="M57 136 C50 138 46 146 44 158 C47 152 49 150 51 149 C49 155 48 160 47 165 C51 158 53 152 57 146 C58 142 59 139 57 136Z" fill="' + m + '" ' + SW + '/>' +
      '<g class="it-steam"><circle cx="74" cy="154" r="1.6" fill="#d9d9e0"/><circle cx="72" cy="157" r="1.2" fill="#e6e6ec"/></g>' +
      '<path class="it-twinkle" d="M10 146 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1Z" fill="#ffd23f"/>' +
      '<path class="it-twinkle" style="animation-delay:.6s" d="M40 144 l.8 2.4 2.4 .8 -2.4 .8 -.8 2.4 -.8 -2.4 -2.4 -.8 2.4 -.8Z" fill="#ffd23f"/>');
  };

  // Двуглавый орлёнок: пушистый птенец, две головы смотрят в разные стороны,
  // на каждой коронка, над ними большая корона, на груди — щиток.
  T.c_eagle = function (c) {
    var g = c0(c, 0, '#e9c46a'), gd = c0(c, 1, '#b8912f');
    var wing = function (dir) {
      var x = 38 + dir * 12;
      return '<path d="M' + x + ' 168 C' + (x + dir * 14) + ' 166 ' + (x + dir * 22) + ' 156 ' + (x + dir * 22) + ' 144 L' + (x + dir * 17) + ' 150 L' + (x + dir * 18) + ' 142 L' + (x + dir * 12) + ' 150 L' + (x + dir * 11) + ' 144 L' + (x + dir * 6) + ' 156 Z" fill="' + gd + '" ' + SW + '/>';
    };
    var head = function (dir) {
      var hx = 38 + dir * 10;
      return '<path d="M' + (38 + dir * 4) + ' 164 C' + (38 + dir * 4) + ' 158 ' + hx + ' 156 ' + hx + ' 152" stroke="' + g + '" stroke-width="7" fill="none"/>' +
        '<circle cx="' + hx + '" cy="150" r="7.5" fill="' + g + '" ' + SW + '/>' +
        '<path d="M' + (hx + dir * 6) + ' 148 L' + (hx + dir * 13) + ' 151 L' + (hx + dir * 6) + ' 154Z" fill="#f08a24" stroke="' + OUT + '" stroke-width="1.2" stroke-linejoin="round"/>' +
        '<circle cx="' + (hx + dir * 2.5) + '" cy="148.5" r="1.8" fill="' + OUT + '"/><circle cx="' + (hx + dir * 3) + '" cy="148" r=".6" fill="#fff"/>' +
        '<path d="M' + (hx - 4) + ' 143 L' + (hx - 4) + ' 138 L' + (hx - 2) + ' 140.5 L' + hx + ' 137 L' + (hx + 2) + ' 140.5 L' + (hx + 4) + ' 138 L' + (hx + 4) + ' 143Z" fill="' + g + '" stroke="' + gd + '" stroke-width="1"/>';
    };
    return buddy('<g class="it-shine">' + wing(-1) + wing(1) +
      '<ellipse cx="38" cy="176" rx="15" ry="14" fill="' + g + '" ' + SW + '/>' +
      '<path d="M30 170 q2 -3 4 0 q2 -3 4 0 q2 -3 4 0 q2 -3 4 0" fill="none" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<path d="M32 172 H44 V179 Q44 185 38 187 Q32 185 32 179Z" fill="#c0392b" stroke="' + gd + '" stroke-width="1.6"/>' +
      '<path d="M38 175 v8 M35 178 h6" stroke="#fff" stroke-width="1.4"/>' +
      head(-1) + head(1) +
      '<path d="M31 137 L31 131 L34.5 134 L38 128 L41.5 134 L45 131 L45 137Z" fill="' + g + '" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<path d="M38 128 V124 M36.5 125.5 H39.5" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<circle cx="34.5" cy="135" r=".9" fill="#c0392b"/><circle cx="41.5" cy="135" r=".9" fill="#1d8a5a"/>' +
      '<path d="M32 189 l-3 3 M34 189 l0 4 M36 189 l3 3 M40 189 l-3 3 M42 189 l0 4 M44 189 l3 3" stroke="#f08a24" stroke-width="1.6" stroke-linecap="round"/></g>');
  };

  // Галстук Столыпина: строгий шёлковый галстук эпохи с золотой булавкой.
  // Название — отсылка к думской остроте 1907 года («столыпинский галстук»),
  // но рисуем именно галстук: петли на шее у питомца не будет.
  T.stolypin = function (c) {
    var t = c0(c, 0, '#1b2a4a'), g = c0(c, 1, '#e9c46a');
    var cl = uid('stl');
    return '<g class="it-shine"><defs><clipPath id="' + cl + '"><path d="M95 133 L88 166 L100 176 L112 166 L105 133Z"/></clipPath></defs>' +
      '<path d="M84 118 L98 126 L94 132 L82 124Z M116 118 L102 126 L106 132 L118 124Z" fill="#fbfaf5" ' + SW + '/>' +
      '<path d="M95 133 L88 166 L100 176 L112 166 L105 133Z" fill="' + t + '" ' + SW + '/>' +
      '<g clip-path="url(#' + cl + ')" stroke="' + g + '" stroke-width="2" opacity=".75">' +
        '<path d="M80 150 L120 130 M80 160 L120 140 M80 170 L120 150 M80 180 L120 160"/></g>' +
      '<path d="M93 124 L107 124 L105 134 L95 134Z" fill="' + shade(t, 0.15) + '" ' + SW + '/>' +
      '<path d="M97 126 L103 126" stroke="#fff" stroke-width="1" opacity=".35"/>' +
      '<rect x="92" y="147" width="16" height="3" rx="1.5" fill="' + g + '" stroke="' + OUT + '" stroke-width="1"/>' +
      '<circle cx="100" cy="148.5" r="3.6" fill="' + g + '" stroke="' + OUT + '" stroke-width="1"/><circle cx="100" cy="148.5" r="1.4" fill="#c0392b"/></g>';
  };

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
    function layer(slot) {
      var id = eq[slot]; if (!id || !items[id]) return '';
      var art = items[id].art || {}; var fn = T[art.t];
      return fn ? '<g class="slot-' + slot + ' r-' + items[id].rarity + '">' + fn(art.c || []) + '</g>' : '';
    }
    var best = null;
    Object.keys(eq).forEach(function (slot) { var it = items[eq[slot]]; if (it && (!best || RANK_OF[it.rarity] > RANK_OF[best])) best = it.rarity; });
    var body, cls3 = '';
    if (HUMAN[sp]) {
      cls3 = ' v3 human';
      body = renderHuman(sp, stage, state, layer, eq, state === 'sick');
    } else if (stage === 'baby') {
      var k = STAGE_SCALE[stage];
      body = '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)"><g class="pet-body">' +
        speciesBack(sp, p, stage) + speciesBody(sp, p, stage) + layer('body') + armL(sp, p) +
        '<g class="pet-head">' + speciesHead(sp, p, stage) + face(sp, p, state, stage) + layer('face') + layer('head') +
        (state === 'sick' ? sickHead() : '') + '</g>' +
        layer('neck') + '<g class="pet-arm-r">' + armR(sp, p) + layer('hand') + '</g></g></g>';
    } else {
      // Подросток и старше — взрослый облик v3; вещи садятся через привязки слотов.
      cls3 = ' v3';
      var q = V3[sp], ids = { fur: uid('v3f'), furD: uid('v3d'), belly: uid('v3b') };
      var k3 = stage === 'teen' ? 0.92 : 1;
      body = v3Defs(q, ids) + '<g transform="translate(100 190) scale(' + k3 + ') translate(-100 -190)"><g class="pet-body">' +
        v3Back(sp, q, ids, stage) + v3Body(sp, q, ids, stage) +
        '<g transform="' + V3_BODY_T + '">' + layer('body') + '</g>' + v3ArmL(sp, q, ids) +
        '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
        '<g class="pet-head"><g transform="' + V3_HEAD_T + '">' + v3Head(sp, q, ids, stage) + v3Face(sp, q, state, stage) + layer('face') + layer('head') +
        (state === 'sick' ? sickHead() : '') + '</g></g>' +
        '<g class="pet-arm-r">' + v3ArmR(sp, q, ids) + layer('hand') + '</g></g></g>';
    }
    var bg = '';
    if (eq.bg) bg = layer('bg');
    else if (opts.scene) bg = scene(opts.scene === 'night');
    // Фон режем по рамке: у питомца overflow виден (шапки и сияние выходят за край),
    // а у фона — нет, иначе круг «Открытого космоса» вылезал бы на соседей.
    if (bg) bg = '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + bg + '</svg>';
    var shadow = '<ellipse class="pet-shadow" cx="100" cy="191" rx="' + (46 * (stage === 'baby' ? STAGE_SCALE.baby : 1)).toFixed(1) + '" ry="5" fill="#000" opacity=".13"/>';
    var cls = 'pet-svg st-' + state + ' stage-' + stage + ' sp-' + sp + cls3 + (best ? ' best-' + best : '') + (opts.anim === false ? ' no-anim' : '') + (opts.mini ? ' mini' : '');
    return '<svg class="' + cls + '" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escAttr(opts.label || 'Питомец') + '">' +
      bg + (opts.styleIcon ? styleAura() : '') + rarityAura(best) + layer('pet') + shadow + body + layer('aura') + (opts.mini ? '' : extras(state)) + '</svg>';
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
    boost_elixir: '⚡', streak_freeze: '🧊',
    box_chest: '🧰', box_tsar: '👑', box_week: '🏆',
  };

  window.PetArt = { render: render, renderItem: renderItem, templates: T, species: SPECIES, icons: ICONS, shade: shade, stageScale: STAGE_SCALE };
})();
