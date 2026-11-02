"""Building-agnostic facade albedo normalization and repeat-tile extraction.

The input atlases contain pixels projected from a licensed photograph.  This
module keeps those pixels and their alpha support, but removes low-frequency
illumination, harmonizes directional exposures, and extracts a robust repeating
facade tile for surfaces that were not observed by the camera.
"""

from __future__ import annotations

import math
from typing import Iterable

import cv2
import numpy as np


def _masked_quantile(values: np.ndarray, mask: np.ndarray, q: Iterable[float]) -> np.ndarray:
    selected = values[mask]
    if selected.size == 0:
        raise ValueError("albedo atlas has no valid pixels")
    return np.quantile(selected, list(q)).astype(np.float32)


def _normalized_gaussian(values: np.ndarray, mask: np.ndarray, sigma: float) -> np.ndarray:
    weight = mask.astype(np.float32)
    numerator = cv2.GaussianBlur(values * weight, (0, 0), sigma)
    denominator = cv2.GaussianBlur(weight, (0, 0), sigma)
    return numerator / np.maximum(denominator, 1e-4)


def _lab_float(bgra: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = bgra[:, :, 3] > 0
    bgr = bgra[:, :, :3].astype(np.float32) / 255.0
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    return lab, mask


def _edge_correlation(before: np.ndarray, after: np.ndarray, mask: np.ndarray) -> float:
    interior = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if np.count_nonzero(interior) < 32:
        return 0.0
    gradients = []
    for image in (before, after):
        gx = cv2.Sobel(image, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(image, cv2.CV_32F, 0, 1, ksize=3)
        gradients.append(np.hypot(gx, gy)[interior])
    if float(np.std(gradients[0])) < 1e-6 or float(np.std(gradients[1])) < 1e-6:
        return 0.0
    return float(np.corrcoef(gradients[0], gradients[1])[0, 1])


def _large_scale_std(luminance: np.ndarray, mask: np.ndarray) -> float:
    sigma = max(8.0, min(luminance.shape) * 0.10)
    low = _normalized_gaussian(luminance, mask, sigma)
    return float(np.std(low[mask]))


def _independent_flatten(bgra: np.ndarray, strength: float = 0.86) -> dict:
    lab, mask = _lab_float(bgra)
    luminance = lab[:, :, 0].copy()
    sigma = max(12.0, min(luminance.shape) * 0.115)
    gaussian_illumination = _normalized_gaussian(luminance, mask, sigma)
    # A broad median estimate follows hard cast-shadow boundaries while
    # rejecting the much narrower window/mullion rhythm.  Combining it with a
    # normalized Gaussian avoids halos along the alpha support.
    filled_luminance = _nearest_fill(luminance, mask)
    median_kernel = max(15, int(round(min(luminance.shape) * 0.105)) | 1)
    median_kernel = min(median_kernel, 61)
    median_source = np.clip(filled_luminance * 2.55, 0, 255).astype(np.uint8)
    median_illumination = cv2.medianBlur(median_source, median_kernel).astype(np.float32) / 2.55
    median_illumination = cv2.GaussianBlur(median_illumination, (0, 0), 3.0)
    illumination = median_illumination * 0.72 + gaussian_illumination * 0.28
    target = float(np.median(illumination[mask]))
    corrected = luminance + strength * (target - illumination)

    # Keep the photographed local contrast while limiting extreme reflection
    # and shadow values that are poor albedo evidence.
    lo, hi = _masked_quantile(corrected, mask, (0.01, 0.99))
    corrected = np.clip(corrected, max(4.0, float(lo)), min(96.0, float(hi)))
    lab[:, :, 0] = corrected
    return {
        "lab": lab,
        "mask": mask,
        "raw_luminance": luminance,
        "flattened_luminance": corrected,
        "illumination_sigma_pixels": sigma,
        "illumination_median_kernel_pixels": median_kernel,
    }


def _quantile_map(values: np.ndarray, mask: np.ndarray, target: np.ndarray, blend: float = 0.82) -> np.ndarray:
    knots = (0.03, 0.20, 0.50, 0.80, 0.97)
    source = _masked_quantile(values, mask, knots)
    source = np.maximum.accumulate(source)
    for index in range(1, len(source)):
        if source[index] <= source[index - 1]:
            source[index] = source[index - 1] + 1e-3
    mapped = np.interp(values, source, target).astype(np.float32)
    return values * (1.0 - blend) + mapped * blend


def _detect_period(profile: np.ndarray, minimum: int, maximum: int) -> tuple[int, float]:
    profile = profile.astype(np.float32)
    profile -= cv2.GaussianBlur(profile.reshape(1, -1), (0, 0), max(2.0, minimum / 2)).reshape(-1)
    profile -= float(profile.mean())
    scale = float(np.linalg.norm(profile))
    if scale < 1e-6:
        return minimum, 0.0
    best_period, best_score = minimum, -1.0
    maximum = min(maximum, max(minimum, len(profile) // 2))
    for period in range(minimum, maximum + 1):
        left, right = profile[:-period], profile[period:]
        denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
        score = float(np.dot(left, right) / denominator) if denominator > 1e-6 else -1.0
        if score > best_score:
            best_period, best_score = period, score
    return best_period, best_score


def _axis_profile(luminance: np.ndarray, mask: np.ndarray, axis: int) -> np.ndarray:
    count = np.sum(mask, axis=axis)
    total = np.sum(luminance * mask, axis=axis)
    profile = total / np.maximum(count, 1)
    valid = count > 0
    if np.any(~valid) and np.any(valid):
        positions = np.arange(len(profile))
        profile[~valid] = np.interp(positions[~valid], positions[valid], profile[valid])
    return profile.astype(np.float32)


def _nearest_fill(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    if np.all(mask):
        return image.copy()
    invalid = (~mask).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(invalid, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    valid_positions = np.argwhere(mask)
    # DIST_LABEL_PIXEL numbers zero pixels (the valid support) from one.
    lookup = np.zeros((len(valid_positions) + 1, 2), np.int32)
    for label, (y, x) in enumerate(valid_positions, start=1):
        lookup[label] = (y, x)
    filled = image.copy()
    ys, xs = np.nonzero(~mask)
    nearest = lookup[np.clip(labels[ys, xs], 0, len(valid_positions))]
    filled[ys, xs] = image[nearest[:, 0], nearest[:, 1]]
    return filled


def _repeat_tile(bgra: np.ndarray, pixels_per_metre: float) -> tuple[np.ndarray, dict]:
    lab, mask = _lab_float(bgra)
    luminance = lab[:, :, 0]
    vertical = _axis_profile(luminance, mask, axis=1)
    horizontal = _axis_profile(luminance, mask, axis=0)
    floor_min = max(8, round(2.4 * pixels_per_metre))
    floor_max = max(floor_min, round(4.6 * pixels_per_metre))
    bay_min = max(6, round(1.4 * pixels_per_metre))
    bay_max = max(bay_min, round(4.8 * pixels_per_metre))
    floor_pixels, floor_score = _detect_period(vertical, floor_min, floor_max)
    bay_pixels, bay_score = _detect_period(horizontal, bay_min, bay_max)

    bgr = bgra[:, :, :3].astype(np.float32)
    buckets = [[[] for _ in range(bay_pixels)] for _ in range(floor_pixels)]
    ys, xs = np.nonzero(mask)
    for y, x in zip(ys.tolist(), xs.tolist()):
        buckets[y % floor_pixels][x % bay_pixels].append(bgr[y, x])
    tile = np.zeros((floor_pixels, bay_pixels, 3), np.float32)
    support = np.zeros((floor_pixels, bay_pixels), np.uint16)
    for y in range(floor_pixels):
        for x in range(bay_pixels):
            samples = buckets[y][x]
            if samples:
                tile[y, x] = np.median(np.asarray(samples), axis=0)
                support[y, x] = len(samples)
    tile = _nearest_fill(tile, support > 0)
    # Small bilateral smoothing removes isolated projections while retaining
    # window/mullion boundaries in the inferred repeat pattern.
    tile = cv2.bilateralFilter(tile.astype(np.uint8), 5, 9, 3)
    blur = cv2.GaussianBlur(tile, (0, 0), 1.1)
    tile = cv2.addWeighted(tile, 1.32, blur, -0.32, 0)
    scale = 4
    tile = cv2.resize(tile, (bay_pixels * scale, floor_pixels * scale), interpolation=cv2.INTER_CUBIC)
    alpha = np.full((tile.shape[0], tile.shape[1], 1), 255, np.uint8)
    return np.concatenate((tile, alpha), axis=2), {
        "floorPeriodPixels": floor_pixels,
        "floorPeriodMetres": floor_pixels / pixels_per_metre,
        "floorAutocorrelation": floor_score,
        "bayPeriodPixels": bay_pixels,
        "bayPeriodMetres": bay_pixels / pixels_per_metre,
        "bayAutocorrelation": bay_score,
        "textureUpscale": scale,
        "textureSize": [int(tile.shape[1]), int(tile.shape[0])],
        "medianSamplesPerTilePixel": float(np.median(support[support > 0])) if np.any(support) else 0.0,
    }


def normalize_atlas_group(atlases: list[np.ndarray], pixels_per_metre: list[float]) -> tuple[list[np.ndarray], list[np.ndarray], dict]:
    if len(atlases) != len(pixels_per_metre) or not atlases:
        raise ValueError("atlas images and scale metadata must be non-empty and aligned")
    states = [_independent_flatten(atlas) for atlas in atlases]
    knots = (0.03, 0.20, 0.50, 0.80, 0.97)
    target_quantiles = np.median(
        np.stack([_masked_quantile(state["flattened_luminance"], state["mask"], knots) for state in states]),
        axis=0,
    ).astype(np.float32)
    target_ab = np.median(
        np.stack([np.median(state["lab"][:, :, 1:][state["mask"]], axis=0) for state in states]),
        axis=0,
    )

    outputs, tiles, per_atlas = [], [], []
    for state, original, ppm in zip(states, atlases, pixels_per_metre):
        lab = state["lab"].copy()
        mask = state["mask"]
        mapped_l = _quantile_map(state["flattened_luminance"], mask, target_quantiles)
        lab[:, :, 0] = np.clip(mapped_l, 2.0, 98.0)
        source_ab = np.median(lab[:, :, 1:][mask], axis=0)
        ab_shift = np.clip((target_ab - source_ab) * 0.72, -8.0, 8.0)
        lab[:, :, 1] = np.clip(lab[:, :, 1] + ab_shift[0], -127.0, 127.0)
        lab[:, :, 2] = np.clip(lab[:, :, 2] + ab_shift[1], -127.0, 127.0)
        bgr = np.clip(cv2.cvtColor(lab, cv2.COLOR_LAB2BGR) * 255.0, 0, 255).astype(np.uint8)
        edge_distance = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
        feather_pixels = max(4, round(ppm * 1.0))
        feathered_alpha = np.clip(edge_distance / feather_pixels * 255.0, 0, 255).astype(np.uint8)
        output = np.dstack((bgr, np.minimum(original[:, :, 3], feathered_alpha)))
        output[~mask, :3] = 0
        tile, tile_metrics = _repeat_tile(output, ppm)
        outputs.append(output)
        tiles.append(tile)
        per_atlas.append({
            "rawLargeScaleLuminanceStd": _large_scale_std(state["raw_luminance"], mask),
            "correctedLargeScaleLuminanceStd": _large_scale_std(lab[:, :, 0], mask),
            "detailEdgeCorrelation": _edge_correlation(state["raw_luminance"], lab[:, :, 0], mask),
            "rawLuminanceQuantiles": _masked_quantile(state["raw_luminance"], mask, knots).tolist(),
            "correctedLuminanceQuantiles": _masked_quantile(lab[:, :, 0], mask, knots).tolist(),
            "correctedMedianLab": np.median(lab[mask], axis=0).tolist(),
            "illuminationSigmaPixels": state["illumination_sigma_pixels"],
            "illuminationMedianKernelPixels": state["illumination_median_kernel_pixels"],
            "clippedLuminanceRatio": float(np.mean((lab[:, :, 0][mask] <= 2.01) | (lab[:, :, 0][mask] >= 97.99))),
            "edgeFeatherPixels": feather_pixels,
            "featheredValidPixelRatio": float(np.mean((output[:, :, 3][mask] > 0) & (output[:, :, 3][mask] < 255))),
            "repeatTile": tile_metrics,
        })

    raw_medians = [np.median(_lab_float(atlas)[0][_lab_float(atlas)[1]], axis=0) for atlas in atlases]
    corrected_medians = [np.asarray(metrics["correctedMedianLab"]) for metrics in per_atlas]
    pair_raw, pair_corrected = [], []
    for left in range(len(atlases)):
        for right in range(left + 1, len(atlases)):
            pair_raw.append(float(np.linalg.norm(raw_medians[left] - raw_medians[right])))
            pair_corrected.append(float(np.linalg.norm(corrected_medians[left] - corrected_medians[right])))
    report = {
        "method": "masked-retinex-plus-direction-quantile-harmonization-and-support-feathering",
        "targetLuminanceQuantiles": target_quantiles.tolist(),
        "targetMedianAB": target_ab.tolist(),
        "rawDirectionalMedianDeltaE": max(pair_raw) if pair_raw else 0.0,
        "correctedDirectionalMedianDeltaE": max(pair_corrected) if pair_corrected else 0.0,
        "atlases": per_atlas,
    }
    return outputs, tiles, report
