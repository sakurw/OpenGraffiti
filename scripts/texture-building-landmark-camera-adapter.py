"""Convert landmark calibration output into photo projector camera input.

Keeps the high precision landmark calibration format separate from the
triangle projection format. The generated camera still requires coverage
validation before it can contribute to final texture coverage.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("calibration")
    parser.add_argument("--source-id")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.calibration).read_text(encoding="utf-8"))
    if "components" in data:
        candidates = []
        for component in data["components"]:
            value = component.get("calibration", {})
            if value.get("sourceId"):
                candidates.append(value)
    else:
        candidates = [data]

    camera = next((x for x in candidates if not args.source_id or x.get("sourceId") == args.source_id), None)
    if camera is None:
        raise RuntimeError("source camera not found")

    result = {
        "status": "landmark-camera-adapter",
        "sourceId": camera["sourceId"],
        "cameraMatrix": camera["cameraMatrix"],
        "distortionCoefficients": camera.get("distortionCoefficients", []),
        "rotationVector": camera["rotationVector"],
        "translationVector": camera["translationVector"],
        "validationRequired": ["held-out-controls", "projection-audit", "texture-coverage"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
