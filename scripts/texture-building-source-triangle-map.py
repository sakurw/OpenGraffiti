"""Generate source-photo pixel to PLATEAU triangle provenance.

This converts a validated photo projection candidate into measurable evidence
for later atlas creation. Every accepted sample keeps the triangle identity and
source pixel coordinate so coverage can be computed from surface area.
"""

import argparse
import json
from pathlib import Path


def barycentric(p, a, b, c):
    det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(det) < 1e-8:
        return None
    w0 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det
    w1 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det
    w2 = 1 - w0 - w1
    return w0, w1, w2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangles")
    parser.add_argument("--photo-width", type=int, required=True)
    parser.add_argument("--photo-height", type=int, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--step", type=int, default=8)
    args = parser.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    mappings = []
    for triangle in data.get("triangles", []):
        screen = triangle.get("screen")
        if not screen or len(screen) != 3:
            continue
        min_x = max(0, int(min(v[0] for v in screen)))
        max_x = min(args.photo_width - 1, int(max(v[0] for v in screen)))
        min_y = max(0, int(min(v[1] for v in screen)))
        max_y = min(args.photo_height - 1, int(max(v[1] for v in screen)))

        for y in range(min_y, max_y + 1, args.step):
            for x in range(min_x, max_x + 1, args.step):
                point = [x + 0.5, y + 0.5]
                weights = barycentric(point, screen[0], screen[1], screen[2])
                if weights is None or min(weights) < 0:
                    continue
                mappings.append({
                    "triangleId": triangle.get("id"),
                    "primitiveId": triangle.get("primitiveId"),
                    "indexOffset": triangle.get("indexOffset"),
                    "vertexIds": triangle.get("vertexIds"),
                    "sourcePixel": point,
                    "barycentric": weights,
                    "qualityScore": None,
                    "requiresDepthValidation": True,
                    "requiresNormalValidation": True,
                })

    result = {
        "status": "source-pixel-triangle-mapping",
        "mappedSamples": len(mappings),
        "photoSize": [args.photo_width, args.photo_height],
        "measuredCoverage": False,
        "sampleStep": args.step,
        "reason": "samples require depth, normal and photo quality validation before area coverage",
        "mappings": mappings,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "mappedSamples": len(mappings)}))


if __name__ == "__main__":
    main()
