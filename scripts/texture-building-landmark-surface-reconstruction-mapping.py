"""Expand landmark wall atlas mappings from seed triangles to reconstructed surfaces."""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--atlas", required=True)
    p.add_argument("--reconstruction", required=True)
    p.add_argument("--triangles", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--size", type=int, default=4096)
    args = p.parse_args()

    atlas = json.loads(Path(args.atlas).read_text(encoding="utf-8"))
    reconstruction = json.loads(Path(args.reconstruction).read_text(encoding="utf-8"))
    triangles = {int(t["id"]): t for t in json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]}

    seed_to_uv = {}
    wall_to_uv = {}
    for r in atlas.get("records", []):
        if r.get("atlasUV"):
            uv = r["atlasUV"]
        else:
            x, y = r["atlasOrigin"]
            uv = [[x / args.size, y / args.size], [(x + 64) / args.size, y / args.size], [x / args.size, (y + 64) / args.size]]
        value = {
            "sourceId": r.get("sourceId"),
            "atlasUV": uv,
        }
        seed_to_uv[int(r["triangleId"])] = value
        if r.get("wallId"):
            wall_to_uv[r["wallId"]] = value

    mappings = []
    for surface in reconstruction.get("surfaces", []):
        seeds = [int(x) for x in surface.get("triangles", []) if int(x) in seed_to_uv]
        base = seed_to_uv[seeds[0]] if seeds else wall_to_uv.get(surface.get("wallId"))
        if not base:
            continue
        for tid in surface.get("triangles", []):
            tri = triangles.get(int(tid))
            if not tri:
                continue
            mappings.append({
                "triangleId": str(tid),
                "primitiveId": tri.get("primitiveId"),
                "indexOffset": tri.get("indexOffset"),
                "vertexIds": tri.get("vertexIds"),
                "sourceId": base["sourceId"],
                "atlasUV": base["atlasUV"],
            })

    Path(args.output).write_text(json.dumps({"status": "surface-reconstruction-mapping-generated", "mappings": mappings}, indent=2), encoding="utf-8")
    print(json.dumps({"status": "surface-reconstruction-mapping-generated", "mappingCount": len(mappings)}))


if __name__ == "__main__":
    main()
