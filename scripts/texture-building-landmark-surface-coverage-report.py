"""Create a surface coverage report from triangle provenance and render evidence."""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--surface", required=True)
    parser.add_argument("--coverage", required=True)
    parser.add_argument("--visible-triangles")
    parser.add_argument("--uv")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    surface = json.loads(Path(args.surface).read_text(encoding="utf-8"))
    coverage = json.loads(Path(args.coverage).read_text(encoding="utf-8"))
    visible_triangles = {}
    if args.visible_triangles:
        visible_data = json.loads(Path(args.visible_triangles).read_text(encoding="utf-8"))
        visible_triangles = visible_data.get("visibleTriangleAreas", {})

    photo_backed_triangles = set()
    if args.uv:
        uv_data = json.loads(Path(args.uv).read_text(encoding="utf-8"))
        photo_backed_triangles = {str(x.get("triangleId")) for x in uv_data.get("mappings", [])}

    triangle_to_surface = surface.get("triangleToSurface", {})
    surface_rows = {}
    for triangle_id, surface_id in triangle_to_surface.items():
        row = surface_rows.setdefault(str(surface_id), {
            "surfaceId": surface_id,
            "triangleCount": 0,
            "photoBackedTriangleCount": 0,
        })
        row["triangleCount"] += 1
        if str(triangle_id) in visible_triangles:
            row["visibleRenderArea"] = row.get("visibleRenderArea", 0) + visible_triangles[str(triangle_id)]
        if str(triangle_id) in photo_backed_triangles:
            row["photoBackedTriangleCount"] += 1

    # Current render audit stores aggregate pixel evidence. Pixel-to-triangle
    # ownership is required before surface pixel areas can be claimed.
    result = {
        "status": "landmark-surface-coverage-report",
        "surfaceCount": len(surface_rows),
        "coverageRatio": coverage.get("coverageRatio"),
        "photoBackedPixels": coverage.get("photoBackedPixels"),
        "visibleSurfacePixels": coverage.get("visibleSurfacePixels"),
        "surfacePixelAreaAvailable": False,
        "triangleAreaAvailable": bool(visible_triangles),
        "photoBackedTriangleMappingAvailable": bool(photo_backed_triangles),
        "reason": "pixel ownership requires triangle id render; triangle area is available when supplied",
        "surfaces": list(surface_rows.values()),
    }

    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "surfaceCount": result["surfaceCount"],
        "surfacePixelAreaAvailable": result["surfacePixelAreaAvailable"],
    }))


if __name__ == "__main__":
    main()
