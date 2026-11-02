"""Filter landmark camera candidates before texture projection.

Registration success requires reprojection evidence. This keeps weak PnP
solutions away from the coverage measurement stage.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("results")
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-rms", type=float, default=3.0)
    parser.add_argument("--max-error", type=float, default=8.0)
    args = parser.parse_args()

    data = json.loads(Path(args.results).read_text(encoding="utf-8"))
    rows = []
    for item in data.get("photos", []):
        accepted = (
            item.get("status") == "candidate-pose-only"
            and item.get("rmsPixels", 999) <= args.max_rms
            and item.get("maxReprojectionError", 999) <= args.max_error
        )
        rows.append({**item, "projectionEligible": accepted})

    output = {
        "status": "landmark-registration-quality",
        "photoCount": len(rows),
        "eligibleCount": sum(1 for x in rows if x["projectionEligible"]),
        "photos": rows,
    }
    Path(args.output).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(json.dumps({"photoCount": len(rows), "eligibleCount": output["eligibleCount"]}))


if __name__ == "__main__":
    main()
