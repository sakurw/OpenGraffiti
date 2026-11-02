"""Create source photo patches for fused landmark triangles.

Keeps triangle provenance while extracting the selected photograph regions.
The output is consumed by atlas packing and does not claim final coverage.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fusion")
    parser.add_argument("projection_dir")
    parser.add_argument("photo_dir")
    parser.add_argument("--output", required=True)
    parser.add_argument("--patch-dir", required=True)
    args = parser.parse_args()

    fusion = json.loads(Path(args.fusion).read_text(encoding="utf-8"))
    projections = {}
    for path in Path(args.projection_dir).glob("landmark-photo-projection-*-v2.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        projections[str(data.get("sourceId"))] = data.get("samples", [])

    patches = []
    patch_dir = Path(args.patch_dir)
    patch_dir.mkdir(parents=True, exist_ok=True)
    image_cache = {}

    for triangle_id, selected in fusion.get("selected", {}).items():
        source = Path(selected["source"]).stem
        source_id = source.replace("landmark-photo-raster-coverage-depth-", "").replace("-v2", "")
        sample = next((x for x in projections.get(source_id, []) if str(x.get("triangleId")) == triangle_id), None)
        if not sample:
            continue
        if source_id not in image_cache:
            image_cache[source_id] = cv2.imread(str(Path(args.photo_dir) / f"{source_id}.jpg"))
        image = image_cache[source_id]
        if image is None:
            continue
        polygon = np.asarray(sample.get("photoPolygon", []), dtype=np.float32)
        if polygon.shape != (3, 2):
            continue
        x, y, w, h = cv2.boundingRect(np.round(polygon).astype(np.int32))
        if w <= 0 or h <= 0:
            continue
        patch = image[max(0, y):y+h, max(0, x):x+w]
        if patch.size == 0:
            continue
        name = f"triangle-{triangle_id}.png"
        cv2.imwrite(str(patch_dir / name), patch)
        patches.append({
            "triangleId": triangle_id,
            "patch": name,
            "sourceId": source_id,
            "qualityScore": selected.get("score"),
        })

    Path(args.output).write_text(json.dumps({"status": "landmark-photo-patches", "patches": patches}, indent=2), encoding="utf-8")
    print(json.dumps({"patchCount": len(patches)}))


if __name__ == "__main__":
    main()
