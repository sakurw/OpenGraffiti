"""Estimate a building photo camera pose against PLATEAU geometry.

This creates candidate poses only. A pose must pass the existing validation
pipeline before it can be used for texture projection.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("case")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    case = load(args.case)
    points = np.asarray(case["worldPoints"], np.float64)
    pixels = np.asarray(case["imagePoints"], np.float64)
    w, h = case["referenceSize"]

    candidates = []
    for focal in np.geomspace(w * 0.5, w * 5, 80):
        camera = np.array([[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], np.float64)
        ok, rvec, tvec = cv2.solvePnP(
            points, pixels, camera, None, flags=cv2.SOLVEPNP_SQPNP
        )
        if not ok:
            continue
        rmat = cv2.Rodrigues(rvec)[0]
        depth = (rmat @ points.T + tvec).T[:, 2]
        if np.min(depth) <= 0:
            continue
        projected = cv2.projectPoints(points, rvec, tvec, camera, None)[0].reshape(-1, 2)
        rms = float(np.sqrt(np.mean(np.sum((projected - pixels) ** 2, axis=1))))
        position = (-(rmat.T @ tvec).reshape(3)).tolist()
        candidates.append({
            "focalPixels": float(focal),
            "cameraPosition": position,
            "rotationVector": rvec.reshape(3).tolist(),
            "translationVector": tvec.reshape(3).tolist(),
            "rmsPixels": rms,
        })

    candidates.sort(key=lambda x: x["rmsPixels"])
    result = {
        "sourceCase": args.case,
        "method": "plateau-geometry-pnp-sqpnp",
        "status": "candidate-only",
        "candidates": candidates[:20],
        "validationRequired": ["held-out-controls", "visibility", "occlusion"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "candidates": len(candidates)}))


if __name__ == "__main__":
    main()
