"""Expand photo-backed polygon anchors into connected v4 facade triangles."""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangles", required=True)
    p.add_argument("--projection", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))["samples"]

    by_vertices = {tuple(sorted(t["vertexIds"])): t for t in triangles}
    selected = set()
    for sample in projection:
        tri = by_vertices.get(tuple(sorted(sample["vertexIds"])))
        if tri:
            selected.add(tri["id"])

    by_id = {t["id"]: t for t in triangles}
    by_polygon = {}
    for t in triangles:
        polygon = (t.get("semantic") or {}).get("polygonId")
        if polygon:
            by_polygon.setdefault(polygon, set()).add(t["id"])

    expanded = set()
    for tid in selected:
        polygon = (by_id[tid].get("semantic") or {}).get("polygonId")
        if polygon:
            expanded.update(by_polygon[polygon])

    result = {
        "status": "polygon-adjacency-expanded",
        "photoTriangleCount": len(selected),
        "expandedTriangleCount": len(expanded),
        "triangles": sorted(expanded),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
