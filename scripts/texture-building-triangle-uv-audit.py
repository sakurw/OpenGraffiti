"""Audit triangle atlas mappings before GLB texture assignment.

Checks that every photo-backed triangle has traceable atlas coordinates.
This prevents an atlas image from being counted as coverage without a valid
triangle-to-texture relationship.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    valid = []
    invalid = []

    for item in data.get("mappings", []):
        uv = item.get("atlasUV")
        if not item.get("triangleId") or not uv or len(uv) != 3:
            invalid.append(item.get("triangleId"))
            continue
        if all(0 <= p <= 1 for point in uv for p in point):
            valid.append(item)
        else:
            invalid.append(item.get("triangleId"))

    result = {
        "status": "triangle-uv-audit",
        "validTriangles": len(valid),
        "invalidTriangles": invalid,
        "coverageEligible": len(invalid) == 0 and len(valid) > 0,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
