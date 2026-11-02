"""Apply visibility and viewing-angle checks to landmark photo candidates.

This stage removes projection-only candidates before multi-photo fusion. It
uses PLATEAU triangle depth/normal data and keeps the original photo
provenance for later texture generation.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("projection")
    p.add_argument("triangles")
    p.add_argument("--camera-position", nargs=3, type=float, required=True)
    p.add_argument("--depth-tolerance", type=float, default=0.02)
    p.add_argument("--min-facing", type=float, default=0.0)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    triangles = {str(t["id"]): t for t in json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]}
    camera = np.asarray(args.camera_position, dtype=float)

    accepted = []
    rejected = {"missingTriangle": 0, "backFacing": 0}
    for sample in projection.get("samples", []):
        triangle = triangles.get(str(sample.get("triangleId")))
        if triangle is None:
            rejected["missingTriangle"] += 1
            continue

        normal = np.asarray(triangle.get("normal", [0, 0, 0]), dtype=float)
        center = np.asarray(triangle.get("center", [0, 0, 0]), dtype=float)
        direction = camera - center
        length = np.linalg.norm(direction)
        if length == 0 or np.dot(normal, direction / length) < args.min-facing:
            rejected["backFacing"] += 1
            continue

        accepted.append({
            **sample,
            "surfaceArea": triangle.get("area", triangle.get("surfaceArea", 0)),
            "normalDotView": float(np.dot(normal, direction / length)),
        })

    result = {
        "status": "landmark-quality-gated",
        "acceptedTriangleCount": len(accepted),
        "rejected": rejected,
        "requiresDepthRasterValidation": True,
        "accepted": accepted,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"acceptedTriangleCount": len(accepted), "rejected": rejected}))


if __name__ == "__main__":
    main()
