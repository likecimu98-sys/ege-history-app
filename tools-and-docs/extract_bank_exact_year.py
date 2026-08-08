from __future__ import annotations

import json
import re
from collections import OrderedDict
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PDF = Path(r"C:\Users\01\Downloads\Tekhnicheskiy_fayl_Bank_faktov_5_0_vydeleny_izmenenia.pdf")
OUT_JSON = ROOT / "tmp" / "pdfs" / "methodical-corpus" / "bank-exact-year-inventory.json"
OUT_MD = ROOT / "tools-and-docs" / "bank-exact-year-atlas.md"

YEAR_TOKEN_RE = re.compile(r"(?<![А-Яа-яЁё])год(?![А-Яа-яЁё])", re.IGNORECASE)
YEARS_TOKEN_RE = re.compile(r"(?<![А-Яа-яЁё])годы(?![А-Яа-яЁё])", re.IGNORECASE)
YEAR_NUMBER_RE = re.compile(r"(?<!\d)(\d{3,4})(?!\d)")

MANUAL_YEARS = {
    "Приказ №1 Петроградского Совета": "1917",
}


def clean(value: str | None) -> str:
    if not value:
        return ""
    value = value.replace("­", "").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip()


def precision_kind(label: str) -> str | None:
    """Return the Bank's year-precision category, ignoring incidental words like 'Годунов'."""
    normalized = clean(label)
    if len(normalized) > 180:
        return None
    if YEAR_TOKEN_RE.search(normalized):
        return "year"
    if YEARS_TOKEN_RE.search(normalized):
        return "years"
    return None


def extract_rows() -> list[dict[str, str | int]]:
    rows: list[dict[str, str | int]] = []
    seen: set[tuple[str, str, str]] = set()

    with pdfplumber.open(SOURCE_PDF) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            for table in page.extract_tables():
                for raw_row in table:
                    if not raw_row or len(raw_row) < 3:
                        continue
                    term = clean(raw_row[0])
                    fact = clean(raw_row[1])
                    knowledge = clean(raw_row[2])
                    if term == "Термин" or knowledge == "Что знать?":
                        continue
                    kind = precision_kind(knowledge)
                    if not kind or not term or not fact:
                        continue

                    key = (term, fact, knowledge)
                    if key in seen:
                        continue
                    seen.add(key)

                    joined = f"{term} {fact}"
                    years = YEAR_NUMBER_RE.findall(joined)
                    exact_year = years[0] if years else ""
                    if not exact_year:
                        exact_year = next(
                            (year for label, year in MANUAL_YEARS.items() if label in joined),
                            "",
                        )
                    rows.append(
                        {
                            "term": term,
                            "fact": fact,
                            "knowledge": knowledge,
                            "precision": kind,
                            "sort_year": int(exact_year) if exact_year else 9999,
                            "page": page_number,
                        }
                    )

    unresolved = [row for row in rows if row["precision"] == "year" and row["sort_year"] == 9999]
    if unresolved:
        details = "\n".join(f"p.{row['page']}: {row['term']} - {row['fact']}" for row in unresolved)
        raise RuntimeError(f"Exact-year rows without a recoverable year:\n{details}")
    return rows


def section_for(year: int) -> str:
    if year <= 1425:
        return "IX - начало XV века"
    if year <= 1689:
        return "XV-XVII века"
    if year <= 1800:
        return "XVIII век"
    if year <= 1894:
        return "XIX век"
    if year <= 1916:
        return "1894-1916 годы"
    if year <= 1940:
        return "1917-1940 годы"
    if year <= 1945:
        return "Великая Отечественная война"
    if year <= 1991:
        return "1945-1991 годы"
    return "Российская Федерация"


def display_date(row: dict[str, str | int]) -> str:
    term = str(row["term"])
    if YEAR_NUMBER_RE.search(term):
        return term
    return str(row["sort_year"])


def render_markdown(rows: list[dict[str, str | int]]) -> str:
    exact_rows = [row for row in rows if row["precision"] == "year"]
    period_rows = [row for row in rows if row["precision"] == "years"]
    grouped: OrderedDict[str, list[dict[str, str | int]]] = OrderedDict()
    for row in sorted(exact_rows, key=lambda item: (int(item["sort_year"]), int(item["page"]))):
        grouped.setdefault(section_for(int(row["sort_year"])), []).append(row)

    parts = [
        "# Экзаменационный календарь по Банку фактов НезЛО 5.0",
        "",
        "Это точная выгрузка строк из **Банка фактов 5.0**, в которых колонка «Что знать?» содержит отдельную помету **«год»**, в том числе «месяц и год», «год и место», «год и участники». Случайные упоминания слова внутри текста не учитывались. Рядом с сюжетом сохраняется исходная требуемая точность.",
        "",
        "Календарь не заменяет главы. Он нужен для финальной тренировки: закройте дату и восстановите её по событию; затем закройте событие и объясните, что произошло в указанном году.",
        "",
        f"**Контроль корпуса:** {len(exact_rows)} датированных строк; ещё {len(period_rows)} интервалов имеют отдельную помету «годы» и вынесены в конец.",
        "",
    ]
    for section, section_rows in grouped.items():
        parts.extend([f"## {section}", "", "| Дата | Событие или факт | Точность в Банке |", "|---:|---|---|"])
        for row in section_rows:
            date = display_date(row).replace("|", "\\|")
            term = str(row["term"])
            fact = str(row["fact"])
            if not YEAR_NUMBER_RE.search(term):
                fact = f"**{term}.** {fact}"
            fact = fact.replace("|", "\\|")
            knowledge = str(row["knowledge"]).replace("|", "\\|")
            parts.append(f"| **{date}** | {fact} | {knowledge} |")
        parts.append("")

    parts.extend(
        [
            "## Интервалы с пометой «годы»",
            "",
            "Эти строки требуют знания границ периода, а не одной точки.",
            "",
            "| Период | Что происходило |",
            "|---:|---|",
        ]
    )
    for row in sorted(period_rows, key=lambda item: (int(item["sort_year"]), int(item["page"]))):
        term = str(row["term"]).replace("|", "\\|")
        fact = str(row["fact"]).replace("|", "\\|")
        parts.append(f"| **{term}** | {fact} |")

    parts.extend(
        [
            "",
            "## Как не путать точность",
            "",
            "Помета **«год»** означает конкретную датировку. **«Месяц и год»** требует знать ещё и положение события внутри года. **«Годы»** означает границы процесса. Остальные факты Банка - периоды, десятилетия, века, определения и узнавание - изучаются в сюжетных главах и словаре, а не заучиваются как одинаковый список дат.",
            "",
        ]
    )
    return "\n".join(parts)


def main() -> None:
    rows = extract_rows()
    exact_count = sum(row["precision"] == "year" for row in rows)
    if exact_count < 240:
        raise RuntimeError(f"Exact-year extraction is unexpectedly short: {exact_count} rows")
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_MD.write_text(render_markdown(rows), encoding="utf-8")
    print(f"Extracted {exact_count} exact-year rows and {len(rows) - exact_count} year ranges")
    print(OUT_JSON)
    print(OUT_MD)


if __name__ == "__main__":
    main()
