"""Select representative landmark cameras for multi-view coverage.

The selector keeps camera quality gating separate from view diversity. A
camera is only selected when it is usable and provides a different viewing
direction from already selected cameras.
"""
import argparse
import json
from pathlib import Path
import numpy as np


def camera_position(data):
    rvec = np.asarray(data.get("rotationVector", [0, 0, 0]), dtype=float)
    tvec = np.asarray(data.get("translationVector", [0, 0, 0]), dtype=float)
    theta = np.linalg.norm(rvec)
    if theta > 1e-12:
        import cv2
        rotation, _ = cv2.Rodrigues(rvec)
        return (-rotation.T @ tvec).tolist()
    return [0.0, 0.0, 0.0]


def direction(position):
    v = np.asarray(position, dtype=float)
    n = np.linalg.norm(v)
    return (v / n).tolist() if n else [0.0, 0.0, 0.0]


def spherical(direction_value):
    v = np.asarray(direction_value, dtype=float)
    return {
        "azimuthDegrees": float(np.degrees(np.arctan2(v[2], v[0]))),
        "elevationDegrees": float(np.degrees(np.arcsin(np.clip(v[1], -1, 1)))),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("quality")
    parser.add_argument("--camera-dir", default="data/texture-city")
    parser.add_argument("--output", default="data/texture-city/landmark-view-selection.json")
    parser.add_argument("--count", type=int, default=4)
    args = parser.parse_args()

    quality = json.loads(Path(args.quality).read_text(encoding="utf-8"))
    candidates = []
    for item in quality["cameras"]:
        if not item.get("usableForMultiView"):
            continue
        data = json.loads((Path(args.camera_dir) / Path(item["source"]).name).read_text(encoding="utf-8"))
        pos = camera_position(data)
        view_direction = direction(pos)
        candidates.append({
            **item,
            "cameraPosition": pos,
            "direction": view_direction,
            "viewAngle": spherical(view_direction),
        })

    selected = []
    for item in sorted(candidates, key=lambda x: x["qualityScore"], reverse=True):
        if not selected:
            selected.append(item)
            continue
        diversity = min(1 - float(np.dot(item["direction"], x["direction"])) for x in selected)
        item["diversityScore"] = diversity
        if diversity > 0.15:
            selected.append(item)
        if len(selected) >= args.count:
            break

    result = {"status": "landmark-view-selection", "selectedCount": len(selected), "selected": selected}
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
