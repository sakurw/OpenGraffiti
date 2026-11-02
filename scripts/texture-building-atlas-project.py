"""Create a measured texture atlas projection candidate.

This keeps the final coverage metric tied to validated registration and
visibility evidence. It writes provenance data instead of inventing pixels.
"""
import argparse
import json
from pathlib import Path


def normalize_uv(pixel, width, height):
    return [float(pixel[0]) / width, float(pixel[1]) / height]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("registration")
    parser.add_argument("visibility")
    parser.add_argument("--fusion")
    parser.add_argument("--photo-width", type=int)
    parser.add_argument("--photo-height", type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    registration = json.loads(Path(args.registration).read_text(encoding="utf-8"))
    visibility = json.loads(Path(args.visibility).read_text(encoding="utf-8"))
    fusion = json.loads(Path(args.fusion).read_text(encoding="utf-8")) if args.fusion else {}

    passed = bool(registration.get("reprojectionValidation", {}).get("passed"))
    visible_pixels = int(visibility.get("visiblePixels", 0))

    result = {
        "status": "atlas-projection-candidate",
        "accepted": passed and visible_pixels > 0,
        "sourceEvidence": {
            "registrationPassed": passed,
            "visiblePixels": visible_pixels,
        },
        "provenance": {
            "requiresSourcePixelMapping": True,
            "requiresDepthOcclusion": True,
            "requiresQualityFusion": True,
        },
        "atlasTriangles": [
            {
                "triangleId": triangle_id,
                "primitiveId": sample.get("primitiveId"),
                "indexOffset": sample.get("indexOffset"),
                "vertexIds": sample.get("vertexIds"),
                "sourcePixel": sample.get("sourcePixel"),
                "sourceUV": normalize_uv(sample["sourcePixel"], args.photo_width, args.photo_height)
                if args.photo_width and args.photo_height and sample.get("sourcePixel") else None,
                "qualityScore": sample.get("qualityScore"),
            }
            for triangle_id, sample in fusion.get("selected", {}).items()
        ],
        "nextRequired": [
            "source-pixel-to-triangle-mapping",
            "multi-photo-fusion",
            "area-weighted-coverage",
        ],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
