"""Find feature correspondences between a landmark photo and a PLATEAU render.

The output is a candidate match set for the existing 3D correspondence and PnP
stages. It does not certify registration; geometric validation is still needed.
"""
import argparse
import json
from pathlib import Path

import cv2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photo")
    parser.add_argument("render")
    parser.add_argument("--output", required=True)
    parser.add_argument("--ratio", type=float, default=0.75)
    args = parser.parse_args()

    photo = cv2.imread(args.photo, cv2.IMREAD_GRAYSCALE)
    render = cv2.imread(args.render, cv2.IMREAD_GRAYSCALE)
    if photo is None or render is None:
        raise RuntimeError("failed to load input images")

    sift = cv2.SIFT_create()
    photo_keypoints, photo_desc = sift.detectAndCompute(photo, None)
    render_keypoints, render_desc = sift.detectAndCompute(render, None)
    if photo_desc is None or render_desc is None:
        raise RuntimeError("no features detected")

    matcher = cv2.BFMatcher()
    raw = matcher.knnMatch(photo_desc, render_desc, k=2)
    matches = []
    for pair in raw:
        if len(pair) != 2:
            continue
        first, second = pair
        if first.distance < args.ratio * second.distance:
            matches.append({
                "imagePixel": list(photo_keypoints[first.queryIdx].pt),
                "renderPixel": list(render_keypoints[first.trainIdx].pt),
                "distance": float(first.distance),
            })

    result = {
        "status": "feature-matches-generated",
        "method": "sift-knn-ratio-test",
        "photoFeatures": len(photo_keypoints),
        "renderFeatures": len(render_keypoints),
        "matches": matches,
        "validationRequired": ["geometric-filter", "pnp", "held-out-controls"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"matches": len(matches)}))


if __name__ == "__main__":
    main()
