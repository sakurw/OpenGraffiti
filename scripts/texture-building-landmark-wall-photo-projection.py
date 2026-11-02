"""Project photo samples into continuous WallSurface coordinates.

Keeps triangle provenance while converting the target representation from
isolated triangle patches to a shared wall local coordinate domain.
"""

import argparse
import json
import math
from pathlib import Path


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def project_point(point, origin, axis_u, axis_v):
    delta = [point[i] - origin[i] for i in range(3)]
    return [dot(delta, axis_u), dot(delta, axis_v)]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--plane", required=True)
    p.add_argument("--projection", required=True)
    p.add_argument("--triangles", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    plane = json.loads(Path(args.plane).read_text(encoding="utf-8"))
    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    triangle_data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    triangles = {int(t["id"]): t for t in triangle_data["triangles"]}
    vertices = {int(v["id"]): v["world"] for v in triangle_data.get("vertices", [])}

    wall_by_triangle = {}
    domains = {}
    for surface in plane["surfaces"]:
        domains[str(surface["wallId"])] = surface
        for tid in surface["triangles"]:
            wall_by_triangle[int(tid)] = str(surface["wallId"])

    samples = []
    for sample in projection.get("samples", []):
        tid = int(sample["triangleId"])
        wall = wall_by_triangle.get(tid)
        if wall is None:
            continue
        surface = domains[wall]
        tri = triangles.get(tid)
        if tri is None:
            continue
        local_polygon = []
        for vertex_id in tri.get("vertexIds", []):
            point = vertices.get(int(vertex_id))
            if point is not None:
                local_polygon.append(project_point(
                    point,
                    surface["origin"],
                    surface["axisU"],
                    surface["axisV"],
                ))
        samples.append({
            "triangleId": tid,
            "meshIndex": tri.get("meshIndex"),
            "primitiveId": tri.get("primitiveId"),
            "indexOffset": tri.get("indexOffset"),
            "wallId": wall,
            "sourceId": sample.get("sourceId"),
            "photoPolygon": sample.get("photoPolygon"),
            "planeOrigin": surface["origin"],
            "planeAxisU": surface["axisU"],
            "planeAxisV": surface["axisV"],
            "wallLocalPolygon": local_polygon,
            "method": "photo-to-wall-local-domain",
        })

    result = {
        "status": "wall-photo-projection-generated",
        "sampleCount": len(samples),
        "samples": samples,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "sampleCount": len(samples)}))


if __name__ == "__main__":
    main()
