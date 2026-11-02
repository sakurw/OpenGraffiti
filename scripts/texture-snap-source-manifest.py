"""Audit the source funnel and validate unregistered palette-only evidence."""

from __future__ import annotations

import hashlib
import json
import pathlib

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def difference_hash(image: np.ndarray) -> str:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = resized[:, 1:] > resized[:, :-1]
    return f"{sum(int(bit) << index for index, bit in enumerate(bits.flat)):016x}"


def hamming(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def facade_palette(image: np.ndarray, roi_normalized: list[float]) -> dict:
    height, width = image.shape[:2]
    x0, y0, x1, y1 = roi_normalized
    roi = image[round(y0 * height):round(y1 * height), round(x0 * width):round(x1 * width)]
    bgr = roi.astype(np.float32) / 255.0
    blue, green, red = cv2.split(bgr)
    maximum = np.maximum.reduce([red, green, blue])
    minimum = np.minimum.reduce([red, green, blue])
    luminance = (red + green + blue) / 3.0
    support = (
        (luminance > 0.18)
        & (luminance < 0.90)
        & ((maximum - minimum) < 0.28)
        & ((blue - red) < 0.22)
        & ((green - red) < 0.18)
    )
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    values = lab[support]
    if len(values) < 1000:
        raise ValueError("secondary facade palette has insufficient robust samples")
    median = np.median(values, axis=0)
    median_bgr = cv2.cvtColor(np.asarray([[median]], np.float32), cv2.COLOR_LAB2BGR)[0, 0]
    return {
        "roiNormalized": roi_normalized,
        "sampleCount": int(len(values)),
        "sampleRatio": float(len(values) / support.size),
        "medianLab": median.tolist(),
        "medianRgb": median_bgr[::-1].tolist(),
        "luminanceQuantiles": np.quantile(values[:, 0], [0.1, 0.5, 0.9]).tolist(),
        "selection": "central building crop; reject deep shadow, highlight, high saturation, sky-blue and vegetation-green pixels",
    }


case, _ = load_case()
registration_root = ROOT / "data" / "texture-city" / "registration"
rectified = json.loads((registration_root / f"{case['caseId']}-rectified" / "report.json").read_text(encoding="utf8"))
validation = json.loads((registration_root / f"{case['caseId']}-validation.json").read_text(encoding="utf8"))
discovery = json.loads((ROOT / case["sourceDiscoveryPath"]).read_text(encoding="utf8"))
kartaview = json.loads((ROOT / case["kartaviewAudit"]["discoveryPath"]).read_text(encoding="utf8"))
photo_root = ROOT / "data" / "texture-city" / "photos" / "commons"
kartaview_photo_root = ROOT / "data" / "texture-city" / "photos" / "kartaview"

source_specs = [{"sourceId": case["sourceId"], "role": "registered-texture-and-palette", "confidence": 0.86}] + case.get("secondarySources", [])
sources = []
hashes = []
target_lab = np.array([
    rectified["albedoNormalization"]["targetLuminanceQuantiles"][2],
    *rectified["albedoNormalization"]["targetMedianAB"],
])
for spec in source_specs:
    source_id = spec["sourceId"]
    metadata_path = photo_root / f"{source_id}.json"
    image_path = photo_root / f"{source_id}.jpg"
    metadata = json.loads(metadata_path.read_text(encoding="utf8"))
    if metadata["sha256"] != sha256(image_path):
        raise ValueError(f"source hash mismatch: {source_id}")
    image = cv2.imread(str(image_path))
    row = {
        **spec,
        "title": metadata["title"],
        "sourcePage": metadata["sourcePage"],
        "author": metadata["author"],
        "license": metadata["license"],
        "sourceSha256": metadata["sha256"],
        "imageSize": metadata["downloadSize"],
        "differenceHash": difference_hash(image),
    }
    hashes.append((source_id, row["differenceHash"]))
    if spec["role"] == "registered-texture-and-palette":
        row["registration"] = {
            "status": "held-out-validated" if validation["passed"] else "failed",
            "selectedIndependentEdges": validation["selectedIndependentEdges"],
            "medianAbsoluteOffsetPixels": validation["medianAbsoluteOffsetPixels"],
            "p90AbsoluteOffsetPixels": validation["p90AbsoluteOffsetPixels"],
        }
    else:
        palette = facade_palette(image, spec["roiNormalized"])
        median = np.array(palette["medianLab"])
        palette["deltaE76ToRegisteredTarget"] = float(np.linalg.norm(median - target_lab))
        palette["chromaDeltaToRegisteredTarget"] = float(np.linalg.norm(median[1:] - target_lab[1:]))
        palette["passed"] = palette["deltaE76ToRegisteredTarget"] <= 15 and palette["chromaDeltaToRegisteredTarget"] <= 8
        row["paletteValidation"] = palette
        row["registration"] = {"status": "unregistered", "pixelProjectionAllowed": False}
    sources.append(row)

duplicate_pairs = []
for index, (left_id, left_hash) in enumerate(hashes):
    for right_id, right_hash in hashes[index + 1:]:
        distance = hamming(left_hash, right_hash)
        duplicate_pairs.append({"left": left_id, "right": right_id, "differenceHashHamming": distance, "duplicate": distance <= 6})

exact_ids = {item["sourceId"] for item in source_specs}
discovery_ids = {str(photo["id"]).split("/")[-1] for photo in discovery["photos"]}
if not exact_ids.issubset(discovery_ids):
    raise ValueError("exact source is absent from the recorded discovery result")
acquired_kartaview = sum(path.stem.isdigit() for path in kartaview_photo_root.glob("*.json"))
shortlisted = case["kartaviewAudit"]["shortlistedIds"]
if not all((kartaview_photo_root / f"{photo_id}.jpg").exists() for photo_id in shortlisted):
    raise ValueError("KartaView audit shortlist is not fully acquired")

report = {
    "caseId": case["caseId"],
    "buildingId": case["buildingId"],
    "funnel": {
        "commons": {
            "discovered": len(discovery["photos"]),
            "licenseAccepted": sum(bool(photo.get("licenseAccepted")) for photo in discovery["photos"]),
            "exactBuildingMatches": len(source_specs),
            "acquiredExactMatches": len(sources),
            "registeredTextureSources": 1,
            "paletteValidationSources": len(sources) - 1,
        },
        "kartaview": {
            "discovered": len(kartaview.get("photos", [])),
            "acquired": acquired_kartaview,
            "shortlisted": len(shortlisted),
            "usableForColor": 0,
            "outcome": case["kartaviewAudit"]["outcome"],
            "reason": case["kartaviewAudit"]["reason"],
            "shortlistedIds": shortlisted,
        },
    },
    "sources": sources,
    "duplicateAudit": {"method": "64-bit horizontal difference hash", "pairs": duplicate_pairs, "unique": not any(pair["duplicate"] for pair in duplicate_pairs)},
    "paletteValidationPassed": all(source.get("paletteValidation", {}).get("passed", True) for source in sources),
    "policy": "Only held-out-validated registered images may project pixels. Exact-building unregistered images may validate the palette but cannot texture geometry.",
}
output = registration_root / f"{case['caseId']}-sources.json"
output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf8")
print(json.dumps(report, ensure_ascii=False))
