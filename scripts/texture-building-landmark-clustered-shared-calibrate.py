"""Run shared-lens calibration independently for detected photo clusters."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs")
    parser.add_argument("clusters")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    clusters = json.loads(Path(args.clusters).read_text(encoding="utf-8"))["clusters"]
    inputs = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for index, cluster in enumerate(clusters):
        ids = set(cluster["sourceIds"])
        subset = {
            "status": "cluster-inputs",
            "inputs": [x for x in inputs["inputs"] if x["sourceId"] in ids],
        }
        subset_path = output_dir / f"cluster-{index}-inputs.json"
        result_path = output_dir / f"cluster-{index}-calibration.json"
        subset_path.write_text(json.dumps(subset, indent=2), encoding="utf-8")
        if len(subset["inputs"]) == 1:
            command = [
                sys.executable,
                str(Path(__file__).with_name("texture-building-landmark-calibrate.py")),
                str(subset_path),
                "--source-id",
                subset["inputs"][0]["sourceId"],
                "--output",
                str(result_path),
            ]
        else:
            command = [
                sys.executable,
                str(Path(__file__).with_name("texture-building-landmark-shared-lens-calibrate.py")),
                str(subset_path),
                "--output",
                str(result_path),
            ]
        process = subprocess.run(command, check=False, capture_output=True, text=True)
        if process.returncode != 0 or not result_path.exists():
            results.append({
                "cluster": cluster,
                "calibration": {
                    "status": "calibration-failed",
                    "error": process.stderr.strip(),
                },
            })
            continue
        result = json.loads(result_path.read_text(encoding="utf-8"))
        results.append({
            "cluster": cluster,
            "calibration": result,
        })

    Path(args.output, "clustered-shared-calibration.json").write_text(
        json.dumps({"status": "clustered-shared-calibration", "clusters": results}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
