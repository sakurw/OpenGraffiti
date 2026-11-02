"""Create registration jobs from landmark Commons control-point cases.

The high precision landmark pipeline keeps source collection, registration,
and texture projection separate. This stage converts verified Commons cases
into explicit registration jobs for the camera estimation stage.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    jobs = []

    entries = manifest.get("entries", [])
    if not entries and manifest.get("jobs"):
        entries = manifest["jobs"]

    for entry in entries:
        controls = entry.get("controls", [])
        if not controls and entry.get("case"):
            case = json.loads(Path(entry["case"]).read_text(encoding="utf-8"))
            controls = case.get("controls", [])
        usable = [
            control for control in controls
            if len(control.get("world", [])) == 3
            and len(control.get("pixel", [])) == 2
        ]
        jobs.append(
            {
                "sourceId": entry["sourceId"],
                "photo": entry["photo"],
                "case": entry["case"],
                "cameraModel": entry.get("cameraModel"),
                "groundPhotoVerified": entry.get("groundPhotoVerified", False),
                "controlCount": len(usable),
                "controls": usable,
                "registrationReady": len(usable) >= 6,
            }
        )

    result = {
        "status": "commons-registration-jobs",
        "jobCount": len(jobs),
        "readyJobs": sum(1 for job in jobs if job["registrationReady"]),
        "jobs": jobs,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"jobCount": result["jobCount"], "readyJobs": result["readyJobs"]}))


if __name__ == "__main__":
    main()
