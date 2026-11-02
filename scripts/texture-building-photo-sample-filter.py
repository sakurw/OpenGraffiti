"""Filter photo-to-triangle samples before coverage measurement.

The landmark pipeline needs evidence that a sampled photograph location is a
valid observation of the PLATEAU surface. This stage applies the available
quality gates and preserves rejection reasons for audit.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples")
    parser.add_argument("--min-quality", type=float, default=0.7)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    accepted = []
    rejected = []

    for sample in data.get("mappings", []):
        reasons = []
        quality = sample.get("qualityScore")
        if quality is None:
            reasons.append("missing-photo-quality")
        elif quality < args.min_quality:
            reasons.append("photo-quality")
        if sample.get("depthPassed") is not True:
            reasons.append("depth-mismatch")
        if sample.get("normalPassed") is not True:
            reasons.append("normal-mismatch")

        if reasons:
            rejected.append({**sample, "reasons": reasons})
        else:
            accepted.append(sample)

    result = {
        "status": "photo-sample-filtered",
        "acceptedSamples": len(accepted),
        "rejectedSamples": len(rejected),
        "coverageReady": False,
        "accepted": accepted,
        "rejected": rejected,
        "nextRequired": [
            "triangle area accumulation",
            "multi-photo fusion",
            "atlas generation",
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "acceptedSamples": len(accepted)}))


if __name__ == "__main__":
    main()
