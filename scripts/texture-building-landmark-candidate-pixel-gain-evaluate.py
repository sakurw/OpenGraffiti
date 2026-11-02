"""Evaluate candidate landmark views in render pixel space.

The candidate depth buffer and the current photo coverage are compared at the
pixel level. The result is used for viewpoint ranking; final acceptance still
comes from the full render audit.
"""
import argparse
import json
from pathlib import Path

import numpy as np


def raster_triangle(ids, depth, tri):
    pts = np.asarray(tri["screen"], dtype=float)
    if not np.isfinite(pts).all():
        return
    h, w = ids.shape
    x0 = max(0, int(np.floor(pts[:, 0].min())))
    x1 = min(w - 1, int(np.ceil(pts[:, 0].max())))
    y0 = max(0, int(np.floor(pts[:, 1].min())))
    y1 = min(h - 1, int(np.ceil(pts[:, 1].max())))
    if x1 < x0 or y1 < y0:
        return
    area = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    if abs(area) < 1e-8:
        return
    xx, yy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
    a = ((pts[1, 0]-pts[2, 0])*(yy-pts[2, 1])+(pts[2, 1]-pts[1, 1])*(xx-pts[2, 0])) / area
    b = ((pts[2, 0]-pts[0, 0])*(yy-pts[2, 1])+(pts[0, 1]-pts[2, 1])*(xx-pts[2, 0])) / area
    inside = (a >= 0) & (b >= 0) & (1-a-b >= 0)
    region = depth[y0:y1+1, x0:x1+1]
    update = inside & (tri["depth"] < region)
    region[update] = tri["depth"]
    ids[y0:y1+1, x0:x1+1][update] = int(tri["id"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("candidate_depth")
    p.add_argument("triangles")
    p.add_argument("coverage")
    p.add_argument("--projection", help="candidate photo projection JSON")
    p.add_argument("--mask-output", help="save candidate photo-backed pixel mask as npy")
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=2560)
    p.add_argument("--output", required=True)
    a = p.parse_args()

    triangles = json.loads(Path(a.triangles).read_text(encoding="utf-8"))["triangles"]
    coverage = json.loads(Path(a.coverage).read_text(encoding="utf-8"))
    candidate_depth = np.fromfile(a.candidate_depth, dtype=np.float32).reshape(a.height, a.width)

    ids = np.full((a.height, a.width), -1, dtype=np.int64)
    z = np.full((a.height, a.width), np.inf, dtype=float)
    for tri in triangles:
        raster_triangle(ids, z, tri)

    # Keep the candidate depth buffer as the visibility authority. The
    # triangle raster above reconstructs provenance; pixels outside the depth
    # rendered surface are removed before gain calculation.
    candidate_pixels = ids >= 0
    candidate_pixels &= np.isfinite(candidate_depth)
    candidate_pixels &= candidate_depth < 1.0
    current_backed = coverage.get("photoBackedPixels", 0)
    candidate_visible = int(candidate_pixels.sum())

    projected_ids = set()
    if a.projection:
        projection = json.loads(Path(a.projection).read_text(encoding="utf-8"))
        projected_ids = {
            int(sample["triangleId"])
            for sample in projection.get("samples", [])
            if sample.get("triangleId") is not None
        }

    photo_candidate_pixels = candidate_pixels & np.isin(ids, list(projected_ids)) if projected_ids else np.zeros_like(candidate_pixels)
    new_pixels = int(photo_candidate_pixels.sum())
    if a.mask_output:
        np.save(a.mask_output, photo_candidate_pixels)
    result = {
        "status": "candidate-pixel-gain-evaluation",
        "candidateVisiblePixels": candidate_visible,
        "currentPhotoBackedPixels": current_backed,
        "newPhotoBackedVisiblePixels": new_pixels if a.projection else None,
        "candidateProjectedTriangleCount": len(projected_ids),
        "requiresProjectionMask": not bool(a.projection),
        "note": "Pixel intersection uses candidate depth visibility and projection triangle provenance."
    }
    Path(a.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
