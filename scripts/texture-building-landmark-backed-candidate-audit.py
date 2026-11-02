"""Audit candidate views against existing photo-backed triangle provenance.

Keeps the candidate contribution restricted to triangles already backed by
registered photographic texture provenance. It is an intermediate audit for
render-space evaluation.
"""
import json
from pathlib import Path


def main():
    root = Path("data/texture-city")
    backed = {
        int(x["triangleId"])
        for x in json.loads((root / "landmark-atlas-uv-v6-current.json").read_text(encoding="utf-8"))["mappings"]
        if str(x.get("triangleId", "")).isdigit()
    }
    cameras = json.loads((root / "virtual-camera-projection-audit-v2-145064071.json").read_text(encoding="utf-8"))["cameras"]
    rows = []
    for camera in cameras:
        visible = {int(t) for t in camera["visibleTriangles"]}
        rows.append({
            "sourceId": camera["sourceId"],
            "visibleTriangles": len(visible),
            "backedVisibleTriangles": len(visible & backed),
        })
    out = root / "virtual-camera-backed-triangle-audit-v2-145064071.json"
    out.write_text(json.dumps({"backedTriangleCount": len(backed), "cameras": rows}, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(out), "backedTriangleCount": len(backed)}))


if __name__ == "__main__":
    main()
