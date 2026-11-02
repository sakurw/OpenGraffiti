"""Aggregate landmark render coverage from multiple camera views.

The landmark target is evaluated per rendered view and the weakest view is
used as the acceptance value. This prevents a single favorable camera angle
from hiding uncovered facade areas.
"""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", help="final-render-photo-coverage JSON files")
    parser.add_argument("--output", default="data/texture-city/landmark-multi-view-coverage.json")
    parser.add_argument("--minimum-views", type=int, default=4)
    args = parser.parse_args()

    views = []
    for path in args.inputs:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        views.append({
            "source": path,
            "coverageRatio": data.get("coverageRatio", 0.0),
            "visibleSurfacePixels": data.get("visibleSurfacePixels", 0),
            "photoBackedPixels": data.get("photoBackedPixels", 0),
        })

    minimum = min((v["coverageRatio"] for v in views), default=0.0)
    result = {
        "status": "landmark-multi-view-coverage",
        "viewCount": len(views),
        "minimumCoverageRatio": minimum,
        "targetRatio": 0.9,
        "targetReached": minimum >= 0.9,
        "viewCountRequirement": len(views) >= args.minimum_views,
        "evaluationReady": len(views) >= args.minimum_views and minimum >= 0.9,
        "views": views,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
