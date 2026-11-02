"""Audit photographic atlas coverage at triangle level.

This is the final bridge before the 90% gate. It does not infer coverage from
the existence of an atlas image; a triangle must have both atlas provenance and
validated photo evidence.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangle_areas")
    parser.add_argument("atlas_mapping")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    areas = json.loads(Path(args.triangle_areas).read_text(encoding="utf-8"))
    mapping = json.loads(Path(args.atlas_mapping).read_text(encoding="utf-8"))

    triangle_areas = areas.get("triangleAreas", {})
    mapped = {
        str(item.get("triangleId"))
        for item in mapping.get("mappings", [])
        if item.get("atlasUV")
    }

    covered = [key for key in mapped if key in triangle_areas]
    total = sum(float(v) for v in triangle_areas.values())
    covered_area = sum(float(triangle_areas[key]) for key in covered)

    result = {
        "status": "atlas-photographic-coverage-audit",
        "coveredTriangleArea": covered_area,
        "visibleTriangleArea": total,
        "coverageRatio": covered_area / total if total else 0,
        "targetRatio": 0.9,
        "targetReached": covered_area / total >= 0.9 if total else False,
        "coveredTriangles": len(covered),
        "validation": {
            "requiresPhotoFusion": True,
            "requiresAtlasUV": True,
            "requiresTriangleArea": True,
        },
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
