"""Measure final rendered facade pixels backed by photographic texture.

The metric is evaluated in the render image space:
visible PLATEAU facade pixels that belong to a photo-backed triangle /
all visible PLATEAU facade pixels.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import cv2


def raster_ids(ids, depths, tri, value):
    pts = np.asarray(tri["screen"], dtype=float)
    if not np.all(np.isfinite(pts)):
        return
    h, w = ids.shape
    x0, x1 = max(0, int(np.floor(pts[:, 0].min()))), min(w - 1, int(np.ceil(pts[:, 0].max())))
    y0, y1 = max(0, int(np.floor(pts[:, 1].min()))), min(h - 1, int(np.ceil(pts[:, 1].max())))
    if x1 < x0 or y1 < y0:
        return
    area = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    if abs(area) < 1e-8:
        return
    xx, yy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a = ((pts[1,0]-pts[2,0])*(yy-pts[2,1])+(pts[2,1]-pts[1,1])*(xx-pts[2,0]))/area
    b = ((pts[2,0]-pts[0,0])*(yy-pts[2,1])+(pts[0,1]-pts[2,1])*(xx-pts[2,0]))/area
    inside = (a >= 0) & (b >= 0) & (1-a-b >= 0)
    region_depth = depths[y0:y1+1, x0:x1+1]
    update = inside & (tri["depth"] < region_depth)
    region_depth[update] = tri["depth"]
    ids[y0:y1+1, x0:x1+1][update] = int(tri["id"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangles", default="data/texture-city/triangle-input.json")
    p.add_argument("--visible", default="data/texture-city/triangle-visible-mask.npy")
    p.add_argument("--uv", default="data/texture-city/landmark-atlas-uv-v3.json")
    p.add_argument("--provenance", action="store_true")
    p.add_argument("--canonical", help="render triangle to semantic triangle map")
    p.add_argument("--triangle-id", help="final render triangle-id rgba8 buffer")
    p.add_argument("--ranges", help="triangle-id-ranges.json from render capture")
    p.add_argument("--gated", nargs="+", default=[])
    p.add_argument("--width", type=int, default=1024)
    p.add_argument("--height", type=int, default=768)
    p.add_argument("--output", default="data/texture-city/final-render-photo-coverage.json")
    args = p.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    visible = np.load(args.visible)
    mapping_data = json.loads(Path(args.uv).read_text(encoding="utf-8"))["mappings"]
    if args.canonical:
        canonical = json.loads(Path(args.canonical).read_text(encoding="utf-8"))
        backed = set()
        for entry in canonical.get("entries", []):
            if entry.get("semanticTriangleIds"):
                backed.add(int(entry["renderTriangleId"]))
    elif args.provenance:
        backed = {(int(x["primitiveId"]), int(x["indexOffset"])) for x in mapping_data
                  if x.get("primitiveId") is not None and x.get("indexOffset") is not None}
    else:
        backed = set(str(x["triangleId"]) for x in mapping_data)
    if args.gated:
        backed |= {str(x["triangleId"]) for f in args.gated for x in json.loads(Path(f).read_text(encoding="utf-8"))["accepted"]}

    triangle_ids = np.full((args.height, args.width), -1, dtype=np.int64)
    zbuffer = np.full((args.height, args.width), np.inf, dtype=float)
    if args.triangle_id:
        raw = np.fromfile(args.triangle_id, dtype=np.uint8).reshape((args.height, args.width, 4))
        triangle_ids = (raw[:, :, 0].astype(np.int64) * 65536 + raw[:, :, 1].astype(np.int64) * 256 + raw[:, :, 2].astype(np.int64))
        triangle_ids -= 1
    else:
        for tri in triangles:
            raster_ids(triangle_ids, zbuffer, tri, True)

    # Visibility masks can come from high resolution depth captures while the
    # triangle provenance projection may use the lower resolution evaluation
    # camera. Keep the same image-space comparison by resampling the boolean
    # mask to the active evaluation resolution.
    if visible.shape != triangle_ids.shape:
        visible = cv2.resize(
            visible.astype(np.uint8),
            (args.width, args.height),
            interpolation=cv2.INTER_NEAREST,
        ).astype(bool)

    # Numpy masks generated from image captures may use top-left origin while
    # WebGL readPixels uses bottom-left origin. Normalize against the active
    # render-space buffer before evaluating coverage.
    if visible.shape == triangle_ids.shape:
        direct = int(np.sum(visible & (triangle_ids >= 0)))
        flipped = int(np.sum(np.flipud(visible) & (triangle_ids >= 0)))
        if flipped > direct:
            visible = np.flipud(visible)

    visible_pixels = visible & (triangle_ids >= 0)
    if args.canonical:
        backed_ids = backed
    elif args.provenance:
        backed_ids = {int(tri["id"]) for tri in triangles
                      if (int(tri.get("primitiveId", -1)), int(tri.get("indexOffset", -1))) in backed}
    else:
        backed_ids = np.asarray([int(x) for x in backed], dtype=np.int64)
    photo_visible = visible_pixels & np.isin(triangle_ids, list(backed_ids))
    uncovered_visible_pixels = visible_pixels & ~photo_visible
    triangle_assignment = {}
    visible_triangle_values = triangle_ids[visible_pixels]
    photo_triangle_values = triangle_ids[photo_visible]
    for tid in np.unique(visible_triangle_values):
        if tid < 0:
            continue
        triangle_assignment[str(int(tid))] = {
            "visiblePixels": int(np.sum(visible_triangle_values == tid)),
            "photoBackedPixels": int(np.sum(photo_triangle_values == tid)),
        }
        source_triangle = next((tri for tri in triangles if int(tri["id"]) == int(tid)), None)
        if source_triangle is not None:
            normals = source_triangle.get("normals", [])
            if normals:
                normal = np.mean(np.asarray(normals, dtype=float), axis=0)
                length = float(np.linalg.norm(normal))
                if length > 0:
                    normal = (normal / length).tolist()
                    triangle_assignment[str(int(tid))]["normal"] = normal
        triangle_assignment[str(int(tid))]["uncoveredPixels"] = (
            triangle_assignment[str(int(tid))]["visiblePixels"]
            - triangle_assignment[str(int(tid))]["photoBackedPixels"]
        )
    result = {
        "status": "final-render-photo-coverage",
        "visibleSurfacePixels": int(visible_pixels.sum()),
        "photoBackedPixels": int(photo_visible.sum()),
        "coverageRatio": float(photo_visible.sum() / visible_pixels.sum()) if visible_pixels.sum() else 0.0,
        "targetRatio": 0.9,
        "targetReached": bool(photo_visible.sum() / visible_pixels.sum() >= 0.9) if visible_pixels.sum() else False,
        "photoBackedTriangleCount": len(backed),
        "uncoveredVisiblePixels": int(uncovered_visible_pixels.sum()),
        "visibleTriangleAssignmentPixels": int(visible_pixels.sum()),
        "triangleAssignment": triangle_assignment,
        "validation": "render-space intersection of visible mask and photo-backed triangle raster",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
