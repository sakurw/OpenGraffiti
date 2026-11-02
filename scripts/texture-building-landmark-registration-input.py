"""Build explicit inputs for landmark camera registration.

Keeps the high precision workflow auditable by separating source/control data
from the PnP solver. A generated entry is not a successful registration.
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
    inputs = []
    for job in jobs.get("jobs", []):
        inputs.append(
            {
                "sourceId": job["sourceId"],
                "photo": job["photo"],
                "controls": job.get("controls", []),
                "solverInput": {
                    "method": "sqpnp-ransac",
                    "requiresHeldOutValidation": True,
                    "requiresProjectionAudit": True,
                },
                "registrationStatus": "pending",
            }
        )

    result = {
        "status": "landmark-registration-inputs",
        "inputCount": len(inputs),
        "inputs": inputs,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"inputCount": len(inputs)}))


if __name__ == "__main__":
    main()
