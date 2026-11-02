"""Evaluate candidate photo masks in final render pixel space.

The final world-position buffer is ordered by final render pixels. Candidate
cameras are used to test whether each final pixel world point is backed by a
candidate photo mask.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def load_world(path):
    data = np.fromfile(path, dtype=np.float32)
    if data.size % 4:
        raise ValueError("world position buffer is not vec4 aligned")
    return data.reshape((-1, 4))[:, :3].astype(np.float64)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--world-position", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--visible-mask")
    parser.add_argument("--candidates", nargs="+", required=True)
    parser.add_argument("--masks", nargs="+", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    if len(args.candidates) != len(args.masks):
        raise ValueError("candidate and mask counts differ")

    points = load_world(args.world_position)
    if len(points) != args.width * args.height:
        raise ValueError("world position size does not match render resolution")

    visible_mask = np.ones((args.height, args.width), dtype=bool)
    if args.visible_mask:
        visible_mask = np.load(args.visible_mask).astype(bool)
        if visible_mask.shape != (args.height, args.width):
            raise ValueError("visible mask resolution does not match final render resolution")

    valid_world = np.isfinite(points).all(axis=1) & (np.linalg.norm(points, axis=1) > 1e-6)
    valid_indices = np.flatnonzero(valid_world)
    valid_points = points[valid_world]
    union = np.zeros(args.width * args.height, dtype=bool)
    rows = []

    for camera_path, mask_path in zip(args.candidates, args.masks):
        camera = json.loads(Path(camera_path).read_text(encoding="utf-8"))
        mask = np.load(mask_path).astype(bool)
        k = np.asarray(camera["cameraMatrix"], dtype=np.float64)
        r = np.asarray(camera["rotationVector"], dtype=np.float64)
        t = np.asarray(camera["translationVector"], dtype=np.float64)

        projected, _ = cv2.projectPoints(valid_points, r, t, k, None)
        projected = projected.reshape((-1, 2))
        x = np.rint(projected[:, 0]).astype(np.int64)
        y = np.rint(projected[:, 1]).astype(np.int64)
        inside = (x >= 0) & (x < mask.shape[1]) & (y >= 0) & (y < mask.shape[0])

        backed = np.zeros(args.width * args.height, dtype=bool)
        backed[valid_indices[inside]] = mask[y[inside], x[inside]]
        backed &= visible_mask.reshape(-1)
        union |= backed

        rows.append({"candidate": camera.get("sourceId"), "mappedPixels": int(backed.sum())})

    result = {"status": "candidate-final-render-union", "photoBackedPixels": int(union.sum()), "candidates": rows}
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
