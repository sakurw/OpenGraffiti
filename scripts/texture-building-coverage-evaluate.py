"""Evaluate projected landmark coverage from a registered camera.

This is an evaluation gate for the high accuracy landmark pipeline. It does not
claim texture validity; it measures how much of a building mask is visible from
the estimated camera and how much of the photo can support projection.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("building_pixels", type=int)
    parser.add_argument("covered_pixels", type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if args.building_pixels <= 0:
        raise RuntimeError("building pixel count must be positive")
    ratio = args.covered_pixels / args.building_pixels
    result = {
        "status": "coverage-measurement",
        "buildingPixels": args.building_pixels,
        "coveredPixels": args.covered_pixels,
        "coverageRatio": ratio,
        "targetRatio": 0.9,
        "targetReached": ratio >= 0.9,
        "validationRequired": ["photo-registration", "occlusion", "color-consistency"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
