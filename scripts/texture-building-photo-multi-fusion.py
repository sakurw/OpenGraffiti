"""Merge validated photo projection outputs before atlas generation.

Each input is expected to be produced by texture-building-photo-projector.py.
The best sample per triangle is selected across all registered photos while
preserving source provenance.
"""

import argparse
import json
from pathlib import Path


def score(sample):
    quality = sample.get("qualityScore")
    normal = sample.get("normalQuality")
    if quality is None or normal is None:
        return -1
    return float(quality) * abs(float(normal))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples", nargs="+")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    selected = {}
    source_counts = {}

    for sample_path in args.samples:
        data = json.loads(Path(sample_path).read_text(encoding="utf-8"))
        source_counts[str(sample_path)] = len(data.get("accepted", []))
        for sample in data.get("accepted", []):
            triangle_id = str(sample.get("triangleId"))
            sample["sourceProjection"] = str(sample_path)
            if score(sample) > score(selected.get(triangle_id, {})):
                selected[triangle_id] = sample

    result = {
        "status": "multi-photo-fusion",
        "selectedTriangles": len(selected),
        "sourceProjectionAcceptedSamples": source_counts,
        "atlasReady": False,
        "selected": selected,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"selectedTriangles": len(selected)}))


if __name__ == "__main__":
    main()
