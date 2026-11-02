"""Project virtual landmark cameras onto PLATEAU triangles.

This evaluates candidate viewpoints before acquiring real photographs. It keeps
triangle provenance so the later render-space coverage audit can compare the
candidate contribution against the existing photo-backed pixels.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cameras")
    parser.add_argument("triangles")
    parser.add_argument("vertices")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    cameras = json.loads(Path(args.cameras).read_text(encoding="utf-8"))
    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    vertices = json.loads(Path(args.vertices).read_text(encoding="utf-8"))["vertices"]

    points = np.asarray([v["world"] for v in vertices], dtype=np.float64)
    result = []

    for camera in cameras.get("cameras", []):
        k = np.asarray(camera["cameraMatrix"], dtype=np.float64)
        rvec = np.asarray(camera["rotationVector"], dtype=np.float64)
        tvec = np.asarray(camera["translationVector"], dtype=np.float64)
        projected, _ = cv2.projectPoints(points, rvec, tvec, k, None)
        projected = projected.reshape(-1, 2)

        visible = []
        width, height = camera.get("resolution", [1920, 2560])
        for tri in triangles:
            ids = tri.get("vertexIds")
            if not ids or len(ids) != 3:
                continue
            polygon = projected[ids]
            if not np.isfinite(polygon).all():
                continue
            if np.all((polygon[:, 0] < 0) | (polygon[:, 0] >= width) | (polygon[:, 1] < 0) | (polygon[:, 1] >= height)):
                continue
            visible.append(tri["id"])

        result.append({
            "sourceId": camera["sourceId"],
            "visibleTriangleCount": len(visible),
            "visibleTriangles": visible,
            "expectedUncoveredPixels": camera.get("expectedUncoveredPixels", 0),
        })

    output = {
        "status": "virtual-camera-projection-audit",
        "cameras": result,
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"cameras": len(result), "output": args.output}))


if __name__ == "__main__":
    main()
