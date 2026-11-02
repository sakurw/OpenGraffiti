"""Convert surface transfer atlas metadata into apply-atlas UV mappings.

The transfer atlas stores WallSurface provenance. This step restores the GLB
triangle identity from the triangle provenance export before applying the
texture, so the final GLB keeps the same audit path as the direct projection
pipeline.
"""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("atlas_metadata")
    p.add_argument("triangles")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    atlas = json.loads(Path(args.atlas_metadata).read_text(encoding="utf-8"))
    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    by_id = {int(t["id"]): t for t in triangles}

    width, height = atlas["atlasSize"]
    mappings = []
    skipped = 0
    for entry in atlas.get("entries", []):
        tri = by_id.get(int(entry["triangleId"]))
        if tri is None:
            skipped += 1
            continue
        x, y, w, h = entry["atlasRect"]
        mappings.append({
            "triangleId": int(entry["triangleId"]),
            "primitiveId": tri["primitiveId"],
            "indexOffset": tri["indexOffset"],
            "vertexIds": tri.get("vertexIds"),
            "atlasUV": [
                [x / width, y / height],
                [(x + w) / width, y / height],
                [x / width, (y + h) / height],
            ],
            "wallId": entry.get("wallId"),
            "sourceTriangle": entry.get("sourceTriangle"),
            "qualityScore": "surface-transfer",
        })

    out = {
        "status": "surface-transfer-atlas-uv-generated",
        "atlasSize": [width, height],
        "triangleCount": len(mappings),
        "skipped": skipped,
        "mappings": mappings,
    }
    Path(args.output).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps({"status": out["status"], "triangleCount": len(mappings), "skipped": skipped}))


if __name__ == "__main__":
    main()
