"""Audit evidence completeness for a landmark photographic texture result."""
import json
from pathlib import Path
import argparse


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--coverage", default="data/texture-city/final-render-photo-coverage.json")
    p.add_argument("--uv", default="data/texture-city/landmark-atlas-uv-v3.json")
    p.add_argument("--output", default="data/texture-city/landmark-final-audit.json")
    p.add_argument("--fusion", default="data/texture-city/landmark-multi-photo-fusion-v2.json")
    args = p.parse_args()

    coverage = load(args.coverage)
    uv = load(args.uv)
    fusion = load(args.fusion)
    mappings = uv.get("mappings", [])
    quality_scores = []
    for x in mappings:
        try:
            quality_scores.append(float(x.get("qualityScore", 0)))
        except (TypeError, ValueError):
            continue
    checks = {
        "renderCoverageAvailable": coverage.get("status") == "final-render-photo-coverage",
        "targetReached": coverage.get("targetReached", False),
        "visibleSurfacePixelsPositive": coverage.get("visibleSurfacePixels", 0) > 0,
        "photoBackedPixelsPositive": coverage.get("photoBackedPixels", 0) > 0,
        "atlasMappingsAvailable": len(mappings) > 0,
        "atlasQualityScoresAvailable": bool(quality_scores) and max(quality_scores) > 0,
        "multiPhotoFusionAvailable": fusion.get("status") == "landmark-multi-photo-raster-fusion",
        "depthGateApplied": fusion.get("depthGateApplied", False),
    }
    result = {
        "status": "landmark-final-audit",
        "checks": checks,
        "passed": all(checks.values()),
        "coverageRatio": coverage.get("coverageRatio"),
        "atlasMappingCount": len(mappings),
        "atlasMinimumQualityScore": min(quality_scores) if quality_scores else 0,
        "atlasMaximumQualityScore": max(quality_scores) if quality_scores else 0,
        "fusionSelectedTriangleCount": fusion.get("selectedTriangleCount", 0),
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
