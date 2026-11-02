"""Create robust photo groups using feature matches plus geometric verification."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inputs")
    p.add_argument("--min-inliers", type=int, default=50)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    unique = {}
    sift = cv2.SIFT_create()
    for item in data["inputs"]:
        if item["sourceId"] in unique:
            continue
        image = cv2.imread(item["photo"], cv2.IMREAD_GRAYSCALE)
        if image is None:
            continue
        kp, desc = sift.detectAndCompute(image, None)
        unique[item["sourceId"]] = (kp, desc)

    ids = list(unique)
    matcher = cv2.BFMatcher()
    parent = {x: x for x in ids}
    edges = []

    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            da = unique[a][1]
            db = unique[b][1]
            if da is None or db is None:
                continue
            raw = matcher.knnMatch(da, db, k=2)
            good = [m for pair in raw if len(pair) == 2 and pair[0].distance < 0.7 * pair[1].distance for m in [pair[0]]]
            if len(good) < args.min_inliers:
                continue
            pa = np.float32([unique[a][0][m.queryIdx].pt for m in good])
            pb = np.float32([unique[b][0][m.trainIdx].pt for m in good])
            _, mask = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.5, 0.99)
            inliers = int(mask.sum()) if mask is not None else 0
            if inliers >= args.min_inliers:
                union(a, b)
                edges.append({"sourceA": a, "sourceB": b, "inliers": inliers, "matches": len(good)})

    groups = {}
    for photo in ids:
        groups.setdefault(find(photo), []).append(photo)

    result = {
        "status": "landmark-geometric-components",
        "method": "sift-fundamental-ransac-components",
        "componentCount": len(groups),
        "components": list(groups.values()),
        "edges": edges,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"componentCount": len(groups), "components": list(groups.values()), "edgeCount": len(edges)}))


if __name__ == "__main__":
    main()
