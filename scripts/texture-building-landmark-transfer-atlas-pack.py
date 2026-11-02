"""Pack WallSurface transfer patches while preserving triangle provenance."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("patches")
    p.add_argument("--patch-dir", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--metadata", required=True)
    p.add_argument("--size", type=int, default=4096)
    args = p.parse_args()

    data = json.loads(Path(args.patches).read_text(encoding="utf-8"))
    atlas = np.zeros((args.size, args.size, 4), dtype=np.uint8)
    entries = []
    x = y = row = 0

    for item in data.get("patches", []):
        image = cv2.imread(str(Path(args.patch_dir) / item["patch"]), cv2.IMREAD_UNCHANGED)
        if image is None:
            continue
        h, w = image.shape[:2]
        if x + w >= args.size:
            x = 0
            y += row
            row = 0
        if y + h >= args.size:
            raise RuntimeError("atlas full")
        if image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        atlas[y:y+h, x:x+w] = image
        entries.append({
            "triangleId": int(item["targetTriangle"]),
            "sourceTriangle": int(item["sourceTriangle"]),
            "wallId": item["wallId"],
            "atlasRect": [x, y, w, h],
        })
        x += w
        row = max(row, h)

    if not cv2.imwrite(args.output, atlas):
        raise RuntimeError("atlas write failed")
    Path(args.metadata).write_text(json.dumps({
        "status": "surface-transfer-atlas-generated",
        "atlasSize": [args.size, args.size],
        "triangleCount": len(entries),
        "entries": entries,
    }, indent=2), encoding="utf-8")
    print(json.dumps({"status": "surface-transfer-atlas-generated", "triangleCount": len(entries)}))


if __name__ == "__main__":
    main()
