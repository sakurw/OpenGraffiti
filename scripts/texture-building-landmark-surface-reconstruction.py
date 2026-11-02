"""Reconstruct texture support inside a PLATEAU WallSurface.

This stage expands photo evidence only through the same semantic surface. It
keeps the provenance of the observed triangles and creates a reconstruction
manifest for atlas generation.
"""

import argparse
import json
from pathlib import Path


def project_surface_coordinate(point, origin, u, v):
    return [
        sum((point[i] - origin[i]) * u[i] for i in range(3)),
        sum((point[i] - origin[i]) * v[i] for i in range(3)),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--triangles", required=True)
    parser.add_argument("--fusion", required=True)
    parser.add_argument("--surface-input")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    fusion = json.loads(Path(args.fusion).read_text(encoding="utf-8"))
    by_id = {int(t["id"]): t for t in triangles}

    seeds = set()
    for item in fusion.get("accepted", []):
        seeds.add(int(item["triangleId"]))

    surfaces = {}
    for t in triangles:
        sem = t.get("semantic") or {}
        wall = sem.get("wallId")
        if wall is not None:
            surfaces.setdefault(str(wall), []).append(int(t["id"]))

    reconstructed = set(seeds)
    records = []
    processed_walls = set()
    for seed in sorted(seeds):
        sem = by_id.get(seed, {}).get("semantic") or {}
        wall = sem.get("wallId")
        if wall in processed_walls:
            continue
        processed_walls.add(wall)
        members = surfaces.get(str(wall), [])
        reconstructed.update(members)
        records.append({
            "seedTriangle": seed,
            "wallId": wall,
            "expandedTriangleCount": len(members),
            "triangles": members,
            "method": "same-wall-surface-planar-reconstruction",
        })

    result = {
        "status": "surface-texture-reconstruction-manifest",
        "seedCount": len(seeds),
        "reconstructedTriangleCount": len(reconstructed),
        "surfaceCount": len(records),
        "triangles": sorted(reconstructed),
        "surfaces": records,
    }

    # Keep the output extensible for later atlas rebuilding. The actual texture
    # transfer stage can use this list to fill only the same WallSurface.
    if args.surface_input:
        surface_data = json.loads(Path(args.surface_input).read_text(encoding="utf-8"))
        result["surfaceCoordinates"] = surface_data

    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ["status", "seedCount", "reconstructedTriangleCount", "surfaceCount"]}))


if __name__ == "__main__":
    main()
