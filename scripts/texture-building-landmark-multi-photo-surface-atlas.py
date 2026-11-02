"""Build a photo fused landmark atlas from multiple calibrated projections.

Each triangle keeps its source provenance. When multiple photographs observe
the same triangle, the source with the largest projected triangle area is used
as the current high quality selection rule.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mapping", required=True)
    p.add_argument("--projection", nargs="+", required=True)
    p.add_argument("--photo-dir", required=True)
    p.add_argument("--atlas", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--size", type=int, default=8192)
    args = p.parse_args()

    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    projections = {}
    observation_index = {}
    for path in args.projection:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        source = data["sourceId"]
        samples = {int(x["triangleId"]): x for x in data["samples"]}
        projections[source] = samples
        for triangle_id, sample in samples.items():
            observation_index.setdefault(triangle_id, []).append((source, sample))

    atlas = np.zeros((args.size, args.size, 3), dtype=np.uint8)
    records = []
    photo_cache = {}
    cursor = 0

    for item in mapping.get("mappings", []):
        triangle_id = int(item["triangleId"])
        candidates = []
        for source, sample in observation_index.get(triangle_id, []):
            poly = np.float32(sample["photoPolygon"])
            area = abs(cv2.contourArea(poly))
            candidates.append((area, source, sample))
        if not candidates:
            continue

        _, source, sample = max(candidates, key=lambda x: x[0])
        if source not in photo_cache:
            photo_cache[source] = cv2.imread(str(Path(args.photo_dir) / f"{source}.jpg"), cv2.IMREAD_COLOR)
        photo = photo_cache[source]
        if photo is None:
            continue
        x = (cursor % 256) * 32
        y = (cursor // 256) * 32
        if y + 32 >= args.size:
            break
        h = cv2.getAffineTransform(np.float32([[0, 0], [31, 0], [0, 31]]), np.float32(sample["photoPolygon"]))
        atlas[y:y + 32, x:x + 32] = cv2.warpAffine(photo, h, (32, 32))
        item = dict(item)
        # Keep the same corner convention as the projected triangle. The atlas
        # coordinates describe the three photoPolygon corners in order; the
        # GLTF writer later resolves them through vertex identity.
        item["atlasUV"] = [
            [x / args.size, y / args.size],
            [(x + 32) / args.size, y / args.size],
            [x / args.size, (y + 32) / args.size],
        ]
        item["sourceId"] = source
        records.append(item)
        cursor += 1

    cv2.imwrite(args.atlas, atlas)
    Path(args.output).write_text(json.dumps({
        "status": "multi-photo-surface-atlas-generated",
        "triangleCount": len(records),
        "mappings": records,
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
