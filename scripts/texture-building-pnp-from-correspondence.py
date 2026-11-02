"""Estimate a landmark photo camera from generated 2D-3D correspondences.

The result is a candidate registration. Existing visibility and held-out
validation gates remain required before texture coverage is increased.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("correspondences")
    p.add_argument("--output", required=True)
    p.add_argument("--width", type=int, default=1920)
    p.add_argument("--height", type=int, default=1080)
    p.add_argument("--reprojection-threshold", type=float, default=3.0)
    args = p.parse_args()

    data = json.loads(Path(args.correspondences).read_text(encoding="utf-8"))
    if data.get("photos"):
        results = []
        for photo in data["photos"]:
            pairs = photo.get("correspondences", [])
            if len(pairs) < 6:
                results.append({"sourceId": photo.get("sourceId"), "status": "insufficient-correspondences"})
                continue
            world = np.asarray([x["world"] for x in pairs], np.float64)
            pixels = np.asarray([x["pixel"] for x in pairs], np.float64)
            focal = max(args.width, args.height)
            camera = np.array([[focal, 0, args.width / 2], [0, focal, args.height / 2], [0, 0, 1]], np.float64)
            ok, rvec, tvec, inliers = cv2.solvePnPRansac(
                world, pixels, camera, None,
                flags=cv2.SOLVEPNP_SQPNP,
                reprojectionError=4.0,
                iterationsCount=2000,
            )
            detail = {}
            if ok:
                projected = cv2.projectPoints(world, rvec, tvec, camera, None)[0].reshape(-1, 2)
                errors = np.linalg.norm(projected - pixels, axis=1)
                rotation = cv2.Rodrigues(rvec)[0]
                detail = {
                    "cameraPosition": (-(rotation.T @ tvec).reshape(3)).tolist(),
                    "rotationVector": rvec.reshape(3).tolist(),
                    "translationVector": tvec.reshape(3).tolist(),
                    "cameraMatrix": camera.tolist(),
                    "rmsPixels": float(np.sqrt(np.mean(errors ** 2))),
                    "maxReprojectionError": float(errors.max()),
                    "heldOutWithin3Pixels": int((errors <= 3.0).sum()),
                }
            results.append({
                "sourceId": photo.get("sourceId"),
                "status": "candidate-pose-only" if ok else "pnp-failed",
                "inliers": int(len(inliers)) if inliers is not None else 0,
                **detail,
            })
        Path(args.output).write_text(json.dumps({"status": "batch" , "photos": results}, indent=2), encoding="utf-8")
        return

    pairs = data.get("correspondences", [])
    if len(pairs) < 6:
        raise RuntimeError("need at least 6 2D-3D correspondences")

    world = np.asarray([x["world"] for x in pairs], np.float64)
    pixels = np.asarray([x["pixel"] for x in pairs], np.float64)
    focal = max(args.width, args.height)
    camera = np.array(
        [[focal, 0, args.width / 2], [0, focal, args.height / 2], [0, 0, 1]],
        np.float64,
    )

    ok, rvec, tvec, inliers = cv2.solvePnPRansac(
        world,
        pixels,
        camera,
        None,
        flags=cv2.SOLVEPNP_SQPNP,
        reprojectionError=4.0,
        iterationsCount=2000,
    )
    if not ok:
        raise RuntimeError("PnP failed")

    projected = cv2.projectPoints(world, rvec, tvec, camera, None)[0].reshape(-1, 2)
    errors = np.linalg.norm(projected - pixels, axis=1)
    held_out = errors > args.reprojection_threshold
    inlier_ratio = float((~held_out).sum() / len(errors))
    rotation = cv2.Rodrigues(rvec)[0]
    position = (-(rotation.T @ tvec).reshape(3)).tolist()

    result = {
        "status": "candidate-pose-only",
        "method": "sq-pnp-ransac-from-render-correspondence",
        "cameraPosition": position,
        "rotationVector": rvec.reshape(3).tolist(),
        "translationVector": tvec.reshape(3).tolist(),
        "cameraMatrix": camera.tolist(),
        "inliers": int(len(inliers)) if inliers is not None else 0,
        "rmsPixels": float(np.sqrt(np.mean(errors ** 2))),
        "maxReprojectionError": float(errors.max()),
        "registrationQuality": {
            "thresholdPixels": args.reprojection_threshold,
            "withinThreshold": int((~held_out).sum()),
            "outliers": int(held_out.sum()),
            "ratio": inlier_ratio,
            "accepted": inlier_ratio >= 0.8 and float(np.sqrt(np.mean(errors ** 2))) <= args.reprojection_threshold,
        },
        "validationRequired": ["held-out-controls", "visibility", "occlusion"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "inliers": result["inliers"], "rmsPixels": result["rmsPixels"]}))


if __name__ == "__main__":
    main()
