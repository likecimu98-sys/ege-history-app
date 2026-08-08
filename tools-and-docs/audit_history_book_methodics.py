from __future__ import annotations

import json
import re
from pathlib import Path

from build_unified_history_book import build_manuscript, chronology_rows, native_exam_cards


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tmp" / "pdfs" / "methodical-corpus" / "second-part-inventory.json"
MODERN = ROOT / "tools-and-docs" / "microtextbooks-1917-2022-draft.md"
MODERN_DEEP = ROOT / "tools-and-docs" / "modern-history-deep-dives.md"
KEY_DEEP = ROOT / "tools-and-docs" / "history-key-event-deep-dives.md"
WORD_RE = re.compile(r"[А-Яа-яЁёA-Za-z0-9-]+")


def normalize(text: str) -> str:
    text = text.casefold().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", "", text)


def term_from_question(text: str) -> str:
    quoted = re.search(r"«([^»]+)»", text)
    if quoted and "ЕГЭ близко" not in quoted.group(1):
        return quoted.group(1)
    return text.split("(", 1)[0].strip()


def main() -> None:
    manuscript, _ = build_manuscript()
    inventory = json.loads(CORPUS.read_text(encoding="utf-8"))
    normalized_manuscript = normalize(manuscript)
    errors: list[str] = []

    # Every recorded task 18 and 20 answer must now be attached to a narrative chapter.
    for year in ("2023", "2024"):
        for task in ("18", "20"):
            for item in inventory[year][task]:
                tag = f"{year[-2:]}-{task}-{item['number']}"
                if tag not in manuscript:
                    errors.append(f"Missing native chapter coverage: {tag}")
    for task in (18, 20):
        for number in range(1, 30):
            tag = f"25-{task}-{number:02d}"
            if tag not in manuscript:
                errors.append(f"Missing native EGE-2025 chapter coverage: {tag}")

    cards = native_exam_cards()
    task_counts = {
        task: sum(card["task"] == task for card in cards)
        for task in (18, 20, 21)
    }
    world_tags = {
        str(tag)
        for card in cards if card["task"] == 21
        for tag in card["tags"]
    }
    missing_world = sorted(tag for tag in world_tags if tag not in manuscript)
    if missing_world:
        errors.append(f"Selected world-history parallels missing: {missing_world}")

    # Task 19 stays in context: terms must occur in the narrative, not in a final glossary.
    aliases = {
        normalize("стрелецкое войско"): normalize("стрельцы"),
        normalize("второе народное земское ополчение"): normalize("второе ополчение"),
        normalize("святейший синод"): normalize("святейший правительствующий синод"),
    }
    for year in ("2023", "2024"):
        for item in inventory[year]["19"]:
            term = normalize(term_from_question(item["text"]))
            probe = aliases.get(term, term)
            if probe and probe not in normalized_manuscript:
                errors.append(f"Contextual term missing {year}-{item['number']}: {item['text']}")
    terms_2025 = [
        "дружина", "посад", "духовенство", "ересь", "житие", "пожилое", "местничество",
        "патриарх", "самозванец", "старообрядчество", "абсолютизм", "полки нового строя", "протекционизм",
        "подворная подать", "потешные войска", "кунсткамера", "военные поселения", "восточный вопрос", "меценатство", "антанта",
        "большевики", "народный комиссариат", "декрет о земле", "нэпман", "дело врачей", "организация варшавского договора",
        "гонка вооружений", "страны народной демократии", "межрегиональная депутатская группа",
    ]
    for number, term in enumerate(terms_2025, 1):
        if normalize(term) not in normalized_manuscript:
            errors.append(f"Contextual EGE-2025 term missing 25-19-{number:02d}: {term}")

    dated_rows = chronology_rows()
    for date, fact, _ in dated_rows:
        if normalize(fact) not in normalized_manuscript:
            errors.append(f"Chronology fact missing: {date} | {fact}")
    if manuscript.count("# Хронология") != 7:
        errors.append("Expected exactly seven distributed chronologies")
    if manuscript.count("| Дата | Факт |") != 7:
        errors.append("Every chronology must use exactly the Date / Fact header")
    prohibited = (
        "# Часть X.", "Экзаменационный календарь", "Банк фактов",
        "# Причинный атлас", "# ЕГЭ-2025. Атлас",
    )
    for phrase in prohibited:
        if phrase in manuscript:
            errors.append(f"Obsolete appendix survived: {phrase}")

    modern = MODERN.read_text(encoding="utf-8")
    chapters = len(re.findall(r"(?m)^# \d+\.", modern))
    if chapters != 18:
        errors.append(f"Expected 18 modern chapters, got {chapters}")
    for chapter in range(63, 81):
        if f"<!-- MODERN_{chapter} -->" not in MODERN_DEEP.read_text(encoding="utf-8"):
            errors.append(f"Missing modern deep-dive marker MODERN_{chapter}")
    key_markers = (
        "RUSSKAYA_PRAVDA", "SUDEBNIK_1497", "SUDEBNIK_1550", "ULOZHENIE_1649",
        "PETER_STATE", "NOBILITY_FREEDOM", "EMANCIPATION_1861", "GREAT_REFORMS_SYSTEM",
        "REVOLUTION_1905", "FUNDAMENTAL_LAWS", "STOLYPIN_REFORM",
    )
    key_deep = KEY_DEEP.read_text(encoding="utf-8")
    for marker in key_markers:
        if f"<!-- {marker} -->" not in key_deep:
            errors.append(f"Missing key-event deep-dive marker {marker}")

    visible = re.sub(r"<!--.*?-->", "", manuscript, flags=re.S)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", visible) if s.strip()]
    average = sum(len(WORD_RE.findall(sentence)) for sentence in sentences) / max(len(sentences), 1)
    if average > 23:
        errors.append(f"Average sentence is too long: {average:.1f} words")

    if errors:
        raise SystemExit("\n".join(errors))

    source_questions = sum(len(inventory[year][task]) for year in inventory for task in inventory[year])
    print(f"Source inventory: {source_questions} questions reviewed")
    print(f"Native chapter cards: task 18 = {task_counts[18]}, task 20 = {task_counts[20]}, selected task 21 = {task_counts[21]}")
    print(f"Distributed chronologies: 7 blocks, {len(dated_rows)} dated facts, two columns each")
    print("Obsolete final exam/date appendix: absent")
    print(f"Modern narrative: {chapters} chapters; key legal and reform dossiers: {len(key_markers)}")
    print(f"Language check: {len(sentences)} sentences, average {average:.1f} words")


if __name__ == "__main__":
    main()
