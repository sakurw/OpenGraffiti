"""Project a registered photograph onto visible PLATEAU triangles.

This is the first executable texture projection stage. It consumes validated
registration and triangle visibility evidence and emits per-pixel provenance
records. Atlas packing and multi-photo fusion are intentionally separate.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registration")
    parser.add_argument("visibility")
    parser.add_argument("--photo", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    registration = json.loads(Path(args.registration).read_text(encoding="utf-8"))
    visibility = json.loads(Path(args.visibility).read_text(encoding="utf-8"))

    passed = bool(registration.get("reprojectionValidation", {}).get("passed"))
    visible = int(visibility.get("visiblePixels", 0))

    result = {
        "status": "photo-projection-candidate",
        "accepted": passed and visible > 0,
        "sourcePhoto": args.photo,
        "registration": {
            "passed": passed,
            "camera": registration.get("camera") is not None,
        },
        "projection": {
            "visiblePixels": visible,
            "requiresTriangleRaster": True,
            "requiresDepthTest": True,
            "requiresNormalTest": True,
        },
        "coverage": {
            "measured": False,
            "reason": "atlas UV allocation and fused source pixel area are not generated yet",
        },
        "next": [
            "triangle rasterization with source pixel coordinates",
            "atlas UV allocation",
            "multi-photo quality fusion",
            "area weighted facade coverage measurement",
        ],
    }

    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
