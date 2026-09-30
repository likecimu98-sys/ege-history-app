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
    squid:    { fur: '#a9d6c5', belly: '#d4efe5', inner: '#8c6a34', nose: '#20302b' },
    burunday: { fur: '#58616d', belly: '#dfa979', inner: '#e3b448', nose: '#241810' },
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
    if(Tailor)return s;
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
    if(Tailor) return '<g class="pet-arm-l">'+tailorArm('l',p.fur,OUT)+'</g>';
    if (sp === 'owl') return '<g class="pet-arm-l"><path d="M62 132 Q44 152 58 176 Q66 162 68 140Z" fill="' + shade(p.fur, -0.15) + '" ' + SW + '/></g>';
    return '<g class="pet-arm-l"><ellipse cx="62" cy="152" rx="10" ry="15" transform="rotate(20 62 152)" fill="' + p.fur + '" ' + SW + '/></g>';
  }
  function armR(sp, p) {
    if(Tailor) return tailorArm('r',p.fur,OUT);
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
    if (sp !== 'owl') s += altMouths(my, OUT);
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
  // Взрослый и Мудрец — голова меньше относительно тела: пропорции взрослее
  // (отзыв владельца: «персонажи слишком детские»). Подросток — как был.
  function v3HeadT(stage) { return stage === 'teen' ? V3_HEAD_T : 'translate(100 71) scale(0.75) translate(-100 -88)'; }
  var V3_BODY_T = 'translate(100 101) scale(0.84 0.92) translate(-100 -118)';
  var V3_NECK_T = 'translate(100 104) scale(0.84) translate(-100 -126)';
  // Одежда взрослого облика садится по силуэту тела: сверху — круглые плечи
  // «яйца» (иначе куртка выглядела прямоугольником на животе), снизу — место
  // для длинных пол шинели и мантии.
  var V3_CLOTH = 'M100 97 C126 97 138 116 138 136 L148 198 L52 198 L62 136 C62 116 74 97 100 97Z';
  // Плащ за спиной: плечи малыша (y 118) → плечи взрослого (102), подол (190) → земля (188).
  var V3_BACK_T = 'translate(100 102) scale(0.9 1.19) translate(-100 -118)';

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
    if(Tailor)return s+'<path d="M86 98H114V115H86Z" fill="url(#'+ids.fur+')"/>';
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
    if(Tailor) return '<g class="pet-arm-l">'+tailorArm('l',sp==='owl'?shade(p.fur,-.18):'url(#'+ids.fur+')',p.ink)+'</g>';
    var cuff = SLEEVE.fill ? '<path class="audit-sleeve" d="M70 111 C62 116 57 130 58 141 Q64 146 72 143 C72 132 75 124 80 118Z" fill="' + SLEEVE.fill + '" ' + v3o(p) + '/><path d="M59 139 Q65 144 73 140" fill="none" stroke="' + shade(SLEEVE.fill,-.2) + '" stroke-width="2"/>' : '';
    if (sp === 'owl') return '<g class="pet-arm-l"><path d="M72 110 C54 124 50 146 60 162 C66 150 72 134 80 118Z" fill="' + shade(p.fur, -0.18) + '" ' + v3o(p) + '/>' + cuff + '</g>';
    return '<g class="pet-arm-l"><path d="M70 112 C60 120 56 136 58 150 C60 156 68 158 72 152 C72 140 74 128 80 118Z" fill="url(#' + ids.fur + ')" ' + v3o(p) + '/><path d="M59 150 q2 5 6 5 M63 152 q2 5 6 3" fill="none" stroke="' + p.ink + '" stroke-width="1.5" stroke-linecap="round"/>' + cuff + '</g>';
  }
  function v3ArmR(sp, p, ids) {
    if(Tailor) return tailorArm('r',sp==='owl'?shade(p.fur,-.18):'url(#'+ids.fur+')',p.ink);
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
    if (state !== 'sick' && stage === 'teen') s += '<g class="pet-cheeks"><ellipse cx="68" cy="106" rx="7" ry="3.5" fill="#ff8fa3" opacity=".3"/><ellipse cx="132" cy="106" rx="7" ry="3.5" fill="#ff8fa3" opacity=".3"/></g>';
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
    if (sp !== 'owl') s += altMouths(my, ink);
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    if (sp === 'kitten' && state !== 'sick') s += '<path d="M62 104 L42 100 M62 110 L42 112 M138 104 L158 100 M138 110 L158 112" stroke="' + ink + '" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>';
    if (stage === 'sage' && sp === 'owl') s += '<path d="M86 126 Q100 140 114 126" fill="none" stroke="#f4f4f4" stroke-width="3"/>';
    return s;
  }

  // ── Сменная мимика (28.09.2026): набор ртов, скрытых по умолчанию. Stage в
  // pet.js время от времени ставит на svg data-x="smile|grin|o|smirk|flat|tongue|think",
  // CSS плавно гасит обычный рот и проявляет нужный. Рисуется ПЕРЕД .pet-mouth —
  // чтобы правило «.pet-mx ~ .pet-mouth» могло прятать обычный рот.
  function altMouths(my, ink) {
    var o = 'fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"';
    return '<g class="pet-mx">' +
      '<path class="mx-smile" d="M89 ' + my + ' Q100 ' + (my + 10) + ' 111 ' + my + '" ' + o + '/>' +
      '<g class="mx-grin"><path d="M88 ' + my + ' Q100 ' + (my + 13) + ' 112 ' + my + 'Z" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/><path d="M90.5 ' + (my + 1.2) + ' Q100 ' + (my + 4.5) + ' 109.5 ' + (my + 1.2) + '" stroke="#fff" stroke-width="2.6" fill="none"/></g>' +
      '<ellipse class="mx-o" cx="100" cy="' + (my + 3) + '" rx="3.6" ry="4.6" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2"/>' +
      '<path class="mx-smirk" d="M91 ' + (my + 2) + ' Q101 ' + (my + 3.5) + ' 110 ' + (my - 3.5) + '" ' + o + '/>' +
      '<path class="mx-flat" d="M93 ' + (my + 2) + ' H107" ' + o + '/>' +
      '<g class="mx-tongue"><path d="M90 ' + my + ' Q100 ' + (my + 8) + ' 110 ' + my + '" ' + o + '/><path d="M99 ' + (my + 3.5) + ' q0 7 5 7 q5 0 5 -7Z" fill="#ff8fa3" stroke="' + ink + '" stroke-width="1.8" stroke-linejoin="round"/></g>' +
      '</g>';
  }

  // ── Фирменные эффекты вещей (концепция 27.09.2026) ───────────────────────
  // Редкость видна не рамкой карточки, а тем, что вещь делает с питомцем:
  // легенда меняет поведение (своё действие, реплики), миф превращает питомца
  // целиком (материал, свет, фон) — и это видно всем, даже в мини-аватаре топа.
  // Ключ — шаблон рисунка вещи (art.t).
  // fx — частицы при фирменном действии: [цвета, точка вылета (% сцены), направление].
  var SIGNATURES = {
    // ── Легенды: своё движение питомца ──
    chainsaw: { tier: 'legendary', act: 'rev', desc: 'Легенда: питомец газует бензопилой — дым, тряска, опилки',
      fx: { colors: ['#c9a36b', '#e0c38f', '#8a6a44'], at: [88, 44], dx: [10, 40], dy: [-40, -10] },
      say: ['Вжжжжух!', 'Разберу эту таблицу на щепки', 'Кто тут не выучил даты?', 'Бррр-рррм!'] },
    bicorne: { tier: 'legendary', act: 'salute', desc: 'Легенда: питомец отдаёт честь, как Кутузов на смотре',
      fx: { colors: ['#e3b448', '#fff3b0'], at: [58, 26], dx: [-20, 20], dy: [-40, -20] },
      say: ['Отступаем — чтобы победить!', 'С потерею Москвы не потеряна Россия', 'Терпение и время!'] },
    crown: { tier: 'legendary', act: 'regal', desc: 'Легенда: питомец царственно поднимает голову, корона вспыхивает',
      fx: { colors: ['#ffd23f', '#fff3b0', '#e3b448'], at: [50, 18], dx: [-40, 40], dy: [-30, 0] },
      say: ['Я — империя', 'Корону — не трогать', 'Ну-с, кто сегодня решал?'] },
    mantle: { tier: 'legendary', act: 'twirl', desc: 'Легенда: питомец кружится в мантии — горностай и блёстки',
      fx: { colors: ['#ffffff', '#b3262d', '#e3b448'], at: [50, 72], dx: [-50, 50], dy: [-30, 10] },
      say: ['Просвещённый абсолютизм!', 'Вольтер бы оценил', 'Наказ Уложенной комиссии — выучен'] },
    orb: { tier: 'legendary', act: 'raise', desc: 'Легенда: питомец поднимает державу, как на коронации',
      fx: { colors: ['#ffd23f', '#fff3b0'], at: [74, 44], dx: [-20, 20], dy: [-40, -20] },
      say: ['Держава в надёжных лапах', 'Самодержец всея таблицы', 'Коронация — в 1896-м!'] },
    mask: { tier: 'legendary', act: 'bow', desc: 'Легенда: питомец отвешивает поклон, как на петровской ассамблее',
      fx: { colors: ['#ff6b8a', '#4dabf7', '#ffd23f', '#18a058'], at: [50, 40], dx: [-50, 50], dy: [-40, 10] },
      say: ['Пётр велел веселиться!', 'Ассамблея — с 1718 года', 'Танцуем менуэт!'] },
    gigachad: { tier: 'legendary', act: 'chad', desc: 'Легенда: питомец поворачивает голову в профиль, как на том самом фото',
      fx: { colors: ['#ffffff', '#dfe6ee'], at: [56, 50], dx: [-10, 30], dy: [-30, -10] },
      say: ['Здарова, отличник', 'Даты сами себя не выучат', 'Спокойно. Мы сдадим'] },
    slipper: { tier: 'legendary', act: 'swing', desc: 'Легенда: питомец замахивается бабушкиным тапком',
      fx: { colors: ['#ff8fb1', '#ffffff'], at: [80, 40], dx: [10, 50], dy: [-30, 0] },
      say: ['А ну быстро решать!', 'Уроки сделал?', 'Сейчас кто-то получит'] },
    ghoulmask: { tier: 'legendary', act: 'zxc', desc: 'Легенда: щёлкают зубы маски, глаз вспыхивает красным',
      fx: { colors: ['#e0341a', '#15151a'], at: [50, 40], dx: [-30, 30], dy: [-30, 0] },
      say: ['zxc', '1000-7… 993…', 'Тьма внутри'] },
    c_eagle: { tier: 'legendary', act: 'flap', desc: 'Легенда: орлёнок машет крыльями и подпрыгивает',
      fx: { colors: ['#ffd23f', '#e3b448'], at: [18, 78], dx: [-20, 20], dy: [-40, -20] },
      say: ['Орлёнок, орлёнок, взлети выше солнца!', 'Иван III одобряет', 'Двуглавый — значит вдвое умнее'] },
    stolypin: { tier: 'legendary', act: 'tug', desc: 'Легенда: питомец нервно поправляет «галстук»',
      fx: { colors: ['#7fc8f8'], at: [60, 30], dx: [-10, 20], dy: [-20, 10] },
      say: ['Военно-полевой суд! 1906 год', 'Вам нужны великие потрясения…', 'Нам нужна великая Россия!'] },
    bg_amber: { tier: 'legendary', act: 'admire', desc: 'Легенда: свечи мерцают, питомец любуется янтарём',
      fx: { colors: ['#ffd23f', '#f2a93b'], at: [50, 40], dx: [-60, 60], dy: [-30, 10] },
      say: ['Дар Фридриха Вильгельма I!', 'Воссоздана к 2003 году', 'Красота-то какая'] },
    a_snow: { tier: 'legendary', act: 'shiver', desc: 'Легенда: питомец мёрзнет, как армия Наполеона в 1812-м',
      fx: { colors: ['#ffffff', '#cfe8fb'], at: [50, 30], dx: [-50, 50], dy: [-10, 30] },
      say: ['Брр… генерал Мороз!', 'Березина, 1812…', 'Наполеону тоже было холодно'] },
    a_deadline: { tier: 'legendary', act: 'panic', desc: 'Легенда: паника дедлайна — питомец мечется',
      fx: { colors: ['#e0341a', '#ffd23f'], at: [50, 30], dx: [-50, 50], dy: [-30, 10] },
      say: ['23:59!!!', 'Сдаём! Сдаём!', 'Ещё одну таблицу…'] },
    stareyes: { tier: 'legendary', act: 'starwink', desc: 'Легенда: глаза вспыхивают звёздами',
      fx: { colors: ['#ffd23f', '#ff9f1c'], at: [50, 44], dx: [-40, 40], dy: [-30, 0] },
      say: ['Звезда ЕГЭ — это я', 'Сияю!', 'Автограф? Только после экзамена'] },
    a_sparks: { tier: 'legendary', act: 'dance', desc: 'Легенда: питомец танцует в золотых искрах',
      fx: { colors: ['#ffd23f', '#fff3b0'], at: [50, 50], dx: [-50, 50], dy: [-40, 0] }, say: ['Блещу!', 'Золото, а не питомец'] },
    a_fire: { tier: 'legendary', act: 'dance', desc: 'Легенда: питомец танцует в огне Жар-птицы',
      fx: { colors: ['#ff7a1a', '#ffd23f'], at: [50, 60], dx: [-50, 50], dy: [-40, -10] }, say: ['Горю желанием учиться!', 'Жарко!'] },
    a_vortex: { tier: 'legendary', act: 'spin', desc: 'Легенда: питомец крутится в алом вихре',
      fx: { colors: ['#e0341a', '#ff9f9f'], at: [50, 50], dx: [-50, 50], dy: [-30, 30] }, say: ['Уииии!', 'Голова кругом от дат'] },
    // ── Мифы: превращение всего питомца ──
    monomakh: { tier: 'mythic', form: 'gold', desc: 'Миф: питомец превращается в золотую статую — блик, лучи и золотая пыль',
      say: ['Тяжела ты, шапка Мономаха…', 'Самодержец всея таблицы', 'Кланяйтесь, холопы ЕГЭ', 'Золото — это я'] },
    firecloak: { tier: 'mythic', form: 'fire', desc: 'Миф: питомец охвачен огнём Жар-птицы — пламенный контур и искры',
      say: ['Я — Жар-птица!', 'Перо на счастье — держи', 'Горю и не сгораю'] },
    bluefire: { tier: 'mythic', form: 'bluefire', desc: 'Миф: питомец горит синим пламенем по контуру',
      say: ['Синее пламя — чистая сила', 'Не обожгись', 'Холодный огонь знаний'] },
    a_thousand: { tier: 'mythic', form: 'mono', desc: 'Миф: мир выцветает в чёрно-белый, остаётся только красное',
      say: ['1000-7…', 'Я гуль', '993… 986… 979…'] },
    sputnik: { tier: 'mythic', form: 'zerog', desc: 'Миф: невесомость — питомец парит среди звёзд',
      say: ['Бип-бип! 4 октября 1957-го!', 'Первый в космосе!', 'Поехали!'] },
    bg_space: { tier: 'mythic', form: 'zerog', desc: 'Миф: открытый космос — питомец парит в невесомости',
      say: ['12 апреля 1961-го!', 'Земля в иллюминаторе…', 'Поехали!'] },
    c_firebird: { tier: 'mythic', form: 'orbit', desc: 'Миф: Жар-птица парит рядом, роняет искры и озаряет питомца тёплым светом',
      say: ['Жар-птица со мной!', 'Сказка Ершова — 1834', 'Перо Жар-птицы — к удаче'] },
  };
  function signaturesOf(eq, items) {
    var out = [];
    Object.keys(eq || {}).forEach(function (slot) {
      var it = items && items[eq[slot]];
      var sg = it && it.art && SIGNATURES[it.art.t];
      if (sg) out.push(Object.assign({ id: it.id, name: it.name, slot: slot }, sg));
    });
    return out;
  }
  // Миф «золото»: всё тело — в золото, по силуэту бежит блик, за спиной лучи,
  // вверх поднимается золотая пыль.
  function goldForm(bodyId) {
    var f = uid('gold'), clip = uid('gclip'), glow = uid('gglow');
    var defs = '<defs><filter id="' + f + '" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">' +
      '<feColorMatrix type="matrix" values="0.42 0.78 0.16 0 0.06  0.33 0.62 0.12 0 0.03  0.12 0.24 0.05 0 0  0 0 0 1 0"/>' +
      '<feComponentTransfer><feFuncR type="gamma" exponent=".8" amplitude="1.15"/><feFuncG type="gamma" exponent=".85" amplitude="1.05"/></feComponentTransfer>' +
      '<feComponentTransfer><feFuncR type="linear" slope="1.3" intercept="-.1"/><feFuncG type="linear" slope="1.3" intercept="-.1"/><feFuncB type="linear" slope="1.2" intercept="-.06"/></feComponentTransfer></filter>' +
      '<clipPath id="' + clip + '"><use href="#' + bodyId + '"/></clipPath>' +
      '<radialGradient id="' + glow + '"><stop offset="0" stop-color="#fff3b0" stop-opacity=".9"/><stop offset="1" stop-color="#ffcf4a" stop-opacity="0"/></radialGradient></defs>';
    var rays = '<g class="sig-rays sig-live">';
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2;
      rays += '<path d="M100 104 L' + (100 + Math.cos(a) * 120).toFixed(1) + ' ' + (104 + Math.sin(a) * 120).toFixed(1) + ' L' + (100 + Math.cos(a + 0.12) * 120).toFixed(1) + ' ' + (104 + Math.sin(a + 0.12) * 120).toFixed(1) + 'Z" fill="#ffd23f" opacity="' + (i % 2 ? 0.18 : 0.3) + '"/>';
    }
    rays += '</g><circle cx="100" cy="100" r="70" fill="url(#' + glow + ')" opacity=".55"/>';
    // Лучи режем по рамке сцены — иначе вылезут на соседние блоки интерфейса.
    rays = '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + rays + '</svg>';
    var dust = '';
    for (var j = 0; j < 10; j++) dust += '<circle class="sig-dust sig-live" style="animation-delay:' + (j * 0.35).toFixed(2) + 's" cx="' + (46 + (j * 29) % 110) + '" cy="' + (150 + (j * 13) % 36) + '" r="' + (j % 3 ? 1.6 : 2.4) + '" fill="#ffe27a"/>';
    return { defs: defs, back: rays, filter: 'url(#' + f + ')', front: '<g clip-path="url(#' + clip + ')"><rect class="sig-gleam sig-live" x="-60" y="-20" width="34" height="260" fill="#fff" opacity=".55" transform="rotate(18 100 100)"/></g>' + dust };
  }

  // Пламя (Плащ Жар-птицы, Синий огонь): вокруг силуэта — рваные языки огня.
  // Цвета самого питомца не трогаем (раньше подкрашивали — кот становился бурым).
  // Контур: расширенный силуэт, искажённый шумом (feTurbulence + feDisplacementMap),
  // снаружи — цвет пламени, у кромки — светлое ядро. В большом окне шум «дышит»
  // (SMIL), в мини-аватаре — статичный: десятки живых фильтров в топе — лишняя нагрузка.
  function flameForm(outer, core, mini) {
    var f = uid('flame'), bg = uid('fbg');
    var anim = mini ? '' : '<animate attributeName="baseFrequency" dur="1.4s" repeatCount="indefinite" values="0.05 0.11;0.065 0.14;0.05 0.11"/>';
    var defs = '<defs><filter id="' + f + '" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="4" result="d"/>' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.05 0.11" numOctaves="2" seed="7" result="n">' + anim + '</feTurbulence>' +
      '<feDisplacementMap in="d" in2="n" scale="14" xChannelSelector="R" yChannelSelector="G" result="fl"/>' +
      '<feGaussianBlur in="fl" stdDeviation="1.6" result="flb"/>' +
      '<feFlood flood-color="' + outer + '"/><feComposite in2="flb" operator="in" result="o"/>' +
      '<feMorphology in="SourceAlpha" operator="dilate" radius="1.6" result="d2"/>' +
      '<feDisplacementMap in="d2" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="fl2"/>' +
      '<feGaussianBlur in="fl2" stdDeviation="1" result="fl2b"/>' +
      '<feFlood flood-color="' + core + '"/><feComposite in2="fl2b" operator="in" result="c"/>' +
      '<feMerge><feMergeNode in="o"/><feMergeNode in="c"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<radialGradient id="' + bg + '"><stop offset="0" stop-color="' + outer + '" stop-opacity=".35"/><stop offset="1" stop-color="' + outer + '" stop-opacity="0"/></radialGradient></defs>';
    var embers = '';
    for (var j = 0; j < 12; j++) embers += '<circle class="sig-dust sig-live" style="animation-delay:' + (j * 0.27).toFixed(2) + 's" cx="' + (48 + (j * 23) % 104) + '" cy="' + (130 + (j * 17) % 50) + '" r="' + (j % 3 ? 1.6 : 2.4) + '" fill="' + (j % 2 ? outer : core) + '"/>';
    return { defs: defs, back: '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><ellipse class="sig-pulse sig-live" cx="100" cy="120" rx="82" ry="88" fill="url(#' + bg + ')"/></svg>',
      filter: 'url(#' + f + ')', front: embers };
  }
  // «1000-7»: чёрно-белый мир, тёмная виньетка, красная пульсация.
  function monoForm() {
    var f = uid('mono'), v = uid('vig');
    var defs = '<defs><filter id="' + f + '" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/>' +
      '<feComponentTransfer><feFuncR type="linear" slope="1.35" intercept="-.12"/><feFuncG type="linear" slope="1.35" intercept="-.12"/><feFuncB type="linear" slope="1.35" intercept="-.12"/></feComponentTransfer></filter>' +
      '<radialGradient id="' + v + '"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>';
    return { defs: defs, back: '', filter: 'url(#' + f + ')',
      front: '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><rect width="200" height="200" fill="url(#' + v + ')"/><rect class="sig-pulse sig-live" width="200" height="200" fill="#e0341a" fill-opacity=".14"/></svg>' };
  }
  // Невесомость (Спутник, космос): питомец парит, вокруг мерцают звёзды.
  function zerogForm() {
    var stars = '';
    var pts = [[20, 30], [44, 18], [150, 26], [176, 48], [30, 90], [170, 100], [60, 60], [140, 70], [16, 150], [184, 140]];
    pts.forEach(function (p, i) { stars += '<path class="it-twinkle sig-live" style="animation-delay:' + (i * 0.3).toFixed(1) + 's" d="M' + p[0] + ' ' + (p[1] - 4) + ' l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2Z" fill="#bfe3ff"/>'; });
    return { defs: '', back: '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + stars + '</svg>', filter: '', front: '', bodyClass: 'sig-float' };
  }
  function phoenixForm() {
    var bg = uid('phx');
    var embers = '';
    for (var j = 0; j < 10; j++) embers += '<circle class="sig-drop sig-live" style="animation-delay:' + (j * 0.32).toFixed(2) + 's" cx="' + (14 + (j * 7) % 34) + '" cy="' + (134 + (j * 5) % 18) + '" r="' + (j % 3 ? 1.5 : 2.2) + '" fill="' + (j % 2 ? '#ff7a1a' : '#ffd23f') + '"/>';
    return { defs: '<defs><radialGradient id="' + bg + '" cx="25%" cy="70%" r="75%"><stop offset="0" stop-color="#ff9a3c" stop-opacity=".45"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>',
      back: '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><rect class="sig-pulse sig-live" width="200" height="200" fill="url(#' + bg + ')"/></svg>',
      filter: '', front: embers };
  }
  function formOf(form, bodyId, mini) {
    if (form === 'gold') return goldForm(bodyId);
    if (form === 'fire') return flameForm('#ff6a13', '#ffe27a', mini);
    if (form === 'bluefire') return flameForm('#2f7bff', '#c9ecff', mini);
    if (form === 'mono') return monoForm();
    if (form === 'zerog') return zerogForm();
    if (form === 'orbit') return phoenixForm();
    return null;
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
    tsar: { skin: '#f3d3ba', ink: '#3a2a20', hair: '#4a3222', beard: '#8a5e3c', iris: '#6f9cc9', coat: '#56633f', coatD: '#3f4a2e',
      dolman: '#3d4a66', gold: '#e3b448', pants: '#2b2f3a', boots: '#1b1b1f' },
    ghoul: { skin: '#ecebf2', ink: '#1d1b24', hair: '#f4f4f8', hairD: '#c3c5d2', iris: '#8a8f9c', coat: '#1d1d22', coatD: '#101014',
      red: '#e0341a', pants: '#1d1d22', boots: '#0d0d10' },
  };
  function humanHeadT(stage) {
    return stage === 'baby' ? 'translate(100 72) scale(0.92) translate(-100 -88)' : v3HeadT(stage);
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
    if(Tailor)return s;
    if (sp === 'tsar' && stage === 'baby') {
      // Цесаревич в матроске.
      s += '<path d="M72 104 Q100 96 128 104 L132 160 Q100 166 68 160Z" fill="#f4f6fa" ' + o + '/>';
      s += '<path d="M76 104 L100 132 L124 104 L128 118 L100 140 L72 118Z" fill="#27458f" ' + o + '/><path d="M80 112 L100 134 L120 112" fill="none" stroke="#fff" stroke-width="1.8"/>';
      s += '<path d="M96 132 L100 142 L104 132Z" fill="#b3262d"/>';
      return s;
    }
    if (sp === 'tsar' && stage === 'adult') {
      // Гусарский доломан, как на портрете: тёмно-синий, золотые шнуры поперёк
      // груди, аксельбант, Георгиевский крест, чёрный каракулевый ворот.
      s += '<path d="M72 104 Q100 96 128 104 L134 160 Q100 168 66 160Z" fill="' + p.dolman + '" ' + o + '/>';
      s += '<path d="M72 104 Q100 96 128 104 L126 112 Q100 104 74 112Z" fill="#000" opacity=".12"/>';
      for (var gi = 0; gi < 5; gi++) {
        var gy = 114 + gi * 9, half = 22 - gi * 1.5;
        s += '<path d="M' + (100 - half) + ' ' + gy + ' L' + (100 + half) + ' ' + gy + '" stroke="' + p.gold + '" stroke-width="2.6" stroke-linecap="round"/>' +
          '<path d="M' + (100 - half) + ' ' + gy + ' q-5 -4 -3 2 q2 4 3 -2 M' + (100 + half) + ' ' + gy + ' q5 -4 3 2 q-2 4 -3 -2" fill="none" stroke="' + p.gold + '" stroke-width="1.8"/>' +
          '<circle cx="' + (100 - half - 4) + '" cy="' + gy + '" r="1.8" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width=".6"/><circle cx="' + (100 + half + 4) + '" cy="' + gy + '" r="1.8" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width=".6"/>';
      }
      s += '<path d="M124 106 C130 118 126 132 114 138 M126 108 C134 122 128 138 116 144" fill="none" stroke="' + p.gold + '" stroke-width="2.2"/>';
      s += '<rect x="80" y="152" width="6" height="7" fill="#f08a24" stroke="' + p.ink + '" stroke-width=".6"/><path d="M82 152 v7 M84 152 v7" stroke="#15151a" stroke-width="1"/>' +
        '<path d="M83 159 l0 8 M79 163 l8 0" stroke="#fbfaf5" stroke-width="3"/>';
      s += '<path d="M88 98 Q100 104 112 98 L112 108 Q100 112 88 108Z" fill="#1b1b1f" ' + hLine(p, 1.6) + '/>';
      for (var ci = 0; ci < 6; ci++) s += '<circle cx="' + (90 + ci * 4) + '" cy="' + (103 + (ci % 2) * 2) + '" r="1.4" fill="none" stroke="#4a4a52" stroke-width=".9"/>';
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
    if(Tailor) return tailorArm(side,p.skin,p.ink);
    var o = hLine(p), l = side === 'l';
    var sleeve = sp === 'tsar' ? (stage === 'baby' ? '#f4f6fa' : stage === 'sage' ? '#2f4a35' : stage === 'adult' ? p.dolman : p.coat) : p.coat;
    var d = l ? 'M74 106 C62 116 58 134 60 152 L71 152 C71 138 74 124 82 114Z' : 'M126 106 C138 116 142 134 140 152 L129 152 C129 138 126 124 118 114Z';
    var s = '<path d="' + d + '" fill="' + sleeve + '" ' + o + '/>';
    if (sp === 'tsar' && stage === 'baby') s += '<path d="' + (l ? 'M60 146 L71 146' : 'M129 146 L140 146') + '" stroke="#27458f" stroke-width="3"/>';
    if (sp === 'tsar' && stage === 'adult') s += '<path d="' + (l ? 'M60 146 L71 146 M61 142 Q66 138 70 142' : 'M129 146 L140 146 M130 142 Q134 138 139 142') + '" stroke="' + p.gold + '" stroke-width="2" fill="none"/>';
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
    if (sp === 'tsar' && (stage === 'adult' || stage === 'sage')) {
      // Император по фотопортрету: короткие тёмные волосы с косым пробором,
      // залысины на висках, уши открыты; борода клином, светлее волос.
      s += '<path d="M58 84 C54 56 72 38 100 38 C128 38 146 56 142 84 C140 76 138 68 132 62 C128 66 122 66 118 60 C110 54 96 52 86 56 C76 60 68 64 64 70 C61 74 59 79 58 84Z" fill="' + p.hair + '" ' + o + '/>';
      s += '<path d="M84 42 Q80 50 78 58" stroke="' + shade(p.hair, 0.35) + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
      s += '<path d="M96 44 Q112 46 128 58 M100 50 Q116 52 130 62" stroke="' + shade(p.hair, 0.2) + '" stroke-width="1.4" fill="none" opacity=".7"/>';
      if (stage === 'sage') s += '<path d="M60 82 C60 74 62 70 66 66 M140 82 C140 74 138 70 134 66" stroke="#d9d9d9" stroke-width="3.6" fill="none" stroke-linecap="round"/>';
      var bd = stage === 'sage' ? shade(p.beard, 0.18) : p.beard;
      s += '<path d="M60 100 C60 118 70 132 82 142 C88 148 94 156 100 158 C106 156 112 148 118 142 C130 132 140 118 140 100 C134 112 126 120 116 122 Q108 118 100 120 Q92 118 84 122 C74 120 66 112 60 100Z" fill="' + bd + '" ' + o + '/>';
      // Прядки бороды — светлые и тёмные штрихи.
      for (var bi = 0; bi < 9; bi++) {
        var bx = 72 + bi * 7, dx = bi < 4 ? 5 : bi > 4 ? -5 : 0;
        s += '<path d="M' + bx + ' ' + (126 - Math.abs(4 - bi)) + ' q' + (dx / 2) + ' 10 ' + dx + ' ' + (18 - Math.abs(4 - bi) * 3) + '" stroke="' + shade(bd, bi % 2 ? 0.28 : -0.22) + '" stroke-width="1.4" fill="none" opacity=".85"/>';
      }
    } else if (sp === 'tsar') {
      // Волосы с пробором.
      s += '<path d="M56 88 C52 58 72 40 100 40 C128 40 148 58 144 88 C140 72 132 62 116 58 C100 56 84 60 72 66 C62 72 58 80 56 88Z" fill="' + p.hair + '" ' + o + '/>';
      s += '<path d="M112 44 Q104 52 96 60" stroke="' + shade(p.hair, -0.25) + '" stroke-width="2" fill="none"/>';
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
    // Нос. У взрослого Николая — прямой, с крыльями ноздрей; под глазами тени.
    if (sp === 'tsar' && (stage === 'adult' || stage === 'sage')) {
      s += '<path d="M99 84 L97 104 Q96 108 100 109 Q104 108 103 104" fill="none" stroke="' + shade(p.skin, -0.32) + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M94 106 Q96 109 99 108 M106 106 Q104 109 101 108" fill="none" stroke="' + shade(p.skin, -0.32) + '" stroke-width="1.4"/>' +
        '<path d="M72 100 Q81 104 90 100 M110 100 Q119 104 128 100" fill="none" stroke="' + shade(p.skin, -0.22) + '" stroke-width="1.4" opacity=".8"/>';
    } else {
      s += '<path d="M100 96 Q95 106 100 109" fill="none" stroke="' + shade(p.skin, -0.3) + '" stroke-width="2.2" stroke-linecap="round"/>';
    }
    if (sp === 'tsar' && stage === 'baby') s += '<g class="pet-cheeks"><ellipse cx="70" cy="108" rx="7" ry="3.5" fill="#ff8fa3" opacity=".35"/><ellipse cx="130" cy="108" rx="7" ry="3.5" fill="#ff8fa3" opacity=".35"/></g>';
    var my = 118, mouth;
    if (mood === 'happy') mouth = '<path d="M89 ' + my + ' Q100 ' + (my + 11) + ' 111 ' + my + 'Z" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'hungry') mouth = '<ellipse cx="100" cy="' + (my + 3) + '" rx="5" ry="6" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'sad' || mood === 'sick') mouth = '<path d="M91 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 109 ' + (my + 5) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else if (mood === 'sleep') mouth = '<ellipse cx="100" cy="' + (my + 2) + '" rx="3" ry="2.5" fill="' + ink + '"/>';
    else if (mood === 'inside') mouth = '<path d="M92 ' + (my + 2) + ' Q102 ' + (my + 3) + ' 110 ' + (my - 2) + '" fill="none" stroke="' + ink + '" stroke-width="2.2" stroke-linecap="round"/>';
    else mouth = '<path d="M91 ' + my + ' Q100 ' + (my + 5) + ' 109 ' + my + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    s += altMouths(my, ink);
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    // Усы — поверх рта: у Наследника тонкие, у Императора пышные.
    if (sp === 'tsar' && stage !== 'baby') {
      var mc = p.hair;
      s += stage === 'teen'
        ? '<path d="M100 111 Q90 110 82 115 Q92 113 100 114 Q108 113 118 115 Q110 110 100 111Z" fill="' + mc + '" ' + hLine(p, 1.4) + '/>'
        : '<path d="M100 109 C92 104 80 106 72 114 C68 118 64 120 60 118 C64 126 76 126 86 120 C92 117 97 117 100 118 C103 117 108 117 114 120 C124 126 136 126 140 118 C136 120 132 118 128 114 C120 106 108 104 100 109Z" fill="' + (stage === 'sage' ? shade(p.beard, 0.18) : shade(p.beard, 0.08)) + '" ' + hLine(p, 1.8) + '/>' +
          '<path d="M96 112 Q84 112 74 118 M104 112 Q116 112 126 118" stroke="' + shade(p.beard, -0.25) + '" stroke-width="1.2" fill="none" opacity=".8"/>';
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
          '<text x="100" y="50.5" text-anchor="middle" font-size="6.5" font-weight="900" fill="' + p.gold + '" font-family="Arial, sans-serif" textLength="44" lengthAdjust="spacingAndGlyphs">ШТАНДАРТЪ</text>';
      }
      // Император — с непокрытой головой, как на портрете; фуражка — у Наследника.
      if (stage === 'sage' || stage === 'adult') return '';
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
      (layer.back ? layer.back('body', V3_BACK_T) : '') + humanBack(sp, p, stage) + humanBody(sp, p, stage) +
      layer.clothes(V3_BODY_T) +
      '<g class="pet-arm-l">' + humanArm(sp, p, stage, 'l') + '</g>' +
      '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
      '<g class="pet-head"><g transform="' + headT + '">' + humanHead(sp, p, stage, eq) + humanFace(sp, p, state, stage, eq) +
      layer('face') + humanHat(sp, p, stage, eq) + layer('head') + (sick ? sickHead() : '') + '</g></g>' +
      '<g class="pet-arm-r">' + layer.hold('human', humanArm(sp, p, stage, 'r'), p.skin, p.ink) + '</g></g></g>';
  }


  // ── Бурундай (легендарный вид, решение владельца 28.09.2026) ─────────────
  // Темник Батыя, разбивший владимирское войско на реке Сить (4 марта 1238 г.).
  // Сидит на троне — мужественно, широко расставив ноги, руки на коленях.
  // Лицо «гигачада»: квадратная челюсть, высокие скулы, ямка на подбородке,
  // уверенный прищур, длинные висячие монгольские усы, косы за ушами.
  // Стадии растут вместе с троном: сундук → походный стул → резной трон с
  // бунчуком → золотой трон, два бунчука, открытый торс под меховым плащом.
  // Голова, шея и одежда садятся теми же привязками, что у людей (V3_*_T),
  // поэтому вещи из лавки подходят без перерисовки.
  var BUR = { skin: '#dfa979', skinD: '#b07a4c', skinL: '#f0c79d', ink: '#241810', hair: '#15110e', iris: '#3a2616',
    deel: '#2d4f8e', deelD: '#1f3a6b', gold: '#e3b448', goldD: '#a8781f', armor: '#58616d', armorL: '#9aa5b2', lace: '#9b2d1f',
    leather: '#7a4a28', pants: '#4b5a78', pantsD: '#34405a', boots: '#7a2b1c', fur: '#7d5a3a', furL: '#b08a5e', wood: '#5b3519', woodL: '#8a5a32', red: '#9b2d1f' };

  function burTug(x, p, flip) {
    var s = '<path d="M' + x + ' 190 V26" stroke="' + p.ink + '" stroke-width="5.5" stroke-linecap="round"/><path d="M' + x + ' 190 V26" stroke="' + p.woodL + '" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M' + x + ' 26 V8 M' + (x - 6) + ' 16 Q' + x + ' 21 ' + (x + 6) + ' 16 M' + (x - 6) + ' 16 V9 M' + (x + 6) + ' 16 V9" fill="none" stroke="' + p.ink + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M' + x + ' 26 V8 M' + (x - 6) + ' 16 Q' + x + ' 21 ' + (x + 6) + ' 16 M' + (x - 6) + ' 16 V9 M' + (x + 6) + ' 16 V9" fill="none" stroke="' + p.gold + '" stroke-width="1.8" stroke-linecap="round"/>' +
      '<ellipse cx="' + x + '" cy="27" rx="6" ry="3" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width="1.4"/>';
    var hair = '';
    for (var i = 0; i < 7; i++) {
      var dx = (i - 3) * 2.2, sw = (flip ? -1 : 1) * (i % 2 ? 4 : -3);
      hair += '<path d="M' + (x + dx) + ' 29 C' + (x + dx - sw) + ' 42 ' + (x + dx + sw) + ' 54 ' + (x + dx * 1.6 - sw) + ' ' + (70 + (i % 3) * 5) + '" fill="none" stroke="' + p.hair + '" stroke-width="3.2" stroke-linecap="round"/>';
    }
    return '<g class="bu-tug">' + s + '<g class="bu-hair">' + hair + '</g><path d="M' + (x - 3) + ' 30 l6 0 -1 6 -4 0Z" fill="' + p.red + '"/></g>';
  }
  function burThrone(p, stage) {
    var o = hLine(p), s = '';
    if (stage === 'baby') {
      // Дорожный сундук, окованный железом.
      return '<path d="M58 146 H142 V188 H58Z" fill="' + p.woodL + '" ' + o + '/><path d="M58 146 H142 V154 H58Z" fill="' + p.wood + '" ' + hLine(p, 2) + '/>' +
        '<path d="M72 146 V188 M128 146 V188" stroke="#3b3f47" stroke-width="5"/><rect x="94" y="160" width="12" height="12" rx="2" fill="' + p.gold + '" ' + hLine(p, 1.6) + '/><circle cx="100" cy="166" r="1.8" fill="' + p.ink + '"/>';
    }
    if (stage === 'teen') {
      // Походный складной стул, на нём волчья шкура.
      return '<path d="M64 190 L134 148 M136 190 L66 148" stroke="' + p.ink + '" stroke-width="8" stroke-linecap="round"/><path d="M64 190 L134 148 M136 190 L66 148" stroke="' + p.woodL + '" stroke-width="5" stroke-linecap="round"/>' +
        '<circle cx="100" cy="169" r="3.5" fill="' + p.gold + '" ' + hLine(p, 1.4) + '/>' +
        '<path d="M58 144 H142 L146 154 Q138 158 132 154 Q124 160 116 154 Q108 160 100 154 Q92 160 84 154 Q76 160 68 154 Q62 158 54 154Z" fill="#8d8f96" ' + o + '/>' +
        '<path d="M66 148 q4 3 8 0 M92 148 q4 3 8 0 M118 148 q4 3 8 0" stroke="#5c5e66" stroke-width="1.6" fill="none"/>';
    }
    var gold = stage === 'sage', wood = gold ? p.gold : p.wood, trim = gold ? '#fff3b0' : p.gold, cloth = gold ? '#7a1426' : p.red;
    if (gold) {
      // Лучи за золотым троном — «легендарный кадр».
      var rays = '<g class="bu-rays" opacity=".45">';
      for (var i = 0; i < 14; i++) {
        var a = (-90 + (i - 6.5) * 13) * Math.PI / 180;
        rays += '<path d="M100 60 L' + (100 + Math.cos(a) * 130).toFixed(1) + ' ' + (60 + Math.sin(a) * 130).toFixed(1) + ' L' + (100 + Math.cos(a + 0.1) * 130).toFixed(1) + ' ' + (60 + Math.sin(a + 0.1) * 130).toFixed(1) + 'Z" fill="#ffe27a"/>';
      }
      s += '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + rays + '</g></svg>';
      s += burTug(170, p, true);
    }
    s += burTug(30, p, false);
    // Спинка: резная рама, внутри — алое сукно с золотым узором-ромбом.
    s += '<path d="M58 150 L56 46 C56 36 64 30 74 30 L126 30 C136 30 144 36 144 46 L142 150Z" fill="' + wood + '" ' + o + '/>';
    s += '<path d="M66 146 L65 50 Q100 42 135 50 L134 146Z" fill="' + cloth + '" ' + hLine(p, 2) + '/>';
    var lat = '';
    for (var r = 0; r < 6; r++) for (var c = 0; c < 5; c++) {
      var x = 74 + c * 13 + (r % 2 ? 6.5 : 0), y = 58 + r * 15;
      if (x > 130) continue;
      lat += '<path d="M' + x + ' ' + (y - 5) + ' l5 5 -5 5 -5 -5Z" fill="none" stroke="' + trim + '" stroke-width="1.2" opacity=".75"/>';
    }
    s += lat;
    // Гребень с самоцветом и навершия стоек.
    s += '<path d="M62 36 C68 18 88 20 100 6 C112 20 132 18 138 36 Q100 28 62 36Z" fill="' + (gold ? '#fff0a8' : p.gold) + '" ' + o + '/>' +
      '<ellipse cx="100" cy="24" rx="5" ry="6" fill="#c0392b" stroke="' + p.ink + '" stroke-width="1.6"/><circle cx="98.5" cy="22" r="1.6" fill="#ffd6cc"/>' +
      '<circle cx="57" cy="40" r="6" fill="' + p.gold + '" ' + hLine(p, 2) + '/><circle cx="143" cy="40" r="6" fill="' + p.gold + '" ' + hLine(p, 2) + '/>';
    // Подлокотники с завитками и сиденье.
    s += '<path d="M40 122 L64 120 L64 134 L42 136 Q34 130 40 122Z" fill="' + wood + '" ' + o + '/><path d="M160 122 L136 120 L136 134 L158 136 Q166 130 160 122Z" fill="' + wood + '" ' + o + '/>' +
      '<circle cx="41" cy="129" r="5" fill="' + trim + '" ' + hLine(p, 1.6) + '/><circle cx="159" cy="129" r="5" fill="' + trim + '" ' + hLine(p, 1.6) + '/>';
    s += '<path d="M46 144 H154 L156 158 H44Z" fill="' + wood + '" ' + o + '/><path d="M46 148 H154" stroke="' + trim + '" stroke-width="2"/>';
    s += '<path d="M48 158 L56 158 L54 188 L46 188Z M152 158 L144 158 L146 188 L154 188Z" fill="' + wood + '" ' + o + '/>' +
      '<ellipse cx="50" cy="189" rx="7" ry="3" fill="' + p.gold + '" ' + hLine(p, 1.4) + '/><ellipse cx="150" cy="189" rx="7" ry="3" fill="' + p.gold + '" ' + hLine(p, 1.4) + '/>';
    // Сабля в ножнах прислонена к левому подлокотнику.
    s += '<path d="M44 186 C46 166 50 146 58 122" stroke="' + p.ink + '" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M44 186 C46 166 50 146 58 122" stroke="#3a2418" stroke-width="4.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M46 170 l6 1 M49 150 l6 2" stroke="' + p.gold + '" stroke-width="2"/><path d="M58 122 L61 112 M54 121 L63 124" stroke="' + p.gold + '" stroke-width="3" stroke-linecap="round"/>';
    return s;
  }
  function burBack(p, stage) {
    // Колчан со стрелами за правым плечом — у Сотника и Темника.
    if (stage !== 'teen' && stage !== 'adult') return '';
    return '<g transform="rotate(18 136 96)"><path d="M128 70 L144 70 L142 124 L130 124Z" fill="' + p.leather + '" ' + hLine(p) + '/>' +
      '<path d="M128 80 H144 M129 112 H143" stroke="' + p.gold + '" stroke-width="2"/>' +
      '<path d="M132 70 V56 M137 70 V52 M141 70 V57" stroke="' + p.ink + '" stroke-width="1.6"/>' +
      '<path d="M129 56 l3 -8 3 8Z M134 52 l3 -8 3 8Z M138 57 l3 -8 3 8Z" fill="#f4f1e6" ' + hLine(p, 1.2) + '/></g>';
  }
  function burLegs(p, stage) {
    var o = hLine(p), s = '';
    // Шкура на сиденье — свисает между колен (тигр у Темника, барс у Гигачада).
    if (stage === 'adult' || stage === 'sage') {
      var pelt = stage === 'sage' ? '#efe9dc' : '#e08a2e', spot = stage === 'sage' ? '#3b3b3b' : '#1b1b1b';
      s += '<path d="M80 146 L120 146 L122 180 Q116 186 110 182 Q104 188 100 182 Q96 188 90 182 Q84 186 78 180Z" fill="' + pelt + '" ' + o + '/>';
      s += stage === 'sage'
        ? '<circle cx="90" cy="160" r="2.6" fill="none" stroke="' + spot + '" stroke-width="1.6"/><circle cx="108" cy="166" r="2.6" fill="none" stroke="' + spot + '" stroke-width="1.6"/><circle cx="100" cy="174" r="2.2" fill="none" stroke="' + spot + '" stroke-width="1.4"/>'
        : '<path d="M84 150 q3 6 0 12 M92 150 q-3 8 1 16 M108 150 q3 8 -1 16 M116 150 q-3 6 0 12 M100 160 q2 6 0 12" stroke="' + spot + '" stroke-width="2.4" stroke-linecap="round" fill="none"/>';
    }
    [1, -1].forEach(function (d) {
      var X = function (x) { return d === 1 ? x : 200 - x; };
      // Бедро уходит от бёдер к широко поставленному колену, голень — вниз.
      s += '<path d="M' + X(100) + ' 142 L' + X(84) + ' 140 C' + X(70) + ' 142 ' + X(58) + ' 148 ' + X(55) + ' 158 C' + X(53) + ' 166 ' + X(57) + ' 172 ' + X(64) + ' 172 L' + X(74) + ' 172 C' + X(75) + ' 164 ' + X(84) + ' 158 ' + X(100) + ' 156Z" fill="' + p.pants + '" ' + o + '/>';
      s += '<path d="M' + X(98) + ' 150 C' + X(86) + ' 148 ' + X(74) + ' 150 ' + X(64) + ' 156" stroke="' + p.pantsD + '" stroke-width="2" fill="none"/>' +
        '<ellipse cx="' + X(62) + '" cy="160" rx="5" ry="3.4" fill="#fff" opacity=".18"/>';
      // Гутулы — войлочные сапоги с загнутыми носами и золотой полосой.
      s += '<path d="M' + X(55) + ' 170 L' + X(76) + ' 170 L' + X(77) + ' 188 L' + X(52) + ' 188 C' + X(46) + ' 188 ' + X(42) + ' 184 ' + X(43) + ' 178 C' + X(46) + ' 181 ' + X(50) + ' 181 ' + X(54) + ' 180Z" fill="' + p.boots + '" ' + o + '/>' +
        '<path d="M' + X(43) + ' 178 C' + X(40) + ' 175 ' + X(40) + ' 170 ' + X(43) + ' 167" fill="none" stroke="' + p.ink + '" stroke-width="3.4" stroke-linecap="round"/><path d="M' + X(43) + ' 178 C' + X(40) + ' 175 ' + X(40) + ' 170 ' + X(43) + ' 167" fill="none" stroke="' + p.boots + '" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M' + X(55) + ' 174 H' + X(76) + '" stroke="' + p.gold + '" stroke-width="2.6"/><path d="M' + X(60) + ' 181 l3 -3 3 3 -3 3Z" fill="' + p.gold + '"/>';
    });
    return s;
  }
  function burTorso(p, stage) {
    if(Tailor) return '<path d="M88 88H112L118 109H82Z" fill="'+p.skin+'" stroke="'+p.ink+'" stroke-width="2"/>';
    var o = hLine(p), s = '';
    var wide = stage === 'adult' || stage === 'sage';
    // Бычья шея: у взрослых шире, с мышцами.
    s += wide ? '<path d="M88 88 L112 88 L118 108 L82 108Z" fill="' + p.skin + '" ' + o + '/><path d="M93 94 L99 108 M107 94 L101 108" stroke="' + p.skinD + '" stroke-width="1.6"/>'
      : '<rect x="92" y="90" width="16" height="16" fill="' + p.skin + '" ' + o + '/>';
    var shape = wide ? 'M60 108 Q100 96 140 108 L130 146 Q100 152 70 146Z' : 'M70 106 Q100 98 130 106 L128 146 Q100 152 72 146Z';
    if (stage === 'sage') {
      // Открытый торс: грудные мышцы, пресс, клыки на шнурке.
      s += '<path d="' + shape + '" fill="' + p.skin + '" ' + o + '/>';
      s += '<path d="M72 114 Q86 132 100 124 Q114 132 128 114" fill="none" stroke="' + p.skinD + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M76 116 Q86 126 98 122" fill="none" stroke="' + p.skinL + '" stroke-width="2" opacity=".8"/>' +
        '<path d="M100 124 V146 M90 132 Q95 134 99 132 M101 132 Q105 134 110 132 M91 140 Q95 142 99 140 M101 140 Q105 142 109 140" stroke="' + p.skinD + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
      s += '<path d="M84 104 Q100 118 116 104" fill="none" stroke="' + p.ink + '" stroke-width="1.4"/>';
      [88, 94, 100, 106, 112].forEach(function (x, i) { var y = 104 + Math.sin((i + 1) / 6 * Math.PI) * 12; s += '<path d="M' + (x - 1.8) + ' ' + y.toFixed(1) + ' L' + x + ' ' + (y + 6).toFixed(1) + ' L' + (x + 1.8) + ' ' + y.toFixed(1) + 'Z" fill="#f4f1e6" stroke="' + p.ink + '" stroke-width=".8"/>'; });
      // Меховой плащ на плечах.
      s += '<path d="M56 104 C50 122 52 142 58 152 L72 152 C68 136 68 118 76 106Z" fill="' + p.fur + '" ' + o + '/><path d="M144 104 C150 122 148 142 142 152 L128 152 C132 136 132 118 124 106Z" fill="' + p.fur + '" ' + o + '/>';
      s += '<path d="M56 106 Q60 94 78 96 Q72 104 80 108 Q70 112 64 110 Q58 112 56 106Z M144 106 Q140 94 122 96 Q128 104 120 108 Q130 112 136 110 Q142 112 144 106Z" fill="' + p.furL + '" ' + o + '/>';
      s += '<path d="M60 124 q3 4 6 0 M62 138 q3 4 6 0 M140 124 q-3 4 -6 0 M138 138 q-3 4 -6 0" stroke="' + shade(p.fur, -0.3) + '" stroke-width="1.4" fill="none"/>';
    } else if (stage === 'adult') {
      // Ламеллярный доспех: ряды железных пластин на красном шнуре.
      var cl = uid('lam');
      s += '<defs><clipPath id="' + cl + '"><path d="' + shape + '"/></clipPath></defs><path d="' + shape + '" fill="' + p.armor + '" ' + o + '/><g clip-path="url(#' + cl + ')">';
      for (var y = 104; y < 150; y += 6) {
        for (var x = 58 + ((y / 6) % 2 ? 3.5 : 0); x < 142; x += 7) s += '<rect x="' + x + '" y="' + y + '" width="6" height="5.2" rx="1.6" fill="' + p.armorL + '" stroke="' + shade(p.armor, -0.35) + '" stroke-width=".7"/>';
        s += '<path d="M58 ' + (y + 5.6) + ' H142" stroke="' + p.lace + '" stroke-width="1.1"/>';
      }
      s += '</g><path d="' + shape + '" fill="none" ' + o + '/>';
      // Круглое зерцало на груди.
      s += '<circle cx="100" cy="120" r="8.5" fill="' + p.gold + '" ' + hLine(p, 1.8) + '/><circle cx="100" cy="120" r="5" fill="none" stroke="' + p.goldD + '" stroke-width="1.4"/><path d="M96 116 Q98 114 101 114" stroke="#fff" stroke-width="1.6" fill="none"/>';
      // Наплечники в три пластины.
      [1, -1].forEach(function (d) {
        var X = function (x) { return d === 1 ? x : 200 - x; };
        for (var k = 0; k < 3; k++) s += '<path d="M' + X(52 + k * 2) + ' ' + (106 + k * 6) + ' C' + X(56) + ' ' + (98 + k * 6) + ' ' + X(72) + ' ' + (96 + k * 6) + ' ' + X(82) + ' ' + (102 + k * 6) + ' L' + X(80) + ' ' + (108 + k * 6) + ' C' + X(70) + ' ' + (104 + k * 6) + ' ' + X(60) + ' ' + (106 + k * 6) + ' ' + X(54 + k * 2) + ' ' + (112 + k * 6) + 'Z" fill="' + (k % 2 ? p.armorL : p.armor) + '" ' + hLine(p, 1.8) + '/>';
      });
    } else {
      // Халат-дээл с запахом на правую сторону и золотой каймой.
      s += '<path d="' + shape + '" fill="' + p.deel + '" ' + o + '/><path d="M84 102 Q94 118 124 128" fill="none" stroke="' + p.gold + '" stroke-width="3.4"/>' +
        '<circle cx="116" cy="124" r="2" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width=".8"/><circle cx="124" cy="132" r="2" fill="' + p.gold + '" stroke="' + p.ink + '" stroke-width=".8"/>';
      if (stage === 'teen') {
        // Кожаный нагрудник поверх дээла.
        s += '<path d="M76 112 Q100 106 124 112 L122 140 Q100 144 78 140Z" fill="' + p.leather + '" ' + hLine(p, 2) + '/>';
        for (var ty = 116; ty < 140; ty += 6) s += '<path d="M78 ' + ty + ' H122" stroke="' + shade(p.leather, -0.35) + '" stroke-width="1.2"/>';
        s += '<path d="M88 112 V140 M100 110 V142 M112 112 V140" stroke="' + shade(p.leather, -0.35) + '" stroke-width="1" opacity=".6"/>';
      }
    }
    // Пояс с пряжкой.
    s += '<path d="M' + (wide ? 70 : 72) + ' 140 Q100 146 ' + (wide ? 130 : 128) + ' 140 L' + (wide ? 130 : 128) + ' 147 Q100 153 ' + (wide ? 70 : 72) + ' 147Z" fill="' + (stage === 'baby' ? '#e08a2e' : '#3a2418') + '" ' + hLine(p, 2) + '/>' +
      '<rect x="94" y="141" width="12" height="9" rx="2" fill="' + p.gold + '" ' + hLine(p, 1.6) + '/>';
    return s;
  }
  function burArm(p, stage, side) {
    if(Tailor) return tailorArm(side,p.skin,p.ink);
    var o = hLine(p), l = side === 'l';
    var X = function (x) { return l ? x : 200 - x; };
    var sleeve = stage === 'sage' ? p.skin : stage === 'adult' ? p.armor : p.deel;
    var d = 'M' + X(72) + ' 106 C' + X(58) + ' 110 ' + X(50) + ' 124 ' + X(52) + ' 140 C' + X(53) + ' 146 ' + X(56) + ' 150 ' + X(60) + ' 152 L' + X(72) + ' 150 C' + X(70) + ' 140 ' + X(70) + ' 128 ' + X(82) + ' 116Z';
    var s = '<path d="' + d + '" fill="' + sleeve + '" ' + o + '/>';
    if (stage === 'sage') s += '<path d="M' + X(56) + ' 120 Q' + X(62) + ' 114 ' + X(68) + ' 120" stroke="' + p.skinD + '" stroke-width="1.8" fill="none"/><path d="M' + X(58) + ' 116 Q' + X(62) + ' 112 ' + X(66) + ' 115" stroke="' + p.skinL + '" stroke-width="1.6" fill="none"/>';
    if (stage === 'adult' || stage === 'sage') s += '<path d="M' + X(52) + ' 136 L' + X(70) + ' 134 L' + X(72) + ' 146 L' + X(56) + ' 149Z" fill="' + p.leather + '" ' + hLine(p, 1.8) + '/><path d="M' + X(55) + ' 141 H' + X(70) + '" stroke="' + p.gold + '" stroke-width="1.6"/>';
    if (stage === 'baby' || stage === 'teen') s += '<path d="M' + X(53) + ' 144 L' + X(71) + ' 142" stroke="' + p.gold + '" stroke-width="3"/>';
    // Кулак на колене.
    var hx = l ? 65.5 : 134.5;
    s += '<circle cx="' + hx + '" cy="156" r="7.5" fill="' + p.skin + '" ' + hLine(p, 2.2) + '/>' +
      '<path d="M' + (hx - 4) + ' 153 q2 -2 4 0 M' + hx + ' 153 q2 -2 4 0" stroke="' + p.skinD + '" stroke-width="1.2" fill="none"/>';
    return s;
  }
  function burHead(p, stage, eq) {
    var o = hLine(p, 3), s = '';
    // Косы за ушами — петлями, как у монгольских воинов.
    [1, -1].forEach(function (d) {
      var X = function (x) { return d === 1 ? x : 200 - x; };
      s += '<path d="M' + X(56) + ' 84 C' + X(44) + ' 96 ' + X(44) + ' 118 ' + X(54) + ' 124 C' + X(60) + ' 118 ' + X(56) + ' 104 ' + X(60) + ' 94" fill="' + p.hair + '" ' + hLine(p, 2) + '/>' +
        '<path d="M' + X(49) + ' 104 l6 -2 M' + X(48) + ' 111 l6 -1 M' + X(50) + ' 118 l5 0" stroke="#4a4038" stroke-width="1.4"/>' +
        '<circle cx="' + X(53) + '" cy="124" r="2.6" fill="' + p.red + '" stroke="' + p.ink + '" stroke-width="1"/>';
    });
    s += '<circle cx="55" cy="94" r="7" fill="' + p.skin + '" ' + hLine(p, 2.4) + '/><circle cx="145" cy="94" r="7" fill="' + p.skin + '" ' + hLine(p, 2.4) + '/>';
    // Голова с квадратной челюстью.
    var head = 'M58 80 C58 52 76 38 100 38 C124 38 142 52 142 80 C142 94 141 104 138 112 C134 124 126 134 114 140 Q100 146 86 140 C74 134 66 124 62 112 C59 104 58 94 58 80Z';
    s += '<path d="' + head + '" fill="' + p.skin + '" ' + o + '/>';
    s += '<path d="M138 100 C136 120 126 134 112 140 Q128 124 132 100Z" fill="' + p.skinD + '" opacity=".45"/>';
    s += '<path d="M62 106 C64 120 74 132 86 140 Q100 146 114 140 C126 132 136 120 138 106 C132 124 118 136 100 138 C82 136 68 124 62 106Z" fill="' + p.ink + '" opacity=".08"/>';
    // Волосы: чёрная шапка волос с чубом надо лбом (у Гигачада ещё пучок).
    s += '<path d="M58 80 C56 50 76 34 100 34 C124 34 144 50 142 80 C138 66 132 58 124 55 C116 52 108 54 100 58 C92 54 84 52 76 55 C68 58 62 66 58 80Z" fill="' + p.hair + '" ' + o + '/>';
    s += '<path d="M96 56 Q100 68 104 56" fill="' + p.hair + '" ' + hLine(p, 1.4) + '/><path d="M80 44 Q90 40 100 42" stroke="#4a4038" stroke-width="1.6" fill="none"/>';
    if (stage === 'sage' && !eq.head) s += '<path d="M90 38 C88 20 112 20 110 38Z" fill="' + p.hair + '" ' + o + '/><rect x="93" y="34" width="14" height="5" rx="2" fill="' + p.gold + '" ' + hLine(p, 1.4) + '/>';
    return s;
  }
  function burEye(cx, p, mirror, lid) {
    var d = mirror ? -1 : 1, cy = 92;
    // Узкий миндалевидный глаз, внешний уголок выше внутреннего.
    var w = 'M' + (cx - 11 * d) + ' ' + (cy - 2) + ' Q' + (cx - 1 * d) + ' ' + (cy - 7) + ' ' + (cx + 12 * d) + ' ' + (cy - 0.5) + ' Q' + (cx + 1 * d) + ' ' + (cy + 5) + ' ' + (cx - 11 * d) + ' ' + (cy - 2) + 'Z';
    var s = '<path d="' + w + '" fill="#fff" stroke="' + p.ink + '" stroke-width="1.8"/>';
    s += '<g class="pet-pupils"><circle cx="' + (cx + d) + '" cy="' + (cy - 1) + '" r="4" fill="' + p.iris + '"/><circle cx="' + (cx + d) + '" cy="' + (cy - 1) + '" r="1.8" fill="#000"/><circle cx="' + (cx + 2.4 * d) + '" cy="' + (cy - 2.6) + '" r="1.1" fill="#fff"/></g>';
    // Тяжёлое веко — «сигма-прищур».
    s += '<path d="M' + (cx - 12 * d) + ' ' + (cy - 3) + ' Q' + (cx - 1 * d) + ' ' + (cy - 9) + ' ' + (cx + 13 * d) + ' ' + (cy - 1.5) + ' L' + (cx + 12 * d) + ' ' + (cy - 1.5 + lid * 5) + ' Q' + (cx - 1 * d) + ' ' + (cy - 8 + lid * 7) + ' ' + (cx - 11 * d) + ' ' + (cy - 2 + lid * 3) + 'Z" fill="' + p.skinD + '" stroke="' + p.ink + '" stroke-width="2.2" stroke-linejoin="round"/>';
    return s;
  }
  function burFace(p, state, stage) {
    var s = '', ink = p.ink;
    var mood = state === 'ok' ? (stage === 'baby' ? 'ok' : 'chad') : state;
    // Скулы: высокие, с тенью под ними и светом над.
    s += '<path d="M66 106 Q75 113 86 111 Q76 110 68 102Z M134 106 Q125 113 114 111 Q124 110 132 102Z" fill="' + p.skinD + '" opacity=".4"/>' +
      '<ellipse cx="76" cy="100" rx="7" ry="2.6" fill="' + p.skinL + '" opacity=".6"/><ellipse cx="124" cy="100" rx="7" ry="2.6" fill="' + p.skinL + '" opacity=".6"/>';
    if (mood === 'happy') {
      s += '<path d="M70 92 Q81 84 93 91 M107 91 Q119 84 130 92" fill="none" stroke="' + ink + '" stroke-width="3.4" stroke-linecap="round"/>';
    } else if (mood === 'sleep') {
      s += '<path d="M70 91 Q81 95 93 91 M107 91 Q119 95 130 91" fill="none" stroke="' + ink + '" stroke-width="3" stroke-linecap="round"/>';
    } else {
      var lid = mood === 'chad' ? 0.55 : mood === 'sick' ? 0.75 : mood === 'sad' ? 0.45 : 0.25;
      s += '<g class="pet-eyes">' + burEye(81, p, false, lid) + burEye(119, p, true, lid) + '</g>';
    }
    // Брови: густые и прямые; у «гигачада» правая чуть приподнята.
    if (mood === 'sad' || mood === 'sick' || mood === 'hungry') {
      s += '<path d="M67 82 Q80 76 93 78 L93 82 Q80 80 67 86Z M133 82 Q120 76 107 78 L107 82 Q120 80 133 86Z" fill="' + p.hair + '"/>';
    } else if (mood === 'chad') {
      s += '<path d="M66 80 Q80 76 94 83 L93 86.5 Q80 81 66 84Z" fill="' + p.hair + '"/><path d="M134 75 Q121 72 106 81 L107 84.5 Q121 77 134 79Z" fill="' + p.hair + '"/>';
    } else if (mood !== 'sleep') {
      s += '<path d="M66 81 Q80 76 94 82 L93 85.5 Q80 80 66 85Z M134 81 Q120 76 106 82 L107 85.5 Q120 80 134 85Z" fill="' + p.hair + '"/>';
    }
    if (mood === 'sad') s += '<path class="pet-tear" d="M76 100 Q73 106 76 109 Q79 106 76 100Z" fill="#7fc8f8"/>';
    // Прямой крупный нос с широкими крыльями.
    s += '<path d="M99 88 L97 105 Q95 110 100 111 Q105 110 103 105" fill="none" stroke="' + p.skinD + '" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M92 108 Q94 112 98 111 M108 108 Q106 112 102 111" fill="none" stroke="' + p.skinD + '" stroke-width="1.6"/>';
    // Ямка на подбородке.
    s += '<path d="M100 131 v6" stroke="' + p.skinD + '" stroke-width="1.8" stroke-linecap="round"/>';
    var my = 121, mouth;
    if (mood === 'happy') mouth = '<path d="M88 ' + my + ' Q100 ' + (my + 11) + ' 112 ' + my + 'Z" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><path d="M90 ' + (my + 1) + ' Q100 ' + (my + 5) + ' 110 ' + (my + 1) + '" stroke="#fff" stroke-width="2.6" fill="none"/>';
    else if (mood === 'hungry') mouth = '<ellipse cx="100" cy="' + (my + 3) + '" rx="5" ry="6" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/>';
    else if (mood === 'sad' || mood === 'sick') mouth = '<path d="M92 ' + (my + 5) + ' Q100 ' + (my - 1) + ' 108 ' + (my + 5) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else if (mood === 'sleep') mouth = '<ellipse cx="100" cy="' + (my + 2) + '" rx="3" ry="2.5" fill="' + ink + '"/>';
    else if (mood === 'chad') mouth = '<path d="M91 ' + (my + 1) + ' Q101 ' + (my + 3) + ' 110 ' + (my - 2) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    else mouth = '<path d="M92 ' + my + ' Q100 ' + (my + 4) + ' 108 ' + my + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    s += altMouths(my, ink);
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 3) + '" rx="8" ry="9" fill="#6a1e2c" stroke="' + ink + '" stroke-width="2.2"/><ellipse cx="100" cy="' + (my + 8) + '" rx="5" ry="3" fill="#ff8fa3"/></g>';
    // Висячие усы ниже челюсти и клинышек бородки. У нукера — только пушок.
    if (stage === 'baby') {
      s += '<path d="M90 114 Q100 111 110 114" stroke="' + p.hair + '" stroke-width="1.6" fill="none" opacity=".55"/>';
    } else {
      var drop = stage === 'teen' ? 132 : 146;
      s += '<path d="M100 114 C94 111 86 112 82 118 C79 124 79 ' + (drop - 12) + ' 80 ' + drop + ' L83.5 ' + drop + ' C83.5 ' + (drop - 12) + ' 85 126 88 121 C92 117 96 117 100 118 C104 117 108 117 112 121 C115 126 116.5 ' + (drop - 12) + ' 116.5 ' + drop + ' L120 ' + drop + ' C121 ' + (drop - 12) + ' 121 124 118 118 C114 112 106 111 100 114Z" fill="' + (stage === 'sage' ? '#2a2420' : p.hair) + '" ' + hLine(p, 1.2) + '/>';
      if (stage !== 'teen') s += '<path d="M96 136 L100 150 L104 136Z" fill="' + p.hair + '" ' + hLine(p, 1.2) + '/>';
    }
    return s;
  }
  function burHat(p, stage, eq) {
    if (eq.head) return '';
    if (stage === 'baby') {
      // Малахай: синяя тулья с золотым шариком, широкий меховой околыш.
      return '<path d="M58 60 Q60 28 100 22 Q140 28 142 60Z" fill="' + p.deel + '" ' + hLine(p, 2.6) + '/>' +
        '<path d="M100 22 V60 M78 28 Q86 44 84 60 M122 28 Q114 44 116 60" stroke="' + p.gold + '" stroke-width="1.8" fill="none"/>' +
        '<circle cx="100" cy="20" r="5" fill="' + p.red + '" ' + hLine(p, 1.6) + '/>' +
        '<path d="M50 58 Q100 44 150 58 L152 72 Q100 60 48 72Z" fill="' + p.fur + '" ' + hLine(p, 2.4) + '/>' +
        '<path d="M58 62 l3 5 M70 58 l2 6 M84 56 l2 6 M100 55 v6 M116 56 l-2 6 M130 58 l-2 6 M142 62 l-3 5" stroke="' + p.furL + '" stroke-width="1.8" stroke-linecap="round"/>';
    }
    if (stage === 'teen') {
      // Кожаный шлем-шапка с меховой опушкой и железным навершием.
      return '<path d="M58 62 Q60 30 100 22 Q140 30 142 62Z" fill="' + p.leather + '" ' + hLine(p, 2.6) + '/>' +
        '<path d="M100 22 V62 M72 32 Q80 46 78 62 M128 32 Q120 46 122 62" stroke="' + shade(p.leather, -0.3) + '" stroke-width="1.6" fill="none"/>' +
        '<path d="M96 22 L100 8 L104 22Z" fill="' + p.armorL + '" ' + hLine(p, 1.6) + '/>' +
        '<path d="M52 60 Q100 48 148 60 L148 70 Q100 58 52 70Z" fill="' + p.fur + '" ' + hLine(p, 2.2) + '/>';
    }
    if (stage === 'adult') {
      // Железный островерхий шлем с золотым ободом, красным султаном и бармицей.
      var gr = uid('buh');
      var s = '<defs><linearGradient id="' + gr + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.armorL + '"/><stop offset=".45" stop-color="#d7dde4"/><stop offset="1" stop-color="' + p.armor + '"/></linearGradient></defs>';
      [1, -1].forEach(function (d) {
        var X = function (x) { return d === 1 ? x : 200 - x; };
        s += '<path d="M' + X(56) + ' 62 L' + X(50) + ' 106 L' + X(64) + ' 108 L' + X(66) + ' 66Z" fill="' + p.leather + '" ' + hLine(p, 2) + '/>' +
          '<path d="M' + X(55) + ' 74 L' + X(65) + ' 75 M' + X(53) + ' 86 L' + X(65) + ' 87 M' + X(52) + ' 98 L' + X(64) + ' 99" stroke="' + p.armorL + '" stroke-width="2.4"/>';
      });
      s += '<path class="bu-plume" d="M100 6 C92 2 84 8 82 18 C80 26 84 34 80 42 C90 36 92 26 96 18 C98 14 100 10 100 6Z" fill="' + p.red + '" ' + hLine(p, 1.6) + '/>';
      s += '<path d="M58 64 C60 36 80 20 100 12 C120 20 140 36 142 64Z" fill="url(#' + gr + ')" ' + hLine(p, 2.6) + '/>' +
        '<path d="M100 12 V62 M80 22 Q76 40 76 62 M120 22 Q124 40 124 62" stroke="' + shade(p.armor, -0.25) + '" stroke-width="1.4" fill="none"/>' +
        '<path d="M98 12 L100 0 L102 12Z" fill="' + p.gold + '" ' + hLine(p, 1.4) + '/>' +
        '<path d="M54 60 Q100 52 146 60 L146 68 Q100 60 54 68Z" fill="' + p.gold + '" ' + hLine(p, 2.2) + '/>' +
        '<path d="M100 60 l4 -4 4 4 -4 4Z M92 60 l-4 -4 -4 4 4 4Z" fill="' + p.red + '"/>' +
        '<path d="M70 34 Q76 26 86 22" stroke="#fff" stroke-width="2.4" fill="none" opacity=".7" stroke-linecap="round"/>';
      return s;
    }
    return '';
  }
  function renderBurunday(stage, state, layer, eq, sick) {
    var p = BUR;
    var k = stage === 'baby' ? 0.82 : stage === 'teen' ? 0.92 : 1;
    var headT = humanHeadT(stage);
    return '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)">' + burThrone(p, stage) +
      '<g class="pet-body">' + (layer.back ? layer.back('body', V3_BACK_T) : '') + burBack(p, stage) + burLegs(p, stage) + burTorso(p, stage) +
      layer.clothes(V3_BODY_T) +
      '<g class="pet-arm-l">' + burArm(p, stage, 'l') + '</g>' +
      '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
      '<g class="pet-head"><g transform="' + headT + '">' + burHead(p, stage, eq) + burFace(p, state, stage) +
      layer('face') + burHat(p, stage, eq) + layer('head') + (sick ? sickHead() : '') + '</g></g>' +
      '<g class="pet-arm-r">' + layer.hold('bur', burArm(p, stage, 'r'), p.skin, p.ink) + '</g></g></g>';
  }

  // ── Сквидвард (по разрешению правообладателя, со слов владельца 27.09.2026) ─
  // Малыш и Подросток — классический ворчун: голова-купол, длинный свисающий
  // нос, тяжёлые веки над жёлтыми глазами с красными зрачками, коричневая
  // рубашка. Взрослый — мем «Красавчик Сквидвард»: вытянутое лицо с квадратной
  // челюстью, складки-морщины, пухлые губы, бычья шея, мускулы, горчичная
  // рубашка с V-вырезом и волосы на груди. Мудрец — то же в чёрно-белом
  // «гигачад»-свете. Голова — в координатах головы малыша: вещи садятся.
  var SQUID = {
    young: { skin: '#a9d6c5', skinL: '#d4efe5', skinD: '#78ab99', ink: '#20302b', shirt: '#8c6a34', shirtD: '#6e5226', sclera: '#efe3a4', iris: '#b0392b', lips: '#d8b59c' },
    chad: { skin: '#a9d6c5', skinL: '#d4efe5', skinD: '#6f9f8e', ink: '#1a2622', shirt: '#a8862a', shirtD: '#7d6320', sclera: '#efe3a4', iris: '#a33a2a', lips: '#d8b59c' },
    mono: { skin: '#c4c4c4', skinL: '#f4f4f4', skinD: '#6e6e6e', ink: '#0d0d0d', shirt: '#8a8a8a', shirtD: '#4c4c4c', sclera: '#e8e8e8', iris: '#3a3a3a', lips: '#b0b0b0' },
  };
  function squidPal(stage) { return stage === 'sage' ? SQUID.mono : (stage === 'adult' ? SQUID.chad : SQUID.young); }
  function squidChad(stage) { return stage === 'adult' || stage === 'sage'; }
  function squidHeadT(stage) {
    if (stage === 'baby') return 'translate(100 76) scale(0.86) translate(-100 -88)';
    if (stage === 'teen') return 'translate(100 71) scale(0.78) translate(-100 -88)';
    return 'translate(100 54) scale(0.66) translate(-100 -88)';
  }
  function sqL(p, w) { return 'stroke="' + p.ink + '" stroke-width="' + (w || 2.6) + '" stroke-linejoin="round" stroke-linecap="round"'; }

  // Нога-щупальце: гладкое, с закруглённым носком (как у героя мультфильма).
  function squidLeg(p, d, w) {
    return '<path d="' + d + '" fill="none" stroke="' + p.ink + '" stroke-width="' + (w + 2.6) + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + p.skin + '" stroke-width="' + w + '" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="' + p.skinL + '" stroke-width="' + Math.max(1.2, w * 0.25) + '" stroke-linecap="round" opacity=".6" transform="translate(-1 -1)"/>';
  }

  function squidBack(p, stage) {
    if (stage !== 'sage') return '';
    // Лучи и контровой свет — «легендарное фото».
    var s = '<g opacity=".5">';
    for (var i = 0; i < 12; i++) {
      var a = (-90 + (i - 5.5) * 13) * Math.PI / 180;
      s += '<path d="M100 96 L' + (100 + Math.cos(a) * 110).toFixed(1) + ' ' + (96 + Math.sin(a) * 110).toFixed(1) + ' L' + (100 + Math.cos(a + 0.09) * 110).toFixed(1) + ' ' + (96 + Math.sin(a + 0.09) * 110).toFixed(1) + 'Z" fill="#ffffff"/>';
    }
    return s + '</g><ellipse class="rar-glow" cx="100" cy="188" rx="58" ry="9" fill="#111" opacity=".45"/>';
  }

  function squidBody(p, stage, ids) {
    var s = '', o = sqL(p), chad = squidChad(stage);
    // Ноги: четыре щупальца из-под рубашки.
    var w = chad ? 8 : 6.5;
    s += squidLeg(p, 'M84 156 C80 168 76 178 72 184 C70 188 74 191 80 189', w);
    s += squidLeg(p, 'M94 158 C93 170 92 180 92 186 C92 190 96 191 100 189', w);
    s += squidLeg(p, 'M106 158 C107 170 108 180 108 186 C108 190 104 191 100 189', w);
    s += squidLeg(p, 'M116 156 C120 168 124 178 128 184 C130 188 126 191 120 189', w);
    if(Tailor)return s+'<path d="'+(chad?'M84 90C84 102 82 112 78 120H122C118 112 116 102 116 90Z':'M94 92H106V110H94Z')+'" fill="'+p.skin+'" '+o+'/>';
    if (!chad) {
      // Классика: худая шея и коричневая рубашка с коротким рукавом.
      s += '<path d="M94 92 L94 108 L106 108 L106 92Z" fill="' + p.skin + '" ' + o + '/>';
      s += '<path d="M74 106 Q100 98 126 106 L130 158 Q100 166 70 158Z" fill="' + p.shirt + '" ' + o + '/>';
      s += '<path d="M90 104 L100 114 L110 104" fill="' + p.skin + '" ' + sqL(p, 2) + '/>';
      s += '<path d="M76 150 Q100 156 124 150" fill="none" stroke="' + p.shirtD + '" stroke-width="1.6" opacity=".7"/>';
      s += '<path d="M124 110 Q132 130 126 152" fill="none" stroke="#fff" stroke-width="2" opacity=".2"/>';
      return s;
    }
    // Красавчик: бычья шея, широченные плечи, V-вырез, волосы на груди.
    // Длинная бычья шея — фирменная деталь мема.
    s += '<path d="M84 90 C84 102 82 112 78 120 L122 120 C118 112 116 102 116 90Z" fill="' + p.skin + '" ' + o + '/>';
    s += '<path d="M88 96 Q91 108 86 118 M112 96 Q109 108 114 118 M95 104 Q100 108 105 104" fill="none" stroke="' + p.ink + '" stroke-width="1.4" opacity=".75"/>';
    s += '<path d="M52 128 C54 116 68 112 84 118 L100 140 L116 118 C132 112 146 116 148 128 C150 140 144 154 134 163 Q100 171 66 163 C56 154 50 140 52 128Z" fill="' + p.shirt + '" ' + o + '/>';
    s += '<path d="M84 118 L100 140 L116 118 Q100 122 84 118Z" fill="' + p.skin + '" ' + sqL(p, 2) + '/>';
    s += '<path d="M60 136 Q74 130 86 142 M140 136 Q126 130 114 142 M78 154 Q100 161 122 154" fill="none" stroke="' + p.shirtD + '" stroke-width="1.8" opacity=".85"/>';
    // Волосы на груди — завитки.
    [[92, 126], [97, 130], [103, 130], [108, 126], [100, 134], [95, 122], [105, 122]].forEach(function (c) {
      s += '<path d="M' + c[0] + ' ' + c[1] + ' q1.8 -2.6 2.6 0 q.6 2 -1.2 2.2" fill="none" stroke="' + p.ink + '" stroke-width="1"/>';
    });
    s += '<path d="M136 126 Q146 142 134 160" fill="none" stroke="#fff" stroke-width="2.4" opacity=".25"/>';
    return s;
  }

  function squidArm(p, stage, side) {
    if(Tailor) return tailorArm(side,p.skin,p.ink);
    var l = side === 'l', chad = squidChad(stage), s = '', dir = l ? -1 : 1;
    if (!chad) {
      var sx = l ? 76 : 124;
      s += '<path d="M' + sx + ' 106 Q' + (sx + dir * 10) + ' 108 ' + (sx + dir * 11) + ' 118 L' + (sx + dir * 3) + ' 122Z" fill="' + p.shirt + '" ' + sqL(p, 2) + '/>';
      s += squidLeg(p, 'M' + (sx + dir * 7) + ' 120 C' + (sx + dir * 10) + ' 134 ' + (sx + dir * 8) + ' 146 ' + (sx + dir * 2) + ' 154', 5.5);
      return s;
    }
    // Мускулистая рука: рукав на плече, бицепс, локоть, предплечье, кисть.
    var bx = l ? 56 : 144;
    var X = function (dx) { return (bx + dir * dx).toFixed(1); };
    s += '<path d="M' + X(-6) + ' 122 C' + X(10) + ' 118 ' + X(20) + ' 130 ' + X(18) + ' 142 C' + X(16) + ' 150 ' + X(12) + ' 154 ' + X(12) + ' 158 C' + X(16) + ' 166 ' + X(12) + ' 176 ' + X(4) + ' 180 C' + X(-2) + ' 183 ' + X(-8) + ' 180 ' + X(-7) + ' 174 C' + X(-8) + ' 166 ' + X(-6) + ' 160 ' + X(-4) + ' 154 C' + X(-8) + ' 144 ' + X(-10) + ' 132 ' + X(-6) + ' 122Z" fill="' + p.skin + '" ' + sqL(p) + '/>';
    s += '<path d="M' + X(6) + ' 128 Q' + X(16) + ' 136 ' + X(10) + ' 148 M' + X(-4) + ' 154 Q' + X(4) + ' 158 ' + X(12) + ' 156 M' + X(2) + ' 162 Q' + X(8) + ' 168 ' + X(6) + ' 176" fill="none" stroke="' + p.skinD + '" stroke-width="1.6"/>';
    s += '<path d="M' + X(-8) + ' 118 C' + X(6) + ' 114 ' + X(18) + ' 120 ' + X(18) + ' 132 L' + X(-6) + ' 134Z" fill="' + p.shirt + '" ' + sqL(p, 2) + '/>';
    return s;
  }

  function squidHead(p, stage, ids) {
    var o = sqL(p, 3), s = '', chad = squidChad(stage);
    if (!chad) {
      // Голова-купол: широкий лысый верх, лицо сужается книзу.
      s += '<path d="M100 8 C142 8 160 36 158 64 C156 84 146 94 134 100 C130 114 118 128 100 130 C82 128 70 114 66 100 C54 94 44 84 42 64 C40 36 58 8 100 8Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
      s += '<ellipse cx="74" cy="30" rx="13" ry="7" fill="#fff" opacity=".35" transform="rotate(-28 74 30)"/>';
      s += '<path d="M138 26 Q160 52 150 84 Q144 94 132 100 Q154 70 138 26Z" fill="#000" opacity=".08"/>';
      // Складка на лбу между глаз.
      s += '<path d="M94 70 Q100 62 106 70" fill="none" stroke="' + p.skinD + '" stroke-width="1.8"/>';
      return s;
    }
    // Красавчик: тот же купол, но лицо вытянуто вниз квадратной челюстью.
    s += '<path d="M100 8 C142 8 160 36 158 64 C156 82 148 92 138 98 C138 118 136 138 130 150 L118 158 L82 158 L70 150 C64 138 62 118 62 98 C52 92 44 82 42 64 C40 36 58 8 100 8Z" fill="url(#' + ids.fur + ')" ' + o + '/>';
    s += '<ellipse cx="74" cy="30" rx="13" ry="7" fill="#fff" opacity=".35" transform="rotate(-28 74 30)"/>';
    s += '<path d="M140 30 Q162 58 148 90 Q140 120 132 150 Q134 100 140 30Z" fill="#000" opacity=".08"/>';
    // Складки-морщины: лоб, между бровей, щёки, углы челюсти, подбородок.
    var line = function (d, w) { return '<path d="' + d + '" fill="none" stroke="' + p.ink + '" stroke-width="' + (w || 1.5) + '" stroke-linecap="round" opacity=".85"/>'; };
    s += line('M92 60 Q90 70 94 80 M108 60 Q110 70 106 80');
    s += line('M80 44 Q76 54 80 62 M120 44 Q124 54 120 62', 1.3);
    s += line('M72 100 Q70 120 78 138 M128 100 Q130 120 122 138');
    s += line('M66 116 Q68 134 74 146 M134 116 Q132 134 126 146', 1.3);
    s += line('M90 150 Q100 154 110 150');
    s += line('M84 140 Q86 146 92 148 M116 140 Q114 146 108 148', 1.2);
    return s;
  }

  function squidFace(p, state, stage) {
    var s = '', ink = p.ink, chad = squidChad(stage);
    var mood = state === 'ok' ? 'grump' : state;
    // Глаза: жёлтые белки, красные зрачки, тяжёлые веки цвета кожи.
    var eye = function (cx, mirror) {
      var e = '<ellipse cx="' + cx + '" cy="90" rx="13" ry="10" fill="' + p.sclera + '" stroke="' + ink + '" stroke-width="2.2"/>';
      if (mood === 'happy') return '<path d="M' + (cx - 12) + ' 92 Q' + cx + ' 82 ' + (cx + 12) + ' 92" fill="none" stroke="' + ink + '" stroke-width="3.2" stroke-linecap="round"/>';
      if (mood === 'sleep') return '<path d="M' + (cx - 12) + ' 91 Q' + cx + ' 97 ' + (cx + 12) + ' 91" fill="none" stroke="' + ink + '" stroke-width="3" stroke-linecap="round"/>';
      e += '<g class="pet-pupils"><ellipse cx="' + (cx + (mirror ? -2 : 2)) + '" cy="93" rx="3.6" ry="3" fill="' + p.iris + '"/><circle cx="' + (cx + (mirror ? -2 : 2)) + '" cy="93" r="1.3" fill="' + ink + '"/></g>';
      var lid = mood === 'grump' ? 0.62 : mood === 'sad' ? 0.45 : mood === 'sick' ? 0.7 : 0.3;
      var ly = 80 + lid * 14;
      e += '<path d="M' + (cx - 14) + ' 90 C' + (cx - 12) + ' 78 ' + (cx + 12) + ' 78 ' + (cx + 14) + ' 90 L' + (cx + 13) + ' ' + ly.toFixed(1) + ' Q' + cx + ' ' + (ly + 2).toFixed(1) + ' ' + (cx - 13) + ' ' + ly.toFixed(1) + 'Z" fill="' + p.skin + '" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/>';
      e += '<path d="M' + (cx - 11) + ' 101 Q' + cx + ' 105 ' + (cx + 11) + ' 101" fill="none" stroke="' + p.skinD + '" stroke-width="1.6"/>';
      return e;
    };
    s += '<g class="pet-eyes">' + eye(86, false) + eye(114, true) + '</g>';
    // Рот (за носом) и губы у красавчика.
    var my = chad ? 132 : 118, mouth;
    if (chad) {
      mouth = mood === 'happy'
        ? '<path d="M86 ' + my + ' Q100 ' + (my + 12) + ' 114 ' + my + ' Q100 ' + (my + 3) + ' 86 ' + my + 'Z" fill="#5a1c28" stroke="' + ink + '" stroke-width="1.8"/>'
        : '<path d="M86 ' + my + ' Q93 ' + (my - 6) + ' 100 ' + (my - 3) + ' Q107 ' + (my - 6) + ' 114 ' + my + ' Q100 ' + (my + 2) + ' 86 ' + my + 'Z" fill="' + p.lips + '" stroke="' + ink + '" stroke-width="1.8"/>' +
          '<path d="M86 ' + my + ' Q100 ' + (my + 10) + ' 114 ' + my + ' Q100 ' + (my + 3) + ' 86 ' + my + 'Z" fill="' + shade(p.lips, -0.08) + '" stroke="' + ink + '" stroke-width="1.8"/>';
    } else if (mood === 'happy') {
      mouth = '<path d="M84 ' + my + ' Q100 ' + (my + 10) + ' 116 ' + my + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    } else if (mood === 'hungry') {
      mouth = '<ellipse cx="100" cy="' + (my + 4) + '" rx="6" ry="5" fill="#5a1c28" stroke="' + ink + '" stroke-width="2"/>';
    } else {
      mouth = '<path d="M80 ' + (my + 4) + ' Q88 ' + (my - 1) + ' 94 ' + (my + 1) + ' M106 ' + (my + 1) + ' Q112 ' + (my - 1) + ' 120 ' + (my + 4) + '" fill="none" stroke="' + ink + '" stroke-width="2.4" stroke-linecap="round"/>';
    }
    if (!chad) s += altMouths(my, ink);
    s += '<g class="pet-mouth">' + mouth + '</g>';
    s += '<g class="pet-chomp"><ellipse cx="100" cy="' + (my + 2) + '" rx="8" ry="8" fill="#5a1c28" stroke="' + ink + '" stroke-width="2"/></g>';
    // Нос: у ворчуна — длинный, свисает до рта; у красавчика — прямой и точёный.
    s += chad
      ? '<path d="M96 92 C95 104 93 114 92 120 C92 126 97 128 100 126 C103 128 108 126 108 120 C107 114 105 104 104 92Z" fill="' + p.skin + '" stroke="' + ink + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<path d="M95 122 Q97 125 99 123 M105 122 Q103 125 101 123" fill="none" stroke="' + ink + '" stroke-width="1.2"/>'
      : '<path d="M95 92 C92 106 88 118 90 128 C92 138 108 138 110 128 C112 118 108 106 105 92Z" fill="' + p.skin + '" stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"/>' +
        '<path d="M92 124 Q100 130 108 124" fill="none" stroke="' + p.skinD + '" stroke-width="1.6"/>' +
        '<ellipse cx="96" cy="112" rx="2" ry="6" fill="#fff" opacity=".35"/>';
    if (mood === 'sad') s += '<path class="pet-tear" d="M76 102 Q73 108 76 111 Q79 108 76 102Z" fill="#7fc8f8"/>';
    return s;
  }

  function renderSquid(stage, state, layer, eq, sick) {
    var p = squidPal(stage);
    var ids = { fur: uid('sqf') };
    var defs = '<defs><radialGradient id="' + ids.fur + '" cx="36%" cy="24%" r="85%"><stop offset="0" stop-color="' + p.skinL + '"/><stop offset=".5" stop-color="' + p.skin + '"/><stop offset="1" stop-color="' + p.skinD + '"/></radialGradient></defs>';
    var k = stage === 'baby' ? 0.82 : stage === 'teen' ? 0.92 : 1;
    return defs + squidBack(p, stage) +
      '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)"><g class="pet-body">' +
      (layer.back ? layer.back('body', V3_BACK_T) : '') + squidBody(p, stage, ids) +
      layer.clothes(V3_BODY_T) +
      '<g class="pet-arm-l">' + squidArm(p, stage, 'l') + '</g>' +
      '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
      '<g class="pet-head"><g transform="' + squidHeadT(stage) + '">' + layer.skull(squidHead(p, stage, ids)) + squidFace(p, state, stage) +
      layer('face') + layer('head') + (sick ? sickHead() : '') + '</g></g>' +
      '<g class="pet-arm-r">' + layer.hold(squidChad(stage) ? 'squidChad' : 'squid', squidArm(p, stage, 'r'), p.skin, p.ink) + '</g></g></g>';
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
      '<path d="M46 126 Q100 150 154 126 L150 140 Q100 162 50 140Z" fill="' + c0(c, 0) + '" ' + SW + '/><text x="100" y="146" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1) + '" font-family="Arial, sans-serif" textLength="26" lengthAdjust="spacingAndGlyphs">СССР</text>';
  };
  T.papakha = function (c) {
    var s = '<path d="M56 66 L60 20 Q100 10 140 20 L144 66Z" fill="' + c0(c, 0) + '" ' + SW + '/>';
    for (var i = 0; i < 12; i++) s += '<circle cx="' + (64 + (i % 6) * 14) + '" cy="' + (30 + Math.floor(i / 6) * 18) + '" r="6" fill="' + shade(c0(c, 0), 0.15) + '"/>';
    return s + '<path d="M76 20 Q100 26 124 20 L120 12 Q100 16 80 12Z" fill="' + c0(c, 1) + '" ' + SW + '/>';
  };
  // Большая императорская корона (легенда): две серебряные полусферы в рядах
  // жемчуга, между ними — жемчужная арка, на вершине — красная шпинель и
  // алмазный крест, внизу — обруч с камнями. Камни вспыхивают.
  T.crown = function (c) {
    var g = c0(c, 0, '#e9c46a'), sv = c0(c, 1, '#c0c7d0'), red = c0(c, 2, '#b3123a'), gr = uid('crw'), pearls = '';
    function pearlArc(d, n) {
      var out = '';
      for (var i = 0; i <= n; i++) {
        var t = i / n, x, y;
        if (d === 'l') { x = 62 + t * 36; y = 58 - Math.sin(t * Math.PI * 0.95) * 34; }
        else if (d === 'r') { x = 102 + t * 36; y = 58 - Math.sin((1 - t) * Math.PI * 0.95) * 34; }
        else { x = 100; y = 58 - t * 38; }
        out += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.1" fill="#fbfaf5" stroke="' + OUT + '" stroke-width=".7"/>';
      }
      return out;
    }
    return '<defs><radialGradient id="' + gr + '" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="' + sv + '"/><stop offset="1" stop-color="' + shade(sv, -0.35) + '"/></radialGradient></defs>' +
      '<g class="it-shine"><path d="M60 60 C58 36 76 22 98 24 L98 60Z M102 60 L102 24 C124 22 142 36 140 60Z" fill="url(#' + gr + ')" ' + SW + '/>' +
      '<path d="M66 50 Q80 42 94 48 M106 48 Q120 42 134 50" stroke="' + shade(sv, -0.3) + '" stroke-width="1.2" fill="none"/>' +
      pearlArc('l', 9) + pearlArc('r', 9) + pearlArc('c', 8) +
      '<path d="M92 20 Q100 10 108 20 L104 24 H96Z" fill="' + g + '" ' + SW + '/>' +
      '<path d="M100 18 L94 10 L100 2 L106 10Z" fill="' + red + '" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/><path d="M98 8 l2 -3 1 3" stroke="#ffd6cc" stroke-width="1" fill="none"/>' +
      '<path d="M100 2 V-10 M95 -5 H105" stroke="' + OUT + '" stroke-width="4.4" stroke-linecap="round"/><path d="M100 2 V-10 M95 -5 H105" stroke="#e8f4ff" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M56 58 L144 58 L144 70 L56 70Z" fill="' + g + '" ' + SW + '/>' +
      '<path d="M58 61 H142" stroke="' + shade(g, 0.3) + '" stroke-width="1.2"/>' +
      '<g><rect x="64" y="60.5" width="7" height="7" rx="1" fill="#1d8a5a" stroke="' + OUT + '" stroke-width="1"/><circle cx="82" cy="64" r="3.2" fill="#fbfaf5" stroke="' + OUT + '" stroke-width=".8"/>' +
      '<ellipse cx="100" cy="64" rx="6" ry="4.4" fill="' + red + '" stroke="' + OUT + '" stroke-width="1.2"/><circle cx="118" cy="64" r="3.2" fill="#fbfaf5" stroke="' + OUT + '" stroke-width=".8"/><rect x="129" y="60.5" width="7" height="7" rx="1" fill="#2f63c9" stroke="' + OUT + '" stroke-width="1"/></g></g>' +
      '<path class="it-twinkle" d="M110 6 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1Z" fill="#fff"/><path class="it-twinkle" style="animation-delay:.7s" d="M72 38 l.8 2.4 2.4 .8 -2.4 .8 -.8 2.4 -.8 -2.4 -2.4 -.8 2.4 -.8Z" fill="#fff"/>';
  };
  // Двууголка Кутузова (легенда): чёрный фетр с золотой каймой по краю,
  // белый плюмаж из перьев по гребню, кокарда и петлица.
  T.bicorne = function (c) {
    var k = c0(c, 0, '#15151a'), g = c0(c, 1, '#e8c35a'), plume = '';
    for (var i = 0; i < 9; i++) {
      var x = 52 + i * 12, y = 40 - Math.sin(i / 8 * Math.PI) * 16;
      plume += '<path d="M' + x.toFixed(1) + ' ' + (y + 8).toFixed(1) + ' q-9 -12 0 -24 q2 -4 5 -2 q5 12 1 26Z" fill="' + (i % 2 ? '#fbfaf5' : '#e9edf2') + '" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M' + (x + 1).toFixed(1) + ' ' + (y + 4).toFixed(1) + ' q-3 -8 1 -16" stroke="#c9ced6" stroke-width="1" fill="none"/>';
    }
    return '<g class="bc-plume">' + plume + '</g>' +
      '<path d="M30 64 Q60 20 100 26 Q140 20 170 64 Q100 52 30 64Z" fill="' + k + '" ' + SW + '/>' +
      '<path d="M34 61 Q62 26 100 31 Q138 26 166 61" fill="none" stroke="' + g + '" stroke-width="2.6"/>' +
      '<path d="M42 60 Q100 50 158 60" fill="none" stroke="' + g + '" stroke-width="1.6" stroke-dasharray="3 2"/>' +
      '<path d="M100 30 L96 56 M104 30 L108 56" stroke="' + g + '" stroke-width="1.8"/>' +
      '<circle cx="100" cy="44" r="8" fill="#fff" ' + SW + '/><circle cx="100" cy="44" r="5" fill="#c62828"/><circle cx="100" cy="44" r="2" fill="#15151a"/>' +
      '<path d="M60 44 Q80 32 94 36" stroke="#4a4a58" stroke-width="2" fill="none" opacity=".6"/>';
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
  function torso(fill, extra) {
    var id=uid('cloth');
    return '<defs><linearGradient id="'+id+'" x1="0" x2="1" y1="0" y2=".7"><stop stop-color="'+shade(fill,.16)+'"/><stop offset=".5" stop-color="'+fill+'"/><stop offset="1" stop-color="'+shade(fill,-.22)+'"/></linearGradient></defs><path d="M62 136 Q66 118 100 118 Q134 118 138 136 L140 170 Q100 190 60 170Z" fill="url(#'+id+')" '+SW+'/><path d="M70 140 L69 166 M131 140 L133 166" stroke="'+shade(fill,-.22)+'" stroke-width="1.6" opacity=".5" fill="none"/>'+(extra||'');
  }
  // Рукава — в тех же «шарнирах», что и лапы: машет лапа — машет и рукав.
  var SLEEVE = { fill: null };
  function sleeves(fill) { SLEEVE.fill = fill; return '<g class="pet-arm-l"><ellipse cx="62" cy="150" rx="11" ry="16" transform="rotate(20 62 150)" fill="' + fill + '" ' + SW + '/></g><g class="pet-arm-r"><ellipse cx="138" cy="150" rx="11" ry="16" transform="rotate(-20 138 150)" fill="' + fill + '" ' + SW + '/></g>'; }
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
  T.hoodie = function (c) { return torso(c0(c, 0), '<path d="M76 120 Q100 142 124 120" fill="' + shade(c0(c, 0), 0.15) + '" ' + SW + '/><path d="M92 128 L90 146 M108 128 L110 146" stroke="#fff" stroke-width="2"/><text x="100" y="170" text-anchor="middle" font-size="10" font-weight="900" fill="' + c0(c, 1) + '" font-family="Arial, sans-serif" textLength="20" lengthAdjust="spacingAndGlyphs">ЕГЭ</text>') + sleeves(c0(c, 0)); };
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
  // Мантия Екатерины (легенда): коронационная — золотая парча с чёрными
  // двуглавыми орлами, подбита горностаем, шлейф лежит на земле. Спереди —
  // горностаевая пелерина, голубая Андреевская лента со звездой ордена и
  // золотой шнур с кистями. По парче бежит блик и вспыхивают искры.
  function eagle(x, y, k, col) {
    return '<path transform="translate(' + x + ' ' + y + ') scale(' + (k || 1) + ')" d="M0 -3 l-1.2 -1.6 -1 .9 .6 1.1 -3.4 -1.4 -.6 1.4 2.6 1.6 -1.6 .8 1.3 1 1.7 -.6 .9 2.2 .7 -1.4 .7 1.4 .9 -2.2 1.7 .6 1.3 -1 -1.6 -.8 2.6 -1.6 -.6 -1.4 -3.4 1.4 .6 -1.1 -1 -.9Z" fill="' + col + '"/>';
  }
  function ermine(pts, col) {
    return pts.map(function (q) { return '<path d="M' + q[0] + ' ' + q[1] + ' q1.4 3 0 5.5 q-1.4 -2.5 0 -5.5Z" fill="' + col + '"/>'; }).join('');
  }
  T.mantle_back = function (c) {
    var g = c0(c, 0, '#e9c46a'), w = c0(c, 1, '#ffffff'), k = c0(c, 2, '#15151a');
    var gr = uid('mgr'), cl = uid('mcl');
    var cape = 'M70 118 C50 128 34 158 22 194 Q100 212 178 194 C166 158 150 128 130 118Z';
    var pat = '';
    for (var r = 0; r < 6; r++) for (var i = 0; i < 9; i++) {
      var x = 26 + i * 19 + (r % 2 ? 9.5 : 0), y = 132 + r * 13;
      pat += eagle(x, y, 1.05, k);
      pat += '<path d="M' + (x + 9.5) + ' ' + (y + 3) + ' l2 3 -2 3 -2 -3Z" fill="' + shade(g, -0.28) + '" opacity=".7"/>';
    }
    var glints = '';
    [[40, 176, 0], [64, 150, .5], [150, 160, 1], [132, 186, 1.4], [168, 184, .8], [30, 190, 1.8], [118, 142, 2.2]].forEach(function (q) {
      glints += '<path class="it-twinkle" style="animation-delay:' + q[2] + 's" d="M' + q[0] + ' ' + (q[1] - 5) + ' l1.3 3.7 3.7 1.3 -3.7 1.3 -1.3 3.7 -1.3 -3.7 -3.7 -1.3 3.7 -1.3Z" fill="#fffbe6"/>';
    });
    // Горностаевая подбивка — полосой по краям и по подолу.
    var edgeL = 'M70 118 C50 128 34 158 22 194 L31 196 C42 162 56 134 74 124Z';
    var edgeR = 'M130 118 C150 128 166 158 178 194 L169 196 C158 162 144 134 126 124Z';
    var hem = 'M22 194 Q100 212 178 194 L176 186 Q100 203 24 186Z';
    return '<defs><linearGradient id="' + gr + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + shade(g, 0.3) + '"/><stop offset=".55" stop-color="' + g + '"/><stop offset="1" stop-color="' + shade(g, -0.3) + '"/></linearGradient>' +
      '<clipPath id="' + cl + '"><path d="' + cape + '"/></clipPath></defs>' +
      '<g class="mt-cape"><path d="' + cape + '" fill="url(#' + gr + ')" ' + SW + '/>' +
      '<g clip-path="url(#' + cl + ')">' + pat +
      '<rect class="mt-gleam" x="-40" y="100" width="26" height="130" fill="#fff" opacity=".5" transform="skewX(-22)"/></g>' +
      '<path d="' + edgeL + '" fill="' + w + '" ' + SW + '/><path d="' + edgeR + '" fill="' + w + '" ' + SW + '/><path d="' + hem + '" fill="' + w + '" ' + SW + '/>' +
      ermine([[30, 184], [40, 160], [52, 138], [168, 184], [158, 160], [146, 138], [50, 194], [72, 197], [94, 199], [116, 199], [138, 197], [158, 194]], k) +
      glints + '</g>';
  };
  T.mantle = function (c) {
    var g = c0(c, 0, '#e9c46a'), w = c0(c, 1, '#ffffff'), k = c0(c, 2, '#15151a');
    var blue = '#4a8fe0';
    // Андреевская лента через грудь — под пелериной, из-под неё видна.
    var s = '<path d="M72 132 L84 128 L134 176 L122 182Z" fill="' + blue + '" ' + SW + '/>' +
      '<path d="M80 131 L128 178" stroke="#fff" stroke-width="1.4" opacity=".45"/>';
    // Звезда ордена Андрея Первозванного.
    var star = '';
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2;
      star += (i ? ' L' : 'M') + (112 + Math.cos(a) * 9).toFixed(1) + ' ' + (160 + Math.sin(a) * 9).toFixed(1) + ' L' + (112 + Math.cos(a + Math.PI / 8) * 4).toFixed(1) + ' ' + (160 + Math.sin(a + Math.PI / 8) * 4).toFixed(1);
    }
    s += '<path class="mt-star" d="' + star + 'Z" fill="#e8ecf2" stroke="' + OUT + '" stroke-width="1.3" stroke-linejoin="round"/><circle cx="112" cy="160" r="3.2" fill="' + blue + '" stroke="' + OUT + '" stroke-width="1"/>' + eagle(112, 160.5, .5, '#fff');
    // Горностаевая пелерина с зубчатым краем.
    s += '<path d="M58 132 Q60 114 100 112 Q140 114 142 132 Q141 142 134 146 Q128 142 122 147 Q116 142 110 148 Q104 143 100 149 Q96 143 90 148 Q84 142 78 147 Q72 142 66 146 Q59 142 58 132Z" fill="' + w + '" ' + SW + '/>' +
      ermine([[70, 124], [84, 118], [100, 120], [116, 118], [130, 124], [76, 136], [92, 132], [108, 132], [124, 136], [66, 140], [134, 140]], k);
    // Золотой шнур с кистями.
    s += '<path d="M72 146 Q100 158 128 146" fill="none" stroke="' + shade(g, -0.35) + '" stroke-width="4" stroke-linecap="round"/><path d="M72 146 Q100 158 128 146" fill="none" stroke="' + g + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="3 2"/>' +
      '<path d="M72 146 l-3 12 h6Z M128 146 l-3 12 h6Z" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.2" stroke-linejoin="round"/>';
    return '<g class="it-shine">' + s + '</g>' + sleeves(g);
  };
  T.marshal = function (c) { return torso(c0(c, 0), '<path d="M86 118 L100 134 L114 118" fill="' + c0(c, 2) + '" ' + SW + '/><g fill="' + c0(c, 1) + '"><circle cx="100" cy="146" r="3"/><circle cx="100" cy="160" r="3"/><circle cx="100" cy="174" r="3"/></g><path d="M112 142 l3 6 7 1 -5 5 1 7 -6-3 -6 3 1-7 -5-5 7-1Z" fill="' + c0(c, 1) + '" ' + SW + '/><rect x="72" y="142" width="16" height="4" fill="' + c0(c, 2) + '"/><rect x="72" y="148" width="16" height="4" fill="#2f63c9"/><rect x="72" y="154" width="16" height="4" fill="' + c0(c, 1) + '"/>') + sleeves(c0(c, 0)) + '<path d="M48 136 l20 -4 M152 136 l-20 -4" stroke="' + c0(c, 1) + '" stroke-width="6" stroke-linecap="round"/>'; };
  // Плащ из перьев Жар-птицы (миф): за спиной до земли — ряды перьев, как
  // чешуя, от золотых у плеч к огненным у подола; у нижних — «глазки», кончики
  // горят. Спереди — воротник из мелких золотых перьев и рубиновая застёжка.
  function feather(x, y, len, ang, fill, vein, eye) {
    var s = '<g transform="translate(' + x.toFixed(1) + ' ' + y + ') rotate(' + ang.toFixed(1) + ')">' +
      '<path d="M0 0 C-7 ' + (len * 0.35).toFixed(1) + ' -6 ' + (len * 0.8).toFixed(1) + ' 0 ' + len + ' C6 ' + (len * 0.8).toFixed(1) + ' 7 ' + (len * 0.35).toFixed(1) + ' 0 0Z" fill="' + fill + '" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M0 2 L0 ' + (len - 3) + '" stroke="' + vein + '" stroke-width="1.1" opacity=".8"/>';
    if (eye) s += '<ellipse cx="0" cy="' + (len * 0.7).toFixed(1) + '" rx="3" ry="4" fill="' + eye[0] + '" stroke="' + OUT + '" stroke-width="1"/><circle cx="0" cy="' + (len * 0.72).toFixed(1) + '" r="1.6" fill="' + eye[1] + '"/>';
    return s + '</g>';
  }
  T.firecloak_back = function (c) {
    var fire = c0(c, 0, '#ff7b00'), gold = c0(c, 1, '#ffd23f'), red = c0(c, 2, '#e0341a');
    var cl = uid('fcl');
    var cape = 'M72 118 C54 128 42 158 34 192 Q100 204 166 192 C158 158 146 128 128 118Z';
    var rows = [[gold, shade(gold, -0.35)], [gold, fire], [fire, gold], [fire, red], [red, gold], [red, gold], [red, gold]];
    var s = '';
    // Снизу вверх: верхние перья ложатся на нижние, как чешуя. Всё — внутри
    // силуэта плаща, чтобы он читался плащом, а не хвостом павлина.
    for (var r = rows.length - 1; r >= 0; r--) {
      var y = 112 + r * 12, half = 26 + r * 11, n = 4 + r * 2, len = 20;
      for (var i = 0; i < n; i++) {
        var t = n === 1 ? 0 : i / (n - 1) * 2 - 1, x = 100 + t * half;
        s += feather(x, y, len, -t * 10, rows[r][0], rows[r][1], r >= 5 ? [gold, '#2f63c9'] : null);
      }
    }
    // Горящие кончики по подолу.
    var tips = '';
    for (var j = 0; j < 9; j++) {
      var tx = 38 + j * 15.5, ty = 197 - Math.abs(j - 4) * 1.2;
      tips += '<path class="it-flicker" style="animation-delay:' + (j * 0.13).toFixed(2) + 's" d="M' + (tx - 6) + ' ' + ty + ' q-3 -9 3 -16 q1 6 4 7 q1 -6 -1 -10 q7 7 4 16 q-2 4 -10 3Z" fill="' + (j % 2 ? gold : fire) + '" stroke="' + red + '" stroke-width="1"/>';
    }
    return '<defs><clipPath id="' + cl + '"><path d="' + cape + '"/></clipPath></defs><g class="it-mythic fc-cloak">' + tips +
      '<path d="' + cape + '" fill="' + red + '" ' + SW + '/><g clip-path="url(#' + cl + ')">' + s + '</g>' +
      '<path d="' + cape + '" fill="none" ' + SW + '/></g>';
  };
  T.firecloak = function (c) {
    var fire = c0(c, 0, '#ff7b00'), gold = c0(c, 1, '#ffd23f'), red = c0(c, 2, '#e0341a');
    var s = '';
    for (var i = 0; i < 11; i++) {
      var t = i / 10 * 2 - 1, x = 100 + t * 38, y = 118 + t * t * 10;
      s += feather(x, y, 16, -t * 50, i % 2 ? gold : fire, red, null);
    }
    s += '<circle cx="100" cy="134" r="6" fill="' + red + '" stroke="' + OUT + '" stroke-width="1.8"/><circle cx="98" cy="132" r="2" fill="#ffd6cc"/>' +
      '<path d="M94 134 l-8 6 M106 134 l8 6" stroke="' + gold + '" stroke-width="2.4" stroke-linecap="round"/>';
    return '<g class="it-mythic">' + s + '</g>' + sleeves(fire);
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
  // Боярская борода: окладистая, волнистыми прядями до груди, с усами и
  // светлыми бликами — не плоский треугольник.
  T.beard = function (c) {
    var b = c0(c, 0, '#6b4a2a'), d = shade(b, -0.3), l = shade(b, 0.3), st = '';
    for (var i = 0; i < 7; i++) { var x = 76 + i * 8; st += '<path d="M' + x + ' ' + (122 + Math.abs(3 - i) * 2) + ' q' + (i < 3 ? 3 : i > 3 ? -3 : 0) + ' 14 ' + (i < 3 ? 1 : i > 3 ? -1 : 0) + ' ' + (26 - Math.abs(3 - i) * 5) + '" stroke="' + (i % 2 ? d : l) + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>'; }
    return '<path d="M62 104 Q60 124 70 138 Q78 154 90 160 Q96 166 100 170 Q104 166 110 160 Q122 154 130 138 Q140 124 138 104 Q126 118 112 116 Q100 112 88 116 Q74 118 62 104Z" fill="' + b + '" ' + SW + '/>' +
      '<path d="M70 132 q6 10 14 14 M130 132 q-6 10 -14 14 M88 152 q6 6 12 8 M112 152 q-6 6 -12 8" stroke="' + d + '" stroke-width="1.4" fill="none"/>' + st +
      '<path d="M100 110 C92 104 80 106 72 114 C68 118 64 118 60 116 C64 124 76 124 86 118 C92 115 97 115 100 116 C103 115 108 115 114 118 C124 124 136 124 140 116 C136 118 132 118 128 114 C120 106 108 104 100 110Z" fill="' + shade(b, 0.08) + '" stroke="' + OUT + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<ellipse cx="100" cy="120" rx="5" ry="2.6" fill="#7a2233"/>';
  };
  T.goggles = function (c) { return '<path d="M54 84 L146 84" stroke="' + c0(c, 0) + '" stroke-width="8"/><g fill="' + c0(c, 1) + '" ' + SW + '><circle cx="82" cy="88" r="14"/><circle cx="118" cy="88" r="14"/></g><path d="M74 82 Q78 78 84 80 M110 82 Q114 78 120 80" stroke="#fff" stroke-width="2.5" fill="none"/>'; };
  // Маска с ассамблеи: к прежней маске — плюмаж из трёх перьев справа,
  // золотая филигрань по краю и камень во лбу.
  T.mask = function (c) { return maskPlume(c) + '<g class="it-shine"><path d="M60 84 Q70 72 86 78 Q100 86 114 78 Q130 72 140 84 Q136 102 118 102 Q106 100 100 94 Q94 100 82 102 Q64 102 60 84Z" fill="' + c0(c, 1) + '" ' + SW + '/><ellipse cx="83" cy="89" rx="8" ry="6" fill="' + OUT + '"/><ellipse cx="117" cy="89" rx="8" ry="6" fill="' + OUT + '"/><path d="M60 84 Q46 60 56 50 M140 84 Q154 60 144 50" fill="none" stroke="' + c0(c, 0) + '" stroke-width="4"/><circle cx="56" cy="48" r="5" fill="' + c0(c, 0) + '"/><circle cx="144" cy="48" r="5" fill="' + c0(c, 0) + '"/><path d="M62 86 Q72 76 86 81 Q100 89 114 81 Q128 76 138 86" fill="none" stroke="' + c0(c, 0) + '" stroke-width="1.6" stroke-dasharray="2 2"/><path d="M100 82 l3 4 -3 4 -3 -4Z" fill="#4dabf7" stroke="' + OUT + '" stroke-width="1"/></g>'; };
  // Звёздные глаза (легенда): крупные золотые звёзды с бликом, за каждой
  // медленно вращаются лучи, вокруг вспыхивают искорки.
  function maskPlume(c) {
    var g = c0(c, 0, '#e9c46a');
    return '<g class="mk-plume"><path d="M136 80 C150 62 150 40 142 26 C146 44 140 60 132 76Z" fill="#ff6b8a" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M138 82 C158 70 166 50 162 34 C160 52 150 66 134 78Z" fill="#4dabf7" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M134 84 C156 82 172 70 176 56 C166 70 152 76 132 80Z" fill="#18a058" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M140 30 Q142 50 134 74 M158 40 Q154 60 136 78 M170 60 Q156 74 134 80" fill="none" stroke="#fff" stroke-width="1" opacity=".6"/></g>' +
      '<circle cx="136" cy="80" r="4" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.4"/>';
  }
  T.stareyes = function (c) {
    var g = c0(c, 0, '#ffd23f'), o = c0(c, 1, '#ff9f1c'), gid = uid('se');
    function star(x, y, r) {
      var d = '';
      for (var i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        d += (i ? ' L' : 'M') + (x + Math.cos(a) * rr).toFixed(1) + ' ' + (y + Math.sin(a) * rr).toFixed(1);
      }
      return d + 'Z';
    }
    function eye(x, y) {
      var rays = '';
      for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4; rays += '<path d="M' + x + ' ' + y + ' L' + (x + Math.cos(a - 0.12) * 20).toFixed(1) + ' ' + (y + Math.sin(a - 0.12) * 20).toFixed(1) + ' L' + (x + Math.cos(a + 0.12) * 20).toFixed(1) + ' ' + (y + Math.sin(a + 0.12) * 20).toFixed(1) + 'Z" fill="' + g + '" opacity=".35"/>'; }
      return '<g class="se-rays" style="transform-origin:' + x + 'px ' + y + 'px">' + rays + '</g>' +
        '<path d="' + star(x, y, 13) + '" fill="url(#' + gid + ')" stroke="' + o + '" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="' + star(x - 2.5, y - 3, 4) + '" fill="#fff" opacity=".9"/>' +
        '<path class="it-twinkle" d="M' + (x + 12) + ' ' + (y - 16) + ' l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2Z" fill="#fff"/>';
    }
    return '<defs><radialGradient id="' + gid + '" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".55" stop-color="' + g + '"/><stop offset="1" stop-color="' + o + '"/></radialGradient></defs>' +
      '<g class="it-mythic">' + eye(82, 90) + eye(118, 90) + '</g>';
  };

  // Шея (под подбородком, y≈126…150)
  T.tie = function (c) { return '<path d="M84 124 L100 134 L116 124 L112 134 L100 138 L88 134Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M96 136 L88 164 L96 160 L100 138Z M104 136 L112 164 L104 160 L100 138Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; };
  T.scarf = function (c) {
    return '<path d="M66 124 Q100 140 134 124 L136 136 Q100 152 64 136Z" fill="' + c0(c, 0) + '" ' + SW + '/>' +
      '<path d="M114 136 L120 170 L132 168 L126 134Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M80 130 L80 144 M96 136 L96 148 M118 144 L128 142 M120 156 L130 154" stroke="' + c0(c, 1) + '" stroke-width="4"/>';
  };
  T.bowtie = function (c) { return '<path d="M100 132 L82 122 L82 142Z M100 132 L118 122 L118 142Z" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="100" cy="132" r="5" fill="' + shade(c0(c, 0), 0.2) + '" ' + SW + '/>'; };
  T.beads = function (c) { var s = ''; for (var i = 0; i < 9; i++) { var a = (20 + i * 17.5) * Math.PI / 180; s += '<circle cx="' + (100 - Math.cos(a) * 30).toFixed(1) + '" cy="' + (124 + Math.sin(a) * 16).toFixed(1) + '" r="4.5" fill="' + (i % 2 ? '#f2c14e' : c0(c, 0)) + '" ' + SW + '/>'; } return s; };
  T.badge = function (c) {
    var g = c0(c, 0, '#e9c46a'), r = c0(c, 1, '#c0392b');
    return '<path d="M113 136 L118 127 L123 136Z" fill="' + r + '" ' + SW + '/>' +
      '<path d="M118 135 l3.5 2.6 4.3 -.2 1.3 4.1 3.5 2.6 -1.4 4.1 1.4 4.1 -3.5 2.6 -1.3 4.1 -4.3 -.2 -3.5 2.6 -3.5 -2.6 -4.3 .2 -1.3 -4.1 -3.5 -2.6 1.4 -4.1 -1.4 -4.1 3.5 -2.6 1.3 -4.1 4.3 .2Z" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<circle cx="118" cy="150" r="8" fill="#fff6d6" stroke="' + OUT + '" stroke-width="1.2"/>' +
      '<text x="118" y="152.6" text-anchor="middle" font-size="7" font-weight="900" fill="' + r + '" font-family="Arial, sans-serif" textLength="12" lengthAdjust="spacingAndGlyphs">ГТО</text>';
  };
  T.jabot = function (c) { var s = ''; for (var i = 0; i < 4; i++) s += '<path d="M' + (88 - i * 2) + ' ' + (126 + i * 9) + ' Q100 ' + (136 + i * 9) + ' ' + (112 + i * 2) + ' ' + (126 + i * 9) + ' Q100 ' + (144 + i * 9) + ' ' + (88 - i * 2) + ' ' + (126 + i * 9) + 'Z" fill="' + c0(c, 0) + '" ' + SW + '/>'; return s; };
  T.sash = function (c) { return '<path d="M70 124 L80 120 L136 178 L126 184Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M126 176 l6 8 -2 10 -6 -6 -6 6 -2 -10Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M118 158 l4 8 9 1 -7 6 2 9 -8-5 -8 5 2-9 -7-6 9-1Z" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  // Горжетка: пушистая лисья накидка вокруг шеи — мех клочками с прожилками,
  // на одном конце — мордочка с носиком, на другом — хвост.
  T.fur = function (c) {
    var f = c0(c, 0, '#e8dcc8'), d = c0(c, 1, '#c9b89a'), s = '';
    for (var i = 0; i < 11; i++) {
      var a = (12 + i * 15.6) * Math.PI / 180, x = 100 - Math.cos(a) * 38, y = 124 + Math.sin(a) * 15;
      s += '<path d="M' + (x - 8).toFixed(1) + ' ' + (y + 2).toFixed(1) + ' q1 -9 8 -9 q7 0 8 9 q-2 6 -8 6 q-6 0 -8 -6Z" fill="' + (i % 2 ? d : f) + '" stroke="' + OUT + '" stroke-width="1.8" stroke-linejoin="round"/>' +
        '<path d="M' + (x - 3).toFixed(1) + ' ' + (y - 3).toFixed(1) + ' q3 -2 6 0 M' + (x - 4).toFixed(1) + ' ' + (y + 1).toFixed(1) + ' q4 -2 8 0" stroke="' + shade(f, -0.25) + '" stroke-width="1" fill="none"/>';
    }
    return '<path d="M142 128 Q156 138 150 152 Q146 144 138 140Z" fill="' + d + '" stroke="' + OUT + '" stroke-width="1.8" stroke-linejoin="round"/><path d="M150 152 q-2 -4 -6 -5" stroke="#fff" stroke-width="2" fill="none"/>' + s +
      '<path d="M56 130 L48 126 L52 120 L60 124Z" fill="' + d + '" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M60 128 Q50 132 46 138 Q56 140 62 134Z" fill="' + f + '" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/><circle cx="46" cy="138" r="1.8" fill="' + OUT + '"/><circle cx="55" cy="131" r="1.2" fill="' + OUT + '"/>';
  };
  // Бармы — царское оплечье: широкий золотой воротник на плечах, по кругу
  // пять медальонов-дробниц в жемчужной обводке, между ними узор.
  T.barmy = function (c) {
    var g = c0(c, 0, '#e9c46a'), r = c0(c, 1, '#b3123a'), gr = c0(c, 2, '#1d8a5a');
    var s = '<path d="M56 122 Q100 104 144 122 Q148 136 140 146 Q100 172 60 146 Q52 136 56 122Z" fill="' + g + '" ' + SW + '/>' +
      '<path d="M72 124 Q100 114 128 124 Q126 132 100 138 Q74 132 72 124Z" fill="' + shade(g, -0.35) + '" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<path d="M60 140 Q100 162 140 140" fill="none" stroke="' + shade(g, 0.35) + '" stroke-width="1.4" stroke-dasharray="2 3"/>';
    [[66, 136, gr], [82, 148, r], [100, 152, gr], [118, 148, r], [134, 136, gr]].forEach(function (q) {
      var pearls = '';
      for (var k = 0; k < 8; k++) { var a = k * Math.PI / 4; pearls += '<circle cx="' + (q[0] + Math.cos(a) * 6.4).toFixed(1) + '" cy="' + (q[1] + Math.sin(a) * 6.4).toFixed(1) + '" r="1.3" fill="#fbfaf5"/>'; }
      s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="7.6" fill="' + shade(g, -0.15) + '" stroke="' + OUT + '" stroke-width="1.4"/>' + pearls +
        '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="4" fill="' + q[2] + '" stroke="' + OUT + '" stroke-width="1"/><circle cx="' + (q[0] - 1.3) + '" cy="' + (q[1] - 1.3) + '" r="1.2" fill="#fff" opacity=".7"/>';
    });
    return '<g class="it-shine">' + s + '</g>';
  };
  T.order = function (c) { return '<path d="M76 122 L100 140 L124 122" fill="none" stroke="' + c0(c, 0) + '" stroke-width="6"/><path d="M100 136 L110 146 L100 168 L90 146Z" fill="' + c0(c, 0) + '" ' + SW + '/><path d="M88 150 L112 150 M100 138 L100 164" stroke="' + c0(c, 1) + '" stroke-width="4"/><circle cx="100" cy="150" r="5" fill="' + c0(c, 1) + '" ' + SW + '/>'; };
  T.chain = function (c) { var s = ''; for (var i = 0; i < 11; i++) { var a = (15 + i * 15) * Math.PI / 180; s += '<ellipse cx="' + (100 - Math.cos(a) * 34).toFixed(1) + '" cy="' + (124 + Math.sin(a) * 24).toFixed(1) + '" rx="5" ry="3.5" fill="none" stroke="' + c0(c, 0) + '" stroke-width="3"/>'; } return '<g class="it-shine">' + s + '<circle cx="100" cy="154" r="9" fill="' + c0(c, 0) + '" ' + SW + '/><circle cx="100" cy="154" r="4" fill="' + c0(c, 1) + '"/></g>'; };

  // В руке (правая лапа ≈ 140,152; предмет поднимается вверх-вправо)

  // Место (фон целиком, 200×200; земля у y≈188)
  function sky(top, bottom) { var id = uid('sky'); return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/></linearGradient></defs><rect width="200" height="200" fill="url(#' + id + ')"/>'; }
  function ground(col) { return '<path d="M0 176 Q100 166 200 176 L200 200 L0 200Z" fill="' + col + '"/>'; }
  T.bg_izba = function (c) { return sky(c0(c, 0), '#fff8ea') + '<path d="M18 120 L60 88 L102 120Z" fill="#6b3f22"/><rect x="24" y="118" width="72" height="56" fill="' + c0(c, 1) + '"/><g stroke="#6b3f22" stroke-width="2">' + [128, 140, 152, 164].map(function (y) { return '<path d="M24 ' + y + ' H96"/>'; }).join('') + '</g><rect x="48" y="132" width="22" height="18" fill="#bfe3ff" stroke="#6b3f22" stroke-width="3"/>' + ground('#8fc26a'); };
  T.bg_field = function (c) { var s = sky(c0(c, 0), '#f4fbff') + '<circle cx="160" cy="36" r="16" fill="#ffd23f"/>' + ground(c0(c, 1)); for (var i = 0; i < 26; i++) s += '<path d="M' + (i * 8) + ' 190 q2 -18 0 -30" stroke="#b8912f" stroke-width="2" fill="none"/>'; return s; };
  T.bg_class = function (c) { return '<rect width="200" height="200" fill="' + c0(c, 0) + '"/><rect x="20" y="24" width="160" height="80" rx="4" fill="' + c0(c, 1) + '" stroke="#8a5a2b" stroke-width="5"/><text x="100" y="58" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial" textLength="104" lengthAdjust="spacingAndGlyphs">1242 — Ледовое</text><text x="100" y="78" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial" textLength="56" lengthAdjust="spacingAndGlyphs">побоище</text><rect x="0" y="170" width="200" height="30" fill="#c9a877"/>'; };
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
  T.bg_baikonur = function (c) { return sky(c0(c, 0), '#fff4e0') + '<path d="M150 170 L150 50 Q160 20 170 50 L170 170Z" fill="' + c0(c, 1) + '" stroke="#999" stroke-width="2"/><path d="M150 150 L138 172 L150 172Z M170 150 L182 172 L170 172Z" fill="#cc2d2d"/><path d="M186 60 L186 170 M190 60 L190 170" stroke="#777" stroke-width="3"/><text x="160" y="110" text-anchor="middle" font-size="7" font-weight="900" fill="#cc2d2d" font-family="Arial, sans-serif" textLength="18" lengthAdjust="spacingAndGlyphs" transform="rotate(-90 160 110)">СССР</text>' + ground('#e2c79a'); };
  T.bg_space = function (c) {
    var s = '<rect width="200" height="200" fill="' + c0(c, 0) + '"/><circle cx="40" cy="160" r="60" fill="#1b2a6b" opacity=".6"/>';
    var pts = [[20, 20], [60, 40], [100, 16], [150, 30], [180, 60], [30, 90], [170, 110], [120, 70], [80, 110], [186, 180], [10, 140]];
    pts.forEach(function (p, i) { s += '<circle class="it-twinkle" style="animation-delay:' + (i * 0.3) + 's" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (i % 3 ? 1.6 : 2.6) + '" fill="' + c0(c, 1) + '"/>'; });
    s += '<circle cx="160" cy="160" r="26" fill="#3a86c8"/><path d="M140 150 q10 -6 18 2 q8 8 18 2" stroke="#5bb04a" stroke-width="6" fill="none"/>';
    return '<g class="it-mythic">' + s + '</g>';
  };

  // Спутники (левый нижний угол, ≈ 14…56 × 140…190)
  function buddy(inner) { return '<g class="pet-buddy">' + inner + '</g>'; }
  // Жар-птица (миф): крупная и детальная — золотое тело с чешуйками, изогнутая
  // шея, крыло из трёх слоёв перьев, длинный огненный хвост с «глазками» и
  // пламенный хохолок. Смотрит на питомца.
  T.c_firebird = function (c) {
    var fire = c0(c, 0, '#ff6a13'), gold = c0(c, 1, '#ffd23f'), deep = '#d9480f', hot = '#fff3b0';
    var s = '<g class="it-mythic">';
    // Хвост: три длинных пера-пламени уходят назад-влево, у каждого «глазок».
    [['M30 170 C18 176 6 172 2 160 C10 166 18 164 24 160Z', [8, 166]],
     ['M28 166 C14 160 6 146 8 130 C14 144 22 150 30 154Z', [11, 142]],
     ['M32 174 C24 186 12 192 2 190 C12 186 20 180 24 172Z', [9, 186]]].forEach(function (f) {
      s += '<path d="' + f[0] + '" fill="' + fire + '" ' + SW + '/>' +
        '<path d="' + f[0] + '" fill="none" stroke="' + hot + '" stroke-width="1.2" opacity=".55" transform="translate(1 -1)"/>' +
        '<circle cx="' + f[1][0] + '" cy="' + f[1][1] + '" r="3.6" fill="' + gold + '" stroke="' + OUT + '" stroke-width="1"/><circle cx="' + f[1][0] + '" cy="' + f[1][1] + '" r="1.5" fill="#2f63c9"/>';
    });
    // Тело и чешуйки-перья на груди.
    s += '<ellipse cx="42" cy="166" rx="18" ry="12" fill="' + gold + '" ' + SW + '/>';
    [[46, 164], [52, 166], [48, 170], [54, 171], [43, 169]].forEach(function (p) {
      s += '<path d="M' + p[0] + ' ' + p[1] + ' q2 3 4 0" fill="none" stroke="' + deep + '" stroke-width="1" opacity=".7"/>';
    });
    // Крыло: три слоя перьев.
    s += '<path d="M30 164 Q34 142 54 138 Q48 150 50 160Z" fill="' + deep + '" ' + SW + '/>' +
      '<path d="M32 164 Q38 148 54 146 Q48 154 48 162Z" fill="' + fire + '" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<path d="M34 164 Q40 154 52 154 Q46 158 46 164Z" fill="' + gold + '" stroke="' + OUT + '" stroke-width="1.2"/>';
    // Шея и голова, смотрит вправо — на питомца.
    s += '<path d="M54 160 C60 154 60 144 58 138 L64 136 C68 144 66 156 58 164Z" fill="' + gold + '" ' + SW + '/>' +
      '<circle cx="64" cy="132" r="8" fill="' + gold + '" ' + SW + '/>' +
      '<circle cx="66.5" cy="130.5" r="2" fill="' + OUT + '"/><circle cx="67" cy="130" r=".7" fill="#fff"/>' +
      '<path d="M71 132 L78 135 L71 136.5Z" fill="#f08a24" stroke="' + OUT + '" stroke-width="1" stroke-linejoin="round"/>' +
      '<path d="M60 136 q4 3 8 2" fill="none" stroke="' + deep + '" stroke-width="1.2"/>';
    // Пламенный хохолок.
    s += '<path class="it-flicker" d="M60 126 q-5 -9 0 -15 q1 6 4 8 q0 -8 6 -11 q-2 8 0 12 q3 -4 7 -4 q-4 5 -6 11Z" fill="' + fire + '" stroke="' + OUT + '" stroke-width="1"/>' +
      '<path d="M63 124 q0 -5 3 -8" fill="none" stroke="' + hot + '" stroke-width="1.4"/>';
    // Лапки.
    s += '<path d="M40 177 l-2 6 M46 177 l1 6 M36 183 l4 0 M45 183 l4 0" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>';
    return buddy(s + '</g>');
  };

  // Сияние (поверх всего, но прозрачное)
  // Звездопад (эпик): сзади — сумеречное небо, по нему наискось летят
  // звёзды со светящимися хвостами; спереди мерцают крупные звёздочки.
  T.a_stars_back = function (c) {
    var id = uid('stb'), s = '';
    for (var i = 0; i < 6; i++) {
      var x = 30 + (i * 43) % 170, y = 10 + (i * 29) % 70;
      s += '<g class="st-shoot" style="animation-delay:' + (i * 0.7).toFixed(1) + 's"><path d="M' + x + ' ' + y + ' l-34 -14" stroke="url(#' + id + ')" stroke-width="3" stroke-linecap="round"/><circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#fff"/></g>';
    }
    return '<defs><linearGradient id="' + id + '" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="' + c0(c, 0, '#ffd23f') + '"/><stop offset="1" stop-color="' + c0(c, 0, '#ffd23f') + '" stop-opacity="0"/></linearGradient></defs>' +
      '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><rect width="200" height="200" fill="#2b2f6b" opacity=".35"/>' + s + '</svg>';
  };
  T.a_stars = function (c) {
    var s = '';
    [[22, 60, 6], [176, 42, 5], [160, 120, 4], [30, 128, 4.5], [104, 14, 3.5]].forEach(function (q, i) {
      var x = q[0], y = q[1], r = q[2];
      s += '<path class="it-twinkle" style="animation-delay:' + (i * 0.35) + 's" d="M' + x + ' ' + (y - r * 2) + ' Q' + (x + r * 0.3) + ' ' + (y - r * 0.3) + ' ' + (x + r * 2) + ' ' + y + ' Q' + (x + r * 0.3) + ' ' + (y + r * 0.3) + ' ' + x + ' ' + (y + r * 2) + ' Q' + (x - r * 0.3) + ' ' + (y + r * 0.3) + ' ' + (x - r * 2) + ' ' + y + ' Q' + (x - r * 0.3) + ' ' + (y - r * 0.3) + ' ' + x + ' ' + (y - r * 2) + 'Z" fill="' + (i % 2 ? c0(c, 1, '#fff3b0') : c0(c, 0, '#ffd23f')) + '"/>';
    });
    return s;
  };
  // Снег 1812 года (легенда): крупные шестилучевые снежинки кружатся и падают,
  // сзади — морозная дымка, у ног — сугробы.
  function flake(x, y, r, col) {
    var d = '';
    for (var i = 0; i < 3; i++) { var a = i * Math.PI / 3; d += 'M' + (x - Math.cos(a) * r).toFixed(1) + ' ' + (y - Math.sin(a) * r).toFixed(1) + ' L' + (x + Math.cos(a) * r).toFixed(1) + ' ' + (y + Math.sin(a) * r).toFixed(1) + ' '; }
    return '<path d="' + d + '" stroke="' + col + '" stroke-width="' + (r > 4 ? 1.6 : 1.2) + '" stroke-linecap="round"/><circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.3).toFixed(1) + '" fill="' + col + '"/>';
  }
  T.a_snow_back = function (c) {
    var id = uid('frost');
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6ecff" stop-opacity=".75"/><stop offset=".6" stop-color="#e6f3ff" stop-opacity=".25"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs>' +
      '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><rect width="200" height="200" fill="url(#' + id + ')"/></svg>';
  };
  T.a_snow = function (c) {
    var s = '';
    for (var i = 0; i < 18; i++) {
      var x = 8 + (i * 47) % 186, y = 6 + (i * 31) % 130, r = i % 3 === 0 ? 5.5 : i % 3 === 1 ? 3.6 : 2.4;
      s += '<g class="sn-flake" style="animation-delay:' + (-(i * 0.61) % 5).toFixed(2) + 's;animation-duration:' + (4 + (i % 4) * 0.8).toFixed(1) + 's">' + flake(x, y, r, i % 2 ? c0(c, 0, '#ffffff') : c0(c, 1, '#cfe6f7')) + '</g>';
    }
    return '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + s +
      '<path d="M0 194 Q20 184 42 192 Q56 186 70 194 L70 200 L0 200Z M130 196 Q150 184 170 192 Q186 186 200 192 L200 200 L130 200Z" fill="#fff" stroke="#cfe6f7" stroke-width="1.5"/></svg>';
  };
  // Праздничный салют (эпик): сзади в небе раскрываются крупные шары-вспышки
  // с искрами на концах лучей и дымными следами ракет.
  T.a_salute_back = function (c) {
    var s = '';
    [[42, 44, 26], [158, 34, 24], [106, 18, 18]].forEach(function (p, j) {
      var col = c0(c, j % 3, ['#ef4444', '#3b82f6', '#ffd23f'][j]), rays = '';
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * Math.PI * 2, x2 = p[0] + Math.cos(a) * p[2], y2 = p[1] + Math.sin(a) * p[2];
        rays += '<path d="M' + (p[0] + Math.cos(a) * 5).toFixed(1) + ' ' + (p[1] + Math.sin(a) * 5).toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + col + '" stroke-width="2.2" stroke-linecap="round"/><circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2" fill="#fff6c2"/>';
      }
      s += '<path d="M' + p[0] + ' 196 Q' + (p[0] + 6) + ' ' + (p[1] + 70) + ' ' + p[0] + ' ' + (p[1] + 8) + '" stroke="#c9ced6" stroke-width="1.6" fill="none" stroke-dasharray="2 4" opacity=".6"/>' +
        '<g class="sl-boom" style="animation-delay:' + (j * 0.7) + 's;transform-origin:' + p[0] + 'px ' + p[1] + 'px">' + rays + '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="#fff"/></g>';
    });
    return '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + s + '</svg>';
  };
  T.a_salute = function (c) {
    var s = '';
    for (var i = 0; i < 8; i++) s += '<circle class="it-fall" style="animation-delay:' + (i * 0.4).toFixed(1) + 's" cx="' + (20 + i * 22) + '" cy="' + (30 + (i * 17) % 40) + '" r="1.8" fill="' + ['#ffd23f', '#ef4444', '#3b82f6', '#fff6c2'][i % 4] + '"/>';
    return s;
  };
  // Золотые искры (легенда): золотое свечение сзади, вокруг — звёздочки
  // разного размера мерцают и медленно всплывают, сверху сыплется блёстка.
  function spark4(x, y, r, fill, delay, cls) {
    x = +x; y = +y;
    return '<path class="' + (cls || 'it-twinkle') + '" style="animation-delay:' + delay + 's" d="M' + x + ' ' + (y - r) + ' Q' + (x + r * 0.18) + ' ' + (y - r * 0.18) + ' ' + (x + r) + ' ' + y + ' Q' + (x + r * 0.18) + ' ' + (y + r * 0.18) + ' ' + x + ' ' + (y + r) + ' Q' + (x - r * 0.18) + ' ' + (y + r * 0.18) + ' ' + (x - r) + ' ' + y + ' Q' + (x - r * 0.18) + ' ' + (y - r * 0.18) + ' ' + x + ' ' + (y - r) + 'Z" fill="' + fill + '"/>';
  }
  T.a_sparks_back = function (c) {
    var id = uid('gsp');
    return '<defs><radialGradient id="' + id + '"><stop offset="0" stop-color="' + c0(c, 0, '#ffd23f') + '" stop-opacity=".55"/><stop offset="1" stop-color="' + c0(c, 0, '#ffd23f') + '" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse class="sig-pulse" cx="100" cy="118" rx="84" ry="86" fill="url(#' + id + ')"/>';
  };
  T.a_sparks = function (c) {
    var s = '', g = c0(c, 0, '#ffd23f'), l = c0(c, 1, '#e9c46a');
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2 + (i % 2) * 0.2, rr = 62 + (i % 3) * 12, x = 100 + Math.cos(a) * rr, y = 112 + Math.sin(a) * rr * 0.92;
      s += '<g class="gs-rise" style="animation-delay:' + (-(i * 0.37)).toFixed(2) + 's">' + spark4(x.toFixed(1), y.toFixed(1), i % 4 === 0 ? 7 : i % 2 ? 3.4 : 4.8, i % 3 ? g : '#fffbe6', (i * 0.23).toFixed(2)) + '</g>';
    }
    for (var j = 0; j < 8; j++) s += '<circle class="it-fall" style="animation-delay:' + (j * 0.5) + 's" cx="' + (30 + j * 20) + '" cy="' + (40 + (j * 23) % 60) + '" r="1.4" fill="' + l + '"/>';
    return s;
  };
  // Огонь Жар-птицы (легенда): сзади поднимается костёр из трёх слоёв языков
  // пламени (красный → оранжевый → жёлтый), спереди у ног — низкие язычки,
  // вверх летят искры.
  function tongue(x, base, h, w) {
    return 'M' + (x - w) + ' ' + base + ' C' + (x - w) + ' ' + (base - h * 0.45) + ' ' + (x - w * 0.2) + ' ' + (base - h * 0.6) + ' ' + x + ' ' + (base - h) + ' C' + (x + w * 0.3) + ' ' + (base - h * 0.62) + ' ' + (x + w) + ' ' + (base - h * 0.45) + ' ' + (x + w) + ' ' + base + 'Z';
  }
  T.a_fire_back = function (c) {
    var fire = c0(c, 0, '#ff7b00'), gold = c0(c, 1, '#ffd23f');
    var layers = [['#e0341a', 1, .85], [fire, .78, .9], [gold, .55, .95]], s = '';
    layers.forEach(function (L, li) {
      [[40, 70], [62, 104], [82, 128], [100, 140], [118, 128], [138, 104], [160, 70]].forEach(function (q, i) {
        s += '<path class="it-flicker" style="animation-delay:' + ((i * 0.17 + li * 0.23) % 0.9).toFixed(2) + 's" d="' + tongue(q[0], 192, q[1] * L[1], 16 * L[1] + 4) + '" fill="' + L[0] + '" opacity="' + L[2] + '"/>';
      });
    });
    return '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + s + '</svg>';
  };
  T.a_fire = function (c) {
    var fire = c0(c, 0, '#ff7b00'), gold = c0(c, 1, '#ffd23f'), s = '';
    [[56, 22], [74, 16], [126, 16], [144, 22]].forEach(function (q, i) {
      s += '<path class="it-flicker" style="animation-delay:' + (i * 0.2) + 's" d="' + tongue(q[0], 196, q[1], 8) + '" fill="' + (i % 2 ? gold : fire) + '" opacity=".9"/>';
    });
    for (var j = 0; j < 10; j++) s += '<circle class="sig-dust" style="animation-delay:' + (j * 0.32).toFixed(2) + 's" cx="' + (40 + (j * 29) % 124) + '" cy="' + (150 + (j * 11) % 30) + '" r="' + (j % 3 ? 1.5 : 2.4) + '" fill="' + (j % 2 ? gold : fire) + '"/>';
    return s;
  };
  // Алый вихрь (легенда): сзади вращаются три лепестка-ленты, сужающиеся к
  // концу, спереди по орбите летят алые лепестки.
  T.a_vortex_back = function (c) {
    var red = c0(c, 0, '#e0341a'), pink = c0(c, 1, '#ff8a8a'), id = uid('vx'), s = '';
    for (var i = 0; i < 4; i++) {
      s += '<path d="M112 112 C126 66 184 58 198 104 C182 84 146 84 128 124 Z" fill="url(#' + id + ')" stroke="' + shade(red, -0.3) + '" stroke-width="1.2" transform="rotate(' + (i * 90) + ' 100 112)"/>' +
        '<path d="M118 108 C132 80 170 74 186 94" fill="none" stroke="' + pink + '" stroke-width="2.2" opacity=".8" stroke-linecap="round" transform="rotate(' + (i * 90) + ' 100 112)"/>';
    }
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + red + '" stop-opacity=".25"/><stop offset=".55" stop-color="' + red + '" stop-opacity=".85"/><stop offset="1" stop-color="' + pink + '" stop-opacity="1"/></linearGradient></defs>' +
      '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><circle cx="100" cy="112" r="92" fill="' + red + '" opacity=".08"/><g class="vx-spin">' + s + '</g></svg>';
  };
  T.a_vortex = function (c) {
    var red = c0(c, 0, '#e0341a'), pink = c0(c, 1, '#ff8a8a'), s = '';
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2, x = 100 + Math.cos(a) * 84, y = 112 + Math.sin(a) * 60;
      s += '<path d="M' + x.toFixed(1) + ' ' + y.toFixed(1) + ' q4 -6 9 -2 q-3 6 -9 2Z" fill="' + (i % 2 ? red : pink) + '" stroke="' + OUT + '" stroke-width=".8"/>';
    }
    return '<g class="vx-orbit">' + s + '</g>';
  };


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
    return T.panama(c) + '<path d="M65 56 Q100 47 135 56 L135 64 Q100 55 65 64Z" fill="' + c0(c, 2, '#2f63c9') + '" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<text x="100" y="61.6" text-anchor="middle" font-size="7.4" font-weight="900" fill="#fff" font-family="Arial, sans-serif" textLength="52" lengthAdjust="spacingAndGlyphs">Я СДАМ ЕГЭ</text>';
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
    var p = c0(c, 0, '#fff4c2'), ink = '#d0342c', grid = '';
    for (var i = 0; i < 9; i++) grid += '<path d="M' + (64 + i * 9) + ' 34 V63" stroke="#9fc5e8" stroke-width=".6"/>';
    for (var j = 0; j < 3; j++) grid += '<path d="M62 ' + (44 + j * 9) + ' H138" stroke="#9fc5e8" stroke-width=".6"/>';
    var id = uid('pcr');
    return '<defs><clipPath id="' + id + '"><path d="M62 64 L62 36 L76 50 L88 28 L100 48 L112 28 L124 50 L138 36 L138 64Z"/></clipPath></defs>' +
      '<path d="M62 64 L62 36 L76 50 L88 28 L100 48 L112 28 L124 50 L138 36 L138 64Z" fill="' + p + '" ' + SW + '/>' +
      '<g clip-path="url(#' + id + ')">' + grid + '</g>' +
      '<text x="100" y="62" text-anchor="middle" font-size="15" font-weight="900" fill="' + ink + '" font-family="Arial, sans-serif" textLength="16" lengthAdjust="spacingAndGlyphs" transform="rotate(-6 100 56)">5?</text>' +
      '<path d="M114 60 q6 -1 10 -5" stroke="' + ink + '" stroke-width="1.4" fill="none"/>';
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
    var k = c0(c, 0, '#15151a'), r = c0(c, 1, '#e0341a');
    return '<path d="M54 90 Q52 34 100 32 Q148 34 146 90" fill="none" stroke="' + OUT + '" stroke-width="10"/><path d="M54 90 Q52 34 100 32 Q148 34 146 90" fill="none" stroke="' + k + '" stroke-width="7"/>' +
      '<path d="M70 44 Q100 30 130 44" fill="none" stroke="' + r + '" stroke-width="2"/>' +
      '<rect x="38" y="74" width="20" height="36" rx="9" fill="' + k + '" ' + SW + '/><rect x="142" y="74" width="20" height="36" rx="9" fill="' + k + '" ' + SW + '/>' +
      '<rect x="43" y="80" width="5" height="24" rx="2.5" fill="' + r + '"/><rect x="152" y="80" width="5" height="24" rx="2.5" fill="' + r + '"/>' +
      '<text x="152" y="95" text-anchor="middle" font-size="6" font-weight="900" fill="#fff" font-family="Arial, sans-serif" textLength="11" lengthAdjust="spacingAndGlyphs" transform="rotate(-90 152 92)">zxc</text>';
  };

  // Лицо
  T.thug = function () {
    var s = '', px = function (x, y, w, h, col) { s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + col + '"/>'; };
    px(58, 82, 84, 6, '#111'); px(64, 88, 28, 6, '#111'); px(108, 88, 28, 6, '#111'); px(68, 94, 20, 5, '#111'); px(112, 94, 20, 5, '#111');
    px(70, 88, 5, 5, '#fff'); px(114, 88, 5, 5, '#fff'); px(76, 94, 5, 4, '#fff'); px(120, 94, 5, 4, '#fff');
    return '<g class="it-drop">' + s + '</g>';
  };
  // Челюсть гигачада (легенда): квадратный подбородок с ямкой, резкая линия
  // челюсти с тенью, плотная щетина, скулы и тяжёлые брови.
  T.gigachad = function (c) {
    var k = c0(c, 0, '#000'), st = c0(c, 1, '#3a2a1e');
    var dots = '';
    for (var i = 0; i < 34; i++) {
      var col = i % 9, row = Math.floor(i / 9);
      var x = 72 + col * 7 + (row % 2) * 3.5, y = 118 + row * 6 + (col % 2);
      if (Math.abs(x - 100) > 30 - row * 3) continue;
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="1.05" fill="' + st + '" opacity=".75"/>';
    }
    return '<g class="it-shine">' +
      '<path d="M58 100 L62 126 Q68 144 100 150 Q132 144 138 126 L142 100 Q134 132 100 138 Q66 132 58 100Z" fill="' + k + '" opacity=".22"/>' +
      '<path d="M60 98 L64 126 Q70 144 100 150 Q130 144 136 126 L140 98" fill="none" stroke="' + OUT + '" stroke-width="3.4" stroke-linejoin="round"/>' +
      '<path d="M66 108 Q74 116 84 114 M134 108 Q126 116 116 114" fill="none" stroke="' + k + '" stroke-width="2" opacity=".35" stroke-linecap="round"/>' +
      dots +
      '<path d="M96 140 Q100 146 104 140" fill="none" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M66 78 Q80 72 94 80 M106 80 Q120 72 134 78" fill="none" stroke="' + OUT + '" stroke-width="5" stroke-linecap="round"/></g>';
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
    var k = c0(c, 0, '#15151a'), t = c0(c, 1, '#f4f1e6'), teeth = '';
    for (var i = 0; i < 9; i++) {
      var x = 72.5 + i * 6.4, h = 12 - Math.abs(i - 4) * 0.8;
      teeth += '<path d="M' + x + ' ' + (114 - h / 2) + ' h5.2 v' + h + ' q-2.6 2 -5.2 0Z" fill="' + t + '" stroke="#000" stroke-width="1"/><path d="M' + (x + 1.2) + ' ' + (115 - h / 2) + ' v' + (h - 3) + '" stroke="#fff" stroke-width="1" opacity=".8"/>';
    }
    return '<g class="it-shine"><path d="M58 100 Q60 136 100 140 Q140 136 142 100 Q122 96 100 98 Q78 96 58 100Z" fill="' + k + '" ' + SW + '/>' +
      '<path d="M64 104 Q70 128 100 134" stroke="#4a4a58" stroke-width="2" fill="none" opacity=".7"/>' +
      '<path d="M66 108 Q100 100 134 108 L134 120 Q100 128 66 120Z" fill="#6b1420" stroke="#000" stroke-width="1.2"/>' + teeth +
      '<path d="M58 100 L42 94 M142 100 L158 94" stroke="' + OUT + '" stroke-width="6" stroke-linecap="round"/><path d="M58 100 L42 94 M142 100 L158 94" stroke="' + k + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<circle cx="62" cy="104" r="2.2" fill="#9aa3ad" stroke="#000" stroke-width=".8"/><circle cx="138" cy="104" r="2.2" fill="#9aa3ad" stroke="#000" stroke-width=".8"/>' +
      '<path d="M76 130 l4 3 M86 134 l3 3 M114 134 l-3 3 M124 130 l-4 3" stroke="#4a4a58" stroke-width="1.4"/></g>';
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
    return '<g class="it-shine">' + s + '<circle cx="100" cy="162" r="14" fill="' + c0(c, 0, '#e9c46a') + '" ' + SW + '/><text x="100" y="167" text-anchor="middle" font-size="12" font-weight="900" fill="' + c0(c, 1, '#8a5a00') + '" font-family="Arial, sans-serif" textLength="18" lengthAdjust="spacingAndGlyphs">100</text></g>';
  };
  T.freshener = function (c) {
    return '<path d="M100 128 L100 140" stroke="#fff" stroke-width="1.5"/><path d="M100 140 L88 156 L94 156 L84 170 L92 170 L80 184 L120 184 L108 170 L116 170 L106 156 L112 156Z" fill="' + c0(c, 0, '#2fa84f') + '" ' + SW + '/><path d="M96 180 v6" stroke="' + OUT + '" stroke-width="3"/>';
  };
  T.foilbow = function (c) { return '<g>' + T.bowtie([c0(c, 0, '#cfd6de')]) + '<path d="M86 126 L94 134 M114 126 L106 134 M88 136 L92 132" stroke="' + c0(c, 1, '#8a96a3') + '" stroke-width="1.4"/></g>'; };
  T.medalpatience = function (c) {
    var m = c0(c, 0, '#c0c7d0'), rb = c0(c, 1, '#2f63c9');
    return '<path d="M91 122 L100 148 L109 122" fill="' + rb + '" ' + SW + '/><path d="M96 124 L100 138 L104 124" stroke="#fff" stroke-width="1.4" fill="none" opacity=".6"/>' +
      '<circle cx="100" cy="159" r="13" fill="' + m + '" ' + SW + '/><circle cx="100" cy="159" r="10" fill="none" stroke="' + shade(m, -0.25) + '" stroke-width="1"/>' +
      '<text x="100" y="156.5" text-anchor="middle" font-size="5" font-weight="900" fill="' + OUT + '" font-family="Arial, sans-serif" textLength="7" lengthAdjust="spacingAndGlyphs">ЗА</text>' +
      '<text x="100" y="163.5" text-anchor="middle" font-size="5" font-weight="900" fill="' + OUT + '" font-family="Arial, sans-serif" textLength="17" lengthAdjust="spacingAndGlyphs">ТЕРПЕНИЕ</text>' +
      '<path d="M92 152 q3 -4 7 -5" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7"/>';
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
      '<rect x="140" y="112" width="30" height="12" fill="#fff" stroke="#2b2233" stroke-width="1.5"/><text x="155" y="121" text-anchor="middle" font-size="9" font-weight="900" font-family="Arial, sans-serif" textLength="30" lengthAdjust="spacingAndGlyphs">№ 1242</text>' +
      '<circle cx="50" cy="148" r="13" fill="#2b2233"/><circle cx="150" cy="148" r="13" fill="#2b2233"/><circle cx="50" cy="148" r="5" fill="#aaa"/><circle cx="150" cy="148" r="5" fill="#aaa"/>';
  };
  T.bg_759 = function (c) {
    return '<rect width="200" height="200" fill="#e9efe6"/><rect x="16" y="30" width="120" height="70" rx="3" fill="' + c0(c, 0, '#2f5a3a') + '" stroke="#8a5a2b" stroke-width="4"/>' +
      '<text x="76" y="62" text-anchor="middle" font-size="13" fill="#fff" font-family="Comic Sans MS, Arial" textLength="78" lengthAdjust="spacingAndGlyphs">Контрольная</text><text x="76" y="82" text-anchor="middle" font-size="10" fill="#fff" font-family="Comic Sans MS, Arial" textLength="46" lengthAdjust="spacingAndGlyphs">по датам</text>' +
      '<circle cx="164" cy="50" r="22" fill="#fff" stroke="#2b2233" stroke-width="3"/><path d="M164 50 L164 34 M164 50 L176 50" stroke="#2b2233" stroke-width="3" stroke-linecap="round"/><path d="M164 50 L164 35" stroke="#d0342c" stroke-width="1.5" transform="rotate(354 164 50)"/>' +
      '<text x="164" y="86" text-anchor="middle" font-size="10" font-weight="900" font-family="Arial, sans-serif" fill="#d0342c" textLength="22" lengthAdjust="spacingAndGlyphs">7:59</text><rect x="0" y="172" width="200" height="28" fill="#c9a877"/>';
  };
  T.bg_gym = function (c) {
    return '<rect width="200" height="200" fill="' + c0(c, 0, '#2a2d33') + '"/><rect x="120" y="20" width="66" height="120" fill="#9fb4c8" opacity=".35" stroke="#555" stroke-width="3"/>' +
      '<rect x="0" y="170" width="200" height="30" fill="#1b1d21"/><path d="M14 158 L96 158" stroke="#c3cad2" stroke-width="5"/><rect x="10" y="140" width="10" height="36" rx="3" fill="#111"/><rect x="90" y="140" width="10" height="36" rx="3" fill="#111"/>' +
      '<text x="153" y="84" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1, '#e0341a') + '" font-family="Arial, sans-serif" textLength="42" lengthAdjust="spacingAndGlyphs">NO PAIN</text><text x="153" y="98" text-anchor="middle" font-size="11" font-weight="900" fill="' + c0(c, 1, '#e0341a') + '" font-family="Arial, sans-serif" textLength="38" lengthAdjust="spacingAndGlyphs">NO ЕГЭ</text>';
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


  // Сияние
  T.a_friday = function () {
    var s = '', col = ['#ff4d6d', '#ffd23f', '#4dabf7', '#18a058', '#a855f7'];
    for (var i = 0; i < 16; i++) s += '<rect class="it-fall" style="animation-delay:' + (i * 0.27).toFixed(2) + 's" x="' + ((i * 41) % 200) + '" y="' + ((i * 29) % 110) + '" width="5" height="8" rx="1" fill="' + col[i % 5] + '" transform="rotate(' + (i * 37 % 90) + ' ' + ((i * 41) % 200) + ' ' + ((i * 29) % 110) + ')"/>';
    return s + '<circle class="it-twinkle" cx="170" cy="30" r="10" fill="#e9e3ff" opacity=".8"/>';
  };
  // Режим дедлайна (легенда): сзади — красная тревожная пульсация, спереди —
  // трясущийся будильник со звоном, красное табло «23:59» с мигающим
  // двоеточием и листы, которые разлетаются в панике.
  T.a_deadline_back = function () {
    var id = uid('dl');
    return '<defs><radialGradient id="' + id + '"><stop offset=".45" stop-color="#ef4444" stop-opacity="0"/><stop offset="1" stop-color="#ef4444" stop-opacity=".55"/></radialGradient></defs>' +
      '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden"><rect class="dl-pulse" width="200" height="200" fill="url(#' + id + ')"/></svg>';
  };
  T.a_deadline = function () {
    var papers = '';
    [[20, 150, -20, 0], [168, 132, 25, .7], [40, 90, 12, 1.4], [176, 76, -15, 2.1]].forEach(function (q) {
      papers += '<g class="dl-paper" style="animation-delay:' + q[3] + 's"><g transform="translate(' + q[0] + ' ' + q[1] + ') rotate(' + q[2] + ')"><rect x="-8" y="-10" width="16" height="20" rx="1.5" fill="#fff" stroke="#2b2233" stroke-width="1.4"/>' +
        '<path d="M-5 -5 h10 M-5 -1 h10 M-5 3 h7" stroke="#9aa3ad" stroke-width="1.2"/></g></g>';
    });
    return '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + papers +
      '<g class="dl-clock"><path d="M16 22 l-6 -6 M44 22 l6 -6" stroke="#2b2233" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="18" cy="20" r="6" fill="#ef4444" stroke="#2b2233" stroke-width="2"/><circle cx="42" cy="20" r="6" fill="#ef4444" stroke="#2b2233" stroke-width="2"/>' +
      '<circle cx="30" cy="36" r="15" fill="#fff" stroke="#ef4444" stroke-width="3.5"/><path d="M30 36 v-9 M30 36 h7" stroke="#2b2233" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path class="dl-ring" d="M6 30 q-4 6 0 12 M54 30 q4 6 0 12" stroke="#ef4444" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>' +
      '<rect x="138" y="14" width="56" height="24" rx="4" fill="#1b1b1f" stroke="#ef4444" stroke-width="2"/>' +
      '<text x="166" y="32" text-anchor="middle" font-size="16" font-weight="900" fill="#ff4d4d" font-family="Courier New, monospace">23<tspan class="dl-colon">:</tspan>59</text></svg>' +
      '<path class="pet-tear" d="M140 70 Q136 78 140 81 Q144 78 140 70Z" fill="#7fc8f8"/>';
  };
  // Абсолютное спокойствие (эпик): бирюзовое сияние, по земле расходятся
  // круги, под питомцем — лотос, сверху парит нарисованный инь-ян.
  T.a_zen_back = function () {
    var id = uid('zen');
    return '<defs><radialGradient id="' + id + '"><stop offset="0" stop-color="#7bd3c3" stop-opacity=".55"/><stop offset="1" stop-color="#7bd3c3" stop-opacity="0"/></radialGradient></defs>' +
      '<ellipse class="sig-pulse" cx="100" cy="116" rx="86" ry="84" fill="url(#' + id + ')"/>';
  };
  T.a_zen = function () {
    var s = '';
    for (var i = 0; i < 3; i++) s += '<ellipse class="it-ripple" style="animation-delay:' + (i * 1.2) + 's" cx="100" cy="190" rx="40" ry="8" fill="none" stroke="#5bbfae" stroke-width="2"/>';
    var petals = '';
    [-50, -25, 0, 25, 50].forEach(function (a) { petals += '<path d="M100 192 Q92 180 100 170 Q108 180 100 192Z" fill="#f7c6d9" stroke="' + OUT + '" stroke-width="1.2" transform="rotate(' + a + ' 100 192)"/>'; });
    var yy = '<g class="it-float" transform="translate(100 22)"><circle r="10" fill="#fff" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M0 -10 A10 10 0 0 1 0 10 A5 5 0 0 1 0 0 A5 5 0 0 0 0 -10Z" fill="#1f2330"/><circle cy="-5" r="1.6" fill="#1f2330"/><circle cy="5" r="1.6" fill="#fff"/></g>';
    return s + petals + yy;
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
    // Крупнее прежнего и в золотом сиянии: легенду должно быть видно издалека.
    return buddy('<g transform="translate(40 192) scale(1.3) translate(-38 -192)"><ellipse class="or-glow" cx="38" cy="160" rx="30" ry="30" fill="' + g + '" opacity=".3"/><g class="it-shine">' + wing(-1) + wing(1) +
      '<ellipse cx="38" cy="176" rx="15" ry="14" fill="' + g + '" ' + SW + '/>' +
      '<path d="M30 170 q2 -3 4 0 q2 -3 4 0 q2 -3 4 0 q2 -3 4 0" fill="none" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<path d="M32 172 H44 V179 Q44 185 38 187 Q32 185 32 179Z" fill="#c0392b" stroke="' + gd + '" stroke-width="1.6"/>' +
      '<path d="M38 175 v8 M35 178 h6" stroke="#fff" stroke-width="1.4"/>' +
      head(-1) + head(1) +
      '<path d="M31 137 L31 131 L34.5 134 L38 128 L41.5 134 L45 131 L45 137Z" fill="' + g + '" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<path d="M38 128 V124 M36.5 125.5 H39.5" stroke="' + gd + '" stroke-width="1.2"/>' +
      '<circle cx="34.5" cy="135" r=".9" fill="#c0392b"/><circle cx="41.5" cy="135" r=".9" fill="#1d8a5a"/>' +
      '<path d="M32 189 l-3 3 M34 189 l0 4 M36 189 l3 3 M40 189 l-3 3 M42 189 l0 4 M44 189 l3 3" stroke="#f08a24" stroke-width="1.6" stroke-linecap="round"/></g></g>');
  };

  // «Столыпинский галстук» — исторический мем (так в 1907 г. Родичев назвал
  // виселицу военно-полевых судов): верёвочная петля вместо галстука, узел
  // витками у горла, конец свисает как галстук. Справка к шутке — в каталоге.
  T.stolypin = function (c) {
    var r = c0(c, 0, '#d9c9a0'), d = c0(c, 1, '#8a6a44');
    var rope = function (path, w) {
      return '<path d="' + path + '" fill="none" stroke="' + OUT + '" stroke-width="' + (w + 2.4) + '" stroke-linecap="round"/>' +
        '<path d="' + path + '" fill="none" stroke="' + r + '" stroke-width="' + w + '" stroke-linecap="round"/>' +
        '<path d="' + path + '" fill="none" stroke="' + d + '" stroke-width="' + (w - 1) + '" stroke-dasharray="1.6 3.2" stroke-linecap="butt" opacity=".55"/>';
    };
    var coils = '';
    for (var i = 0; i < 6; i++) {
      var y = 131 + i * 3.6;
      coils += '<rect x="93.5" y="' + y.toFixed(1) + '" width="13" height="4.2" rx="2.1" fill="' + r + '" stroke="' + OUT + '" stroke-width="1.3"/>' +
        '<path d="M95.5 ' + (y + 3.4).toFixed(1) + ' L104.5 ' + (y + 0.8).toFixed(1) + '" stroke="' + d + '" stroke-width="1" opacity=".6"/>';
    }
    return rope('M80 118 Q84 131 97 132 M120 118 Q116 131 103 132', 4.2) +
      rope('M100 152 Q99 162 101 172', 4.2) +
      '<path d="M98.5 172 l-1.5 4 M101 173 l0 4 M103.4 172 l1.6 4" stroke="' + d + '" stroke-width="1.3" stroke-linecap="round"/>' +
      coils;
  };

  // ── Вещи в руке v2 (28.09.2026): питомец их ДЕРЖИТ ─────────────────────
  // Раньше вещь рисовалась в координатах сцены и висела рядом с лапой. Теперь
  // каждая рисуется вокруг своей рукояти — точка (0,0), вверх — минус y. Рендер
  // ставит рукоять в лапу нужного вида, поворачивает руку в позу вещи (поднять
  // меч, держать книгу перед грудью, нести пакет) и рисует поверх рукояти
  // пальцы — или ладонь ПОД вещью, если её держат на ладони (чашка, держава,
  // огонь). HOLD — поза, наклон вещи, масштаб и рамка значка в лавке.
  var POSE = { side: 0, out: -16, up: -34, raise: -58, front: 30 };
  var HOLD = {
    quill: { pose: 'up', tilt: 22 }, scroll: { pose: 'front', tilt: -6 }, book: { pose: 'front', tilt: -8 },
    abacus: { pose: 'front', tilt: -4 }, balalaika: { pose: 'out', tilt: -28, box: '-30 -60 60 116' }, cup: { pose: 'front', palm: true, box: '-22 -52 44 54' },
    flag: { pose: 'raise', tilt: 6, box: '-12 -80 66 106' }, saber: { pose: 'up', tilt: 12 }, bow: { pose: 'out', tilt: 0, box: '-24 -64 70 128' },
    clock: { pose: 'front', palm: true }, guitar: { pose: 'out', tilt: -36, box: '-26 -60 52 116' }, spyglass: { pose: 'up', tilt: 58 },
    gusli: { pose: 'front', tilt: -10 }, sword: { pose: 'up', tilt: 8 }, scepter: { pose: 'raise', tilt: 4 },
    torch: { pose: 'raise', tilt: 4 }, orb: { pose: 'front', palm: true, box: '-28 -60 56 66' }, sputnik: { pose: 'out', palm: true },
    slipper: { pose: 'up', tilt: -76, box: '-14 -64 96 76' }, seeds: { pose: 'front', tilt: 8 }, bagofbags: { pose: 'side', tilt: 0, box: '-24 -18 48 64' },
    cheatsheet: { pose: 'front', tilt: -6 }, calculator: { pose: 'front', tilt: -6 }, shawarma: { pose: 'front', tilt: -14 },
    mughist: { pose: 'front', tilt: 0, box: '-40 -48 54 74' }, bandage: { pose: 'side', over: true, box: '-14 -22 52 36' }, chainsaw: { pose: 'out', tilt: -8, box: '-26 -40 96 56' },
    bluefire: { pose: 'front', palm: true },
  };
  // Плечо (ось поворота руки) и лапа в координатах каждой анатомии.
  var ANAT = {
    baby: { sh: [130, 140], paw: [142, 163], sleeve: [138, 150, 11, 16, -20] }, babyOwl: { sh: [134, 134], paw: [143, 171], wing: true, sleeve: [138, 150, 11, 16, -20] },
    v3: { sh: [126, 114], paw: [135, 152], sleeve: [132, 130, 9.2, 14.7, -20] }, v3Owl: { sh: [126, 112], paw: [140, 158], wing: true, sleeve: [132, 130, 9.2, 14.7, -20] },
    human: { sh: [126, 108], paw: [134.5, 156], skin: true, sleeve: [132, 130, 9.2, 14.7, -20] }, bur: { sh: [128, 108], paw: [134.5, 156], skin: true, maxUp: -30, sleeve: [132, 130, 9.2, 14.7, -20] },
    squid: { sh: [124, 106], paw: [126, 152], sleeve: [128, 128, 8, 13, -10] }, squidChad: { sh: [140, 122], paw: [146, 176], skin: true, sleeve: [146, 140, 10, 16, -10] },
  };
  // Пальцы поверх рукояти / ладонь под вещью.
  function paw(A, fill, ink, palm) {
    var x = A.paw[0], y = A.paw[1], o = 'stroke="' + ink + '" stroke-width="2.2" stroke-linejoin="round"';
    if (palm) return '<g class="pet-paw"><ellipse cx="' + x + '" cy="' + (y + 1) + '" rx="10" ry="5" fill="' + fill + '" ' + o + '/>' +
      '<path d="M' + (x - 6) + ' ' + (y - 2) + ' q2 -3 4 0 M' + (x - 1) + ' ' + (y - 3) + ' q2 -3 4 0 M' + (x + 4) + ' ' + (y - 2) + ' q2 -3 4 0" fill="' + fill + '" ' + o + '/></g>';
    if (A.wing) return '<g class="pet-paw"><path d="M' + (x - 8) + ' ' + (y - 6) + ' Q' + (x + 4) + ' ' + (y - 10) + ' ' + (x + 8) + ' ' + (y - 2) + ' Q' + (x + 6) + ' ' + (y + 6) + ' ' + (x - 2) + ' ' + (y + 6) + ' Q' + (x - 9) + ' ' + (y + 2) + ' ' + (x - 8) + ' ' + (y - 6) + 'Z" fill="' + fill + '" ' + o + '/>' +
      '<path d="M' + (x - 3) + ' ' + (y - 4) + ' q4 3 7 6 M' + (x - 5) + ' ' + y + ' q4 2 6 5" fill="none" stroke="' + ink + '" stroke-width="1.3" opacity=".7"/></g>';
    return '<g class="pet-paw"><ellipse cx="' + x + '" cy="' + y + '" rx="' + (A.skin ? 7 : 7.8) + '" ry="' + (A.skin ? 6.5 : 7) + '" fill="' + fill + '" ' + o + '/>' +
      '<path d="M' + (x - 5) + ' ' + (y - 2) + ' q2.5 2 5 0 M' + (x - 5) + ' ' + (y + 2) + ' q2.5 2 5 0" fill="none" stroke="' + ink + '" stroke-width="1.3" opacity=".75"/></g>';
  }
  // Рука + вещь в позе. arm — рисунок руки вида, fill/ink — цвет лапы и контура.
  function holding(anat, arm, fill, ink, eq, items) {
    var id = eq.hand, it = id && items[id], fn = it && T[it.art.t];
    var A0 = ANAT[anat] || ANAT.v3;
    if (!Tailor && SLEEVE.fill && A0.sleeve) {
      var q = A0.sleeve;
      arm += '<ellipse cx="' + q[0] + '" cy="' + q[1] + '" rx="' + q[2] + '" ry="' + q[3] + '" transform="rotate(' + q[4] + ' ' + q[0] + ' ' + q[1] + ')" fill="' + SLEEVE.fill + '" ' + SW + '/>';
    }
    if (!fn) return arm;
    var H = HOLD[it.art.t] || { pose: 'side' }, A = ANAT[anat] || ANAT.v3;
    var ang = POSE[H.pose] || 0;
    if (A.maxUp != null && ang < A.maxUp) ang = A.maxUp; // сидящему Бурундаю руку выше не задрать — уйдёт за кадр
    var obj = '<g class="slot-hand r-' + it.rarity + '"><g transform="translate(' + A.paw[0] + ' ' + A.paw[1] + ') rotate(' + (-ang + (H.tilt || 0)) + ')' + (H.scale ? ' scale(' + H.scale + ')' : '') + '">' + fn(it.art.c || []) + '</g></g>';
    var pw = paw(A, fill, ink, H.palm);
    return '<g transform="rotate(' + ang + ' ' + A.sh[0] + ' ' + A.sh[1] + ')">' + arm + (H.palm || H.over ? pw + obj : obj + pw) + '</g>';
  }
  function hold(inner) { return '<g class="pet-held">' + inner + '</g>'; }
  var HS = 'stroke="' + OUT + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';

  // Гусиное перо: опахало с бородками, стержень, очинённый кончик в чернилах.
  T.quill = function (c) {
    var f = c0(c, 0, '#f4f1e6'), ink = c0(c, 1, '#1d2a55'), s = '';
    for (var i = 0; i < 9; i++) { var y = -14 - i * 5.5; s += '<path d="M0 ' + y + ' q' + (7 - i * 0.3) + ' -3 ' + (11 - i * 0.6) + ' -8 M0 ' + (y + 2) + ' q-5 -3 -8 -7" stroke="' + shade(f, -0.18) + '" stroke-width="1" fill="none"/>'; }
    return hold('<path d="M0 -8 C14 -24 16 -48 6 -66 C2 -52 -10 -40 -10 -22 C-10 -16 -6 -10 0 -8Z" fill="' + f + '" ' + HS + '/>' + s +
      '<path d="M0 10 L0 -8 Q2 -40 6 -66" fill="none" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M-2 6 L0 14 L2 6Z" fill="' + ink + '" stroke="' + OUT + '" stroke-width="1"/><circle cx="0" cy="15" r="1.3" fill="' + ink + '"/>');
  };
  // Берестяная грамота: светлая береста с тёмными чечевичками, края рваные,
  // процарапанные строки, верх чуть скручен.
  T.scroll = function (c) {
    var b = c0(c, 0, '#efe2c2'), t = c0(c, 1, '#6b4a2a');
    var lines = '';
    for (var i = 0; i < 4; i++) lines += '<path d="M6 ' + (-32 + i * 7) + ' q4 -2 7 0 t7 0 t7 0" stroke="' + t + '" stroke-width="1.3" fill="none"/>';
    return hold('<path d="M-2 -2 L2 -40 Q16 -44 34 -40 L32 -2 Q16 2 -2 -2Z" fill="' + b + '" ' + HS + '/>' +
      '<path d="M2 -40 Q16 -48 34 -40 Q30 -36 18 -38 Q8 -38 2 -40Z" fill="' + shade(b, -0.12) + '" ' + HS + '/>' +
      '<path d="M8 -12 h5 M22 -20 h4 M14 -6 h3 M26 -8 h4" stroke="#3a2a1e" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>' + lines);
  };
  // Книга «ЕГЭ»: твёрдый переплёт с корешком и закладкой, надпись по центру обложки.
  T.book = function (c) {
    var k = c0(c, 0, '#2f63c9'), t = c0(c, 1, '#ffd23f');
    return hold('<path d="M-4 -44 L30 -46 L32 2 L-2 4Z" fill="#f4f1e6" ' + HS + '/>' +
      '<path d="M-6 -46 L28 -48 L30 0 L-4 2Z" fill="' + k + '" ' + HS + '/>' +
      '<path d="M-6 -46 L-4 2" stroke="' + shade(k, -0.35) + '" stroke-width="4"/>' +
      '<rect x="3" y="-34" width="21" height="14" rx="2" fill="' + shade(k, -0.2) + '" transform="rotate(-2 13 -27)"/>' +
      '<text x="13.5" y="-23" text-anchor="middle" font-size="9.5" font-weight="900" fill="' + t + '" font-family="Arial Black, Arial, sans-serif" textLength="17" lengthAdjust="spacingAndGlyphs" transform="rotate(-2 13 -27)">ЕГЭ</text>' +
      '<path d="M22 0 L22 8 L25 5 L28 8 L28 0" fill="#ef4444" stroke="' + OUT + '" stroke-width="1"/>' +
      '<path d="M2 -42 L24 -43" stroke="#fff" stroke-width="1.6" opacity=".45"/>');
  };
  // Счёты: деревянная рама, спицы, по десять косточек, пара «отложена» вправо.
  T.abacus = function (c) {
    var b = c0(c, 0, '#8a5a32'), f = c0(c, 1, '#c79a5b'), s = '';
    for (var r = 0; r < 5; r++) {
      var y = -34 + r * 7.5;
      s += '<path d="M2 ' + y + ' H36" stroke="#5b4636" stroke-width="1.2"/>';
      var shift = [2, 4, 0, 6, 3][r];
      for (var i = 0; i < 6; i++) { var x = 6 + i * 3.6 + (i >= 6 - shift ? 8 : 0); s += '<ellipse cx="' + x.toFixed(1) + '" cy="' + y + '" rx="1.9" ry="2.8" fill="' + (r === 2 ? '#f4f1e6' : b) + '" stroke="' + OUT + '" stroke-width=".7"/>'; }
    }
    return hold('<rect x="-2" y="-42" width="42" height="40" rx="3" fill="' + f + '" ' + HS + '/><rect x="2" y="-38" width="34" height="32" rx="1.5" fill="#f3e6c4" stroke="' + OUT + '" stroke-width="1.2"/>' + s);
  };
  // Балалайка: треугольный корпус с розеткой и подставкой, лады на грифе, головка с колками.
  T.balalaika = function (c) {
    var b = c0(c, 0, '#e0a458'), d = c0(c, 1, '#8a5a32');
    var frets = ''; for (var i = 0; i < 5; i++) frets += '<path d="M-2.4 ' + (-6 - i * 6) + ' h4.8" stroke="#d9d9d9" stroke-width="1"/>';
    return hold('<path d="M0 10 L-24 48 Q0 54 24 48Z" fill="' + b + '" ' + HS + '/>' +
      '<path d="M0 14 L-18 45 Q0 49 18 45Z" fill="' + shade(b, 0.18) + '" opacity=".5"/>' +
      '<circle cx="0" cy="34" r="4.4" fill="#3a2418" stroke="' + OUT + '" stroke-width="1.2"/><path d="M-6 43 h12" stroke="' + d + '" stroke-width="2.2"/>' +
      '<rect x="-3" y="-42" width="6" height="54" rx="1.5" fill="' + d + '" ' + HS + '/>' + frets +
      '<path d="M-5 -42 L-4 -56 L4 -56 L5 -42Z" fill="' + d + '" ' + HS + '/><circle cx="-6" cy="-52" r="1.6" fill="#f4f1e6"/><circle cx="6" cy="-49" r="1.6" fill="#f4f1e6"/><circle cx="-6" cy="-46" r="1.6" fill="#f4f1e6"/>' +
      '<path d="M-1 -42 L-1 44 M1 -42 L1 44" stroke="#f4f1e6" stroke-width=".5" opacity=".9"/>');
  };
  // Чашка чая на блюдце: пар колечками, долька лимона.
  T.cup = function (c) {
    var k = c0(c, 0, '#ffffff'), o = c0(c, 1, '#2f63c9');
    return hold('<ellipse cx="0" cy="-5" rx="17" ry="4" fill="' + k + '" ' + HS + '/>' +
      '<path d="M-11 -24 L-9 -8 Q0 -4 9 -8 L11 -24Z" fill="' + k + '" ' + HS + '/>' +
      '<path d="M11 -20 q8 0 7 6 q-1 5 -8 4" fill="none" stroke="' + OUT + '" stroke-width="2.2"/>' +
      '<ellipse cx="0" cy="-24" rx="11" ry="3" fill="#b5651d" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M-9 -16 h18" stroke="' + o + '" stroke-width="2.4"/><path d="M-4 -12 l2 -3 2 3 2 -3 2 3" stroke="' + o + '" stroke-width="1" fill="none"/>' +
      '<path d="M3 -26 a4 4 0 0 1 7 1Z" fill="#ffe066" stroke="' + OUT + '" stroke-width="1"/>' +
      '<g class="it-steam"><path d="M-4 -30 q-3 -5 0 -9 q3 -4 0 -8 M4 -31 q-3 -5 0 -9" fill="none" stroke="#c9ced6" stroke-width="2" stroke-linecap="round"/></g>');
  };
  // Флажок: древко с набалдашником, полотнище развевается.
  T.flag = function (c) {
    var f = c0(c, 0, '#e0341a');
    return hold('<path d="M0 22 V-72" stroke="' + OUT + '" stroke-width="5" stroke-linecap="round"/><path d="M0 22 V-72" stroke="#c79a5b" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="0" cy="-74" r="3.6" fill="#ffd23f" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<g class="it-wave"><path d="M2 -70 Q16 -76 28 -70 Q40 -64 50 -70 L50 -44 Q40 -38 28 -44 Q16 -50 2 -44Z" fill="' + f + '" ' + HS + '/>' +
      '<path d="M6 -64 Q18 -70 28 -64" stroke="#fff" stroke-width="1.6" fill="none" opacity=".45"/></g>');
  };
  // Сабля: изогнутый клинок с долом, гарда-дужка, рукоять с обмоткой.
  T.saber = function (c) {
    var bl = c0(c, 0, '#dfe6ee'), g = c0(c, 1, '#e9c46a');
    return hold('<path d="M-2 -10 C-4 -34 0 -56 14 -74 C8 -54 6 -34 4 -10Z" fill="' + bl + '" ' + HS + '/>' +
      '<path d="M1 -14 C0 -34 3 -52 12 -68" stroke="#9aa3ad" stroke-width="1.2" fill="none"/>' +
      '<path d="M-8 -10 H10 Q12 -8 10 -6 H-8Z" fill="' + g + '" ' + HS + '/>' +
      '<path d="M8 -8 Q18 0 8 12" fill="none" stroke="' + g + '" stroke-width="2.6"/>' +
      '<rect x="-3" y="-6" width="6" height="16" rx="2" fill="#3a2418" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<path d="M-3 -2 h6 M-3 2 h6 M-3 6 h6" stroke="' + g + '" stroke-width="1"/><circle cx="0" cy="12" r="3" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.4"/>');
  };
  // Лук: деревянные плечи с роговыми накладками, тетива и стрела на полке.
  T.bow = function (c) {
    var w = c0(c, 0, '#8a5a32');
    return hold('<path d="M0 -4 C-14 -20 -14 -46 4 -60 C-6 -44 -6 -22 4 -4Z M0 4 C-14 20 -14 46 4 60 C-6 44 -6 22 4 4Z" fill="' + w + '" ' + HS + '/>' +
      '<path d="M4 -60 L6 60" stroke="#f4f1e6" stroke-width="1.2"/>' +
      '<path d="M-8 0 H40" stroke="' + OUT + '" stroke-width="2.6" stroke-linecap="round"/><path d="M-8 0 H40" stroke="#c79a5b" stroke-width="1.4"/>' +
      '<path d="M40 0 l-7 -4 v8Z" fill="#9aa3ad" stroke="' + OUT + '" stroke-width="1.2"/><path d="M-8 0 l-5 -4 M-8 0 l-5 4" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round"/>' +
      '<rect x="-4" y="-6" width="6" height="12" rx="2" fill="#3a2418" stroke="' + OUT + '" stroke-width="1.2"/>');
  };
  // Будильник «Слава»: две чашки звонка с молоточком, циферблат с делениями и ножки.
  T.clock = function (c) {
    var r = c0(c, 0, '#ef4444'), f = c0(c, 1, '#ffffff'), ticks = '';
    for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; ticks += '<path d="M' + (Math.cos(a) * 11).toFixed(1) + ' ' + (-22 + Math.sin(a) * 11).toFixed(1) + ' L' + (Math.cos(a) * (i % 3 ? 12.5 : 13.5)).toFixed(1) + ' ' + (-22 + Math.sin(a) * (i % 3 ? 12.5 : 13.5)).toFixed(1) + '" stroke="' + OUT + '" stroke-width="' + (i % 3 ? 1 : 1.8) + '"/>'; }
    return hold('<path d="M-10 -4 l-4 5 M10 -4 l4 5" stroke="' + OUT + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="-12" cy="-37" r="6.5" fill="' + r + '" ' + HS + '/><circle cx="12" cy="-37" r="6.5" fill="' + r + '" ' + HS + '/><path d="M0 -40 V-44 M-3 -44 h6" stroke="' + OUT + '" stroke-width="2"/>' +
      '<circle cx="0" cy="-22" r="17" fill="' + r + '" ' + HS + '/><circle cx="0" cy="-22" r="13.5" fill="' + f + '" stroke="' + OUT + '" stroke-width="1.4"/>' + ticks +
      '<path d="M0 -22 V-31 M0 -22 L6 -19" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/><circle cx="0" cy="-22" r="1.6" fill="' + r + '"/>' +
      '<path d="M-8 -34 q3 -3 7 -3" stroke="#fff" stroke-width="1.8" fill="none" opacity=".6"/>');
  };
  // Гитара: «восьмёрка» с розеткой, подставкой, лады и головка с колками.
  T.guitar = function (c) {
    var b = c0(c, 0, '#b3262d'), n = c0(c, 1, '#3a2418');
    var frets = ''; for (var i = 0; i < 6; i++) frets += '<path d="M-2.6 ' + (-4 - i * 6) + ' h5.2" stroke="#d9d9d9" stroke-width="1"/>';
    return hold('<path d="M0 8 C-14 8 -16 18 -10 24 C-20 30 -20 50 0 52 C20 50 20 30 10 24 C16 18 14 8 0 8Z" fill="' + b + '" ' + HS + '/>' +
      '<circle cx="0" cy="26" r="5" fill="#1b1b1f" stroke="#e9c46a" stroke-width="1.4"/><path d="M-7 42 h14" stroke="#1b1b1f" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="-3.2" y="-40" width="6.4" height="50" rx="1.5" fill="' + n + '" ' + HS + '/>' + frets +
      '<path d="M-5 -40 L-4 -56 L4 -56 L5 -40Z" fill="' + n + '" ' + HS + '/><path d="M-7 -52 h3 M-7 -46 h3 M4 -52 h3 M4 -46 h3" stroke="#e9c46a" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M-1.2 -40 V42 M1.2 -40 V42" stroke="#f4f1e6" stroke-width=".5"/>' +
      '<path d="M-10 14 Q-12 20 -8 24" stroke="#fff" stroke-width="1.6" fill="none" opacity=".4"/>');
  };
  // Подзорная труба: три латунных колена, кожаная обмотка, блик на линзе.
  T.spyglass = function (c) {
    var br = c0(c, 0, '#e9c46a'), l = c0(c, 1, '#6b3f22');
    return hold('<rect x="-5" y="-6" width="10" height="22" rx="2" fill="' + l + '" ' + HS + '/>' +
      '<rect x="-6" y="-26" width="12" height="20" rx="2" fill="' + br + '" ' + HS + '/><rect x="-7.5" y="-48" width="15" height="22" rx="2" fill="' + br + '" ' + HS + '/>' +
      '<rect x="-9" y="-54" width="18" height="7" rx="2" fill="' + shade(br, -0.2) + '" ' + HS + '/><ellipse cx="0" cy="-54" rx="7" ry="2.4" fill="#9fd3f7" stroke="' + OUT + '" stroke-width="1.2"/>' +
      '<path d="M-4 -44 V-30 M-3 -22 V-10" stroke="#fff" stroke-width="1.6" opacity=".55"/><path d="M-5 0 h10 M-5 6 h10" stroke="' + shade(l, -0.3) + '" stroke-width="1.2"/>');
  };
  // Гусли крыловидные: резной корпус, струны веером, голосник-звёздочка.
  T.gusli = function (c) {
    var w = c0(c, 0, '#c79a5b'), d = c0(c, 1, '#8a5a32'), s = '';
    for (var i = 0; i < 7; i++) s += '<path d="M' + (6 + i * 3) + ' ' + (-4 - i * 0.5) + ' L' + (8 + i * 4.4) + ' ' + (-38 + i * 3.4) + '" stroke="#f4f1e6" stroke-width=".8"/>';
    return hold('<path d="M0 0 L4 -42 Q24 -44 42 -16 Q40 -2 30 0Z" fill="' + w + '" ' + HS + '/>' +
      '<path d="M4 -42 Q24 -44 42 -16" fill="none" stroke="' + d + '" stroke-width="3"/>' + s +
      '<path d="M16 -18 l2 4 4 0 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 0Z" fill="' + d + '"/>' +
      '<path d="M3 -36 Q4 -20 2 -4 M10 -34 q2 2 0 4 M18 -32 q2 2 0 4 M26 -28 q2 2 0 4" stroke="' + d + '" stroke-width="1.2" fill="none"/>');
  };
  // Меч: прямой клинок с долом, широкая крестовина, рукоять и навершие-яблоко.
  T.sword = function (c) {
    var bl = c0(c, 0, '#dfe6ee'), g = c0(c, 1, '#e9c46a');
    return hold('<path d="M-4.5 -10 L-4 -64 L0 -74 L4 -64 L4.5 -10Z" fill="' + bl + '" ' + HS + '/>' +
      '<path d="M0 -14 V-64" stroke="#9aa3ad" stroke-width="1.6"/><path d="M-2.5 -60 L-2.8 -16" stroke="#fff" stroke-width="1.1" opacity=".7"/>' +
      '<path d="M-15 -10 Q0 -14 15 -10 L15 -6 Q0 -9 -15 -6Z" fill="' + g + '" ' + HS + '/>' +
      '<rect x="-3" y="-6" width="6" height="15" rx="2" fill="#6b3f22" stroke="' + OUT + '" stroke-width="1.6"/><path d="M-3 -2 l6 3 M-3 3 l6 3" stroke="' + g + '" stroke-width="1"/>' +
      '<circle cx="0" cy="12" r="3.6" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.4"/>');
  };
  // Скипетр: золотой жезл с перехватами, держава и двуглавый орёл сверху, камни.
  T.scepter = function (c) {
    var g = c0(c, 0, '#e9c46a'), gem = c0(c, 1, '#b3123a');
    return hold('<path d="M0 18 V-54" stroke="' + OUT + '" stroke-width="7" stroke-linecap="round"/><path d="M0 18 V-54" stroke="' + g + '" stroke-width="4.4" stroke-linecap="round"/>' +
      '<path d="M-4 -14 h8 M-4 -30 h8 M-4 4 h8" stroke="' + shade(g, -0.35) + '" stroke-width="2.2"/><circle cx="0" cy="-22" r="2.4" fill="' + gem + '" stroke="' + OUT + '" stroke-width="1"/>' +
      '<circle cx="0" cy="-60" r="7" fill="' + g + '" ' + HS + '/><path d="M-7 -60 h14" stroke="' + shade(g, -0.35) + '" stroke-width="1.4"/>' +
      '<path d="M0 -67 l-3 -3 -6 -1 2 -4 -5 -2 5 -3 3 2 1 -4 3 3 3 -3 1 4 3 -2 5 3 -5 2 2 4 -6 1Z" fill="' + g + '" stroke="' + OUT + '" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M0 -82 v-5 M-2 -85 h4" stroke="' + g + '" stroke-width="1.8"/><circle cx="-2" cy="-62" r="1.8" fill="#fff" opacity=".7"/>');
  };
  // Олимпийский факел (1980): серебряная чаша-конус с золотым ободом и
  // рифлёной рукоятью, над ней живое пламя из трёх языков, искры.
  T.torch = function (c) {
    var m = c0(c, 0, '#c3cad2'), fl = c0(c, 1, '#ff8c1a'), gr = uid('trc');
    var ribs = ''; for (var i = 0; i < 4; i++) ribs += '<path d="M' + (-3 + i * 2) + ' 14 L' + (-5 + i * 3.3) + ' -30" stroke="' + shade(m, -0.25) + '" stroke-width=".9"/>';
    return hold('<defs><linearGradient id="' + gr + '" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + shade(m, -0.25) + '"/><stop offset=".45" stop-color="#ffffff"/><stop offset="1" stop-color="' + shade(m, -0.3) + '"/></linearGradient></defs>' +
      '<path d="M-3 16 L-8 -30 L8 -30 L3 16Z" fill="url(#' + gr + ')" ' + HS + '/>' + ribs +
      '<path d="M-13 -30 L13 -30 L11 -40 L-11 -40Z" fill="url(#' + gr + ')" ' + HS + '/>' +
      '<path d="M-13 -30 H13" stroke="#e9c46a" stroke-width="3"/><path d="M-11 -40 H11" stroke="#e9c46a" stroke-width="2.4"/>' +
      '<g class="it-flicker"><path d="M0 -40 C-16 -48 -12 -66 -3 -80 C-2 -68 3 -66 6 -60 C8 -68 13 -74 13 -74 C18 -58 13 -46 0 -40Z" fill="' + fl + '" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M0 -42 C-7 -48 -5 -60 0 -66 C2 -58 6 -56 6 -52 C6 -47 4 -44 0 -42Z" fill="#ffe066"/></g>' +
      '<circle class="sig-dust" cx="8" cy="-80" r="1.4" fill="#ffd23f"/><circle class="sig-dust" style="animation-delay:.8s" cx="-7" cy="-74" r="1.2" fill="' + fl + '"/>');
  };
  // Держава на ладони: золотой шар с поясом самоцветов, полуобруч, крест и сапфир.
  T.orb = function (c) {
    var g = c0(c, 0, '#e9c46a'), gem = c0(c, 1, '#2f63c9'), gr = uid('orb'), gems = '';
    [[-13, -16, '#c0392b'], [-7, -13, '#1d8a5a'], [0, -12, gem], [7, -13, '#c0392b'], [13, -16, '#1d8a5a']].forEach(function (q) { gems += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="2" fill="' + q[2] + '" stroke="' + OUT + '" stroke-width=".8"/>'; });
    return hold('<defs><radialGradient id="' + gr + '" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff6cf"/><stop offset=".45" stop-color="' + g + '"/><stop offset="1" stop-color="' + shade(g, -0.4) + '"/></radialGradient></defs>' +
      '<circle class="or-glow" cx="0" cy="-20" r="26" fill="' + g + '" opacity=".25"/>' +
      '<g class="it-shine"><circle cx="0" cy="-20" r="17" fill="url(#' + gr + ')" ' + HS + '/>' +
      '<path d="M-17 -18 Q0 -8 17 -18" fill="none" stroke="' + shade(g, -0.35) + '" stroke-width="4.6"/><path d="M-17 -18 Q0 -8 17 -18" fill="none" stroke="' + g + '" stroke-width="2.8"/>' + gems +
      '<path d="M0 -37 Q9 -28 0 -16" fill="none" stroke="' + shade(g, -0.3) + '" stroke-width="2.6"/>' +
      '<path d="M0 -37 V-52 M-6 -46 H6" stroke="' + OUT + '" stroke-width="6" stroke-linecap="round"/><path d="M0 -37 V-52 M-6 -46 H6" stroke="' + g + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<ellipse cx="0" cy="-37" rx="4.6" ry="3.6" fill="' + gem + '" stroke="' + OUT + '" stroke-width="1.3"/>' +
      '<path d="M-11 -27 Q-8 -33 -2 -35" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/></g>' +
      '<path class="it-twinkle" d="M14 -40 l1.2 3.4 3.4 1.2 -3.4 1.2 -1.2 3.4 -1.2 -3.4 -3.4 -1.2 3.4 -1.2Z" fill="#fff"/>');
  };
  // Спутник-1 парит над ладонью: полированный шар, четыре антенны, радиоволны.
  T.sputnik = function (c) {
    var m = c0(c, 0, '#dfe6ee'), a = c0(c, 1, '#9aa3ad'), gr = uid('spk'), waves = '';
    for (var i = 0; i < 3; i++) waves += '<path class="sp-beep" style="animation-delay:' + (i * 0.5) + 's" d="M' + (14 + i * 6) + ' ' + (-44 - i * 5) + ' q' + (7 + i * 3) + ' ' + (7 + i * 3) + ' 0 ' + (16 + i * 9) + '" fill="none" stroke="#7fc8f8" stroke-width="2" stroke-linecap="round" transform="rotate(-40 0 -30)"/>';
    return hold('<defs><radialGradient id="' + gr + '" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="' + m + '"/><stop offset="1" stop-color="' + shade(m, -0.45) + '"/></radialGradient></defs>' +
      '<g class="it-float">' + waves +
      '<path d="M-10 -24 L-34 12 M-6 -20 L-18 18 M6 -20 L10 20 M10 -26 L30 8" stroke="' + OUT + '" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M-10 -24 L-34 12 M-6 -20 L-18 18 M6 -20 L10 20 M10 -26 L30 8" stroke="' + a + '" stroke-width="1.3" stroke-linecap="round"/>' +
      '<circle cx="0" cy="-32" r="13" fill="url(#' + gr + ')" ' + HS + '/><path d="M-12.6 -30 Q0 -25 12.6 -30" fill="none" stroke="' + shade(m, -0.4) + '" stroke-width="1.4"/>' +
      '<path d="M-7 -40 Q-4 -44 2 -44" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>');
  };
  // Бабушкин тапок (легенда) — в профиль: плоская подошва, пушистый розовый
  // верх над носком, белый помпон, открытая пятка. Держат за пятку, носок
  // смотрит вверх — вот-вот прилетит. Линии замаха у носка.
  T.slipper = function (c) {
    var p = c0(c, 0, '#ff8fb1'), w = c0(c, 1, '#ffffff'), fur = '';
    for (var i = 0; i < 6; i++) fur += '<path d="M' + (26 + i * 6) + ' ' + (-6 - Math.sin(i / 5 * Math.PI) * 10).toFixed(1) + ' q2 -3 4 0" fill="none" stroke="' + shade(p, 0.3) + '" stroke-width="1.4"/>';
    return hold('<path d="M-6 2 Q-8 -4 -2 -5 L52 -8 Q66 -8 66 0 Q66 8 52 8 L-2 8 Q-8 8 -6 2Z" fill="#d9b48c" ' + HS + '/>' +
      '<path d="M-2 3 L56 1" stroke="' + shade('#d9b48c', -0.25) + '" stroke-width="1.2" stroke-dasharray="3 2"/>' +
      '<path d="M-4 -2 Q4 -8 20 -6 Q24 -22 44 -24 Q64 -22 64 -4 Q40 -2 -4 -2Z" fill="' + p + '" ' + HS + '/>' +
      '<path d="M22 -6 Q26 -18 44 -20 Q58 -18 60 -6" fill="none" stroke="' + w + '" stroke-width="3.2" stroke-linecap="round" opacity=".9"/>' + fur +
      '<circle cx="46" cy="-24" r="7" fill="' + w + '" stroke="' + OUT + '" stroke-width="1.8"/><path d="M42 -26 q4 -3 8 1 M42 -22 q4 3 8 -1" stroke="#e6e6ec" stroke-width="1.1" fill="none"/>' +
      '<g class="it-twinkle"><path d="M70 -16 l7 -4 M72 -6 l8 0 M70 4 l7 4" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/></g>');
  };
  // Семечки в бумажном кульке: газетный кулёк, сверху горка семечек, пара летит.
  T.seeds = function (c) {
    var b = c0(c, 0, '#e8dcc0'), s = '';
    [[-6, -34], [0, -37], [6, -34], [-3, -31], [3, -31], [-9, -30], [9, -30]].forEach(function (q, i) {
      s += '<ellipse cx="' + q[0] + '" cy="' + q[1] + '" rx="2" ry="3.4" transform="rotate(' + (i * 37 % 60 - 30) + ' ' + q[0] + ' ' + q[1] + ')" fill="#2b2233"/><path d="M' + (q[0] - 0.4) + ' ' + (q[1] - 2) + ' v3" stroke="#f4f1e6" stroke-width=".6"/>';
    });
    return hold('<path d="M-13 -30 L0 6 L13 -30Z" fill="' + b + '" ' + HS + '/>' +
      '<path d="M-8 -24 h14 M-6 -18 h11 M-4 -12 h8" stroke="#9aa3ad" stroke-width="1.1"/><path d="M-10 -28 h8" stroke="#2b2233" stroke-width="2"/>' + s +
      '<ellipse class="it-float" cx="16" cy="-44" rx="1.8" ry="3" fill="#2b2233" transform="rotate(30 16 -44)"/>');
  };
  // Пакет с пакетами: белый полупрозрачный пакет-майка, внутри скомканные пакеты,
  // из горловины торчат уголки, на боку — полосы. Висит, ручки — в лапе.
  T.bagofbags = function (c) {
    var bag = c0(c, 0, '#f4f4f8'), st = c0(c, 1, '#ef4444');
    return hold('<path d="M-9 0 C-12 -6 -12 -12 -7 -12 C-3 -12 -3 -6 -5 0 M9 0 C12 -6 12 -12 7 -12 C3 -12 3 -6 5 0" fill="none" stroke="' + OUT + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M-9 0 C-12 -6 -12 -12 -7 -12 C-3 -12 -3 -6 -5 0 M9 0 C12 -6 12 -12 7 -12 C3 -12 3 -6 5 0" fill="none" stroke="' + bag + '" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M-12 2 Q-16 22 -14 40 Q0 46 14 40 Q16 22 12 2 Q0 6 -12 2Z" fill="' + bag + '" ' + HS + ' opacity=".96"/>' +
      '<path d="M-6 4 L-2 -4 L2 3 M3 3 L7 -5 L9 4" fill="#fff6d6" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<path d="M-10 14 Q0 18 10 14 M-11 20 Q0 24 11 20" stroke="' + st + '" stroke-width="2.2" fill="none"/>' +
      '<path d="M-6 28 q4 -4 8 0 q4 4 6 -1 M-8 34 q5 -3 9 1" stroke="#c9ced6" stroke-width="1.4" fill="none"/>' +
      '<path d="M-10 8 Q-12 24 -10 36" stroke="#fff" stroke-width="2" opacity=".8" fill="none"/>');
  };
  // Шпаргалка: бумажная гармошка, крохотные строчки, край торчит из рукава.
  T.cheatsheet = function (c) {
    var p = c0(c, 0, '#ffffff'), t = c0(c, 1, '#3b82f6'), s = '';
    for (var i = 0; i < 5; i++) {
      var y = -8 - i * 8, x = i % 2 ? 2 : -2;
      s += '<path d="M' + (x - 11) + ' ' + y + ' L' + (x + 11) + ' ' + y + ' L' + (-x + 11) + ' ' + (y - 8) + ' L' + (-x - 11) + ' ' + (y - 8) + 'Z" fill="' + (i % 2 ? p : shade(p, -0.08)) + '" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M' + (x - 8) + ' ' + (y - 3) + ' h7 M' + (x + 1) + ' ' + (y - 3) + ' h6 M' + (x - 8) + ' ' + (y - 5.5) + ' h12" stroke="' + t + '" stroke-width=".9"/>';
    }
    return hold(s + '<path d="M-12 -2 Q0 4 12 -2 L10 6 Q0 10 -10 6Z" fill="#2f63c9" stroke="' + OUT + '" stroke-width="1.6"/>');
  };
  // Калькулятор «Электроника»: серый корпус, зелёный ЖК-экран, ряды клавиш.
  T.calculator = function (c) {
    var body = c0(c, 0, '#4b5563'), key = c0(c, 1, '#f4f1e6'), keys = '';
    for (var r = 0; r < 4; r++) for (var i = 0; i < 4; i++) keys += '<rect x="' + (-12 + i * 6.4) + '" y="' + (-24 + r * 6) + '" width="4.8" height="4.2" rx="1" fill="' + (i === 3 ? '#f97316' : key) + '" stroke="' + OUT + '" stroke-width=".6"/>';
    return hold('<rect x="-15" y="-50" width="30" height="52" rx="4" fill="' + body + '" ' + HS + '/>' +
      '<rect x="-12" y="-46" width="24" height="12" rx="1.5" fill="#9bbf8a" stroke="' + OUT + '" stroke-width="1.2"/>' +
      '<text x="10" y="-37" text-anchor="end" font-size="8" font-weight="700" fill="#1f3a1a" font-family="Courier New, monospace" textLength="19" lengthAdjust="spacingAndGlyphs">1945</text>' +
      '<text x="0" y="-27.6" text-anchor="middle" font-size="3.6" font-weight="700" fill="#c9ced6" font-family="Arial, sans-serif" textLength="22" lengthAdjust="spacingAndGlyphs">ЭЛЕКТРОНИКА</text>' + keys);
  };
  // Шаурма: лаваш в фольге, сверху видна начинка — капуста, томат, мясо, соус.
  T.shawarma = function (c) {
    var lav = c0(c, 0, '#e8c48a'), foil = c0(c, 1, '#c9ced6');
    return hold('<path d="M-10 -40 C-12 -46 12 -48 12 -40 L10 6 Q0 10 -10 6Z" fill="' + lav + '" ' + HS + '/>' +
      '<path d="M-9 -44 q4 -6 8 -2 q4 -6 8 0 q3 -2 4 2" fill="#7fc36b" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<circle cx="-3" cy="-42" r="2.6" fill="#e0341a" stroke="' + OUT + '" stroke-width="1"/><path d="M2 -44 l6 1 -2 3Z" fill="#8a4b12" stroke="' + OUT + '" stroke-width="1"/>' +
      '<path d="M-6 -40 q6 3 12 -1" stroke="#fff6e0" stroke-width="2.4" fill="none"/>' +
      '<path d="M-11 -18 L11 -22 L10 6 Q0 10 -10 6Z" fill="' + foil + '" ' + HS + '/>' +
      '<path d="M-8 -14 l6 3 M0 -16 l6 4 M-6 -4 l8 2" stroke="#fff" stroke-width="1.2"/><path d="M-6 -30 q3 2 6 0" stroke="#c9a07a" stroke-width="1.2" fill="none"/>');
  };
  // Кружка «Лучший историк»: держат за ручку (она в лапе), надпись в две
  // строки подогнана по ширине кружки — не вылезает ни в одном шрифте.
  T.mughist = function (c) {
    var m = c0(c, 0, '#ffffff'), t = c0(c, 1, '#b3262d');
    return hold('<path d="M-6 -10 q12 0 12 10 q0 10 -12 10" fill="none" stroke="' + OUT + '" stroke-width="6.4"/><path d="M-6 -10 q12 0 12 10 q0 10 -12 10" fill="none" stroke="' + m + '" stroke-width="3.2"/>' +
      '<path d="M-32 -20 L-31 18 Q-19 23 -7 18 L-6 -20Z" fill="' + m + '" ' + HS + '/>' +
      '<ellipse cx="-19" cy="-20" rx="13" ry="3.4" fill="#6b3f22" stroke="' + OUT + '" stroke-width="1.6"/>' +
      '<text x="-19" y="-4" text-anchor="middle" font-size="6" font-weight="900" fill="' + t + '" font-family="Arial, sans-serif" textLength="20" lengthAdjust="spacingAndGlyphs">ЛУЧШИЙ</text>' +
      '<text x="-19" y="5" text-anchor="middle" font-size="6" font-weight="900" fill="' + t + '" font-family="Arial, sans-serif" textLength="21" lengthAdjust="spacingAndGlyphs">ИСТОРИК</text>' +
      '<path d="M-24 10 l5 4 5 -4" stroke="' + t + '" stroke-width="1.4" fill="none"/>' +
      '<path d="M-28 -14 V12" stroke="#fff" stroke-width="2" opacity=".6"/>' +
      '<g class="it-steam"><path d="M-23 -26 q-3 -5 0 -9 q3 -4 0 -8 M-14 -27 q-3 -5 0 -9" fill="none" stroke="#c9ced6" stroke-width="2" stroke-linecap="round"/></g>');
  };
  // Бинты: намотаны на кисть и запястье, свободный конец развевается.
  T.bandage = function (c) {
    var b = c0(c, 0, '#f4f1e6');
    return hold('<path d="M-9 -12 Q0 -16 9 -12 L9 -8 Q0 -12 -9 -8Z M-9 -4 Q0 -8 9 -4 L9 0 Q0 -4 -9 0Z M-8 4 Q0 0 8 4 L7 8 Q0 4 -7 8Z" fill="' + b + '" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>' +
      '<g class="it-wave"><path d="M8 -10 Q20 -8 24 -2 Q28 4 34 4 L33 8 Q26 8 22 2 Q18 -4 8 -6Z" fill="' + b + '" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/></g>' +
      '<path d="M-6 -10 l2 2 M2 -2 l2 2 M-3 6 l2 1" stroke="#c9b28a" stroke-width="1"/>');
  };
  // Бензопила: корпус с рукоятью (она в лапе), шина с цепью вперёд-вверх,
  // выхлоп дымит; во время «газа» (act-rev) всё трясётся.
  T.chainsaw = function (c) {
    var o = c0(c, 0, '#f08a24'), m = c0(c, 1, '#c3cad2'), teeth = '';
    for (var i = 0; i < 9; i++) teeth += '<path d="M' + (16 + i * 5) + ' -17 l2 -3 2 3" fill="none" stroke="' + OUT + '" stroke-width="1"/>';
    return hold('<g class="cs-saw">' +
      '<g class="cs-smoke"><circle cx="-16" cy="-22" r="3" fill="#b8bec6" opacity=".7"/><circle cx="-20" cy="-28" r="2.2" fill="#c9ced6" opacity=".6"/></g>' +
      '<path d="M-4 -6 Q-8 4 0 8 Q8 6 6 -4" fill="none" stroke="' + OUT + '" stroke-width="5"/><path d="M-4 -6 Q-8 4 0 8 Q8 6 6 -4" fill="none" stroke="#2b2233" stroke-width="2.6"/>' +
      '<path d="M-12 -26 L14 -26 L16 -8 L-10 -6 Q-16 -14 -12 -26Z" fill="' + o + '" ' + HS + '/>' +
      '<rect x="-8" y="-22" width="14" height="6" rx="1.5" fill="#1b1b1f"/><text x="-1" y="-17.6" text-anchor="middle" font-size="4" font-weight="900" fill="' + o + '" font-family="Arial, sans-serif" textLength="11" lengthAdjust="spacingAndGlyphs">ЗВЕРЬ</text>' +
      '<path d="M14 -24 L62 -30 Q68 -24 62 -18 L14 -12Z" fill="' + m + '" ' + HS + '/>' +
      '<g class="cs-chain">' + teeth + '</g><path d="M18 -18 L58 -24" stroke="#9aa3ad" stroke-width="1.2"/>' +
      '<path d="M-10 -28 Q-2 -34 10 -28" fill="none" stroke="#2b2233" stroke-width="3" stroke-linecap="round"/></g>');
  };
  // Синий огонь (миф) — прямо на ладони: свечение, три языка пламени, ядро, искры.
  T.bluefire = function (c) {
    var blue = c0(c, 0, '#3b82f6'), core = c0(c, 1, '#bfe3ff');
    return hold('<g class="it-mythic"><ellipse cx="0" cy="-2" rx="14" ry="4" fill="' + core + '" opacity=".75"/>' +
      '<path class="it-flicker" d="M-12 -2 Q-18 -22 -8 -36 Q-6 -26 -2 -26 Q-4 -44 6 -56 Q8 -38 14 -32 Q20 -22 14 -8 Q10 0 0 0 Q-8 0 -12 -2Z" fill="' + blue + '" ' + HS + '/>' +
      '<path class="it-flicker" style="animation-delay:.25s" d="M-7 -3 Q-11 -16 -4 -24 Q-2 -16 2 -17 Q2 -28 8 -36 Q10 -22 12 -16 Q14 -6 6 -2 Q-2 0 -7 -3Z" fill="' + core + '"/>' +
      '<path d="M-2 -6 Q0 -12 4 -12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>' +
      '<circle class="it-twinkle" cx="14" cy="-50" r="2" fill="' + core + '"/><circle class="it-twinkle" style="animation-delay:.5s" cx="-14" cy="-38" r="1.6" fill="' + core + '"/></g>');
  };

  // ── Спутники v2 (28.09.2026): крупнее, с характером, узнаваемые силуэты ──
  // Стоят слева от питомца и смотрят на него (вправо), земля — y 190.
  function bEye(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + OUT + '"/><circle cx="' + (x + r * 0.35).toFixed(1) + '" cy="' + (y - r * 0.4).toFixed(1) + '" r="' + (r * 0.38).toFixed(1) + '" fill="#fff"/><circle cx="' + (x - r * 0.35).toFixed(1) + '" cy="' + (y + r * 0.35).toFixed(1) + '" r="' + (r * 0.16).toFixed(1) + '" fill="#fff" opacity=".8"/>';
  }
  var BS = 'stroke="' + OUT + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
  // Воробей: пухлый комок, спинка в полоску, серая шапочка, чёрная манишка.
  T.c_bird = function (c) {
    var b = c0(c, 0, '#8a6a44'), l = c0(c, 1, '#d9c6a5');
    return buddy('<path d="M14 170 L2 160 L6 172Z" fill="' + shade(b, -0.2) + '" ' + BS + '/>' +
      '<path d="M26 188 l-2 4 M26 188 l2 4 M36 188 l-2 4 M36 188 l2 4" stroke="#c98a4a" stroke-width="1.8"/>' +
      '<ellipse cx="32" cy="174" rx="20" ry="16" fill="' + l + '" ' + BS + '/>' +
      '<path d="M12 172 Q18 156 34 156 Q44 158 44 168 Q32 164 20 176Z" fill="' + b + '" ' + BS + '/>' +
      '<path d="M18 168 l6 -3 M22 172 l6 -3 M28 164 l5 -2" stroke="' + shade(b, -0.35) + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="46" cy="160" r="12" fill="' + l + '" ' + BS + '/><path d="M36 154 Q44 146 54 152 Q50 150 46 154 Q40 152 36 154Z" fill="#8f949c" ' + BS + '/>' +
      '<path d="M44 168 Q48 174 54 168 Q52 176 46 176Z" fill="' + OUT + '"/>' + bEye(50, 158, 2.4) +
      '<path d="M57 159 L64 161 L57 164Z" fill="#6b5a3a" stroke="' + OUT + '" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<ellipse cx="40" cy="162" rx="3.4" ry="2" fill="#f4a6a0" opacity=".45"/>');
  };
  // Ворон-летописец: крупный, с сине-фиолетовым отливом, круглые очки на
  // клюве и свиток под крылом.
  T.c_raven = function (c) {
    var b = c0(c, 0, '#23232a'), sh = c0(c, 1, '#4a4a58');
    return buddy('<path d="M10 172 L-2 186 L14 182 L20 186Z" fill="' + b + '" ' + BS + '/>' +
      '<path d="M30 186 l-3 5 M30 186 l1 5 M40 186 l-2 5 M40 186 l2 5" stroke="#4a4a58" stroke-width="2"/>' +
      '<path d="M12 170 Q14 146 38 144 Q54 146 54 166 Q52 186 34 188 Q16 186 12 170Z" fill="' + b + '" ' + BS + '/>' +
      '<path d="M18 160 Q28 150 40 152" stroke="#6d5cff" stroke-width="2.4" fill="none" opacity=".45"/>' +
      '<g transform="rotate(-18 28 176)"><rect x="16" y="170" width="24" height="10" rx="4" fill="#f3e6c4" stroke="' + OUT + '" stroke-width="1.6"/><path d="M20 175 h12" stroke="#8a6a44" stroke-width="1"/><circle cx="16" cy="175" r="4.4" fill="#d9c28e" stroke="' + OUT + '" stroke-width="1.4"/></g>' +
      '<path d="M16 168 Q28 176 42 170 Q34 182 20 180Z" fill="' + sh + '" ' + BS + '/>' +
      '<circle cx="46" cy="140" r="14" fill="' + b + '" ' + BS + '/>' +
      '<path d="M56 136 L72 142 L56 148 Q54 142 56 136Z" fill="#2b2b33" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/><path d="M58 140 L68 142" stroke="#6b6b7a" stroke-width="1"/>' +
      bEye(50, 137, 2.6) + '<circle cx="50" cy="137" r="5.6" fill="none" stroke="#e9c46a" stroke-width="1.6"/><path d="M55.6 137 h3" stroke="#e9c46a" stroke-width="1.4"/>' +
      '<path d="M36 128 q4 -6 10 -4" stroke="#6d5cff" stroke-width="2" fill="none" opacity=".4"/>');
  };
  // Царевна-лягушка: сидит, большие глаза, золотая корона и стрела во рту.
  T.c_frog = function (c) {
    var g = c0(c, 0, '#5bb04a'), gold = c0(c, 1, '#e9c46a');
    return buddy('<path d="M10 188 Q4 176 14 170 Q22 180 24 190Z M58 188 Q66 178 58 170 Q50 180 48 190Z" fill="' + shade(g, -0.12) + '" ' + BS + '/>' +
      '<ellipse cx="36" cy="176" rx="24" ry="15" fill="' + g + '" ' + BS + '/>' +
      '<ellipse cx="36" cy="182" rx="15" ry="8" fill="#e8f3c4"/>' +
      '<circle cx="24" cy="176" r="2.4" fill="' + shade(g, -0.3) + '"/><circle cx="46" cy="172" r="2" fill="' + shade(g, -0.3) + '"/><circle cx="30" cy="170" r="1.6" fill="' + shade(g, -0.3) + '"/>' +
      '<circle cx="24" cy="160" r="9" fill="' + g + '" ' + BS + '/><circle cx="48" cy="160" r="9" fill="' + g + '" ' + BS + '/>' +
      '<circle cx="24" cy="160" r="6" fill="#fff"/><circle cx="48" cy="160" r="6" fill="#fff"/>' + bEye(25.5, 160.5, 3.4) + bEye(49.5, 160.5, 3.4) +
      '<path d="M28 150 L30 142 L33 147 L36 140 L39 147 L42 142 L44 150Z" fill="' + gold + '" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/><circle cx="36" cy="146" r="1.4" fill="#c0392b"/>' +
      '<path d="M26 174 Q36 180 46 174" fill="none" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M4 172 L72 170" stroke="' + OUT + '" stroke-width="3" stroke-linecap="round"/><path d="M4 172 L72 170" stroke="#c79a5b" stroke-width="1.6"/>' +
      '<path d="M72 170 l-6 -4 v8Z" fill="#9aa3ad" stroke="' + OUT + '" stroke-width="1.2"/><path d="M4 172 l-4 -4 M4 172 l-4 4" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round"/>' +
      '<ellipse cx="18" cy="166" rx="3" ry="1.8" fill="#ff8fa3" opacity=".5"/><ellipse cx="54" cy="166" rx="3" ry="1.8" fill="#ff8fa3" opacity=".5"/>');
  };
  // Медвежонок: сидит, светлая мордочка и животик, лапы держат горшок мёда.
  T.c_bear = function (c) {
    var f = c0(c, 0, '#8a5a2b'), l = c0(c, 1, '#d9b48a');
    return buddy('<ellipse cx="18" cy="184" rx="9" ry="7" fill="' + f + '" ' + BS + '/><ellipse cx="52" cy="184" rx="9" ry="7" fill="' + f + '" ' + BS + '/>' +
      '<ellipse cx="18" cy="186" rx="5" ry="3.6" fill="' + l + '"/><ellipse cx="52" cy="186" rx="5" ry="3.6" fill="' + l + '"/>' +
      '<ellipse cx="35" cy="170" rx="20" ry="18" fill="' + f + '" ' + BS + '/><ellipse cx="35" cy="174" rx="12" ry="12" fill="' + l + '"/>' +
      '<path d="M26 174 Q26 186 35 188 Q44 186 44 174Z" fill="#e0a458" ' + BS + '/><path d="M26 174 H44" stroke="' + OUT + '" stroke-width="2"/><path d="M28 174 q6 -6 12 0" fill="#ffd23f" stroke="' + OUT + '" stroke-width="1.4"/>' +
      '<path d="M40 176 q2 6 0 9" stroke="#ffd23f" stroke-width="2.4" stroke-linecap="round"/>' +
      '<ellipse cx="22" cy="176" rx="6" ry="8" fill="' + f + '" ' + BS + ' transform="rotate(30 22 176)"/><ellipse cx="48" cy="176" rx="6" ry="8" fill="' + f + '" ' + BS + ' transform="rotate(-30 48 176)"/>' +
      '<circle cx="22" cy="138" r="6" fill="' + f + '" ' + BS + '/><circle cx="48" cy="138" r="6" fill="' + f + '" ' + BS + '/><circle cx="22" cy="138" r="3" fill="' + l + '"/><circle cx="48" cy="138" r="3" fill="' + l + '"/>' +
      '<circle cx="35" cy="148" r="15" fill="' + f + '" ' + BS + '/><ellipse cx="37" cy="154" rx="8" ry="6" fill="' + l + '" ' + BS + '/>' +
      '<ellipse cx="37" cy="151" rx="3" ry="2.2" fill="' + OUT + '"/><path d="M37 153 v3 M34 157 q3 2 6 0" stroke="' + OUT + '" stroke-width="1.4" fill="none"/>' +
      bEye(29, 145, 2.2) + bEye(43, 145, 2.2) + '<ellipse cx="25" cy="151" rx="3" ry="1.8" fill="#ff8fa3" opacity=".4"/>');
  };
  // Лайка Белка (1960): белая пушистая с тёмными ушками, в красном скафандре
  // и прозрачном шлеме с бликом.
  T.c_dog = function (c) {
    var w = c0(c, 0, '#f4f4f4'), t = c0(c, 1, '#d0a060');
    return buddy('<path d="M10 176 Q2 170 6 160 Q12 168 16 170Z" fill="' + w + '" ' + BS + '/>' +
      '<path d="M22 186 v4 M30 186 v4 M42 186 v4 M50 186 v4" stroke="' + OUT + '" stroke-width="5" stroke-linecap="round"/><path d="M22 186 v4 M30 186 v4 M42 186 v4 M50 186 v4" stroke="' + w + '" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="36" cy="176" rx="22" ry="12" fill="#e0341a" ' + BS + '/>' +
      '<path d="M22 170 h28 M20 178 h32" stroke="#fff" stroke-width="1.6" opacity=".7"/><rect x="32" y="170" width="8" height="8" rx="1.5" fill="#dfe6ee" stroke="' + OUT + '" stroke-width="1.2"/><text x="36" y="176.6" text-anchor="middle" font-size="5" font-weight="900" fill="#e0341a" font-family="Arial, sans-serif" textLength="7" lengthAdjust="spacingAndGlyphs">СССР</text>' +
      '<circle cx="54" cy="156" r="14" fill="' + w + '" ' + BS + '/>' +
      '<path d="M44 148 L42 134 L52 144Z M58 144 L64 132 L66 148Z" fill="' + t + '" ' + BS + '/>' +
      '<ellipse cx="62" cy="160" rx="7" ry="5" fill="' + w + '" ' + BS + '/><ellipse cx="68" cy="158" rx="2.6" ry="2" fill="' + OUT + '"/><path d="M62 164 q3 2 6 0" stroke="' + OUT + '" stroke-width="1.4" fill="none"/>' +
      '<ellipse cx="52" cy="152" rx="5" ry="4" fill="' + t + '" opacity=".35"/>' + bEye(54, 152, 2.4) +
      '<circle cx="55" cy="154" r="19" fill="#bfe3ff" fill-opacity=".22" stroke="#dfe6ee" stroke-width="2.2"/><path d="M44 142 Q50 136 58 137" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".85"/>' +
      '<path d="M40 168 Q55 176 70 166" fill="none" stroke="#dfe6ee" stroke-width="4" stroke-linecap="round"/>');
  };
  // Кот Баюн: большой дымчатый, пушистый, прищур сказочника, на шее — златая
  // цепь, над головой нота (поёт-сказывает).
  T.c_cat = function (c) {
    var f = c0(c, 0, '#6b6b7a'), g = c0(c, 1, '#e9c46a'), links = '';
    for (var i = 0; i < 7; i++) links += '<ellipse cx="' + (24 + i * 4.6).toFixed(1) + '" cy="' + (160 + Math.sin(i / 6 * Math.PI) * 5).toFixed(1) + '" rx="2.6" ry="1.8" fill="none" stroke="' + g + '" stroke-width="1.6"/>';
    return buddy('<path d="M14 182 Q-4 178 2 156 Q6 146 12 152 Q8 166 20 176Z" fill="' + f + '" ' + BS + '/>' +
      '<ellipse cx="38" cy="174" rx="22" ry="16" fill="' + f + '" ' + BS + '/>' +
      '<path d="M22 188 q4 -6 8 0 M44 188 q4 -6 8 0" fill="' + shade(f, 0.2) + '" ' + BS + '/>' +
      '<path d="M26 168 l6 4 M26 176 l6 2 M50 168 l-6 4" stroke="' + shade(f, -0.3) + '" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="40" cy="146" r="16" fill="' + f + '" ' + BS + '/>' +
      '<path d="M26 138 L24 120 L36 132Z M44 132 L56 120 L54 138Z" fill="' + f + '" ' + BS + '/><path d="M28 134 L27 125 L33 131Z M47 131 L53 125 L52 134Z" fill="#f4a6a0"/>' +
      '<ellipse cx="42" cy="152" rx="9" ry="6" fill="' + shade(f, 0.35) + '"/>' +
      '<path d="M30 146 q4 -3 8 0 M44 146 q4 -3 8 0" stroke="' + OUT + '" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      '<path d="M40 150 l2 2 2 -2Z" fill="#f28ca0" stroke="' + OUT + '" stroke-width="1"/><path d="M42 152 q-2 3 -5 2 M42 152 q2 3 5 2" stroke="' + OUT + '" stroke-width="1.2" fill="none"/>' +
      '<path d="M30 152 l-10 -2 M30 155 l-10 2 M54 152 l10 -2 M54 155 l10 2" stroke="' + OUT + '" stroke-width="1" opacity=".7"/>' +
      links + '<circle cx="38" cy="166" r="3" fill="' + g + '" stroke="' + OUT + '" stroke-width="1"/>' +
      '<g class="it-float"><path d="M58 122 v-10 l8 -2 v10" stroke="' + OUT + '" stroke-width="1.8" fill="none"/><ellipse cx="56" cy="122" rx="3" ry="2.2" fill="' + OUT + '"/><ellipse cx="64" cy="120" rx="3" ry="2.2" fill="' + OUT + '"/></g>');
  };
  // Капибара (мем): спокойное «кирпичное» тело, сонная улыбка, мандаринка
  // с листиком на макушке — невозмутимость.
  T.c_capybara = function (c) {
    var f = c0(c, 0, '#9c6b3f'), o = c0(c, 1, '#f59e0b');
    return buddy('<path d="M16 186 v4 M24 186 v4 M46 186 v4 M54 186 v4" stroke="' + OUT + '" stroke-width="6" stroke-linecap="round"/><path d="M16 186 v4 M24 186 v4 M46 186 v4 M54 186 v4" stroke="' + shade(f, -0.2) + '" stroke-width="3.6" stroke-linecap="round"/>' +
      '<path d="M8 170 Q8 154 30 154 L52 152 Q70 152 70 168 Q70 186 50 188 L22 188 Q8 186 8 170Z" fill="' + f + '" ' + BS + '/>' +
      '<path d="M14 166 q4 -3 8 0 M20 176 q4 -3 8 0 M30 162 q4 -3 8 0" stroke="' + shade(f, -0.22) + '" stroke-width="1.4" fill="none"/>' +
      '<path d="M46 154 Q48 136 60 136 Q74 138 74 152 L74 162 Q70 166 64 164 L50 164Z" fill="' + f + '" ' + BS + '/>' +
      '<ellipse cx="52" cy="138" rx="3.4" ry="2.6" fill="' + shade(f, -0.2) + '" ' + BS + '/>' +
      '<path d="M58 146 q3 2 6 0" stroke="' + OUT + '" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="72" cy="152" rx="2" ry="1.6" fill="' + OUT + '"/><path d="M66 160 q4 2 8 0" stroke="' + OUT + '" stroke-width="1.4" fill="none"/>' +
      '<ellipse cx="64" cy="152" rx="3" ry="1.8" fill="#ff8fa3" opacity=".35"/>' +
      '<circle cx="60" cy="128" r="7" fill="' + o + '" ' + BS + '/><path d="M60 121 q4 -5 8 -3 q-3 4 -8 3Z" fill="#5bb04a" stroke="' + OUT + '" stroke-width="1.2"/><circle cx="57" cy="126" r="1.6" fill="#fff" opacity=".6"/>');
  };
  // Гусь-работяга: белый, оранжевый клюв и лапы, жёлтая каска, гаечный ключ под крылом.
  T.c_goose = function (c) {
    var w = c0(c, 0, '#f4f4f6'), h = c0(c, 1, '#f2b705');
    return buddy('<path d="M28 184 l-6 6 h10Z M40 184 l-4 6 h10Z" fill="#f08a24" stroke="' + OUT + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M6 170 L0 162 L12 166Z" fill="' + w + '" ' + BS + '/>' +
      '<path d="M8 170 Q10 156 30 156 Q50 158 52 172 Q50 186 32 186 Q12 186 8 170Z" fill="' + w + '" ' + BS + '/>' +
      '<path d="M16 168 Q28 162 42 170 Q30 178 18 176Z" fill="' + shade(w, -0.1) + '" ' + BS + '/>' +
      '<g transform="rotate(-30 30 176)"><path d="M16 176 H40" stroke="' + OUT + '" stroke-width="5" stroke-linecap="round"/><path d="M16 176 H40" stroke="#9aa3ad" stroke-width="3" stroke-linecap="round"/><path d="M40 170 a5 5 0 1 1 0 12 l-2 -3 v-6Z" fill="#9aa3ad" stroke="' + OUT + '" stroke-width="1.4"/></g>' +
      '<path d="M44 162 Q46 146 44 136 Q44 124 54 124 Q64 126 62 136 Q58 146 56 164Z" fill="' + w + '" ' + BS + '/>' +
      '<path d="M62 132 L74 136 L62 140Z" fill="#f08a24" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/>' + bEye(57, 130, 2.2) +
      '<path d="M44 124 Q54 110 64 124Z" fill="' + h + '" ' + BS + '/><path d="M40 124 H68" stroke="' + OUT + '" stroke-width="4" stroke-linecap="round"/><path d="M40 124 H68" stroke="' + h + '" stroke-width="2.2" stroke-linecap="round"/><path d="M54 112 V124" stroke="' + shade(h, -0.25) + '" stroke-width="1.6"/>');
  };
  // Кот-пельмень (мем): белый «пельмень» с защипом по спинке, ушки, круглые
  // глазки, ротик-«w», пар над ним — только что сварили.
  T.c_dumpling = function (c) {
    var d = c0(c, 0, '#f7f1e3'), pinch = '';
    for (var i = 0; i < 8; i++) { var a = Math.PI + i / 7 * Math.PI, x = 36 + Math.cos(a) * 28, y = 184 + Math.sin(a) * 26; pinch += '<path d="M' + x.toFixed(1) + ' ' + y.toFixed(1) + ' l' + (Math.cos(a) * 4).toFixed(1) + ' ' + (Math.sin(a) * 4).toFixed(1) + '" stroke="' + shade(d, -0.2) + '" stroke-width="2" stroke-linecap="round"/>'; }
    return buddy('<path d="M6 188 Q4 156 36 156 Q68 156 66 188Z" fill="' + d + '" ' + BS + '/>' + pinch +
      '<path d="M14 162 L14 148 L24 158Z M58 162 L58 148 L48 158Z" fill="' + d + '" ' + BS + '/><path d="M16 158 L16 152 L20 156Z M56 158 L56 152 L52 156Z" fill="#f4a6a0"/>' +
      '<path d="M12 180 Q36 186 60 180" stroke="' + shade(d, -0.12) + '" stroke-width="2" fill="none"/>' +
      bEye(28, 172, 2.6) + bEye(44, 172, 2.6) +
      '<path d="M32 178 q2 3 4 0 q2 3 4 0" stroke="' + OUT + '" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="22" cy="178" rx="3" ry="1.8" fill="#ff8fa3" opacity=".5"/><ellipse cx="50" cy="178" rx="3" ry="1.8" fill="#ff8fa3" opacity=".5"/>' +
      '<g class="it-steam"><path d="M28 150 q-3 -5 0 -9 q3 -4 0 -8 M40 148 q-3 -5 0 -9" fill="none" stroke="#c9ced6" stroke-width="2" stroke-linecap="round"/></g>');
  };
  // Голубь-курлык: серый, радужная шейка, оранжевый глаз, красные лапки, грудь колесом.
  T.c_pigeon = function (c) {
    var g = c0(c, 0, '#9aa3ad'), n = c0(c, 1, '#5bb04a');
    return buddy('<path d="M28 184 l-3 6 M28 184 l3 6 M38 184 l-3 6 M38 184 l3 6" stroke="#e05a5a" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M4 168 L-2 162 L0 174Z" fill="' + shade(g, -0.25) + '" ' + BS + '/>' +
      '<path d="M6 168 Q10 154 30 154 Q54 154 56 170 Q52 186 32 186 Q12 186 6 168Z" fill="' + g + '" ' + BS + '/>' +
      '<path d="M14 166 Q28 158 40 166 Q30 176 16 174Z" fill="' + shade(g, -0.15) + '" ' + BS + '/><path d="M20 166 h10 M20 170 h12" stroke="' + OUT + '" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M40 162 Q42 146 50 142 Q58 146 58 160Z" fill="' + n + '" ' + BS + '/><path d="M44 154 Q50 150 56 156" stroke="#a855f7" stroke-width="3" fill="none" opacity=".7"/>' +
      '<circle cx="50" cy="138" r="10" fill="' + g + '" ' + BS + '/>' +
      '<circle cx="53" cy="136" r="3" fill="#f59e0b" stroke="' + OUT + '" stroke-width="1"/><circle cx="53.4" cy="136" r="1.5" fill="' + OUT + '"/>' +
      '<path d="M59 138 L66 140 L59 142Z" fill="#6b6b7a" stroke="' + OUT + '" stroke-width="1.2" stroke-linejoin="round"/><circle cx="58.6" cy="137.6" r="1.6" fill="#fff" stroke="' + OUT + '" stroke-width=".8"/>');
  };
  // Таракан-сосед: блестящий рыжий, длинные усы-антенны шевелятся, шесть
  // лапок, глаза навыкате и маленькая кружка чая — зашёл по-соседски.
  T.c_roach = function (c) {
    var b = c0(c, 0, '#7a4a24');
    return buddy('<path d="M18 180 l-8 8 M26 182 l-4 8 M40 182 l4 8 M48 180 l8 8 M22 174 l-10 2 M44 174 l10 2" stroke="' + OUT + '" stroke-width="2" stroke-linecap="round"/>' +
      '<ellipse cx="33" cy="174" rx="20" ry="11" fill="' + b + '" ' + BS + '/>' +
      '<path d="M33 164 V184" stroke="' + shade(b, -0.35) + '" stroke-width="1.6"/><path d="M20 168 Q26 164 30 166" stroke="#fff" stroke-width="2" fill="none" opacity=".45"/>' +
      '<ellipse cx="55" cy="170" rx="9" ry="8" fill="' + shade(b, -0.1) + '" ' + BS + '/>' +
      '<circle cx="57" cy="166" r="3.4" fill="#fff" stroke="' + OUT + '" stroke-width="1.2"/><circle cx="58" cy="166" r="1.8" fill="' + OUT + '"/>' +
      '<path d="M60 174 q3 1 5 -1" stroke="' + OUT + '" stroke-width="1.4" fill="none"/>' +
      '<g class="rc-ant"><path d="M58 162 Q64 140 76 134 M54 162 Q54 142 62 132" stroke="' + OUT + '" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>' +
      '<path d="M62 176 h7 v6 q-3.5 3 -7 0Z" fill="#fff" stroke="' + OUT + '" stroke-width="1.4" stroke-linejoin="round"/><path d="M69 177 q3 1 0 4" stroke="' + OUT + '" stroke-width="1.2" fill="none"/>');
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
      if(!fn)return '';
      var drawing=fn(art.c||[]);
      if(slot==='head')drawing=fitHeadArt(drawing,art.t,sp,stage,art.c);
      if(slot==='face')drawing=fitFaceArt(drawing,art.t,sp,stage);
      return '<g class="slot-'+slot+' r-'+items[id].rarity+'">'+drawing+'</g>';
    }
    // Часть вещи за спиной (шлейф мантии, плащ до земли, пламя сзади): шаблон
    // T[t + '_back'] в координатах малыша. Для взрослых обликов и людей его
    // растягивает V3_BACK_T — от плеч до земли, а не до пояса, как одежда.
    function back(slot, t) {
      var id = eq[slot]; if (!id || !items[id]) return '';
      var art = items[id].art || {}; var fn = T[art.t + '_back'];
      if (!fn) return '';
      var g = '<g class="slot-' + slot + '-back r-' + items[id].rarity + '">' + fn(art.c || []) + '</g>';
      return t ? '<g transform="' + t + '">' + g + '</g>' : g;
    }
    layer.back = back;
    layer.skull = function(svg){return fitSkull(svg,items[eq.head]?.art?.t,sp);};
    layer.hold = function (anat, arm, fill, ink) { return holding(anat, arm, fill, ink, eq, items); };
    SLEEVE.fill = null;
    tailorSetup(sp,stage,eq,items);
    if (Tailor && (sp === 'squid' || TAILOR_KEEP[Tailor.kind])) Tailor = null;
    layer.clothes = function(t) { return Tailor ? tailorBody() : (t ? '<g transform="' + t + '">' + layer('body') + '</g>' : layer('body')); };
    var best = null;
    Object.keys(eq).forEach(function (slot) { var it = items[eq[slot]]; if (it && (!best || RANK_OF[it.rarity] > RANK_OF[best])) best = it.rarity; });
    var sigs = signaturesOf(eq, items);
    var mythSig = sigs.filter(function (x) { return x.tier === 'mythic'; })[0];
    var body, cls3 = '';
    if (sp === 'burunday') {
      cls3 = ' v3 human';
      body = renderBurunday(stage, state, layer, eq, state === 'sick');
    } else if (sp === 'squid') {
      cls3 = ' v3 human';
      body = renderSquid(stage, state, layer, eq, state === 'sick');
    } else if (HUMAN[sp]) {
      cls3 = ' v3 human';
      body = renderHuman(sp, stage, state, layer, eq, state === 'sick');
    } else if (stage === 'baby') {
      var k = STAGE_SCALE[stage];
      body = '<g transform="translate(100 190) scale(' + k + ') translate(-100 -190)"><g class="pet-body">' +
        back('body') + speciesBack(sp, p, stage) + speciesBody(sp, p, stage) + layer.clothes() + armL(sp, p) +
        '<g class="pet-head">' + speciesHead(sp, p, stage) + face(sp, p, state, stage) + layer('face') + layer('head') +
        (state === 'sick' ? sickHead() : '') + '</g>' +
        layer('neck') + '<g class="pet-arm-r">' + holding(sp === 'owl' ? 'babyOwl' : 'baby', armR(sp, p), sp === 'owl' ? shade(p.fur, -0.15) : p.fur, OUT, eq, items) + '</g></g></g>';
    } else {
      // Подросток и старше — взрослый облик v3; вещи садятся через привязки слотов.
      cls3 = ' v3';
      var q = V3[sp], ids = { fur: uid('v3f'), furD: uid('v3d'), belly: uid('v3b') };
      var k3 = stage === 'teen' ? 0.92 : 1;
      body = v3Defs(q, ids) + '<g transform="translate(100 190) scale(' + k3 + ') translate(-100 -190)"><g class="pet-body">' +
        back('body', V3_BACK_T) + v3Back(sp, q, ids, stage) + v3Body(sp, q, ids, stage) +
        (Tailor ? tailorBody() : eq.body ? '<defs><clipPath id="' + ids.fur + '-cl"><path d="' + V3_CLOTH + '"/><ellipse cx="68" cy="130" rx="13" ry="18"/><ellipse cx="132" cy="130" rx="13" ry="18"/></clipPath></defs>' +
          '<g clip-path="url(#' + ids.fur + '-cl)"><g transform="' + V3_BODY_T + '">' + layer('body') + '</g></g>' : '') + v3ArmL(sp, q, ids) +
        '<g transform="' + V3_NECK_T + '">' + layer('neck') + '</g>' +
        '<g class="pet-head"><g transform="' + v3HeadT(stage) + '">' + v3Head(sp, q, ids, stage) + v3Face(sp, q, state, stage) + layer('face') + layer('head') +
        (state === 'sick' ? sickHead() : '') + '</g></g>' +
        '<g class="pet-arm-r">' + holding(sp === 'owl' ? 'v3Owl' : 'v3', v3ArmR(sp, q, ids), sp === 'owl' ? shade(q.fur, -0.18) : 'url(#' + ids.fur + ')', q.ink, eq, items) + '</g></g></g>';
    }
    var bg = '';
    if (eq.bg) bg = layer('bg');
    else if (opts.scene) bg = scene(opts.scene === 'night');
    // Фон режем по рамке: у питомца overflow виден (шапки и сияние выходят за край),
    // а у фона — нет, иначе круг «Открытого космоса» вылезал бы на соседей.
    if (bg) bg = '<svg x="0" y="0" width="200" height="200" viewBox="0 0 200 200" overflow="hidden">' + bg + '</svg>';
    var shadow = '<ellipse class="pet-shadow" cx="100" cy="191" rx="' + (46 * (stage === 'baby' ? STAGE_SCALE.baby : 1)).toFixed(1) + '" ry="5" fill="#000" opacity=".13"/>';
    var sigBack = '', sigFront = '', sigDefs = '';
    // Жар-птица-миф парит ПЕРЕД питомцем — иначе её прячут крылья и хвосты.
    var phoenix = !!(mythSig && mythSig.form === 'orbit');
    var bodyId = mythSig ? uid('pbody') : '';
    var gf = mythSig ? formOf(mythSig.form, bodyId, !!opts.mini) : null;
    if (gf) {
      sigDefs = gf.defs; sigBack = gf.back; sigFront = gf.front;
      body = '<g id="' + bodyId + '"' + (gf.filter ? ' filter="' + gf.filter + '"' : '') + (gf.bodyClass ? ' class="' + gf.bodyClass + ' sig-live"' : '') + '>' + body + '</g>';
    }
    // Спутник — ПЕРЕД питомцем, у ног слева (30.09.2026). Раньше слой шёл до
    // тела: у малыша это работало, а широкий взрослый облик и люди закрывали
    // его почти целиком — в топе спутника не было видно вовсе. Чуть меньше и
    // левее, чтобы не наезжать на корпус; якорь — земля (y=192).
    var buddyFront = phoenix ? layer('pet') : (eq.pet && items[eq.pet]
      ? '<g transform="translate(-3 192) scale(' + (stage === 'baby' ? 1 : 0.9) + ') translate(0 -192)">' + layer('pet') + '</g>' : '');
    var cls = 'pet-svg st-' + state + ' stage-' + stage + ' sp-' + sp + cls3 + (best ? ' best-' + best : '') + (mythSig ? ' sig-mythic sig-' + mythSig.form : '') +
      sigs.filter(function (x) { return x.act; }).map(function (x) { return ' sig-' + x.act; }).join('') + (opts.anim === false ? ' no-anim' : '') + (opts.mini ? ' mini' : '') + (eq.hand && items[eq.hand] ? ' holding' : '');
    return '<svg class="' + cls + '" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + escAttr(opts.label || 'Питомец') + '">' +
      sigDefs + bg + sigBack + (opts.styleIcon ? styleAura() : '') + (mythSig ? '' : rarityAura(best)) + back('aura') + shadow + body + buddyFront + sigFront + layer('aura') + (opts.mini ? '' : extras(state)) + '</svg>';
  }

  // Одна вещь отдельно — для карточек лавки и гардероба. Для вещей на голову,
  // лицо и шею показываем их на «манекене» — бледном силуэте зверька.
  function renderItemBase(item, opts) {
    opts = opts || {};
    var art = (item && item.art) || {}; var fn = T[art.t];
    if (!fn) return '';
    var ghost = '';
    var slot = item.slot;
    if (slot === 'head' || slot === 'face' || slot === 'neck' || slot === 'body') {
      ghost = '<g opacity=".1"><circle cx="100" cy="88" r="46" fill="#8a8aa0"/><ellipse cx="100" cy="152" rx="40" ry="34" fill="#8a8aa0"/></g>';
    }
    var vb = { head: '30 -14 140 140', face: '44 44 112 112', neck: '50 100 100 100', pet: '-4 104 84 90', body: '28 100 144 100' }[slot] || '0 0 200 200';
    if (slot === 'body') vb = '24 94 152 116';
    if (art.t === 'shako') vb = '24 -40 152 140';
    if (art.t === 'spacehelm') vb = '30 14 140 142';
    if (slot === 'hand') vb = (HOLD[art.t] && HOLD[art.t].box) || '-46 -82 92 104';
    var bk = T[art.t + '_back'] ? T[art.t + '_back'](art.c || []) : '';
    return '<svg class="item-svg r-' + item.rarity + '" viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + bk + ghost + fn(art.c || []) + '</svg>';
  }

  // Еда, лекарства, игрушки и коробки — простые значки.
  var ICONS = {
    food_suhar: '🍞', food_shchi: '🍲', food_pirog: '🥧', food_pryanik: '🍪', food_pir: '🍗',
    med_otvar: '🍵', med_mikstura: '💊', toy_volchok: '🌀', toy_babki: '🎲', toy_lapta: '🏏',
    boost_elixir: '⚡', streak_freeze: '🧊',
    box_chest: '🧰', box_tsar: '👑', box_emperor: '💎', box_week: '🏆',
  };

  // Local art-direction pass. Same catalogue IDs and slots; no economy changes.
  // Simplify at 64px, readable construction at 200px. All fills have unique IDs.
  function thread(d,col,w){return '<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="'+(w||2)+'" stroke-linecap="round" stroke-linejoin="round"/>';}
  function studs(points,col,r){return points.map(function(p){return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(r||2)+'" fill="'+col+'" stroke="#62472b" stroke-width=".6"/>';}).join('');}
  T.shirt=function(c){var f=c0(c,0,'#e9e2cf'),a=c0(c,1,'#b44739');
    return torso(f,thread('M86 121 L86 146 L96 146',a,3)+thread('M77 121 Q99 130 122 121',a,3)+thread('M65 169 Q100 182 136 169',a,4)+studs([[90,132],[90,140]],'#b68d52',1.2)+thread('M80 160 L78 169 M120 160 L123 170',shade(f,-.25),1.2))+sleeves(f);};
  T.sweater=function(c){var f=c0(c,0,'#9d3843'),a=c0(c,1,'#f3e4cc');
    var deer='<g stroke="'+a+'" stroke-width="2" stroke-linecap="square" fill="none"><path d="M79 154h13v-7h-5 M80 154v6 M91 154v6 M91 146v-6l-4-4m4 7 5-5 M93 151h4 M108 154h13v-7h-5 M109 154v6 M120 154v6 M120 146v-6l-4-4m4 7 5-5"/></g>';
    return torso(f,thread('M62 137H138 M63 165H137',a,2)+deer+thread('M80 121Q100 132 120 121',shade(f,-.3),5)+thread('M71 176Q100 184 129 176',shade(f,-.3),4))+sleeves(f);};
  T.hoodie=function(c){var f=c0(c,0,'#2b2f3a'),a=c0(c,1,'#edc875');
    return torso(f,'<path d="M74 121 Q100 143 126 121 L120 132 Q100 141 80 131Z" fill="'+shade(f,.16)+'" '+SW+'/>'+thread('M91 131L89 144 M109 131L111 144','#e8dfd2',1.7)+'<path d="M79 159L85 151H115L121 159V171H79Z" fill="'+shade(f,-.16)+'" stroke="'+shade(f,.25)+'" stroke-width="1.2"/>'+thread('M87 160L83 165 M113 160L117 165',shade(f,.3),1.7)+'<rect x="94" y="143" width="12" height="5" rx="1" fill="'+a+'"/>')+sleeves(f);};
  T.mail=function(c){var f=c0(c,0,'#9aa3ad'),a=c0(c,1,'#6b737c'),id=uid('mail');var mesh='';
    for(var y=132;y<178;y+=9)for(var x=70+(y%18?4:0);x<134;x+=9)mesh+=thread('M'+x+' '+y+'q-3 0-3 3t3 3q3 0 3-3',a,1.1);
    return '<defs><clipPath id="'+id+'"><path d="M65 135Q100 111 135 135L137 171Q100 188 63 171Z"/></clipPath></defs>'+torso(f,'<g clip-path="url(#'+id+')">'+mesh+'</g>'+thread('M78 122Q100 137 122 122','#62533e',4)+thread('M67 168Q100 182 133 168','#62533e',4))+sleeves(f);};
  T.hussar=function(c){var f=c0(c,0,'#7a1426'),a=c0(c,1,'#d7b875');var braid='';
    for(var i=0;i<5;i++){var y=136+i*7;braid+=thread('M78 '+y+'Q89 '+(y+5)+' 100 '+y+'Q111 '+(y+5)+' 122 '+y,a,2.1)+studs([[78,y],[100,y],[122,y]],a,1.5);}
    return torso(f,'<path d="M86 120L114 120L113 132H87Z" fill="'+shade(f,-.28)+'" '+SW+'/>'+thread('M88 123H112',a,1.5)+braid+thread('M100 131V177',a,1.1)+thread('M69 176Q100 186 131 176',a,3))+sleeves(f);};
  T.spacesuit=function(c){var f=c0(c,0,'#f4f4f4'),a=c0(c,1,'#cc2d2d');
    return torso(f,'<path d="M79 121Q100 134 121 121L117 133Q100 141 83 133Z" fill="#bac8cf" '+SW+'/>'+thread('M85 126Q100 134 115 126','#6e818c',2)+'<rect x="79" y="139" width="42" height="26" rx="5" fill="#d3e0e2" stroke="#526771" stroke-width="2"/><rect x="86" y="145" width="18" height="9" rx="1.5" fill="#274955"/>'+thread('M89 151l3-3 3 3 5-3','#95d7c5',1)+studs([[112,147],[112,155]],a,2.3)+thread('M85 170Q100 177 117 169','#687f86',4)+'<path d="M117 162C139 160 131 182 115 177" fill="none" stroke="#bc9d69" stroke-width="4"/>')+sleeves(f);};
  T.helmet=function(c){var f=c0(c,0,'#9aa3ad'),g=c0(c,1,'#c9a24a'),id=uid('steel');
    return '<defs><linearGradient id="'+id+'"><stop stop-color="#536877"/><stop offset=".42" stop-color="'+shade(f,.4)+'"/><stop offset=".63" stop-color="'+f+'"/><stop offset="1" stop-color="#596b78"/></linearGradient></defs><path d="M54 65Q59 36 88 25L100 8L112 25Q141 36 146 65Z" fill="url(#'+id+')" '+SW+'/>'+thread('M100 15V62','#f3edda',2.5)+'<path d="M55 59Q100 67 145 59L146 68Q100 77 54 68Z" fill="'+g+'" '+SW+'/>'+studs([[62,65],[76,68],[89,70],[111,70],[124,68],[138,65]],'#f8e6aa',1.5);};
  T.tricorn=function(c){var f=c0(c,0,'#1f2a44'),g=c0(c,1,'#e8c35a');
    return '<path d="M65 61Q62 36 100 35Q137 35 135 61Z" fill="'+shade(f,.12)+'" '+SW+'/><path d="M45 54Q66 65 83 57L100 43L117 57Q134 65 155 54Q145 84 117 70Q100 64 83 70Q55 85 45 54Z" fill="'+f+'" '+SW+'/>'+thread('M50 60Q64 77 86 65L100 53L114 65Q136 77 150 60',g,2.4)+'<ellipse cx="119" cy="62" rx="5" ry="7" fill="'+g+'" stroke="#5d432d" stroke-width="1.2"/>'+thread('M121 66L128 76','#b45242',3);};
  T.spacehelm=function(c){var f=c0(c,0,'#f4f4f4'),a=c0(c,1,'#cc2d2d'),id=uid('glass');
    return '<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a6d3dc" stop-opacity=".12"/><stop offset="1" stop-color="#456d83" stop-opacity=".3"/></linearGradient></defs><path d="M57 110Q38 87 48 59Q57 27 100 25Q144 27 152 60Q162 88 143 111L139 124H61Z" fill="url(#'+id+')" stroke="#435967" stroke-width="3"/><path d="M49 57Q64 21 101 25Q134 26 149 55L138 52Q124 36 100 36Q76 36 62 55Z" fill="'+f+'" '+SW+'/><path d="M59 114Q100 132 141 114L138 129Q100 145 62 129Z" fill="'+f+'" '+SW+'/>'+thread('M64 124Q100 135 137 123',a,4)+thread('M56 65Q51 82 56 94','#fff',4)+'<rect x="43" y="70" width="12" height="24" rx="5" fill="'+f+'" '+SW+'/><rect x="145" y="70" width="12" height="24" rx="5" fill="'+f+'" '+SW+'/>';};
  T.monomakh=function(c){var g=c0(c,0,'#e9c46a'),f=c0(c,1,'#6b3f22');var plates='';
    for(var i=0;i<5;i++){var x=65+i*17;plates+=thread('M100 14Q'+x+' 33 '+x+' 60','#8b612a',1.4);}
    return '<path d="M57 63Q58 30 85 22Q93 9 100 9Q107 9 115 22Q142 30 143 63Z" fill="'+g+'" '+SW+'/>'+plates+'<path d="M100 3V-9M95-4H105" stroke="#cda74d" stroke-width="3" stroke-linecap="round"/>'+studs([[74,46],[91,34],[109,34],[126,46]],'#fff0be',2.3)+'<path d="M55 58Q100 72 145 58L146 74Q100 88 54 74Z" fill="'+f+'" '+SW+'/>'+thread('M59 69Q100 81 141 69',shade(f,.25),5)+'<path d="M96 44L100 39L104 44L100 50Z" fill="#438870" stroke="#6d4923" stroke-width="1.2"/>';};

  // Second art pass: clothes have their own cut in character coordinates.
  // No ellipses over a previous sleeve, and no baby-shirt scale used for bodies.
  var Tailor = null;
  var TAILORED = ['shirt','sweater','hoodie','mail','hussar','spacesuit'];
  function tailorSetup(sp,stage,eq,items) {
    var it=items[eq.body]; Tailor=null;
    if(!it || TAILORED.indexOf(it.art.t)<0) return;
    var a=sp==='burunday'?'bur':HUMAN[sp]?'human':sp==='squid'?(squidChad(stage)?'squidChad':'squid'):stage==='baby'?(sp==='owl'?'babyOwl':'baby'):(sp==='owl'?'v3Owl':'v3');
    var geom={bur:[38,101,55],human:[34,100,64],squid:[30,102,61],squidChad:[47,116,52],v3:[34,106,62],v3Owl:[34,106,62],baby:[39,120,61],babyOwl:[39,120,61]}[a];
    Tailor={it:it,kind:it.art.t,anat:a,w:geom[0],y:geom[1],h:geom[2],fill:it.art.c[0]||'#657889',accent:it.art.c[1]||'#e7d8b8',skin:sp==='burunday'?BUR.skin:HUMAN[sp]?HUMAN[sp].skin:sp==='squid'?squidPal(stage).skin:SPECIES[sp].fur};
    tailorConfigure(Tailor);
  }
  function tailorPath(d,fill,stroke,w){return '<path d="'+d+'" fill="'+(fill||'none')+'" stroke="'+(stroke||'none')+'" stroke-width="'+(w||1)+'" stroke-linecap="round" stroke-linejoin="round"/>';}
  function tailorMaterial(f,prefix){var id=uid(prefix||'fabric');return {id:id,defs:'<defs><linearGradient id="'+id+'" x1="0%" y1="5%" x2="100%" y2="85%"><stop stop-color="'+shade(f,.23)+'"/><stop offset=".38" stop-color="'+shade(f,.05)+'"/><stop offset=".76" stop-color="'+shade(f,-.12)+'"/><stop offset="1" stop-color="'+shade(f,-.3)+'"/></linearGradient></defs>',fill:'url(#'+id+')'};}
  function tailorBody(){
    if(!Tailor)return '';
    var t=Tailor,w=t.w,y=t.y,h=t.h,f=t.fill,a=t.accent,k=t.kind,ink=shade(f,-.62),mat=tailorMaterial(f),clip=uid('cut');
    var d='M'+(100-w*.44)+' '+y+' Q100 '+(y+5)+' '+(100+w*.44)+' '+y+' Q'+(100+w*.79)+' '+(y+1)+' '+(100+w)+' '+(y+8)+' C'+(100+w*.91)+' '+(y+h*.38)+' '+(100+w*.88)+' '+(y+h*.58)+' '+(100+w*.92)+' '+(y+h-4)+' Q100 '+(y+h+5)+' '+(100-w*.92)+' '+(y+h-4)+' C'+(100-w*.88)+' '+(y+h*.58)+' '+(100-w*.91)+' '+(y+h*.38)+' '+(100-w)+' '+(y+8)+' Q'+(100-w*.79)+' '+(y+1)+' '+(100-w*.44)+' '+y+'Z';
    d=tailorCut(t);
    var s=mat.defs+'<defs><clipPath id="'+clip+'"><path d="'+d+'"/></clipPath></defs>'+tailorPath(d,mat.fill,ink,2.2);
    // Details use a 100 x 100 drafting panel; garment cut itself remains native.
    var z='<g clip-path="url(#'+clip+')"><g transform="translate('+(100-w)+' '+y+') scale('+(w/50)+' '+(h/100)+')">';
    z+=tailorPath('M5 13Q17 27 12 78L8 98H20Q13 59 23 24 M95 13Q83 27 88 78L92 98H80Q87 59 77 24',shade(f,-.28));
    z+=tailorPath('M19 35Q25 50 21 67 M78 73L83 87 M19 84L29 91','none',shade(f,.18),1.2);
    if(k==='sweater'){
      z+=tailorPath('M0 38Q50 42 100 38L100 70Q50 74 0 70Z',shade(f,-.17));
      z+=tailorPath('M0 40Q50 44 100 40 M0 68Q50 72 100 68','none',a,1.8);
      // Solid knitted deer silhouettes, two facing each other, with antlers.
      var deer='M-12 4L-8-3H3L7-11L12-13L14-10L10-7L8 2L5 4L4 13H1L0 5H-7L-8 13H-11L-10 3L-14 0Z';
      z+='<g fill="'+a+'"><g transform="translate(30 54) scale(.85 .8)"><path d="'+deer+'"/>'+tailorPath('M9-12L8-20M8-17L4-20M8-18L11-21','none',a,1.8)+'</g><g transform="translate(70 54) scale(-.85 .8)"><path d="'+deer+'"/>'+tailorPath('M9-12L8-20M8-17L4-20M8-18L11-21','none',a,1.8)+'</g></g>';
      for(var j=0;j<7;j++){var xx=9+j*14;z+=tailorPath('M'+xx+' 29l3-3 3 3-3 3Z M'+xx+' 80l3-3 3 3-3 3Z',a);}
      z+=tailorPath('M0 88Q50 96 100 88L100 104H0Z',shade(f,-.24));
      for(var r=5;r<98;r+=4)z+=tailorPath('M'+r+' 93v7','none',shade(f,.19),.8);
    }else if(k==='hoodie'){
      z+=tailorPath('M24 61Q50 64 76 61L83 85Q50 94 17 85Z',shade(f,-.15),shade(f,.22),1.4);
      z+=tailorPath('M25 63L20 79 M75 63L80 79','none',ink,3);
      z+=tailorPath('M25 64L22 78 M75 64L78 78','none',shade(f,.33),.9);
      z+=tailorPath('M19 86Q50 94 81 86 M0 92Q50 100 100 92','none',shade(f,.25),1);
      z+='<rect x="41" y="42" width="18" height="7" rx="1" fill="'+a+'"/>'+tailorPath('M44 44h12M44 47h8','none',shade(f,-.3),.65);
      z+=tailorPath('M36 13Q38 26 33 37 M64 13Q62 26 67 37','none','#e8e3d8',1.6);
      z+=tailorPath('M33 35v4 M67 35v4','none',a,2.2);
      for(var r2=5;r2<97;r2+=5)z+=tailorPath('M'+r2+' 96v5','none',shade(f,.14),.8);
    }else if(k==='shirt'&&t.it.id!=='body_pioneer'){
      z+=tailorPath('M36 0V39H46','none',a,3.2)+tailorPath('M36 0V39H46','none',shade(a,.3),.7);
      for(var b=0;b<3;b++)z+='<circle cx="40" cy="'+(13+b*8)+'" r="1.2" fill="#bc9456"/>';
      z+=tailorPath('M0 86Q50 99 100 86','none',a,6);
      for(var b2=5;b2<97;b2+=8)z+=tailorPath('M'+b2+' 89l2-2 2 2-2 2Z',shade(a,.65));
      z+=tailorPath('M22 67L20 85 M76 63L80 85','none',shade(f,-.2),1.6);
    }else if(k==='hussar'){
      z+=tailorPath('M50 3V94','none',a,1.5);
      for(var row=0;row<5;row++){var yy=27+row*12,dx=28-row*.9;z+=tailorPath('M'+(50-dx)+' '+yy+'Q34 '+(yy+7)+' 50 '+yy+'Q66 '+(yy+7)+' '+(50+dx)+' '+yy,'none',shade(a,-.35),4)+tailorPath('M'+(50-dx)+' '+(yy-1)+'Q34 '+(yy+6)+' 50 '+(yy-1)+'Q66 '+(yy+6)+' '+(50+dx)+' '+(yy-1),'none',a,2.2);[50-dx,50,50+dx].forEach(function(x){z+='<circle cx="'+x+'" cy="'+yy+'" r="1.9" fill="'+a+'" stroke="'+shade(a,-.45)+'" stroke-width=".6"/>';});}
      z+=tailorPath('M0 91Q50 104 100 91','none',a,3);
    }else if(k==='mail'){
      for(var yy2=14;yy2<98;yy2+=8)for(var xx2=8+(yy2%16?3:0);xx2<98;xx2+=7)z+=tailorPath('M'+xx2+' '+yy2+'q-3-3-4 1t4 4q3-1 3-4','none',shade(f,-.4),1.2)+tailorPath('M'+(xx2-3)+' '+(yy2+1)+'q0-2 2-2','none',shade(f,.4),.75);
      z+=tailorPath('M0 91Q50 104 100 91','none','#57432e',6)+tailorPath('M0 91Q50 104 100 91','none','#c49b58',1.4);
    }else if(k==='spacesuit'){
      z+=tailorPath('M15 10L24 89 M85 10L76 89','none','#a2b4bd',8)+tailorPath('M15 10L24 89 M85 10L76 89','none','#e1e9e9',3);
      z+='<rect x="27" y="29" width="46" height="43" rx="6" fill="#b9cbd0" stroke="#415761" stroke-width="2"/><rect x="32" y="34" width="26" height="16" rx="2" fill="#294853"/>'+tailorPath('M35 44l5-5 5 4 9-5','none','#90dac9',1.2)+'<circle cx="65" cy="39" r="3" fill="'+a+'"/><circle cx="65" cy="49" r="3" fill="#d5ad59"/>'+tailorPath('M33 58h22 M33 63h16','none','#617f8c',2.1);
      z+=tailorPath('M65 68C95 65 85 96 57 91','none','#617984',7)+tailorPath('M65 68C95 65 85 96 57 91','none','#c8af78',4.3);
      z+=tailorPath('M0 90Q50 103 100 90','none','#8097a0',4);
    }
    z+=tailorMoreDetails(t);
    s+=z+'</g></g>';
    // Collar and hood are part of the neckline, not a sticker on the chest.
    var nw=w*.44;
    if(k==='hoodie'||k==='blackhoodie'){
      s+=tailorPath('M'+(100-nw-6)+' '+(y+2)+'Q'+(100-nw)+' '+(y-11)+' 100 '+(y-5)+'Q'+(100+nw)+' '+(y-11)+' '+(100+nw+6)+' '+(y+2)+'Q'+(100+nw-1)+' '+(y+15)+' 100 '+(y+13)+'Q'+(100-nw+1)+' '+(y+15)+' '+(100-nw-6)+' '+(y+2)+'Z',shade(f,-.23),ink,1.8);
      s+=tailorPath('M'+(100-nw)+' '+(y+1)+'Q100 '+(y+16)+' '+(100+nw)+' '+(y+1),'none',shade(f,.27),1.6);
    }else if(k==='hussar')s+=tailorPath('M'+(100-nw)+' '+(y-4)+'Q100 '+y+' '+(100+nw)+' '+(y-4)+'L'+(100+nw)+' '+(y+7)+'Q100 '+(y+12)+' '+(100-nw)+' '+(y+7)+'Z',shade(f,-.22),a,1.3);
    else if(['sweater','shirt','mail','spacesuit','stripes','pajama','scorpion','tracksuit'].indexOf(k)>=0){
      var collar=k==='spacesuit'?'#91a8b1':k==='mail'?'#705332':k==='shirt'?(t.it.id==='body_pioneer'?'#eeeade':a):shade(f,-.29);
      s+=tailorPath('M'+(100-nw)+' '+(y+1)+'Q100 '+(y+11)+' '+(100+nw)+' '+(y+1),'none',ink,6.5)+tailorPath('M'+(100-nw)+' '+y+'Q100 '+(y+10)+' '+(100+nw)+' '+y,'none',collar,4.8);
      if(k==='sweater')for(var i=-4;i<=4;i++){var cx=100+i*nw/5,cy=y+4*(1-Math.abs(i)/5);s+=tailorPath('M'+cx+' '+(cy-1)+'v4','none',shade(f,.15),.85);}
    }
    return '<g class="slot-body tailored tailored-'+k+' r-'+t.it.rarity+'" data-cut="'+t.anat+'">'+s+'</g>';
  }
  // Paths follow each real shoulder / elbow / wrist, with a separate cuff edge.
  var TAILOR_ARMS={
    bur:{d:'M72 104C58 105 47 119 49 134Q49 142 55 150L73 148Q72 143 71 139C68 129 73 119 81 114Z',cuff:'M53 142Q62 143 72 140L74 148Q64 154 55 150Z',fold:'M54 126Q59 130 66 128 M57 135L63 138',seam:'M71 106Q76 108 77 114'},
    human:{d:'M73 102C62 106 55 125 57 144L59 152Q66 156 73 151C71 137 76 119 83 112Z',cuff:'M57 145Q65 149 72 144L73 152Q66 156 59 152Z',fold:'M61 128L68 132 M61 137L66 140',seam:'M73 104Q77 108 79 113'},
    v3:{d:'M71 108C60 111 53 129 55 141L57 149Q65 155 73 148C71 137 76 123 81 117Z',cuff:'M55 141Q64 147 73 141L74 148Q65 155 57 149Z',fold:'M59 125Q63 130 69 128 M59 136L65 139',seam:'M72 111Q77 114 78 119'},
    v3Owl:{d:'M71 108C57 116 51 133 55 148Q62 151 68 145Q73 128 81 117Z',cuff:'M54 140Q60 146 70 141L68 149Q61 154 56 150Z',fold:'M60 124L66 127',seam:'M72 111L77 116'},
    baby:{d:'M68 129C58 129 47 142 49 155L53 162Q62 167 69 159C68 150 71 143 76 138Z',cuff:'M49 154Q59 160 68 154L70 161Q61 168 53 163Z',fold:'M54 143L61 148',seam:'M68 132L73 138'},
    babyOwl:{d:'M66 129C53 130 45 150 51 163Q58 170 65 160L73 137Z',cuff:'M49 154Q56 162 66 154L66 163Q58 170 52 165Z',fold:'M54 143L60 148',seam:'M66 132L70 138'},
    squid:{d:'M76 103C64 106 58 119 62 135L67 151Q73 155 80 150C73 139 74 119 83 111Z',cuff:'M65 142Q72 145 77 141L81 150Q75 156 69 152Z',fold:'M65 121L70 127',seam:'M76 106L80 112'},
    squidChad:{d:'M62 116C48 111 32 125 35 143Q38 151 39 158Q34 169 44 177Q51 181 59 174C59 165 59 160 62 154Q70 132 62 116Z',cuff:'M38 168Q47 174 58 166L60 175Q52 182 44 178Z',fold:'M40 136Q48 141 56 138 M41 155L49 160',seam:'M59 119Q63 127 62 133'}
  };
  function tailorArm(side,fill,ink){
    if(!Tailor)return '';
    var t=Tailor,g=TAILOR_ARMS[t.anat],f=t.armFill||t.fill,k=t.kind,mat=tailorMaterial(f,'sleeve'),edge=shade(f,-.62),r=side==='r';
    var s=mat.defs+tailorPath(g.d,mat.fill,edge,2.15)+tailorPath(g.fold,'none',shade(f,-.32),1.2)+tailorPath(g.seam,'none',shade(f,.27),1.1);
    var cf=k==='hussar'?shade(f,-.3):k==='mail'?'#705332':k==='spacesuit'?'#718d99':shade(f,-.25);
    s+=tailorPath(g.cuff,cf,edge,1.1);
    if(k==='hussar'||k==='shirt')s+=tailorPath(g.cuff,'none',t.accent,1.15);
    if(k==='sweater'||k==='hoodie'){
      var id=uid('cuff');s+='<defs><clipPath id="'+id+'"><path d="'+g.cuff+'"/></clipPath></defs><g clip-path="url(#'+id+')">';
      for(var x=35;x<83;x+=3)s+=tailorPath('M'+x+' 138v45','none',shade(f,.22),.7);s+='</g>';
    }
    if(k==='mail'){
      var cl=uid('sleeve-mesh');s+='<defs><clipPath id="'+cl+'"><path d="'+g.d+'"/></clipPath></defs><g clip-path="url(#'+cl+')">';
      for(var yy=116;yy<140;yy+=5)for(var xx=40;xx<80;xx+=5)s+=tailorPath('M'+xx+' '+yy+'q-2-2-2 1t3 2','none',shade(f,-.36),.8);s+='</g>';
    }
    s+=tailorExtraSleeve(t,g,edge);
    s='<g class="tailored-sleeve"'+(r?' transform="translate(200 0) scale(-1 1)"':'')+'>'+s+'</g>';
    var A=ANAT[t.anat],hand={paw:[r?A.paw[0]:200-A.paw[0],A.paw[1]],skin:A.skin,wing:A.wing};
    return s+paw(hand,fill,ink,false);
  }

  // Every catalogue body template has an intentional cut and its own details.
  var WARDROBE_CUTS={
    shirt:{},coat:{long:1.18,fur:true},stripes:{},uniform:{},quilt:{bulk:1.04},dress:{long:1.25,flare:1.16,blouse:true},
    sweater:{},apron:{long:1.12,blouse:true},hoodie:{},mail:{},kaftan:{long:1.24,flare:1.07},tailcoat:{long:1.13},
    tunic:{},leather:{},greatcoat:{long:1.27,flare:1.1},robe:{long:1.3,flare:1.17},sailor:{},guard:{long:1.12},
    hussar:{},furcoat:{long:1.27,flare:1.14,fur:true},spacesuit:{},plate:{},mantle:{long:1.17,flare:1.14},
    marshal:{},firecloak:{long:1.07},tracksuit:{},furjuly:{long:1.26,flare:1.15,fur:true},barejacket:{},
    pajama:{long:1.06},sigmasuit:{long:1.09},blackhoodie:{bulk:1.06,long:1.08},scorpion:{}
  };
  TAILORED=Object.keys(WARDROBE_CUTS);
  function tailorConfigure(t){
    var c=WARDROBE_CUTS[t.kind]||{};t.cut=c;t.originalFill=t.fill;t.skin=t.skin||'#d9bea0';
    t.w*=c.bulk||1;t.h=Math.min(t.h*(c.long||1),185-t.y);t.flare=c.flare||1;
    if(c.blouse)t.fill='#f5eee1';
    t.armFill=c.blouse?'#f5eee1':t.kind==='mantle'?'#ead0a0':t.fill;
    t.trim=t.it.art&&t.it.art.c[2]||'#d8b164';
  }
  function tailorCut(t){var w=t.w,y=t.y,h=t.h,fw=w*.92*(t.flare||1),suit=['tailcoat','sigmasuit','barejacket','leather'].indexOf(t.kind)>=0;
    return 'M'+(100-w*.44)+' '+y+'Q100 '+(y+5)+' '+(100+w*.44)+' '+y+'Q'+(100+w*.8)+' '+(y+1)+' '+(100+w)+' '+(y+8)+'C'+(100+w*.9)+' '+(y+h*.35)+' '+(100+w*(suit?.76:.91))+' '+(y+h*.56)+' '+(100+fw)+' '+(y+h-4)+'Q100 '+(y+h+5)+' '+(100-fw)+' '+(y+h-4)+'C'+(100-w*(suit?.76:.91))+' '+(y+h*.56)+' '+(100-w*.9)+' '+(y+h*.35)+' '+(100-w)+' '+(y+8)+'Q'+(100-w*.8)+' '+(y+1)+' '+(100-w*.44)+' '+y+'Z';
  }
  function wardCircle(x,y,r,c,edge){return '<circle cx="'+x+'" cy="'+y+'" r="'+r+'" fill="'+c+'" stroke="'+(edge||shade(c,-.45))+'" stroke-width=".7"/>';}
  function wardButtons(x,ys,c){return ys.map(function(y){return wardCircle(x,y,1.7,c)+tailorPath('M'+(x-.5)+' '+(y-.6)+'h1','none',shade(c,.5),.5);}).join('');}
  function wardPocket(x,y,w,h,c){return tailorPath('M'+x+' '+y+'h'+w+'v'+(h-3)+'q'+(-w/2)+' 6 '+(-w)+' 0Z','none',c,1.25)+tailorPath('M'+x+' '+y+'l'+w/2+' 4 '+w/2+'-4','none',c,1.25);}
  function wardStar(x,y,r,c){var d='';for(var i=0;i<10;i++){var a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.42:r;d+=(i?'L':'M')+(x+Math.cos(a)*rr)+' '+(y+Math.sin(a)*rr);}return tailorPath(d+'Z',c,shade(c,-.4),.7);}
  function wardFur(d,c,width){return tailorPath(d,'none',shade(c,-.3),width+2)+tailorPath(d,'none',c,width)+tailorPath(d,'none',shade(c,.3),width*.45);}
  function tailorMoreDetails(t){
    var k=t.kind,f=t.originalFill||t.fill,a=t.accent,ink=shade(f,-.65),hi=shade(f,.28),s='',p=tailorPath;
    if(k==='shirt'&&t.it.id==='body_pioneer'){
      s+=p('M50 0V99','none','#d6d2c7',1.6)+p('M31 0L50 17L69 0L63 24L50 17L37 24Z','#fffdf6','#adaaa0',1)+wardButtons(50,[34,49,64,79],'#e8e5dc')+wardPocket(67,31,19,20,'#b6b3ab');
    }else if(k==='quilt'){
      // Padded jacket: stitched channels with raised filling, a placket and pockets.
      for(var q=6;q<99;q+=11)s+=p('M'+q+' 7Q'+(q-7)+' 42 '+q+' 99','none',shade(f,-.3),1.5)+p('M'+(q+2)+' 9Q'+(q-3)+' 45 '+(q+2)+' 97','none',hi,1.1);
      s+=p('M47 0H54V102H47Z',shade(f,-.15),ink,.9)+wardButtons(51,[25,43,61,79],a)+wardPocket(13,57,22,23,shade(f,-.48))+wardPocket(66,57,22,23,shade(f,-.48));
      s+=p('M26 1L35 18L49 9 M74 1L65 18L51 9',shade(f,.08),ink,1.2);
    }else if(k==='stripes'){
      for(var r=17;r<98;r+=13)s+=p('M0 '+r+'Q50 '+(r+6)+' 100 '+r,'none',a,5.2);
      s+=p('M0 92Q50 103 100 92','none',shade(f,-.2),1.2);
    }else if(k==='uniform'||k==='tunic'||k==='guard'||k==='marshal'){
      var military=k!=='uniform',trim=military?t.trim:'#e9e4d8';
      s+=p('M36 0L50 18L64 0L63 22L50 14L37 22Z',k==='marshal'?'#a4332e':k==='guard'?a:k==='uniform'?'#f7f3e9':shade(f,-.16),ink,1.1);
      s+=p('M50 15V99','none',shade(f,-.4),1.5)+wardButtons(50,[29,46,63,80],a);
      s+=wardPocket(13,35,21,20,shade(f,-.37))+wardPocket(66,35,21,20,shade(f,-.37));
      if(military)s+=p('M0 70Q50 78 100 70L100 80Q50 88 0 80Z','#4a3425',ink,1)+'<rect x="44" y="73" width="12" height="9" rx="1" fill="'+trim+'" stroke="#6d542b" stroke-width="1"/>';
      if(k==='guard'){s+=p('M28 0L32 66 M72 0L68 66','none',a,6)+wardButtons(31,[28,45,62],t.trim)+wardButtons(69,[28,45,62],t.trim);}
      if(k==='marshal'){s+=wardStar(74,40,7,a)+p('M15 29H34 M15 34H34 M15 39H34','none','#c5aa58',3)+p('M18 34H25','none','#be3935',3);}
    }else if(k==='coat'||k==='furcoat'||k==='furjuly'){
      var fur=k==='coat'?a:k==='furcoat'?a:shade(f,.18);
      s+=p('M53 3L47 102','none',shade(f,-.5),2)+wardButtons(54,[28,46,64,82],k==='furcoat'?t.trim:'#c5a476');
      s+=wardFur('M29 0Q35 17 49 29Q65 12 71 0',fur,10)+wardFur('M0 91Q50 102 100 91',fur,9);
      s+=p('M14 44L29 39 M86 44L71 39','none',ink,2.1);
      for(var y=32;y<90;y+=12)for(var x=8;x<95;x+=13)s+=p('M'+x+' '+y+'l2 4 2-3','none',k==='furcoat'?shade(f,.23):shade(f,-.15),.7);
      if(k==='furcoat')for(var fy=38;fy<87;fy+=18){s+=p('M22 '+fy+'q-9-7-9 0t9 0q8 7 8 0t-8 0 M78 '+fy+'q-9-7-9 0t9 0q8 7 8 0t-8 0','none',t.trim,1);}
    }else if(k==='dress'){
      s+=p('M21 17L32 15V38Q50 44 68 38V15L79 17L77 38L100 100H0L23 38Z',f,shade(f,-.5),1.7);
      s+=p('M26 40Q50 47 74 40 M0 88Q50 98 100 88','none',a,4)+p('M50 43V98','none',a,1.6);
      for(var d=0;d<4;d++)s+=wardCircle(50,52+d*12,1.4,a);
      for(var dx=11;dx<96;dx+=13)s+=p('M'+dx+' 88l3-4 3 4-3 4Z',shade(a,.2));
      s+=p('M29 55L17 86 M71 55L83 86','none',shade(f,-.25),1.2);
    }else if(k==='apron'){
      s+=p('M29 2L34 38 M71 2L66 38','none',f,5)+p('M33 25Q50 30 67 25L72 54L84 100H16L28 54Z',f,shade(f,-.5),1.8);
      s+=p('M30 30Q50 35 70 30 M20 94Q50 100 80 94','none',a,1.2)+wardPocket(32,61,36,22,a);
      s+=p('M37 65V78 M62 65V78','none',shade(f,-.3),.9)+p('M21 57L7 50 M79 57L93 50','none',f,4);
    }else if(k==='kaftan'||k==='greatcoat'||k==='robe'){
      s+=p('M50 0V102','none',a,2)+p('M20 45L10 97 M80 45L90 97','none',shade(f,-.25),1.8);
      if(k==='kaftan'){
        s+=p('M29 0L33 98 M71 0L67 98','none',a,3);
        for(var ky=24;ky<87;ky+=14)s+=p('M33 '+ky+'H67','none',a,2.2)+wardCircle(33,ky,1.8,a)+wardCircle(67,ky,1.8,a);
      }else if(k==='greatcoat'){
        s+=p('M32 0L50 30L68 0L80 19L62 38L50 30L38 38L20 19Z',shade(f,-.16),ink,1.3)+wardButtons(38,[42,57,72,87],a)+wardButtons(62,[42,57,72,87],a);
        s+=p('M11 66L28 61 M89 66L72 61','none',ink,2.8);
      }else{
        s+=p('M29 0L50 27L71 0 M50 27L69 98','none',shade(f,.3),2.1)+p('M0 47Q50 62 100 47','none','#403329',5);
        s+=p('M46 48Q50 61 57 51L55 73 M54 53L63 77','none','#937746',1.8)+p('M50 18V33 M44 24H56','none','#c7a965',2.2);
      }
    }else if(k==='tailcoat'||k==='sigmasuit'||k==='barejacket'||k==='leather'){
      s+=p('M31 0L50 53L69 0Z',k==='barejacket'?t.skin:k==='leather'?shade(f,.1):'#f7f2e7');
      s+=p('M31 0L42 31L32 43L50 65L24 29L20 12Z M69 0L58 31L68 43L50 65L76 29L80 12Z',shade(f,.14),ink,1.1);
      s+=p('M26 15L42 31 M74 15L58 31','none',hi,.9)+wardButtons(50,[66,81],k==='leather'?'#b6b8b7':shade(f,.35));
      s+=p('M13 68H31 M69 68H87','none',ink,2.4)+p('M14 66H30 M70 66H86','none',hi,.8);
      if(k==='sigmasuit')s+=p('M47 5H53L56 12L50 43L44 12Z','#1a1b23')+p('M69 34H83L78 27L74 33L72 28Z',a);
      if(k==='tailcoat')s+=p('M43 7L50 11L57 7V18L50 14L43 18Z','#25242d')+p('M0 79L42 74L36 98L0 103Z M100 79L58 74L64 98L100 103Z',f,ink,1);
      if(k==='leather')s+=p('M38 20L61 98','none','#b9b8ac',1.5)+p('M15 36L33 32 M67 32L85 36','none','#a4a39a',1.2)+'<rect x="42" y="45" width="3" height="6" fill="#c7c6b8"/>';
      if(k==='barejacket')s+=p('M42 24Q50 30 58 24','none',shade(t.skin,-.22),1.1)+p('M71 33H84','none',a,2.2);
    }else if(k==='sailor'){
      s+=p('M26 0L50 30L74 0L85 16L50 43L15 16Z',a,ink,1.1)+p('M28 7L50 32L72 7 M24 13L50 37L76 13','none','#f5f1e8',1.2)+p('M46 35L50 43L43 62L50 58L57 62L50 43L54 35Z','#b73136');
      s+=p('M0 83Q50 91 100 83','none',a,3.8);
    }else if(k==='plate'){
      s+=p('M12 13Q50 0 88 13L84 57Q50 74 16 57Z',shade(f,.16),shade(f,-.4),1.8)+p('M50 8V66','none','#748492',1.3)+p('M20 17Q35 10 45 14','none','#fff',2.1);
      s+=p('M43 20H56V32H72V42H56V58H43V42H28V32H43Z',t.trim);
      for(var py=67;py<100;py+=9)s+=p('M8 '+py+'Q50 '+(py+13)+' 92 '+py,'none',shade(f,-.32),2)+p('M10 '+(py+2)+'Q50 '+(py+14)+' 90 '+(py+2),'none',shade(f,.3),1);
    }else if(k==='mantle'){
      s+=p('M12 0L25 0L90 91L77 98Z','#437bb7',ink,.8)+wardStar(66,58,11,'#f4f1e7')+wardCircle(66,58,4,'#3b73ad');
      s+=p('M0 4Q50-10 100 4L100 24Q90 30 82 24Q73 33 64 26Q55 34 50 28Q42 34 34 26Q24 33 16 25Q8 29 0 24Z','#f6f0de',ink,1.2);
      for(var mx=10;mx<96;mx+=13)s+=p('M'+mx+' 9l-1 6 3-2-1-4Z','#35302c');
      s+=p('M19 28Q50 48 81 28','none','#ad8331',3)+p('M19 28L16 40H22Z M81 28L78 40H84Z','#d4a841');
    }else if(k==='firecloak'){
      for(var fr=4;fr>=0;fr--)for(var fx=12;fx<98;fx+=13)s+=p('M'+fx+' '+(10+fr*17)+'q-9 12 0 22q9-10 0-22Z',fr%2?f:a,shade(f,-.4),.7);
      s+=wardCircle(50,20,6,'#a72d24')+p('M47 16L53 22','none','#ffc56a',1.6);
    }else if(k==='tracksuit'){
      s+=p('M8 0L15 100 M14 0L21 100 M86 0L79 100 M92 0L85 100','none','#e8ebec',2.4)+p('M50 0V100','none','#adb9ca',1.3)+'<rect x="48" y="17" width="4" height="7" rx="1" fill="#d5d9dc"/>';
      s+=p('M27 58L17 75 M73 58L83 75','none',ink,2)+p('M0 92Q50 103 100 92','none',shade(f,-.3),5);
    }else if(k==='pajama'){
      s+=p('M31 0L50 22L69 0 M50 22V101','none',a,2.1)+wardButtons(50,[33,49,65,81],a);
      [[20,35],[75,30],[27,63],[78,67],[21,88]].forEach(function(q){s+='<g transform="translate('+q[0]+' '+q[1]+')">'+p('M-5-2L-5-8L-1-5Q0-6 1-5L5-8L5-2Q8 6 0 7Q-8 6-5-2Z',a)+wardCircle(-2,0,.7,'#41546b')+wardCircle(2,0,.7,'#41546b')+p('M-1 3L0 4L1 3','none','#708599',.6)+'</g>';});
      s+=wardPocket(63,42,24,15,a);
    }else if(k==='blackhoodie'){
      s+=p('M23 60Q50 65 77 60L83 87Q50 95 17 87Z',shade(f,-.12),hi,1.1)+p('M23 65L19 81 M77 65L81 81','none',ink,2.5)+p('M36 14L32 42 M64 14L68 42','none','#c7c9cf',1.7)+wardCircle(32,42,1.4,'#c7c9cf')+wardCircle(68,42,1.4,'#c7c9cf');
      s+=p('M0 93Q50 103 100 93','none',hi,1.3);
    }else if(k==='scorpion'){
      s+=p('M50 0V102','none','#96866b',1.7)+p('M0 91Q50 101 100 91','none','#c5baa4',7)+p('M12 59L25 52 M88 59L75 52','none','#a59b85',1.7);
      s+='<g transform="translate(70 38) scale(.72)">'+p('M0 0C-8 2-7 14 0 19C7 14 8 2 0 0Z',a,'#9a793c',1)+p('M0 0C14-7 16-21 4-20Q-3-18 2-12L6-13','none',a,4)+p('M-6 4L-15-2L-15-7M6 4L15-2L15-7 M-6 8L-14 10 M6 8L14 10 M-4 13L-10 18 M4 13L10 18','none','#ad8437',2)+'</g>';
    }
    return s;
  }
  function tailorExtraSleeve(t,g,edge){
    var k=t.kind,f=t.armFill||t.fill,a=t.accent,p=tailorPath,s='',cl=uid('sleeve-detail');
    s+='<defs><clipPath id="'+cl+'"><path d="'+g.d+'"/></clipPath></defs><g clip-path="url(#'+cl+')">';
    if(k==='quilt')for(var y=111;y<151;y+=8)s+=p('M32 '+y+'Q60 '+(y+5)+' 86 '+y,'none',shade(f,-.32),1.3)+p('M33 '+(y+2)+'Q60 '+(y+7)+' 85 '+(y+2),'none',shade(f,.21),.8);
    if(k==='stripes')for(var y2=112;y2<160;y2+=8)s+=p('M30 '+y2+'Q60 '+(y2+5)+' 87 '+y2,'none',a,3.3);
    if(k==='tracksuit')s+=p('M58 108Q43 134 51 158 M62 108Q47 134 55 158','none','#e8ebec',1.6);
    if(k==='plate'){for(var ay=112;ay<153;ay+=9)s+=p('M30 '+ay+'Q55 '+(ay+9)+' 85 '+ay,'none',shade(f,-.4),1.6)+p('M30 '+(ay+2)+'Q55 '+(ay+11)+' 85 '+(ay+2),'none',shade(f,.4),1);}
    if(t.cut&&t.cut.fur)for(var fy=114;fy<156;fy+=7)for(var fx=37;fx<85;fx+=8)s+=p('M'+fx+' '+fy+'l2 3 1-2','none',shade(f,.2),.65);
    if(k==='guard'||k==='marshal')s+=p('M70 110L78 114','none',t.trim,4)+p(g.cuff,'none',t.trim,1.5);
    s+='</g>';
    if(t.cut&&t.cut.fur)s+=p(g.cuff,k==='coat'?a:k==='furcoat'?a:shade(f,.25),edge,1.3);
    if(t.cut&&t.cut.blouse)s+=p(g.cuff,'#ede4cf',edge,.8)+p(g.cuff,'none',t.originalFill,.9);
    return s;
  }

  // Third pass: deliberately different silhouettes, materials and construction.
  var ACCESSORY_REWORKS=['cap','beret','ushanka','hardhat','bowler','tophat','peaked','tankcap','shako','kokoshnik','tie','scarf','bowtie','jabot','badge'];
  function accessoryFill(c,name){return tailorMaterial(c,name||'accessory');}
  T.cap=function(c){var f=c0(c,0),b=c0(c,1),m=accessoryFill(f),p=tailorPath;
    return m.defs+p('M54 58Q55 39 83 33Q119 28 146 49L147 59Q100 71 54 58Z',m.fill,shade(f,-.6),2.8)+p('M54 58Q100 69 147 59L146 69Q97 78 55 67Z',shade(f,-.2),shade(f,-.6),2)+p('M91 69Q125 72 147 65Q164 70 150 77Q117 84 85 75Z',b,shade(f,-.6),2.2)+p('M94 73Q126 79 148 73','none',shade(b,.3),1.3)+p('M87 36Q86 50 92 59 M129 37Q128 49 133 60','none',shade(f,.22),1.2)+wardCircle(81,65,2,'#bba66f');};
  T.beret=function(c){var f=c0(c,0),m=accessoryFill(f),p=tailorPath;return m.defs+p('M56 58C43 48 55 35 76 31C108 24 139 30 149 44C159 60 134 69 91 67Z',m.fill,shade(f,-.6),2.8)+p('M60 58Q100 69 138 59L133 70Q99 77 66 68Z',shade(f,-.3),shade(f,-.6),1.8)+p('M102 29L105 21','none',shade(f,-.55),4)+p('M60 49Q67 38 88 36 M135 43Q140 52 125 58','none',shade(f,.25),1.7)+p('M80 58Q94 61 111 58','none',shade(f,-.25),1.2);};
  T.ushanka=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;var s=m.defs+p('M56 61Q53 27 97 25Q141 25 145 61L139 76H61Z',m.fill,shade(f,-.65),2.6)+p('M50 61Q40 83 48 103L63 106L66 67Z',a,shade(a,-.65),2.5)+p('M150 61Q160 83 152 103L137 106L134 67Z',a,shade(a,-.65),2.5)+p('M51 55Q100 42 149 55L148 73Q100 61 52 73Z',shade(a,.25),shade(a,-.65),2.5)+p('M77 32Q73 42 76 49 M123 32Q127 42 124 49','none',shade(f,.25),1.2);
    for(var x=57;x<145;x+=8)s+=p('M'+x+' 58l2 5 2-4','none',shade(a,-.15),1);for(var y=78;y<102;y+=7)s+=p('M49 '+y+'l5 2 3-3 M151 '+y+'l-5 2-3-3','none',shade(a,.2),1);return s+wardCircle(100,58,5,'#c7a760')+wardStar(100,58,3.2,'#c34b3c');};
  T.hardhat=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M54 65C55 42 72 30 93 28H108C131 32 145 45 146 65Z',m.fill,shade(a,-.5),2.8)+p('M90 29H111L114 64H87Z',shade(f,.17),shade(a,-.35),1.4)+p('M66 46L62 63 M133 46L138 63','none',shade(a,-.2),3)+p('M50 64Q100 71 150 64L155 72Q101 83 45 72Z',a,shade(a,-.5),2.3)+p('M57 70Q100 77 145 70','none',shade(f,.25),1.3)+p('M72 40Q79 36 85 36','none',shade(f,.5),2.2);};
  T.bowler=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M55 67Q51 60 40 65Q34 72 54 77Q100 90 147 77Q166 73 160 65Q150 61 146 67Z',shade(f,-.2),shade(f,-.65),2.5)+p('M63 69L64 49C64 28 80 19 100 19C121 19 137 28 137 49L138 69Q100 79 63 69Z',m.fill,shade(f,-.65),2.7)+p('M64 58Q100 68 137 58L138 69Q100 80 63 69Z',a,shade(f,-.6),1.4)+p('M73 42Q75 31 87 28','none',shade(f,.27),2.1)+p('M48 72Q100 89 151 72','none',shade(f,.22),1);};
  T.tophat=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M52 64Q100 55 149 64Q167 71 151 78Q100 91 48 78Q34 71 52 64Z',shade(f,-.1),shade(f,-.65),2.5)+p('M62 14Q100 6 139 14L132 68Q100 79 69 68Z',m.fill,shade(f,-.65),2.6)+p('M62 14Q100 1 139 14Q102 24 62 14Z',shade(f,.12),shade(f,-.65),2)+p('M68 53Q100 63 134 53L132 68Q100 79 69 68Z',a,shade(f,-.6),1.2)+p('M74 26L77 49','none',shade(f,.26),2)+p('M49 73Q100 85 151 72','none',shade(f,.22),1);};
  T.peaked=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M49 51Q61 29 100 28Q139 29 151 51L145 61Q100 70 55 61Z',m.fill,shade(f,-.6),2.7)+p('M55 59Q100 66 145 59L144 72Q100 79 56 72Z',a,shade(f,-.65),2)+p('M66 72Q100 84 136 72Q138 81 125 86Q100 93 75 86Q62 81 66 72Z','#272b2c','#171c1d',2)+p('M74 79Q100 88 126 79','none','#596166',1.5)+p('M64 65Q100 74 137 65','none','#d1b36b',1.9)+wardCircle(100,60,6,'#d1b36b')+wardStar(100,60,3.7,'#a43230');};
  T.tankcap=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;var s=m.defs+p('M55 81L54 57Q59 22 100 22Q143 22 146 57L145 88L133 99L126 79Q100 69 75 79L68 99L53 90Z',m.fill,shade(a,-.5),2.7);
    for(var x=70;x<=130;x+=20)s+=p('M'+x+' 34Q'+(x-8)+' 47 '+(x-3)+' 69','none',a,7)+p('M'+x+' 34Q'+(x-8)+' 47 '+(x-3)+' 69','none',shade(f,.24),3.7);
    s+=p('M54 59Q61 55 69 61L70 89Q59 101 50 88Z',a,shade(a,-.6),2)+p('M146 59Q139 55 131 61L130 89Q141 101 150 88Z',a,shade(a,-.6),2)+p('M55 70L55 85 M145 70L145 85','none',shade(f,.25),3)+p('M69 90Q100 104 131 90','none',a,3);return s;};
  T.shako=function(c){var f=c0(c,0),g=c0(c,1),white=c0(c,2),m=accessoryFill(f),p=tailorPath;var s=m.defs+p('M68 9Q100 2 132 9L139 65Q100 77 61 65Z',m.fill,shade(f,-.65),2.8)+p('M67 10Q100 17 133 10 M63 61Q100 72 137 61','none',g,4)+p('M78 29Q64 50 100 62Q136 50 122 29','none',shade(g,-.3),4)+p('M78 28Q64 49 100 61Q136 49 122 28','none',g,2.4)+p('M70 69Q100 81 130 69Q143 76 128 82Q100 90 72 82Q57 76 70 69Z','#262326',shade(f,-.65),2)+wardStar(100,38,10,g)+wardCircle(100,38,3,'#a13932');
    s+=p('M117 11C132 7 145 0 140-4C124-4 113 2 117 11Z',white,shade(white,-.4),1.6)+p('M118 9Q129 3 138-1','none',shade(white,-.25),1)+wardCircle(118,11,4,g);return s;};
  T.kokoshnik=function(c){var f=c0(c,0),g=c0(c,1),m=accessoryFill(f),p=tailorPath;var s=m.defs+p('M46 73C39 42 64 16 100 9C136 16 161 42 154 73Q100 54 46 73Z',m.fill,shade(f,-.6),2.7)+p('M51 66Q45 39 100 16Q154 39 149 66','none',g,2.4)+p('M51 69Q100 52 149 69','none',g,5);
    for(var i=0;i<9;i++){var x=59+i*10,y=61-Math.sin(i/8*Math.PI)*9;s+=wardCircle(x,y,2.4,'#f5e9ce');}
    [66,83,100,117,134].forEach(function(x,i){var y=45-Math.sin(i/4*Math.PI)*15;s+=p('M'+x+' '+(y-8)+'q-7 8 0 16q7-8 0-16Z',g,shade(g,-.4),.7)+wardCircle(x,y,2,'#ab3450');});
    return s+p('M57 74Q55 88 62 99 M143 74Q145 88 138 99','none','#f5e9ce',2);};
  T.tie=function(c){var f=c0(c,0),m=accessoryFill(f),p=tailorPath;return m.defs+p('M65 116Q100 133 135 116L130 128Q115 135 104 138L96 138Q84 136 70 128Z',m.fill,shade(f,-.55),2)+p('M96 134L104 134L110 143L104 146L110 173L100 165L89 179L94 146L90 141Z',m.fill,shade(f,-.55),2)+p('M100 143L96 166 M104 148L106 163','none',shade(f,.26),1.2);};
  T.scarf=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath,cl=uid('scarf');var tail='M110 130L132 133L129 178L116 184L108 178Z',s=m.defs+'<defs><clipPath id="'+cl+'"><path d="'+tail+'"/></clipPath></defs>'+p(tail,m.fill,shade(f,-.6),2.2)+'<g clip-path="url(#'+cl+')">';for(var y=138;y<179;y+=13)s+=p('M103 '+y+'H138','none',a,5);s+='</g>'+p('M62 117Q100 135 138 117L137 133Q100 151 63 133Z',m.fill,shade(f,-.6),2.3)+p('M64 122Q100 140 136 122','none',a,4)+p('M76 136Q90 141 100 139','none',shade(f,.25),1.4);for(var x=110;x<132;x+=4)s+=p('M'+x+' 176v9','none',f,1.7);return s;};
  T.bowtie=function(c){var f=c0(c,0),m=accessoryFill(f),p=tailorPath;return m.defs+p('M66 119Q79 117 96 130L96 142Q81 153 67 149Q63 135 66 119Z M134 119Q121 117 104 130L104 142Q119 153 133 149Q137 135 134 119Z',m.fill,shade(f,-.6),2.2)+p('M74 126L94 135L75 142 M126 126L106 135L125 142','none',shade(f,.27),1.3)+'<rect x="94" y="127" width="12" height="19" rx="4" fill="'+shade(f,.13)+'" stroke="'+shade(f,-.65)+'" stroke-width="1.8"/>';};
  T.jabot=function(c){var f=c0(c,0),p=tailorPath,s='';for(var i=3;i>=0;i--){var y=123+i*12,w=30-i*5;s+=p('M'+(100-w)+' '+y+'Q100 '+(y-7)+' '+(100+w)+' '+y+'L'+(100+w+3)+' '+(y+13)+'Q'+(100+w/2)+' '+(y+10)+' 100 '+(y+16)+'Q'+(100-w/2)+' '+(y+10)+' '+(100-w-3)+' '+(y+13)+'Z',shade(f,-i*.025),'#aaa599',1.5)+p('M94 '+y+'L92 '+(y+9)+' M106 '+y+'L108 '+(y+9),'none','#d5d0c6',1); }return s+wardCircle(100,124,3,'#cab278');};
  T.badge=function(c){var g=c0(c,0),red=c0(c,1),m=accessoryFill(g),p=tailorPath;return m.defs+p('M89 123H111L115 137L100 154L85 137Z',m.fill,shade(g,-.55),2)+p('M91 126H109L111 136L100 148L89 136Z',red,shade(red,-.4),1)+p('M94 136L99 141L107 130','none','#fff0c9',2.1)+p('M95 122V117H105V122','none',shade(g,-.25),2);};

  // Fourth pass: the remaining soft hats, paper/metal novelties, and eyewear.
  T.skullcap=function(c){var f=c0(c,0),m=accessoryFill(f),p=tailorPath;return m.defs+p('M58 62C56 44 73 29 100 29C127 29 144 44 142 62Q100 77 58 62Z',m.fill,shade(f,-.6),2.4)+p('M59 59Q100 72 141 59L141 65Q100 79 59 65Z',shade(f,-.22),shade(f,-.6),1.5)+p('M100 31Q91 45 97 63 M74 38Q68 49 73 63 M126 38Q133 49 128 63','none',shade(f,.22),1.1);};
  T.kolpak=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M57 64Q60 33 89 21Q116 12 136 30Q143 39 150 43Q130 48 121 35Q123 53 142 64Z',m.fill,shade(f,-.6),2.4)+p('M57 62Q100 73 142 62L143 72Q100 83 56 72Z',a,shade(f,-.6),2)+p('M87 29Q78 42 79 57 M117 26Q110 40 119 54','none',shade(f,.25),1.5)+wardCircle(149,45,4,a);};
  T.kerchief=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath,s=m.defs+p('M54 80Q48 33 100 24Q150 31 147 82L139 91Q133 63 100 59Q67 63 60 91Z',m.fill,shade(f,-.6),2.4)+p('M139 78Q156 76 160 88L148 101L139 89L132 103L129 84Z',f,shade(f,-.6),2)+p('M60 69Q100 46 141 70','none',shade(f,.35),2);
    if(a!==f)for(var i=0;i<7;i++)s+=wardCircle(66+i*11,44+Math.abs(i-3)*3,2.3,a);return s+p('M145 84L151 90 M136 87L133 97','none',shade(f,-.3),1.2);};
  T.pilotka=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M59 59L79 33Q100 39 123 33L141 59Q100 74 59 59Z',m.fill,shade(f,-.6),2.5)+p('M64 55L82 40Q100 47 120 40L136 55Q100 66 64 55Z',shade(f,.12),shade(f,-.4),1.5)+p('M80 35Q100 43 123 35','none',shade(f,-.55),2)+wardStar(100,56,5,a);};
  T.panama=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M60 58Q44 61 42 70Q100 91 158 70Q155 62 140 58Z',shade(a,-.12),shade(f,-.6),2.3)+p('M62 61L70 33Q100 24 130 33L138 61Q100 74 62 61Z',m.fill,shade(f,-.6),2.4)+p('M72 35Q100 43 128 35 M65 58Q100 70 135 58 M51 69Q100 83 150 69','none',shade(f,-.25),1.1)+p('M84 39L81 61 M116 39L119 61','none',shade(f,.3),1.1);};
  T.panamaege=function(c){return T.panama(c)+tailorPath('M65 53Q100 64 135 53L137 63Q100 76 63 63Z',c[2]||'#365d99',OUT,1)+'<text x="100" y="64" text-anchor="middle" font-size="7" font-family="Arial" font-weight="bold" fill="#fff">Я СДАМ ЕГЭ</text>';};
  T.budenovka=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M57 65Q61 39 88 21L100 5L112 21Q139 39 143 65L149 88L136 94L130 71Q100 79 70 71L64 94L51 88Z',m.fill,shade(f,-.6),2.4)+p('M100 8V52 M88 23Q78 38 76 56 M112 23Q122 38 124 56','none',shade(f,.27),1.3)+p('M55 63Q100 76 145 63L145 71Q100 84 55 71Z',shade(f,-.2),shade(f,-.6),1.5)+wardStar(100,48,11,a);};
  function furHat(c,tall){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath,top=tall?5:18,clip=uid('furhat'),d='M57 65L61 '+top+'Q100 '+(top-9)+' 139 '+top+'L143 65Q100 80 57 65Z',s=m.defs+'<defs><clipPath id="'+clip+'"><path d="'+d+'"/></clipPath></defs>'+p(d,m.fill,shade(f,-.65),2.5)+'<g clip-path="url(#'+clip+')">';for(var y=top+4;y<72;y+=8)for(var x=59;x<145;x+=9)s+=p('M'+x+' '+y+'q-4-5 1-5q6 1 3 6','none',shade(f,(x+y)%2?.19:-.25),1.2);return s+'</g>'+p('M60 63Q100 77 140 63','none',a,4)+p('M69 '+top+'Q100 '+(top+8)+' 132 '+top,'none',a,2);}
  T.tallfur=function(c){return furHat(c,true);};T.papakha=function(c){return furHat(c,false);};
  T.jester=function(c){var f=c0(c,0),a=c0(c,1),p=tailorPath,m=accessoryFill(f);return m.defs+p('M56 65Q55 47 35 44L28 53Q25 26 49 29Q66 29 79 50Q76 23 91 4Q112 20 111 49Q130 21 153 32Q171 40 170 53L159 47Q144 49 143 65Q100 80 56 65Z',m.fill,shade(f,-.6),2.5)+p('M91 5Q101 28 96 61L113 60Q105 31 91 5Z',a,shade(f,-.4),1.3)+p('M57 62Q100 75 142 62','none',a,6)+wardCircle(28,53,4.5,'#e4bd59')+wardCircle(91,5,4.5,'#e4bd59')+wardCircle(170,53,4.5,'#e4bd59');};
  T.foilhat=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M57 65L99 7L108 29L128 43L143 65Q100 81 57 65Z',m.fill,shade(a,-.4),2.2)+p('M99 8L83 43L109 33L98 66 M83 43L65 62L98 66 M109 33L127 44L119 68Z',shade(f,.28),a,1.3)+p('M58 65Q100 79 143 65L143 72Q100 84 57 72Z',shade(f,-.2),a,1.5)+p('M99 17L93 32 M70 64L83 67','none','#fff',2);};
  T.sidecap=function(c){var f=c0(c,0),a=c0(c,1),m=accessoryFill(f),p=tailorPath;return m.defs+p('M58 64Q54 36 90 27Q128 20 141 58L138 68Q100 83 58 64Z',m.fill,shade(f,-.6),2.4)+p('M100 27Q107 40 108 66 M73 34Q73 48 77 66','none',shade(f,.28),1.5)+p('M128 61Q154 52 175 64Q169 79 139 76L121 70Z',a,shade(f,-.6),2.3)+p('M133 67Q156 61 170 66','none',shade(a,.3),1.3)+p('M59 62Q91 77 126 67','none',shade(f,-.4),3)+wardCircle(97,26,3,a);};
  T.bucket=function(c){var f=c0(c,0),a=c0(c,1,'#6b7b88'),m=accessoryFill(f),p=tailorPath;return m.defs+p('M59 67L69 15Q100 5 131 15L141 67Q100 80 59 67Z',m.fill,shade(a,-.35),2.5)+p('M70 16Q100 25 130 16 M65 39Q100 50 135 39 M61 61Q100 75 139 61','none',a,2)+p('M80 24L74 59','none','#fff',3)+p('M60 64C54 111 146 111 140 64','none',shade(a,-.2),2.5)+wardCircle(61,64,3,a)+wardCircle(139,64,3,a);};
  T.headphones=function(c){var f=c0(c,0),a=c0(c,1),p=tailorPath,m=accessoryFill(f);return m.defs+p('M51 89V71C51 21 149 21 149 71V89','none',shade(f,-.7),10)+p('M51 89V71C51 21 149 21 149 71V89','none',shade(f,.25),6)+p('M70 43Q100 29 130 43','none',a,2)+[48,152].map(x=>'<rect x="'+(x-10)+'" y="73" width="20" height="35" rx="7" fill="'+m.fill+'" stroke="'+shade(f,-.6)+'" stroke-width="2.3"/><rect x="'+(x-5)+'" y="78" width="10" height="25" rx="4" fill="'+shade(f,-.3)+'" stroke="'+a+'" stroke-width="1.2"/>').join('')+p('M143 107Q135 117 122 117','none',f,3)+p('M121 117h-6','none',a,4);};
  function lens(cx,cy,rx,ry,c,dark){return '<ellipse cx="'+cx+'" cy="'+cy+'" rx="'+rx+'" ry="'+ry+'" fill="'+(dark?'#263844':'#b7d3da')+'" fill-opacity="'+(dark?'.94':'.2')+'" stroke="'+c+'" stroke-width="2.4"/>'+tailorPath('M'+(cx-rx*.55)+' '+(cy-ry*.3)+'l'+rx*.5+' '+(-ry*.3),'none','#fff',1.4);}
  T.roundglasses=function(c){var f=c0(c,0);return lens(82,90,13,12,f)+lens(118,90,13,12,f)+tailorPath('M95 89Q100 85 105 89 M69 87L55 83 M131 87L145 83','none',f,2.5);};
  T.shades=function(c){var f=c0(c,0),p=tailorPath;return p('M65 80Q81 76 97 82L95 96Q83 105 69 97Z M135 80Q119 76 103 82L105 96Q117 105 131 97Z','#24333f',f,3)+p('M97 83Q100 81 103 83 M65 83L54 80 M135 83L146 80','none',f,3)+p('M72 84L83 81 M110 87L121 82','none','#b5d7df',1.6);};
  T.pincenez=function(c){var f=c0(c,0);return lens(82,90,12,10,f)+lens(118,90,12,10,f)+tailorPath('M94 87Q100 77 106 87 M129 94Q145 112 131 130','none',f,1.7);};
  T.monocle=function(c){var f=c0(c,0);return lens(118,90,13,13,f)+tailorPath('M130 97C144 115 141 134 129 142','none',f,1.5)+wardCircle(130,97,2.3,f);};
  T.goggles=function(c){var f=c0(c,0),a=c0(c,1),p=tailorPath;return p('M53 87H147','none',shade(f,-.25),8)+[82,118].map(x=>'<rect x="'+(x-17)+'" y="75" width="34" height="29" rx="12" fill="'+f+'" stroke="'+shade(f,-.6)+'" stroke-width="2"/>'+lens(x,89,12,10,a,true)).join('')+p('M97 86Q100 82 103 86','none',f,5);};
  T.eyepatch=function(c){var f=c0(c,0),p=tailorPath;return p('M55 65L144 108 M60 113L139 66','none',f,2.5)+p('M68 81Q82 74 95 82L94 96Q82 105 70 97Z',f,shade(f,-.6),2)+p('M73 84Q82 81 90 84','none',shade(f,.3),1.2);};

  // The opening of each hat is fitted to a head cross-section, not its outer box.
  // Values: opening centre Y, half opening width, highest point of the drawing.
  var HAT_OPENING={skullcap:[64,42,29],kolpak:[67,43,16],kerchief:[65,44,24],cap:[70,44,30],pilotka:[61,40,32],beret:[69,38,20],ushanka:[65,46,24],panama:[65,40,29],hardhat:[72,46,27],bowler:[77,38,18],wreath:[52,43,25],helmet:[67,44,6],budenovka:[65,44,5],tallfur:[66,40,4],kokoshnik:[64,47,8],tricorn:[66,44,35],tophat:[73,33,7],peaked:[73,44,27],tankcap:[69,43,21],jester:[65,43,3],shako:[72,39,-5],klobuk:[63,45,1],papakha:[65,43,14],crown:[68,45,-10],bicorne:[66,44,12],laurel:[57,43,22],monomakh:[68,44,-9],foilhat:[67,43,5],sidecap:[67,43,23],panamaege:[65,40,29],papercrown:[64,40,25],bucket:[67,41,12],whitebangs:[65,45,30]};
  function fitSkull(svg,kind,sp){
    // Squid's tall dome is tucked INSIDE closed hats. Open crowns, wreaths,
    // hair and transparent visors must retain the full underlying head.
    if(sp!=='squid'||!HAT_OPENING[kind]||['wreath','laurel','crown','papercrown','kokoshnik','whitebangs','pilotka'].indexOf(kind)>=0)return svg;
    var clip=uid('hat-skull');return '<defs><clipPath id="'+clip+'"><path d="M0 55H200V210H0Z"/></clipPath></defs><g class="fitted-skull" clip-path="url(#'+clip+')">'+svg+'</g>';
  }
  function fittedSpaceHelmet(sp,stage,c){
    var tall=(sp==='squid'&&squidChad(stage))||sp==='tsar'&&stage!=='baby'&&stage!=='teen';
    var top=sp==='dragon'?0:sp==='squid'?5:8,bottom=tall?168:sp==='burunday'?153:145;
    var rx=sp==='squid'?66:sp==='hedgehog'&&stage!=='baby'?73:sp==='dragon'?69:65;
    var cy=(top+bottom)/2,ry=(bottom-top)/2,id=uid('fitted-visor'),p=tailorPath,f=c0(c,0,'#f4f4f4'),a=c0(c,1,'#c43c38');
    return '<g class="fitted-head fitted-spacehelm"><defs><linearGradient id="'+id+'"><stop stop-color="#b7dce6" stop-opacity=".10"/><stop offset="1" stop-color="#6c98b0" stop-opacity=".20"/></linearGradient></defs><ellipse cx="100" cy="'+cy+'" rx="'+rx+'" ry="'+ry+'" fill="url(#'+id+')" stroke="#657a84" stroke-width="2.5"/>'+p('M'+(100-rx*.68)+' '+(top+ry*.3)+'Q100 '+(top-ry*.28)+' '+(100+rx*.68)+' '+(top+ry*.3),'none',f,6)+p('M'+(100-rx*.81)+' '+(cy-ry*.37)+'Q'+(100-rx*.97)+' '+cy+' '+(100-rx*.83)+' '+(cy+ry*.3),'none','#fff',3)+p('M70 '+(bottom-8)+'Q100 '+(bottom+3)+' 130 '+(bottom-8)+'L130 '+(bottom+1)+'Q100 '+(bottom+12)+' 70 '+(bottom+1)+'Z',f,'#435967',2)+p('M73 '+(bottom-2)+'Q100 '+(bottom+7)+' 127 '+(bottom-2),'none',a,2.7)+[100-rx,100+rx].map(x=>'<rect x="'+(x-5)+'" y="'+(cy-8)+'" width="10" height="23" rx="4" fill="'+f+'" stroke="#435967" stroke-width="2"/>').join('')+'</g>';
  }
  function fitHeadArt(svg,kind,sp,stage,c){
    var human=!!HUMAN[sp]||sp==='burunday',sq=sp==='squid';
    if(kind==='spacehelm')return fittedSpaceHelmet(sp,stage,c||[]);
    if(kind==='headphones')return '<g class="fitted-head" transform="translate(100 '+(sq?79:89)+') scale('+(sq?'1.2 1.08':human?'.94 1':'1 1')+') translate(-100 -89)">'+svg+'</g>';
    if(kind==='halo'||kind==='horns')return '<g class="fitted-head" transform="translate(100 '+(sq?24:45)+') scale('+(sq?1.15:1)+') translate(-100  -45)">'+svg+'</g>';
    var a=HAT_OPENING[kind];if(!a)return svg;
    var y=sq?60:human?62:stage==='baby'?66:64;
    var radius=sq?55:human?39:stage==='baby'?40:43;
    var sx=radius/a[1],sy=Math.min(1,(y-8)/(a[0]-a[2]));
    // Brimmed hats need a wide opening but not an equally tall crown.
    return '<g class="fitted-head" data-head="'+sp+'-'+stage+'" transform="translate(100 '+y+') scale('+sx+' '+sy+') translate(-100 '+(-a[0])+')">'+svg+'</g>';
  }
  function fitFaceArt(svg,kind,sp,stage){
    if(['roundglasses','shades','pincenez','monocle','goggles','thug','eyepatch'].indexOf(kind)<0)return svg;
    var sq=sp==='squid',human=!!HUMAN[sp]||sp==='burunday';
    var eyeY=sq?92:human?92:stage==='baby'?91:90;
    return '<g class="fitted-face" transform="translate(100 '+eyeY+') scale('+(sq?14/18:human?19/18:stage==='baby'?1:19/18)+' 1) translate(-100 -90)">'+svg+'</g>';
  }

  var DRAW_ITEM=null;
  function renderItem(item,opts){var old=DRAW_ITEM;DRAW_ITEM=item;try{return renderItemBase(item,opts);}finally{DRAW_ITEM=old;}}
  TAILORED.forEach(function(kind){ if ({ mantle: 1, firecloak: 1 }[kind]) return; T[kind]=function(c){
    var previous=Tailor;Tailor={kind:kind,anat:'v3',w:34,y:106,h:62,fill:c[0]||'#657889',accent:c[1]||'#e7d8b8',it:DRAW_ITEM||{rarity:'common',art:{c:c}}};tailorConfigure(Tailor);
    var s=tailorBody()+tailorArm('l','#e5e3dc','#605951')+tailorArm('r','#e5e3dc','#605951');Tailor=previous;return '<g transform="translate(100 118) scale(1.05) translate(-100 -106)">'+s+'</g>';
  };});
  // ── Наши правки к мастерской (30.09.2026) ────────────────────────────────
  // Мантия и плащ Жар-птицы — наши, их владелец отдельно одобрил; у Сквидварда
  // анатомический крой раздувал рукава «фонариками» поверх щупалец — у него
  // остаётся прежняя одежда. Кольчуга — с рукавом до локтя, ниже видна лапа.
  var TAILOR_KEEP = { mantle: 1, firecloak: 1 };
  var SHORT_SLEEVE = { mail: 1 };
  var ELBOW = { bur: 124, human: 126, v3: 128, v3Owl: 128, baby: 146, babyOwl: 146, squid: 127, squidChad: 150 };
  var tailorArmFull = tailorArm;
  tailorArm = function (side, fill, ink) {
    if (!Tailor || !SHORT_SLEEVE[Tailor.kind]) return tailorArmFull(side, fill, ink);
    var t = Tailor, g = TAILOR_ARMS[t.anat], e = ELBOW[t.anat] || 128, r = side === 'r';
    var A = ANAT[t.anat], pw = paw({ paw: [r ? A.paw[0] : 200 - A.paw[0], A.paw[1]], skin: A.skin, wing: A.wing }, fill, ink, false);
    var full = tailorArmFull(side, fill, ink);
    var sleeve = full.slice(-pw.length) === pw ? full.slice(0, full.length - pw.length) : full;
    var mirror = r ? ' transform="translate(200 0) scale(-1 1)"' : '';
    var top = uid('elbow'), arm = uid('forearm');
    return '<defs><clipPath id="' + top + '"><rect x="0" y="0" width="200" height="' + e + '"/></clipPath><clipPath id="' + arm + '"><path d="' + g.d + '"/></clipPath></defs>' +
      '<g' + mirror + '>' + tailorPath(g.d, fill, ink || OUT, 2.15) + '</g>' +
      '<g clip-path="url(#' + top + ')">' + sleeve + '</g>' +
      '<g' + mirror + '><g clip-path="url(#' + arm + ')"><path d="M20 ' + e + ' H120" stroke="#705332" stroke-width="3.2"/><path d="M20 ' + (e - 1.2) + ' H120" stroke="#c49b58" stroke-width="1"/></g></g>' + pw;
  };

  window.PetArt = { signatures: signaturesOf, SIGNATURES: SIGNATURES, render: render, renderItem: renderItem, templates: T, species: SPECIES, icons: ICONS, shade: shade, stageScale: STAGE_SCALE };
})();
