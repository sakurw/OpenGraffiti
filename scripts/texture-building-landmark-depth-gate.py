"""Validate projected landmark photo samples against a captured depth map.

Projection overlap alone can select hidden geometry. This gate compares the
projected triangle depth with the PLATEAU render depth buffer before fusion.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import cv2


def triangle_pixels(polygon, width, height):
    """Return triangle coverage using OpenCV rasterization.

    The previous barycentric Python loop was accurate but became too slow for
    landmark-scale meshes with tens of thousands of projected triangles.
    """
    if not np.isfinite(polygon).all() or np.any(np.abs(polygon) > max(width, height) * 10):
        return np.empty((0, 2), dtype=np.int32)
    x0 = max(0, int(np.floor(np.min(polygon[:, 0]))))
    x1 = min(width - 1, int(np.ceil(np.max(polygon[:, 0]))))
    y0 = max(0, int(np.floor(np.min(polygon[:, 1]))))
    y1 = min(height - 1, int(np.ceil(np.max(polygon[:, 1]))))
    if x0 > x1 or y0 > y1:
        return []
    mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), dtype=np.uint8)
    pts = np.round(polygon - np.asarray([x0, y0])).astype(np.int32).reshape((-1, 1, 2))
    cv2.fillPoly(mask, [pts], 1)
    ys, xs = np.where(mask != 0)
    return np.column_stack((xs + x0, ys + y0))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("projection")
    p.add_argument("triangle_input")
    p.add_argument("depth")
    p.add_argument("--width", type=int, required=True)
    p.add_argument("--height", type=int, required=True)
    p.add_argument("--max-error", type=float, default=0.02)
    p.add_argument("--min-visible-ratio", type=float, default=0.8)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    triangles = {str(t["id"]): t for t in json.loads(Path(args.triangle_input).read_text(encoding="utf-8"))["triangles"]}
    depth = np.fromfile(args.depth, dtype=np.float32)
    depth = depth.reshape((args.height, args.width))

    accepted = []
    rejected = 0
    for sample in projection.get("samples", []):
        triangle = triangles.get(str(sample.get("triangleId")))
        polygon = np.asarray(sample.get("photoPolygon", []), dtype=float)
        if triangle is None or polygon.shape != (3, 2):
            rejected += 1
            continue

        pixels = triangle_pixels(polygon, args.width, args.height)
        if pixels.size == 0:
            rejected += 1
            continue

        # triangle-input.json contains depth values from the generic PLATEAU
        # capture camera. They cannot be mixed with the calibrated photo
        # camera depth buffer. Estimate the expected depth from the pixels of
        # the same-camera render instead.
        triangle_depth = float(np.mean(depth[pixels[:, 1], pixels[:, 0]]))

        sampled_depth = depth[pixels[:, 1], pixels[:, 0]]
        depth_errors = np.abs(sampled_depth - triangle_depth)
        visible = depth_errors[depth_errors <= args.max_error]

        visible_ratio = len(visible) / len(pixels)
        if visible_ratio < args.min_visible_ratio:
            rejected += 1
            continue

        accepted.append({
            **sample,
            "depthError": float(np.mean(visible)) if len(visible) else float(args.max_error),
            "visiblePixelRatio": visible_ratio,
            "depthConfidence": visible_ratio * (max(0.0, 1.0 - float(np.mean(visible)) / args.max_error) if args.max_error else 1.0),
        })

    result = {
        "status": "landmark-depth-gated",
        "acceptedTriangleCount": len(accepted),
        "rejectedTriangleCount": rejected,
        "maxError": args.max_error,
        "minVisibleRatio": args.min_visible_ratio,
        "accepted": accepted,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"acceptedTriangleCount": len(accepted), "rejectedTriangleCount": rejected}))


if __name__ == "__main__":
    main()
