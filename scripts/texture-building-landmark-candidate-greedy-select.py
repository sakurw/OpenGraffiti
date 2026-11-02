"""Greedy selection of landmark viewpoints using render audit assignments.

This stage selects viewpoints by estimated uncovered render pixels. It is a
bridge until exact candidate depth masks are available; the final 90 percent
gate must still use real pixel union evaluation.
"""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("gain")
    p.add_argument("--target", type=float, default=0.9)
    p.add_argument("--output", required=True)
    a = p.parse_args()

    data = json.loads(Path(a.gain).read_text(encoding="utf-8"))
    candidates = sorted(
        data.get("cameras", []),
        key=lambda x: x.get("estimatedNewPixelsFromTriangleAssignment", 0),
        reverse=True,
    )
    selected = []
    for item in candidates:
        if item.get("estimatedNewPixelsFromTriangleAssignment", 0) <= 0:
            continue
        selected.append(item)

    result = {
        "status": "candidate-greedy-selection",
        "selectionMetric": "estimatedNewPixelsFromTriangleAssignment",
        "selected": selected,
        "targetRatio": a.target,
        "requiresExactRenderVerification": True,
    }
    Path(a.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"selected": len(selected), "output": a.output}))


if __name__ == "__main__":
    main()
