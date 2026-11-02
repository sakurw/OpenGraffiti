"""Jointly refine landmark photo cameras from manually registered controls.

Optimizes camera intrinsics, distortion and per-photo pose using scipy least
squares. The result remains a candidate calibration and must pass projection
and texture coverage validation before use.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
try:
    from scipy.optimize import least_squares
except ImportError:
    least_squares = None


def unpack_camera(x, offset, width, height):
    focal = np.exp(x[offset])
    cx = x[offset + 1]
    cy = x[offset + 2]
    dist = x[offset + 3:offset + 5]
    rvec = x[offset + 5:offset + 8]
    tvec = x[offset + 8:offset + 11]
    return (
        np.array([[focal, 0, cx], [0, focal, cy], [0, 0, 1]], dtype=np.float64),
        dist.reshape(2, 1), rvec, tvec,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    photos = []
    values = []
    seen_source_ids = set()
    for item in data["inputs"]:
        if item["sourceId"] in seen_source_ids:
            continue
        controls = [c for c in item["controls"] if c.get("role") != "held-out"]
        if len(controls) < 6:
            continue
        image = cv2.imread(item["photo"])
        if image is None:
            continue
        h, w = image.shape[:2]
        world = np.asarray([c["world"] for c in controls], np.float64)
        pixels = np.asarray([c["pixel"] for c in controls], np.float64)
        k = np.array([[w, 0, w / 2], [0, w, h / 2], [0, 0, 1]], np.float64)
        ok, rvec, tvec = cv2.solvePnP(world, pixels, k, None, flags=cv2.SOLVEPNP_SQPNP)
        if not ok:
            continue
        photos.append({"item": item, "world": world, "pixels": pixels, "size": [w, h]})
        seen_source_ids.add(item["sourceId"])
        values.extend([np.log(k[0, 0]), w / 2, h / 2, 0, 0, *rvec.reshape(3), *tvec.reshape(3)])

    if not photos:
        raise RuntimeError("no calibratable photos")

    def residual(x):
        out = []
        for i, photo in enumerate(photos):
            k, dist, rvec, tvec = unpack_camera(x, i * 11, *photo["size"])
            projected, _ = cv2.projectPoints(photo["world"], rvec, tvec, k, dist)
            out.extend((projected.reshape(-1, 2) - photo["pixels"]).reshape(-1))
        return np.asarray(out)

    if least_squares is None:
        # OpenCV is already a dependency of the texture pipeline. Keep a
        # deterministic fallback for environments without scipy.
        cameras = []
        errors = []
        for photo in photos:
            w, h = photo["size"]
            k = np.array([[w, 0, w / 2], [0, w, h / 2], [0, 0, 1]], np.float64)
            ok, rvec, tvec = cv2.solvePnP(photo["world"], photo["pixels"], k, None, flags=cv2.SOLVEPNP_SQPNP)
            if not ok:
                continue
            projected, _ = cv2.projectPoints(photo["world"], rvec, tvec, k, None)
            errors.extend(np.linalg.norm(projected.reshape(-1, 2) - photo["pixels"], axis=1))
            cameras.append({"sourceId": photo["item"]["sourceId"], "cameraMatrix": k.tolist(), "distortionCoefficients": [0, 0], "rotationVector": rvec.reshape(3).tolist(), "translationVector": tvec.reshape(3).tolist()})
        result = {"status": "candidate-bundle-adjustment-fallback", "method": "sqpnp-without-scipy", "photoCount": len(cameras), "finalRmsPixels": float(np.sqrt(np.mean(np.square(errors)))), "cameras": cameras, "validationRequired": ["held-out-controls", "projection-audit", "texture-coverage"]}
        Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
        return

    solved = least_squares(residual, np.asarray(values), loss="soft_l1", f_scale=2.0, max_nfev=2000)
    cameras = []
    for i, photo in enumerate(photos):
        k, dist, rvec, tvec = unpack_camera(solved.x, i * 11, *photo["size"])
        cameras.append({
            "sourceId": photo["item"]["sourceId"],
            "cameraMatrix": k.tolist(),
            "distortionCoefficients": dist.reshape(-1).tolist(),
            "rotationVector": rvec.tolist(),
            "translationVector": tvec.tolist(),
        })
    result = {
        "status": "candidate-bundle-adjusted-camera-set",
        "method": "joint-landmark-bundle-adjustment",
        "photoCount": len(cameras),
        "finalRmsPixels": float(np.sqrt(np.mean(np.square(residual(solved.x))))),
        "cameras": cameras,
        "validationRequired": ["held-out-controls", "projection-audit", "texture-coverage"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
