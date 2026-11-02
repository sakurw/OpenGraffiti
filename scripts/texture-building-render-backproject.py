"""Convert render matches into 2D-3D correspondence candidates.

The render pass must provide a depth image and a world-position image generated
from the same PLATEAU camera. This keeps the correspondence tied to geometry.
The result is a PnP input candidate only and requires held-out validation.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("matches")
    p.add_argument("world_image")
    p.add_argument("--depth")
    p.add_argument("--resolution", nargs=2, type=int, default=[1024, 768])
    p.add_argument("--output", required=True)
    args = p.parse_args()

    matches = json.loads(Path(args.matches).read_text(encoding="utf-8"))
    world_path = Path(args.world_image)
    if world_path.suffix == ".f32":
        width, height = args.resolution
        raw = np.fromfile(world_path, dtype=np.float32)
        world = raw.reshape((height, width, 4))[:, :, :3]
    else:
        world = np.load(args.world_image)
    if world.ndim != 3 or world.shape[2] != 3:
        raise RuntimeError("world image must contain XYZ channels")

    depth = None
    if args.depth:
        depth_path = Path(args.depth)
        width, height = args.resolution
        raw_depth = np.fromfile(depth_path, dtype=np.float32)
        depth = raw_depth.reshape((height, width, 4))[:, :, 0]

    correspondences = []
    h, w = world.shape[:2]
    rejected_depth = 0
    for item in matches.get("matches", []):
        x, y = [int(round(v)) for v in item["renderPixel"]]
        if x < 0 or y < 0 or x >= w or y >= h:
            continue

        # Feature locations are subpixel estimates. Use a small render-space
        # neighborhood so anti-aliased edges do not immediately become missing
        # 3D observations.
        candidates = []
        for yy in range(max(0, y - 2), min(h, y + 3)):
            for xx in range(max(0, x - 2), min(w, x + 3)):
                value = world[yy, xx]
                if np.isfinite(value).all():
                    candidates.append((abs(xx - x) + abs(yy - y), value))
        if not candidates:
            continue
        point = min(candidates, key=lambda x: x[0])[1]
        pixel_depth = None
        if depth is not None:
            pixel_depth = float(depth[y, x])
            if not np.isfinite(pixel_depth) or pixel_depth <= 0:
                rejected_depth += 1
                continue
        correspondences.append({
            "world": point.astype(float).tolist(),
            "pixel": item["imagePixel"],
            "sourceDistance": item["distance"],
            "depth": pixel_depth,
        })

    # Remove repeated render pixels before PnP. A single image feature should
    # not create multiple observations of the same geometry location.
    unique = {}
    for item in correspondences:
        key = tuple(round(v, 1) for v in item["world"])
        unique.setdefault(key, item)
    correspondences = list(unique.values())

    Path(args.output).write_text(json.dumps({
        "status": "candidate-3d-correspondence-only",
        "count": len(correspondences),
        "correspondences": correspondences,
        "rejectedDepthSamples": rejected_depth,
        "validationRequired": ["sq-pnp", "held-out-controls", "visibility"],
    }, indent=2), encoding="utf-8")
    print(json.dumps({"correspondences": len(correspondences)}))


if __name__ == "__main__":
    main()
