"""Create geometry-guided feature matches for a landmark photo.

The output is only a correspondence proposal. It must be validated by PnP
held-out checks before it can become a texture registration.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("image")
    p.add_argument("render")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    image = cv2.imread(args.image, cv2.IMREAD_GRAYSCALE)
    render = cv2.imread(args.render, cv2.IMREAD_GRAYSCALE)
    if image is None or render is None:
        raise RuntimeError("input image missing")

    sift = cv2.SIFT_create(nfeatures=20000)
    k1, d1 = sift.detectAndCompute(image, None)
    k2, d2 = sift.detectAndCompute(render, None)
    matches = []
    if d1 is not None and d2 is not None:
        matcher = cv2.BFMatcher()
        for a, b in matcher.knnMatch(d1, d2, k=2):
            if a.distance < 0.7 * b.distance:
                matches.append({
                    "imagePixel": list(map(float, k1[a.queryIdx].pt)),
                    "renderPixel": list(map(float, k2[a.trainIdx].pt)),
                    "distance": float(a.distance),
                })

    inlier_count = 0
    if len(matches) >= 4:
        src = np.asarray([m["imagePixel"] for m in matches], np.float64)
        dst = np.asarray([m["renderPixel"] for m in matches], np.float64)
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is not None:
            inlier_count = int(mask.sum())

    Path(args.output).write_text(json.dumps({
        "status": "candidate-correspondence-only",
        "method": "sift-render-match",
        "matches": matches,
        "geometricCheck": {
            "type": "homography-ransac-diagnostic",
            "inliers": inlier_count,
            "note": "2D consistency only; it is not a camera registration proof."
        },
        "validationRequired": ["3d-backprojection", "pnp", "held-out-validation"],
    }, indent=2), encoding="utf-8")
    print(json.dumps({"matches": len(matches)}))


if __name__ == "__main__":
    main()
