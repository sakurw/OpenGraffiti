"""Audit landmark render coverage across required camera views."""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--inputs", nargs="+", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    rows = []
    for filename in args.inputs:
        data = json.loads(Path(filename).read_text(encoding="utf-8"))
        rows.append({
            "file": filename,
            "coverageRatio": data.get("coverageRatio"),
            "targetReached": bool(data.get("targetReached")),
            "visibleSurfacePixels": data.get("visibleSurfacePixels", 0),
            "photoBackedPixels": data.get("photoBackedPixels", 0),
        })

    result = {
        "status": "landmark-multi-view-final-audit",
        "viewCount": len(rows),
        "allTargetReached": all(x["targetReached"] for x in rows),
        "minimumCoverageRatio": min(x["coverageRatio"] for x in rows),
        "views": rows,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
