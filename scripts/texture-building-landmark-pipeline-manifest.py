"""Create an auditable execution manifest for landmark texture reconstruction.

This keeps the high precision landmark workflow explicit:
source photo -> registration -> projection -> fusion -> coverage.
It does not infer coverage from registration success.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registration-jobs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    jobs = json.loads(Path(args.registration_jobs).read_text(encoding="utf-8"))
    entries = []
    for job in jobs.get("jobs", []):
        entries.append({
            "sourceId": job["sourceId"],
            "photo": job["photo"],
            "registrationCase": job["case"],
            "controlCount": job["controlCount"],
            "stages": {
                "registration": "pending",
                "projection": "pending",
                "fusion": "pending",
                "coverage": "pending",
            },
        })

    result = {
        "status": "landmark-texture-execution-manifest",
        "sourceCount": len(entries),
        "coverageTarget": 0.90,
        "coverageEvidenceRequired": [
            "visibleTriangleArea",
            "photoCoveredTriangleArea",
            "coverageRatio",
        ],
        "sources": entries,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"sourceCount": len(entries)}))


if __name__ == "__main__":
    main()
