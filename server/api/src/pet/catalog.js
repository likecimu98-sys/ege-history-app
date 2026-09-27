'use strict';

// Каталог «Летописчика» — ЕДИНСТВЕННЫЙ источник правды о вещах, ценах и шансах.
//
// Клиент получает его целиком через GET /api/v1/pet/catalog и сам ничего не
// считает: цена, редкость и содержимое коробок живут только здесь. Рисунок
// вещи клиент строит по полю art: [шаблон, палитра] — шаблоны лежат в
// pet-art.js, и tools-and-docs/pet-catalog.selftest.js сверяет, что у каждой
// вещи каталога шаблон есть. Добавляешь вещь — добавь и шаблон, иначе тест
// упадёт раньше, чем ученик увидит пустое место.
//
// 🔴 Монеты за настоящие деньги НЕ продаются — ни сейчас, ни «потом докрутим».
// Коробки со случайным выпадением за реальные деньги для несовершеннолетних —
// это уже азартная механика с юридическими последствиями. Всё, что здесь стоит,
// оплачивается только решёнными заданиями.

const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const RARITY_LABEL = {
  common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное', mythic: 'Мифическое',
};
// Номинал редкости — во что превращается повтор вещи без собственной цены
// (мифические из коробок) и сколько стоит вещь «по справочнику».
const RARITY_VALUE = { common: 100, rare: 500, epic: 2000, legendary: 8000, mythic: 20000 };
const DUPLICATE_SHARE = 0.4;

const SLOTS = ['bg', 'pet', 'body', 'neck', 'head', 'face', 'hand', 'aura'];
const SLOT_LABEL = {
  head: 'Головной убор', body: 'Одежда', face: 'Лицо', neck: 'Шея', hand: 'В руке',
  bg: 'Место', pet: 'Спутник', aura: 'Сияние',
};

const SPECIES = [
  { id: 'kitten', name: 'Котёнок' },
  { id: 'owl', name: 'Совёнок' },
  { id: 'hedgehog', name: 'Ёжик' },
  { id: 'dragon', name: 'Дракончик' },
];

// [id, слот, редкость, цена|null (только из коробок), название, эпоха, [шаблон, ...цвета]]
const RAW = [
  // ── Головные уборы (30) ───────────────────────────────────────────────
  ['hat_skufya', 'head', 'common', 60, 'Скуфья', 'Русь', ['skullcap', '#2b2b33']],
  ['hat_kolpak', 'head', 'common', 70, 'Крестьянский колпак', 'Русь', ['kolpak', '#b8322a', '#8a241e']],
  ['hat_platok', 'head', 'common', 70, 'Платок в горошек', 'XIX век', ['kerchief', '#2f63c9', '#ffffff']],
  ['hat_kartuz', 'head', 'common', 90, 'Картуз', 'XIX век', ['cap', '#3a3f4a', '#23262d']],
  ['hat_pilotka', 'head', 'common', 100, 'Пилотка', 'XX век', ['pilotka', '#6f7a3e', '#c9302c']],
  ['hat_beret', 'head', 'common', 90, 'Берет художника', 'XX век', ['beret', '#7a2a44']],
  ['hat_ushanka', 'head', 'common', 120, 'Ушанка', 'XX век', ['ushanka', '#6b5a48', '#3f342a']],
  ['hat_panama', 'head', 'common', 80, 'Пионерская панама', 'СССР', ['panama', '#f4f1e6', '#d9d2bd']],
  ['hat_kaska', 'head', 'common', 110, 'Каска строителя БАМа', 'СССР', ['hardhat', '#f2b705', '#d19d00']],
  ['hat_kotelok', 'head', 'common', 130, 'Шляпа-котелок', 'XIX век', ['bowler', '#1f1f24', '#8a6b3b']],
  ['hat_venok', 'head', 'common', 90, 'Купальский венок', 'Русь', ['wreath', '#3f9a3a', '#f5d547', '#e0503a']],
  ['hat_kosynka', 'head', 'common', 100, 'Красная косынка', '1920-е', ['kerchief', '#d0342c', '#d0342c']],
  ['hat_shlem', 'head', 'rare', 450, 'Шлем витязя', 'Русь', ['helmet', '#9aa3ad', '#c9a24a']],
  ['hat_budenovka', 'head', 'rare', 400, 'Будёновка', '1920-е', ['budenovka', '#6c6f5a', '#c62828']],
  ['hat_gorlatnaya', 'head', 'rare', 550, 'Горлатная шапка', 'Московское царство', ['tallfur', '#5a3b26', '#a0322c']],
  ['hat_kokoshnik', 'head', 'rare', 500, 'Кокошник', 'Московское царство', ['kokoshnik', '#b32142', '#f2c14e']],
  ['hat_treugolka', 'head', 'rare', 600, 'Треуголка', 'Петровская эпоха', ['tricorn', '#1f2a44', '#e8c35a']],
  ['hat_cylinder', 'head', 'rare', 380, 'Цилиндр', 'XIX век', ['tophat', '#15151a', '#7a1f2b']],
  ['hat_furazhka', 'head', 'rare', 350, 'Фуражка', 'XX век', ['peaked', '#355e3b', '#c62828']],
  ['hat_shlemofon', 'head', 'rare', 420, 'Шлемофон танкиста', 'Великая Отечественная', ['tankcap', '#3b3226', '#1f1a14']],
  ['hat_skomoroh', 'head', 'rare', 300, 'Колпак скомороха', 'Русь', ['jester', '#e0503a', '#f2c14e']],
  ['hat_kiver', 'head', 'epic', 1800, 'Кивер 1812 года', '1812', ['shako', '#15151a', '#e8c35a', '#ffffff']],
  ['hat_klobuk', 'head', 'epic', 2200, 'Белый клобук', 'Московское царство', ['klobuk', '#f7f7f2', '#d8c26a']],
  ['hat_cosmo', 'head', 'epic', 2800, 'Шлем космонавта', 'Космос', ['spacehelm', '#f4f4f4', '#cc2d2d', '#7fc8f8']],
  ['hat_papaha', 'head', 'epic', 1600, 'Папаха', 'XIX век', ['papakha', '#3a3a3a', '#b02a2a']],
  ['hat_ermak', 'head', 'epic', 2400, 'Шлем Ермака', 'Покорение Сибири', ['helmet', '#b5bcc4', '#e8c35a']],
  ['hat_imperial', 'head', 'legendary', 12000, 'Большая императорская корона', 'Империя', ['crown', '#e9c46a', '#c0c7d0', '#b3123a']],
  ['hat_bicorne', 'head', 'legendary', 7000, 'Двууголка Кутузова', '1812', ['bicorne', '#15151a', '#e8c35a']],
  ['hat_laurel', 'head', 'legendary', 9000, 'Лавровый венок', 'Античность', ['laurel', '#e9c46a', '#b8912f']],
  ['hat_monomakh', 'head', 'mythic', 50000, 'Шапка Мономаха', 'Московское царство', ['monomakh', '#e9c46a', '#6b3f22', '#1d8a5a']],

  // ── Одежда (26) ───────────────────────────────────────────────────────
  ['body_kosovorotka', 'body', 'common', 80, 'Косоворотка', 'Русь', ['shirt', '#e9e2cf', '#c0392b']],
  ['body_tulup', 'body', 'common', 120, 'Тулуп', 'Русь', ['coat', '#a0784f', '#efe3cf']],
  ['body_telnyashka', 'body', 'common', 100, 'Тельняшка', 'XX век', ['stripes', '#ffffff', '#1f3a8a']],
  ['body_school', 'body', 'common', 120, 'Школьная форма СССР', 'СССР', ['uniform', '#3d4f6d', '#c9a24a']],
  ['body_pioneer', 'body', 'common', 110, 'Пионерская рубашка', 'СССР', ['shirt', '#ffffff', '#d0342c']],
  ['body_vatnik', 'body', 'common', 90, 'Ватник', 'XX век', ['quilt', '#4a5540', '#39422f']],
  ['body_sarafan', 'body', 'common', 110, 'Сарафан', 'Русь', ['dress', '#c0392b', '#f2c14e']],
  ['body_sviter', 'body', 'common', 130, 'Свитер с оленями', 'СССР', ['sweater', '#b3202a', '#ffffff']],
  ['body_fartuk', 'body', 'common', 70, 'Фартук мастерового', 'XIX век', ['apron', '#8a6a44', '#d9c6a5']],
  ['body_hoodie', 'body', 'common', 150, 'Худи «Решаю историю»', 'Наши дни', ['hoodie', '#2b2f3a', '#f2c14e']],
  ['body_kolchuga', 'body', 'rare', 500, 'Кольчуга', 'Русь', ['mail', '#9aa3ad', '#6b737c']],
  ['body_streletz', 'body', 'rare', 550, 'Кафтан стрельца', 'Московское царство', ['kaftan', '#b32121', '#e8c35a']],
  ['body_frak', 'body', 'rare', 450, 'Фрак', 'XIX век', ['tailcoat', '#15151a', '#ffffff']],
  ['body_gimnast', 'body', 'rare', 400, 'Гимнастёрка', 'Великая Отечественная', ['tunic', '#6f7a3e', '#c9a24a']],
  ['body_kozhanka', 'body', 'rare', 600, 'Кожанка комиссара', '1920-е', ['leather', '#26211d', '#4a3f36']],
  ['body_shinel', 'body', 'rare', 650, 'Шинель', 'XX век', ['greatcoat', '#5d6254', '#c9a24a']],
  ['body_ryasa', 'body', 'rare', 350, 'Ряса летописца', 'Русь', ['robe', '#23232a', '#3a3a44']],
  ['body_matroska', 'body', 'rare', 380, 'Матроска', 'XX век', ['sailor', '#ffffff', '#1f3a8a']],
  ['body_preobr', 'body', 'epic', 2200, 'Мундир Преображенского полка', 'Петровская эпоха', ['guard', '#1d5a34', '#c0392b', '#e8c35a']],
  ['body_gusar', 'body', 'epic', 2600, 'Доломан гусара', '1812', ['hussar', '#7a1426', '#e8c35a']],
  ['body_shuba', 'body', 'epic', 2000, 'Боярская шуба', 'Московское царство', ['furcoat', '#7a2436', '#6b4a2f', '#e8c35a']],
  ['body_skafandr', 'body', 'epic', 3000, 'Скафандр', 'Космос', ['spacesuit', '#f4f4f4', '#cc2d2d']],
  ['body_laty', 'body', 'epic', 2400, 'Латы крестоносца', 'Ледовое побоище', ['plate', '#c3cad2', '#ffffff', '#15151a']],
  ['body_mantle', 'body', 'legendary', 14000, 'Мантия Екатерины', 'Империя', ['mantle', '#e9c46a', '#ffffff', '#15151a']],
  ['body_marshal', 'body', 'legendary', 9000, 'Маршальский мундир', 'XX век', ['marshal', '#2f4a36', '#e9c46a', '#c62828']],
  ['body_firecloak', 'body', 'mythic', null, 'Плащ из перьев Жар-птицы', 'Сказка', ['firecloak', '#ff7b00', '#ffd23f', '#e0341a']],

  // ── Лицо (14) ────────────────────────────────────────────────────────
  ['face_glasses', 'face', 'common', 60, 'Круглые очки', 'XX век', ['roundglasses', '#2b2b33']],
  ['face_sunglasses', 'face', 'common', 90, 'Тёмные очки', 'Наши дни', ['shades', '#111111']],
  ['face_blush', 'face', 'common', 50, 'Румянец', 'Русь', ['blush', '#ff7a8a']],
  ['face_usiki', 'face', 'common', 70, 'Усики', 'XIX век', ['mustache', '#3a2a1e', 'thin']],
  ['face_plaster', 'face', 'common', 50, 'Пластырь после дуэли', 'Наши дни', ['plaster', '#f1c79b']],
  ['face_freckles', 'face', 'common', 60, 'Веснушки', 'Наши дни', ['freckles', '#b8743a']],
  ['face_pensne', 'face', 'rare', 350, 'Пенсне', 'XIX век', ['pincenez', '#c9a24a']],
  ['face_monocle', 'face', 'rare', 450, 'Монокль', 'XIX век', ['monocle', '#e8c35a']],
  ['face_budenny', 'face', 'rare', 500, 'Усы Будённого', '1920-е', ['mustache', '#2a1f18', 'wide']],
  ['face_beard', 'face', 'rare', 550, 'Боярская борода', 'Московское царство', ['beard', '#6b4a2f']],
  ['face_peter', 'face', 'epic', 1800, 'Усы Петра I', 'Петровская эпоха', ['mustache', '#1b1410', 'peter']],
  ['face_goggles', 'face', 'epic', 2000, 'Лётные очки Чкалова', '1930-е', ['goggles', '#6b4a2f', '#7fc8f8']],
  ['face_mask', 'face', 'legendary', 8000, 'Маска с ассамблеи', 'Петровская эпоха', ['mask', '#e9c46a', '#7a1426']],
  ['face_stareyes', 'face', 'mythic', null, 'Звёздные глаза', 'Сказка', ['stareyes', '#ffd23f', '#ff9f1c']],

  // ── Шея (12) ─────────────────────────────────────────────────────────
  ['neck_pioneer', 'neck', 'common', 70, 'Пионерский галстук', 'СССР', ['tie', '#d0342c']],
  ['neck_scarf', 'neck', 'common', 80, 'Шарф в полоску', 'Наши дни', ['scarf', '#2f63c9', '#f2c14e']],
  ['neck_bow', 'neck', 'common', 90, 'Бабочка', 'XIX век', ['bowtie', '#15151a']],
  ['neck_beads', 'neck', 'common', 60, 'Бусы', 'Русь', ['beads', '#c0392b']],
  ['neck_gto', 'neck', 'common', 100, 'Значок ГТО', 'СССР', ['badge', '#e9c46a', '#d0342c']],
  ['neck_jabot', 'neck', 'rare', 350, 'Жабо', 'XVIII век', ['jabot', '#ffffff']],
  ['neck_ribbon', 'neck', 'rare', 500, 'Орденская лента', 'Империя', ['sash', '#2f63c9', '#e9c46a']],
  ['neck_gorzhetka', 'neck', 'rare', 450, 'Горжетка', 'XIX век', ['fur', '#e8dcc8', '#c9b89a']],
  ['neck_vdnh', 'neck', 'rare', 300, 'Шарф ВДНХ', 'СССР', ['scarf', '#d0342c', '#ffffff']],
  ['neck_barmy', 'neck', 'epic', 2400, 'Бармы', 'Московское царство', ['barmy', '#e9c46a', '#b3123a', '#1d8a5a']],
  ['neck_andrey', 'neck', 'epic', 2800, 'Орден Андрея Первозванного', 'Империя', ['order', '#2f63c9', '#e9c46a']],
  ['neck_chain', 'neck', 'legendary', 9000, 'Золотая цепь канцлера', 'Империя', ['chain', '#e9c46a', '#b8912f']],

  // ── В руке (18) ──────────────────────────────────────────────────────
  ['hand_pero', 'hand', 'common', 60, 'Гусиное перо', 'Русь', ['quill', '#f4f1e6', '#1f1f24']],
  ['hand_beresta', 'hand', 'common', 70, 'Берестяная грамота', 'Русь', ['scroll', '#e7d3a8', '#8a6a44']],
  ['hand_book', 'hand', 'common', 80, 'Учебник истории', 'Наши дни', ['book', '#2f63c9', '#f2c14e']],
  ['hand_schety', 'hand', 'common', 90, 'Счёты', 'СССР', ['abacus', '#8a5a2b', '#d9c6a5']],
  ['hand_balalaika', 'hand', 'common', 140, 'Балалайка', 'XIX век', ['balalaika', '#d08a3a', '#6b3f22']],
  ['hand_chai', 'hand', 'common', 60, 'Чашка чая', 'Наши дни', ['cup', '#ffffff', '#2f63c9']],
  ['hand_flag', 'hand', 'common', 70, 'Флажок', 'СССР', ['flag', '#d0342c', '#8a6a44']],
  ['hand_sablya', 'hand', 'rare', 500, 'Сабля', 'XIX век', ['saber', '#c3cad2', '#e8c35a']],
  ['hand_luk', 'hand', 'rare', 400, 'Лук', 'Русь', ['bow', '#8a5a2b', '#e7d3a8']],
  ['hand_budilnik', 'hand', 'rare', 350, 'Будильник «Слава»', 'СССР', ['clock', '#d0342c', '#ffffff']],
  ['hand_gitara', 'hand', 'rare', 450, 'Гитара', 'СССР', ['guitar', '#b3202a', '#3a2a1e']],
  ['hand_truba', 'hand', 'rare', 600, 'Подзорная труба', 'Петровская эпоха', ['spyglass', '#c9a24a', '#6b3f22']],
  ['hand_gusli', 'hand', 'rare', 550, 'Гусли', 'Русь', ['gusli', '#d08a3a', '#6b3f22']],
  ['hand_mech', 'hand', 'epic', 2500, 'Меч-кладенец', 'Сказка', ['sword', '#dfe6ee', '#e9c46a', '#7fc8f8']],
  ['hand_skipetr', 'hand', 'epic', 2800, 'Скипетр', 'Империя', ['scepter', '#e9c46a', '#b3123a']],
  ['hand_fakel', 'hand', 'epic', 2000, 'Олимпийский факел', '1980', ['torch', '#c3cad2', '#ff8c1a']],
  ['hand_derzhava', 'hand', 'legendary', 11000, 'Держава', 'Империя', ['orb', '#e9c46a', '#2f63c9']],
  ['hand_sputnik', 'hand', 'mythic', null, 'Спутник-1', 'Космос', ['sputnik', '#dfe6ee', '#9aa3ad']],

  // ── Место (16) ───────────────────────────────────────────────────────
  ['bg_izba', 'bg', 'common', 80, 'Изба', 'Русь', ['bg_izba', '#f3e3c2', '#8a5a2b']],
  ['bg_pole', 'bg', 'common', 70, 'Поле ржи', 'Русь', ['bg_field', '#bfe3ff', '#e9c46a']],
  ['bg_shkola', 'bg', 'common', 90, 'Школьный класс', 'Наши дни', ['bg_class', '#e9efe6', '#2f5a3a']],
  ['bg_bereza', 'bg', 'common', 70, 'Берёзовая роща', 'Русь', ['bg_birch', '#d9f0d0', '#ffffff']],
  ['bg_volga', 'bg', 'common', 80, 'Волга', 'Русь', ['bg_river', '#bfe3ff', '#3a86c8']],
  ['bg_kommunalka', 'bg', 'common', 100, 'Коммуналка', 'СССР', ['bg_room', '#e9d8b4', '#7a1426']],
  ['bg_veche', 'bg', 'rare', 450, 'Новгородское вече', 'Русь', ['bg_veche', '#cfe6f7', '#8a5a2b']],
  ['bg_kreml', 'bg', 'rare', 600, 'Московский Кремль', 'Московское царство', ['bg_kremlin', '#bfe3ff', '#b3202a']],
  ['bg_bam', 'bg', 'rare', 400, 'Стройка БАМа', 'СССР', ['bg_bam', '#dcefff', '#3f6b3f']],
  ['bg_piter', 'bg', 'rare', 550, 'Нева и Петропавловка', 'Петровская эпоха', ['bg_piter', '#cfe0f0', '#e9c46a']],
  ['bg_metro', 'bg', 'rare', 500, 'Станция метро', 'СССР', ['bg_metro', '#e9dcc4', '#b3202a']],
  ['bg_senate', 'bg', 'epic', 2000, 'Сенатская площадь, 1825', 'XIX век', ['bg_senate', '#dfe8f2', '#e9c46a']],
  ['bg_winter', 'bg', 'epic', 2600, 'Зимний дворец', 'Империя', ['bg_winter', '#cfe6f7', '#5aa38a']],
  ['bg_baikonur', 'bg', 'epic', 2800, 'Байконур', 'Космос', ['bg_baikonur', '#ffd9a8', '#f4f4f4']],
  ['bg_amber', 'bg', 'legendary', 13000, 'Янтарная комната', 'Империя', ['bg_amber', '#f2a93b', '#8a4b12']],
  ['bg_space', 'bg', 'mythic', null, 'Открытый космос', 'Космос', ['bg_space', '#0b1030', '#ffffff']],

  // ── Спутник (10) ─────────────────────────────────────────────────────
  ['pet_sparrow', 'pet', 'common', 120, 'Воробей', 'Наши дни', ['c_bird', '#8a6a44', '#d9c6a5']],
  ['pet_mouse', 'pet', 'common', 100, 'Мышь-архивариус', 'Русь', ['c_mouse', '#9aa3ad', '#f2b8c6']],
  ['pet_frog', 'pet', 'common', 110, 'Царевна-лягушка', 'Сказка', ['c_frog', '#5bb04a', '#e9c46a']],
  ['pet_bear', 'pet', 'rare', 600, 'Медвежонок', 'Русь', ['c_bear', '#8a5a2b', '#d9b48a']],
  ['pet_belka', 'pet', 'rare', 650, 'Лайка Белка', 'Космос', ['c_dog', '#f4f4f4', '#d0a060']],
  ['pet_raven', 'pet', 'rare', 550, 'Ворон-летописец', 'Русь', ['c_bird', '#23232a', '#4a4a58']],
  ['pet_sivka', 'pet', 'epic', 2600, 'Сивка-бурка', 'Сказка', ['c_horse', '#8a6a44', '#3a2a1e']],
  ['pet_bayun', 'pet', 'epic', 2400, 'Кот Баюн', 'Сказка', ['c_cat', '#6b6b7a', '#e9c46a']],
  ['pet_eagle', 'pet', 'legendary', 10000, 'Двуглавый орлёнок', 'Империя', ['c_eagle', '#e9c46a', '#b8912f']],
  ['pet_firebird', 'pet', 'mythic', null, 'Жар-птица', 'Сказка', ['c_firebird', '#ff7b00', '#ffd23f']],

  // ── Сияние (6) ───────────────────────────────────────────────────────
  ['aura_stars', 'aura', 'legendary', 7000, 'Звездопад', 'Космос', ['a_stars', '#ffffff', '#ffd23f']],
  ['aura_snow', 'aura', 'legendary', 6000, 'Снег 1812 года', '1812', ['a_snow', '#ffffff', '#cfe6f7']],
  ['aura_salute', 'aura', 'legendary', 8000, 'Праздничный салют', 'XX век', ['a_salute', '#ff4d6d', '#ffd23f', '#4dabf7']],
  ['aura_gold', 'aura', 'mythic', null, 'Золотые искры', 'Империя', ['a_sparks', '#ffd23f', '#e9c46a']],
  ['aura_fire', 'aura', 'mythic', null, 'Огонь Жар-птицы', 'Сказка', ['a_fire', '#ff7b00', '#ffd23f']],
  ['aura_vortex', 'aura', 'mythic', null, 'Алый вихрь', 'XX век', ['a_vortex', '#e0341a', '#ff8a8a']],
];

const ITEMS = RAW.map(([id, slot, rarity, price, name, era, art]) => ({
  id, kind: 'wear', slot, rarity, price, name, era,
  art: { t: art[0], c: art.slice(1) },
}));

// Кладовая: еда, лекарства, игрушки. Еда и лекарства тратятся, игрушки — навсегда.
const CONSUMABLES = [
  { id: 'food_suhar', kind: 'food', name: 'Сухарь', price: 8, fx: { sat: 15 } },
  { id: 'food_shchi', kind: 'food', name: 'Щи', price: 20, fx: { sat: 40 } },
  { id: 'food_pirog', kind: 'food', name: 'Пирог с капустой', price: 35, fx: { sat: 60, mood: 10 } },
  { id: 'food_pryanik', kind: 'food', name: 'Тульский пряник', price: 60, fx: { sat: 40, mood: 40 } },
  { id: 'food_pir', kind: 'food', name: 'Царский пир', price: 250, fx: { sat: 100, mood: 100, health: 30 } },
  { id: 'med_otvar', kind: 'med', name: 'Травяной отвар', price: 50, fx: { health: 40 } },
  { id: 'med_mikstura', kind: 'med', name: 'Микстура', price: 120, fx: { health: 100 } },
  { id: 'toy_volchok', kind: 'toy', name: 'Волчок', price: 40, fx: { mood: 20 } },
  { id: 'toy_babki', kind: 'toy', name: 'Бабки', price: 60, fx: { mood: 30 } },
  { id: 'toy_lapta', kind: 'toy', name: 'Лапта', price: 90, fx: { mood: 40 } },
];
const TOY_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// Коробки. Шансы — открыто, в процентах; сумма обязана давать ровно 100
// (сверяет pet-catalog.selftest.js). pity — «каждая N-я не ниже редкости R».
const BOXES = [
  { id: 'box_chest', kind: 'box', name: 'Сундук летописца', price: 150,
    odds: { common: 70, rare: 23, epic: 6, legendary: 0.9, mythic: 0.1 },
    pity: { every: 10, atLeast: 'epic' } },
  { id: 'box_tsar', kind: 'box', name: 'Царский ларец', price: 700,
    odds: { common: 0, rare: 55, epic: 33, legendary: 10, mythic: 2 },
    pity: { every: 30, atLeast: 'legendary' } },
  { id: 'box_week', kind: 'box', name: 'Ларец недели', price: null,
    odds: { common: 0, rare: 0, epic: 60, legendary: 32, mythic: 8 },
    pity: null },
];

// Краска для ника за монеты. Золото, серебро, бронза и радуга — только за топ недели.
const NICK_PAINT = { id: 'paint_nick', price: 2000, days: 7 };
const NICK_COLORS = {
  ruby: '#e0344b', sapphire: '#2f6fdf', emerald: '#18a058', amethyst: '#8b5cf6', amber: '#e8930c', teal: '#0ea5a4',
};
const TOP_NICK_COLORS = ['gold', 'silver', 'bronze', 'violet'];

// Экономика. Средний активный ученик — ~100 строк в день ≈ 130 монет в день.
const ECONOMY = {
  perLine: 1,
  perEgePoint: 1,
  perDuelWin: 10,
  dailyEarnCap: 2000,          // потолок монет за решение в московские сутки
  firstSolveOfDay: 15,
  streakBonus: { 3: 30, 7: 100, 14: 250, 30: 700 },
  hatchMinSolved: 20,           // серверная страховка к клиентскому порогу «10 минут»
  hatchMinSeconds: 600,         // клиентский порог: 10 минут решения
  welcomeCoins: 300,
  veteranBoxPerLines: 500,
  veteranBoxMax: 5,
  starterFood: [['food_shchi', 2]],
};

// Награда за ачивку ученика: сумма по редкости, редкость — по id ачивки.
// Неизвестный id не оплачивается вовсе: клиент не должен назначать себе цену.
const ACHIEVEMENT_REWARD = { common: 50, rare: 150, epic: 400, legendary: 1000 };
const ACHIEVEMENTS = {
  lines_50: 'common', lines_500: 'rare', lines_2000: 'epic', lines_5000: 'legendary',
  lines_10000: 'legendary',
  streak_20: 'common', streak_50: 'rare', streak_100: 'epic',
  days_7: 'rare', days_30: 'epic', days_100: 'legendary',
  night: 'rare', morning: 'rare', mistakes_0: 'rare',
  hw_5: 'common', hw_25: 'rare', hw_70: 'epic', hw_150: 'legendary',
  hw_perfect: 'common', hw_ontime_1: 'common', hw_ontime_10: 'rare', hw_ontime_30: 'epic',
  hw_streak_3: 'common', hw_streak_7: 'rare', hw_streak_15: 'epic', hw_streak_30: 'epic',
  hw_streak_50: 'legendary', hw_streak_70: 'legendary',
  top_3: 'epic', top_1: 'legendary', top_1_x3: 'legendary', top_10: 'rare',
  all_achievements: 'legendary',
  duel_1: 'common', duel_10: 'rare', duel_50: 'epic', duel_200: 'legendary',
  mock_1: 'common', mock_20: 'rare', mock_10x: 'epic',
  ege_100: 'rare', ege_1000: 'epic',
  visual_50: 'rare', visual_300: 'epic',
  tetris_1: 'common', match_1: 'common', order_1: 'common', vov_20: 'rare',
  task1_200: 'rare', task3_200: 'rare', task4_200: 'rare', task5_200: 'rare', task7_200: 'rare',
  pet_hatch: 'common', pet_dress: 'common', pet_full_look: 'rare', pet_box_10: 'rare',
  pet_legendary: 'epic', pet_mythic: 'legendary', pet_era_set: 'epic', pet_fed_7: 'rare',
  pet_rich: 'rare',
};

// Награды недели. place — место в топе по строкам за неделю (Москва).
const WEEKLY_PRIZES = [
  { from: 1, to: 1, coins: 1000, box: 'box_week', nick: 'gold', days: 30, crown: true },
  { from: 2, to: 2, coins: 500, box: 'box_week', nick: 'silver', days: 30 },
  { from: 3, to: 3, coins: 500, box: 'box_week', nick: 'bronze', days: 30 },
  { from: 4, to: 10, coins: 200, box: 'box_tsar', nick: 'violet', days: 7 },
  { from: 11, to: 50, coins: 50, box: 'box_chest' },
];

const BY_ID = new Map([...ITEMS, ...CONSUMABLES, ...BOXES].map(entry => [entry.id, entry]));

function prizeFor(place) {
  return WEEKLY_PRIZES.find(p => place >= p.from && place <= p.to) || null;
}

function itemValue(item) {
  return item.price || RARITY_VALUE[item.rarity] || 0;
}

// То, что уходит клиенту: всё, кроме внутренних констант.
function publicCatalog() {
  return {
    version: CATALOG_VERSION,
    rarities: RARITIES.map(id => ({ id, label: RARITY_LABEL[id] })),
    slots: SLOTS.map(id => ({ id, label: SLOT_LABEL[id] })),
    species: SPECIES,
    items: ITEMS,
    consumables: CONSUMABLES,
    boxes: BOXES,
    nickPaint: { ...NICK_PAINT, colors: NICK_COLORS },
    economy: {
      perLine: ECONOMY.perLine, perEgePoint: ECONOMY.perEgePoint, perDuelWin: ECONOMY.perDuelWin,
      dailyEarnCap: ECONOMY.dailyEarnCap, firstSolveOfDay: ECONOMY.firstSolveOfDay,
      streakBonus: ECONOMY.streakBonus, hatchMinSeconds: ECONOMY.hatchMinSeconds,
      hatchMinSolved: ECONOMY.hatchMinSolved,
    },
    achievementRewards: ACHIEVEMENT_REWARD,
    achievements: ACHIEVEMENTS,
    weeklyPrizes: WEEKLY_PRIZES,
    duplicateShare: DUPLICATE_SHARE,
  };
}

// Меняется вместе с содержимым каталога: клиент кэширует каталог по версии.
const CATALOG_VERSION = '2026-09-27-1';

module.exports = {
  RARITIES, RARITY_VALUE, DUPLICATE_SHARE, SLOTS, SPECIES, ITEMS, CONSUMABLES, BOXES,
  NICK_PAINT, NICK_COLORS, TOP_NICK_COLORS, ECONOMY, ACHIEVEMENT_REWARD, ACHIEVEMENTS,
  WEEKLY_PRIZES, TOY_COOLDOWN_MS, CATALOG_VERSION, BY_ID, prizeFor, itemValue, publicCatalog,
};
