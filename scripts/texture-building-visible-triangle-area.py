"""Estimate visible triangle area from the validated GPU visibility mask.

This keeps coverage evaluation tied to visible PLATEAU triangles instead of
using the complete mesh surface as the denominator.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangles")
    parser.add_argument("visible_mask")
    parser.add_argument("triangle_area")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    areas = json.loads(Path(args.triangle_area).read_text(encoding="utf-8"))["triangleAreas"]
    mask = np.load(args.visible_mask)

    # Pixel visibility alone cannot prove full triangle visibility. This output
    # is conservative and records only the triangles that have visible pixels;
    # the final texture coverage still requires photo validation.
    visible = {}
    for index, triangle in enumerate(triangles):
        screen = np.asarray(triangle.get("screen", []), dtype=float)
        if len(screen) != 3:
            continue
        min_x = max(0, int(np.floor(screen[:, 0].min())))
        max_x = min(mask.shape[1] - 1, int(np.ceil(screen[:, 0].max())))
        min_y = max(0, int(np.floor(screen[:, 1].min())))
        max_y = min(mask.shape[0] - 1, int(np.ceil(screen[:, 1].max())))
        if max_x < min_x or max_y < min_y:
            continue
        if np.any(mask[min_y:max_y + 1, min_x:max_x + 1]):
            key = str(index)
            if key in areas:
                visible[key] = areas[key]

    result = {
        "status": "visible-triangle-area-generated",
        "visibleTriangleAreas": visible,
        "visibleTriangleCount": len(visible),
        "requiresPhotoValidation": True,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "visibleTriangleCount": len(visible)}))


if __name__ == "__main__":
    main()
