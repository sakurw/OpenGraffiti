"""Reconstruct landmark photo surfaces using v4 polygon provenance.

Triangle ids from independent stages are not stable. This stage joins photo
projection triangles through vertex provenance and keeps PLATEAU polygon
domains as the reconstruction boundary.
"""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangles", required=True)
    p.add_argument("--projection", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))["samples"]
    triangles = data["triangles"]
    by_vertices = {tuple(sorted(t["vertexIds"])): t for t in triangles}

    polygons = {}
    polygon_triangles = {}
    for tri in triangles:
        polygon = (tri.get("semantic") or {}).get("polygonId")
        if polygon:
            polygon_triangles.setdefault(polygon, []).append(tri["id"])
    matched = 0
    for sample in projection:
        tri = by_vertices.get(tuple(sorted(sample["vertexIds"])))
        if not tri:
            continue
        matched += 1
        polygon = (tri.get("semantic") or {}).get("polygonId")
        if polygon:
            polygons.setdefault(polygon, []).append(tri["id"])

    # Projection samples are evidence anchors. Expand only inside the same
    # PLATEAU polygon so the texture domain remains tied to source geometry.
    expanded = {
        polygon: polygon_triangles.get(polygon, [])
        for polygon in polygons
    }

    result = {
        "status": "polygon-provenance-reconstruction-generated",
        "projectionCount": len(projection),
        "matchedProjectionCount": matched,
        "polygonCount": len(polygons),
        "triangles": sorted({x for values in expanded.values() for x in values}),
        "polygons": [{"polygonId": k, "triangles": v, "triangleCount": len(v), "observedTriangleCount": len(polygons[k])} for k, v in expanded.items()],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "polygonCount": result["polygonCount"], "triangles": len(result["triangles"])}))


if __name__ == "__main__":
    main()
