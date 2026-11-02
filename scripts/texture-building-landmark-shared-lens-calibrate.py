"""Estimate a shared landmark-photo lens model from multiple registrations.

The single-photo calibrator can overfit sparse control points. This stage
uses all available photos to estimate common intrinsics, then reports each
photo's pose residual separately. The result remains a candidate until the
projection and coverage audits pass.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    all_world = []
    all_pixels = []
    image_size = None
    entries = []

    for item in data["inputs"]:
        controls = [c for c in item["controls"] if c.get("role") != "held-out"]
        if len(controls) < 6:
            continue
        image = cv2.imread(item["photo"])
        if image is None:
            continue
        h, w = image.shape[:2]
        if image_size is None:
            image_size = (w, h)
        # Commons photos are often resized or recompressed. Normalize control
        # pixels into the first photo coordinate system so more viewpoints can
        # participate in the shared lens solve.
        sx = image_size[0] / w
        sy = image_size[1] / h
        all_world.append(np.asarray([c["world"] for c in controls], np.float32))
        all_pixels.append(np.asarray([[c["pixel"][0] * sx, c["pixel"][1] * sy] for c in controls], np.float32))
        entries.append(item)

    if len(entries) < 2:
        raise RuntimeError("need multiple compatible photos")

    w, h = image_size
    focal = max(w, h)
    camera = np.array([[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], np.float64)
    ok, camera, dist, rvecs, tvecs = cv2.calibrateCamera(
        all_world,
        all_pixels,
        image_size,
        camera,
        np.zeros((5, 1), np.float64),
        flags=cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_ASPECT_RATIO,
    )
    if not ok:
        raise RuntimeError("shared lens calibration failed")

    photos = []
    for item, world, pixels, rvec, tvec in zip(entries, all_world, all_pixels, rvecs, tvecs):
        projected, _ = cv2.projectPoints(world, rvec, tvec, camera, dist)
        errors = np.linalg.norm(projected.reshape(-1, 2) - pixels, axis=1)
        held = [c for c in item["controls"] if c.get("role") == "held-out"]
        held_errors = []
        if held:
            original = cv2.imread(item["photo"])
            sx = w / original.shape[1]
            sy = h / original.shape[0]
            held_world = np.asarray([c["world"] for c in held], np.float32)
            held_pixels = np.asarray([[c["pixel"][0] * sx, c["pixel"][1] * sy] for c in held], np.float32)
            held_projected, _ = cv2.projectPoints(held_world, rvec, tvec, camera, dist)
            held_errors = np.linalg.norm(held_projected.reshape(-1, 2) - held_pixels, axis=1).tolist()
        photos.append({
            "sourceId": item["sourceId"],
            "trainingMedianPixels": float(np.median(errors)),
            "trainingRmsPixels": float(np.sqrt(np.mean(errors ** 2))),
            "trainingMaxPixels": float(np.max(errors)),
            "heldOutCount": len(held_errors),
            "heldOutMedianPixels": float(np.median(held_errors)) if held_errors else None,
            "heldOutP95Pixels": float(np.quantile(held_errors, .95)) if held_errors else None,
            "rotationVector": rvec.reshape(3).tolist(),
            "translationVector": tvec.reshape(3).tolist(),
        })

    result = {
        "status": "candidate-shared-lens-camera",
        "method": "multi-photo-shared-intrinsic-calibrateCamera",
        "photoCount": len(photos),
        "cameraMatrix": camera.tolist(),
        "distortionCoefficients": dist.reshape(-1).tolist(),
        "photos": photos,
        "validationRequired": ["held-out-controls", "projection-audit", "texture-coverage"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
