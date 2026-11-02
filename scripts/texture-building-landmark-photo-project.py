"""Project a calibrated landmark photograph onto PLATEAU triangles.

This connects the landmark camera calibration stage with triangle coverage
measurement. It emits provenance samples only; coverage is measured by the
existing area accumulator after quality and visibility gates.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("triangles")
    p.add_argument("--vertices", required=True)
    p.add_argument("--camera", required=True)
    p.add_argument("--photo", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    vertices = json.loads(Path(args.vertices).read_text(encoding="utf-8"))["vertices"]
    camera = json.loads(Path(args.camera).read_text(encoding="utf-8"))
    image = cv2.imread(args.photo)
    if image is None:
        raise RuntimeError("photo not found")

    k = np.asarray(camera["cameraMatrix"], dtype=np.float64)
    dist = np.asarray(camera.get("distortionCoefficients", []), dtype=np.float64)
    rvec = np.asarray(camera["rotationVector"], dtype=np.float64)
    tvec = np.asarray(camera["translationVector"], dtype=np.float64)

    points = np.asarray([v["world"] for v in vertices], dtype=np.float64)
    projected, _ = cv2.projectPoints(points, rvec, tvec, k, dist)
    projected = projected.reshape(-1, 2)

    # Reject invalid camera projections before depth/coverage stages. A single
    # unstable triangle can otherwise poison rasterization with huge values.
    valid_projection = np.isfinite(projected).all(axis=1)
    image_height, image_width = image.shape[:2]
    valid_projection &= np.abs(projected[:, 0]) < image_width * 10
    valid_projection &= np.abs(projected[:, 1]) < image_height * 10

    samples = []
    for tri in triangles:
        ids = tri.get("vertexIds")
        if not ids or len(ids) != 3:
            continue
        if not all(valid_projection[index] for index in ids):
            continue
        px = projected[ids]
        # Affine baking needs a valid source triangle. Partially visible
        # triangles with projected vertices far outside the image produce
        # mostly black warpAffine results and corrupt the atlas.
        if np.any(px[:, 0] < 0) or np.any(px[:, 0] >= image.shape[1]) or np.any(px[:, 1] < 0) or np.any(px[:, 1] >= image.shape[0]):
            continue
        samples.append({
            "triangleId": tri.get("id"),
            "vertexIds": ids,
            "photoPolygon": px.tolist(),
            "sourceId": camera.get("sourceId"),
        })

    result = {
        "status": "landmark-photo-projection-candidate",
        "sourceId": camera.get("sourceId"),
        "projectedTriangleCount": len(samples),
        "requiresDepthGate": True,
        "requiresAreaCoverage": True,
        "samples": samples,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"projectedTriangleCount": len(samples)}))


if __name__ == "__main__":
    main()
