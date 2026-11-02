"""Optimize landmark camera intrinsics and pose from manual controls.

This replaces the fixed-focal SQPNP-only estimate with a small bundle
adjustment stage. The output is still a candidate camera and must pass the
existing coverage gates.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def rms(errors):
    return float(np.sqrt(np.mean(np.square(errors)))) if len(errors) else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inputs")
    p.add_argument("--source-id", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    item = next(x for x in data["inputs"] if x["sourceId"] == args.source_id)
    controls = item["controls"]
    train_controls = [c for c in controls if c.get("role") != "held-out"]
    held_controls = [c for c in controls if c.get("role") == "held-out"]
    world = np.asarray([c["world"] for c in train_controls], np.float64)
    pixels = np.asarray([c["pixel"] for c in train_controls], np.float64)
    image = cv2.imread(item["photo"])
    if image is None:
        raise RuntimeError("photo not found")
    h, w = image.shape[:2]

    best = None
    # CalibrateCamera jointly estimates focal length, principal point and
    # distortion while solvePnP supplies robust pose initialization.
    for focal in np.geomspace(max(w, h) * .8, max(w, h) * 5, 24):
        k = np.array([[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], np.float64)
        ok, rvec, tvec = cv2.solvePnP(world, pixels, k, None, flags=cv2.SOLVEPNP_SQPNP)
        if not ok:
            continue
        ok, kk, dist, rv, tv = cv2.calibrateCamera(
            [world.astype(np.float32)], [pixels.astype(np.float32)],
            (w, h), k.copy(), np.zeros((5, 1), np.float64),
            flags=cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_ASPECT_RATIO,
        )
        if not ok:
            continue
        # Large distortion values are usually a sign that a sparse landmark
        # set is being overfit. Keep the camera physically plausible.
        if np.max(np.abs(dist)) > 2.0:
            continue
        projected, _ = cv2.projectPoints(world, rv[0], tv[0], kk, dist)
        errors = np.linalg.norm(projected.reshape(-1, 2) - pixels, axis=1)
        score = rms(errors)
        if best is None or score < best[0]:
            best = (score, kk, dist, rv[0], tv[0], errors)

    if best is None:
        raise RuntimeError("calibration failed")
    score, k, dist, rvec, tvec, errors = best
    held_errors = []
    if held_controls:
        held_world = np.asarray([c["world"] for c in held_controls], np.float64)
        held_pixels = np.asarray([c["pixel"] for c in held_controls], np.float64)
        held_projected, _ = cv2.projectPoints(held_world, rvec, tvec, k, dist)
        held_errors = np.linalg.norm(held_projected.reshape(-1, 2) - held_pixels, axis=1).tolist()

    result = {
        "status": "candidate-calibrated-camera",
        "sourceId": args.source_id,
        "method": "manual-control-calibrateCamera-bundle-refine",
        "cameraMatrix": k.tolist(),
        "distortionCoefficients": dist.reshape(-1).tolist(),
        "rotationVector": rvec.reshape(3).tolist(),
        "translationVector": tvec.reshape(3).tolist(),
        "trainingRmsPixels": score,
        "trainingMaxPixels": float(errors.max()),
        "controlCount": len(controls),
        "trainingControlCount": len(train_controls),
        "heldOutControlCount": len(held_controls),
        "heldOutMedianPixels": float(np.median(held_errors)) if held_errors else None,
        "heldOutP95Pixels": float(np.quantile(held_errors, .95)) if held_errors else None,
        "heldOutWithin3Pixels": int(sum(x <= 3.0 for x in held_errors)) if held_errors else 0,
        "validationRequired": ["held-out-controls", "projection-audit", "texture-coverage"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
