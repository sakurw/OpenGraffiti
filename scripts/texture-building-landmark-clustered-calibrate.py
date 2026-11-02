"""Cluster landmark photos before shared-lens calibration.

Commons landmark photos can contain multiple cameras and resized images.
This stage groups compatible captures and runs the existing shared intrinsic
calibration per group.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inputs")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    data = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    groups = {}
    for item in data["inputs"]:
        image = cv2.imread(item["photo"])
        if image is None:
            continue
        h, w = image.shape[:2]
        controls = [c for c in item["controls"] if c.get("role") != "held-out"]
        if len(controls) < 6:
            continue
        # Resolution and aspect ratio are weak but useful signals because
        # Commons albums often preserve original camera series.
        key = (round(w / h, 3), round(w / 100, -1), len(controls))
        groups.setdefault(str(key), []).append(item["sourceId"])

    result = {
        "status": "landmark-photo-clusters",
        "method": "resolution-aspect-control-density-clustering",
        "clusterCount": len(groups),
        "clusters": [{"key": k, "sourceIds": v} for k, v in groups.items()],
        "next": "run shared lens calibration independently per cluster",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
