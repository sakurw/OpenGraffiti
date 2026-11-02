"""Classify uncovered visible landmark facade triangles.

Consumes triangleAssignment from render-space coverage and groups missing
pixels by facade direction. This is used to select additional photo viewpoints.
"""
import argparse
import json
from pathlib import Path
from collections import defaultdict


def direction(normal):
    if not normal:
        return "unknown"
    x, _, z = normal
    if abs(x) >= abs(z):
        return "x+" if x >= 0 else "x-"
    return "z+" if z >= 0 else "z-"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--coverage", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.coverage).read_text(encoding="utf-8"))
    groups = defaultdict(lambda: {"uncoveredPixels": 0, "triangles": []})
    for triangle_id, value in data.get("triangleAssignment", {}).items():
        missing = int(value.get("uncoveredPixels", 0))
        if missing <= 0:
            continue
        key = direction(value.get("normal"))
        groups[key]["uncoveredPixels"] += missing
        groups[key]["triangles"].append(int(triangle_id))

    result = {
        "status": "uncovered-surface-classification",
        "sourceCoverage": args.coverage,
        "uncoveredPixels": int(data.get("uncoveredVisiblePixels", 0)),
        "directions": dict(groups),
        "nextAction": "generate additional camera candidates for highest uncovered direction",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
