"""Prepare same-WallSurface homography transfer candidates.

Uses the PLATEAU surface boundary as the transfer constraint. This stage
computes the geometric relationship required before raster synthesis; it does
not mark generated pixels as observed evidence.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def solve_affine(source, target):
    a = []
    b = []
    for (sx, sy), (tx, ty) in zip(source, target):
        a.append([sx, sy, 1, 0, 0, 0])
        a.append([0, 0, 0, sx, sy, 1])
        b.extend([tx, ty])
    return np.linalg.lstsq(np.asarray(a), np.asarray(b), rcond=None)[0].tolist()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangles", required=True)
    p.add_argument("--transfer", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    triangles = {int(t["id"]): t for t in data["triangles"]}
    transfer = json.loads(Path(args.transfer).read_text(encoding="utf-8"))

    result = []
    for item in transfer.get("transfers", []):
        source = triangles.get(int(item["sourceTriangle"]))
        target = triangles.get(int(item["targetTriangle"]))
        if not source or not target:
            continue

        source_points = source.get("screen")
        target_points = target.get("screen")
        if not source_points or not target_points:
            continue

        result.append({
            "sourceTriangle": int(item["sourceTriangle"]),
            "targetTriangle": int(item["targetTriangle"]),
            "wallId": item["wallId"],
            "sourcePhotoProjection": source_points,
            "targetProjection": target_points,
            "affine": solve_affine(source_points, target_points),
            "method": "same-wall-surface-affine-transfer",
        })

    output = {
        "status": "surface-homography-transfer-candidates",
        "candidateCount": len(result),
        "candidates": result,
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"status": output["status"], "candidateCount": len(result)}))


if __name__ == "__main__":
    main()
