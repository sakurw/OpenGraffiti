"""Build a compact visual-inspection sheet for already acquired source photos."""
import argparse
import json
import pathlib

from PIL import Image, ImageDraw, ImageOps


ROOT = pathlib.Path(__file__).resolve().parents[1]

parser = argparse.ArgumentParser()
parser.add_argument("--provider", required=True, choices=["kartaview", "msls", "commons"])
parser.add_argument("--ids", nargs="+", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--cols", type=int, default=4)
args = parser.parse_args()

folder = ROOT / "data" / "texture-city" / "photos" / args.provider
paths = [folder / f"{photo_id}.jpg" for photo_id in args.ids]
missing = [str(path) for path in paths if not path.exists()]
if missing:
    raise SystemExit("missing photos: " + ", ".join(missing))

cell_w = 420
cell_h = 420 if args.provider != "msls" else 290
rows = (len(paths) + args.cols - 1) // args.cols
sheet = Image.new("RGB", (cell_w * args.cols, cell_h * rows), "white")
draw = ImageDraw.Draw(sheet)

for index, path in enumerate(paths):
    meta_path = path.with_suffix(".json")
    meta = json.loads(meta_path.read_text(encoding="utf8")) if meta_path.exists() else {}
    photo = ImageOps.contain(
        Image.open(path).convert("RGB"),
        (cell_w - 10, cell_h - 62),
    )
    x = (index % args.cols) * cell_w
    y = (index // args.cols) * cell_h
    sheet.paste(photo, (x + (cell_w - photo.width) // 2, y + 52))
    seq_index = meta.get("sequenceIndex", "")
    draw.text((x + 6, y + 6), f"{path.stem}  idx={seq_index}", fill="black")
    heading = meta.get("heading", meta.get("compassAngle", ""))
    if heading != "":
        draw.text((x + 6, y + 24), f"heading={heading}", fill="black")

output = ROOT / args.output
output.parent.mkdir(parents=True, exist_ok=True)
sheet.save(output, quality=94)
print(output)
