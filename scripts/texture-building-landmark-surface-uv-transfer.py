"""Generate planar WallSurface texture transfer coordinates.

The input remains provenance based: target triangles receive coordinates only
when they share a WallSurface with an observed triangle. This prepares the
actual raster/atlas transfer stage without claiming texture coverage.
"""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--triangles", required=True)
    p.add_argument("--transfer", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    triangles = {int(t["id"]): t for t in data["triangles"]}
    transfer = json.loads(Path(args.transfer).read_text(encoding="utf-8"))

    result = []
    for item in transfer.get("transfers", []):
        source = triangles.get(int(item["sourceTriangle"]))
        target = triangles.get(int(item["targetTriangle"]))
        if not source or not target:
            continue

        source_center = source.get("center")
        target_center = target.get("center")
        if not source_center or not target_center:
            continue

        result.append({
            "targetTriangle": int(item["targetTriangle"]),
            "sourceTriangle": int(item["sourceTriangle"]),
            "wallId": item["wallId"],
            "sourceCenter": source_center,
            "targetCenter": target_center,
            "delta": [
                target_center[i] - source_center[i] for i in range(min(len(target_center), len(source_center)))
            ],
            "method": "wall-surface-planar-coordinate-transfer",
        })

    output = {
        "status": "surface-planar-transfer-coordinate-candidates",
        "candidateCount": len(result),
        "candidates": result,
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"status": output["status"], "candidateCount": len(result)}))


if __name__ == "__main__":
    main()
