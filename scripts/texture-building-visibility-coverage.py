"""Compute visible projected coverage from a landmark registration.

This stage evaluates the geometric part of the 90 percent target. It consumes
the registered camera output and a projected building mask. Texture validity
still requires photometric and source-image checks.
"""
import argparse
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("building_mask")
    parser.add_argument("visible_mask")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    building = np.load(args.building_mask).astype(bool)
    visible = np.load(args.visible_mask).astype(bool)
    if building.shape != visible.shape:
        raise RuntimeError("mask dimensions must match")

    total = int(building.sum())
    covered = int((building & visible).sum())
    ratio = covered / total if total else 0.0
    result = {
        "status": "visibility-coverage-measurement",
        "buildingPixels": total,
        "coveredPixels": covered,
        "coverageRatio": ratio,
        "targetRatio": 0.9,
        "targetReached": ratio >= 0.9,
        "validationRequired": [
            "camera-registration",
            "occlusion-depth-consistency",
            "texture-quality"
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
