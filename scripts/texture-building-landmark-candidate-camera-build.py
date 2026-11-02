"""Build virtual landmark cameras from uncovered surface candidates.

The output keeps the existing landmark camera schema so it can be validated
by the depth/render pipeline before any pixels are accepted.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import cv2


def look_at_camera(position, target):
    p = np.asarray(position, dtype=float)
    t = np.asarray(target, dtype=float)
    forward = t - p
    forward /= np.linalg.norm(forward)
    return forward.tolist()


def camera_pose(position, target):
    """Create an OpenCV pose for a virtual camera looking at a surface."""
    eye = np.asarray(position, dtype=float)
    center = np.asarray(target, dtype=float)
    z = center - eye
    z /= np.linalg.norm(z)
    up = np.asarray([0.0, 1.0, 0.0])
    if abs(np.dot(z, up)) > 0.99:
        up = np.asarray([0.0, 0.0, 1.0])
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    rotation = np.column_stack((x, y, z))
    rvec, _ = cv2.Rodrigues(rotation)
    tvec = (-rotation @ eye).reshape(3, 1)
    return rvec.reshape(-1).tolist(), tvec.reshape(-1).tolist()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidates")
    parser.add_argument("template")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    candidates = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    template = json.loads(Path(args.template).read_text(encoding="utf-8"))

    cameras = []
    for index, candidate in enumerate(candidates.get("candidates", [])):
        center = np.asarray(candidate["targetSurfaceCenter"], dtype=float)
        direction = np.asarray(candidate["direction"], dtype=float)
        position = center + direction * 80.0
        rvec, tvec = camera_pose(position, center)
        cameras.append({
            "id": f"candidate-{index}",
            "sourceId": f"virtual-candidate-{index}",
            "cameraMatrix": template["cameraMatrix"],
            "resolution": template.get("resolution", [1920, 2560]),
            "position": position.tolist(),
            "lookAt": center.tolist(),
            "viewDirection": look_at_camera(position, center),
            "rotationVector": rvec,
            "translationVector": tvec,
            "expectedUncoveredPixels": candidate["expectedUncoveredPixels"],
            "triangleIds": candidate["triangleIds"],
        })

    result = {
        "status": "virtual-landmark-candidate-cameras",
        "count": len(cameras),
        "cameras": cameras,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"output": args.output, "count": len(cameras)}))


if __name__ == "__main__":
    main()
