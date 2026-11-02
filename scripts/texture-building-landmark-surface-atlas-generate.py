"""Generate a WallSurface atlas from photo-backed triangles.

This bridges the semantic reconstruction result and the existing GLB atlas
pipeline.  Triangles keep their provenance while their photo pixels are
copied into a continuous atlas space.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mapping", required=True)
    p.add_argument("--projection", required=True)
    p.add_argument("--photo", required=True)
    p.add_argument("--atlas", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--size", type=int, default=8192)
    args = p.parse_args()

    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    projection = {int(x["triangleId"]): x for x in json.loads(Path(args.projection).read_text(encoding="utf-8"))["samples"]}
    photo = cv2.imread(args.photo, cv2.IMREAD_COLOR)
    if photo is None:
        raise RuntimeError("photo missing")

    atlas = np.zeros((args.size, args.size, 3), dtype=np.uint8)
    records = []
    cursor = 0
    for item in mapping.get("mappings", []):
        sample = projection.get(int(item["triangleId"]))
        if sample is None:
            continue
        x = (cursor % 256) * 32
        y = (cursor // 256) * 32
        if y + 32 >= args.size:
            break
        poly = np.float32(sample["photoPolygon"])

        # Keep the triangle corner correspondence. The previous implementation
        # copied the projected triangle into a patch using a fixed corner order,
        # then emitted atlas UVs with that fixed order. This loses the mapping
        # between GLTF vertexIds and photo pixels when the source triangle
        # winding differs.
        src = np.float32([[0, 0], [31, 0], [0, 31]])
        h = cv2.getAffineTransform(src, poly)
        patch = cv2.warpAffine(photo, h, (32, 32))
        atlas[y:y+32, x:x+32] = patch

        # The UV order follows photoPolygon / vertexIds order. The split stage
        # resolves these entries by vertex identity before writing TEXCOORD_0.
        uv = [
            [x / args.size, y / args.size],
            [(x + 32) / args.size, y / args.size],
            [x / args.size, (y + 32) / args.size],
        ]
        item["atlasUV"] = uv
        item["qualityScore"] = "photo-backed-surface-atlas"
        records.append(item)
        cursor += 1

    if not cv2.imwrite(args.atlas, atlas):
        raise RuntimeError("atlas write failed")
    Path(args.output).write_text(json.dumps({"status": "surface-photo-atlas-generated", "triangleCount": len(records), "mappings": records}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
