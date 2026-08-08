from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tmp" / "pdfs" / "methodical-corpus"
FILES = {
    "ege2024": Path("C:/Users/01/Downloads/Sbornik_zadaniy_EGE_2024_po_istorii_ot_NezLO.pdf"),
    "ege2025-review": Path("C:/Users/01/Downloads/Analiticheskiy_obzor_EGE_2025_po_istorii.pdf"),
    "task19-terms": Path("C:/Users/01/Downloads/Sut_i_fakt_vopros_19_po_temam_i_po_alfavitu_versia_2_0_ot_NezLO.pdf"),
    "fact-bank": Path("C:/Users/01/Downloads/Tekhnicheskiy_fayl_Bank_faktov_5_0_vydeleny_izmenenia.pdf"),
    "ege2023": Path("C:/Users/01/Downloads/Sbornik_zadaniy_EGE_2023_po_istorii_ot_NezLO.pdf"),
}


def extract(name: str, path: Path) -> None:
    reader = PdfReader(str(path))
    pages: list[str] = []
    for page_no, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").replace("\r\n", "\n").replace("\r", "\n")
        pages.append(f"\n\n===== PAGE {page_no:04d} =====\n\n{text.strip()}\n")
    target = OUTPUT / f"{name}.txt"
    target.write_text("".join(pages), encoding="utf-8")
    print(f"{name}: {len(reader.pages)} pages -> {target}")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, path in FILES.items():
        if not path.exists():
            raise FileNotFoundError(path)
        extract(name, path)


if __name__ == "__main__":
    main()
