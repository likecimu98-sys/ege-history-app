from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tmp" / "pdfs" / "methodical-corpus"
OUTPUT = CORPUS / "second-part-inventory.json"
REPORT = CORPUS / "second-part-inventory.md"


def clean(text: str) -> str:
    text = re.sub(r"\n===== PAGE \d+ =====\n", "\n", text)
    text = re.sub(r"Сборник с реконструкцией заданий 18-21 ЕГЭ 20\d\d года подготовлен Независимой\s+лабораторией образования Антона Чубукова[^\n]*", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def split_numbered(text: str, pattern: str) -> list[dict[str, str]]:
    matches = list(re.finditer(pattern, text, re.M))
    items: list[dict[str, str]] = []
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = text[match.end():end]
        body = re.sub(r"\s+", " ", body).strip()
        items.append({"number": match.group(1), "text": body})
    return items


def parse_2023(text: str) -> dict[str, list[dict[str, str]]]:
    text = clean(text)
    matches = list(re.finditer(r"(?m)^\s*(\d+)\*?\s*\((18|19|20|21)\)\s*", text))
    out = {str(i): [] for i in range(18, 22)}
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        body = re.sub(r"\s+", " ", text[match.end():end]).strip()
        out[match.group(2)].append({"number": match.group(1), "text": body})
    return out


def parse_2024(text: str) -> dict[str, list[dict[str, str]]]:
    text = clean(text)
    out = {str(i): [] for i in range(18, 22)}
    headings = list(re.finditer(r"Задания №(18|19|20|21)", text))
    for idx, heading in enumerate(headings):
        end = headings[idx + 1].start() if idx + 1 < len(headings) else len(text)
        block = text[heading.end():end]
        out[heading.group(1)] = split_numbered(block, r"(?m)^\s*(\d+)\*?\.\s+")
    return out


def classify(question: str) -> str:
    years = [int(x) for x in re.findall(r"(?<!\d)(1\d{3}|20\d{2})(?!\d)", question)]
    if years:
        year = min(years)
        if year < 1462:
            return "862-1462"
        if year < 1682:
            return "1462-1682"
        if year < 1801:
            return "1682-1801"
        if year < 1894:
            return "1801-1894"
        if year < 1917:
            return "1894-1917"
        if year < 1941:
            return "1917-1941"
        if year < 1953:
            return "1941-1953"
        if year < 1985:
            return "1953-1985"
        return "1985-2026"
    lowered = question.lower()
    keys = [
        ("862-1462", ["руси", "московского княжества", "ивана калиты", "дмитрия донского", "орды", "новгородской земли"]),
        ("1462-1682", ["ивана iii", "ивана iv", "смут", "романов", "алексея михайловича", "фёдора алексеевича"]),
        ("1682-1801", ["петра i", "екатерины ii", "павла i", "дворцов", "пугач"]),
        ("1801-1894", ["александра i", "николая i", "александра ii", "александра iii", "декабрист"]),
        ("1894-1917", ["николая ii", "столып", "русско-япон", "первой мировой"]),
        ("1917-1941", ["большев", "гражданской войн", "нэп", "коллективизац", "индустриализац", "ссср"]),
        ("1941-1953", ["великой отечественной", "сталин", "послевоенн"]),
        ("1953-1985", ["хрущёв", "брежнев", "целин", "мтс", "афганистан"]),
        ("1985-2026", ["перестрой", "горбач", "ельцин", "российской федерации", "1991", "1993"]),
    ]
    for era, needles in keys:
        if any(needle in lowered for needle in needles):
            return era
    return "mixed-or-world"


def main() -> None:
    data = {
        "2023": parse_2023((CORPUS / "ege2023.txt").read_text(encoding="utf-8")),
        "2024": parse_2024((CORPUS / "ege2024.txt").read_text(encoding="utf-8")),
    }
    for year in data.values():
        for task, questions in year.items():
            for item in questions:
                item["era"] = classify(item["text"])
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# Инвентаризация заданий 18-21 ЕГЭ 2023-2024", ""]
    for exam_year, tasks in data.items():
        lines.append(f"## ЕГЭ {exam_year}")
        for task_no, questions in tasks.items():
            lines.append(f"### Задание {task_no}: {len(questions)} вопросов")
            era_counts: dict[str, int] = {}
            for item in questions:
                era_counts[item["era"]] = era_counts.get(item["era"], 0) + 1
            lines.append("; ".join(f"{era}: {count}" for era, count in sorted(era_counts.items())))
            lines.append("")
            for item in questions:
                lines.append(f"- **{item['number']} [{item['era']}]** {item['text']}")
            lines.append("")
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    for exam_year, tasks in data.items():
        print(exam_year, {task: len(items) for task, items in tasks.items()})
    print(OUTPUT)
    print(REPORT)


if __name__ == "__main__":
    main()
