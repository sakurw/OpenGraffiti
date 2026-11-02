"""Evaluate marginal gain of virtual landmark cameras.

This keeps the selection metric in render-space units. Triangle visibility is
used only to build a candidate pixel set; a candidate is valuable only when it
adds pixels that are currently uncovered.
"""
import argparse
import json
from pathlib import Path


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate_projection")
    parser.add_argument("coverage")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    projection = load_json(args.candidate_projection)
    coverage = load_json(args.coverage)

    # The first version intentionally consumes the existing raster audit
    # contract. A later renderer-backed stage can replace triangle estimates
    # with exact candidate depth-buffer masks without changing the output.
    current = set(coverage.get("photoBackedTriangleIds", []))
    assignment = coverage.get("triangleAssignment", {})
    uncovered = coverage.get("uncoveredVisiblePixels", 0)

    results = []
    for camera in projection.get("cameras", []):
        triangles = set(camera.get("visibleTriangles", []))
        new_triangles = triangles - current
        estimated_pixels = sum(
            assignment.get(str(tid), {}).get("uncoveredPixels", 0)
            for tid in new_triangles
        )
        results.append({
            "candidate": camera.get("sourceId"),
            "visibleTriangles": len(triangles),
            "newTriangles": len(new_triangles),
            "newPhotoBackedPixels": None,
            "estimatedNewPixelsFromTriangleAssignment": estimated_pixels,
            "estimatedGain": len(new_triangles),
            "remainingUncoveredPixels": uncovered,
            "status": "triangle-preselection-only",
        })

    output = {
        "status": "candidate-marginal-gain-evaluation",
        "metric": "new photo-backed visible pixels",
        "cameras": results,
        "note": "Triangle assignment estimate is only a ranking aid. Exact gain requires candidate render depth and pixel mask intersection.",
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"cameras": len(results), "output": args.output}))


if __name__ == "__main__":
    main()
