from __future__ import annotations

import re
from pathlib import Path

from pypdf import PdfReader

from build_unified_history_book import chronology_rows


ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "output" / "pdf" / "istoriya-rossii-862-2022-ege.pdf"
MANUSCRIPT = ROOT / "output" / "pdf" / "istoriya-rossii-862-2022-ege.md"
WORD_RE = re.compile(r"[А-Яа-яЁёA-Za-z0-9-]+")


def normalize(text: str) -> str:
    return re.sub(r"[^a-zа-я0-9]+", "", text.casefold().replace("ё", "е"))


def main() -> None:
    reader = PdfReader(str(PDF))
    texts = [page.extract_text() or "" for page in reader.pages]
    full = "\n".join(texts)
    normalized_full = normalize(full)
    manuscript = MANUSCRIPT.read_text(encoding="utf-8")
    manuscript_words = WORD_RE.findall(manuscript)
    empty_pages = [index + 1 for index, text in enumerate(texts) if not text.strip()]
    very_short_pages = [
        (index + 1, len(WORD_RE.findall(text)))
        for index, text in enumerate(texts)
        if len(WORD_RE.findall(text)) < 20
    ]

    if empty_pages:
        raise SystemExit(f"Empty extracted pages: {empty_pages}")
    if "�" in full:
        raise SystemExit(f"Broken replacement characters: {full.count('�')}")
    if full.count("Хронология") < 7:
        raise SystemExit("Fewer than seven chronology blocks in PDF")
    for phrase in (
        "Часть X. Экзаменационные инструменты",
        "Экзаменационный календарь",
        "Банк фактов",
    ):
        if phrase in full:
            raise SystemExit(f"Obsolete appendix phrase in PDF: {phrase}")

    dated = chronology_rows()
    missing_facts = [fact for _, fact, _ in dated if normalize(fact) not in normalized_full]
    if missing_facts:
        raise SystemExit(f"Chronology facts missing from PDF: {missing_facts[:5]}")

    native_tags = re.findall(r"NATIVE-COVERAGE ([^>]+)", manuscript)
    if len(native_tags) != 185:
        raise SystemExit(f"Expected 185 native coverage markers in manuscript, got {len(native_tags)}")
    if "NATIVE-COVERAGE" in full:
        raise SystemExit("Service coverage markers leaked into visible PDF")

    anchors = (
        "Часть I. Рождение Руси",
        "Часть II. Русь земель",
        "Часть III. Сборка государства",
        "Часть VII. Революция и советская модернизация",
        "Семь сквозных линий всей книги",
    )

    print(f"PDF pages: {len(texts)}")
    print(f"Manuscript words: {len(manuscript_words)}")
    print(f"PDF bytes: {PDF.stat().st_size}")
    print("Broken replacement characters: 0")
    print("Empty extracted pages: 0")
    print(f"Chronology facts present in PDF: {len(dated)} of {len(dated)}")
    print("Native exam markers: 185 in manuscript, 0 leaked into PDF")
    print(f"Very short pages (<20 words, intentional openers): {very_short_pages}")
    print("Anchor pages:")
    for anchor in anchors:
        pages = [index + 1 for index, text in enumerate(texts) if anchor in text]
        print(f"  {anchor}: {pages[-3:]}")


if __name__ == "__main__":
    main()
