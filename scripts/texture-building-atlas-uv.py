"""Create triangle atlas UV mappings from packed texture metadata.

The mapping is intentionally explicit: every UV entry keeps the triangle
identity and atlas rectangle so coverage measurement can distinguish real
photo-backed area from missing texture area.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas_metadata")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.atlas_metadata).read_text(encoding="utf-8"))
    width, height = data["atlasSize"]
    mappings = []

    for entry in data.get("entries", []):
        x, y, w, h = entry["atlasRect"]
        mappings.append({
            "triangleId": entry["triangleId"],
            "primitiveId": entry.get("primitiveId"),
            "indexOffset": entry.get("indexOffset"),
            "vertexIds": entry.get("vertexIds"),
            "atlasUV": [
                [x / width, y / height],
                [(x + w) / width, y / height],
                [x / width, (y + h) / height],
            ],
            "qualityScore": entry.get("qualityScore"),
        })

    result = {
        "status": "triangle-atlas-uv-generated",
        "atlasSize": [width, height],
        "triangleCount": len(mappings),
        "mappings": mappings,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
