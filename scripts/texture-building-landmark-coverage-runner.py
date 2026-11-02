"""Coordinate the landmark texture coverage pipeline stages.

Keeps final coverage measurement tied to real photo projection evidence.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    sources = []
    for item in plan.get("executions", []):
        sources.append({
            "sourceId": item["sourceId"],
            "photo": item["photo"],
            "requiredEvidence": {
                "cameraPose": False,
                "heldOutValidation": False,
                "projectedSamples": False,
                "fusionSelection": False,
            },
            "status": "waiting-for-registration",
        })

    result = {
        "status": "landmark-coverage-runner-plan",
        "targetCoverageRatio": 0.90,
        "sourceCount": len(sources),
        "coverageCanBeClaimed": False,
        "sources": sources,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"sourceCount": len(sources), "coverageCanBeClaimed": False}))


if __name__ == "__main__":
    main()
