"""Generate continuous local 2D coordinates for WallSurface domains.

The output is a geometry-only stage. It preserves triangle provenance while
creating a stable plane coordinate system used by later photo baking stages.
"""

import argparse
import json
import math
from pathlib import Path


def normalize(v):
    length = math.sqrt(sum(x * x for x in v))
    return [x / length for x in v] if length else [0, 0, 0]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--triangles", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    vertices = {int(v["id"]): v["world"] for v in data.get("vertices", [])}
    triangles = {int(t["id"]): t for t in data["triangles"]}

    surfaces = []
    for surface in plan.get("surfaces", []):
        points = []
        for tid in surface.get("triangles", []):
            for vid in triangles[int(tid)].get("vertexIds", []):
                if int(vid) in vertices:
                    points.append(vertices[int(vid)])
        if len(points) < 3:
            continue

        origin = points[0]
        u = normalize([points[1][i] - origin[i] for i in range(3)])
        normal = normalize([
            u[1] * (points[2][2] - origin[2]) - u[2] * (points[2][1] - origin[1]),
            u[2] * (points[2][0] - origin[0]) - u[0] * (points[2][2] - origin[2]),
            u[0] * (points[2][1] - origin[1]) - u[1] * (points[2][0] - origin[0]),
        ])
        v = normalize([
            normal[1] * u[2] - normal[2] * u[1],
            normal[2] * u[0] - normal[0] * u[2],
            normal[0] * u[1] - normal[1] * u[0],
        ])

        surfaces.append({
            "wallId": surface["wallId"],
            "triangles": surface["triangles"],
            "origin": origin,
            "axisU": u,
            "axisV": v,
            "normal": normal,
            "method": "wall-surface-planar-local-coordinate",
        })

    result = {
        "status": "wall-plane-coordinate-generated",
        "surfaceCount": len(surfaces),
        "surfaces": surfaces,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "surfaceCount": len(surfaces)}))


if __name__ == "__main__":
    main()
