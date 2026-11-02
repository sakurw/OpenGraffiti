"""Create conservative photo-to-triangle projection samples.

This stage turns triangle screen evidence into measurable samples. It keeps the
coverage pipeline tied to actual source pixels and does not mark a triangle as
covered unless samples are explicitly produced.
"""

import argparse
import json
from pathlib import Path
import numpy as np
import cv2


def barycentric(point, tri):
    ax, ay = tri[0]
    bx, by = tri[1]
    cx, cy = tri[2]
    px, py = point
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(det) < 1e-8:
        return None
    a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
    b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
    c = 1 - a - b
    return a, b, c


def dot_normal_quality(normal, camera_position, sample_position):
    if normal is None or sample_position is None:
        return None
    if len(camera_position) != 3 or len(sample_position) != 3:
        return None
    direction = np.array(camera_position, dtype=float) - np.array(sample_position, dtype=float)
    length = np.linalg.norm(direction)
    if length == 0:
        return None
    direction /= length
    value = float(np.dot(np.array(normal, dtype=float), direction))
    return value


def triangle_world_point(vertices, triangle, weights):
    ids = triangle.get("vertexIds")
    if not vertices or not ids or len(ids) != 3:
        return None
    points = [vertices[i].get("world") for i in ids]
    if any(p is None for p in points):
        return None
    return [
        sum(weights[i] * points[i][axis] for i in range(3))
        for axis in range(3)
    ]


def triangle_area(vertices, triangle):
    ids = triangle.get("vertexIds")
    if not vertices or not ids or len(ids) != 3:
        return 0.0
    points = [np.array(vertices[i]["world"], dtype=float) for i in ids]
    return float(np.linalg.norm(np.cross(points[1] - points[0], points[2] - points[0])) / 2.0)


def triangle_normal(vertices, triangle):
    ids = triangle.get("vertexIds")
    if not vertices or not ids or len(ids) != 3:
        return None
    points = [np.array(vertices[i].get("world"), dtype=float) for i in ids]
    if any(point is None for point in points):
        return None
    normal = np.cross(points[1] - points[0], points[2] - points[0])
    length = np.linalg.norm(normal)
    if length == 0:
        return None
    return (normal / length).tolist()


def photo_quality(image, x, y):
    if image is None:
        return None
    h, w = image.shape[:2]
    x = int(round(x))
    y = int(round(y))
    if x < 1 or y < 1 or x >= w - 1 or y >= h - 1:
        return None
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    patch = gray[max(0, y - 4):min(h, y + 5), max(0, x - 4):min(w, x + 5)]
    if patch.size == 0:
        return None
    sharpness = float(cv2.Laplacian(patch, cv2.CV_64F).var())
    brightness = float(np.mean(patch))
    sharp_score = min(1.0, sharpness / 500.0)
    exposure_score = max(0.0, 1.0 - abs(brightness - 128.0) / 128.0)
    return 0.7 * sharp_score + 0.3 * exposure_score


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangles")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--step", type=int, default=4)
    parser.add_argument("--depth")
    parser.add_argument("--resolution", nargs=2, type=int)
    parser.add_argument("--depth-tolerance", type=float, default=0.02)
    parser.add_argument("--normal-angle", type=float, default=45.0)
    parser.add_argument("--camera")
    parser.add_argument("--photo")
    parser.add_argument("--vertices")
    parser.add_argument("--visible-area")
    parser.add_argument("--quality-threshold", type=float, default=0.5)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding="utf-8"))
    vertices = None
    if args.vertices:
        vertices = json.loads(Path(args.vertices).read_text(encoding="utf-8")).get("vertices")
    camera = None
    if args.camera:
        camera = json.loads(Path(args.camera).read_text(encoding="utf-8"))
    photo = cv2.imread(args.photo) if args.photo else None
    visible_triangle_ids = None
    if args.visible_area:
        visible_data = json.loads(Path(args.visible_area).read_text(encoding="utf-8"))
        visible_triangle_ids = {
            int(k) for k, area in visible_data.get("visibleTriangleAreas", {}).items()
            if float(area) > 0
        }
    depth_image = None
    if args.depth:
        if not args.resolution:
            raise RuntimeError("--resolution is required with --depth")
        width, height = args.resolution
        raw = np.fromfile(args.depth, dtype=np.float32)
        depth_image = raw.reshape((height, width, 4))[:, :, 0]
    samples = []
    for triangle_id, triangle in enumerate(data.get("triangles", [])):
        if visible_triangle_ids is not None and triangle_id not in visible_triangle_ids:
            continue
        screen = triangle.get("screen")
        if not screen or len(screen) != 3:
            continue
        min_x = max(0, int(min(p[0] for p in screen)))
        max_x = min(args.width - 1, int(max(p[0] for p in screen)))
        min_y = max(0, int(min(p[1] for p in screen)))
        max_y = min(args.height - 1, int(max(p[1] for p in screen)))
        for y in range(min_y, max_y + 1, args.step):
            for x in range(min_x, max_x + 1, args.step):
                weights = barycentric((x + 0.5, y + 0.5), screen)
                if weights and min(weights) >= 0:
                    expected_depth = sum(
                        w * d for w, d in zip(weights, triangle.get("gpuDepths", [0, 0, 0]))
                    )
                    depth_passed = True
                    if depth_image is not None:
                        if 0 <= y < depth_image.shape[0] and 0 <= x < depth_image.shape[1]:
                            depth_passed = abs(float(depth_image[y, x]) - expected_depth) <= args.depth_tolerance
                        else:
                            depth_passed = False
                    normal = triangle.get("normal") or triangle_normal(vertices, triangle)
                    normal_quality = None
                    if camera and normal:
                        world_position = triangle_world_point(vertices, triangle, weights)
                        normal_quality = dot_normal_quality(normal, camera.get("position"), world_position)
                    # GLB winding is not guaranteed to match the camera-facing
                    # side used for photographic projection. Keep the angular
                    # quality signless here and let occlusion/depth validation
                    # decide whether the surface is usable.
                    normal_passed = bool(normal_quality is not None and abs(normal_quality) >= np.cos(np.radians(args.normal_angle)))
                    samples.append({
                        "triangleId": triangle.get("id", triangle_id),
                        "primitiveId": triangle.get("primitiveId"),
                        "indexOffset": triangle.get("indexOffset"),
                        "vertexIds": triangle.get("vertexIds"),
                        "sourcePixel": [x + 0.5, y + 0.5],
                        "barycentric": list(weights),
                        "expectedDepth": expected_depth,
                        "depthPassed": depth_passed,
                        "normal": normal,
                        "normalPassed": normal_passed,
                        "normalQuality": normal_quality,
                        "worldPosition": triangle_world_point(vertices, triangle, weights),
                        "triangleArea": triangle_area(vertices, triangle),
                        "qualityScore": photo_quality(photo, x + 0.5, y + 0.5),
                    })

    result = {
        "status": "photo-projection-samples",
        "sampleCount": len(samples),
        "coverageReady": False,
        "reason": "depth normal and photo quality gates are required before coverage",
        "accepted": [
            sample for sample in samples
            if sample["depthPassed"]
            and sample["normalPassed"]
            and sample["qualityScore"] is not None
            and sample["qualityScore"] >= args.quality_threshold
        ],
        "triangleAreas": {
            str(index): triangle_area(vertices, triangle)
            for index, triangle in enumerate(data.get("triangles", []))
        },
        "samples": samples,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"sampleCount": len(samples)}))


if __name__ == "__main__":
    main()
