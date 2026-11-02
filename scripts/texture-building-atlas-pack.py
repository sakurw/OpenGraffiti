"""Pack validated triangle texture patches into an atlas.

This stage keeps triangle provenance while creating the first real atlas
image. Coverage evaluation can consume the mapping without assuming that an
unfilled triangle has photographic data.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("patches")
    parser.add_argument("--patch-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--size", type=int, default=4096)
    parser.add_argument("--max-patch", type=int, default=64)
    args = parser.parse_args()

    data = json.loads(Path(args.patches).read_text(encoding="utf-8"))
    atlas = np.zeros((args.size, args.size, 4), dtype=np.uint8)
    x = 0
    y = 0
    row = 0
    entries = []

    for item in data.get("patches", []):
        image = cv2.imread(str(Path(args.patch_dir) / item["patch"]), cv2.IMREAD_UNCHANGED)
        if image is None:
            continue
        h, w = image.shape[:2]
        scale = min(1.0, args.max_patch / max(h, w))
        if scale < 1.0:
            image = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
            h, w = image.shape[:2]
        if x + w >= args.size:
            x = 0
            y += row
            row = 0
        if y + h >= args.size:
            raise RuntimeError("atlas size exhausted; increase --size")
        if image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
        atlas[y:y+h, x:x+w] = image
        entries.append({
            "triangleId": item["triangleId"],
            "atlasRect": [x, y, w, h],
            "sourcePixel": item.get("sourcePixel"),
            "qualityScore": item.get("qualityScore"),
        })
        x += w
        row = max(row, h)

    if not cv2.imwrite(args.output, atlas):
        raise RuntimeError("atlas write failed")

    Path(args.metadata).write_text(json.dumps({
        "status": "triangle-atlas-generated",
        "atlasSize": [args.size, args.size],
        "triangleCount": len(entries),
        "entries": entries,
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
