"""Rasterize projected PLATEAU triangles and compare against captured depth.

This is the geometry-aware visibility stage for the landmark texture pipeline.
It keeps the coverage metric tied to building triangles instead of only valid
depth pixels. Inputs are a triangle projection list and a captured depth image.
"""
import argparse
import json
from pathlib import Path

import numpy as np


def raster_triangle(mask, yield_mask, depth, points, triangle_depth, tolerance, vertex_depths=None):
    if not np.all(np.isfinite(points)):
        return
    height, width = mask.shape
    xs = points[:, 0]
    ys = points[:, 1]
    x0 = max(0, int(np.floor(xs.min())))
    x1 = min(width - 1, int(np.ceil(xs.max())))
    y0 = max(0, int(np.floor(ys.min())))
    y1 = min(height - 1, int(np.ceil(ys.max())))
    area = (points[1, 0] - points[0, 0]) * (points[2, 1] - points[0, 1]) - (points[2, 0] - points[0, 0]) * (points[1, 1] - points[0, 1])
    if abs(area) < 1e-6:
        return
    xs_grid, ys_grid = np.meshgrid(
        np.arange(x0, x1 + 1) + 0.5,
        np.arange(y0, y1 + 1) + 0.5,
    )
    w0 = ((points[1, 0]-points[2, 0])*(ys_grid-points[2, 1]) +
          (points[2, 1]-points[1, 1])*(xs_grid-points[2, 0])) / area
    w1 = ((points[2, 0]-points[0, 0])*(ys_grid-points[2, 1]) +
          (points[0, 1]-points[2, 1])*(xs_grid-points[2, 0])) / area
    inside = (w0 >= 0) & (w1 >= 0) & ((1 - w0 - w1) >= 0)
    if not np.any(inside):
        return

    region_mask = mask[y0:y1 + 1, x0:x1 + 1]
    region_mask |= inside
    region_yield = yield_mask[y0:y1 + 1, x0:x1 + 1]
    region_depth = depth[y0:y1 + 1, x0:x1 + 1]
    if vertex_depths is None:
        expected_depth = triangle_depth
    else:
        # Interpolate the GPU depth value. The vertices contain z/w converted
        # to the same [0,1] depth space used by gl_FragCoord.z.
        reciprocal_depth = (
            w0 * vertex_depths[0] +
            w1 * vertex_depths[1] +
            (1 - w0 - w1) * vertex_depths[2]
        )
        expected_depth = reciprocal_depth
    region_yield |= inside & np.isfinite(region_depth) & (np.abs(region_depth - expected_depth) <= tolerance)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangles")
    parser.add_argument("depth")
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1024)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--depth-tolerance", type=float, default=0.002)
    args = parser.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    raw = np.fromfile(args.depth, dtype=np.float32)
    if raw.size == args.width * args.height * 4:
        raw = raw.reshape((args.height, args.width, 4))[:, :, 0]
    elif raw.size == args.width * args.height:
        raw = raw.reshape((args.height, args.width))
    else:
        raise ValueError(f"unexpected depth buffer size: {raw.size}")
    # WebGL readRenderTargetPixels returns rows from the framebuffer origin
    # (bottom-left), while triangle projection uses image coordinates with the
    # origin at the top-left. Align the depth buffer before comparison.
    depth = np.flipud(raw)
    mask = np.zeros((args.height, args.width), dtype=bool)
    yield_mask = np.zeros_like(mask)
    for triangle in triangles:
        raster_triangle(
            mask,
            yield_mask,
            depth,
            np.asarray(triangle["screen"], dtype=float),
            float(triangle["depth"]),
            args.depth_tolerance,
            np.asarray(triangle.get("gpuDepths"), dtype=float) if triangle.get("gpuDepths") else None,
        )

    npy_path = Path(args.output)
    if npy_path.suffix.lower() != ".npy":
        npy_path = npy_path.with_suffix(".npy")
    np.save(npy_path, yield_mask)
    result = {
        "status": "triangle-visible-mask-generated",
        "projectedPixels": int(mask.sum()),
        "visiblePixels": int(yield_mask.sum()),
        "visibilityRatio": float(yield_mask.sum() / mask.sum()) if mask.sum() else 0.0,
        "validationRequired": ["camera-registration", "photo-registration", "texture-quality"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
