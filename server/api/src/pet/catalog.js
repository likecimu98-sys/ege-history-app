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
  // Редкие виды (27.09.2026, решение владельца): не вылупляются и не продаются —
  // только выпадают из коробок или собираются из осколков. У каждой стадии своё имя.
  { id: 'ghoul', name: 'Гуль', rare: true, fragment: 'dark', petName: 'Тень',
    stages: { baby: 'Новичок', teen: 'Гуль', adult: 'Дед инсайд', sage: 'Одноглазый король' } },
  { id: 'tsar', name: 'Николай II', rare: true, fragment: 'faberge', petName: 'Ники',
    stages: { baby: 'Цесаревич', teen: 'Наследник', adult: 'Император', sage: 'Император с державой' } },
  // Сквидвард: ворчун, который во взрослом облике становится «Красавчиком»
  // (решение владельца 27.09.2026; разрешение Nickelodeon — со слов владельца).
  { id: 'squid', name: 'Сквидвард', rare: true, fragment: 'ink', petName: 'Сквидвард',
    stages: { baby: 'Малыш Сквидвард', teen: 'Сквидвард', adult: 'Красавчик Сквидвард', sage: 'Сквидвард-гигачад' } },
  // Бурундай — легендарный вид (решение владельца 28.09.2026): темник Батыя,
  // победитель битвы на реке Сить (1238). Сидит на троне, растёт от нукера
  // на сундуке до «гигачада» на золотом троне. По редкости — между Николаем
  // и Сквидвардом; осколки — «Волос бунчука», в том числе за 1-е место в дуэлях.
  { id: 'burunday', name: 'Бурундай', rare: true, fragment: 'horse', petName: 'Бурундай',
    stages: { baby: 'Юный нукер', teen: 'Сотник', adult: 'Темник', sage: 'Бурундай-гигачад' } },
];

// Шанс редкого вида при открытии коробки, в процентах (решение владельца:
// Николай — 0,05% из сундука и 2% из ларца; Гуль чуть чаще). Бросок отдельный,
// поверх обычного, поэтому шансы вещей в коробке не меняются.
const RARE_SPECIES_DROPS = {
  box_chest: { tsar: 0.05, burunday: 0.1, squid: 0.15, ghoul: 0.3 },
  box_tsar: { tsar: 2, burunday: 2.5, squid: 3, ghoul: 5 },
  box_week: { tsar: 2, burunday: 2.5, squid: 3, ghoul: 5 },
  box_emperor: { tsar: 4, burunday: 5, squid: 6, ghoul: 8 },
};
// Осколки — запасной путь к редкому виду: падают из ларцов, за 1-е место недели,
// за 30 дней серии входов и изредка с колеса.
const FRAGMENTS = {
  faberge: { name: 'Осколок Фаберже', icon: '🥚', species: 'tsar', need: 10,
    sources: 'колесо (1%), 1-е место недели, 30 дней серии входов, ларцы (3%)' },
  // Осколки тьмы раньше падали только из ларцов — Гуль по осколкам выходил
  // труднее Николая, хотя задуман проще. Теперь ещё колесо и 7 кругов подряд.
  dark: { name: 'Осколок тьмы', icon: '🖤', species: 'ghoul', need: 6,
    sources: 'колесо (1%), каждые 7 ежедневных кругов подряд, ларцы (3%)' },
  ink: { name: 'Капля чернил', icon: '🦑', species: 'squid', need: 8,
    sources: 'Императорский ларец (6%), Царский ларец и Ларец недели (3%), 1-е место в «Кто круче?»' },
  horse: { name: 'Волос бунчука', icon: '🐎', species: 'burunday', need: 8,
    sources: 'Императорский ларец (5%), Царский ларец и Ларец недели (3%), 1-е место в топе дуэлей недели' },
};
const FRAGMENT_DROPS = {
  box_tsar: { faberge: 3, dark: 3, ink: 3, horse: 3 },
  box_week: { faberge: 3, dark: 3, ink: 3, horse: 3 },
  box_emperor: { faberge: 5, dark: 5, ink: 6, horse: 5 },
};
const STABLE_MAX = 8;

// «Ежедневный круг» — привычка на каждый день: колесо, все три задания дня,
// 5 голосов в «Кто круче?» и одна реакция чужому питомцу. За весь круг —
// сундук, раз в московские сутки. Каждый шаг ведёт в свой уголок питомца,
// поэтому круг заодно знакомит с тем, что иначе лежит глубоко во вкладках.
const DAILY_ROUND = { votes: 5, reward: 'box_chest', fragmentEvery: 7, fragment: 'dark' };

// Короткие исторические справки к вещам — видны при примерке. Шутка работает,
// только если за ней стоит факт из курса.
const ITEM_NOTES = {
  neck_stolypin: '«Столыпинский галстук» — так депутат Ф. Родичев в 1907 г. назвал виселицу: военно-полевые суды 1906–1907 гг. при П. Столыпине. Столыпин вызвал его на дуэль, Родичев извинился. Для ЕГЭ: военно-полевые суды, аграрная реформа, «Третьеиюньская монархия».',
  bg_amber: 'Янтарная комната — дар Фридриха Вильгельма I Петру I (1716). Похищена нацистами в 1941 г., воссоздана в Царском Селе к 2003 г.',
  pet_eagle: 'Двуглавый орёл — герб Московского государства со времён Ивана III (после брака с Софьей Палеолог, 1472).',
  pet_sivka: '«Сивка-бурка, вещая каурка» — волшебный конь русской сказки; сказки собрал А. Н. Афанасьев в 1855–1863 гг.',
};

// Хвастовство без шума. Реакции — только положительные; «Кто круче?» — 20
// голосов в день за крошку опыта; икона стиля недели — 500 монет и сияние.
// Приглашение: обоим сундук, когда приглашённый вылупит питомца (а это уже
// 10 минут решения), не больше 30 наград одному пригласившему.
const SOCIAL = {
  reactions: ['🔥', '👑', '😂', '💯'],
  battleDaily: 20,
  battleXp: 2,
  stylePrize: { coins: 500, days: 7, minVotes: 5 },
  // Сундук обоим — когда приглашённый решил 16 строк (решение владельца 28.09.2026;
  // раньше — при вылуплении, то есть после 10 минут решения).
  referral: { box: 'box_chest', maxPerInviter: 30, accountMaxAgeDays: 30, minSolved: 16 },
};

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
  ['hat_laurel', 'head', 'epic', 2600, 'Лавровый венок', 'Античность', ['laurel', '#e9c46a', '#b8912f']],
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
  ['body_marshal', 'body', 'epic', 2800, 'Маршальский мундир', 'XX век', ['marshal', '#2f4a36', '#e9c46a', '#c62828']],
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
  ['face_stareyes', 'face', 'legendary', null, 'Звёздные глаза', 'Сказка', ['stareyes', '#ffd23f', '#ff9f1c']],

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
  ['neck_chain', 'neck', 'epic', 2500, 'Золотая цепь канцлера', 'Империя', ['chain', '#e9c46a', '#b8912f']],
  ['neck_stolypin', 'neck', 'legendary', 9500, 'Столыпинский галстук', 'Империя', ['stolypin', '#d9c9a0', '#8a6a44']],

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
  ['aura_stars', 'aura', 'epic', 2400, 'Звездопад', 'Космос', ['a_stars', '#ffffff', '#ffd23f']],
  ['aura_snow', 'aura', 'legendary', 6000, 'Снег 1812 года', '1812', ['a_snow', '#ffffff', '#cfe6f7']],
  ['aura_salute', 'aura', 'epic', 2600, 'Праздничный салют', 'XX век', ['a_salute', '#ff4d6d', '#ffd23f', '#4dabf7']],
  ['aura_gold', 'aura', 'legendary', null, 'Золотые искры', 'Империя', ['a_sparks', '#ffd23f', '#e9c46a']],
  ['aura_fire', 'aura', 'legendary', null, 'Огонь Жар-птицы', 'Сказка', ['a_fire', '#ff7b00', '#ffd23f']],
  ['aura_vortex', 'aura', 'legendary', null, 'Алый вихрь', 'XX век', ['a_vortex', '#e0341a', '#ff8a8a']],

  // ── Мемы (v3, 27.09.2026): чтобы наряжаться было смешно, а не только исторично ──
  ['hat_foil', 'head', 'rare', 400, 'Шапочка из фольги', 'Мемы', ['foilhat', '#cfd6de', '#8a96a3']],
  ['hat_sidecap', 'head', 'common', 90, 'Кепка набекрень', 'Мемы', ['sidecap', '#15151a', '#e0341a']],
  ['hat_panama_ege', 'head', 'common', 110, 'Панамка «Я сдам ЕГЭ»', 'Мемы', ['panamaege', '#f4f1e6', '#d9d2bd', '#2f63c9']],
  ['hat_halo', 'head', 'epic', 2000, 'Нимб отличника', 'Мемы', ['halo', '#ffd23f', '#b8912f']],
  ['hat_horns', 'head', 'rare', 350, 'Рожки двоечника', 'Мемы', ['horns', '#d0342c']],
  ['hat_paper_crown', 'head', 'common', 70, 'Бумажная корона', 'Мемы', ['papercrown', '#fff4c2', '#e0a458']],
  ['hat_bucket', 'head', 'epic', 2200, 'Ведро', 'Мемы', ['bucket', '#b7c0c9']],
  ['face_thug', 'face', 'epic', 1800, 'Очки «Thug life»', 'Мемы', ['thug']],
  ['face_gigachad', 'face', 'legendary', 9000, 'Челюсть гигачада', 'Мемы', ['gigachad', '#000000', '#3a2a1e']],
  ['face_sigma', 'face', 'rare', 500, 'Сигма-взгляд', 'Мемы', ['sigma', '#15151a']],
  ['face_bruise', 'face', 'common', 60, 'Синяк после контрольной', 'Мемы', ['bruise', '#7b4bb3', '#b04b8a']],
  ['face_lashes', 'face', 'common', 80, 'Накладные ресницы', 'Мемы', ['lashes', '#15151a']],
  ['face_unibrow', 'face', 'common', 70, 'Монобровь', 'Мемы', ['unibrow', '#2a1f18']],
  ['body_tracksuit', 'body', 'common', 140, 'Треники с лампасами', 'Мемы', ['tracksuit', '#1f3a8a']],
  ['body_fur_july', 'body', 'rare', 600, 'Шуба в июле', 'Мемы', ['furjuly', '#6b5a48', '#3f342a']],
  ['body_bare_jacket', 'body', 'rare', 450, 'Пиджак на голое тело', 'Мемы', ['barejacket', '#15151a', '#e0341a']],
  ['body_pajama', 'body', 'common', 120, 'Пижама с котиками', 'Мемы', ['pajama', '#9fc5e8', '#ffffff']],
  ['body_sigma_suit', 'body', 'epic', 2800, 'Костюм сигмы', 'Мемы', ['sigmasuit', '#15151a', '#e0341a']],
  ['neck_chain_100', 'neck', 'epic', 2700, 'Цепь «ЕГЭ 100»', 'Мемы', ['chain100', '#e9c46a', '#8a5a00']],
  ['neck_freshener', 'neck', 'common', 60, 'Ёлочка-вонючка', 'Мемы', ['freshener', '#2fa84f']],
  ['neck_foil_bow', 'neck', 'common', 90, 'Бабочка из фольги', 'Мемы', ['foilbow', '#cfd6de', '#8a96a3']],
  ['neck_patience', 'neck', 'rare', 500, 'Медаль «За терпение»', 'Мемы', ['medalpatience', '#c0c7d0', '#2f63c9']],
  ['neck_long_scarf', 'neck', 'common', 100, 'Шарф в три метра', 'Мемы', ['longscarf', '#d0342c', '#ffffff']],
  ['hand_slipper', 'hand', 'legendary', 7500, 'Бабушкин тапок', 'Мемы', ['slipper', '#ff8fb1', '#ffffff']],
  ['hand_seeds', 'hand', 'common', 60, 'Семечки', 'Мемы', ['seeds', '#f4f1e6', '#2b2233']],
  ['hand_bags', 'hand', 'common', 80, 'Пакет с пакетами', 'Мемы', ['bagofbags', '#f4f4f6', '#2f63c9']],
  ['hand_cheat', 'hand', 'epic', 1500, 'Шпаргалка', 'Мемы', ['cheatsheet', '#fffbe6', '#2f63c9']],
  ['hand_calc', 'hand', 'rare', 350, 'Калькулятор «Электроника»', 'СССР', ['calculator', '#6b737c', '#b8e0a0']],
  ['hand_shawarma', 'hand', 'common', 100, 'Шаурма', 'Мемы', ['shawarma', '#e7d3a8', '#5bb04a']],
  ['hand_mug', 'hand', 'common', 90, 'Кружка «Лучший историк»', 'Мемы', ['mughist', '#ffffff', '#d0342c']],
  ['bg_carpet', 'bg', 'common', 100, 'Ковёр на стене', 'Мемы', ['bg_carpet', '#9b1c2c', '#e9c46a']],
  ['bg_panel', 'bg', 'common', 90, 'Хрущёвка', 'СССР', ['bg_panel', '#b8b8b0']],
  ['bg_minibus', 'bg', 'rare', 450, 'Маршрутка', 'Мемы', ['bg_minibus', '#f2c500']],
  ['bg_759', 'bg', 'rare', 500, 'Кабинет истории в 7:59', 'Мемы', ['bg_759', '#2f5a3a']],
  ['bg_gym', 'bg', 'rare', 550, 'Качалка', 'Мемы', ['bg_gym', '#2a2d33', '#e0341a']],
  ['pet_capybara', 'pet', 'epic', 2200, 'Капибара', 'Мемы', ['c_capybara', '#9c6b3f', '#f59e0b']],
  ['pet_goose', 'pet', 'rare', 500, 'Гусь-работяга', 'Мемы', ['c_goose', '#f4f4f6', '#f2b705']],
  ['pet_dumpling', 'pet', 'common', 130, 'Кот-пельмень', 'Мемы', ['c_dumpling', '#f7f1e3']],
  ['pet_pigeon', 'pet', 'common', 90, 'Голубь-курлык', 'Мемы', ['c_pigeon', '#9aa3ad', '#5bb04a']],
  ['pet_roach', 'pet', 'common', 60, 'Таракан-сосед', 'Мемы', ['c_roach', '#7a4a24']],
  ['aura_friday', 'aura', 'epic', 2400, 'Вайб пятницы', 'Мемы', ['a_friday']],
  ['aura_deadline', 'aura', 'legendary', 7000, 'Режим дедлайна', 'Мемы', ['a_deadline']],
  ['aura_zen', 'aura', 'epic', 2400, 'Абсолютное спокойствие', 'Мемы', ['a_zen']],

  // ── Пак «Дед инсайд» (эстетика аниме-аватарок: белая чёлка, маска, zxc) ──
  ['hat_white_bangs', 'head', 'epic', 2200, 'Белая чёлка', 'Дед инсайд', ['whitebangs', '#f4f4f6', '#c9ccd6']],
  ['hat_headphones', 'head', 'rare', 550, 'Наушники zxc', 'Дед инсайд', ['headphones', '#15151a', '#e0341a']],
  ['face_ghoul_mask', 'face', 'legendary', 10000, 'Маска с зубами', 'Дед инсайд', ['ghoulmask', '#15151a', '#f4f1e6']],
  ['face_eyepatch', 'face', 'rare', 450, 'Повязка на глаз', 'Дед инсайд', ['eyepatch', '#15151a']],
  ['face_red_eye', 'face', 'epic', 1600, 'Красный глаз', 'Дед инсайд', ['redeye', '#e0341a', '#0b0b0b']],
  ['body_black_hoodie', 'body', 'common', 150, 'Чёрный худи оверсайз', 'Дед инсайд', ['blackhoodie', '#1b1b1f']],
  ['body_scorpion', 'body', 'epic', 2400, 'Куртка со скорпионом', 'Дед инсайд', ['scorpion', '#e8e4da', '#e9c46a']],
  ['neck_choker', 'neck', 'rare', 400, 'Цепь-чокер', 'Дед инсайд', ['choker', '#15151a', '#c0c7d0']],
  ['hand_bandage', 'hand', 'rare', 400, 'Бинты', 'Дед инсайд', ['bandage', '#f4f1e6', '#d0342c']],
  ['hand_chainsaw', 'hand', 'legendary', 8500, 'Бензопила', 'Дед инсайд', ['chainsaw', '#f08a24', '#c3cad2']],
  ['hand_blue_fire', 'hand', 'mythic', null, 'Синий огонь', 'Дед инсайд', ['bluefire', '#3b82f6', '#bfe3ff']],
  ['bg_rain_roof', 'bg', 'epic', 2200, 'Крыша под дождём', 'Дед инсайд', ['bg_rainroof', '#161a2b', '#9fb4c8']],
  ['aura_1000_7', 'aura', 'mythic', null, '«1000-7»', 'Дед инсайд', ['a_thousand']],
];

// Лестница крутости (27.09.2026, концепция владельца «крутое видно сразу»):
// легенда — это вещь со своим движением питомца, миф — превращение. Вещи, у
// которых такого эффекта нет, переведены ниже; купившим вернули разницу
// (rebalance.js, rebalanceItemsV4).
const TIER_CHANGES_V4 = { toEpic: {'hat_laurel': 2600, 'body_marshal': 2800, 'neck_chain': 2500, 'neck_chain_100': 2700, 'hat_bucket': 2200, 'aura_salute': 2600, 'aura_stars': 2400, 'aura_friday': 2400, 'aura_zen': 2400}, toLegendary: ['face_stareyes', 'aura_gold', 'aura_fire', 'aura_vortex'] };

const ITEMS_BASE = RAW.map(([id, slot, rarity, price, name, era, art]) => ({
  id, kind: 'wear', slot, rarity, price, name, era,
  art: { t: art[0], c: art.slice(1) },
}));
const ITEMS = ITEMS_BASE.map(item => (ITEM_NOTES[item.id] ? { ...item, note: ITEM_NOTES[item.id] } : item));

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
  // Ускоритель: 30 минут ×2 опыта и ×1,5 монет за решение. Окно хранит сервер.
  { id: 'boost_elixir', kind: 'boost', name: 'Эликсир учёности', price: 250, fx: { minutes: 30, coins: 1.5, xp: 2 } },
  // Заморозка серии входов: спасает один пропущенный день. В кладовой — не больше одной.
  { id: 'streak_freeze', kind: 'freeze', name: 'Заморозка серии', price: 300, fx: {} },
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
  // Самый дорогой ларец: только эпик и выше, гарант мифа каждые 12 открытий,
  // лучшие шансы на редких питомцев (решение владельца: «700 — дёшево»).
  { id: 'box_emperor', kind: 'box', name: 'Императорский ларец', price: 1500,
    odds: { common: 0, rare: 0, epic: 45, legendary: 40, mythic: 15 },
    pity: { every: 12, atLeast: 'mythic' } },
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

// Экономика v3 (27.09.2026, решение владельца): монета — за решение, и щедро.
// Средний активный ученик — ~100 строк в день ≈ 200+ монет, плюс факты, задания
// дня и колесо. Ачивки — приятный бонус, а не основной доход: в v2 у лидера было
// 1400 монет с ачивок и 212 за решение, то есть решать было невыгодно.
// Баллы ЕГЭ за таблицу в обычном тренажёре НЕ платятся — таблица уже оплачена
// строками (раньше 4 строки № 5 давали 4 + 2 = 6 монет). Платятся только баллы
// пробников и заданий ФИПИ — отдельными счётчиками из exam-mode.
const ECONOMY = {
  rates: {
    solved: 2,        // верная строка тренажёра
    facts: 10,        // факт впервые перешёл в «выучено»
    mockPoints: 10,   // первичный балл пробника
    mocksDone: 50,    // сданный пробник
    fipiPoints: 8,    // балл задания ФИПИ
    duelWins: 30,     // победа в дуэли
    duelGames: 5,     // участие в дуэли
    hwOnTime: 40,     // домашка вовремя
  },
  dailyEarnCap: 5000,           // потолок монет за решение в московские сутки
  feedPerLine: 0.4,             // питается знаниями: +4 сытости за 10 строк
  hatchMinSolved: 20,           // серверная страховка к клиентскому порогу «10 минут»
  // Смерть от забвения (решение владельца 28.09.2026): считаются только дни,
  // когда ученик ОТКРЫВАЛ тренажёр, но ничего не сделал с питомцем. После
  // neglectWarnDays таких дней подряд — предупреждение; ещё один такой день —
  // питомец умирает, и раздел питомца пропадает у ученика.
  neglectWarnDays: 7,
  hatchMinSeconds: 600,         // клиентский порог: 10 минут решения
  welcomeCoins: 150,
  veteranBoxPerLines: 500,
  veteranBoxMax: 5,
  starterFood: [['food_shchi', 2]],
  boostGraceMs: 5 * 60 * 1000,  // строки, решённые под конец ускорителя, сервер видит позже
};

// Серия входов (первый заход в московские сутки): сундуки на отметках, дальше —
// «Ларец недели» каждые 30 дней.
const LOGIN_STREAK = [
  { day: 3, items: [['box_chest', 1]] },
  { day: 7, items: [['box_tsar', 1], ['boost_elixir', 1]] },
  { day: 14, items: [['box_tsar', 2]] },
  { day: 30, items: [['box_week', 1]], fragment: 'faberge' },
];

// Колесо удачи: одно вращение в сутки. Сумма весов — 100.
const WHEEL = [
  { id: 'c20', w: 25, coins: 20, label: '20' },
  { id: 'c50', w: 22, coins: 50, label: '50' },
  { id: 'c100', w: 12, coins: 100, label: '100' },
  { id: 'c150', w: 5, coins: 150, label: '150' },
  { id: 'pirog', w: 11, item: 'food_pirog', label: '🥧' },
  { id: 'otvar', w: 5, item: 'med_otvar', label: '🍵' },
  { id: 'chest', w: 9, item: 'box_chest', label: '🧰' },
  { id: 'boost', w: 6, item: 'boost_elixir', label: '⚡' },
  { id: 'tsar', w: 3, item: 'box_tsar', label: '👑' },
  { id: 'frag', w: 1, fragment: 'faberge', label: '🥚' },
  { id: 'fragd', w: 1, fragment: 'dark', label: '🖤' },
];

// Задания дня: одно «строки» всегда, ещё два — из остальных. kind — счётчик
// профиля, target — сколько добрать за сегодня, reward — монеты.
const QUESTS = {
  lines: [{ target: 20, reward: 30 }, { target: 30, reward: 40 }, { target: 50, reward: 70 }],
  other: [
    { kind: 'facts', target: 3, reward: 40, text: 'Выучи {n} новых факта' },
    { kind: 'facts', target: 5, reward: 60, text: 'Выучи {n} новых фактов' },
    { kind: 'perfect', target: 1, reward: 40, text: 'Реши таблицу без ошибок' },
    { kind: 'perfect', target: 2, reward: 70, text: 'Реши {n} таблицы без ошибок' },
    { kind: 'duelGames', target: 1, reward: 40, text: 'Сыграй дуэль' },
    { kind: 'duelWins', target: 1, reward: 60, text: 'Выиграй дуэль' },
    { kind: 'fipiPoints', target: 4, reward: 50, text: 'Набери {n} балла в заданиях ФИПИ' },
    { kind: 'mocksDone', target: 1, reward: 80, text: 'Сдай пробник' },
  ],
  allDoneBox: 'box_chest',
};

// Награда за ачивку ученика: сумма по редкости, редкость — по id ачивки.
// Неизвестный id не оплачивается вовсе: клиент не должен назначать себе цену.
const ACHIEVEMENT_REWARD = { common: 20, rare: 50, epic: 120, legendary: 300 };
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
  mock_1: 'common', mock_15: 'rare', mock_max: 'epic', mock_10x: 'epic',
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
  { from: 1, to: 1, coins: 1000, box: 'box_week', nick: 'gold', days: 30, crown: true, fragment: 'faberge' },
  { from: 2, to: 2, coins: 700, box: 'box_week', nick: 'silver', days: 30 },
  { from: 3, to: 3, coins: 500, box: 'box_week', nick: 'bronze', days: 30 },
  { from: 4, to: 10, coins: 300, box: 'box_tsar', nick: 'violet', days: 7 },
  { from: 11, to: 50, coins: 100, box: 'box_chest' },
];
// Топ месяца (строки за календарный месяц по Москве) и топ дуэлей недели
// (победы за неделю). Считаются по журналу начислений.
const MONTHLY_PRIZES = [
  { from: 1, to: 1, coins: 1000, title: true }, { from: 2, to: 2, coins: 700, title: true },
  { from: 3, to: 3, coins: 500, title: true }, { from: 4, to: 10, coins: 250 },
];
const DUEL_PRIZES = [
  { from: 1, to: 1, coins: 500, fragment: 'horse' }, { from: 2, to: 3, coins: 300 }, { from: 4, to: 10, coins: 100 },
];

const BY_ID = new Map([...ITEMS, ...CONSUMABLES, ...BOXES].map(entry => [entry.id, entry]));

function prizeFor(place, table = WEEKLY_PRIZES) {
  return table.find(p => place >= p.from && place <= p.to) || null;
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
    rareSpeciesDrops: RARE_SPECIES_DROPS, fragments: FRAGMENTS, fragmentDrops: FRAGMENT_DROPS, social: SOCIAL, dailyRound: DAILY_ROUND,
    items: ITEMS,
    consumables: CONSUMABLES,
    boxes: BOXES,
    nickPaint: { ...NICK_PAINT, colors: NICK_COLORS },
    economy: {
      rates: ECONOMY.rates, dailyEarnCap: ECONOMY.dailyEarnCap, feedPerLine: ECONOMY.feedPerLine,
      hatchMinSeconds: ECONOMY.hatchMinSeconds, hatchMinSolved: ECONOMY.hatchMinSolved,
    },
    loginStreak: LOGIN_STREAK,
    wheel: WHEEL.map(({ id, label, coins, item, fragment, w }) => ({ id, label, coins, item, fragment, chance: w })),
    monthlyPrizes: MONTHLY_PRIZES,
    duelPrizes: DUEL_PRIZES,
    achievementRewards: ACHIEVEMENT_REWARD,
    achievements: ACHIEVEMENTS,
    weeklyPrizes: WEEKLY_PRIZES,
    duplicateShare: DUPLICATE_SHARE,
  };
}

// Меняется вместе с содержимым каталога: клиент кэширует каталог по версии.
const CATALOG_VERSION = '2026-09-28-11';

module.exports = {
  RARITIES, RARITY_VALUE, DUPLICATE_SHARE, SLOTS, SPECIES, ITEMS, CONSUMABLES, BOXES,
  RARE_SPECIES_DROPS, FRAGMENTS, FRAGMENT_DROPS, STABLE_MAX, SOCIAL, DAILY_ROUND, TIER_CHANGES_V4,
  NICK_PAINT, NICK_COLORS, TOP_NICK_COLORS, ECONOMY, ACHIEVEMENT_REWARD, ACHIEVEMENTS,
  WEEKLY_PRIZES, MONTHLY_PRIZES, DUEL_PRIZES, LOGIN_STREAK, WHEEL, QUESTS,
  TOY_COOLDOWN_MS, CATALOG_VERSION, BY_ID, prizeFor, itemValue, publicCatalog,
};
