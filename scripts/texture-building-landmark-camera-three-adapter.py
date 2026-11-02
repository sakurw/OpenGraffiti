"""Convert OpenCV landmark calibration to the camera format used by triangle-input."""
import argparse
import json
from pathlib import Path
import numpy as np
import cv2


def main():
    p = argparse.ArgumentParser()
    p.add_argument("calibration")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    c = json.loads(Path(args.calibration).read_text(encoding="utf-8"))
    width, height = c.get("resolution", [1920, 2560])
    fx, fy = c["cameraMatrix"][0][0], c["cameraMatrix"][1][1]
    cx, cy = c["cameraMatrix"][0][2], c["cameraMatrix"][1][2]

    r, _ = cv2.Rodrigues(np.asarray(c["rotationVector"], dtype=float))
    t = np.asarray(c["translationVector"], dtype=float).reshape(3, 1)
    # OpenCV camera coordinates are x-right/y-down/z-forward. Three.js uses
    # OpenGL camera coordinates with y-up/z-back. Convert before exporting the
    # world-to-camera matrix.
    cv_to_gl = np.diag([1, -1, -1, 1])
    world_to_cv = np.eye(4)
    world_to_cv[:3, :3] = r
    world_to_cv[:3, 3:4] = t
    view = cv_to_gl @ world_to_cv

    near, far = 0.1, 5000.0
    proj = np.array([
        [2*fx/width, 0, 1-2*cx/width, 0],
        [0, 2*fy/height, 2*cy/height-1, 0],
        [0, 0, -(far+near)/(far-near), -2*far*near/(far-near)],
        [0, 0, -1, 0],
    ])

    # Three.js Matrix4 arrays are column-major.
    result = {
        "status": "landmark-three-camera-adapter",
        "sourceId": c.get("sourceId"),
        "resolution": [width, height],
        "near": near,
        "far": far,
        "view": view.T.reshape(-1).tolist(),
        "projection": proj.T.reshape(-1).tolist(),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
