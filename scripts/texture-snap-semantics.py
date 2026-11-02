"""Build an auditable semantic/color-evidence manifest for one SNAP building.

The manifest keeps CityGML facts separate from shape and image hypotheses.  It
also reduces PLATEAU appearance imagery to robust semantic palettes, so roof and
installation color can be used without copying illumination seams into the GLB.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
CASE_ID = sys.argv[1] if len(sys.argv) > 1 else "shinjuku-mitsui-no2-southeast"
CASE_PATH = ROOT / "scripts" / "texture-snap-cases" / f"{CASE_ID}.json"
case = json.loads(CASE_PATH.read_text(encoding="utf-8"))
geometry = json.loads((ROOT / case["geometryPath"]).read_text(encoding="utf-8"))
building = next(item for item in geometry["buildings"] if item["id"] == case["buildingId"])
citygml_path = ROOT / case["cityGmlPath"]
catalog_path = ROOT / case["plateauCatalogPath"]
rectified_report_path = ROOT / "data/texture-city/registration" / f"{CASE_ID}-rectified/report.json"
rectified = json.loads(rectified_report_path.read_text(encoding="utf-8"))
output_path = ROOT / "data/texture-city/registration" / f"{CASE_ID}-semantics.json"

GML_ID = "{http://www.opengis.net/gml}id"


def local(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def child(parent: ET.Element, name: str):
    return next((item for item in parent if local(item) == name), None)


def descendants(parent: ET.Element, name: str):
    return [item for item in parent.iter() if local(item) == name]


tree = ET.parse(citygml_path)
target = next((item for item in tree.iter() if item.get(GML_ID) == case["buildingId"]), None)
if target is None:
    raise RuntimeError("Target building is missing from CityGML")

surface_by_polygon: dict[str, dict] = {}
surface_counts: Counter[str] = Counter()
opening_counts: Counter[str] = Counter()
for wrapper in [item for item in target if local(item) == "boundedBy"]:
    surface = next(iter(wrapper), None)
    if surface is None:
        continue
    semantic_class = local(surface)
    surface_counts[semantic_class] += 1
    for opening in descendants(surface, "opening"):
        opening_object = next(iter(opening), None)
        if opening_object is not None:
            opening_counts[local(opening_object)] += 1
    for polygon in descendants(surface, "Polygon"):
        polygon_id = polygon.get(GML_ID)
        if polygon_id:
            surface_by_polygon[polygon_id] = {
                "semanticClass": semantic_class,
                "semanticSource": "PLATEAU CityGML bldg:boundedBy",
                "surfaceId": surface.get(GML_ID),
                "semanticConfidence": 1.0,
            }

installations = []
installation_by_polygon: dict[str, dict] = {}
for wrapper in [item for item in target if local(item) == "outerBuildingInstallation"]:
    installation = next(iter(wrapper), None)
    if installation is None:
        continue
    polygon_ids = [item.get(GML_ID) for item in descendants(installation, "Polygon") if item.get(GML_ID)]
    record = {
        "installationId": installation.get(GML_ID),
        "sourceClass": "OuterBuildingInstallation",
        "polygonIds": polygon_ids,
        "polygonCount": len(polygon_ids),
        "exactEquipmentTypeAvailable": False,
    }
    installations.append(record)
    for polygon_id in polygon_ids:
        installation_by_polygon[polygon_id] = record


def direct_text(name: str):
    element = child(target, name)
    if element is None or element.text is None:
        return None
    text = element.text.strip()
    try:
        return float(text) if "." in text else int(text)
    except ValueError:
        return text


detail = child(target, "buildingDetailAttribute")
building_attributes = {
    "classCode": direct_text("class"),
    "usageCode": direct_text("usage"),
    "measuredHeightMetres": direct_text("measuredHeight"),
    "storeysAboveGround": direct_text("storeysAboveGround"),
    "storeysBelowGround": direct_text("storeysBelowGround"),
    "detail": {
        local(item): (float(item.text) if item.text and "." in item.text else int(item.text))
        for item in (detail.iter() if detail is not None else [])
        if len(item) == 0 and item.text and item.text.strip().replace(".", "", 1).isdigit()
    },
}


def ring_normal(points):
    normal = np.zeros(3, dtype=np.float64)
    for index, point in enumerate(points):
        following = points[(index + 1) % len(points)]
        normal[0] += (point[1] - following[1]) * (point[2] + following[2])
        normal[1] += (point[2] - following[2]) * (point[0] + following[0])
        normal[2] += (point[0] - following[0]) * (point[1] + following[1])
    length = np.linalg.norm(normal)
    return normal / length if length else normal


def ring_area(points):
    return float(np.linalg.norm(sum((np.cross(points[index], points[(index + 1) % len(points)]) for index in range(len(points))), np.zeros(3))) / 2)


def segment_distance_2d(point, start, end):
    direction = end - start
    scale = float(np.dot(direction, direction))
    ratio = 0.0 if scale < 1e-12 else float(np.clip(np.dot(point - start, direction) / scale, 0, 1))
    return float(np.linalg.norm(point - (start + ratio * direction)))


polygon_geometry_by_id = {item["id"]: item for item in building["polygons"]}
wall_plan_metrics = {}
for wall_reference in building["walls"]:
    polygon_id = wall_reference["id"]
    polygon = polygon_geometry_by_id[polygon_id]
    points = np.concatenate([np.asarray(ring["points"], dtype=float) for ring in polygon["rings"]])
    bounds_min, bounds_max = points.min(axis=0), points.max(axis=0)
    middle_y = float((bounds_min[1] + bounds_max[1]) / 2)
    level_points = []
    for other_reference in building["walls"]:
        other = polygon_geometry_by_id[other_reference["id"]]
        other_points = np.concatenate([np.asarray(ring["points"], dtype=float) for ring in other["rings"]])
        if float(other_points[:, 1].min()) - 1e-6 <= middle_y <= float(other_points[:, 1].max()) + 1e-6:
            level_points.extend(other_points[:, [0, 2]].tolist())
    center = points[:, [0, 2]].mean(axis=0)
    hull = cv2.convexHull(np.asarray(level_points, dtype=np.float32)).reshape(-1, 2).astype(float)
    inset = min(segment_distance_2d(center, hull[index], hull[(index + 1) % len(hull)]) for index in range(len(hull)))
    wall_plan_metrics[polygon_id] = {
        "horizontalWidthMetres": round(float(max(bounds_max[0] - bounds_min[0], bounds_max[2] - bounds_min[2])), 3),
        "heightMetres": round(float(bounds_max[1] - bounds_min[1]), 3),
        "levelConvexHullInsetMetres": round(inset, 3),
    }


def rgb_to_lab(rgb):
    pixel = np.uint8([[np.clip(np.rint(rgb), 0, 255)]])
    value = cv2.cvtColor(pixel, cv2.COLOR_RGB2LAB)[0, 0].astype(float)
    return [value[0] * 100 / 255, value[1] - 128, value[2] - 128]


image_cache: dict[str, np.ndarray] = {}


def appearance_sample(polygon_id: str):
    texture = geometry.get("textures", {}).get(polygon_id)
    if not texture:
        return None
    relative = texture["image"]
    image_path = citygml_path.parent / relative
    if relative not in image_cache:
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"Cannot read PLATEAU appearance image: {image_path}")
        image_cache[relative] = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = image_cache[relative]
    height, width = image.shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    rings = list(texture.get("rings", {}).values())
    for index, values in enumerate(rings):
        uv = np.asarray(values, dtype=float).reshape(-1, 2)
        if len(uv) > 1 and np.linalg.norm(uv[0] - uv[-1]) < 1e-8:
            uv = uv[:-1]
        points = np.rint(np.column_stack((uv[:, 0] * (width - 1), (1 - uv[:, 1]) * (height - 1)))).astype(np.int32)
        if len(points) >= 3:
            cv2.fillPoly(mask, [points], 255 if index == 0 else 0)
    if mask.sum() == 0:
        return None
    eroded = cv2.erode(mask, np.ones((3, 3), np.uint8), iterations=1)
    if eroded.sum() > 9 * 255:
        mask = eroded
    pixels = image[mask > 0]
    pixels = pixels[(pixels.max(axis=1) > 12) & (pixels.min(axis=1) < 248)]
    if len(pixels) < 6:
        return None
    if len(pixels) > 50000:
        pixels = pixels[np.linspace(0, len(pixels) - 1, 50000, dtype=int)]
    median_rgb = np.median(pixels, axis=0)
    labs = cv2.cvtColor(pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(float)
    median_lab_cv = np.median(labs, axis=0)
    delta = np.linalg.norm(labs - median_lab_cv, axis=1)
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 60, 140)
    mask_pixels = mask > 0
    confidence = min(0.82, 0.56 + 0.055 * math.log10(max(10, len(pixels))) - 0.002 * np.percentile(delta, 90))
    return {
        "sourceImage": relative,
        "sourceType": "PLATEAU appearance imagery",
        "validPixelCount": int(len(pixels)),
        "medianRgb": [round(float(value) / 255, 6) for value in median_rgb],
        "medianLab": [round(value, 4) for value in rgb_to_lab(median_rgb)],
        "p90LabSpread": round(float(np.percentile(delta, 90) * 100 / 255), 4),
        "luminanceStd": round(float(np.std(gray[mask_pixels]) / 255), 6),
        "edgeDensity": round(float(np.mean(edges[mask_pixels] > 0)), 6),
        "colorConfidence": round(max(0.45, confidence), 3),
    }


minimum_y = float(building["min"][1])
maximum_y = float(building["max"][1])
wall_ids = {item["id"] for item in building["walls"]}
polygons = []
palette_samples: dict[str, list[tuple[list[float], int]]] = defaultdict(list)

for polygon in building["polygons"]:
    polygon_id = polygon["id"]
    outer = np.asarray(polygon["rings"][0]["points"], dtype=float)
    normal = ring_normal(outer)
    all_points = np.concatenate([np.asarray(ring["points"], dtype=float) for ring in polygon["rings"]])
    bounds_min = all_points.min(axis=0)
    bounds_max = all_points.max(axis=0)
    area = ring_area(outer) - sum(ring_area(np.asarray(ring["points"], dtype=float)) for ring in polygon["rings"][1:])
    explicit = surface_by_polygon.get(polygon_id)
    installation = installation_by_polygon.get(polygon_id)
    if explicit:
        semantic_class = explicit["semanticClass"]
        semantic_source = explicit["semanticSource"]
        semantic_confidence = 1.0
        parent_id = None
    elif installation:
        semantic_class = "OuterBuildingInstallation"
        semantic_source = "PLATEAU CityGML bldg:outerBuildingInstallation"
        semantic_confidence = 1.0
        parent_id = installation["installationId"]
    else:
        semantic_class = "UnclassifiedSurface"
        semantic_source = "geometry fallback"
        semantic_confidence = 0.25
        parent_id = None

    y0, y1 = float(bounds_min[1]), float(bounds_max[1])
    wall_metrics = wall_plan_metrics.get(polygon_id)
    if semantic_class == "WallSurface":
        wall_height = wall_metrics["heightMetres"]
        wall_width = wall_metrics["horizontalWidthMetres"]
        hull_inset = wall_metrics["levelConvexHullInsetMetres"]
        if y0 >= maximum_y - 13 or wall_height < 1.5:
            subtype, subtype_confidence = "crown-or-parapet-wall", 0.9
        elif wall_width < 4.5 or hull_inset > 2.25:
            subtype, subtype_confidence = "recessed-or-service-wall", 0.84
        elif y1 <= minimum_y + 14:
            subtype, subtype_confidence = "podium-facade", 0.82
        else:
            subtype, subtype_confidence = "tower-facade", 0.88
    elif semantic_class == "RoofSurface":
        if y1 <= minimum_y + 14:
            subtype, subtype_confidence = "lower-terrace-roof", 0.78
        elif y0 >= maximum_y - 13:
            subtype, subtype_confidence = "upper-roof-or-setback", 0.82
        else:
            subtype, subtype_confidence = "intermediate-setback-roof", 0.72
    elif semantic_class == "GroundSurface":
        subtype, subtype_confidence = "building-ground-contact", 1.0
    elif semantic_class == "OuterBuildingInstallation":
        subtype, subtype_confidence = "roof-service-installation-unspecified", 0.48
    else:
        subtype, subtype_confidence = "unresolved", 0.2

    sample = appearance_sample(polygon_id)
    if semantic_class == "OuterBuildingInstallation":
        palette_key = f"installation:{parent_id}"
    else:
        palette_key = f"surface:{semantic_class}:{subtype}"
    if sample:
        palette_samples[palette_key].append((sample["medianRgb"], min(sample["validPixelCount"], 5000)))
    facade_pattern_eligible = semantic_class == "WallSurface" and subtype in {"tower-facade", "podium-facade"}
    if semantic_class != "WallSurface":
        window_policy = None
        window_policy_confidence = None
    elif facade_pattern_eligible:
        window_policy = "periodic-glazing-pattern-allowed-on-exterior-facade"
        window_policy_confidence = round(min(0.86, subtype_confidence), 3)
    elif subtype == "crown-or-parapet-wall":
        window_policy = "suppressed-on-parapet-or-short-wall"
        window_policy_confidence = 0.94
    else:
        window_policy = "suppressed-on-recessed-or-service-wall"
        window_policy_confidence = 0.9
    polygons.append({
        "polygonId": polygon_id,
        "surfaceId": explicit.get("surfaceId") if explicit else None,
        "semanticClass": semantic_class,
        "semanticSubtype": subtype,
        "semanticSource": semantic_source,
        "semanticConfidence": semantic_confidence,
        "subtypeConfidence": subtype_confidence,
        "parentInstallationId": parent_id,
        "exactEquipmentTypeAvailable": semantic_class != "OuterBuildingInstallation" or False,
        "individualWindowGeometryAvailable": False if semantic_class == "WallSurface" else None,
        "facadePatternEligible": facade_pattern_eligible,
        "windowPatternPolicy": window_policy,
        "windowPatternPolicyConfidence": window_policy_confidence,
        "planExposureMetrics": wall_metrics,
        "paletteKey": palette_key,
        "area": round(area, 6),
        "normal": [round(float(value), 6) for value in normal],
        "bounds": {"min": [round(float(value), 3) for value in bounds_min], "max": [round(float(value), 3) for value in bounds_max]},
        "appearanceEvidence": sample,
    })


palettes = {}
for key, samples in palette_samples.items():
    values = np.asarray([sample[0] for sample in samples], dtype=float)
    weights = np.asarray([sample[1] for sample in samples], dtype=float)
    median_rgb = [float(np.quantile(np.repeat(values[:, channel], np.maximum(1, np.rint(weights / max(1, weights.min()))).astype(int)), 0.5)) for channel in range(3)]
    render_rgb = median_rgb.copy()
    styling_policy = "robust grouped median"
    if key.startswith("installation:"):
        neutral = float(np.mean(render_rgb))
        desaturated = [value * 0.28 + neutral * 0.72 for value in render_rgb]
        industrial_neutral = [neutral * 0.96, neutral, min(0.72, neutral * 1.025)]
        render_rgb = [float(np.clip(desaturated[index] * 0.58 + industrial_neutral[index] * 0.42, 0.24, 0.68)) for index in range(3)]
        styling_policy = "PLATEAU observed luminance retained; chroma reduced toward low-contrast industrial neutral"
    palettes[key] = {
        "medianRgb": [round(value, 6) for value in median_rgb],
        "renderRgb": [round(value, 6) for value in render_rgb],
        "medianLab": [round(value, 4) for value in rgb_to_lab(np.asarray(median_rgb) * 255)],
        "polygonSamples": len(samples),
        "weightedPixelSupport": int(weights.sum()),
        "provenance": "PLATEAU appearance imagery robust grouped median",
        "stylingPolicy": styling_policy,
    }

for polygon in polygons:
    palette = palettes.get(polygon["paletteKey"])
    evidence = polygon["appearanceEvidence"]
    if palette and evidence:
        polygon["colorEvidence"] = "direct-plateau-appearance-group-palette"
        polygon["colorConfidence"] = round(min(0.8, evidence["colorConfidence"]), 3)
    elif palette:
        polygon["colorEvidence"] = "same-semantic-object-group-transfer"
        polygon["colorConfidence"] = 0.5
    elif polygon["semanticClass"] == "WallSurface" and polygon["facadePatternEligible"]:
        polygon["colorEvidence"] = "ground-photo-periodic-inference"
        polygon["colorConfidence"] = 0.44
    else:
        polygon["colorEvidence"] = "semantic-class-prior-only"
        polygon["colorConfidence"] = 0.22


def sha256(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


facade_patterns = []
for group in rectified["groups"]:
    image_path = ROOT / group["inferredTexture"]
    bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Cannot read inferred tile: {image_path}")
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(float)
    row = np.column_stack((lab[:, :, 0].mean(axis=1), lab[:, :, 1].mean(axis=1), lab[:, :, 2].mean(axis=1)))
    baseline = np.median(row, axis=0)
    distance = np.linalg.norm(row - baseline, axis=1)
    smooth = cv2.GaussianBlur(distance.reshape(-1, 1), (1, 0), sigmaX=0, sigmaY=max(1, len(distance) / 45)).ravel()
    threshold = float(np.median(smooth) + max(1.8, np.std(smooth) * 0.75))
    active = smooth >= threshold
    runs = []
    start = None
    for index, value in enumerate(np.r_[active, False]):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append((start, index))
            start = None
    valid_runs = [run for run in runs if 0.1 <= (run[1] - run[0]) / len(distance) <= 0.72]
    band = max(valid_runs, key=lambda run: float(smooth[run[0]:run[1]].mean()), default=None)
    if band:
        band_pixels = rgb[band[0]:band[1]].reshape(-1, 3)
        other_pixels = np.concatenate((rgb[:band[0]], rgb[band[1]:]), axis=0).reshape(-1, 3)
        band_rgb = np.median(band_pixels, axis=0)
        wall_rgb = np.median(other_pixels, axis=0)
        contrast = float(np.linalg.norm(np.asarray(rgb_to_lab(band_rgb)) - np.asarray(rgb_to_lab(wall_rgb))))
    else:
        band_rgb = np.median(rgb.reshape(-1, 3), axis=0)
        wall_rgb = band_rgb.copy()
        contrast = 0.0
    glazing_detected = bool(band and contrast >= 4.5)
    confidence = round(min(0.76, 0.34 + contrast / 45), 3) if glazing_detected else 0.24
    height, width = 256, 256
    semantic = np.empty((height, width, 3), dtype=np.uint8)
    semantic[:] = np.clip(np.rint(wall_rgb), 0, 255)
    band_normalized = None
    if glazing_detected:
        y0 = int(round(band[0] / len(distance) * height))
        y1 = int(round(band[1] / len(distance) * height))
        semantic[y0:y1] = np.clip(np.rint(band_rgb), 0, 255)
        frame = np.clip(np.rint(np.asarray(wall_rgb) * 0.82), 0, 255).astype(np.uint8)
        thickness = max(2, height // 64)
        semantic[max(0, y0 - thickness):min(height, y0 + thickness)] = frame
        semantic[max(0, y1 - thickness):min(height, y1 + thickness)] = frame
        semantic[:, :thickness] = frame
        semantic[:, -thickness:] = frame
        band_normalized = [round(band[0] / len(distance), 4), round(band[1] / len(distance), 4)]
    semantic_path = image_path.with_name(image_path.name.replace(".inferred-tile.png", ".semantic-tile.png"))
    cv2.imwrite(str(semantic_path), cv2.cvtColor(semantic, cv2.COLOR_RGB2BGR))
    facade_patterns.append({
        "groupKey": group["groupKey"],
        "quadrant": group["quadrant"],
        "floorPeriodMetres": group["albedoMetrics"]["repeatTile"]["floorPeriodMetres"],
        "bayPeriodMetres": group["albedoMetrics"]["repeatTile"]["bayPeriodMetres"],
        "facadeElements": [
            {"class": "opaque-wall-or-frame", "evidence": "observed palette outside the dominant repeated band", "confidence": 0.68},
            {"class": "periodic-glazing-band", "evidence": "row-wise Lab contrast inside the observed repeat tile", "confidence": confidence, "bandNormalized": band_normalized},
        ],
        "individualWindowsResolved": False,
        "glazingBandDetected": glazing_detected,
        "glazingBandContrastDeltaE76": round(contrast, 4),
        "semanticTexture": str(semantic_path.relative_to(ROOT)).replace("\\", "/"),
        "semanticSha256": sha256(semantic_path),
        "sourceTexture": group["inferredTexture"],
        "sourceTextureSha256": group["inferredSha256"],
    })


for installation in installations:
    members = [item for item in polygons if item["parentInstallationId"] == installation["installationId"]]
    mins = np.asarray([item["bounds"]["min"] for item in members])
    maxs = np.asarray([item["bounds"]["max"] for item in members])
    overall_min, overall_max = mins.min(axis=0), maxs.max(axis=0)
    dimensions = overall_max - overall_min
    if dimensions[1] > 6 or max(dimensions[0], dimensions[2]) > 12:
        hypothesis = "large-rooftop-service-plant-or-screen"
        confidence = 0.52
    else:
        hypothesis = "compact-rooftop-equipment-enclosure"
        confidence = 0.48
    installation.update({
        "bounds": {"min": overall_min.tolist(), "max": overall_max.tolist()},
        "dimensionsMetres": [round(float(value), 3) for value in dimensions],
        "shapeHypothesis": hypothesis,
        "hypothesisConfidence": confidence,
        "hypothesisBasis": "PLATEAU installation membership, height and bounding-box scale; no equipment function attribute is present",
    })

catalog_document = json.loads(catalog_path.read_text(encoding="utf-8"))
catalog = catalog_document.get("result", catalog_document)
class_counts = Counter(item["semanticClass"] for item in polygons)
appearance_counts = Counter(item["semanticClass"] for item in polygons if item["appearanceEvidence"])
direct_evidence_count = sum(bool(item["appearanceEvidence"]) for item in polygons)
group_transfer_count = sum(item["colorEvidence"] == "same-semantic-object-group-transfer" for item in polygons)
supported_count = sum(item["colorEvidence"] != "semantic-class-prior-only" for item in polygons)
wall_pattern_counts = Counter(
    "eligible" if item["facadePatternEligible"] else item["windowPatternPolicy"]
    for item in polygons
    if item["semanticClass"] == "WallSurface"
)
appearance_sources = []
for index, (relative, image) in enumerate(sorted(image_cache.items())):
    image_path = citygml_path.parent / relative
    stem = Path(relative).stem
    if stem.startswith("WallSurface"):
        semantic_role = "wall appearance atlas"
    elif stem.startswith("RoofSurface"):
        semantic_role = "roof appearance atlas"
    else:
        semantic_role = "building installation appearance atlas"
    appearance_sources.append({
        "sourceId": f"plateau-appearance-{index + 1}",
        "role": semantic_role,
        "sourcePath": str(image_path.relative_to(ROOT)).replace("\\", "/"),
        "sourceImage": relative,
        "sha256": sha256(image_path),
        "imageSize": [int(image.shape[1]), int(image.shape[0])],
        "license": catalog.get("license_title"),
        "licenseUrl": catalog.get("license_url"),
    })
manifest = {
    "caseId": CASE_ID,
    "buildingId": case["buildingId"],
    "cityGmlPath": case["cityGmlPath"],
    "geometryPath": case["geometryPath"],
    "buildingAttributes": building_attributes,
    "plateauSemantics": {
        "surfaceObjectCounts": dict(surface_counts),
        "polygonClassCounts": dict(class_counts),
        "openingCounts": dict(opening_counts),
        "windowPolygonCount": opening_counts.get("Window", 0),
        "doorPolygonCount": opening_counts.get("Door", 0),
        "individualWindowGeometryAvailable": opening_counts.get("Window", 0) > 0,
        "installationGroups": len(installations),
    },
    "sourceLimits": {
        "exactEquipmentFunctionAvailable": False,
        "reason": "The source identifies outer BuildingInstallation groups but carries no class, function or usage value for these two objects.",
        "individualWindowGeometryAvailable": opening_counts.get("Window", 0) > 0,
        "windowReason": "No bldg:Window or bldg:Door opening is encoded for this building. Window bands are image-pattern hypotheses, not selectable 3D openings.",
    },
    "appearanceEvidence": {
        "source": "PLATEAU CityGML appearance textures",
        "licenseTitle": catalog.get("license_title"),
        "licenseUrl": catalog.get("license_url"),
        "imageCount": len(image_cache),
        "texturedPolygons": sum(appearance_counts.values()),
        "totalPolygons": len(polygons),
        "coverageRatio": round(sum(appearance_counts.values()) / len(polygons), 6),
        "classCoverage": dict(appearance_counts),
        "sourceImages": appearance_sources,
        "policy": "Use robust grouped median color only; do not copy raw shadows, exposure differences or seams into the clean model.",
    },
    "evidenceExpandedCoverage": {
        "directAppearancePolygons": direct_evidence_count,
        "sameSemanticObjectTransferredPolygons": group_transfer_count,
        "supportedPolygons": supported_count,
        "priorOnlyPolygons": len(polygons) - supported_count,
        "supportedRatio": round(supported_count / len(polygons), 6),
    },
    "wallPatternEligibility": {
        "counts": dict(wall_pattern_counts),
        "rule": "Allow a repeated glazing pattern only on non-parapet walls at least 4.5 m wide and no more than 2.25 m inside the level-wise convex hull; use solid evidence color on suppressed walls.",
    },
    "palettes": palettes,
    "installations": installations,
    "facadePatterns": facade_patterns,
    "polygons": polygons,
}
output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({
    "output": str(output_path.relative_to(ROOT)),
    "semanticCounts": dict(class_counts),
    "openingCounts": dict(opening_counts),
    "installationGroups": len(installations),
    "appearanceCoverage": manifest["appearanceEvidence"],
    "facadePatterns": [{"groupKey": item["groupKey"], "glazingBandDetected": item["glazingBandDetected"], "confidence": item["facadeElements"][1]["confidence"]} for item in facade_patterns],
}, ensure_ascii=False, indent=2))
