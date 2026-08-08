from __future__ import annotations

import argparse
import html
import re
from collections import defaultdict
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import portrait
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "tools-and-docs"
OUTPUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
PDF_PATH = OUTPUT_DIR / "istoriya-rossii-862-2022-ege.pdf"
MANUSCRIPT_PATH = OUTPUT_DIR / "istoriya-rossii-862-2022-ege.md"

PAGE_SIZE = portrait((176 * mm, 250 * mm))
PAGE_W, PAGE_H = PAGE_SIZE
LEFT = 19 * mm
RIGHT = 17 * mm
TOP = 18 * mm
BOTTOM = 18 * mm
CONTENT_W = PAGE_W - LEFT - RIGHT

NAVY = colors.HexColor("#14213D")
BLUE = colors.HexColor("#234E70")
GOLD = colors.HexColor("#D69E45")
CREAM = colors.HexColor("#F7F2E8")
PAPER = colors.HexColor("#FCFAF5")
INK = colors.HexColor("#20252B")
MUTED = colors.HexColor("#69727D")
TEAL = colors.HexColor("#2D6A6A")
RED = colors.HexColor("#A34B3F")
GREEN = colors.HexColor("#556B2F")
PURPLE = colors.HexColor("#6D466B")
LINE = colors.HexColor("#DDD6C7")

ERA_COLORS = [
    TEAL,
    colors.HexColor("#9C6644"),
    BLUE,
    colors.HexColor("#A06A32"),
    GREEN,
    PURPLE,
    colors.HexColor("#8C3F4D"),
    colors.HexColor("#365B8C"),
    colors.HexColor("#556B62"),
]


def register_fonts() -> None:
    font_dir = Path("C:/Windows/Fonts")
    fonts = {
        "BookSerif": "DejaVuSerif.ttf",
        "BookSerifBold": "DejaVuSerif-Bold.ttf",
        "BookSerifItalic": "DejaVuSerif-Italic.ttf",
        "BookSans": "DejaVuSans.ttf",
        "BookSansBold": "DejaVuSans-Bold.ttf",
        "BookSansItalic": "DejaVuSans-Oblique.ttf",
    }
    for name, filename in fonts.items():
        pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily(
        "BookSerif",
        normal="BookSerif",
        bold="BookSerifBold",
        italic="BookSerifItalic",
        boldItalic="BookSerifBold",
    )
    pdfmetrics.registerFontFamily(
        "BookSans",
        normal="BookSans",
        bold="BookSansBold",
        italic="BookSansItalic",
        boldItalic="BookSansBold",
    )


def build_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles: dict[str, ParagraphStyle] = {}
    styles["Body"] = ParagraphStyle(
        "Body",
        parent=base["BodyText"],
        fontName="BookSerif",
        fontSize=9.25,
        leading=13.25,
        textColor=INK,
        alignment=TA_JUSTIFY,
        spaceAfter=6,
        allowWidows=0,
        allowOrphans=0,
    )
    styles["BodyLead"] = ParagraphStyle(
        "BodyLead",
        parent=styles["Body"],
        fontSize=10.3,
        leading=14.8,
        textColor=NAVY,
        spaceAfter=9,
    )
    styles["CoverTitle"] = ParagraphStyle(
        "CoverTitle",
        fontName="BookSansBold",
        fontSize=31,
        leading=34,
        textColor=colors.white,
        alignment=TA_LEFT,
        spaceAfter=12,
    )
    styles["CoverSub"] = ParagraphStyle(
        "CoverSub",
        fontName="BookSans",
        fontSize=13,
        leading=18,
        textColor=colors.HexColor("#E8EDF4"),
        alignment=TA_LEFT,
    )
    styles["PartTitle"] = ParagraphStyle(
        "PartTitle",
        fontName="BookSansBold",
        fontSize=24,
        leading=28,
        textColor=colors.white,
        backColor=NAVY,
        borderPadding=(17, 16, 17, 16),
        spaceBefore=4,
        spaceAfter=15,
        keepWithNext=True,
    )
    styles["ChapterTitle"] = ParagraphStyle(
        "ChapterTitle",
        fontName="BookSansBold",
        fontSize=17.5,
        leading=21.5,
        textColor=colors.white,
        backColor=BLUE,
        borderPadding=(11, 12, 11, 12),
        spaceAfter=11,
        keepWithNext=True,
    )
    styles["H1"] = ParagraphStyle(
        "H1",
        fontName="BookSansBold",
        fontSize=18,
        leading=22,
        textColor=NAVY,
        spaceBefore=8,
        spaceAfter=10,
        keepWithNext=True,
    )
    styles["H2"] = ParagraphStyle(
        "H2",
        fontName="BookSansBold",
        fontSize=12.6,
        leading=16,
        textColor=BLUE,
        spaceBefore=10,
        spaceAfter=5,
        keepWithNext=True,
    )
    styles["H3"] = ParagraphStyle(
        "H3",
        fontName="BookSansBold",
        fontSize=10.4,
        leading=13.5,
        textColor=TEAL,
        spaceBefore=7,
        spaceAfter=4,
        keepWithNext=True,
    )
    styles["QuestionHead"] = ParagraphStyle(
        "QuestionHead",
        parent=styles["H2"],
        textColor=PURPLE,
    )
    styles["ExamHead"] = ParagraphStyle(
        "ExamHead",
        parent=styles["H2"],
        textColor=GOLD,
    )
    styles["TrapHead"] = ParagraphStyle(
        "TrapHead",
        parent=styles["H2"],
        textColor=RED,
    )
    styles["SummaryHead"] = ParagraphStyle(
        "SummaryHead",
        parent=styles["H2"],
        textColor=TEAL,
    )
    styles["SummaryBody"] = ParagraphStyle(
        "SummaryBody",
        parent=styles["Body"],
        fontName="BookSans",
        fontSize=8.8,
        leading=12.7,
        textColor=colors.HexColor("#173D3D"),
        alignment=TA_LEFT,
        spaceBefore=0,
        spaceAfter=0,
    )
    styles["QuestionBody"] = ParagraphStyle(
        "QuestionBody",
        parent=styles["BodyLead"],
        fontName="BookSerifBold",
        textColor=PURPLE,
        alignment=TA_LEFT,
        spaceBefore=0,
        spaceAfter=0,
    )
    styles["Quote"] = ParagraphStyle(
        "Quote",
        parent=styles["BodyLead"],
        fontName="BookSerifItalic",
        leftIndent=12,
        rightIndent=8,
        borderColor=GOLD,
        borderWidth=0,
        borderLeft=2,
        borderPadding=8,
        textColor=NAVY,
        spaceBefore=6,
        spaceAfter=9,
    )
    styles["Bullet"] = ParagraphStyle(
        "Bullet",
        parent=styles["Body"],
        fontSize=8.9,
        leading=12.6,
        leftIndent=2,
        spaceAfter=2,
    )
    styles["Table"] = ParagraphStyle(
        "Table",
        fontName="BookSans",
        fontSize=7.25,
        leading=9.6,
        textColor=INK,
    )
    styles["TableHead"] = ParagraphStyle(
        "TableHead",
        parent=styles["Table"],
        fontName="BookSansBold",
        textColor=colors.white,
        alignment=TA_LEFT,
    )
    styles["TocTitle"] = ParagraphStyle(
        "TocTitle",
        fontName="BookSansBold",
        fontSize=22,
        leading=26,
        textColor=NAVY,
        spaceAfter=16,
    )
    styles["Small"] = ParagraphStyle(
        "Small",
        fontName="BookSans",
        fontSize=7.5,
        leading=10,
        textColor=MUTED,
    )
    return styles


STYLES: dict[str, ParagraphStyle]


def normalize(text: str) -> str:
    replacements = {
        "\u00a0": " ",
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "→": "->",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


def inline(text: str) -> str:
    text = normalize(text.strip())
    text = html.escape(text, quote=False)
    text = re.sub(
        r"\[([^\]]+)\]\((https?://[^\)]+)\)",
        lambda m: f'<link href="{m.group(2)}" color="#234E70"><u>{m.group(1)}</u></link>',
        text,
    )
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<i>\1</i>", text)
    text = text.replace("`", "")
    return text


def strip_root_title(text: str, cutoff: str | None = None) -> str:
    text = text.replace("\r\n", "\n")
    if cutoff and cutoff in text:
        text = text.split(cutoff, 1)[0].rstrip() + "\n"
    lines = text.splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    while lines and not lines[0].strip():
        lines.pop(0)
    return "\n".join(lines).rstrip() + "\n"


def framework_sections(text: str) -> dict[str, str]:
    pattern = re.compile(r"<!--\s*([A-Z0-9_]+)\s*-->")
    matches = list(pattern.finditer(text))
    result: dict[str, str] = {}
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        result[match.group(1)] = text[match.end():end].strip() + "\n"
    return result


def inject_after_chapter(source: str, chapter_heading: str, addition: str) -> str:
    """Insert an H2 deep-dive at the end of one numbered chapter."""
    start = source.find(chapter_heading)
    if start < 0:
        raise RuntimeError(f"Chapter marker not found for deep-dive: {chapter_heading}")
    title_end = source.find("\n", start)
    if title_end < 0:
        title_end = len(source)
    next_chapter = re.search(r"(?m)^# \d+\.", source[title_end + 1:])
    insert_at = title_end + 1 + next_chapter.start() if next_chapter else len(source)
    return source[:insert_at].rstrip() + "\n\n" + addition.strip() + "\n\n" + source[insert_at:].lstrip()


def inject_before_chapter_section(
    source: str,
    chapter_heading: str,
    addition: str,
    section_heading: str = "## Экзаменационный скелет",
) -> str:
    """Place an addition inside a chapter, before its final recall apparatus."""
    start = source.find(chapter_heading)
    if start < 0:
        raise RuntimeError(f"Chapter marker not found for native insert: {chapter_heading}")
    title_end = source.find("\n", start)
    if title_end < 0:
        title_end = len(source)
    next_chapter = re.search(r"(?m)^# \d+\.", source[title_end + 1:])
    chapter_end = title_end + 1 + next_chapter.start() if next_chapter else len(source)
    insert_at = source.find(section_heading, title_end, chapter_end)
    if insert_at < 0:
        insert_at = chapter_end
    return source[:insert_at].rstrip() + "\n\n" + addition.strip() + "\n\n" + source[insert_at:].lstrip()


def _exam_key(text: str) -> str:
    return text.casefold().replace("ё", "е").replace("‑", "-").replace("–", "-").replace("—", "-")


def _atlas_cards(path: Path, task: int, start: str | None = None, stop: str | None = None) -> list[dict[str, object]]:
    """Read tagged atlas cards while keeping service tags out of visible prose."""
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    if start:
        if start not in text:
            raise RuntimeError(f"Atlas start marker not found in {path.name}: {start}")
        text = text.split(start, 1)[1]
    if stop:
        if stop not in text:
            raise RuntimeError(f"Atlas stop marker not found in {path.name}: {stop}")
        text = text.split(stop, 1)[0]
    matches = list(re.finditer(r"(?m)^###\s+(.+)$", text))
    cards: list[dict[str, object]] = []
    tag_re = re.compile(rf"\b(?:23|24|25)-{task}-(?:\d+)\b")
    for index, match in enumerate(matches):
        raw_heading = match.group(1).strip()
        tags = tag_re.findall(raw_heading)
        if not tags:
            continue
        title = re.sub(rf"\s+-\s+(?=(?:23|24|25)-{task}-\d+).*$", "", raw_heading).strip()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end():end].strip()
        cards.append({"task": task, "title": title, "tags": tags, "body": body})
    return cards


def _canonical_cause(title: str) -> str:
    key = _exam_key(title)
    if "крещен" in key:
        return "крещение руси"
    if "мономах" in key and ("1113" in key or "приглаш" in key):
        return "приглашение мономаха"
    if "объедин" in key and "москв" in key:
        return "объединение вокруг москвы"
    return key


def _merge_cause_cards(cards: list[dict[str, object]]) -> list[dict[str, object]]:
    """Merge repeated 2023-2025 topics and keep the fuller explanation."""
    merged: dict[str, dict[str, object]] = {}
    order: list[str] = []
    for card in cards:
        canonical = _canonical_cause(str(card["title"]))
        if canonical not in merged:
            merged[canonical] = dict(card)
            order.append(canonical)
            continue
        current = merged[canonical]
        current["tags"] = list(dict.fromkeys([*current["tags"], *card["tags"]]))
        if len(str(card["body"])) > len(str(current["body"])):
            current["title"] = card["title"]
            current["body"] = card["body"]
    return [merged[key] for key in order]


EARLY_CHAPTERS = {
    "origins": "# 1. 862 и 882 годы: государство рождается на пути между мирами",
    "first_princes": "# 2. Олег, Игорь, Ольга и Святослав: как поход превращается в управление",
    "vladimir": "# 3. Владимир Святой: религия как государственный выбор",
    "yaroslav": "# 4. Ярослав Мудрый: право вместо одной только силы",
    "monomakh": "# 5. От Ярославичей к Мономаху: почему единство стало системой земель",
    "lands": "# 6. Русь земель: три политические модели и одна культурная общность",
    "baty": "# 7. Нашествие Батыя: военное поражение, которое изменило политическую карту",
    "horde_lithuania": "# 9. Русь между Ордой и Литвой: зависимость без исчезновения",
    "moscow": "# 10. Москва против Твери: как небольшой удел научился собирать преимущества",
    "donskoy": "# 11. Дмитрий Донской: победа, которая не отменила зависимость",
    "1425": "# 12. Василий I и рубеж 1425 года: Москва сильна, но порядок наследования ещё спорен",
    "culture": "# 13. Культурный код Руси: от летописи к Рублёву",
}

MID_CHAPTERS = {
    "ivan3": "# 2. Иван III: Новгород, Тверь и конец ордынской зависимости",
    "state": "# 3. Как княжество стало государством",
    "ivan4": "# 6. Избранная рада: первая системная перестройка царства",
    "livonian": "# 8. Ливонская война: окно, которое не удалось открыть",
    "godunov": "# 10. После Грозного: как закончилась династия",
    "smuta": "# 12. Смута: как государство потеряло законный центр",
    "romanovs": "# 13. Ополчения и Романовы: кто собрал государство заново",
    "mikhail": "# 14. Первые Романовы: восстановить страну и не потерять власть",
    "alexei": "# 15. Алексей Михайлович и Соборное уложение: порядок ценой несвободы",
    "rebellions": "# 16. «Бунташный век»: соль, медь и Степан Разин",
    "nikon": "# 17. Никон и Аввакум: реформа обряда, ставшая расколом общества",
    "west": "# 18. Украина, Польша и южная граница: большая война середины века",
    "pre_peter": "# 20. Фёдор Алексеевич и культура XVII века: Россия за шаг до Петра",
}

EIGHTEENTH_CHAPTERS = {
    "sophia": "# 1. Как Россия пришла к Петру",
    "north_war": "# 2. Северная война: путь от Нарвы к империи",
    "peter_state": "# 3. Петровская машина государства",
    "peter_price": "# 4. Цена петровской модернизации",
    "coups": "# 5. Эпоха дворцовых переворотов",
    "catherine": "# 6. Екатерина II и просвещённый абсолютизм",
    "estates": "# 7. Империя сословий: экономика, народы России и восстание Пугачёва",
    "catherine_foreign": "# 8. Внешняя политика Екатерины II",
    "paul": "# 9. Павел I: порядок против дворянской свободы",
    "culture": "# 10. Культура XVIII века: как заимствование стало собственным языком",
}

NINETEENTH_CHAPTERS = {
    "alex1": "# 1. От реформ Александра I к восстанию декабристов",
    "napoleon": "# 2. Россия в Наполеоновских войнах и Отечественная война 1812 года",
    "nicholas1": "# 3. Россия при Николае I: государство, общество и экономика",
    "crimea": "# 4. Восточный вопрос, Кавказская и Крымская войны",
    "reforms": "# 6. Великие реформы Александра II",
    "society": "# 7. Общественное и революционное движение 1860–1890-х годов",
    "alex2_foreign": "# 8. Внешняя политика Александра II",
    "alex3": "# 9. Россия при Александре III",
}

NICHOLAS_CHAPTERS = {
    "inheritance": "# 1. Наследник самодержавия: каким государем хотел быть Николай II",
    "witte": "# 2. Витте и рывок 1890-х: модернизация сверху",
    "japan": "# 3. Дальний Восток и война с Японией: поражение самоуверенности",
    "rev1905": "# 4. Революция 1905 года: когда просьба к царю стала борьбой с системой",
    "duma": "# 5. Дума и царь: конституция, которой боялись назвать конституцией",
    "stolypin": "# 6. Столыпин: реформа земли под охраной военно-полевого суда",
    "prewar": "# 7. Две России перед войной: экономический подъём и кризис доверия",
    "war": "# 8. Первая мировая: как император связал судьбу трона с фронтом",
    "february": "# 9. Февраль и отречение: четыре дня, в которые исчезла монархия",
}

MODERN_CHAPTERS = {
    number: heading for number, heading in {
        63: "# 63. Октябрь 1917 года: почему власть перешла к большевикам",
        64: "# 64. Брестский мир и Гражданская война: почему победили красные",
        65: "# 65. НЭП и образование СССР: как отступление спасло власть",
        66: "# 66. Великий перелом: индустриализация и коллективизация",
        67: "# 67. Сталинская политическая система, культура и внешняя политика 1930-х годов",
        72: "# 72. 1945-1953 годы: восстановление и начало холодной войны",
        73: "# 73. Хрущёвская оттепель: десталинизация без отказа от системы",
        74: "# 74. Хрущёвская экономика и внешняя политика: рывки, кризисы, космос",
        75: "# 75. СССР в 1964-1985 годах: стабильность, которая стала застоем",
        76: "# 76. Разрядка и Афганистан: как сверхдержава потеряла пространство для манёвра",
        77: "# 77. Перестройка: реформа, которая изменила систему быстрее, чем экономику",
        78: "# 78. 1991 год: почему Союз распался",
        79: "# 79. Россия в 1992-1999 годах: рынок, Конституция и цена перехода",
        80: "# 80. Россия в 2000-2022 годах: централизация, модернизация и новые вызовы",
    }.items()
}


def _cause_target(title: str) -> str:
    key = _exam_key(title)
    rules = [
        # Rus and the age of appanages.
        (("крещен",), EARLY_CHAPTERS["vladimir"]),
        (("мономах",), EARLY_CHAPTERS["monomakh"]),
        (("политической раздробленност",), EARLY_CHAPTERS["lands"]),
        (("западнорусские",), EARLY_CHAPTERS["horde_lithuania"]),
        (("великого княжества литовского",), EARLY_CHAPTERS["horde_lithuania"]),
        (("объедин", "москв"), EARLY_CHAPTERS["moscow"]),
        (("ивана калит",), EARLY_CHAPTERS["moscow"]),
        (("куликовск",), EARLY_CHAPTERS["donskoy"]),
        (("московская междоусобиц",), EARLY_CHAPTERS["1425"]),
        (("нашествие батыя",), EARLY_CHAPTERS["baty"]),
        # XV-XVII centuries.
        (("присоединение новгород",), MID_CHAPTERS["ivan3"]),
        (("ослабление власти бориса",), MID_CHAPTERS["godunov"]),
        (("причины смут",), MID_CHAPTERS["smuta"]),
        (("последствия смут",), MID_CHAPTERS["romanovs"]),
        (("лжедмитрий",), MID_CHAPTERS["smuta"]),
        (("азовское осадное",), MID_CHAPTERS["mikhail"]),
        (("земских собор",), MID_CHAPTERS["alexei"]),
        (("степана разин",), MID_CHAPTERS["rebellions"]),
        (("русско-польская война 1654",), MID_CHAPTERS["west"]),
        # Peter and the eighteenth century.
        (("азовские походы",), EIGHTEENTH_CHAPTERS["sophia"]),
        (("великое посольство",), EIGHTEENTH_CHAPTERS["sophia"]),
        (("северная война",), EIGHTEENTH_CHAPTERS["north_war"]),
        (("церковная реформа петр",), EIGHTEENTH_CHAPTERS["peter_state"]),
        (("указ о единонаследии",), EIGHTEENTH_CHAPTERS["peter_price"]),
        (("елизавета петровна",), EIGHTEENTH_CHAPTERS["coups"]),
        (("семилетняя война",), EIGHTEENTH_CHAPTERS["coups"]),
        (("переворот 1762",), EIGHTEENTH_CHAPTERS["coups"]),
        (("свобода предпринимательства",), EIGHTEENTH_CHAPTERS["catherine"]),
        (("восстание пугачев",), EIGHTEENTH_CHAPTERS["estates"]),
        (("русско-турецкая война 1768",), EIGHTEENTH_CHAPTERS["catherine_foreign"]),
        (("трехдневной барщин",), EIGHTEENTH_CHAPTERS["paul"]),
        (("трёхдневной барщин",), EIGHTEENTH_CHAPTERS["paul"]),
        # Nineteenth century.
        (("тильзитский мир",), NINETEENTH_CHAPTERS["napoleon"]),
        (("отечественной войне 1812",), NINETEENTH_CHAPTERS["napoleon"]),
        (("победа в отечественной",), NINETEENTH_CHAPTERS["napoleon"]),
        (("отказ александра i",), NINETEENTH_CHAPTERS["alex1"]),
        (("экономическое замедление",), NINETEENTH_CHAPTERS["alex1"]),
        (("декабрист",), NINETEENTH_CHAPTERS["alex1"]),
        (("военные поселения",), NINETEENTH_CHAPTERS["alex1"]),
        (("реформа государственной деревни",), NINETEENTH_CHAPTERS["nicholas1"]),
        (("крымская война",), NINETEENTH_CHAPTERS["crimea"]),
        (("сан-стефанск",), NINETEENTH_CHAPTERS["alex2_foreign"]),
        (("русско-турецкая война 1877",), NINETEENTH_CHAPTERS["alex2_foreign"]),
        (("русско-французский союз",), NINETEENTH_CHAPTERS["alex3"]),
        # Nicholas II.
        (("русско-японская война",), NICHOLAS_CHAPTERS["japan"]),
        (("столыпинская аграрная",), NICHOLAS_CHAPTERS["stolypin"]),
        (("роспуск ii государственной думы",), NICHOLAS_CHAPTERS["duma"]),
        (("манифест 17 октября",), NICHOLAS_CHAPTERS["rev1905"]),
        (("гумбиннен",), NICHOLAS_CHAPTERS["war"]),
        (("великое отступление",), NICHOLAS_CHAPTERS["war"]),
        (("брусиловский прорыв",), NICHOLAS_CHAPTERS["war"]),
        (("падение авторитета николая",), NICHOLAS_CHAPTERS["war"]),
        (("отречение николая",), NICHOLAS_CHAPTERS["february"]),
        (("образование временного правительства",), NICHOLAS_CHAPTERS["february"]),
        # Revolution and Soviet history.
        (("падение временного правительства",), MODERN_CHAPTERS[63]),
        (("июльские дни",), MODERN_CHAPTERS[63]),
        (("резолюция ленина",), MODERN_CHAPTERS[63]),
        (("брестский мир",), MODERN_CHAPTERS[64]),
        (("победили большевик",), MODERN_CHAPTERS[64]),
        (("деникин",), MODERN_CHAPTERS[64]),
        (("польско-советская",), MODERN_CHAPTERS[64]),
        (("кронштадт",), MODERN_CHAPTERS[65]),
        (("образование ссср",), MODERN_CHAPTERS[65]),
        (("коллективизац",), MODERN_CHAPTERS[66]),
        (("денежная реформа 1947",), MODERN_CHAPTERS[72]),
        (("целин",), MODERN_CHAPTERS[74]),
        (("ликвидация мтс",), MODERN_CHAPTERS[74]),
        (("кризис сельского хозяйства",), MODERN_CHAPTERS[74]),
        (("карибский кризис",), MODERN_CHAPTERS[74]),
        (("афганистан",), MODERN_CHAPTERS[76]),
        (("i съезд народных депутатов",), MODERN_CHAPTERS[77]),
    ]
    for needles, target in rules:
        if all(needle in key for needle in needles):
            return target
    raise RuntimeError(f"No native cause target for: {title}")


def _comparison_target(title: str) -> str:
    key = _exam_key(title)
    rules = [
        (("олег и святослав",), EARLY_CHAPTERS["first_princes"]),
        (("святослав", "ярослав"), EARLY_CHAPTERS["yaroslav"]),
        (("ярослав мудрый и владимир мономах",), EARLY_CHAPTERS["monomakh"]),
        (("владимир святой и ярослав",), EARLY_CHAPTERS["yaroslav"]),
        (("новгород и владимиро-суздаль",), EARLY_CHAPTERS["lands"]),
        (("до и после батыева",), EARLY_CHAPTERS["baty"]),
        (("орда и русь",), EARLY_CHAPTERS["horde_lithuania"]),
        (("иван калита и дмитрий",), EARLY_CHAPTERS["donskoy"]),
        (("культура второй половины xii",), EARLY_CHAPTERS["culture"]),
        (("иван калита и иван iii",), MID_CHAPTERS["ivan3"]),
        (("иван iii и василий iii",), MID_CHAPTERS["state"]),
        (("иван iii и иван iv",), MID_CHAPTERS["ivan4"]),
        (("вотчина и поместь",), MID_CHAPTERS["state"]),
        (("крестьяне при иване iii",), MID_CHAPTERS["ivan4"]),
        (("восток и запад", "ивана iv"), MID_CHAPTERS["livonian"]),
        (("борис годунов и василий шуйский",), MID_CHAPTERS["smuta"]),
        (("крестьяне при федоре",), MID_CHAPTERS["mikhail"]),
        (("деулино и андрусово",), MID_CHAPTERS["west"]),
        (("михаил и алексей романов",), MID_CHAPTERS["alexei"]),
        (("до и после реформы никона",), MID_CHAPTERS["nikon"]),
        (("иван iv и алексей михайлович",), MID_CHAPTERS["west"]),
        (("соляной и медный",), MID_CHAPTERS["rebellions"]),
        (("медный и соляной",), MID_CHAPTERS["rebellions"]),
        (("иван iv и федор алексеевич",), MID_CHAPTERS["pre_peter"]),
        (("культура xvi и xvii",), MID_CHAPTERS["pre_peter"]),
        (("алексей михайлович и петр i",), EIGHTEENTH_CHAPTERS["peter_state"]),
        (("управление при алексее михайловиче и петре i",), EIGHTEENTH_CHAPTERS["peter_state"]),
        (("культура второй половины xvii",), EIGHTEENTH_CHAPTERS["culture"]),
        (("петровская эпоха",), EIGHTEENTH_CHAPTERS["coups"]),
        (("петр i и елизавета",), EIGHTEENTH_CHAPTERS["coups"]),
        (("петр i и екатерина ii", "внутренн"), EIGHTEENTH_CHAPTERS["catherine"]),
        (("петр i и екатерина ii", "государственн"), EIGHTEENTH_CHAPTERS["catherine"]),
        (("петр i и екатерина ii", "внешн"), EIGHTEENTH_CHAPTERS["catherine_foreign"]),
        (("петр i и павел i",), EIGHTEENTH_CHAPTERS["paul"]),
        (("павел i и александр i",), NINETEENTH_CHAPTERS["alex1"]),
        (("екатерина ii и николай i",), NINETEENTH_CHAPTERS["crimea"]),
        (("петр i и николай i",), NINETEENTH_CHAPTERS["crimea"]),
        (("международное положение в 1810",), NINETEENTH_CHAPTERS["crimea"]),
        (("петр i и александр ii",), NINETEENTH_CHAPTERS["reforms"]),
        (("николай i и александр ii", "социально-экон"), NINETEENTH_CHAPTERS["reforms"]),
        (("крестьяне до и после 1861",), NINETEENTH_CHAPTERS["reforms"]),
        (("александр i и александр ii", "социал"), NINETEENTH_CHAPTERS["reforms"]),
        (("екатерина ii и александр ii",), NINETEENTH_CHAPTERS["reforms"]),
        (("николай i и александр ii", "внешн"), NINETEENTH_CHAPTERS["alex2_foreign"]),
        (("александр i и александр ii", "внешн"), NINETEENTH_CHAPTERS["alex2_foreign"]),
        (("николай i и александр iii",), NINETEENTH_CHAPTERS["alex3"]),
        (("александр ii и александр iii",), NINETEENTH_CHAPTERS["alex3"]),
        (("петр i и александр iii",), NINETEENTH_CHAPTERS["alex3"]),
        (("национальная политика начала",), NINETEENTH_CHAPTERS["alex3"]),
        (("местное самоуправление",), NINETEENTH_CHAPTERS["alex3"]),
        (("екатерина ii и александр iii",), NINETEENTH_CHAPTERS["alex3"]),
        (("александр iii и николай ii", "социально-экон"), NICHOLAS_CHAPTERS["witte"]),
        (("александр iii и николай ii", "политич"), NICHOLAS_CHAPTERS["duma"]),
        (("павел i и николай ii",), NICHOLAS_CHAPTERS["inheritance"]),
        (("александр ii и николай ii",), NICHOLAS_CHAPTERS["japan"]),
        (("международное положение россии в 1850",), NICHOLAS_CHAPTERS["japan"]),
        (("государственный строй в 1890",), NICHOLAS_CHAPTERS["duma"]),
        (("1914 и 1917",), NICHOLAS_CHAPTERS["february"]),
        (("i и ii съезды советов",), MODERN_CHAPTERS[63]),
        (("временное правительство и большевик",), MODERN_CHAPTERS[63]),
        (("временное правительство и совнарком",), MODERN_CHAPTERS[63]),
        (("большевики в июне и октябре",), MODERN_CHAPTERS[63]),
        (("февраль и октябрь",), MODERN_CHAPTERS[63]),
        (("красные и белые",), MODERN_CHAPTERS[64]),
        (("военный коммунизм и нэп",), MODERN_CHAPTERS[65]),
        (("труд при военном коммунизме",), MODERN_CHAPTERS[65]),
        (("тамбов", "кронштад"), MODERN_CHAPTERS[65]),
        (("ленин", "сталин", "ссср"), MODERN_CHAPTERS[65]),
        (("общество 1920-х и 1930-х",), MODERN_CHAPTERS[66]),
        (("крестьянство при нэпе",), MODERN_CHAPTERS[66]),
        (("управление экономикой",), MODERN_CHAPTERS[66]),
        (("бухарин и сталин",), MODERN_CHAPTERS[66]),
        (("аграрная политика большевиков",), MODERN_CHAPTERS[66]),
        (("ссср в 1923 и 1934",), MODERN_CHAPTERS[67]),
        (("первая и третья пятилетки",), MODERN_CHAPTERS[67]),
        (("конституции ссср 1924",), MODERN_CHAPTERS[67]),
        (("внешнее положение в 1930",), MODERN_CHAPTERS[72]),
        (("1945-1953 и 1953-1964",), MODERN_CHAPTERS[74]),
        (("колхозник", "1980"), MODERN_CHAPTERS[75]),
        (("разрядка и новое мышление",), MODERN_CHAPTERS[77]),
        (("оттепель и перестройка",), MODERN_CHAPTERS[77]),
        (("политическая система ссср", "1940"), MODERN_CHAPTERS[77]),
        (("российская империя 1910",), MODERN_CHAPTERS[78]),
        (("ссср 1991 и россия 1992",), MODERN_CHAPTERS[79]),
        (("август 1991", "октябрь 1993"), MODERN_CHAPTERS[79]),
        (("экономическая реформа ссср и китая",), MODERN_CHAPTERS[77]),
    ]
    for needles, target in rules:
        if all(needle in key for needle in needles):
            return target
    raise RuntimeError(f"No native comparison target for: {title}")


SELECTED_WORLD_TAGS = {
    "23-21-90", "24-21-120", "24-21-122", "23-21-92", "23-21-94",
    "23-21-95", "24-21-129", "24-21-133", "23-21-101", "24-21-134",
    "23-21-103", "23-21-105", "23-21-109", "24-21-139", "23-21-112",
    "23-21-114", "23-21-116", "24-21-147", "23-21-118",
    "25-21-03", "25-21-04", "25-21-06", "25-21-09", "25-21-15",
    "25-21-16", "25-21-19", "25-21-22", "25-21-24", "25-21-28",
    "25-21-29",
}


def _world_target(title: str) -> str:
    key = _exam_key(title)
    rules = [
        (("норманн",), EARLY_CHAPTERS["origins"]),
        (("политическая раздробленност",), EARLY_CHAPTERS["baty"]),
        (("падение зависимости",), MID_CHAPTERS["ivan3"]),
        (("религия и сопротивление",), MID_CHAPTERS["smuta"]),
        (("религия и выбор правителя",), MID_CHAPTERS["smuta"]),
        (("сословное представительство",), MID_CHAPTERS["romanovs"]),
        (("защита производителя",), MID_CHAPTERS["alexei"]),
        (("налоги и восстания",), MID_CHAPTERS["rebellions"]),
        (("религиозный раскол",), MID_CHAPTERS["nikon"]),
        (("от сословной монархии",), EIGHTEENTH_CHAPTERS["peter_state"]),
        (("территориальное расширение",), EIGHTEENTH_CHAPTERS["north_war"]),
        (("семилетняя война",), EIGHTEENTH_CHAPTERS["coups"]),
        (("пугачев", "американ"), EIGHTEENTH_CHAPTERS["estates"]),
        (("зарубежные походы",), NINETEENTH_CHAPTERS["alex1"]),
        (("кодификация",), NINETEENTH_CHAPTERS["nicholas1"]),
        (("общество и промышленность",), NICHOLAS_CHAPTERS["witte"]),
        (("промышленный переворот", "социальное законодательство"), NICHOLAS_CHAPTERS["witte"]),
        (("поражение и реформы",), NICHOLAS_CHAPTERS["japan"]),
        (("внешняя политика и революционный кризис",), NICHOLAS_CHAPTERS["japan"]),
        (("радикальные силы и поражение",), MODERN_CHAPTERS[63]),
        (("революция и мир после",), MODERN_CHAPTERS[64]),
        (("модели 1920-х и кризис",), MODERN_CHAPTERS[65]),
        (("экономический кризис", "государственное вмешательство"), MODERN_CHAPTERS[66]),
        (("сокращение репрессий",), MODERN_CHAPTERS[73]),
        (("космическая гонка",), MODERN_CHAPTERS[74]),
        (("уход сверхдержав",), MODERN_CHAPTERS[76]),
        (("экономические реформы и политическая активность",), MODERN_CHAPTERS[77]),
        (("перестройка и пражская весна",), MODERN_CHAPTERS[77]),
        (("политические перемены и рыночные реформы",), MODERN_CHAPTERS[77]),
    ]
    for needles, target in rules:
        if all(needle in key for needle in needles):
            return target
    raise RuntimeError(f"No native world-history target for: {title}")


def native_exam_cards() -> list[dict[str, object]]:
    causes = _merge_cause_cards([
        *_atlas_cards(
            SOURCE_DIR / "ege-atlas-18-19.md", 18,
            start="# Причинный атлас: задание 18",
            stop="# Термин без зубрёжки: задание 19",
        ),
        *_atlas_cards(
            SOURCE_DIR / "ege-atlas-2025-18-19.md", 18,
            start="# Задание 18: темы ЕГЭ-2025",
            stop="# Задание 19: термины ЕГЭ-2025",
        ),
    ])
    comparisons = [
        card for card in _atlas_cards(SOURCE_DIR / "ege-atlas-20.md", 20)
        if any(str(tag).startswith(("23-", "24-")) for tag in card["tags"])
    ]
    comparisons.extend(_atlas_cards(SOURCE_DIR / "ege-atlas-2025-20.md", 20))
    world = [
        card for card in _atlas_cards(SOURCE_DIR / "ege-atlas-21.md", 21)
        if any(tag in SELECTED_WORLD_TAGS for tag in card["tags"])
        and any(str(tag).startswith(("23-", "24-")) for tag in card["tags"])
    ]
    world.extend([
        card for card in _atlas_cards(SOURCE_DIR / "ege-atlas-2025-21.md", 21)
        if any(tag in SELECTED_WORLD_TAGS for tag in card["tags"])
    ])

    for card in causes:
        card["target"] = _cause_target(str(card["title"]))
    for card in comparisons:
        card["target"] = _comparison_target(str(card["title"]))
    for card in world:
        card["target"] = _world_target(str(card["title"]))
    return [*causes, *comparisons, *world]


def _render_native_group(task: int, cards: list[dict[str, object]]) -> str:
    headings = {
        18: "## Причинная логика: как работает событие",
        20: "## Линии сравнения: один критерий, две эпохи",
        21: "## Россия и мир: один механизм",
    }
    blocks = [headings[task]]
    for card in cards:
        tags = " ".join(str(tag) for tag in card["tags"])
        blocks.extend([
            f"### {card['title']}",
            f"<!-- NATIVE-COVERAGE {tags} -->",
            str(card["body"]).strip(),
        ])
    return "\n\n".join(blocks)


def apply_native_exam_threads(source: str) -> str:
    grouped: dict[str, dict[int, list[dict[str, object]]]] = defaultdict(lambda: defaultdict(list))
    for card in native_exam_cards():
        target = str(card["target"])
        if target in source:
            grouped[target][int(card["task"])].append(card)
    for target in sorted(grouped, key=source.find, reverse=True):
        pieces = [
            _render_native_group(task, grouped[target][task])
            for task in (18, 20, 21)
            if grouped[target].get(task)
        ]
        source = inject_before_chapter_section(source, target, "\n\n".join(pieces))
    return source


def chronology_rows() -> list[tuple[str, str, int]]:
    """Extract the two useful columns and assign every dated fact to one period."""
    text = (SOURCE_DIR / "bank-exact-year-atlas.md").read_text(encoding="utf-8")
    rows: list[tuple[str, str, int]] = []
    for raw in text.splitlines():
        if not raw.startswith("|") or not raw.endswith("|"):
            continue
        cells = [cell.strip() for cell in raw.strip("|").split("|")]
        if len(cells) not in (2, 3) or cells[0] in {"Дата", "Период"}:
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        date = cells[0].replace("**", "")
        fact = cells[1].replace("**", "")
        year_match = re.search(r"(?<!\d)(\d{3,4})(?!\d)", date)
        if not year_match:
            raise RuntimeError(f"Cannot classify chronology row: {raw}")
        rows.append((date, fact, int(year_match.group(1))))
    if len(rows) != 310:
        raise RuntimeError(f"Expected 310 chronology rows, got {len(rows)}")
    # The source inventory stores single-year facts and multi-year periods in
    # separate groups.  A reader-facing chronology must interleave both groups
    # by their starting year; Python's stable sort preserves the sensible
    # source order for several facts beginning in the same year.
    return sorted(rows, key=lambda row: row[2])


def chronology_block(start_year: int, end_year: int) -> str:
    rows = [row for row in chronology_rows() if start_year <= row[2] <= end_year]
    if not rows:
        raise RuntimeError(f"Empty chronology interval: {start_year}-{end_year}")
    lines = [
        "# Хронология",
        "",
        f"## {start_year}-{end_year} годы",
        "",
        "| Дата | Факт |",
        "|---:|---|",
    ]
    lines.extend(f"| **{date}** | {fact} |" for date, fact, _ in rows)
    return "\n".join(lines)


CONTEXTUAL_TERM_BLOCKS = {
    MID_CHAPTERS["ivan3"]: [
        ("25-19-04", "Ересь", "религиозное учение, которое официальная церковь считает отклонением от догматов. Церковные соборы конца XV - начала XVI века осудили ересь «жидовствующих»."),
    ],
    MID_CHAPTERS["godunov"]: [
        ("24-19-64", "Угличское дело", "расследование гибели царевича Дмитрия в Угличе в 1591 году. Комиссия Василия Шуйского объявила смерть следствием несчастного случая."),
    ],
    MID_CHAPTERS["smuta"]: [
        ("25-19-09", "Самозванец", "человек, который выдаёт себя за правителя или наследника престола и на этом основании требует власть. Лжедмитрий I называл себя спасшимся царевичем Дмитрием и занял московский престол в 1605 году."),
    ],
    MID_CHAPTERS["alexei"]: [
        ("23-19-30", "Челобитная", "письменное прошение или жалоба частного лица царю либо органу власти в XV-XVIII веках. Челобитные посадских людей учитывались при подготовке Соборного уложения 1649 года."),
    ],
    MID_CHAPTERS["nikon"]: [
        ("24-19-69", "Церковный раскол", "разделение Русской церкви и общества из-за реформы обрядов и богослужебных книг в XVII веке. Протопоп Аввакум стал одним из главных лидеров старообрядцев."),
    ],
    MID_CHAPTERS["pre_peter"]: [
        ("25-19-14", "Подворная подать", "прямой налог, единицей обложения которого считался крестьянский или посадский двор, а не отдельный человек. Подворное обложение ввели при Фёдоре Алексеевиче, а Пётр I заменил его подушной податью."),
    ],
    EIGHTEENTH_CHAPTERS["sophia"]: [
        ("23-19-42 25-19-15", "Потешное войско, или потешные войска", "учебные военные отряды юного Петра I, созданные для освоения современного строя. Из них выросли Преображенский и Семёновский гвардейские полки."),
    ],
    NINETEENTH_CHAPTERS["society"]: [
        ("24-19-78", "Разночинцы", "образованные люди XIX века из разных недворянских сословий. Н. Г. Чернышевский происходил из духовного сословия и стал заметным представителем разночинной интеллигенции."),
    ],
    MODERN_CHAPTERS[63]: [
        ("25-19-22", "Народный комиссариат", "центральный отраслевой орган государственного управления в Советской России и СССР в 1917-1946 годах, аналог министерства во главе с народным комиссаром. Первым народным комиссаром по иностранным делам был Л. Д. Троцкий."),
    ],
    MODERN_CHAPTERS[65]: [
        ("23-19-51", "Антоновщина", "Тамбовское крестьянское восстание 1920-1921 годов под руководством А. С. Антонова против продразвёрстки и власти большевиков. Восстание подавили войска под командованием М. Н. Тухачевского."),
        ("23-19-52", "Пионерская организация", "массовая коммунистическая организация детей школьного возраста, созданная в 1922 году. Она носила имя В. И. Ленина."),
    ],
    MODERN_CHAPTERS[72]: [
        ("24-19-84", "Железный занавес", "образ политического и информационного разделения советского блока и Запада. Уинстон Черчилль использовал это выражение в Фултонской речи 1946 года."),
        ("25-19-28", "Страны народной демократии", "государства Центральной и Восточной Европы, где после Второй мировой войны при поддержке СССР установились режимы во главе с коммунистическими или рабочими партиями. Польша, Венгрия, Болгария, Румыния, Чехословакия и ГДР вошли в СЭВ, а большинство - в ОВД."),
    ],
    MODERN_CHAPTERS[77]: [
        ("24-19-85", "Индивидуальная трудовая деятельность", "самостоятельная работа граждан в сфере производства и услуг, разрешённая законом. Закон 1986 года расширил такую деятельность в СССР."),
    ],
    MODERN_CHAPTERS[79]: [
        ("24-19-88", "Импичмент", "установленная законом процедура отрешения высшего должностного лица от власти. В 1999 году Государственная дума рассматривала вопрос об отрешении президента Б. Н. Ельцина, но ни одно обвинение не получило нужного числа голосов."),
    ],
}


def apply_contextual_terms(source: str) -> str:
    for target in sorted(CONTEXTUAL_TERM_BLOCKS, key=source.find, reverse=True):
        if target not in source:
            continue
        lines = ["## Слово эпохи: термин в контексте"]
        for tags, term, explanation in CONTEXTUAL_TERM_BLOCKS[target]:
            lines.extend([
                f"<!-- NATIVE-TERM {tags} -->",
                f"**{term}** - {explanation}",
            ])
        source = inject_before_chapter_section(source, target, "\n\n".join(lines))
    return source


def key_event_sections() -> dict[str, str]:
    return framework_sections(
        (SOURCE_DIR / "history-key-event-deep-dives.md").read_text(encoding="utf-8")
    )


def modern_deep_sections() -> dict[str, str]:
    return framework_sections(
        (SOURCE_DIR / "modern-history-deep-dives.md").read_text(encoding="utf-8")
    )


def early_source_parts() -> tuple[str, str]:
    source = strip_root_title((SOURCE_DIR / "microtextbooks-862-1425-draft.md").read_text(encoding="utf-8"))
    source = inject_after_chapter(
        source,
        "# 4. Ярослав Мудрый: право вместо одной только силы",
        key_event_sections()["RUSSKAYA_PRAVDA"],
    )
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    marker = "# 6. Русь земель: три политические модели и одна культурная общность"
    if marker not in source:
        raise RuntimeError("Early-history source split marker not found")
    first, second = source.split(marker, 1)
    return first.rstrip() + "\n", marker + second


def integrated_15_17_source() -> str:
    source = strip_root_title(
        (SOURCE_DIR / "microtextbooks-15-17-centuries-draft.md").read_text(encoding="utf-8"),
        "# Редакторская рамка для приложения",
    )
    replacements = {
        "# Часть I. XV — начало XVI века": "# Раздел III.A. XV - начало XVI века",
        "# Часть II. XVI век": "# Раздел III.B. XVI век",
        "# Часть III. XVII век": "# Раздел III.C. XVII век",
    }
    for old, new in replacements.items():
        source = source.replace(old, new)
    deep = key_event_sections()
    source = inject_after_chapter(
        source,
        "# 2. Иван III: Новгород, Тверь и конец ордынской зависимости",
        deep["SUDEBNIK_1497"],
    )
    source = inject_after_chapter(
        source,
        "# 6. Избранная рада: первая системная перестройка царства",
        deep["SUDEBNIK_1550"],
    )
    source = inject_after_chapter(
        source,
        "# 15. Алексей Михайлович и Соборное уложение: порядок ценой несвободы",
        deep["ULOZHENIE_1649"],
    )
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    source = inject_after_chapter(source, MID_CHAPTERS["ivan3"], chronology_block(862, 1505))
    return source


def integrated_18_source() -> str:
    source = strip_root_title((SOURCE_DIR / "microtextbooks-18-century-draft.md").read_text(encoding="utf-8"))
    palace_start = "# 5. Эпоха дворцовых переворотов"
    palace_end = "# 6. Екатерина II и просвещённый абсолютизм"
    if palace_start not in source or palace_end not in source:
        raise RuntimeError("Palace-coups chapter markers not found")
    before_palace, palace_and_after = source.split(palace_start, 1)
    _, after_palace = palace_and_after.split(palace_end, 1)
    expanded_palace = (SOURCE_DIR / "palace-coups-expanded.md").read_text(encoding="utf-8").strip()
    source = (
        before_palace.rstrip()
        + "\n\n---\n\n"
        + expanded_palace
        + "\n\n---\n\n"
        + palace_end
        + after_palace
    )
    deep = key_event_sections()
    source = inject_after_chapter(
        source,
        "# 3. Петровская машина государства",
        deep["PETER_STATE"],
    )
    source = inject_after_chapter(
        source,
        "# 7. Империя сословий: экономика, народы России и восстание Пугачёва",
        deep["NOBILITY_FREEDOM"],
    )
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    source = inject_after_chapter(source, EIGHTEENTH_CHAPTERS["sophia"], chronology_block(1506, 1689))
    source = inject_after_chapter(source, EIGHTEENTH_CHAPTERS["paul"], chronology_block(1690, 1801))
    return source


def integrated_19_source() -> str:
    source = strip_root_title((SOURCE_DIR / "microtextbooks-19-century-draft.md").read_text(encoding="utf-8"))
    deep = key_event_sections()
    source = inject_after_chapter(
        source,
        "# 6. Великие реформы Александра II",
        deep["EMANCIPATION_1861"],
    )
    source = inject_after_chapter(
        source,
        "# 6. Великие реформы Александра II",
        deep["GREAT_REFORMS_SYSTEM"],
    )
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    return source


def integrated_nicholas_source() -> str:
    source = strip_root_title(
        (SOURCE_DIR / "microtextbook-nicholas-ii-draft.md").read_text(encoding="utf-8"),
        "# Редакторская рамка для приложения",
    )
    deep = key_event_sections()
    source = inject_after_chapter(
        source,
        "# 4. Революция 1905 года: когда просьба к царю стала борьбой с системой",
        deep["REVOLUTION_1905"],
    )
    source = inject_after_chapter(
        source,
        "# 5. Дума и царь: конституция, которой боялись назвать конституцией",
        deep["FUNDAMENTAL_LAWS"],
    )
    source = inject_after_chapter(
        source,
        "# 6. Столыпин: реформа земли под охраной военно-полевого суда",
        deep["STOLYPIN_REFORM"],
    )
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    source = inject_after_chapter(source, NICHOLAS_CHAPTERS["february"], chronology_block(1802, 1917))
    return source


def modern_source_parts() -> tuple[str, str, str]:
    source = strip_root_title(
        (SOURCE_DIR / "microtextbooks-1917-2022-draft.md").read_text(encoding="utf-8")
    )
    deep = modern_deep_sections()
    chapter_headings = {
        "MODERN_63": "# 63. Октябрь 1917 года: почему власть перешла к большевикам",
        "MODERN_64": "# 64. Брестский мир и Гражданская война: почему победили красные",
        "MODERN_65": "# 65. НЭП и образование СССР: как отступление спасло власть",
        "MODERN_66": "# 66. Великий перелом: индустриализация и коллективизация",
        "MODERN_67": "# 67. Сталинская политическая система, культура и внешняя политика 1930-х годов",
        "MODERN_68": "# 68. 1941 год: катастрофа, которая не стала поражением",
        "MODERN_69": "# 69. Коренной перелом: от Сталинграда до Курска",
        "MODERN_70": "# 70. 1944-1945 годы: освобождение, Победа и новый мировой порядок",
        "MODERN_71": "# 71. Человек на войне: фронт, тыл, оккупация и память",
        "MODERN_72": "# 72. 1945-1953 годы: восстановление и начало холодной войны",
        "MODERN_73": "# 73. Хрущёвская оттепель: десталинизация без отказа от системы",
        "MODERN_74": "# 74. Хрущёвская экономика и внешняя политика: рывки, кризисы, космос",
        "MODERN_75": "# 75. СССР в 1964-1985 годах: стабильность, которая стала застоем",
        "MODERN_76": "# 76. Разрядка и Афганистан: как сверхдержава потеряла пространство для манёвра",
        "MODERN_77": "# 77. Перестройка: реформа, которая изменила систему быстрее, чем экономику",
        "MODERN_78": "# 78. 1991 год: почему Союз распался",
        "MODERN_79": "# 79. Россия в 1992-1999 годах: рынок, Конституция и цена перехода",
        "MODERN_80": "# 80. Россия в 2000-2022 годах: централизация, модернизация и новые вызовы",
    }
    for key, heading in chapter_headings.items():
        source = inject_after_chapter(source, heading, deep[key])
    source = apply_native_exam_threads(source)
    source = apply_contextual_terms(source)
    source = inject_after_chapter(source, MODERN_CHAPTERS[72], chronology_block(1918, 1953))
    source = inject_after_chapter(source, MODERN_CHAPTERS[76], chronology_block(1954, 1985))
    source = inject_after_chapter(source, MODERN_CHAPTERS[80], chronology_block(1986, 2022))
    war_marker = chapter_headings["MODERN_68"]
    postwar_marker = "# 72. 1945-1953 годы: восстановление и начало холодной войны"
    if war_marker not in source or postwar_marker not in source:
        raise RuntimeError("Modern-history source split marker not found")
    revolution, remainder = source.split(war_marker, 1)
    war, postwar = (war_marker + remainder).split(postwar_marker, 1)
    return (
        revolution.rstrip() + "\n",
        war.rstrip() + "\n",
        postwar_marker + postwar,
    )


DISTANT_TRACES = {
    "862 и 882 годы": "Контроль пути создал княжескую власть, но ещё не единый аппарат. Через полюдье, уроки Ольги, ордынский выход и московские налоги эта линия ведёт к государству, способному постоянно собирать ресурсы.",
    "Олег, Игорь, Ольга и Святослав": "Гибель Игоря показала цену произвольного сбора. Уроки и погосты стали ранним переходом от личного действия правителя к норме и территориальному пункту управления.",
    "Владимир Святой": "Крещение создало общий культурный язык, переживший раздробленность и нашествие. Позднее Москва использует церковную общность как один из ресурсов политического объединения.",
    "От Ярославичей к Мономаху": "Спор родового старшинства с наследственной отчиной не исчез. В 1425 году он вернётся как борьба дяди и племянника за Московское княжество.",
    "Нашествие Батыя": "Орда не уничтожила княжества, а подчинила их через ярлык и выход. Борьба за право собирать дань усилит Москву, но сама по себе не сделает её победу неизбежной.",
    "Москва против Твери": "Иван Калита превратил сотрудничество с Ордой в ресурс внутреннего лидерства. Куликово добавит символ общего сопротивления, а распад Орды позволит Ивану III завершить зависимость на Угре.",
    "Василий I и рубеж 1425 года": "Сильная Москва унаследовала слабое правило передачи власти. Междоусобица 1425-1453 годов решит, станет ли великое княжение неделимым наследством прямой линии.",
    "Как княжество стало государством": "Поместная служба связала военную силу с доходом от земли. Через ограничения крестьянского перехода эта связь ведёт к Соборному уложению 1649 года, крепостному порядку XVIII века и реформе 1861 года.",
    "Опричнина": "Чрезвычайная власть может временно уничтожить сопротивление, но вместе с ним разрушает управление и доверие. Разорение 1560-1570-х годов станет одной из предпосылок династического кризиса и Смуты.",
    "Соборное уложение": "Бессрочный сыск 1649 года завершает правовую лестницу закрепощения. Вопрос о земле и свободе будет определять Пугачёвское восстание, реформу 1861 года, курс Столыпина и революцию 1917 года.",
    "Фёдор Алексеевич": "Отмена местничества, подворный налог, полки нового строя и светские элементы культуры показывают: Пётр ускорит переход, начавшийся до него.",
    "Петровская машина": "Сенат и коллегии заменят часть приказной раздробленности. В 1802 году Александр I продолжит ту же линию министерствами, а к XX веку проблема сместится от наличия аппарата к его политической ответственности.",
    "Цена петровской модернизации": "Петровский опыт закрепляет веру власти в быстрый рывок через принуждение. Этот способ повторится в реформах сверху XIX века и индустриальной политике Витте.",
    "Екатерина II и просвещённый абсолютизм": "Просвещённый язык без ограничения монарха создаёт образованную элиту, которая знает идеи права, но не имеет политического участия. Отсюда идут проекты Сперанского и декабристы.",
    "Империя сословий": "Освобождение дворян от обязательной службы при сохранении крестьянской зависимости делает крепостничество всё труднее оправдать интересом государства. XIX век унаследует этот моральный и экономический тупик.",
    "От реформ Александра I": "Проекты Сперанского впервые системно разводят законодательную, исполнительную и судебную функции. Неосуществлённая реформа возвращается в программах декабристов, земском конституционализме и споре о Думе.",
    "Великие реформы Александра II": "1861 год даёт личную свободу, но сохраняет малоземелье, выкуп и общину. Именно этот остаток будет реформировать Столыпин после революции 1905 года.",
    "Общественное и революционное движение": "Народничество передаст эсерам аграрный социализм, марксистские группы - РСДРП идею классовой партии, земские либералы - кадетам программу конституции.",
    "Россия при Александре III": "Николай II получает сильную корону, промышленный рост, Транссиб и союз с Францией - вместе с земской оппозицией, рабочим движением и отказом власти от общегосударственного представительства.",
    "Витте и рывок": "Железная дорога и крупный завод усиливают империю, но создают массового рабочего и единый рынок политической информации. Экономическая модернизация становится предпосылкой организованной революции.",
    "Революция 1905 года": "Компромисс 1905-1906 годов создаёт Думу, но не ответственное правительство. Во время мировой войны незавершённость этого решения лишит монархию широкого политического союза.",
    "Столыпин": "Реформа продолжает линию 1861 года: личную свободу дополняют частным выходом из общины. Война прерывает переход до того, как деревня получает устойчивое новое равновесие.",
    "Первая мировая": "Все дальние линии сходятся: массовая армия зависит от транспорта, деревни и промышленности; Дума требует участия; национальные окраины реагируют на мобилизацию; личная монархия связывает себя с фронтом.",
    "Октябрь 1917 года": "Нерешённые вопросы мира, земли и ответственного правительства превратили кризис империи в борьбу за новую форму власти. Большевики предложили немедленные решения, но их удержание потребовало Гражданской войны.",
    "Великий перелом": "Петровская логика ускорения сверху достигла предельной мобилизационной формы: государство направило деревенский ресурс в промышленность. Быстрый результат сопровождался насилием, голодом и потерей хозяйственной самостоятельности.",
    "1941 год": "Индустриальная база 1930-х стала ресурсом войны, а репрессии и слабость управления - частью причин первых поражений. Победа потребовала соединить централизованную мобилизацию с инициативой командиров и общества.",
    "Перестройка": "Старая система потеряла способность обновляться без политической обратной связи. Когда свобода обсуждения появилась раньше устойчивых рыночных и федеративных правил, реформа управления превратилась в кризис государства.",
    "Россия в 1992-1999": "Конституционный и крестьянский вопросы прошлых веков сменились спором о разделении властей и собственности. Скорость преобразований снова дала быстрый слом старого порядка и высокую социальную цену.",
}


def distant_trace(title: str):
    for key, value in DISTANT_TRACES.items():
        if key in title:
            label = Paragraph("<b>ДАЛЬНИЙ СЛЕД</b>", STYLES["Small"])
            body = Paragraph(inline(value), STYLES["Body"])
            table = Table([["", label], ["", body]], colWidths=[3.5 * mm, CONTENT_W - 3.5 * mm])
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (0, -1), GOLD),
                ("BACKGROUND", (1, 0), (1, -1), colors.HexColor("#FBF2DF")),
                ("TEXTCOLOR", (1, 0), (1, 0), colors.HexColor("#7A541C")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (1, 0), (1, -1), 9),
                ("RIGHTPADDING", (1, 0), (1, -1), 9),
                ("TOPPADDING", (1, 0), (1, 0), 7),
                ("BOTTOMPADDING", (1, 1), (1, 1), 7),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E6C98E")),
            ]))
            return table
    return None


class TimelineFlowable(Flowable):
    def __init__(self, width: float, height: float = 38 * mm):
        super().__init__()
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        y = self.height / 2
        labels = [("862", "Русь"), ("1132", "Земли"), ("1425", "Москва"), ("1682", "Империя"), ("1801", "Реформы"), ("1894", "Кризис"), ("1917", "Революция"), ("1941", "Война"), ("2022", "Россия")]
        xs = [6 * mm + idx * (self.width - 12 * mm) / (len(labels) - 1) for idx in range(len(labels))]
        c.setStrokeColor(GOLD)
        c.setLineWidth(2)
        c.line(xs[0], y, xs[-1], y)
        for idx, ((year, label), x) in enumerate(zip(labels, xs)):
            color = ERA_COLORS[min(idx, len(ERA_COLORS) - 1)] if idx < len(labels) - 1 else RED
            c.setFillColor(color)
            c.circle(x, y, 4, fill=1, stroke=0)
            c.setFont("BookSansBold", 8)
            c.setFillColor(NAVY)
            c.drawCentredString(x, y + 9, year)
            c.setFont("BookSans", 6.8)
            c.setFillColor(MUTED)
            for j, line in enumerate(label.split("\n")):
                c.drawCentredString(x, y - 13 - j * 8, line)


def make_table(rows: list[list[str]]) -> Table:
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    parsed = []
    for ridx, row in enumerate(rows):
        style = STYLES["TableHead"] if ridx == 0 else STYLES["Table"]
        parsed.append([Paragraph(inline(cell), style) for cell in row])
    width_ratios = {
        2: (0.31, 0.69),
        3: (0.24, 0.38, 0.38),
        4: (0.19, 0.27, 0.27, 0.27),
    }
    ratios = width_ratios.get(ncols, tuple([1 / ncols] * ncols))
    widths = [CONTENT_W * ratio for ratio in ratios]
    table = Table(parsed, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.65, colors.HexColor("#9AA6B2")),
        ("INNERGRID", (0, 1), (-1, -1), 0.25, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 1.25, GOLD),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
    ]
    for r in range(1, len(rows)):
        commands.append((
            "BACKGROUND",
            (0, r),
            (-1, r),
            colors.HexColor("#F7F3EA") if r % 2 == 0 else colors.white,
        ))
    if 1 < ncols <= 4:
        commands.extend([
            ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#EAF0F3")),
            ("TEXTCOLOR", (0, 1), (0, -1), NAVY),
        ])
    table.setStyle(TableStyle(commands))
    return table


def make_callout(content: str, kind: str) -> Table:
    """Build a card whose padding is part of its measured layout box.

    ReportLab Paragraph backgrounds extend into borderPadding without adding that
    extension to the flowable's reserved height. That made the old question and
    summary cards paint over the heading immediately above them. A one-row table
    measures every padding value and therefore cannot overlap adjacent text.
    """
    if kind == "question":
        accent = PURPLE
        background = colors.HexColor("#F3ECF4")
        border = colors.HexColor("#C8AFC8")
        style = STYLES["QuestionBody"]
    else:
        accent = TEAL
        background = colors.HexColor("#E8F3F1")
        border = colors.HexColor("#A7C9C4")
        style = STYLES["SummaryBody"]

    card = Table(
        [["", Paragraph(inline(content), style)]],
        colWidths=[3.2 * mm, CONTENT_W - 3.2 * mm],
        hAlign="LEFT",
    )
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), accent),
        ("BACKGROUND", (1, 0), (1, 0), background),
        ("BOX", (0, 0), (-1, -1), 0.65, border),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 0),
        ("TOPPADDING", (0, 0), (0, 0), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 0),
        ("LEFTPADDING", (1, 0), (1, 0), 9),
        ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ("TOPPADDING", (1, 0), (1, 0), 8),
        ("BOTTOMPADDING", (1, 0), (1, 0), 9),
    ]))
    return card


def heading_style(text: str, level: int) -> ParagraphStyle:
    if level == 2:
        if text == "Главный вопрос":
            return STYLES["QuestionHead"]
        if text == "Экзаменационный скелет":
            return STYLES["ExamHead"]
        if text == "Ловушки ЕГЭ":
            return STYLES["TrapHead"]
        if text == "Тридцать секунд":
            return STYLES["SummaryHead"]
        return STYLES["H2"]
    if level == 3:
        return STYLES["H3"]
    return STYLES["H1"]


def parse_markdown(md: str, skip_cover_headings: bool = False) -> list[Flowable]:
    lines = md.replace("\r\n", "\n").splitlines()
    story: list[Flowable] = []
    i = 0
    special_next: str | None = None
    first_h1 = True
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("<!--"):
            i += 1
            continue
        if stripped == "---":
            # Source manuscripts use horizontal rules only as structural separators.
            # Rendering them before a forced chapter break can create an otherwise
            # empty page, so the book layout lets the next heading carry the break.
            i += 1
            continue
        heading = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading:
            level = len(heading.group(1))
            title = normalize(heading.group(2).strip())
            if skip_cover_headings and first_h1 and level == 1:
                first_h1 = False
                i += 1
                continue
            first_h1 = False
            if level == 1:
                if story:
                    story.append(PageBreak())
                if re.match(r"^\d+\.", title):
                    style = STYLES["ChapterTitle"]
                elif title.startswith("Часть") or title.startswith("Межвековой мост") or title.startswith("ЕГЭ-лаборатория") or title in {
                    "Семь сквозных линий всей книги", "Быстрое повторение", "Источники и редакционный принцип",
                    "Хронология",
                    "Причинный атлас: задание 18", "Термин без зубрёжки: задание 19",
                    "Сравнения, которые ФИПИ проверял в 2025 году", "Параллели из аналитического обзора ЕГЭ-2025",
                }:
                    style = STYLES["PartTitle"]
                else:
                    style = STYLES["H1"]
                story.append(Paragraph(inline(title), style))
                trace = distant_trace(title)
                if trace:
                    story.extend([trace, Spacer(1, 8)])
            else:
                style = heading_style(title, level)
                next_content = i + 1
                while next_content < len(lines) and (
                    not lines[next_content].strip()
                    or lines[next_content].strip().startswith("<!--")
                ):
                    next_content += 1
                table_follows = (
                    next_content < len(lines)
                    and lines[next_content].strip().startswith("|")
                    and lines[next_content].strip().endswith("|")
                )
                if table_follows:
                    # ReportLab's keepWithNext wraps a heading and the following
                    # table into one oversized group. At a section boundary this
                    # can manufacture a completely blank page before a long table.
                    # Reserve a useful opening slice, then let the table split.
                    story.append(CondPageBreak(34 * mm))
                    style = ParagraphStyle(
                        f"{style.name}BeforeTable",
                        parent=style,
                        keepWithNext=False,
                    )
                story.append(Paragraph(inline(title), style))
                special_next = {
                    "Главный вопрос": "question",
                    "Тридцать секунд": "summary",
                }.get(title)
            i += 1
            continue
        if stripped.startswith(">"):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip()[1:].strip())
                i += 1
            story.append(Paragraph(inline(" ".join(quote_lines)), STYLES["Quote"]))
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|") and lines[i].strip().endswith("|"):
                table_lines.append(lines[i].strip())
                i += 1
            rows = []
            for raw in table_lines:
                cells = [c.strip() for c in raw.strip("|").split("|")]
                if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                    continue
                rows.append(cells)
            if rows:
                story.extend([make_table(rows), Spacer(1, 8)])
            continue
        if re.match(r"^-\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^-\s+", lines[i].strip()):
                content = re.sub(r"^-\s+", "", lines[i].strip())
                items.append(ListItem(Paragraph(inline(content), STYLES["Bullet"]), leftIndent=9))
                i += 1
            story.append(ListFlowable(items, bulletType="bullet", start="circle", leftIndent=16, bulletFontName="BookSans", bulletFontSize=5.5, bulletColor=GOLD, spaceAfter=6))
            continue
        if re.match(r"^\d+\.\s+", stripped):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                content = re.sub(r"^\d+\.\s+", "", lines[i].strip())
                items.append(ListItem(Paragraph(inline(content), STYLES["Bullet"]), leftIndent=10))
                i += 1
            numbered = ListFlowable(items, bulletType="1", leftIndent=19, bulletFontName="BookSansBold", bulletFontSize=7.5, bulletColor=BLUE, spaceAfter=6)
            # Short checklists are meant to be scanned as one unit. Keeping them
            # together prevents a lone final item from creating an almost empty page.
            story.append(KeepTogether([numbered]) if len(items) <= 6 else numbered)
            continue

        paragraph_lines = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt:
                break
            if (
                nxt.startswith("#")
                or nxt == "---"
                or nxt.startswith(">")
                or (nxt.startswith("|") and nxt.endswith("|"))
                or re.match(r"^-\s+", nxt)
                or re.match(r"^\d+\.\s+", nxt)
                or nxt.startswith("<!--")
            ):
                break
            paragraph_lines.append(nxt)
            i += 1
        content = " ".join(paragraph_lines)
        if special_next in {"question", "summary"}:
            story.extend([make_callout(content, special_next), Spacer(1, 9)])
        else:
            story.append(Paragraph(inline(content), STYLES["Body"]))
        special_next = None
    return story


class HistoryDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=PAGE_SIZE,
            leftMargin=LEFT,
            rightMargin=RIGHT,
            topMargin=TOP,
            bottomMargin=BOTTOM,
            title="Россия: власть, земля, общество. 862-2022",
            author="Редакция приложения «Решай историю»",
            subject="Единая причинная история России для подготовки к ЕГЭ",
        )
        self.running_title = "Россия: власть, земля, общество"
        self.era_index = 0
        cover_frame = Frame(20 * mm, 19 * mm, PAGE_W - 40 * mm, PAGE_H - 38 * mm, id="cover", showBoundary=0)
        body_frame = Frame(LEFT, BOTTOM, CONTENT_W, PAGE_H - TOP - BOTTOM, id="body", showBoundary=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover_frame], onPage=self.draw_cover),
            PageTemplate(id="body", frames=[body_frame], onPage=self.draw_body),
        ])

    def beforeDocument(self):
        # multiBuild performs more than one layout pass for the table of contents.
        # Reset running state so page two never inherits the final chapter title
        # from the preceding pass.
        self.running_title = "Россия: власть, земля, общество"
        self.era_index = 0

    def draw_cover(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#1D3155"))
        canvas.circle(PAGE_W * 0.9, PAGE_H * 0.88, 54 * mm, fill=1, stroke=0)
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(1.3)
        y = 31 * mm
        canvas.line(20 * mm, y, PAGE_W - 20 * mm, y)
        nodes = [(22, "862"), (38.5, "1132"), (55, "1425"), (71.5, "1682"), (88, "1801"), (104.5, "1894"), (121, "1917"), (137.5, "1941"), (154, "2022")]
        for x_mm, label in nodes:
            canvas.setFillColor(GOLD if label != "1917" else colors.HexColor("#D76B58"))
            canvas.circle(x_mm * mm, y, 2.2 * mm, fill=1, stroke=0)
            canvas.setFont("BookSansBold", 7)
            canvas.setFillColor(colors.white)
            canvas.drawCentredString(x_mm * mm, y - 8 * mm, label)
        canvas.setFillColor(colors.HexColor("#E8EDF4"))
        canvas.setFont("BookSans", 7.5)
        canvas.drawString(20 * mm, 16 * mm, "Причины • решения • последствия • быстрое повторение")
        canvas.restoreState()

    def draw_body(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setStrokeColor(ERA_COLORS[self.era_index])
        canvas.setLineWidth(1.2)
        canvas.line(LEFT, PAGE_H - 11 * mm, PAGE_W - RIGHT, PAGE_H - 11 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("BookSans", 6.8)
        header = normalize(self.running_title)
        if len(header) > 72:
            header = header[:69] + "..."
        canvas.drawString(LEFT, PAGE_H - 8.5 * mm, header)
        canvas.setFont("BookSansBold", 7.2)
        canvas.setFillColor(NAVY)
        canvas.drawRightString(PAGE_W - RIGHT, 9.8 * mm, str(canvas.getPageNumber()))
        base_y = 8.5 * mm
        seg_w = CONTENT_W / len(ERA_COLORS)
        for idx, color in enumerate(ERA_COLORS):
            canvas.setStrokeColor(color)
            canvas.setLineWidth(2.2 if idx == self.era_index else 0.7)
            canvas.line(LEFT + idx * seg_w, base_y, LEFT + (idx + 1) * seg_w - 2, base_y)
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        title = flowable.getPlainText()
        if style_name in {"PartTitle", "ChapterTitle", "H1"}:
            self.running_title = title
        if title.startswith("Часть I."):
            self.era_index = 0
        elif title.startswith("Часть II."):
            self.era_index = 1
        elif title.startswith("Часть III."):
            self.era_index = 2
        elif title.startswith("Часть IV."):
            self.era_index = 3
        elif title.startswith("Часть V."):
            self.era_index = 4
        elif title.startswith("Часть VI."):
            self.era_index = 5
        elif title.startswith("Часть VII."):
            self.era_index = 6
        elif title.startswith("Часть VIII."):
            self.era_index = 7
        elif title.startswith("Часть IX.") or title.startswith("Часть X."):
            self.era_index = 8
        level = None
        if style_name == "PartTitle":
            level = 0
        elif style_name in {"ChapterTitle", "H1"}:
            level = 1
        if level is not None:
            key = f"toc-{self.page}-{abs(hash((title, self.page, style_name)))}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=level, closed=(level == 0))
            self.notify("TOCEntry", (level, title, self.page, key))


def cover_story() -> list[Flowable]:
    return [
        Spacer(1, 27 * mm),
        Paragraph("РОССИЯ", STYLES["CoverTitle"]),
        Paragraph("власть, земля,<br/>общество", STYLES["CoverTitle"]),
        Spacer(1, 7 * mm),
        Paragraph("862-2022", STYLES["CoverSub"]),
        Spacer(1, 5 * mm),
        Paragraph("Единая причинная история<br/>для быстрого повторения ЕГЭ", STYLES["CoverSub"]),
        Spacer(1, 36 * mm),
        Paragraph("80 учебных глав • 7 хронологий • причины и сравнения внутри текста", STYLES["CoverSub"]),
        NextPageTemplate("body"),
        PageBreak(),
    ]


def toc_story() -> list[Flowable]:
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC0", fontName="BookSansBold", fontSize=9.2, leading=13, textColor=NAVY, leftIndent=0, firstLineIndent=0, spaceBefore=4),
        ParagraphStyle("TOC1", fontName="BookSans", fontSize=7.6, leading=10.2, textColor=INK, leftIndent=10, firstLineIndent=-4, spaceBefore=1),
    ]
    return [
        Paragraph("Содержание", STYLES["TocTitle"]),
        Paragraph("Книга построена по причинным линиям. Межвековые мосты и итоговые схемы можно читать отдельно для экспресс-повторения.", STYLES["BodyLead"]),
        toc,
        PageBreak(),
    ]


def build_manuscript() -> tuple[str, dict[str, str]]:
    framework = framework_sections((SOURCE_DIR / "unified-history-book-framework.md").read_text(encoding="utf-8"))
    early1, early2 = early_source_parts()
    source1 = integrated_15_17_source()
    source2 = integrated_18_source()
    source3 = integrated_19_source()
    source4 = integrated_nicholas_source()
    modern1, modern2, modern3 = modern_source_parts()
    method = strip_root_title((SOURCE_DIR / "history-book-methodical-standard.md").read_text(encoding="utf-8"))
    blocks = [
        framework["FRONT"], method,
        framework["EARLY_PART1_OPEN"], early1,
        framework["EARLY_BRIDGE1"],
        framework["EARLY_PART2_OPEN"], early2,
        framework["EARLY_BRIDGE2"],
        framework["PART1_OPEN"], source1,
        framework["BRIDGE1"],
        framework["PART2_OPEN"], source2,
        framework["BRIDGE2"],
        framework["PART3_OPEN"], source3,
        framework["BRIDGE3"],
        framework["PART4_OPEN"], source4,
        "# Часть VII. Революция и советская модернизация, 1917-1941\n", modern1,
        "# Часть VIII. Великая Отечественная война, 1941-1945\n", modern2,
        "# Часть IX. СССР и Российская Федерация, 1945-2022\n", modern3,
        framework["SYNTHESIS"],
        framework["REVIEW"],
        framework["SOURCES"],
    ]
    manuscript = "\n\n---\n\n".join(block.strip() for block in blocks) + "\n"
    return manuscript, framework


def validate_pdf(path: Path) -> None:
    reader = PdfReader(str(path))
    if len(reader.pages) < 400:
        raise RuntimeError(f"PDF unexpectedly short: {len(reader.pages)} pages")
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    required = [
        "862 и 882 годы",
        "Крещение Руси",
        "Нашествие Батыя",
        "Куликовская битва",
        "Василий I и рубеж 1425 года",
        "Московская междоусобица",
        "Судебник 1497 года",
        "Судебник 1550 года",
        "Соборное уложение 1649 года",
        "Северная война",
        "Великие реформы",
        "19 февраля 1861 года",
        "Революция 1905 года",
        "Февраль и отречение",
        "Октябрь 1917 года",
        "Июльские дни",
        "Великий перелом",
        "Битва за Москву",
        "Коренной перелом",
        "Хрущёвская оттепель",
        "Перестройка",
        "Россия в 2000-2022 годах",
        "Хронология",
        "Причинная логика: как работает событие",
        "Линии сравнения: один критерий, две эпохи",
        "Россия и мир: один механизм",
        "Семь сквозных линий всей книги",
        "Быстрое повторение",
    ]
    missing = [item for item in required if item not in text]
    if missing:
        raise RuntimeError(f"Missing expected PDF text: {missing}")
    prohibited = (
        "Часть X. Экзаменационные инструменты",
        "Экзаменационный календарь",
        "Банк фактов",
    )
    present_prohibited = [item for item in prohibited if item in text]
    if present_prohibited:
        raise RuntimeError(f"Obsolete appendix text survived: {present_prohibited}")
    if text.count("Хронология") < 7:
        raise RuntimeError("Expected seven distributed chronology blocks")
    for page_no, page in enumerate(reader.pages, 1):
        mediabox = page.mediabox
        if float(mediabox.width) <= 0 or float(mediabox.height) <= 0:
            raise RuntimeError(f"Invalid media box on page {page_no}")


def build() -> None:
    global STYLES
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    register_fonts()
    STYLES = build_styles()
    manuscript, framework = build_manuscript()
    MANUSCRIPT_PATH.write_text(manuscript, encoding="utf-8")

    doc = HistoryDocTemplate(str(PDF_PATH))
    story: list[Flowable] = []
    story.extend(cover_story())
    story.extend(toc_story())

    # The front matter appears after the contents without repeating the cover title.
    front_lines = framework["FRONT"].splitlines()
    front_body = "\n".join(front_lines[6:])
    story.append(Paragraph("Как устроена эта книга", STYLES["PartTitle"]))
    story.append(TimelineFlowable(CONTENT_W))
    story.extend(parse_markdown(front_body))
    story.extend(parse_markdown(strip_root_title((SOURCE_DIR / "history-book-methodical-standard.md").read_text(encoding="utf-8"))))

    # Render the rest in the same order as the editable manuscript.
    early1, early2 = early_source_parts()
    modern1, modern2, modern3 = modern_source_parts()
    sources = [
        framework["EARLY_PART1_OPEN"],
        early1,
        framework["EARLY_BRIDGE1"],
        framework["EARLY_PART2_OPEN"],
        early2,
        framework["EARLY_BRIDGE2"],
        framework["PART1_OPEN"],
        integrated_15_17_source(),
        framework["BRIDGE1"],
        framework["PART2_OPEN"],
        integrated_18_source(),
        framework["BRIDGE2"],
        framework["PART3_OPEN"],
        integrated_19_source(),
        framework["BRIDGE3"],
        framework["PART4_OPEN"],
        integrated_nicholas_source(),
        "# Часть VII. Революция и советская модернизация, 1917-1941\n",
        modern1,
        "# Часть VIII. Великая Отечественная война, 1941-1945\n",
        modern2,
        "# Часть IX. СССР и Российская Федерация, 1945-2022\n",
        modern3,
        framework["SYNTHESIS"],
        framework["REVIEW"],
        framework["SOURCES"],
    ]
    forced_openers = (
        "# Часть VII.",
        "# Часть VIII.",
        "# Часть IX.",
        "# Источники и редакционный принцип",
    )
    for block in sources:
        if block is framework["SYNTHESIS"] or block is framework["REVIEW"] or block.lstrip().startswith(forced_openers):
            story.append(PageBreak())
        flowables = parse_markdown(block)
        if block is framework["REVIEW"] or block is framework["SOURCES"]:
            # Multi-line navy title panels need a little explicit breathing room.
            # Keeping it here avoids changing the pagination of all 80 chapters.
            flowables.insert(1, Spacer(1, 9))
        story.extend(flowables)

    doc.multiBuild(story)
    validate_pdf(PDF_PATH)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the unified history book PDF")
    parser.parse_args()
    build()
    reader = PdfReader(str(PDF_PATH))
    print(f"Built {PDF_PATH} ({len(reader.pages)} pages)")
    print(f"Editable manuscript: {MANUSCRIPT_PATH}")


if __name__ == "__main__":
    main()
