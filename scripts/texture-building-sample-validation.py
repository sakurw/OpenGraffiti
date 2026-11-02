"""Attach deterministic validation state to photo triangle samples.

The coverage pipeline requires every sample to have explicit evidence for
depth, normal direction and photo quality. This stage keeps unknown values out
of the coverage accumulator.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples")
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-angle-deviation", type=float, default=45.0)
    args = parser.parse_args()

    data = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    validated = []
    rejected = []

    for sample in data.get("mappings", []):
        reasons = []
        if sample.get("depthPassed") is not True:
            reasons.append("depth-not-validated")
        if sample.get("normalPassed") is not True:
            reasons.append("normal-not-validated")
        if sample.get("qualityScore") is None:
            reasons.append("quality-not-validated")

        if sample.get("viewNormalAngle") is None:
            reasons.append("normal-angle-not-validated")
        elif sample.get("viewNormalAngle") > args.max_angle_deviation:
            reasons.append("normal-angle-too-large")

        if reasons:
            rejected.append({**sample, "reasons": reasons})
        else:
            validated.append(sample)

    result = {
        "status": "sample-validation-result",
        "validatedSamples": len(validated),
        "rejectedSamples": len(rejected),
        "coverageReady": len(rejected) == 0 and len(validated) > 0,
        "validated": validated,
        "rejected": rejected,
        "rule": {
            "depth": "required",
            "normal": "required",
            "photoQuality": "required",
            "normalAngle": f"<= {args.max_angle_deviation} degrees",
        },
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "validatedSamples": len(validated)}))


if __name__ == "__main__":
    main()
