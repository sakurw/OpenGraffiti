"""Create same-WallSurface texture transfer candidates.

This stage deliberately keeps photo provenance. A triangle can inherit a
texture source only when it belongs to a WallSurface that already has an
observed triangle. The output is a transfer manifest consumed by atlas
generation experiments.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--triangles", required=True)
    parser.add_argument("--surface", required=True)
    parser.add_argument("--photo-fusion", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    surface = json.loads(Path(args.surface).read_text(encoding="utf-8"))
    fusion = json.loads(Path(args.photo_fusion).read_text(encoding="utf-8"))

    # Registry files use generatedTriangleId while older intermediate files
    # used id. Accept both so surface reconstruction can consume the current
    # triangle registry without a destructive conversion step.
    by_id = {
        int(t.get("id", t.get("generatedTriangleId"))): t
        for t in triangles
        if t.get("id", t.get("generatedTriangleId")) is not None
    }
    observed = set(int(k) for k in fusion.get("selected", {}).keys())
    observed.update(int(x["triangleId"]) for x in fusion.get("accepted", []))
    wall_sources = {}
    for tid in observed:
        sem = by_id.get(tid, {}).get("semantic") or {}
        wall = sem.get("wallId")
        if wall is not None:
            wall_sources.setdefault(str(wall), []).append(tid)

    transfers = []
    for item in surface.get("surfaces", []):
        wall = str(item.get("wallId"))
        sources = wall_sources.get(wall, [])
        if not sources:
            continue
        for target in item.get("triangles", []):
            target_id = int(target)
            if target_id in observed:
                continue
            source_id = sources[0]
            transfers.append({
                "targetTriangle": target_id,
                "wallId": wall,
                "sourceTriangles": sources,
                "sourceTriangle": source_id,
                "sourceCenter": by_id.get(source_id, {}).get("center"),
                "targetCenter": by_id.get(target_id, {}).get("center"),
                "method": "same-wall-surface-texture-transfer",
            })

    result = {
        "status": "surface-texture-transfer-candidates",
        "observedTriangleCount": len(observed),
        "transferCandidateCount": len(transfers),
        "transfers": transfers,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: result[k] for k in ["status", "observedTriangleCount", "transferCandidateCount"]}))


if __name__ == "__main__":
    main()
