import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "tmp" / "pdfs" / "unified-render-862"
DEFAULT_OUTPUT = ROOT / "tmp" / "pdfs" / "unified-contact-sheets-862"


def page_number(path: Path) -> int:
    return int(path.stem.rsplit("-", 1)[-1])


parser = argparse.ArgumentParser(description="Create compact QA contact sheets from rendered PDF pages")
parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

pages = sorted(args.source.glob("page-*.png"), key=page_number)
if not pages:
    raise SystemExit("No rendered pages found")

cols, rows = 5, 4
thumb_w, thumb_h = 245, 348
label_h = 20
gap = 8
sheet_w = cols * (thumb_w + gap) + gap
sheet_h = rows * (thumb_h + label_h + gap) + gap
font = ImageFont.load_default()

for sheet_idx in range(0, len(pages), cols * rows):
    batch = pages[sheet_idx:sheet_idx + cols * rows]
    sheet = Image.new("RGB", (sheet_w, sheet_h), "#D8D3C8")
    draw = ImageDraw.Draw(sheet)
    for idx, page_path in enumerate(batch):
        image = Image.open(page_path).convert("RGB")
        image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        col = idx % cols
        row = idx // cols
        x = gap + col * (thumb_w + gap)
        y = gap + row * (thumb_h + label_h + gap)
        sheet.paste(image, (x + (thumb_w - image.width) // 2, y))
        number = page_number(page_path)
        draw.text((x + 4, y + thumb_h + 3), f"page {number}", fill="#1B2430", font=font)
    first = page_number(batch[0])
    last = page_number(batch[-1])
    sheet.save(args.output / f"contact-{first:03d}-{last:03d}.jpg", quality=88, optimize=True)

print(f"Created {((len(pages) - 1) // (cols * rows)) + 1} contact sheets for {len(pages)} pages")
