"""Generate a conservative visible-pixel mask from a captured render.

This is the bridge between render capture and the 90 percent coverage metric.
It uses the captured depth image and a building render mask. It intentionally
does not claim texture correctness; registration and photometric checks remain
separate gates.
"""
import argparse
import json
from pathlib import Path

import numpy as np


def read_rgba_float(path, width, height):
    raw = np.fromfile(path, dtype=np.float32)
    return raw.reshape((height, width, 4))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("depth")
    parser.add_argument("building_mask")
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--depth-tolerance", type=float, default=0.25)
    args = parser.parse_args()

    depth = read_rgba_float(args.depth, args.width, args.height)[:, :, 0]
    building = np.load(args.building_mask).astype(bool)
    if building.shape != depth.shape:
        raise RuntimeError("building mask dimensions must match render resolution")

    finite_depth = np.isfinite(depth) & (depth > 0)
    visible = building & finite_depth

    np.save(Path(args.output).with_suffix(".npy"), visible)
    result = {
        "status": "visible-mask-generated",
        "buildingPixels": int(building.sum()),
        "visiblePixels": int(visible.sum()),
        "visibleRatio": float(visible.sum() / building.sum()) if building.sum() else 0.0,
        "depthTolerance": args.depth_tolerance,
        "validationRequired": ["triangle-rasterization", "occlusion-check", "camera-registration"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
