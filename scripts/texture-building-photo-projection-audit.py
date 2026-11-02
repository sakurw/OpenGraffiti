"""Audit candidate photo projection inputs for landmark texture generation.

This is the validation boundary between camera registration and atlas writing.
It records whether a photo has enough evidence to contribute to coverage.
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
    metadata = registration.get("triangleMetadata", {})
    validation = registration.get("reprojectionValidation", {})

    checks = {
        "reprojection": bool(validation.get("passed")),
        "triangleEvidence": metadata.get("assigned", 0) > 0,
        "cameraPose": all(
            registration.get(key) is not None
            for key in ("cameraMatrix", "rotationVector", "translationVector")
        ),
    }

    result = {
        "status": "photo-projection-audit",
        "passed": all(checks.values()),
        "checks": checks,
        "next": "texture-atlas-generation" if all(checks.values()) else "registration-refinement",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
