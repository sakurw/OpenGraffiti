"""Geometry-aware photo/render feature candidate generation.

Keeps feature matching separate from observation certification. The generated
matches must still pass PnP, reprojection and visibility validation.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photo")
    parser.add_argument("render")
    parser.add_argument("--output", required=True)
    parser.add_argument("--ratio", type=float, default=0.75)
    parser.add_argument("--min-matches", type=int, default=8)
    args = parser.parse_args()

    photo = cv2.imread(args.photo, cv2.IMREAD_GRAYSCALE)
    render = cv2.imread(args.render, cv2.IMREAD_GRAYSCALE)
    if photo is None or render is None:
        raise RuntimeError("failed to load image pair")

    detector = cv2.SIFT_create()
    kp_photo, des_photo = detector.detectAndCompute(photo, None)
    kp_render, des_render = detector.detectAndCompute(render, None)
    if des_photo is None or des_render is None:
        raise RuntimeError("no descriptors")

    matcher = cv2.BFMatcher()
    candidates = []
    for pair in matcher.knnMatch(des_photo, des_render, k=2):
        if len(pair) == 2 and pair[0].distance < args.ratio * pair[1].distance:
            candidates.append(pair[0])

    result = {
        "method": "sift-ratio-ransac-geometry-aware-candidate",
        "photoFeatures": len(kp_photo),
        "renderFeatures": len(kp_render),
        "candidateMatches": len(candidates),
        "matches": [],
        "validationRequired": ["surface-normal-filter", "pnp", "reprojection", "visibility"],
    }

    if len(candidates) >= args.min_matches:
        src = np.float32([kp_photo[m.queryIdx].pt for m in candidates])
        dst = np.float32([kp_render[m.trainIdx].pt for m in candidates])
        _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
        if mask is not None:
            for m, keep in zip(candidates, mask.ravel()):
                if keep:
                    result["matches"].append({
                        "imagePixel": list(kp_photo[m.queryIdx].pt),
                        "renderPixel": list(kp_render[m.trainIdx].pt),
                        "distance": float(m.distance),
                    })

    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"candidateMatches": result["candidateMatches"], "inlierMatches": len(result["matches"])}))


if __name__ == "__main__":
    main()
