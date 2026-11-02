"""Connect universal photo jobs to the geometry validation pipeline.

Candidate photos stay untrusted. This only creates explicit inputs for the
feature matching and PnP stages.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()

    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    records = []
    for job in jobs.get("jobs", [])[: args.limit]:
        records.append(
            {
                "area": job.get("area"),
                "buildingId": job.get("buildingId"),
                "surfaceId": job.get("surfaceId"),
                "imageId": job.get("imageId"),
                "resolvedPhotoRequired": True,
                "registration": {
                    "featureMatch": "pending",
                    "pnp": "pending",
                    "reprojection": "pending",
                    "visibility": "pending",
                },
                "promotion": "blocked-until-validation",
            }
        )

    result = {
        "method": "universal-photo-geometry-validation-input-v1",
        "candidateCount": len(records),
        "certifiedObservations": 0,
        "records": records,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
