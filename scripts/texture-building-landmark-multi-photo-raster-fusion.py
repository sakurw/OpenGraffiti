"""Fuse multiple landmark photo raster coverage candidates.

Selects the best available photograph for each visible PLATEAU triangle while
keeping the decision tied to source image evidence. This is an intermediate
coverage stage and does not create UVs or claim final texture coverage.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--output", required=True)
    parser.add_argument("--gates", nargs="*", default=[])
    args = parser.parse_args()

    selected = {}
    sources = {}
    gated_depth = {}
    for gate_path in args.gates:
        gate = json.loads(Path(gate_path).read_text(encoding="utf-8"))
        for sample in gate.get("accepted", []):
            triangle_id = str(sample.get("triangleId"))
            gated_depth[triangle_id] = float(sample.get("depthConfidence", 0.0))
    for path in args.inputs:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        sources[path] = data.get("coveredTriangleCount", 0)
        for triangle_id, value in data.get("triangles", {}).items():
            # Prefer samples with larger photographic support while keeping
            # room for future geometric quality terms. Depth/normal scores
            # can be added by the upstream gates without changing fusion.
            photo_pixels = float(value.get("photoPixels", 0))
            depth_confidence = float(value.get("depthConfidence", 1.0))
            if triangle_id in gated_depth:
                depth_confidence *= gated_depth[triangle_id]
            elif args.gates:
                continue
            normal_confidence = float(value.get("normalConfidence", 1.0))
            reprojection_confidence = float(value.get("reprojectionConfidence", 1.0))
            sharpness_confidence = float(value.get("sharpnessConfidence", 1.0))
            exposure_confidence = float(value.get("exposureConfidence", 1.0))
            score = (
                photo_pixels
                * depth_confidence
                * normal_confidence
                * reprojection_confidence
                * sharpness_confidence
                * exposure_confidence
            )
            current = selected.get(triangle_id)
            if current is None or score > current["score"]:
                selected[triangle_id] = {
                    "score": score,
                    "source": path,
                    "surfaceArea": value["surfaceArea"],
                    "photoPixels": photo_pixels,
                    "depthConfidence": depth_confidence,
                    "normalConfidence": normal_confidence,
                    "reprojectionConfidence": reprojection_confidence,
                    "sharpnessConfidence": sharpness_confidence,
                    "exposureConfidence": exposure_confidence,
                }

    result = {
        "status": "landmark-multi-photo-raster-fusion",
        "selectedTriangleCount": len(selected),
        "selectedSurfaceArea": sum(float(v["surfaceArea"]) for v in selected.values()),
        "sourceCoverage": sources,
        "coverageReady": False,
        "requires": ["depth-validation", "normal-validation", "atlas-generation"],
        "depthGateApplied": bool(args.gates),
        "selected": selected,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"selectedTriangleCount": len(selected)}))


if __name__ == "__main__":
    main()
