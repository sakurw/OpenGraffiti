"""Run calibration from geometrically verified photo components.

Only photos connected by RANSAC-verified feature geometry are allowed to share
intrinsics. This keeps lens estimation isolated from unrelated landmark photos.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("inputs")
    p.add_argument("components")
    p.add_argument("--output", required=True)
    args = p.parse_args()

    source = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    components = json.loads(Path(args.components).read_text(encoding="utf-8"))["components"]
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    results = []
    shared = Path(__file__).with_name("texture-building-landmark-shared-lens-calibrate.py")
    single = Path(__file__).with_name("texture-building-landmark-calibrate.py")
    for i, ids in enumerate(components):
        selected = [x for x in source["inputs"] if x["sourceId"] in ids]
        subset = {"status": "geometric-cluster-input", "inputs": selected}
        subset_path = out / f"component-{i}-inputs.json"
        result_path = out / f"component-{i}-calibration.json"
        subset_path.write_text(json.dumps(subset, indent=2), encoding="utf-8")

        if len(selected) > 1:
            cmd = [sys.executable, str(shared), str(subset_path), "--output", str(result_path)]
        else:
            cmd = [sys.executable, str(single), str(subset_path), "--source-id", ids[0], "--output", str(result_path)]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if result_path.exists():
            calibration = json.loads(result_path.read_text(encoding="utf-8"))
        else:
            calibration = {"status": "failed", "error": proc.stderr.strip()}
        results.append({"component": ids, "calibration": calibration})

    Path(out / "geometric-cluster-calibration.json").write_text(
        json.dumps({"status": "geometric-cluster-calibration", "components": results}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
