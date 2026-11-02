"""Estimate photographed area from landmark projection candidates.

This stage bridges projected triangle candidates and the existing area
coverage accounting. It remains conservative: a triangle contributes only
when its projected polygon has valid image overlap and it exists in the
visible facade area set.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("projection")
    p.add_argument("visible_area")
    p.add_argument("photo")
    p.add_argument("--depth-gate")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    visible = json.loads(Path(args.visible_area).read_text(encoding="utf-8")).get("visibleTriangleAreas", {})
    image = cv2.imread(args.photo)
    if image is None:
        raise RuntimeError("photo not found")

    h, w = image.shape[:2]
    covered = {}
    depth_accepted = None
    if args.depth_gate:
        depth_data = json.loads(Path(args.depth_gate).read_text(encoding="utf-8"))
        depth_accepted = {str(x.get("triangleId")) for x in depth_data.get("accepted", [])}
    for sample in projection.get("samples", []):
        triangle_id = str(sample.get("triangleId"))
        if depth_accepted is not None and triangle_id not in depth_accepted:
            continue
        area = float(visible.get(triangle_id, 0))
        if area <= 0:
            continue
        polygon = np.asarray(sample.get("photoPolygon", []), dtype=np.float32)
        if polygon.shape != (3, 2):
            continue
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.round(polygon).astype(np.int32), 1)
        if np.count_nonzero(mask) == 0:
            continue
        covered[triangle_id] = {
            "surfaceArea": area,
            "photoPixels": int(np.count_nonzero(mask)),
        }

    visible_area = sum(float(v) for v in visible.values())
    covered_area = sum(float(v["surfaceArea"]) for v in covered.values())
    result = {
        "status": "landmark-photo-raster-coverage",
        "visibleTriangleArea": visible_area,
        "coveredTriangleArea": covered_area,
        "coverageRatio": covered_area / visible_area if visible_area else 0,
        "targetRatio": 0.9,
        "targetReached": covered_area / visible_area >= 0.9 if visible_area else False,
        "coveredTriangleCount": len(covered),
        "triangles": covered,
        "validationRequired": ["depth-gate", "normal-gate", "multi-photo-fusion"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"coveredTriangleCount": len(covered), "coverageRatio": result["coverageRatio"]}))


if __name__ == "__main__":
    main()
