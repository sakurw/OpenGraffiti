"""Estimate a landmark photo camera from feature matches and PLATEAU geometry.

This connects 2D feature matching to the existing PnP stage. The output is a
candidate registration and must pass reprojection, visibility, and texture
quality validation before being used for coverage measurement.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def screen_triangle_weight(point, triangle):
    """Return barycentric weights when a screen point is inside a triangle."""
    vertices = np.asarray(triangle["screen"], dtype=np.float64)
    p = np.asarray(point, dtype=np.float64)
    a, b, c = vertices
    denominator = ((b[1] - c[1]) * (a[0] - c[0]) +
                   (c[1] - a[1]) * (b[0] - c[0]))
    if abs(denominator) < 1e-9:
        return None
    w0 = ((b[1] - c[1]) * (p[0] - c[0]) +
          (c[1] - b[1]) * (p[1] - c[1])) / denominator
    w1 = ((c[1] - a[1]) * (p[0] - c[0]) +
          (a[1] - c[1]) * (p[1] - c[1])) / denominator
    w2 = 1.0 - w0 - w1
    if min(w0, w1, w2) < -1e-4:
        return None
    return [float(w0), float(w1), float(w2)]


def interpolate_triangle_world(triangle, vertices, weights):
    """Reconstruct a 3D point from the PLATEAU triangle vertices."""
    points = []
    for vertex_id in triangle.get("vertexIds", []):
        points.append(vertices[vertex_id]["world"])
    if len(points) != 3:
        return None
    return np.sum(np.asarray(points, dtype=np.float64) * np.asarray(weights)[:, None], axis=0)


def interpolate_triangle_depth(triangle, weights):
    """Reconstruct WebGL depth at a feature point from triangle vertices."""
    depths = triangle.get("gpuDepths")
    if not depths:
        return None
    return float(np.dot(np.asarray(depths, dtype=np.float64), np.asarray(weights, dtype=np.float64)))


def build_triangle_screen_index(triangles, width, height, cell_size=64):
    """Build a lightweight screen-space index for triangle lookup.

    The previous implementation scanned every triangle for every feature. This
    keeps the exact barycentric validation but reduces candidate checks to the
    local screen cells containing the feature.
    """
    index = {}
    for triangle_id, triangle in enumerate(triangles):
        vertices = np.asarray(triangle["screen"], dtype=np.float64)
        minimum = np.floor(vertices.min(axis=0) / cell_size).astype(int)
        maximum = np.floor(vertices.max(axis=0) / cell_size).astype(int)
        for cy in range(max(0, minimum[1]), min(int(height / cell_size) + 1, maximum[1] + 1)):
            for cx in range(max(0, minimum[0]), min(int(width / cell_size) + 1, maximum[0] + 1)):
                index.setdefault((cx, cy), []).append(triangle_id)
    return index


def indexed_triangle_candidates(index, point, cell_size=64):
    cell = (int(point[0] // cell_size), int(point[1] // cell_size))
    return index.get(cell, [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("matches")
    parser.add_argument("world_image")
    parser.add_argument("--output", required=True)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--max-error", type=float, default=3.0)
    parser.add_argument("--search-radius", type=int, default=2)
    parser.add_argument("--depth")
    parser.add_argument("--depth-tolerance", type=float, default=0.01)
    parser.add_argument("--triangle-input")
    args = parser.parse_args()

    matches = json.loads(Path(args.matches).read_text(encoding="utf-8"))["matches"]
    triangle_data = None
    triangle_vertices = None
    if args.triangle_input:
        triangle_json = json.loads(Path(args.triangle_input).read_text(encoding="utf-8"))
        triangle_data = triangle_json["triangles"]
        triangle_vertices = triangle_json.get("vertices")
    triangle_index = build_triangle_screen_index(triangle_data, args.width, args.height) if triangle_data else None
    raw = np.fromfile(args.world_image, dtype=np.float32)
    world = raw.reshape((768, 1024, 4))[:, :, :3]
    depth = None
    if args.depth:
        depth = np.fromfile(args.depth, dtype=np.float32).reshape((768, 1024, 4))[:, :, 0]

    points3d = []
    points2d = []
    triangle_assignments = []
    depth_rejected = 0
    for item in matches:
        x, y = [int(round(v)) for v in item["renderPixel"]]
        if x < 0 or y < 0 or x >= world.shape[1] or y >= world.shape[0]:
            continue
        candidates = []
        triangle_weights = None
        triangle_id_for_point = None
        if triangle_data:
            candidate_ids = indexed_triangle_candidates(triangle_index, item["renderPixel"]) if triangle_index else range(len(triangle_data))
            for triangle_id in candidate_ids:
                triangle = triangle_data[triangle_id]
                weights = screen_triangle_weight(item["renderPixel"], triangle)
                if weights is not None:
                    triangle_id_for_point = triangle_id
                    triangle_weights = weights
                    break
        if depth is not None and triangle_id_for_point is not None and triangle_weights is not None:
            expected_depth = interpolate_triangle_depth(triangle_data[triangle_id_for_point], triangle_weights)
            if expected_depth is not None:
                observed_depth = float(depth[y, x])
                if not np.isfinite(observed_depth) or abs(observed_depth - expected_depth) > args.depth_tolerance:
                    depth_rejected += 1
                    continue
        for yy in range(max(0, y - args.search_radius), min(world.shape[0], y + args.search_radius + 1)):
            for xx in range(max(0, x - args.search_radius), min(world.shape[1], x + args.search_radius + 1)):
                point = world[yy, xx]
                if np.isfinite(point).all():
                    if depth is not None:
                        gpu_depth = float(depth[yy, xx])
                        if not np.isfinite(gpu_depth) or gpu_depth <= 0:
                            continue
                    candidates.append((abs(xx - x) + abs(yy - y), point))
        if candidates:
            reconstructed = None
            if triangle_id_for_point is not None and triangle_vertices:
                reconstructed = interpolate_triangle_world(
                    triangle_data[triangle_id_for_point], triangle_vertices, triangle_weights
                )
            points3d.append((reconstructed if reconstructed is not None else min(candidates, key=lambda candidate: candidate[0])[1]).tolist())
            points2d.append(item["imagePixel"])
            if triangle_data:
                best_triangle = None
                best_distance = float("inf")
                candidate_ids = indexed_triangle_candidates(triangle_index, item["renderPixel"]) if triangle_index else range(len(triangle_data))
                for triangle_id in candidate_ids:
                    triangle = triangle_data[triangle_id]
                    weights = screen_triangle_weight(item["renderPixel"], triangle)
                    if weights is not None:
                        best_triangle = triangle_id
                        best_distance = 0.0
                        break
                    center = np.mean(np.asarray(triangle["screen"]), axis=0)
                    distance = float(np.linalg.norm(center - np.asarray(item["renderPixel"])))
                    if distance < best_distance:
                        best_distance = distance
                        best_triangle = triangle_id
                triangle_assignments.append({
                    "triangleId": best_triangle,
                    "screenDistance": best_distance,
                    "barycentric": triangle_weights,
                })

    if len(points3d) < 6:
        raise RuntimeError("need at least 6 valid 3D-2D correspondences")

    points3d = np.asarray(points3d, np.float64)
    points2d = np.asarray(points2d, np.float64)
    best = None
    # Consumer photos usually do not expose focal length metadata. Search a
    # bounded focal range and keep the geometrically consistent solution.
    for focal in np.geomspace(max(args.width, args.height) * 0.5, max(args.width, args.height) * 3.0, 48):
        camera = np.array([[focal, 0, args.width / 2], [0, focal, args.height / 2], [0, 0, 1]], np.float64)
        ok, rvec, tvec, inliers = cv2.solvePnPRansac(
            points3d,
            points2d,
            camera,
            None,
            iterationsCount=3000,
            reprojectionError=args.max_error,
            flags=cv2.SOLVEPNP_SQPNP,
        )
        if not ok:
            continue
        projected = cv2.projectPoints(points3d, rvec, tvec, camera, None)[0].reshape(-1, 2)
        errors = np.linalg.norm(projected - points2d, axis=1)
        score = (float(np.sqrt(np.mean(errors ** 2))), -int(len(inliers)))
        if best is None or score < best[0]:
            best = (score, camera, rvec, tvec, inliers, errors)

    if best is None:
        raise RuntimeError("PnP failed")
    _, camera, rvec, tvec, inliers, errors = best
    held_out = errors > args.max_error
    inlier_mask = np.zeros(len(errors), dtype=bool)
    if inliers is not None:
        inlier_mask[inliers.reshape(-1)] = True

    triangle_validation = []
    facing_rejected = 0
    if triangle_data and triangle_assignments:
        rotation, _ = cv2.Rodrigues(rvec)
        camera_position = -rotation.T @ tvec.reshape(3)
        for assignment in triangle_assignments:
            triangle = triangle_data[assignment["triangleId"]]
            normal = triangle.get("normal")
            center = triangle.get("center")
            facing = None
            if normal is not None and center is not None:
                direction = camera_position - np.asarray(center, dtype=np.float64)
                length = np.linalg.norm(direction)
                if length:
                    facing = float(np.dot(np.asarray(normal), direction / length))
                    if facing < 0:
                        facing_rejected += 1
            triangle_validation.append({
                **assignment,
                "cameraFacingDot": facing,
            })

    result = {
        "status": "candidate-registration-only",
        "method": "sift-to-plateau-world-sqpnp-ransac",
        "correspondences": len(points3d),
        "inliers": int(len(inliers)) if inliers is not None else 0,
        "rmsPixels": float(np.sqrt(np.mean(errors ** 2))),
        "maxReprojectionError": float(errors.max()),
        "heldOutErrorCount": int(held_out.sum()),
        "reprojectionValidation": {
            "inlierRatio": float(inlier_mask.mean()) if len(inlier_mask) else 0.0,
            "heldOutRatio": float(held_out.mean()) if len(held_out) else 0.0,
            "passed": bool(held_out.mean() <= 0.1 and np.sqrt(np.mean(errors ** 2)) <= args.max_error),
        },
        "pixelNeighborhoodSearchRadius": args.search_radius,
        "depthFilter": {
            "enabled": bool(args.depth),
            "tolerance": args.depth_tolerance,
            "triangleDepthRejected": depth_rejected,
        },
        "triangleMetadata": {
            "enabled": bool(triangle_data),
            "assigned": len(triangle_assignments),
            "backFaceCandidates": facing_rejected,
            "assignments": triangle_validation if triangle_validation else triangle_assignments,
        },
        "cameraMatrix": camera.tolist(),
        "rotationVector": rvec.reshape(3).tolist(),
        "translationVector": tvec.reshape(3).tolist(),
        "validationRequired": ["held-out-controls", "visibility", "texture-coverage"],
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
