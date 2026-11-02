"""Select the best validated photo sample per triangle.

Keeps multi-photo fusion conservative: only samples already passing the
projection quality gates are considered. The output is provenance data for
later atlas generation.
"""

import argparse
import json
from pathlib import Path


def score(sample):
    quality = sample.get("qualityScore")
    normal = sample.get("normalQuality")
    if quality is None or normal is None:
        return -1
    # Depth already validates visibility. Keep the angle contribution unsigned
    # because GLB winding can point either side while the visible side is
    # established by the depth test.
    return float(quality) * abs(float(normal))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    selected = {}
    for sample in data.get("accepted", []):
        triangle_id = str(sample.get("triangleId"))
        if score(sample) > score(selected.get(triangle_id, {})):
            selected[triangle_id] = sample

    result = {
        "status": "validated-photo-fusion",
        "selectedTriangles": len(selected),
        "coverageTriangleCount": len(selected),
        "atlasReady": False,
        "reason": "UV packing requires selected source pixels and verified triangle topology",
        "selected": selected,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"selectedTriangles": len(selected)}))


if __name__ == "__main__":
    main()
