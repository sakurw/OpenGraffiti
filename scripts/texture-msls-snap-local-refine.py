"""Refine MSLS/SfM cameras against local PLATEAU facade structure.

The input SfM/GPS pose remains the prior.  For each source image, the highest
quality baseline building is used as a local registration target.  Long visible
PLATEAU wall edges are matched to nearby image gradients once, matches are then
frozen, and the camera pose/focal length is fitted on a training subset only.
Held-out structural edges decide whether the correction is safe to apply.

This is photographic registration, not surveyed control.  Failed registrations
are intentionally rejected so the final texture pipeline leaves transparent gaps
instead of forcing a visibly wrong facade.
"""
import argparse
import hashlib
import json
import math
import pathlib

import cv2
import numpy as np


ROOT = pathlib.Path(__file__).resolve().parents[1]
TILES = {'tocho': '53394525', 'tokyo-tower': '53393599'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rms(values):
    values = np.asarray(values, float)
    return float(np.sqrt(np.mean(values ** 2))) if len(values) else None


def median(values):
    values = np.asarray(values, float)
    return float(np.median(values)) if len(values) else None


def rotation_angle(a, b):
    relative = a @ b.T
    cosine = np.clip((np.trace(relative) - 1) / 2, -1, 1)
    return float(np.degrees(np.arccos(cosine)))


def camera_from_x(x, focal0, cx, cy):
    rotation = cv2.Rodrigues(x[:3])[0]
    position = x[3:6]
    focal = float(focal0 * np.exp(x[6]))
    matrix = np.array([[focal, 0, cx], [0, focal, cy], [0, 0, 1]], float)
    translation = -rotation @ position
    cam_from_world = np.c_[rotation, translation]
    return matrix, rotation, position, cam_from_world


def project(points, x, focal0, cx, cy):
    matrix, rotation, position, _ = camera_from_x(x, focal0, cx, cy)
    translation = -rotation @ position
    projected, _ = cv2.projectPoints(np.asarray(points, float), x[:3], translation, matrix, None)
    return projected.reshape(-1, 2)


def optimize(x0, residual, active_indices, limits, iterations=280, reference_x=None):
    x = x0.copy()
    reference = x0 if reference_x is None else reference_x
    damping = 1e-3
    steps = np.array([1e-6] * 3 + [1e-4] * 3 + [1e-6])
    active_indices = np.asarray(active_indices, int)
    eye = np.eye(len(x))[active_indices]
    for _ in range(iterations):
        error = residual(x)
        jacobian = np.column_stack([
            (residual(x + direction * steps[index]) - error) / steps[index]
            for index, direction in zip(active_indices, eye)
        ])
        lhs = jacobian.T @ jacobian
        try:
            update = np.linalg.solve(
                lhs + damping * np.diag(np.maximum(np.diag(lhs), 1)),
                jacobian.T @ error,
            )
        except np.linalg.LinAlgError:
            damping *= 10
            continue
        trial = x.copy()
        trial[active_indices] -= update
        trial_rotation = cv2.Rodrigues(trial[:3])[0]
        initial_rotation = cv2.Rodrigues(reference[:3])[0]
        position_delta = np.linalg.norm(trial[3:6] - reference[3:6])
        rotation_delta = rotation_angle(trial_rotation, initial_rotation)
        focal_ratio = math.exp(float(trial[6] - reference[6]))
        if (not np.isfinite(trial).all()
                or position_delta > limits['positionMetres']
                or rotation_delta > limits['rotationDegrees']
                or not limits['focalRatio'][0] <= focal_ratio <= limits['focalRatio'][1]):
            damping *= 10
            continue
        if np.sum(residual(trial) ** 2) < np.sum(error ** 2):
            x = trial
            damping = max(1e-8, damping / 3)
            if np.linalg.norm(update) < 1e-7:
                break
        else:
            damping *= 10
    return x


def residual_metrics(x, edges, focal0, cx, cy):
    values = np.concatenate([
        np.abs(line_residual(x, edge, focal0, cx, cy))
        for edge in edges
    ])
    return {
        'median': median(values),
        'rms': rms(values),
        'values': values,
    }


def stage_quality(name, x, x0, rotation0, position0, focal0, cx, cy,
                  training, heldout, anchor):
    matrix, rotation, position, cam_from_world = camera_from_x(x, focal0, cx, cy)
    train = residual_metrics(x, training, focal0, cx, cy)
    hold = residual_metrics(x, heldout, focal0, cx, cy)
    return {
        'name': name,
        'x': x,
        'matrix': matrix,
        'rotation': rotation,
        'position': position,
        'camFromWorld': cam_from_world,
        'trainingMedianPixels': train['median'],
        'trainingRmsPixels': train['rms'],
        'heldOutMedianPixels': hold['median'],
        'heldOutRmsPixels': hold['rms'],
        'positionDeltaMetres': float(np.linalg.norm(position - position0)),
        'rotationDeltaDegrees': rotation_angle(rotation, rotation0),
        'focalRatio': float(matrix[0, 0] / focal0),
        'anchorErrorMetres': float(np.linalg.norm(position - anchor)),
    }


def meaningful_holdout_improvement(candidate, reference):
    before = reference['heldOutMedianPixels']
    after = candidate['heldOutMedianPixels']
    rms_before = reference['heldOutRmsPixels']
    rms_after = candidate['heldOutRmsPixels']
    if before is None or after is None or rms_before is None or rms_after is None:
        return False
    median_improved = after <= before * .95 or after <= before - .35
    rms_not_regressed = rms_after <= rms_before * 1.03 + .15
    return bool(median_improved and rms_not_regressed)


def stage_gate(candidate):
    return bool(
        candidate['trainingMedianPixels'] <= 6.0 and
        candidate['heldOutMedianPixels'] <= 6.0 and
        candidate['heldOutRmsPixels'] <= 10.0 and
        candidate['positionDeltaMetres'] <= 1.25 and
        candidate['rotationDeltaDegrees'] <= 4.0 and
        .975 <= candidate['focalRatio'] <= 1.025 and
        candidate['anchorErrorMetres'] <= 1.75
    )


def baseline_gate(candidate):
    return bool(
        candidate['trainingMedianPixels'] <= 5.5 and
        candidate['heldOutMedianPixels'] <= 5.5 and
        candidate['heldOutRmsPixels'] <= 9.0 and
        candidate['anchorErrorMetres'] <= 1.25
    )


def sample_map(array, points):
    map_x = points[:, 0].astype(np.float32).reshape(-1, 1)
    map_y = points[:, 1].astype(np.float32).reshape(-1, 1)
    return cv2.remap(array, map_x, map_y, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_REPLICATE).reshape(-1)


def angle_delta(a, b):
    delta = abs(math.atan2(math.sin(a - b), math.cos(a - b)))
    return min(delta, abs(math.pi - delta))


def image_segments(gray, gx, gy, mask):
    """Collect straight image evidence from LSD and Canny/Hough."""
    height, width = gray.shape
    rows = []

    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    detected = lsd.detect(gray)[0]
    if detected is not None:
        for line in detected.reshape(-1, 4):
            rows.append((line[:2], line[2:], 'lsd'))

    canny = cv2.Canny(gray, 55, 145, apertureSize=3, L2gradient=True)
    hough = cv2.HoughLinesP(canny, 1, np.pi / 180, threshold=24,
                            minLineLength=16, maxLineGap=7)
    if hough is not None:
        for line in hough.reshape(-1, 4):
            rows.append((line[:2].astype(float), line[2:].astype(float), 'hough'))

    segments = []
    for a, b, detector in rows:
        a = np.asarray(a, float)
        b = np.asarray(b, float)
        delta = b - a
        length = float(np.linalg.norm(delta))
        if length < 14:
            continue
        direction = delta / length
        normal = np.array([-direction[1], direction[0]])
        samples = a[None, :] + np.linspace(.08, .92, 11)[:, None] * delta[None, :]
        ix = np.clip(np.rint(samples[:, 0]).astype(int), 0, width - 1)
        iy = np.clip(np.rint(samples[:, 1]).astype(int), 0, height - 1)
        mask_fraction = float(np.mean(mask[iy, ix] > 0))
        if mask_fraction < .38:
            continue
        directional = sample_map(gx, samples) * normal[0] + sample_map(gy, samples) * normal[1]
        gradient = float(np.percentile(np.abs(directional), 65))
        if gradient < 18:
            continue
        segments.append({
            'a': a,
            'b': b,
            'center': (a + b) / 2,
            'direction': direction,
            'normal': normal,
            'angle': math.atan2(direction[1], direction[0]) % math.pi,
            'length': length,
            'gradient': gradient,
            'maskFraction': mask_fraction,
            'detector': detector,
        })
    return segments


def wall_normal(points):
    normal = np.cross(points, np.roll(points, -1, axis=0)).sum(axis=0)
    length = np.linalg.norm(normal)
    return normal / length if length > 1e-9 else normal


def structural_edges(building, camera_position):
    found = {}
    for wall in building['walls']:
        if not wall['rings']:
            continue
        outer = np.asarray(wall['rings'][0]['points'], float)
        if len(outer) < 3:
            continue
        normal = wall_normal(outer)
        if np.dot(normal, camera_position - outer.mean(axis=0)) <= 0:
            continue
        for ring in wall['rings']:
            points = np.asarray(ring['points'], float)
            for index, a in enumerate(points):
                b = points[(index + 1) % len(points)]
                length = float(np.linalg.norm(b - a))
                if length < 5.0:
                    continue
                key_points = sorted([
                    tuple(np.round(a, 2).tolist()),
                    tuple(np.round(b, 2).tolist()),
                ])
                key = tuple(key_points)
                current = found.get(key)
                if current is None or length > current['length']:
                    found[key] = {
                        'a': a.tolist(), 'b': b.tolist(), 'length': length,
                        'wallId': wall['id'],
                    }
    return list(found.values())


def detect_edge(edge, x, focal0, cx, cy, gx, gy, mask):
    height, width = gx.shape
    uv = project([edge['a'], edge['b']], x, focal0, cx, cy)
    a, b = uv
    delta = b - a
    length = float(np.linalg.norm(delta))
    if length < 28:
        return None
    direction = delta / length
    normal = np.array([-direction[1], direction[0]])
    search = 34
    margin = search + 6
    ts = np.linspace(.12, .88, max(36, min(120, int(length / 3))))
    base = a[None, :] + ts[:, None] * delta[None, :]
    if (base[:, 0].min() < margin or base[:, 0].max() > width - margin or
            base[:, 1].min() < margin or base[:, 1].max() > height - margin):
        return None

    offsets = np.arange(-search, search + 1, dtype=float)
    observed = []
    gradients = []
    prominences = []
    for center_t in (.22, .5, .78):
        select = np.abs(ts - center_t) <= .095
        segment = base[select]
        if len(segment) < 5:
            return None
        scores = []
        mask_scores = []
        for offset in offsets:
            points = segment + normal[None, :] * offset
            directional = sample_map(gx, points) * normal[0] + sample_map(gy, points) * normal[1]
            scores.append(float(np.percentile(np.abs(directional), 65)))
            ix = np.clip(np.rint(points[:, 0]).astype(int), 0, width - 1)
            iy = np.clip(np.rint(points[:, 1]).astype(int), 0, height - 1)
            mask_scores.append(float(np.mean(mask[iy, ix] > 0)))
        scores = np.asarray(scores)
        mask_scores = np.asarray(mask_scores)
        eligible = np.where(mask_scores >= .55)[0]
        if not len(eligible):
            return None
        best_index = int(eligible[np.argmax(scores[eligible])])
        baseline = float(np.median(scores[eligible]))
        prominence = float((scores[best_index] + 1) / (baseline + 1))
        if scores[best_index] < 38 or prominence < 1.10:
            return None
        offset = float(offsets[best_index])
        observed.append((a + center_t * delta + normal * offset).tolist())
        gradients.append(float(scores[best_index]))
        prominences.append(prominence)

    observed = np.asarray(observed, float)
    local_offsets = np.asarray([
        np.dot(point - (a + t * delta), normal)
        for point, t in zip(observed, (.22, .5, .78))
    ])
    if np.ptp(local_offsets) > 24 or np.std(local_offsets) > 10:
        return None
    line = np.asarray([observed[0], observed[-1]], float)
    return {
        **edge,
        'initialProjected': uv.tolist(),
        'observedLine': line.tolist(),
        'imageLengthPixels': length,
        'offsetsPixels': local_offsets.tolist(),
        'gradientScore': float(np.median(gradients)),
        'prominence': float(np.median(prominences)),
    }


def segment_candidate(edge, uv, segment):
    a, b = uv
    delta = b - a
    length = float(np.linalg.norm(delta))
    direction = delta / max(length, 1e-8)
    normal = np.array([-direction[1], direction[0]])
    predicted_angle = math.atan2(direction[1], direction[0]) % math.pi
    angular = angle_delta(predicted_angle, segment['angle'])
    if angular > math.radians(18):
        return None
    perpendicular = abs(float(np.dot(segment['center'] - a, normal)))
    if perpendicular > 58:
        return None
    along = np.asarray([
        np.dot(segment['a'] - a, direction),
        np.dot(segment['b'] - a, direction),
    ], float)
    overlap = max(0.0, min(length, float(np.max(along))) - max(0.0, float(np.min(along))))
    if overlap < max(7.0, min(24.0, length * .12)):
        return None
    observed_normal = np.array([-segment['direction'][1], segment['direction'][0]])
    probes = np.asarray([a, (a + b) / 2, b])
    residuals = np.abs((probes - segment['a']) @ observed_normal)
    residual_median = float(np.median(residuals))
    residual_max = float(np.max(residuals))
    if residual_median > 42 or residual_max > 68:
        return None
    angle_degrees = math.degrees(angular)
    score = (residual_median + angle_degrees * 1.05 -
             min(segment['length'], 90.0) * .025 -
             min(segment['gradient'], 180.0) * .012 - overlap * .012)
    return score, residual_median, residual_max, overlap, angle_degrees


def detect_segment_edge(edge, x, focal0, cx, cy, segments, mask):
    height, width = mask.shape
    uv = project([edge['a'], edge['b']], x, focal0, cx, cy)
    a, b = uv
    delta = b - a
    length = float(np.linalg.norm(delta))
    if length < 20:
        return None
    samples = a[None, :] + np.linspace(.05, .95, 25)[:, None] * delta[None, :]
    visible = ((samples[:, 0] >= 3) & (samples[:, 0] < width - 3) &
               (samples[:, 1] >= 3) & (samples[:, 1] < height - 3))
    if float(np.mean(visible)) < .28:
        return None
    visible_points = samples[visible]
    ix = np.clip(np.rint(visible_points[:, 0]).astype(int), 0, width - 1)
    iy = np.clip(np.rint(visible_points[:, 1]).astype(int), 0, height - 1)
    if float(np.mean(mask[iy, ix] > 0)) < .32:
        return None

    candidates = []
    for segment in segments:
        result = segment_candidate(edge, uv, segment)
        if result is not None:
            candidates.append((*result, segment))
    if not candidates:
        return None
    candidates.sort(key=lambda row: row[0])
    score, residual_median, residual_max, overlap, angle_degrees, segment = candidates[0]
    if residual_median > 34 or angle_degrees > 15:
        return None

    for other in candidates[1:5]:
        if other[0] - score > 2.2:
            break
        other_segment = other[5]
        line_offset = abs(float(np.dot(
            other_segment['center'] - segment['center'], segment['normal'])))
        if line_offset > 5.5:
            return None

    return {
        **edge,
        'initialProjected': uv.tolist(),
        'observedLine': np.asarray([segment['a'], segment['b']], float).tolist(),
        'imageLengthPixels': length,
        'matchedImageLengthPixels': segment['length'],
        'initialLineMedianPixels': residual_median,
        'initialLineMaximumPixels': residual_max,
        'angleDeltaDegrees': angle_degrees,
        'overlapPixels': overlap,
        'gradientScore': segment['gradient'],
        'maskFraction': segment['maskFraction'],
        'detector': segment['detector'],
        'matchScore': float(score),
    }


def line_residual(x, edge, focal0, cx, cy):
    observed = np.asarray(edge['observedLine'], float)
    oa, ob = observed
    od = ob - oa
    olen = max(np.linalg.norm(od), 1e-8)
    a = np.asarray(edge['a'], float)
    b = np.asarray(edge['b'], float)
    samples = np.asarray([a, a * .75 + b * .25, (a + b) / 2, a * .25 + b * .75, b])
    projected = project(samples, x, focal0, cx, cy)
    return np.asarray([
        (od[0] * (point - oa)[1] - od[1] * (point - oa)[0]) / olen
        for point in projected
    ])


def robust(values, delta=7.0):
    return delta * np.arcsinh(np.asarray(values, float) / delta)


def choose_target_buildings(baseline, maximum=6):
    by_source = {}
    for building in baseline['buildings']:
        for candidate in building.get('topCandidates', []):
            if candidate.get('rejectionReason'):
                continue
            row = {
                'buildingId': building['buildingId'],
                'score': candidate['score'],
                'projectedArea': candidate['projectedArea'],
            }
            source = candidate['sourceId']
            by_source.setdefault(source, []).append(row)
    for source, rows in by_source.items():
        unique = {}
        for row in rows:
            current = unique.get(row['buildingId'])
            if current is None or row['score'] > current['score']:
                unique[row['buildingId']] = row
        by_source[source] = sorted(
            unique.values(), key=lambda row: (row['score'], row['projectedArea']), reverse=True
        )[:maximum]
    return by_source


def fit_one(photo, target_rows, buildings, output_dir):
    primary_target = target_rows[0]
    image = cv2.imread(str(ROOT / photo['imagePath']))
    raw_mask = cv2.imread(str(ROOT / photo['maskPath']), cv2.IMREAD_GRAYSCALE)
    if image is None or raw_mask is None:
        return {'accepted': False, 'reason': 'missing-image-or-mask'}
    height, width = image.shape[:2]
    if [width, height] != photo['imageSize']:
        return {'accepted': False, 'reason': 'image-size-mismatch'}
    mask = cv2.dilate(raw_mask, np.ones((9, 9), np.uint8))
    gray = cv2.GaussianBlur(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    segments = image_segments(gray, gx, gy, mask)

    rotation0 = np.asarray([row[:3] for row in photo['camFromWorld']], float)
    rvec0 = cv2.Rodrigues(rotation0)[0].reshape(3)
    position0 = np.asarray(photo['position'], float)
    matrix0 = np.asarray(photo['cameraMatrix'], float)
    focal0, cx, cy = float(matrix0[0, 0]), float(matrix0[0, 2]), float(matrix0[1, 2])
    x0 = np.r_[rvec0, position0, 0.0]

    detected = []
    structural_count = 0
    for target in target_rows:
        building = buildings.get(target['buildingId'])
        if not building:
            continue
        edges = structural_edges(building, position0)
        structural_count += len(edges)
        for edge in edges:
            edge = {**edge, 'buildingId': target['buildingId']}
            match = detect_segment_edge(edge, x0, focal0, cx, cy, segments, mask)
            if match:
                detected.append(match)
    detected.sort(key=lambda item: (
        item['initialLineMedianPixels'], item['angleDeltaDegrees'],
        -item['matchedImageLengthPixels'], -item['gradientScore']))

    selected = []
    for match in detected:
        line = np.asarray(match['observedLine'], float)
        center = line.mean(axis=0)
        direction = line[1] - line[0]
        angle = math.atan2(direction[1], direction[0])
        duplicate = False
        for other in selected:
            other_line = np.asarray(other['observedLine'], float)
            other_center = other_line.mean(axis=0)
            other_direction = other_line[1] - other_line[0]
            other_angle = math.atan2(other_direction[1], other_direction[0])
            angle_delta = abs(math.atan2(math.sin(angle - other_angle), math.cos(angle - other_angle)))
            if np.linalg.norm(center - other_center) < 13 and angle_delta < math.radians(8):
                duplicate = True
                break
        if not duplicate:
            selected.append(match)
        if len(selected) >= 24:
            break
    selected.sort(key=lambda item: tuple(np.mean(np.asarray(item['observedLine']), axis=0)))
    if len(selected) < 8:
        return {
            'accepted': False,
            'reason': 'insufficient-structural-edges',
            'detectedEdges': len(selected),
            'structuralEdgesConsidered': structural_count,
            'imageSegments': len(segments),
            'targetBuildingIds': [row['buildingId'] for row in target_rows],
        }

    heldout_indices = {index for index in range(len(selected)) if index % 4 == 1}
    training = [edge for index, edge in enumerate(selected) if index not in heldout_indices]
    heldout = [edge for index, edge in enumerate(selected) if index in heldout_indices]
    if len(training) < 6 or len(heldout) < 2:
        return {'accepted': False, 'reason': 'insufficient-train-holdout-split', 'detectedEdges': len(selected)}

    anchor = np.asarray(photo['heightAnchor']['position'], float)
    centers = np.asarray([
        np.mean(np.asarray(edge['observedLine'], float), axis=0)
        for edge in selected
    ])
    observed_angles = []
    for edge in selected:
        line = np.asarray(edge['observedLine'], float)
        direction = line[1] - line[0]
        observed_angles.append(math.atan2(direction[1], direction[0]) % math.pi)
    orientation_bins = len({int(angle / (math.pi / 6)) % 6 for angle in observed_angles})
    center_span = np.ptp(centers, axis=0)
    matched_buildings = len({edge['buildingId'] for edge in selected})
    evidence_ok = bool(
        orientation_bins >= 2 and
        (center_span[0] >= width * .12 or center_span[1] >= height * .18)
    )

    def prior_residual(x):
        # SfM/GPS camera centre and intrinsics are strong priors.  The staged
        # solver first uses only rotation, then unlocks small translation and
        # focal changes only when withheld edges generalize better.
        return np.r_[
            (x[:3] - x0[:3]) / .035,
            (x[3:6] - x0[3:6]) / np.array([.55, .35, .55]),
            x[6] / .018,
        ] * 2.6

    def residual(x):
        lines = np.concatenate([
            robust(line_residual(x, edge, focal0, cx, cy))
            for edge in training
        ])
        return np.r_[lines, prior_residual(x)]

    limits = {
        'positionMetres': 1.25,
        'rotationDegrees': 4.0,
        'focalRatio': (.975, 1.025),
    }
    baseline = stage_quality(
        'baseline', x0, x0, rotation0, position0, focal0, cx, cy,
        training, heldout, anchor,
    )
    rotation_fit = optimize(
        x0, residual, [0, 1, 2], limits, 260, reference_x=x0,
    )
    rotation_stage = stage_quality(
        'rotation-only', rotation_fit, x0, rotation0, position0, focal0, cx, cy,
        training, heldout, anchor,
    )
    position_fit = optimize(
        rotation_fit, residual, [0, 1, 2, 3, 4, 5], limits, 300,
        reference_x=x0,
    )
    position_stage = stage_quality(
        'rotation-position', position_fit, x0, rotation0, position0,
        focal0, cx, cy, training, heldout, anchor,
    )
    focal_fit = optimize(
        position_fit, residual, [0, 1, 2, 3, 4, 5, 6], limits, 320,
        reference_x=x0,
    )
    focal_stage = stage_quality(
        'rotation-position-focal', focal_fit, x0, rotation0, position0,
        focal0, cx, cy, training, heldout, anchor,
    )
    stages = [baseline, rotation_stage, position_stage, focal_stage]

    chosen = baseline
    selection_reason = 'baseline-validated' if baseline_gate(baseline) else 'baseline-not-validated'
    if stage_gate(rotation_stage) and meaningful_holdout_improvement(
            rotation_stage, baseline):
        chosen = rotation_stage
        selection_reason = 'rotation-held-out-improvement'
    if stage_gate(position_stage) and meaningful_holdout_improvement(position_stage, chosen):
        chosen = position_stage
        selection_reason = 'position-unlocked-after-held-out-improvement'
    if stage_gate(focal_stage) and meaningful_holdout_improvement(focal_stage, chosen):
        chosen = focal_stage
        selection_reason = 'focal-unlocked-after-held-out-improvement'

    accepted = bool(
        evidence_ok and
        (baseline_gate(chosen) if chosen['name'] == 'baseline' else stage_gate(chosen))
    )
    if accepted:
        reason = None
    elif not evidence_ok:
        reason = 'structural-evidence-diversity-gate'
    else:
        reason = 'held-out-or-pose-quality-gate'

    fitted = chosen['x']
    matrix = chosen['matrix']
    rotation = chosen['rotation']
    position = chosen['position']
    cam_from_world = chosen['camFromWorld']

    def public_stage(stage):
        return {
            key: value for key, value in stage.items()
            if key not in {'x', 'matrix', 'rotation', 'position', 'camFromWorld'}
        }

    metrics = {
        'targetBuildingId': primary_target['buildingId'],
        'targetBuildingIds': [row['buildingId'] for row in target_rows],
        'targetSelectionScore': primary_target['score'],
        'targetProjectedArea': primary_target['projectedArea'],
        'structuralEdgesConsidered': structural_count,
        'imageSegments': len(segments),
        'detectedStructuralEdges': len(selected),
        'trainingStructuralEdges': len(training),
        'heldOutStructuralEdges': len(heldout),
        'orientationBins': orientation_bins,
        'matchedBuildings': matched_buildings,
        'evidenceCenterSpanPixels': center_span.tolist(),
        'structuralEvidenceAccepted': evidence_ok,
        'selectedStage': chosen['name'],
        'selectionReason': selection_reason,
        'initialTrainingLineMedianPixels': baseline['trainingMedianPixels'],
        'initialHeldOutLineMedianPixels': baseline['heldOutMedianPixels'],
        'trainingLineMedianPixels': chosen['trainingMedianPixels'],
        'heldOutLineMedianPixels': chosen['heldOutMedianPixels'],
        'trainingLineRmsPixels': chosen['trainingRmsPixels'],
        'heldOutLineRmsPixels': chosen['heldOutRmsPixels'],
        'positionDeltaMetres': chosen['positionDeltaMetres'],
        'rotationDeltaDegrees': chosen['rotationDeltaDegrees'],
        'focalRatio': chosen['focalRatio'],
        'anchorErrorMetres': chosen['anchorErrorMetres'],
        'stages': [public_stage(stage) for stage in stages],
    }

    overlay = image.copy()
    for index, edge in enumerate(selected):
        before = project([edge['a'], edge['b']], x0, focal0, cx, cy).astype(int)
        after = project([edge['a'], edge['b']], fitted, focal0, cx, cy).astype(int)
        observed = np.asarray(edge['observedLine'], int)
        cv2.line(overlay, tuple(before[0]), tuple(before[1]), (0, 0, 255), 1)
        cv2.line(overlay, tuple(after[0]), tuple(after[1]), (0, 220, 255), 2)
        color = (255, 0, 255) if index in heldout_indices else (0, 255, 0)
        cv2.line(overlay, tuple(observed[0]), tuple(observed[1]), color, 1)
    output_dir.mkdir(parents=True, exist_ok=True)
    overlay_path = output_dir / f'{photo["id"]}-{primary_target["buildingId"]}.jpg'
    cv2.imwrite(str(overlay_path), overlay)

    return {
        'accepted': accepted,
        'reason': reason,
        'metrics': metrics,
        'position': position.tolist(),
        'camFromWorld': cam_from_world.tolist(),
        'cameraMatrix': matrix.tolist(),
        'focalPixels': float(matrix[0, 0]),
        'rotationVector': fitted[:3].tolist(),
        'registrationStage': chosen['name'],
        'overlayPath': str(overlay_path.relative_to(ROOT)).replace('\\', '/'),
        'structuralEdges': selected,
        'accuracy': 'Staged local photographic registration with frozen PLATEAU/image structural-edge matches, strong SfM/GPS/intrinsic priors, and held-out edge validation; not surveyed control.',
    }


def run(area):
    if area not in TILES:
        raise ValueError('area must be tocho or tokyo-tower')
    base = ROOT / 'data/texture-city/msls'
    inputs_path = base / f'snap-inputs-{area}.json'
    baseline_path = base / f'snap-surfaces-{area}.json'
    inputs = json.loads(inputs_path.read_text(encoding='utf8'))
    baseline = json.loads(baseline_path.read_text(encoding='utf8'))
    plateau = json.loads((ROOT / 'shared/generated/plateau.json').read_text(encoding='utf8'))
    area_meta = next(item for item in plateau['areas'] if item['id'] == area)
    geometry_path = ROOT / 'data/plateau' / area_meta['dataset'] / f'{TILES[area]}-geometry.json'
    geometry = json.loads(geometry_path.read_text(encoding='utf8'))
    buildings = {item['id']: item for item in geometry['buildings']}
    photos = {item['id']: item for item in inputs['photos']}
    targets = choose_target_buildings(baseline)
    output_dir = base / 'local-registration' / area
    registrations = []
    for source_id, target_rows in sorted(targets.items()):
        photo = photos.get(source_id)
        if not photo or not target_rows:
            continue
        result = fit_one(photo, target_rows, buildings, output_dir)
        registrations.append({
            'sourceId': source_id,
            'sourceSha256': photo['sourceSha256'],
            'imageSha256': photo['imageSha256'],
            'priorPosition': photo['position'],
            'priorCameraMatrix': photo['cameraMatrix'],
            **result,
        })
        short = result.get('metrics', {})
        print(json.dumps({
            'area': area, 'sourceId': source_id, 'accepted': result['accepted'],
            'reason': result.get('reason'), 'target': target_rows[0]['buildingId'],
            'heldOutBefore': short.get('initialHeldOutLineMedianPixels'),
            'heldOutAfter': short.get('heldOutLineMedianPixels'),
            'selectedStage': short.get('selectedStage'),
            'stageSummary': [
                {
                    'name': stage['name'],
                    'train': stage['trainingMedianPixels'],
                    'hold': stage['heldOutMedianPixels'],
                    'holdRms': stage['heldOutRmsPixels'],
                    'rotDeg': stage['rotationDeltaDegrees'],
                    'posM': stage['positionDeltaMetres'],
                    'focal': stage['focalRatio'],
                    'anchorM': stage['anchorErrorMetres'],
                }
                for stage in short.get('stages', [])
            ],
            'edges': short.get('detectedStructuralEdges', result.get('detectedEdges')),
        }), flush=True)

    accepted = sum(bool(row['accepted']) for row in registrations)
    report = {
        'areaId': area,
        'inputSha256': sha(inputs_path),
        'baselineSurfacesSha256': sha(baseline_path),
        'geometrySha256': sha(geometry_path),
        'registration': 'estimated-unverified',
        'policy': 'per-source staged local PLATEAU structural-edge pose refinement; rotation first, then small position/focal only after held-out improvement; frozen matches; failed sources rejected',
        'qualityGates': {
            'maximumHeldOutLineMedianPixels': 6,
            'maximumHeldOutLineRmsPixels': 10,
            'maximumTrainingLineMedianPixels': 6,
            'maximumPositionDeltaMetres': 1.25,
            'maximumRotationDeltaDegrees': 4,
            'focalRatioRange': [.975, 1.025],
            'maximumAnchorErrorMetres': 1.75,
            'baselineMaximumHeldOutLineMedianPixels': 5.5,
            'baselineMaximumHeldOutLineRmsPixels': 9,
            'baselineMaximumTrainingLineMedianPixels': 5.5,
            'minimumOrientationBins': 2,
        },
        'registrations': registrations,
        'acceptedSources': accepted,
        'rejectedSources': len(registrations) - accepted,
        'applied': False,
        'warning': 'Held-out image-edge validation reduces self-fit risk but does not establish surveyed camera accuracy or facade identity.',
    }
    output_path = base / f'snap-local-registration-{area}.json'
    output_path.write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({'area': area, 'registrations': len(registrations), 'accepted': accepted, 'written': str(output_path)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('area', choices=sorted(TILES))
    run(parser.parse_args().area)
