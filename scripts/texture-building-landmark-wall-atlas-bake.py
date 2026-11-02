"""Bake a continuous WallSurface atlas from projected photo samples.

Samples are placed in the shared WallSurface local coordinate domain. This
keeps adjacent triangles on the same facade in one texture space instead of
allocating an independent patch for every triangle.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--projection", required=True)
    parser.add_argument("--photo-dir", required=True)
    parser.add_argument("--triangles")
    parser.add_argument("--atlas", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, default=4096)
    args = parser.parse_args()

    data = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    triangle_meta = {}
    if args.triangles:
        triangle_meta = {
            int(t["id"]): t
            for t in json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
        }
    atlas = np.zeros((args.size, args.size, 3), dtype=np.uint8)
    records = []
    photo_cache = {}
    for path in Path(args.photo_dir).rglob('*.jpg'):
        photo_cache[path.stem] = cv2.imread(str(path), cv2.IMREAD_COLOR)

    # One global domain is used for the first implementation. Later stages can
    # pack each wallId independently without changing sample provenance.
    coords = []
    for sample in data.get("samples", []):
        coords.extend(sample.get("wallLocalPolygon", []))
    if not coords:
        raise RuntimeError("wallLocalPolygon missing. Generate wall-photo-projection first.")
    min_x = min(p[0] for p in coords)
    min_y = min(p[1] for p in coords)
    max_x = max(p[0] for p in coords)
    max_y = max(p[1] for p in coords)
    scale = min((args.size - 1) / max(max_x - min_x, 1e-6),
                (args.size - 1) / max(max_y - min_y, 1e-6))

    for sample in data.get("samples", []):
        photo = photo_cache.get(sample['sourceId'])
        if photo is None:
            continue
        poly = np.float32(sample["photoPolygon"])
        local = sample.get("wallLocalPolygon")
        if len(local) != 3:
            continue
        dst = np.float32([[ (p[0]-min_x)*scale, (max_y-p[1])*scale ] for p in local])
        # Warp only the triangle-sized source crop. The previous version
        # allocated a full atlas-sized warp for every sample, making a 37k
        # triangle bake perform tens of thousands of 4096x4096 operations.
        min_u = max(int(np.floor(dst[:, 0].min())), 0)
        max_u = min(int(np.ceil(dst[:, 0].max())) + 1, args.size)
        min_v = max(int(np.floor(dst[:, 1].min())), 0)
        max_v = min(int(np.ceil(dst[:, 1].max())) + 1, args.size)
        if max_u <= min_u or max_v <= min_v:
            continue
        local_dst = dst - np.float32([min_u, min_v])
        # Use the actual photographed triangle. The previous fixed 63x63
        # source triangle discarded almost all available facade detail and
        # produced sparse atlas coverage. Map the complete source polygon into
        # the wall-local atlas domain.
        src = poly
        local_dst = local_dst.astype(np.float32)
        transform = cv2.getAffineTransform(src, local_dst)
        patch = cv2.warpAffine(photo, transform, (max_u - min_u, max_v - min_v))
        mask = np.zeros((max_v - min_v, max_u - min_u), dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.int32(local_dst), 255)
        # Do not let invalid interpolation/background pixels erase an already
        # baked facade sample. This is especially important when adjacent
        # projected triangles overlap in atlas space.
        valid = np.any(patch != 0, axis=2)
        mask[~valid] = 0
        region = atlas[min_v:max_v, min_u:max_u]
        region[mask != 0] = patch[mask != 0]
        atlas[min_v:max_v, min_u:max_u] = region
        records.append({
            "triangleId": sample["triangleId"],
            "meshIndex": triangle_meta.get(int(sample["triangleId"]), {}).get("meshIndex", 0),
            "primitiveId": triangle_meta.get(int(sample["triangleId"]), {}).get("primitiveId", 0),
            "indexOffset": triangle_meta.get(int(sample["triangleId"]), {}).get("indexOffset", int(sample["triangleId"]) * 3),
            "vertexIds": triangle_meta.get(int(sample["triangleId"]), {}).get("vertexIds", []),
            "wallId": sample["wallId"],
            "sourceId": sample["sourceId"],
            "wallLocalPolygon": local,
            "atlasUV": [[float(p[0] / args.size), float(p[1] / args.size)] for p in dst],
            "method": "continuous-wall-surface-coordinate-atlas",
        })

    cv2.imwrite(args.atlas, atlas)
    Path(args.output).write_text(json.dumps({
        "status": "continuous-wall-atlas-generated",
        "recordCount": len(records),
        "records": records,
        "mappings": [
            {
                "triangleId": r["triangleId"],
                "meshIndex": r["meshIndex"],
                "primitiveId": r["primitiveId"],
                "indexOffset": r["indexOffset"],
                "vertexIds": r["vertexIds"],
                "atlasUV": r["atlasUV"],
                "wallId": r["wallId"],
                "method": r["method"],
            }
            for r in records
        ],
    }, indent=2), encoding="utf-8")
    print(json.dumps({"status": "continuous-wall-atlas-generated", "recordCount": len(records)}))


if __name__ == "__main__":
    main()
