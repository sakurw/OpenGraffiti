"""Prepare a batch manifest for landmark photo texture processing.

The landmark pipeline keeps registration evidence separate from projection.
This utility connects the available Commons registration cases with downloaded
source photographs so later projection/fusion stages process the complete
candidate set instead of a single manually selected image.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", default="scripts/texture-snap-cases")
    parser.add_argument("--photos", default="data/texture-city/photos/commons")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    cases_dir = Path(args.cases)
    photos_dir = Path(args.photos)

    entries = []
    for case_path in sorted(cases_dir.glob("tocho-commons-*.json")):
        case = json.loads(case_path.read_text(encoding="utf-8"))
        source_id = str(case.get("sourceId", ""))
        photo = photos_dir / f"{source_id}.jpg"
        if not photo.exists():
            continue
        entries.append(
            {
                "sourceId": source_id,
                "case": str(case_path),
                "photo": str(photo),
                "provider": case.get("provider"),
                "cameraModel": case.get("cameraModel"),
                "groundPhotoVerified": case.get("groundPhotoVerified", False),
                "controlCount": len(case.get("controls", [])),
            }
        )

    result = {
        "status": "commons-photo-batch-manifest",
        "photoCount": len(entries),
        "entries": entries,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"photoCount": len(entries)}))


if __name__ == "__main__":
    main()
