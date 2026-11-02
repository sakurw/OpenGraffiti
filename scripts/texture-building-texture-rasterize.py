"""Generate perspective-correct texture patches from validated photo triangles.

The input sample provenance is converted into triangle patches. The generated
metadata keeps the source image coordinates and the patch geometry required by
the later atlas packing stage.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def find_triangle(data, triangle_id):
    for triangle in data.get("triangles", []):
        if str(triangle.get("id")) == str(triangle_id):
            return triangle
    return None


def warp_triangle(image, triangle, padding):
    screen = triangle.get("screen")
    if not screen or len(screen) != 3:
        return None, None

    source = np.float32([point[:2] for point in screen])
    width = max(8, int(np.linalg.norm(source[0] - source[1]))) + padding * 2
    height = max(8, int(np.linalg.norm(source[1] - source[2]))) + padding * 2
    target = np.float32([
        [padding, padding],
        [width - padding, padding],
        [padding, height - padding],
    ])

    matrix = cv2.getAffineTransform(source, target)
    patch = cv2.warpAffine(image, matrix, (width, height))
    return patch, matrix.tolist()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("photo")
    parser.add_argument("fusion")
    parser.add_argument("triangles")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--padding", type=int, default=2)
    args = parser.parse_args()

    image = cv2.imread(args.photo, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot read photo: {args.photo}")

    fusion = json.loads(Path(args.fusion).read_text(encoding="utf-8"))
    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)

    patches = []
    for triangle_id, sample in fusion.get("selected", {}).items():
        triangle = find_triangle(triangles, triangle_id)
        if triangle is None:
            continue

        patch, transform = warp_triangle(image, triangle, args.padding)
        if patch is None or patch.size == 0:
            continue

        filename = f"triangle-{triangle_id}.png"
        cv2.imwrite(str(output / filename), patch)
        patches.append({
            "triangleId": triangle_id,
            "patch": filename,
            "sourcePixel": sample.get("sourcePixel"),
            "sourceTriangle": triangle.get("screen"),
            "affineTransform": transform,
            "qualityScore": sample.get("qualityScore"),
        })

    result = {
        "status": "perspective-texture-patches-generated",
        "patchCount": len(patches),
        "patches": patches,
    }
    (output / "texture-patches.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(json.dumps({"patchCount": len(patches)}))


if __name__ == "__main__":
    main()
