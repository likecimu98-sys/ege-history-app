from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ContentStream


PDF_PATH = Path(r"C:\Users\01\Downloads\VSYa_ARKhITEKTURA_dlya_EGE_po_istorii.pdf")
OUT_IMAGE_DIR = Path("assets/visual/architecture")
OUT_DATA = Path("visualArchitectureData.generated.js")
SOURCE_NAME = "VSYa_ARKhITEKTURA_dlya_EGE_po_istorii.pdf"


# Manual page map for this PDF. The photos indexes are taken after sorting visible
# page images from left to right. Keeping the map explicit makes the generated base
# much safer than trying to infer multi-object pages from broken PDF text lines.
PAGE_ENTRIES = {
    2: [
        {"title": "Золотые ворота в Киеве", "description": "Начало XI века (при Ярославе Мудром)", "photos": [0]},
        {"title": "Софийский собор в Киеве", "description": "Начало XI века (при Ярославе Мудром)", "photos": [1]},
    ],
    3: [
        {"title": "Софийский собор в Новгороде", "description": "Середина XI века (при Ярославе Мудром)", "photos": [0]},
        {"title": "Георгиевский собор Юрьева монастыря", "description": "1119-1130, Великий Новгород, мастер Пётр (при Мстиславе Великом)", "photos": [1]},
    ],
    4: [
        {"title": "Золотые ворота во Владимире", "description": "1164, построены при Андрее Боголюбском", "photos": [0]},
        {"title": "Успенский собор во Владимире", "description": "Построен при Андрее Боголюбском (середина XII века). Сохранились фрески Андрея Рублева (начало XV века)", "photos": [1]},
    ],
    5: [
        {"title": "Церковь Покрова на Нерли", "description": "Построена при Андрее Боголюбском (середина XII века)", "photos": [0]},
        {"title": "Дмитровский собор во Владимире", "description": "Построен при Всеволоде Большое Гнездо (конец XII века)", "photos": [1]},
    ],
    6: [
        {"title": "Церковь Спаса на Нередице", "description": "Конец XII века, недалеко от Великого Новгорода", "photos": [0]},
        {"title": "Церковь Федора Стратилата на Ручью", "description": "1361, Великий Новгород", "photos": [1]},
    ],
    7: [
        {"title": "Церковь Спаса Преображения на Ильине улице", "description": "1374, Великий Новгород. Единственный храм с сохранившимися фресками Феофана Грека", "photos": [0]},
        {"title": "Спас Вседержитель", "description": "Феофан Грек, 1378", "photos": [1], "type": "fresco"},
    ],
    8: [
        {"title": "Троицкий собор Троице-Сергиевой лавры", "description": "1420-е, построен при Василии I; здесь хранилась икона Андрея Рублева «Троица»", "photos": [1]},
        {"title": "Троица", "description": "Андрей Рублев, XV век", "photos": [0], "type": "icon"},
        {"title": "Спасский собор Андроникова монастыря", "description": "Первая треть XV века, Москва", "photos": [2]},
    ],
    9: [
        {"title": "Московский кремль", "description": "Конец XV века (белокаменный кремль был построен еще при Дмитрии Донском)", "photos": [0]},
        {"title": "Успенский собор", "description": "1479, Москва, Аристотель Фиорованти", "photos": [1]},
    ],
    10: [
        {"title": "Благовещенский собор", "description": "1489, Москва, псковские мастера Кривцов и Мышкин", "photos": [0]},
        {"title": "Спасская башня", "description": "1491, Московский кремль, Пьетро Антонио Солари, Марк Фрязин", "photos": [1]},
    ],
    11: [
        {"title": "Грановитая палата", "description": "1491, Москва, Марк Фрязин, Пьетро Антонио Солари", "photos": [0]},
        {"title": "Архангельский собор", "description": "1508, Москва, Алевиз Новый", "photos": [1]},
    ],
    12: [
        {"title": "Колокольня Ивана Великого", "description": "1508, Москва, Бон Фрязин", "photos": [0]},
        {"title": "Церковь Вознесения в Коломенском", "description": "1532, Москва", "photos": [1]},
    ],
    13: [
        {"title": "Новодевичий монастырь", "description": "Первая половина XVI века, Москва", "photos": [0]},
    ],
    14: [
        {"title": "Храм Василия Блаженного (Покрова на Рву)", "description": "1561, Москва", "photos": [0]},
        {"title": "Белый город", "description": "Конец XVI века, Москва, Федор Конь. Не сохранился. Картина Васнецова", "photos": [1]},
    ],
    15: [
        {"title": "Казанский собор", "description": "1630-е, Москва, снесен при Сталине, построен вновь при Ельцине", "photos": [0]},
        {"title": "Теремной дворец", "description": "1630-е, Москва", "photos": [1]},
    ],
    16: [
        {"title": "Церковь Троицы в Никитниках", "description": "Середина XVII века, Москва", "photos": [0, 1]},
    ],
    17: [
        {"title": "Коломенский дворец Алексея Михайловича", "description": "Вторая половина XVII века, Москва, снесен в XVIII веке, построен заново в 2010", "photos": [0, 1], "captions": ["Гравюра оригинала", "Современная реконструкция"]},
    ],
    18: [
        {"title": "Воскресенский собор Новоиерусалимского монастыря", "description": "Вторая половина XVII века, Истра, построен по замыслу патриарха Никона", "photos": [0, 1]},
    ],
    19: [
        {"title": "Храм Покрова в Филях", "description": "1694, Москва, Нарышкинское барокко", "photos": [0]},
        {"title": "Сухарева башня", "description": "Конец XVII века (при Петре), Москва, снесена при Сталине", "photos": [1]},
    ],
    20: [
        {"title": "Церковь Преображения Господня", "description": "Начало XVIII века, остров Кижи", "photos": [0, 1]},
    ],
    21: [
        {"title": "Храм Апостолов Петра и Павла", "description": "Начало XVIII века, Москва, Петровское барокко", "photos": [0]},
        {"title": "Знаменская церковь", "description": "Начало XVIII века, Дубровицы (Московская область)", "photos": [1]},
    ],
    22: [
        {"title": "Меншикова башня", "description": "Начало XVIII века, Москва", "photos": [0, 1]},
    ],
    23: [
        {"title": "Петропавловский собор", "description": "Первая треть XVIII века, Санкт-Петербург, Трезини", "photos": [0]},
        {"title": "Летний дворец Петра I", "description": "Начало XVIII века, Санкт-Петербург, Трезини", "photos": [1]},
    ],
    24: [
        {"title": "Здание 12 коллегий", "description": "Первая половина XVIII века, Санкт-Петербург, Трезини", "photos": [0]},
        {"title": "Меншиковский дворец", "description": "Начало XVIII века, Санкт-Петербург", "photos": [1]},
    ],
    25: [
        {"title": "Кунсткамера", "description": "Начало XVIII века, Санкт-Петербург", "photos": [0]},
        {"title": "Смольный собор", "description": "1748, Санкт-Петербург, Варфоломей Варфоломеевич Растрелли", "photos": [1]},
    ],
    26: [
        {"title": "Зимний дворец", "description": "1754, Санкт-Петербург, Варфоломей Варфоломеевич Растрелли", "photos": [0]},
        {"title": "Большой Екатерининский дворец", "description": "1756, Санкт-Петербург, Варфоломей Варфоломеевич Растрелли", "photos": [1]},
    ],
    27: [
        {"title": "Усадьба Царицыно", "description": "1770-е, Москва, Баженов", "photos": [0]},
        {"title": "Дом Пашкова", "description": "1780-е, Москва, Баженов", "photos": [1]},
    ],
    28: [
        {"title": "Сенатский дворец", "description": "1780-е, Москва, Казаков", "photos": [0]},
        {"title": "Таврический дворец", "description": "1780-е, Санкт-Петербург, Старов", "photos": [1]},
    ],
    29: [
        {"title": "Казанский собор", "description": "1811, Санкт-Петербург, Воронихин", "photos": [0]},
        {"title": "Манеж", "description": "1817, Москва", "photos": [1]},
    ],
    30: [
        {"title": "Главное адмиралтейство", "description": "1823, Санкт-Петербург, Андреян Захаров", "photos": [0]},
        {"title": "Большой театр", "description": "1825, Москва, Бове", "photos": [1]},
    ],
    31: [
        {"title": "Арка главного штаба", "description": "1829, Санкт-Петербург, Росси", "photos": [0]},
        {"title": "Триумфальная арка", "description": "1834, Москва, Бове", "photos": [1]},
    ],
    32: [
        {"title": "Большой Кремлёвский дворец", "description": "1849, Москва, Тон", "photos": [0]},
        {"title": "Исаакиевский собор", "description": "1858, Санкт-Петербург, Монферран", "photos": [1]},
    ],
    33: [
        {"title": "Храм Христа Спасителя", "description": "Вторая треть XIX века (строился при Николае I и Александре II), Москва, Тон, построен в честь победы в Отечественной войне 1812 года, снесен при Сталине, построен вновь при Ельцине", "photos": [0]},
    ],
    34: [
        {"title": "Государственный исторический музей", "description": "1883, Москва, Шервуд", "photos": [0]},
        {"title": "ГУМ (Верхние торговые ряды)", "description": "1893, Москва, Померанцев", "photos": [1]},
    ],
    35: [
        {"title": "Храм Воскресения Христова на крови (Спас на крови)", "description": "1907 (строился при Александре III и Николае II), Санкт-Петербург, построен на месте смертельного ранения Александра II", "photos": [0, 1]},
    ],
    36: [
        {"title": "Гостиница Метрополь", "description": "Построена в 1899-1905, Москва, модерн", "photos": [0]},
        {"title": "Ярославский вокзал", "description": "Начало XX века, Москва, русский (неорусский, псевдорусский) стиль. Федор Шехтель", "photos": [1]},
    ],
    37: [
        {"title": "Особняки", "description": "Начало XX века, модерн, Москва, Федор Шехтель", "photos": [0, 1, 2, 3]},
    ],
    38: [
        {"title": "Политехнический музей", "description": "Конец XIX - начало XX века, Москва, русский (неорусский, псевдорусский) стиль", "photos": [0]},
        {"title": "Пушкинский музей", "description": "1912, Москва, неоклассический стиль", "photos": [1]},
    ],
    39: [
        {"title": "Шуховская башня", "description": "1922, Москва, конструктивизм. Шухов", "photos": [0]},
        {"title": "ДК имени Зуева", "description": "1929, Москва, конструктивизм. Илья Голосов", "photos": [1]},
    ],
    40: [
        {"title": "Мавзолей В.И. Ленина", "description": "1924-1930, Москва. Щусев", "photos": [0]},
        {"title": "Башня Татлина", "description": "Послереволюционные годы, конструктивизм, не построена. Владимир Татлин", "photos": [1]},
    ],
    41: [
        {"title": "Дом Мельникова", "description": "1929, Москва, авангард. Константин Мельников", "photos": [0, 1]},
    ],
    42: [
        {"title": "Дом культуры им. Русакова", "description": "1929, Москва, конструктивизм, Константин Мельников", "photos": [0]},
        {"title": "Театр Красной армии", "description": "1930, Москва, сталинский ампир. Построен в форме пятиконечной звезды", "photos": [1]},
    ],
    43: [
        {"title": "Сталинские высотки (семь сестёр)", "description": "Строились в 1947-1957 годах, сталинский ампир; в заданиях не требуется отличать высотки друг от друга", "photos": [0, 1, 2], "captions": ["Главное здание МГУ, 1949-1953", "Дом на Котельнической, 1948-1952", "Гостиница «Украина», 1953-1957"]},
    ],
    44: [
        {"title": "Сталинские высотки (семь сестёр)", "description": "Строились в 1947-1957 годах, сталинский ампир; в заданиях не требуется отличать высотки друг от друга", "photos": [0, 1, 2, 3], "captions": ["Здание МИД, 1948-1953", "Дом на Кудринской, 1948-1954", "Дом на Красных Воротах, 1947-1952", "Гостиница «Ленинградская», 1949-1954"]},
    ],
    45: [
        {"title": "Здание СЭВ (дом-книжка)", "description": "1970, Москва", "photos": [0]},
        {"title": "Дом правительства", "description": "1981, Москва", "photos": [1]},
    ],
}


TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

CENTURIES = {
    "XI": "XI век",
    "XII": "XII век",
    "XIII": "XIII век",
    "XIV": "XIV век",
    "XV": "XV век",
    "XVI": "XVI век",
    "XVII": "XVII век",
    "XVIII": "XVIII век",
    "XIX": "XIX век",
    "XX": "XX век",
}

LOCATIONS = [
    "Киев",
    "Великий Новгород",
    "Новгород",
    "Владимир",
    "Москва",
    "Московская область",
    "Санкт-Петербург",
    "Истра",
    "остров Кижи",
    "Дубровицы",
]

STYLES = [
    "Нарышкинское барокко",
    "Петровское барокко",
    "барокко",
    "модерн",
    "неорусский стиль",
    "псевдорусский стиль",
    "русский стиль",
    "неоклассический стиль",
    "конструктивизм",
    "авангард",
    "сталинский ампир",
]

CREATORS = [
    "мастер Пётр",
    "Феофан Грек",
    "Андрей Рублев",
    "Аристотель Фиорованти",
    "Пьетро Антонио Солари",
    "Марк Фрязин",
    "Алевиз Новый",
    "Бон Фрязин",
    "Федор Конь",
    "Кривцов и Мышкин",
    "Трезини",
    "Варфоломей Варфоломеевич Растрелли",
    "Баженов",
    "Казаков",
    "Старов",
    "Воронихин",
    "Андреян Захаров",
    "Бове",
    "Росси",
    "Монферран",
    "Тон",
    "Шервуд",
    "Померанцев",
    "Федор Шехтель",
    "Шухов",
    "Илья Голосов",
    "Щусев",
    "Владимир Татлин",
    "Константин Мельников",
]

RULERS = [
    "Ярослав Мудрый",
    "Мстислав Великий",
    "Андрей Боголюбский",
    "Всеволод Большое Гнездо",
    "Василий I",
    "Дмитрий Донской",
    "Алексей Михайлович",
    "Пётр I",
    "Николай I",
    "Александр II",
    "Александр III",
    "Николай II",
    "Сталин",
    "Ельцин",
    "патриарх Никон",
]

EVENTS = [
    ("Отечественной войне 1812", "победа в Отечественной войне 1812 года"),
    ("смертельного ранения Александра II", "смертельное ранение Александра II"),
]


def multiply_matrix(m, n):
    a, b, c, d, e, f = m
    g, h, i, j, k, l = n
    return [
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l + e,
        b * k + d * l + f,
    ]


def image_positions(reader: PdfReader, page_index: int):
    page = reader.pages[page_index]
    xobjects = page["/Resources"].get("/XObject", {})
    stream = ContentStream(page.get_contents(), reader)
    stack = []
    ctm = [1, 0, 0, 1, 0, 0]
    positions = []

    for operands, operator in stream.operations:
        if operator == b"q":
            stack.append(ctm[:])
        elif operator == b"Q":
            ctm = stack.pop() if stack else [1, 0, 0, 1, 0, 0]
        elif operator == b"cm":
            ctm = multiply_matrix(ctm, [float(value) for value in operands])
        elif operator == b"Do":
            name = str(operands[0])
            xobject = xobjects.get(name)
            if not xobject:
                continue
            obj = xobject.get_object()
            if obj.get("/Subtype") != "/Image":
                continue
            points = [(0, 0), (1, 0), (0, 1), (1, 1)]
            xs = [ctm[0] * x + ctm[2] * y + ctm[4] for x, y in points]
            ys = [ctm[1] * x + ctm[3] * y + ctm[5] for x, y in points]
            x0, x1 = min(xs), max(xs)
            y0, y1 = min(ys), max(ys)
            width = x1 - x0
            height = y1 - y0

            # Real page illustrations are large; labels and headers are small strips.
            if width >= 100 and height >= 100 and y1 < 500:
                positions.append(
                    {
                        "name": name.lstrip("/"),
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "width": width,
                        "height": height,
                    }
                )

    return sorted(positions, key=lambda item: (item["x0"], -item["y1"]))


def page_image_lookup(page):
    lookup = {}
    for image_file in page.images:
        stem = Path(image_file.name).stem
        lookup[stem] = image_file.image
    return lookup


def slugify(text: str) -> str:
    converted = []
    for char in text.lower():
        converted.append(TRANSLIT.get(char, char))
    text = "".join(converted)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "item"


def unique_slug(base: str, used: set[str]) -> str:
    slug = base
    counter = 2
    while slug in used:
        slug = f"{base}-{counter}"
        counter += 1
    used.add(slug)
    return slug


def years_from(text: str):
    return re.findall(r"\b(1[0-9]{3}|20[0-9]{2})\b", text)


def century_from(text: str):
    # Prefer longer roman numerals first so XVIII is not read as XVII.
    for roman in sorted(CENTURIES, key=len, reverse=True):
        if re.search(rf"\b{roman}\b", text):
            return CENTURIES[roman]
    return None


def period_from(text: str):
    if "послереволюцион" in text.lower():
        return "20th"

    years = [int(year) for year in years_from(text)]
    if years:
        first = min(years)
        if first < 1700:
            return "early"
        if first < 1800:
            return "18th"
        if first < 1900:
            return "19th"
        return "20th"

    century = century_from(text)
    if not century:
        return "all"
    if century in {"XI век", "XII век", "XIII век", "XIV век", "XV век", "XVI век", "XVII век"}:
        return "early"
    if century == "XVIII век":
        return "18th"
    if century == "XIX век":
        return "19th"
    if century == "XX век":
        return "20th"
    return "all"


def pick_locations(text: str):
    return [location for location in LOCATIONS if location.lower() in text.lower()]


def pick_styles(text: str):
    found = []
    lower = text.lower()
    for style in STYLES:
        if style.lower() in lower and style not in found:
            found.append(style)
    if any(style in found for style in ["Нарышкинское барокко", "Петровское барокко"]):
        found = [style for style in found if style != "барокко"]
    if any(style in found for style in ["неорусский стиль", "псевдорусский стиль"]):
        found = [style for style in found if style != "русский стиль"]
    return found


def pick_creators(text: str):
    found = []
    lower = text.lower()
    for creator in CREATORS:
        if creator.lower() in lower and creator not in found:
            found.append(creator)
    return found


def pick_rulers(text: str):
    found = []
    lower = text.lower()
    for ruler in RULERS:
        if ruler.lower() in lower and ruler not in found:
            found.append(ruler)
    return found


def pick_events(text: str):
    found = []
    lower = text.lower()
    for marker, event in EVENTS:
        if marker.lower() in lower and event not in found:
            found.append(event)
    return found


def build_traits(title: str, description: str):
    text = f"{title}. {description}"
    traits = [description.rstrip(".") + "."]
    years = years_from(text)
    century = century_from(text)
    locations = pick_locations(text)
    styles = pick_styles(text)
    creators = pick_creators(text)
    rulers = pick_rulers(text)
    events = pick_events(text)

    if years:
        traits.append("Связанная дата: " + ", ".join(dict.fromkeys(years)) + ".")
    if century:
        traits.append(f"Относится к {century}.")
    if locations:
        traits.append("Связанное место: " + ", ".join(dict.fromkeys(locations)) + ".")
    if styles:
        traits.append("Стиль/направление: " + ", ".join(styles) + ".")
    if creators:
        traits.append("Создатель/архитектор: " + ", ".join(creators) + ".")
    if rulers:
        traits.append("Связано с правителем/деятелем: " + ", ".join(rulers) + ".")
    if events:
        traits.append("Связанное событие: " + ", ".join(events) + ".")
    return list(dict.fromkeys(traits))


def first_year_label(years):
    if not years:
        return None
    unique = list(dict.fromkeys(years))
    return "-".join(unique) if len(unique) == 2 else ", ".join(unique)


def compact_date(years, century):
    return first_year_label(years) or century


def build_full_characteristic(description, facts):
    parts = []
    date = compact_date(facts["years"], facts["century"])
    if facts["locations"]:
        parts.append(", ".join(facts["locations"]))
    if date:
        parts.append(date)
    if facts["creators"]:
        parts.append("создатель/архитектор: " + ", ".join(facts["creators"]))
    if facts["styles"]:
        parts.append("стиль: " + ", ".join(facts["styles"]))
    if facts["rulers"]:
        parts.append("связано с: " + ", ".join(facts["rulers"]))
    if facts["events"]:
        parts.append("событие: " + ", ".join(facts["events"]))
    return "; ".join(parts) if parts else description


def build_drill_facts(facts):
    drills = []
    if facts["locations"]:
        drills.append({
            "type": "location",
            "label": "город/место",
            "question": "Где находится памятник?",
            "answer": facts["locations"][0],
        })
    date = compact_date(facts["years"], facts["century"])
    if facts["century"]:
        drills.append({
            "type": "century",
            "label": "век",
            "question": "К какому веку относится памятник?",
            "answer": facts["century"],
        })
    if date and date != facts["century"]:
        drills.append({
            "type": "date",
            "label": "дата",
            "question": "Какая дата связана с памятником?",
            "answer": date,
        })
    if facts["creators"]:
        drills.append({
            "type": "creator",
            "label": "создатель",
            "question": "Кто создатель / архитектор?",
            "answer": facts["creators"][0],
        })
    if facts["styles"]:
        drills.append({
            "type": "style",
            "label": "стиль",
            "question": "Какой стиль связан с памятником?",
            "answer": facts["styles"][0],
        })
    if facts["rulers"]:
        drills.append({
            "type": "ruler",
            "label": "правитель",
            "question": "С кем связан памятник?",
            "answer": facts["rulers"][0],
        })
    if facts["events"]:
        drills.append({
            "type": "event",
            "label": "событие",
            "question": "С каким событием связан памятник?",
            "answer": facts["events"][0],
        })
    return drills


def save_image(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if image.mode in {"RGBA", "LA"}:
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")
    image.save(path, format="JPEG", quality=90, optimize=True)


def clear_generated_images():
    OUT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    root = OUT_IMAGE_DIR.resolve()
    workspace = Path.cwd().resolve()
    if workspace != root and workspace not in root.parents:
        raise RuntimeError(f"Refusing to clean outside workspace: {root}")
    for image_path in root.glob("*.jpg"):
        image_path.unlink()


def merge_entries(entries):
    merged = {}
    order = []
    for entry in entries:
        key = (entry["title"], entry["description"])
        if key not in merged:
            merged[key] = entry
            order.append(key)
            continue
        target = merged[key]
        target["images"].extend(entry["images"])
        target["source"]["pages"].extend(entry["source"]["pages"])
        if entry.get("captions"):
            target.setdefault("captions", []).extend(entry["captions"])
    for key in order:
        item = merged[key]
        item["images"] = list(dict.fromkeys(item["images"]))
        item["source"]["pages"] = sorted(set(item["source"]["pages"]))
        if item.get("captions"):
            item["captions"] = list(dict.fromkeys(item["captions"]))
    return [merged[key] for key in order]


def main():
    if not PDF_PATH.exists():
        raise FileNotFoundError(PDF_PATH)

    reader = PdfReader(str(PDF_PATH))
    used_slugs: set[str] = set()
    entries = []
    warnings = []
    clear_generated_images()

    for page_number, page_entries in PAGE_ENTRIES.items():
        page_index = page_number - 1
        page = reader.pages[page_index]
        photos = image_positions(reader, page_index)
        lookup = page_image_lookup(page)

        for raw_entry in page_entries:
            slug = unique_slug(slugify(raw_entry["title"]), used_slugs)
            image_paths = []
            for image_order, photo_index in enumerate(raw_entry["photos"], start=1):
                if photo_index >= len(photos):
                    warnings.append(f"page {page_number}: missing photo index {photo_index} for {raw_entry['title']}")
                    continue
                photo = photos[photo_index]
                image = lookup.get(photo["name"])
                if image is None:
                    warnings.append(f"page {page_number}: could not decode {photo['name']} for {raw_entry['title']}")
                    continue
                suffix = "" if len(raw_entry["photos"]) == 1 else f"-{image_order}"
                output_path = OUT_IMAGE_DIR / f"{slug}{suffix}.jpg"
                save_image(image, output_path)
                image_paths.append(output_path.as_posix())

            description = raw_entry["description"]
            full_text = f"{raw_entry['title']} {description}"
            facts = {
                "century": century_from(full_text),
                "years": years_from(full_text),
                "locations": pick_locations(full_text),
                "styles": pick_styles(full_text),
                "creators": pick_creators(full_text),
                "rulers": pick_rulers(full_text),
                "events": pick_events(full_text),
            }
            entry = {
                "id": slug,
                "title": raw_entry["title"],
                "type": raw_entry.get("type", "architecture"),
                "period": period_from(full_text),
                "century": facts["century"],
                "years": facts["years"],
                "locations": facts["locations"],
                "styles": facts["styles"],
                "creators": facts["creators"],
                "rulers": facts["rulers"],
                "events": facts["events"],
                "description": description,
                "traits": build_traits(raw_entry["title"], description),
                "fullCharacteristic": build_full_characteristic(description, facts),
                "importantFacts": build_traits(raw_entry["title"], description),
                "drillFacts": build_drill_facts(facts),
                "images": image_paths,
                "mainImage": image_paths[0] if image_paths else None,
                "source": {
                    "file": SOURCE_NAME,
                    "pages": [page_number],
                },
                "reviewed": False,
            }
            if raw_entry.get("captions"):
                entry["captions"] = raw_entry["captions"]
            entries.append(entry)

    entries = merge_entries(entries)

    payload = json.dumps(entries, ensure_ascii=False, indent=2)
    OUT_DATA.write_text(
        "// Generated by scripts/extract_visual_architecture_pdf.py\n"
        "// Source PDF is user-provided; every entry is marked reviewed: false.\n"
        f"window.visualArchitectureData = {payload};\n",
        encoding="utf-8",
    )

    print(f"entries={len(entries)}")
    print(f"images={sum(len(entry['images']) for entry in entries)}")
    print(f"data={OUT_DATA}")
    print(f"image_dir={OUT_IMAGE_DIR}")
    if warnings:
        print("warnings:")
        for warning in warnings:
            print(f"- {warning}")


if __name__ == "__main__":
    main()
