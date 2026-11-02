"""Prepare deterministic per-photo registration execution inputs.

This keeps landmark texture reconstruction auditable. It does not mark a
photo as usable until the downstream PnP validation and projection stages have
produced evidence.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    executions = []
    source_jobs = jobs.get("jobs", [])
    if not source_jobs and jobs.get("inputs"):
        source_jobs = jobs["inputs"]

    for job in source_jobs:
        executions.append(
            {
                "sourceId": job["sourceId"],
                "photo": job["photo"],
                "case": job.get("case", "landmark-input"),
                "controls": job["controls"],
                "steps": [
                    "camera-estimation",
                    "held-out-control-validation",
                    "photo-projection",
                    "multi-photo-fusion",
                    "area-coverage-measurement",
                ],
                "status": "pending",
            }
        )

    result = {
        "status": "landmark-registration-execution-plan",
        "photoCount": len(executions),
        "executions": executions,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"photoCount": len(executions)}))


if __name__ == "__main__":
    main()
