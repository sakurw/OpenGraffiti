"""Generate additional landmark photo viewpoints from uncovered facade pixels.

This is the first stage of the coverage acquisition loop. It converts render
space uncovered triangles into camera candidates. Candidate scoring is kept
separate because the real gain must be measured by the existing depth and
render audit pipeline.
"""
import argparse
import json
from pathlib import Path
from collections import defaultdict
import numpy as np


def normalize(v):
    a = np.asarray(v, dtype=float)
    n = np.linalg.norm(a)
    return a / n if n else np.zeros(3)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--coverage", required=True)
    p.add_argument("--triangles", default="data/texture-city/triangle-input-145064071-semantic-v4.json")
    p.add_argument("--output", required=True)
    p.add_argument("--distance", type=float, default=80.0)
    p.add_argument("--count", type=int, default=12)
    args = p.parse_args()

    data = json.loads(Path(args.coverage).read_text(encoding="utf-8"))
    triangle_data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    triangle_by_id = {int(t["id"]): t for t in triangle_data.get("triangles", [])}
    vertices = {int(v["id"]): v["world"] for v in triangle_data.get("vertices", [])}
    patches = defaultdict(list)

    for tid, value in data.get("triangleAssignment", {}).items():
        if int(value.get("uncoveredPixels", 0)) <= 0:
            continue
        normal = normalize(value.get("normal", [0, 0, 0]))
        # Group only by dominant facade direction. The render audit remains the
        # authority for the final pixel gain.
        key = tuple(np.round(normal, 1))
        triangle = triangle_by_id.get(int(tid), {})
        center = triangle.get("worldCenter")
        if center is None and triangle.get("vertexIds"):
            points = [vertices.get(int(v)) for v in triangle["vertexIds"]]
            points = [p for p in points if p]
            if points:
                center = [sum(p[i] for p in points) / len(points) for i in range(3)]
        patches[key].append((int(tid), int(value["uncoveredPixels"]), center))

    candidates = []
    for normal_key, triangles in sorted(
        patches.items(), key=lambda x: sum(v for _, v, _ in x[1]), reverse=True
    )[: args.count]:
        normal = normalize(normal_key)
        weight = sum(v for _, v, _ in triangles)
        centers = [c for _, _, c in triangles if c]
        center = [sum(c[i] for c in centers) / len(centers) for i in range(3)] if centers else None
        candidates.append(
            {
                "direction": normal.tolist(),
                "recommendedCameraOffset": (normal * args.distance).tolist(),
                "targetSurfaceCenter": center,
                "expectedUncoveredPixels": weight,
                "triangleIds": [t for t, _, _ in triangles],
            }
        )

    result = {
        "status": "landmark-camera-candidates",
        "sourceCoverage": args.coverage,
        "candidateCount": len(candidates),
        "candidates": candidates,
        "next": "validate candidates through depth and render-space coverage audit",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
