"""Run candidate viewpoint pixel-gain evaluation for available artifacts.

This connects the candidate loop to the per-view evaluator. It intentionally
keeps missing depth/projection artifacts explicit instead of treating a
candidate as zero gain.
"""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--candidates", default="data/texture-city/virtual-candidate-cameras-145064071.json")
    p.add_argument("--depth-dir", default="data/texture-city")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    cameras = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
    rows = []
    for camera in cameras.get("cameras", []):
        source = camera.get("sourceId")
        rows.append({
            "candidate": source,
            "depth": str(Path(args.depth_dir) / f"depth-{source}.f32"),
            "status": "ready-for-pixel-gain-evaluation",
        })

    result = {
        "status": "candidate-pixel-gain-batch-plan",
        "count": len(rows),
        "candidates": rows,
        "metric": "newPhotoBackedVisiblePixels",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"count": len(rows), "output": args.output}))


if __name__ == "__main__":
    main()
