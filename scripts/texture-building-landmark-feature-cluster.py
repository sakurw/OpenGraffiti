"""Cluster landmark photos using image appearance in addition to metadata.

Resolution clustering alone can merge unrelated captures or split the same
camera series. This stage creates pairwise SIFT similarity evidence that can
be used before shared intrinsic calibration.
"""
import argparse
import json
from pathlib import Path

import cv2


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inputs")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    photos = []
    sift = cv2.SIFT_create()
    seen = set()
    for item in data["inputs"]:
        if item["sourceId"] in seen:
            continue
        seen.add(item["sourceId"])
        image = cv2.imread(item["photo"], cv2.IMREAD_GRAYSCALE)
        if image is None:
            continue
        kp, desc = sift.detectAndCompute(image, None)
        photos.append({"id": item["sourceId"], "kp": kp, "desc": desc})

    matcher = cv2.BFMatcher()
    pairs = []
    for i, a in enumerate(photos):
        for b in photos[i + 1:]:
            if a["id"] == b["id"]:
                continue
            if a["desc"] is None or b["desc"] is None:
                continue
            raw = matcher.knnMatch(a["desc"], b["desc"], k=2)
            good = [m for pair in raw if len(pair) == 2 and (m := pair[0]).distance < 0.7 * pair[1].distance]
            if good:
                pairs.append({
                    "sourceA": a["id"],
                    "sourceB": b["id"],
                    "goodMatches": len(good),
                })

    result = {
        "status": "landmark-feature-cluster-evidence",
        "method": "sift-pairwise-ratio-test",
        "photoCount": len(photos),
        "pairs": sorted(pairs, key=lambda x: x["goodMatches"], reverse=True),
        "next": "use high-confidence pairs for lens clusters",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"photoCount": len(photos), "pairCount": len(pairs)}))


if __name__ == "__main__":
    main()
