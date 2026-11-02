"""Measure candidate photo-backed triangles directly in final triangle-id pixels.

This avoids world-position reprojection. The final render is the authority:
pixel -> rendered triangle id -> candidate photo-backed triangle set.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def decode_ids(path):
    data = np.frombuffer(Path(path).read_bytes(), dtype=np.uint8)
    data = data.reshape((-1, 4))
    return data[:, 0].astype(np.int64) * 65536 + data[:, 1].astype(np.int64) * 256 + data[:, 2].astype(np.int64)


def build_mapping(ranges, triangles, vertices):
    canonical = {}
    vertex_world = {int(v["id"]): v["world"] for v in vertices}
    world_key_index = {}
    for t in triangles:
        key = (int(t["meshIndex"]), int(t["primitiveId"]), tuple(sorted(int(v) for v in t["vertexIds"])))
        canonical[key] = int(t["id"])
        points = tuple(sorted(tuple(round(float(x), 3) for x in vertex_world[int(v)]) for v in t["vertexIds"]))
        world_key_index[(int(t["meshIndex"]), int(t["primitiveId"]), points)] = int(t["id"])
    mapping = {}
    for r in ranges:
        start = int(r["start"])
        for i, source in enumerate(r.get("sourceTriangles", [])):
            key = (int(r["meshIndex"]), int(r["primitiveId"]), tuple(sorted(int(v) for v in source)))
            if key in canonical:
                mapping[start + i] = canonical[key]
            elif r.get("triangleVertices") and i < len(r["triangleVertices"]):
                rv = tuple(sorted(tuple(round(float(x), 3) for x in p) for p in r["triangleVertices"][i]))
                resolved = world_key_index.get((int(r["meshIndex"]), int(r["primitiveId"]), rv))
                if resolved is not None:
                    mapping[start + i] = resolved
    return mapping


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangle-id", required=True)
    p.add_argument("--ranges", required=True)
    p.add_argument("--triangles", default="data/texture-city/triangle-input-145064071-semantic-v4.json")
    p.add_argument("--canonical-map")
    p.add_argument("--candidates", nargs="+", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    ids = decode_ids(args.triangle_id)
    triangle_data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    if args.canonical_map:
        canonical = json.loads(Path(args.canonical_map).read_text(encoding="utf-8"))
        mapping = {}
        for entry in canonical.get("entries", []):
            ids_for_triangle = entry.get("semanticTriangleIds", [])
            if ids_for_triangle:
                mapping[int(entry["renderTriangleId"])] = int(ids_for_triangle[0])
    else:
        mapping = build_mapping(json.loads(Path(args.ranges).read_text(encoding="utf-8")), triangle_data["triangles"], triangle_data["vertices"])

    union = np.zeros(ids.shape[0], dtype=bool)
    rows = []
    for candidate_path in args.candidates:
        candidate = json.loads(Path(candidate_path).read_text(encoding="utf-8"))
        triangles = {
            int(x) for x in candidate.get("triangleIds", [])
        }
        mask = np.zeros(ids.shape[0], dtype=bool)
        for index, render_id in enumerate(ids):
            triangle = mapping.get(int(render_id))
            if triangle in triangles:
                mask[index] = True
        union |= mask
        rows.append({"candidate": candidate_path, "pixels": int(mask.sum())})

    result = {
        "status": "candidate-triangle-id-pixel-union",
        "photoBackedPixels": int(union.sum()),
        "visiblePixels": int(np.count_nonzero(ids)),
        "coverageRatio": float(union.sum() / max(1, np.count_nonzero(ids))),
        "candidates": rows,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
