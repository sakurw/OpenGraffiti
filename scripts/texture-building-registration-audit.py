"""Audit a landmark photo registration result before texture projection.

This verifies that a PnP candidate contains enough geometric evidence and
rejects registrations that would make the coverage metric misleading.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registration")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    registration = json.loads(Path(args.registration).read_text(encoding="utf-8"))
    reprojection = registration.get("reprojectionValidation", {})
    metadata = registration.get("triangleMetadata", {})

    checks = {
        "reprojection": bool(reprojection.get("passed")),
        "triangleAssignments": metadata.get("assigned", 0) > 0,
        "cameraAvailable": bool(registration.get("cameraMatrix"))
            and bool(registration.get("rotationVector"))
            and bool(registration.get("translationVector")),
    }

    result = {
        "status": "registration-audit",
        "passed": all(checks.values()),
        "checks": checks,
        "nextRequired": [
            "visibility-validation",
            "texture-projection",
            "area-weighted-coverage",
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
