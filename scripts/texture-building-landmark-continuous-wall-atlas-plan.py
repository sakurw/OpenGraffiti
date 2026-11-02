"""Create a continuous WallSurface atlas planning manifest.

This stage bridges semantic reconstruction and texture baking. It groups
triangles by WallSurface and prepares a stable surface-level UV domain. The
actual RGB bake remains provenance driven and can consume the source mapping
later.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reconstruction", required=True)
    parser.add_argument("--triangles", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    reconstruction = json.loads(Path(args.reconstruction).read_text(encoding="utf-8"))
    triangle_data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    triangles = {int(t["id"]): t for t in triangle_data["triangles"]}
    vertices = {int(v["id"]): v for v in triangle_data.get("vertices", [])}

    surfaces = []
    for surface in reconstruction.get("surfaces", []):
        wall_id = surface.get("wallId")
        members = [triangles[t] for t in surface.get("triangles", []) if t in triangles]
        if not wall_id or not members:
            continue

        points = []
        for tri in members:
            for vertex_id in tri.get("vertexIds", []):
                vertex = vertices.get(int(vertex_id))
                if vertex and vertex.get("world"):
                    points.append(vertex["world"])

        # Keep enough geometric information for the next stage. The atlas
        # generator can build a local 2D domain from these bounds instead of
        # treating every triangle as an isolated patch.
        if points:
            mins = [min(p[i] for p in points) for i in range(3)]
            maxs = [max(p[i] for p in points) for i in range(3)]
        else:
            mins = maxs = None
        surfaces.append({
            "wallId": wall_id,
            "triangleCount": len(members),
            "triangles": [t["id"] for t in members],
            "vertexCount": len(points),
            "bounds": {"min": mins, "max": maxs},
            "method": "continuous-wall-surface-local-domain",
        })

    result = {
        "status": "continuous-wall-atlas-plan-generated",
        "surfaceCount": len(surfaces),
        "surfaces": surfaces,
        "nextStage": ["wall-plane-coordinate", "photo-raster-selection", "atlas-bake", "uv-apply"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "surfaceCount": len(surfaces)}))


if __name__ == "__main__":
    main()
