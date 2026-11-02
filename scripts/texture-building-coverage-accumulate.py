"""Accumulate validated photo samples into an area coverage measurement.

Coverage must be based on PLATEAU surface area, so this stage keeps triangle
identity and counts only samples that survived depth, normal and quality gates.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("samples")
    parser.add_argument("triangle_area", help="JSON file containing triangleId to surface area")
    parser.add_argument("--visible-area", help="Optional JSON file containing visibleTriangleAreas")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    samples = json.loads(Path(args.samples).read_text(encoding="utf-8"))
    areas = json.loads(Path(args.triangle_area).read_text(encoding="utf-8"))

    triangle_areas = areas.get("triangleAreas", {})
    if not triangle_areas:
        triangle_areas = samples.get("triangleAreas", {})
    visible_areas = triangle_areas
    if args.visible_area:
        visible_data = json.loads(Path(args.visible_area).read_text(encoding="utf-8"))
        visible_areas = visible_data.get("visibleTriangleAreas", visible_areas)
    covered = set()
    sample_counts = {}
    for sample in samples.get("accepted", []):
        triangle_id = str(sample.get("triangleId"))
        if triangle_id in visible_areas:
            covered.add(triangle_id)
            sample_counts[triangle_id] = sample_counts.get(triangle_id, 0) + 1

    total_area = sum(float(v) for v in visible_areas.values())
    # A single projected sample is evidence that a triangle is visible, but it
    # does not prove the whole triangle is photographically covered. Keep the
    # conservative area estimate based on the sampling density when available.
    covered_area = 0.0
    for triangle_id in covered:
        density = min(1.0, sample_counts[triangle_id] / 16.0)
        covered_area += float(visible_areas[triangle_id]) * density

    result = {
        "status": "area-weighted-coverage-measurement",
        "visibleTriangleArea": total_area,
        "coveredTriangleArea": covered_area,
        "coverageRatio": covered_area / total_area if total_area else 0.0,
        "targetRatio": 0.9,
        "targetReached": covered_area / total_area >= 0.9 if total_area else False,
        "triangleCount": len(covered),
        "sampleCounts": sample_counts,
        "validation": {
            "requiresRealPhoto": True,
            "requiresDepthValidation": True,
            "requiresNormalValidation": True,
            "requiresFusion": True,
        },
        "measurementSource": "validated-photo-samples-with-triangle-area",
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
