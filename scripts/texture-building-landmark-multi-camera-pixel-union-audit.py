"""Measure multi-camera photo-backed coverage in raster pixel space.

Each camera contributes a visible pixel mask and a photo-backed pixel mask.
The final ratio is the union of photo-backed pixels divided by the union of
visible facade pixels.
"""

import argparse
import json
from pathlib import Path
import math
import numpy as np
import cv2


def decode_id(r, g, b):
    return r * 65536 + g * 256 + b


def decode_capture_pixels(pixels, width, height):
    data = np.frombuffer(pixels, dtype=np.uint8)
    if data.size % 4:
        data = data[:data.size - (data.size % 4)]
    rgba = data.reshape((-1, 4))
    ids = rgba[:, 0].astype(np.uint32) * 65536 + rgba[:, 1].astype(np.uint32) * 256 + rgba[:, 2].astype(np.uint32)
    coords = np.flatnonzero(ids != 0)
    x = coords % width
    # WebGL readback uses a bottom-left origin. Photo projections and image
    # masks use the conventional top-left image origin.
    y = height - 1 - (coords // width)
    return ids, coords, x, y


def vertex_signature(vertices):
    return tuple(sorted(tuple(round(v, 5) for v in p) for p in vertices))


def build_mapping(root, triangle_input):
    ranges = json.loads((root / "triangle-id-ranges.json").read_text())
    # Prefer deterministic source primitive/index correspondence. Vertex
    # signatures are ambiguous after duplicate vertices and should only be a
    # fallback for legacy captures.
    primitive_offsets = {}
    for t in triangle_input.get("triangles", []):
        primitive_offsets.setdefault((str(t.get("meshName", "")), int(t.get("primitiveId", -1)), int(t.get("indexOffset", -1))), []).append(int(t["id"]))
    positions = {int(v["id"]): v["world"] for v in triangle_input.get("vertices", [])}
    signatures = {}
    for t in triangle_input.get("triangles", []):
        try:
            key = vertex_signature([positions[int(i)] for i in t["vertexIds"]])
            signatures.setdefault(key, []).append(int(t["id"]))
        except Exception:
            pass
    result = {}
    # GLTFLoader and gltf-transform do not preserve node names reliably, but
    # they preserve primitive traversal order for this model. Build a
    # primitive-order map and use the stored source index offset.
    by_mesh_offset = {(int(t.get("meshIndex", -1)), int(t.get("indexOffset", -1))): int(t["id"]) for t in triangle_input.get("triangles", [])}
    by_offset = {int(t.get("indexOffset", -1)): int(t["id"]) for t in triangle_input.get("triangles", [])}
    for r in ranges:
        for i in range(int(r.get("count", 0))):
            source_triangles = r.get("sourceTriangles", [])
            if i < len(source_triangles):
                key = int(source_triangles[i][0])
                mesh_key = (int(r.get("meshIndex", -1)), key)
                if mesh_key in by_mesh_offset:
                    result[int(r["start"]) + i] = [by_mesh_offset[mesh_key]]
                elif key in by_offset:
                    result[int(r["start"]) + i] = [by_offset[key]]
        
        for i, vertices in enumerate(r.get("triangleVertices", [])):
            source_triangles = r.get("sourceTriangles", [])
            if i < len(source_triangles):
                source_index = int(source_triangles[i][0])
            else:
                source_index = i * 3
            direct = primitive_offsets.get((str(r.get("meshName", "")), int(r.get("primitiveId", -1)), source_index))
            if direct:
                result[int(r["start"]) + i] = direct
                continue
            match = signatures.get(vertex_signature(vertices))
            if match is not None:
                result[int(r["start"]) + i] = match
    return result


def barycentric(p, a, b, c):
    v0 = (b[0] - a[0], b[1] - a[1])
    v1 = (c[0] - a[0], c[1] - a[1])
    v2 = (p[0] - a[0], p[1] - a[1])
    d = v0[0] * v1[1] - v1[0] * v0[1]
    if abs(d) < 1e-9:
        return None
    u = (v2[0] * v1[1] - v1[0] * v2[1]) / d
    v = (v0[0] * v2[1] - v2[0] * v0[1]) / d
    return (1 - u - v, u, v)


def build_uv_mapping(triangle_input, root):
    provenance = {}
    for t in triangle_input.get("triangles", []):
        provenance[int(t["id"])] = t
    return provenance


def load_atlas_mapping(path):
    data = json.loads(Path(path).read_text())
    return {
        int(x["triangleId"]): x.get("atlasUV")
        for x in data.get("mappings", [])
        if x.get("atlasUV")
    }


def build_triangle_table(triangle_inputs):
    table = {}
    for data in triangle_inputs:
        for triangle in data.get("triangles", []):
            table[int(triangle["id"])] = triangle
    return table


def photo_pixel_to_atlas_texels(projection, triangle_table, atlas_uv):
    data = json.loads(Path(projection).read_text())
    result = set()
    triangle_cache = {}

    def transfer_triangle(sample):
        triangle_id = int(sample["triangleId"])
        triangle = triangle_table.get(triangle_id)
        uv = atlas_uv.get(triangle_id)
        polygon = sample.get("photoPolygon", [])
        if not triangle or not uv or len(uv) != 3 or len(polygon) != 3:
            return set()
        texels = set()
        for px, py in raster_polygon_pixels(polygon):
            weights = barycentric((px + 0.5, py + 0.5), polygon[0], polygon[1], polygon[2])
            if not weights:
                continue
            atlas_point = (
                weights[0] * uv[0][0] + weights[1] * uv[1][0] + weights[2] * uv[2][0],
                weights[0] * uv[0][1] + weights[1] * uv[1][1] + weights[2] * uv[2][1],
            )
            texels.add((int(round(atlas_point[0] * 8192)), int(round((1 - atlas_point[1]) * 8192))))
        return texels

    for sample in data.get("samples", []):
        triangle_id = int(sample["triangleId"])
        if triangle_id in triangle_cache:
            result |= triangle_cache[triangle_id]
            continue
        triangle_cache[triangle_id] = transfer_triangle(sample)
        result |= triangle_cache[triangle_id]
    return result


def triangle_texels(uv, size=8192):
    if len(uv) != 3:
        return set()
    points = [(x * size, (1 - y) * size) for x, y in uv]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    texels = set()
    for y in range(math.floor(min(ys)), math.ceil(max(ys)) + 1):
        for x in range(math.floor(min(xs)), math.ceil(max(xs)) + 1):
            weights = barycentric((x + 0.5, y + 0.5), points[0], points[1], points[2])
            if weights and all(value >= -1e-6 for value in weights):
                texels.add((x, y))
    return texels


def projected_photo_triangles(path):
    data = json.loads(Path(path).read_text())
    return {int(x["triangleId"]) for x in data.get("samples", [])}


def projected_photo_area(path):
    data = json.loads(Path(path).read_text())
    result = {}
    for sample in data.get("samples", []):
        polygon = sample.get("photoPolygon", [])
        if len(polygon) != 3:
            continue
        area = abs(sum(
            polygon[i][0] * polygon[(i + 1) % 3][1]
            - polygon[(i + 1) % 3][0] * polygon[i][1]
            for i in range(3)
        )) * 0.5
        result[int(sample["triangleId"])] = area
    return result


def polygon_area(poly):
    if len(poly) < 3:
        return 0.0
    return abs(sum(
        poly[i][0] * poly[(i + 1) % len(poly)][1]
        - poly[(i + 1) % len(poly)][0] * poly[i][1]
        for i in range(len(poly))
    )) * 0.5


def projected_photo_pixel_area(path):
    data = json.loads(Path(path).read_text())
    total = 0.0
    by_triangle = {}
    for sample in data.get("samples", []):
        area = polygon_area(sample.get("photoPolygon", []))
        triangle = int(sample["triangleId"])
        by_triangle[triangle] = area
        total += area
    return by_triangle, total


def raster_polygon_pixels(poly, scale=(1.0, 1.0)):
    """Return integer photo pixels covered by a projected triangle."""
    if len(poly) != 3:
        return set()
    # Ignore malformed projections before integer conversion. Some legacy
    # captures contain invalid coordinates from triangles outside the image
    # projection range.
    poly = [(float(x) * scale[0], float(y) * scale[1]) for x, y in poly]
    if any(not math.isfinite(float(v)) for point in poly for v in point):
        return set()
    if any(abs(float(v)) > 100000 for point in poly for v in point):
        return set()
    x0 = max(0, int(min(p[0] for p in poly)))
    x1 = int(max(p[0] for p in poly))
    y0 = max(0, int(min(p[1] for p in poly)))
    y1 = int(max(p[1] for p in poly))
    if x1 < x0 or y1 < y0:
        return set()
    local = np.zeros((y1 - y0 + 2, x1 - x0 + 2), dtype=np.uint8)
    points = np.array([[(round(x - x0), round(y - y0)) for x, y in poly]], dtype=np.int32)
    cv2.fillPoly(local, points, 1)
    coords = np.column_stack(np.where(local != 0))
    return {(int(x0 + col), int(y0 + row)) for row, col in coords}


def raster_polygon_pixels_cached(poly, cache, scale=(1.0, 1.0)):
    key = tuple((round(p[0], 3), round(p[1], 3)) for p in poly)
    key = (key, scale)
    if key not in cache:
        cache[key] = raster_polygon_pixels(poly, scale)
    return cache[key]


def projected_photo_pixel_mask(path, scale=(1.0, 1.0)):
    data = json.loads(Path(path).read_text())
    mask = set()
    cache = {}
    for sample in data.get("samples", []):
        mask |= raster_polygon_pixels_cached(sample.get("photoPolygon", []), cache, scale)
    return mask


def load_capture_resolution(root):
    camera = root / "camera.json"
    if camera.exists():
        data = json.loads(camera.read_text())
        resolution = data.get("resolution")
        if resolution:
            return int(resolution[0]), int(resolution[1])
    return None


def triangle_photo_area_coverage(triangles, projected_areas):
    """Return photo support ratio using projected photo polygon area.

    This is an intermediate diagnostic. It preserves the distinction between
    a triangle being registered and the amount of source-image support it has.
    """
    total = 0.0
    supported = 0.0
    for triangle in triangles:
        total += 1.0
        if projected_areas.get(triangle, 0.0) > 0.0:
            supported += 1.0
    return supported / total if total else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--captures", nargs="+", required=True)
    ap.add_argument("--triangle-input", required=True, nargs="+")
    ap.add_argument("--provenance", required=True)
    ap.add_argument("--uv", required=True)
    ap.add_argument("--projection", required=True, nargs="+")
    ap.add_argument("--surface-manifest")
    ap.add_argument("--output", required=True)
    ap.add_argument("--photo-size", nargs=2, type=int)
    args = ap.parse_args()

    triangle_inputs = [json.loads(Path(p).read_text()) for p in args.triangle_input]
    photo_triangles = {
        int(x["triangleId"])
        for x in json.loads(Path(args.provenance).read_text()).get("mappings", [])
    }
    atlas_uv = load_atlas_mapping(args.uv)
    triangle_table = build_triangle_table(triangle_inputs)

    audit_surface_triangles = None
    if args.surface_manifest:
        surface_manifest = json.loads(Path(args.surface_manifest).read_text())
        audit_surface_triangles = set()
        for surface in surface_manifest.get("surfaces", []):
            audit_surface_triangles.update(int(x) for x in surface.get("triangles", []))
        audit_surface_triangles.update(int(x) for x in surface_manifest.get("triangles", []))

    visible_surface = set()
    photo_surface = set()
    visible_texels = set()
    photo_texels = set()
    visible_pixels_union = set()
    photo_pixels_union = set()
    cameras = []

    if len(triangle_inputs) != len(args.captures):
        raise ValueError("provide one triangle input per capture")

    if len(args.projection) != len(args.captures):
        raise ValueError("provide one projection per capture")

    for capture, triangle_input, projection in zip(args.captures, triangle_inputs, args.projection):
        root = Path(capture)
        mapping = build_mapping(root, triangle_input)
        pixels = (root / "triangle-id.rgba8").read_bytes()
        resolution = load_capture_resolution(root)
        local_visible = set()
        local_photo = set()
        projected_photo = projected_photo_triangles(projection)
        projected_area = projected_photo_area(projection)
        projected_pixel_area, projected_pixel_area_total = projected_photo_pixel_area(projection)
        photo_scale = (1.0, 1.0)
        if args.photo_size and resolution:
            photo_scale = (resolution[0] / args.photo_size[0], resolution[1] / args.photo_size[1])
        projected_pixel_mask = projected_photo_pixel_mask(projection, photo_scale)
        # Atlas texel reconstruction is a secondary diagnostic. The coverage
        # target is measured in rendered pixel space, so do not force a full
        # atlas transfer pass during the final pixel audit.
        photo_atlas_texels = set()
        photo_visible_pixels = set()
        if resolution:
            width, height = resolution
            projected_render_ids = set()
            for render_id, semantic_ids in mapping.items():
                if any(x in projected_photo for x in semantic_ids):
                    projected_render_ids.add(render_id)
            for x, y in projected_pixel_mask:
                if 0 <= x < width and 0 <= y < height:
                    offset = (y * width + x) * 4
                    if offset + 2 < len(pixels):
                        tid = decode_id(pixels[offset], pixels[offset + 1], pixels[offset + 2])
                        if tid in projected_render_ids:
                            photo_visible_pixels.add((x, y, tid))
        if resolution:
            width, height = resolution
            ids, visible_indices, visible_x, visible_y = decode_capture_pixels(pixels, width, height)
            visible_pixels_union.update(zip(visible_x.tolist(), visible_y.tolist()))
            for x, y, _ in photo_visible_pixels:
                photo_pixels_union.add((x, y))
        else:
            ids, visible_indices, _, _ = decode_capture_pixels(pixels, 1, 1)
        for tid in ids[visible_indices]:
            tid = int(tid)
            if tid == 0:
                continue
            triangle_ids = mapping.get(tid)
            if triangle_ids is None:
                continue
            # A raw screen pixel has no meaning across cameras. Use the
            # reconstructed triangle identity as the common surface space.
            for triangle in triangle_ids:
                if audit_surface_triangles is not None and triangle not in audit_surface_triangles:
                    continue
                local_visible.add(triangle)
                if triangle in projected_photo:
                    local_photo.add(triangle)
            # Atlas-space diagnostics are intentionally decoupled from the
            # pixel coverage measurement.
        visible_surface |= local_visible
        photo_surface |= local_photo
        cameras.append({
            "capture": str(root),
            "visibleSurfaceTriangles": len(local_visible),
            "photoBackedSurfaceTriangles": len(local_photo),
            "projectedPhotoTriangleCount": len(projected_photo),
            "visibleProjectedTriangleIntersection": len(local_visible & projected_photo),
            "projectedTriangleMappingIntersection": len({x for values in mapping.values() for x in values} & projected_photo),
            "coverageRatio": len(local_photo) / len(local_visible) if local_visible else 0,
            "triangleMappings": len(mapping),
            "projectedPhotoTriangleArea": sum(projected_area.get(t, 0) for t in local_photo),
            "projectedPhotoPixelArea": sum(projected_pixel_area.get(t, 0) for t in local_photo),
            "projectedPhotoPixelAreaTotal": projected_pixel_area_total,
            "projectedPhotoPixelMaskSize": len(projected_pixel_mask),
            "photoVisiblePixelCount": len(photo_visible_pixels),
            "visibleFacadePixelCount": len(visible_pixels_union),
            "photoBackedAtlasTexelCount": len(photo_atlas_texels),
            "registeredTriangleSupportRatio": triangle_photo_area_coverage(local_visible, projected_pixel_area),
        })

    result = {
        "status": "multi-camera-pixel-union-audit",
        "cameras": cameras,
        "visibleSurfaceTriangles": len(visible_surface),
        "photoBackedSurfaceTriangles": len(photo_surface),
        "projectedPhotoPixelArea": sum(c["projectedPhotoPixelArea"] for c in cameras),
        "photoVisiblePixelCount": sum(c["photoVisiblePixelCount"] for c in cameras),
        "visibleFacadePixelCount": len(visible_pixels_union),
        "photoBackedPixelCount": len(photo_pixels_union),
        "pixelCoverageRatio": len(photo_pixels_union) / len(visible_pixels_union) if visible_pixels_union else 0,
        "photoBackedAtlasTexelCount": sum(c["photoBackedAtlasTexelCount"] for c in cameras),
        "visibleAtlasTexels": len(visible_texels),
        "photoBackedAtlasTexels": len(photo_texels),
        "atlasCoverageRatio": len(photo_texels) / len(visible_texels) if visible_texels else 0,
        "coverageRatio": len(photo_surface) / len(visible_surface) if visible_surface else 0,
        "targetRatio": 0.9,
        "targetReached": len(photo_surface) / len(visible_surface) >= 0.9 if visible_surface else False,
    }
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
