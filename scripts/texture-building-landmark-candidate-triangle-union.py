"""Evaluate candidate photo support through triangle provenance.

This keeps triangle IDs as the shared key between candidate views and the final
render. Pixel coverage must still be measured by the final triangle-id render.
"""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--projections", nargs="+", required=True)
    p.add_argument("--photo-provenance", help="JSON provenance containing mappings or samples with real photo support")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    union = set()
    backed = None
    if args.photo_provenance:
        provenance = json.loads(Path(args.photo_provenance).read_text(encoding="utf-8"))
        items = provenance.get("mappings", []) or provenance.get("samples", []) or provenance.get("accepted", [])
        backed = {int(x["triangleId"]) for x in items if x.get("triangleId") is not None}
    rows = []
    for path in args.projections:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        triangles = {int(x["triangleId"]) for x in data.get("samples", []) if "triangleId" in x}
        if backed is not None:
            triangles &= backed
        union |= triangles
        rows.append({"projection": path, "photoBackedTriangles": len(triangles)})

    result = {
        "status": "candidate-triangle-provenance-union",
        "photoBackedTriangleCount": len(union),
        "cameras": rows,
        "triangleIds": sorted(union),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"photoBackedTriangleCount": len(union)}))


if __name__ == "__main__":
    main()
