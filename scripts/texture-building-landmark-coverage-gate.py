"""Apply conservative landmark photo coverage gates.

Keeps projected triangles separate from measured texture coverage. A triangle
is accepted only when it is in the visible facade area set and has enough
photo support for later fusion.
"""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("projection")
    p.add_argument("visible_area")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    projection = json.loads(Path(args.projection).read_text(encoding="utf-8"))
    visible = json.loads(Path(args.visible_area).read_text(encoding="utf-8")).get("visibleTriangleAreas", {})

    accepted = []
    for sample in projection.get("samples", []):
        triangle_id = str(sample.get("triangleId"))
        if triangle_id not in visible:
            continue
        if float(visible[triangle_id]) <= 0:
            continue
        accepted.append({
            "triangleId": triangle_id,
            "sourceId": sample.get("sourceId"),
            "photoPolygon": sample.get("photoPolygon"),
            "surfaceArea": float(visible[triangle_id]),
        })

    result = {
        "status": "landmark-photo-coverage-gated",
        "projectedTriangleCount": projection.get("projectedTriangleCount", 0),
        "acceptedTriangleCount": len(accepted),
        "accepted": accepted,
        "coverageReady": False,
        "requires": ["depth-raster-validation", "photo-fusion", "area-measurement"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"acceptedTriangleCount": len(accepted)}))


if __name__ == "__main__":
    main()
