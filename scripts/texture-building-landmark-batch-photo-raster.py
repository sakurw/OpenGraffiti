"""Run landmark photo projection and raster coverage for calibrated photos.

Keeps the landmark workflow auditable by producing one coverage artifact per
source photo before multi-photo fusion.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("calibration")
    p.add_argument("triangles")
    p.add_argument("photo_dir")
    p.add_argument("--output-dir", required=True)
    args = p.parse_args()

    calibration = json.loads(Path(args.calibration).read_text(encoding="utf-8"))
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    project = Path(__file__).with_name("texture-building-landmark-photo-project.py")
    raster = Path(__file__).with_name("texture-building-landmark-photo-raster-coverage.py")

    done = []
    for component in calibration.get("components", []):
        value = component.get("calibration", {})
        if "photos" not in value:
            cameras = [value]
        else:
            cameras = []
            for photo in value["photos"]:
                cameras.append({**value, **photo, "sourceId": photo["sourceId"]})

        for camera in cameras:
            source = camera.get("sourceId")
            if not source:
                continue
            camera_path = out / f"camera-{source}.json"
            camera_path.write_text(json.dumps(camera, indent=2), encoding="utf-8")
            photo = Path(args.photo_dir) / f"{source}.jpg"
            if not photo.exists():
                continue
            projection = out / f"projection-{source}.json"
            coverage = out / f"coverage-{source}.json"
            subprocess.run([sys.executable, str(project), args.triangles, "--vertices", args.triangles,
                            "--camera", str(camera_path), "--photo", str(photo), "--output", str(projection)],
                           check=True)
            subprocess.run([sys.executable, str(raster), str(projection),
                            str(Path("data/texture-city/visible-triangle-area-tocho.json")),
                            str(photo), "--output", str(coverage)], check=True)
            done.append(source)

    print(json.dumps({"processed": done, "count": len(done)}))


if __name__ == "__main__":
    main()
