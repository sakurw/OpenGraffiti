"""Convert a triangle-id render pass into a PLATEAU surface coverage audit.

Inputs:
  triangle-id.rgba8
  triangle-id-ranges.json
  surface-reconstruction-manifest-current.json
  landmark-atlas-uv-semantic-upper-bound.json

The script keeps the pixel measurement separate from semantic expansion. A
triangle is photo-backed when it exists in the atlas provenance mapping.
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path


def decode_id(r, g, b):
    return r * 65536 + g * 256 + b


def vertex_signature(vertices):
    return tuple(sorted(tuple(round(v, 5) for v in point) for point in vertices))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--triangle-id", required=True)
    ap.add_argument("--ranges", required=True)
    ap.add_argument("--surface-manifest", required=True)
    ap.add_argument("--provenance", required=True)
    ap.add_argument("--triangle-input", required=True, dest="triangle_input")
    ap.add_argument("--wall-filter", action="store_true", help="measure visible wall triangles as denominator")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    ranges = json.loads(Path(args.ranges).read_text())
    manifest = json.loads(Path(args.surface_manifest).read_text())
    provenance = json.loads(Path(args.provenance).read_text())
    triangle_input = json.loads(Path(args.triangle_input).read_text())

    wall_triangles = set()
    if args.wall_filter:
        for triangle in triangle_input.get("triangles", []):
            semantic = triangle.get("semantic") or {}
            if semantic.get("wallId"):
                wall_triangles.add(int(triangle["id"]))

    input_by_mesh_vertices = {}
    for triangle in triangle_input.get("triangles", []):
        key = (int(triangle.get("meshIndex", -1)), tuple(sorted(int(v) for v in triangle.get("vertexIds", []))))
        input_by_mesh_vertices[key] = int(triangle["id"])

    triangle_surface = {}
    for tid, sid in manifest.get("triangleToSurface", {}).items():
        triangle_surface[int(tid)] = sid
    # The reconstruction manifest stores the expanded triangle membership in
    # surfaces[].triangles, while the compact triangle records live at the top
    # level. Support both layouts because the audit must use the actual
    # reconstruction output.
    for index, surface in enumerate(manifest.get("surfaces", [])):
        sid = surface.get("surfaceId", surface.get("id", index))
        for tid in surface.get("triangles", []):
            triangle_surface.setdefault(int(tid), sid)
    if not triangle_surface:
        for index, surface in enumerate(manifest.get("surfaces", [])):
            sid = surface.get("surfaceId", surface.get("id", index))
            for tid in surface.get("expandedTriangles", surface.get("triangles", [])):
                triangle_surface[int(tid)] = sid

    # Geometry-adjacency reconstruction creates the candidate facade domain
    # from photo-supported wall geometry. Those triangles may not retain the
    # original PLATEAU wallId after expansion, so include the reconstructed
    # surface ownership when wall-domain auditing is requested.
    if args.wall_filter:
        wall_triangles.update(triangle_surface.keys())

    photo_triangles = set()
    # Projection manifests and older provenance manifests use different names
    # for the same evidence link. Accept both while keeping triangle IDs as the
    # source of truth.
    evidence_items = provenance.get("mappings", [])
    if not evidence_items:
        evidence_items = provenance.get("samples", [])
    for item in evidence_items:
        try:
            photo_triangles.add(int(item["triangleId"]))
        except (KeyError, TypeError, ValueError):
            pass

    gpu_to_plateau = {}
    input_by_mesh = defaultdict(list)
    input_by_mesh_primitive = defaultdict(list)
    input_by_mesh_offset = {}
    for triangle in triangle_input.get("triangles", []):
        input_by_mesh[triangle.get("meshName", "")].append(triangle)
        input_by_mesh_primitive[(int(triangle.get("meshIndex", -1)), int(triangle.get("primitiveId", -1)))].append(triangle)
        input_by_mesh_offset[(int(triangle.get("meshIndex", -1)), int(triangle.get("indexOffset", -3)))] = int(triangle["id"])
    sequential_offset = 0
    all_triangles = triangle_input.get("triangles", [])
    for r in ranges:
        start = int(r["start"])
        count = int(r["count"])
        # PLATEAU triangle input uses source mesh provenance. primitiveId is
        # reused across meshes, so primitiveId alone creates collisions.
        candidates = input_by_mesh_primitive.get((int(r.get("meshIndex", -1)), int(r.get("primitiveId", -1))), [])
        if not candidates:
            candidates = input_by_mesh.get(r.get("meshName", ""), [])
        if not candidates and len(all_triangles) >= sequential_offset + count:
            candidates = all_triangles[sequential_offset:sequential_offset + count]
        sequential_offset += count
        if r.get("sourceTriangles"):
            for local_id, vertices in enumerate(r["sourceTriangles"]):
                matched = input_by_mesh_vertices.get((int(r.get("meshIndex", -1)), tuple(sorted(int(v) for v in vertices))))
                if matched is not None:
                    gpu_to_plateau[start + local_id] = matched
            if len([x for x in range(start, start + count) if x in gpu_to_plateau]) == count:
                continue
        # sourceTriangles is the authoritative render provenance. Remaining
        # fallback matching is intentionally avoided because coordinate-based
        # searches are expensive and can hide provenance mistakes.
        for local_id in range(count):
            # The render pass assigns IDs from the non-indexed geometry triangle
            # order. triangle-input stores the same order with indexOffset.
            matched = input_by_mesh_offset.get((int(r.get("meshIndex", -1)), local_id * 3))
            if matched is not None:
                gpu_to_plateau[start + local_id] = matched
            elif local_id < len(candidates):
                gpu_to_plateau[start + local_id] = int(candidates[local_id]["id"])

    pixels = Path(args.triangle_id).read_bytes()
    if len(pixels) % 4:
        raise ValueError("triangle id buffer is not RGBA8")

    stats = defaultdict(lambda: {"visiblePixels": 0, "photoBackedPixels": 0})
    total = {"visiblePixels": 0, "photoBackedPixels": 0, "unmappedPixels": 0}
    visible_plateau_triangles = set()
    for i in range(0, len(pixels), 4):
        tid = decode_id(pixels[i], pixels[i + 1], pixels[i + 2])
        if tid == 0:
            continue
        plateau_tid = gpu_to_plateau.get(tid)
        if args.wall_filter and plateau_tid not in wall_triangles:
            continue
        if plateau_tid is not None:
            visible_plateau_triangles.add(plateau_tid)
        sid = triangle_surface.get(plateau_tid)
        if sid is None:
            if plateau_tid is not None:
                total["visiblePixels"] += 1
                if plateau_tid in photo_triangles:
                    total["photoBackedPixels"] += 1
            else:
                total["unmappedPixels"] += 1
            continue
        stats[str(sid)]["visiblePixels"] += 1
        total["visiblePixels"] += 1
        if plateau_tid in photo_triangles:
            stats[str(sid)]["photoBackedPixels"] += 1
            total["photoBackedPixels"] += 1

    for value in stats.values():
        value["coverageRatio"] = value["photoBackedPixels"] / value["visiblePixels"] if value["visiblePixels"] else 0

    result = {
        "status": "triangle-id-surface-pixel-audit",
        "debug": {
            "gpuTriangleMappings": len(gpu_to_plateau),
            "surfaceTriangleMappings": len(triangle_surface),
            "photoTriangles": len(photo_triangles),
            "mappedPhotoTriangleOverlap": len(set(gpu_to_plateau.values()) & photo_triangles),
            "visiblePhotoTriangleOverlap": len(visible_plateau_triangles & photo_triangles),
        },
        "total": {
            **total,
            "coverageRatio": total["photoBackedPixels"] / total["visiblePixels"] if total["visiblePixels"] else 0,
        },
        "wallFilter": args.wall_filter,
        "wallTriangleCount": len(wall_triangles),
        "surfaces": [{"surfaceId": k, **v} for k, v in stats.items()],
    }
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps({"status": "ok", "output": args.output, "surfaces": len(stats)}))


if __name__ == "__main__":
    main()
