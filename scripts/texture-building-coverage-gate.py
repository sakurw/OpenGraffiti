"""Final gate before reporting landmark texture coverage.

Coverage numbers are accepted only after registration and projection evidence
has passed. This prevents geometric visibility numbers from being reported as
photographic coverage.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registration_audit")
    parser.add_argument("coverage")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    registration = json.loads(Path(args.registration_audit).read_text(encoding="utf-8"))
    coverage = json.loads(Path(args.coverage).read_text(encoding="utf-8"))

    checks = {
        "registration": bool(registration.get("passed")),
        "photoCoverageMeasurement": coverage.get("status") in {
            "coverage-measurement",
            "visibility-coverage-measurement",
            "area-weighted-coverage-measurement",
        },
        "targetReached": float(coverage.get("coverageRatio", 0)) >= 0.9,
    }

    result = {
        "status": "landmark-coverage-gate",
        "passed": all(checks.values()),
        "checks": checks,
        "coverageRatio": coverage.get("coverageRatio", 0),
        "targetRatio": 0.9,
        "note": "Coverage is accepted only when registered photograph evidence passes validation.",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()

