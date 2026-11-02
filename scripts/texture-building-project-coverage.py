"""Generate a projection coverage candidate from validated photo registration.

This stage connects validated camera registration to measurable facade coverage.
It intentionally records candidate pixels only; final coverage requires the
registered photo, visibility masks and texture quality checks.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registration")
    parser.add_argument("visible_mask")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    registration = json.loads(Path(args.registration).read_text(encoding="utf-8"))
    visible = json.loads(Path(args.visible_mask).read_text(encoding="utf-8"))

    valid_registration = bool(registration.get("reprojectionValidation", {}).get("passed"))
    visible_pixels = int(visible.get("visiblePixels", 0))

    result = {
        "status": "texture-projection-candidate",
        "accepted": valid_registration and visible_pixels > 0,
        "registration": {
            "passed": valid_registration,
            "rmsPixels": registration.get("rmsPixels"),
        },
        "visibility": {
            "visiblePixels": visible_pixels,
        },
        "nextRequired": [
            "photo-quality-selection",
            "atlas-rasterization",
            "area-weighted-coverage",
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
