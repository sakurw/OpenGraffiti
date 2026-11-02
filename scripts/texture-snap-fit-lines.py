"""Fit the Commons/SNAP camera and validate it on withheld controls.

The geometry remains the original PLATEAU geometry. The fit uses manually
identified roof controls plus image-derived matches for long PLATEAU vertical
structural edges. Edge matches are frozen before the final fit and split into
training/held-out sets. This remains photographic registration, not surveyed
control.
"""
import hashlib
import json
import math

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


case, geometry_path = load_case()
source = ROOT / f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
meta = json.loads(source.with_suffix('.json').read_text(encoding='utf8'))
assert hashlib.sha256(source.read_bytes()).hexdigest() == meta['sha256']
image = cv2.imread(str(source))
assert image is not None
h, w = image.shape[:2]
scale = np.array([w / case['referenceSize'][0], h / case['referenceSize'][1]])
world = np.asarray(case['worldPoints'], float)
pixels = np.asarray(case['imagePoints'], float) * scale
prior = np.asarray(case['cameraPrior'], float)
geometry = json.loads(geometry_path.read_text(encoding='utf8'))
building = next(b for b in geometry['buildings'] if b['id'] == case['buildingId'])


def unpack(x):
    f = np.exp(x[6])
    k = np.array([[f, 0, x[8]], [0, f, x[7]], [0, 0, 1]], float)
    rotation = cv2.Rodrigues(x[:3])[0]
    return k, rotation, -rotation @ x[3:6]


def project(points, x):
    k, _, t = unpack(x)
    return cv2.projectPoints(np.asarray(points, float), x[:3], t, k, None)[0].reshape(-1, 2)


def optimize(x, residual, iterations=260):
    x = x.copy()
    damping = 1e-3
    steps = np.array([1e-6] * 3 + [1e-4] * 3 + [1e-6, 1e-3, 1e-3])
    for _ in range(iterations):
        e = residual(x)
        eye = np.eye(len(x))
        j = np.column_stack([(residual(x + eye[i] * steps[i]) - e) / steps[i] for i in range(len(x))])
        lhs = j.T @ j
        try:
            update = np.linalg.solve(lhs + damping * np.diag(np.maximum(np.diag(lhs), 1)), j.T @ e)
        except np.linalg.LinAlgError:
            damping *= 10
            continue
        trial = x - update
        if (not np.isfinite(trial).all() or not np.log(w * .2) < trial[6] < np.log(w * 10)
                or not w * .15 < trial[8] < w * .85 or not h * .15 < trial[7] < h * .85):
            damping *= 10
            continue
        if np.sum(residual(trial) ** 2) < np.sum(e ** 2):
            x = trial
            damping = max(1e-8, damping / 3)
            if np.linalg.norm(update) < 1e-7:
                break
        else:
            damping *= 10
    return x


def prior_residual(x):
    # Geotag/height and optical-centre priors are deliberately loose.
    return np.r_[
        (x[3:6] - prior) / np.array([100, case.get('cameraHeightSigma', 10), 100]),
        (x[8] - w / 2) / (w * .18),
        (x[7] - h / 2) / (h * .18),
    ]


def point_residual(x, indices):
    return (project(world[indices], x) - pixels[indices]).reshape(-1)


all_indices = np.arange(len(world))


def initial_residual(x):
    return np.r_[point_residual(x, all_indices), prior_residual(x)]


fits = []
for focal in np.linspace(w * .5, w * 4, 40):
    k = np.array([[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], float)
    ok, r, t = cv2.solvePnP(world, pixels, k, None, flags=cv2.SOLVEPNP_SQPNP)
    if not ok:
        continue
    position = -(cv2.Rodrigues(r)[0].T @ t).reshape(3)
    x0 = np.r_[r.reshape(3), position, np.log(focal), h / 2, w / 2]
    x0 = optimize(x0, initial_residual)
    _, rotation, translation = unpack(x0)
    if np.min((rotation @ world.T + translation[:, None])[2]) > 0:
        fits.append((float(np.sum(initial_residual(x0) ** 2)), x0))
assert fits, 'No camera fit'
_, initial = min(fits, key=lambda value: value[0])


def vertical_edges(camera_position):
    found = {}
    for wall in building['walls']:
        outer = np.asarray(wall['rings'][0]['points'], float)
        normal = np.cross(outer, np.roll(outer, -1, axis=0)).sum(axis=0)
        if np.dot(normal, camera_position - outer.mean(axis=0)) <= 0:
            continue
        for ring in wall['rings']:
            points = np.asarray(ring['points'], float)
            for i, a in enumerate(points):
                b = points[(i + 1) % len(points)]
                horizontal = math.hypot(a[0] - b[0], a[2] - b[2])
                vertical = abs(a[1] - b[1])
                if horizontal > .08 or vertical < case.get('calibrationMinimumEdgeHeight', 25):
                    continue
                lo, hi = (a, b) if a[1] <= b[1] else (b, a)
                key = (round(float((a[0] + b[0]) / 2), 3), round(float((a[2] + b[2]) / 2), 3))
                if key not in found or vertical > found[key]['height']:
                    found[key] = {'bottom': lo.tolist(), 'top': hi.tolist(), 'height': float(vertical)}
    return list(found.values())


gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)


def sample_map(array, points):
    map_x = points[:, 0].astype(np.float32).reshape(-1, 1)
    map_y = points[:, 1].astype(np.float32).reshape(-1, 1)
    return cv2.remap(array, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).reshape(-1)


def detect_edge(edge, x):
    uv = project([edge['bottom'], edge['top']], x)
    a, b = uv
    d = b - a
    length = np.linalg.norm(d)
    if length < 140:
        return None
    direction = d / length
    normal = np.array([-direction[1], direction[0]])
    ts = np.linspace(.12, .88, max(45, min(140, int(length / 8))))
    base = a[None, :] + ts[:, None] * d[None, :]
    margin = case.get('calibrationImageMarginPixels', 35)
    if (base[:, 0].min() < margin or base[:, 0].max() > w - margin or
            base[:, 1].min() < margin or base[:, 1].max() > h - margin):
        return None
    search = int(case.get('calibrationSearchPixels', 28))
    offsets = np.arange(-search, search + 1, dtype=float)
    scores = []
    for offset in offsets:
        points = base + normal[None, :] * offset
        directional = sample_map(gx, points) * normal[0] + sample_map(gy, points) * normal[1]
        scores.append(float(np.percentile(np.abs(directional), 60)))
    scores = np.asarray(scores)
    best_index = int(np.argmax(scores))
    best_offset = float(offsets[best_index])
    baseline = float(np.median(scores))
    prominence = float((scores[best_index] + 1) / (baseline + 1))
    if scores[best_index] < case.get('calibrationMinimumGradient', 55) or prominence < case.get('calibrationMinimumProminence', 1.18):
        return None
    observed = uv + normal[None, :] * best_offset
    return {
        **edge,
        'initialProjected': uv.tolist(),
        'observedLine': observed.tolist(),
        'offsetPixels': best_offset,
        'gradientScore': float(scores[best_index]),
        'prominence': prominence,
    }


detected = [match for edge in vertical_edges(initial[3:6]) if (match := detect_edge(edge, initial))]
detected.sort(key=lambda item: (np.mean(np.asarray(item['observedLine']), axis=0)[0], -item['height']))
# Keep spatially distributed, long, strong matches; near-duplicate lines add little information.
selected = []
for match in sorted(detected, key=lambda item: (-item['height'], -item['prominence'])):
    center = np.mean(np.asarray(match['observedLine']), axis=0)
    if any(abs(center[0] - np.mean(np.asarray(other['observedLine']), axis=0)[0]) < 14 for other in selected):
        continue
    selected.append(match)
selected.sort(key=lambda item: np.mean(np.asarray(item['observedLine']), axis=0)[0])
assert len(selected) >= 8, f'Only {len(selected)} reliable structural edges found'

holdout_point_indices = np.asarray(case.get('heldOutPointIndices', [1, 4]), int)
holdout_set = set(holdout_point_indices.tolist())
training_point_indices = np.asarray([i for i in all_indices if i not in holdout_set], int)
heldout_edge_indices = {i for i in range(len(selected)) if i % 4 == 1}
training_edges = [edge for i, edge in enumerate(selected) if i not in heldout_edge_indices]
heldout_edges = [edge for i, edge in enumerate(selected) if i in heldout_edge_indices]


def edge_raw_residual(x, edge):
    observed = np.asarray(edge['observedLine'], float)
    oa, ob = observed
    od = ob - oa
    olen = max(np.linalg.norm(od), 1e-8)
    bottom = np.asarray(edge['bottom'], float)
    top = np.asarray(edge['top'], float)
    samples = np.asarray([bottom, (bottom + top) / 2, top])
    projected = project(samples, x)
    return np.asarray([(od[0] * (p - oa)[1] - od[1] * (p - oa)[0]) / olen for p in projected])


def robust(values, delta=12.0):
    return delta * np.arcsinh(np.asarray(values, float) / delta)


def final_residual(x):
    lines = np.concatenate([robust(edge_raw_residual(x, edge)) for edge in training_edges])
    return np.r_[point_residual(x, training_point_indices), lines * .65, prior_residual(x)]


fitted = optimize(initial, final_residual, 360)
k, rotation, translation = unpack(fitted)
assert np.min((rotation @ world.T + translation[:, None])[2]) > 0

projected_controls = project(world, fitted)
point_errors = np.linalg.norm(projected_controls - pixels, axis=1)
training_edge_errors = np.concatenate([np.abs(edge_raw_residual(fitted, edge)) for edge in training_edges])
heldout_edge_errors = np.concatenate([np.abs(edge_raw_residual(fitted, edge)) for edge in heldout_edges])


def rms(values):
    values = np.asarray(values, float)
    return float(np.sqrt(np.mean(values ** 2))) if len(values) else None


result = {
    **case,
    'sourceSha256': meta['sha256'],
    'imageSize': [w, h],
    'imageControls': pixels.tolist(),
    'cameraPosition': fitted[3:6].tolist(),
    'focalPixels': float(k[0, 0]),
    'cameraMatrix': k.tolist(),
    'rotationVector': fitted[:3].tolist(),
    'translationVector': translation.tolist(),
    'rmsPixels': rms(point_errors),
    'trainingPointIndices': training_point_indices.tolist(),
    'heldOutPointIndices': holdout_point_indices.tolist(),
    'trainingPointRmsPixels': rms(point_errors[training_point_indices]),
    'heldOutPointRmsPixels': rms(point_errors[holdout_point_indices]),
    'heldOutPointResidualPixels': point_errors[holdout_point_indices].tolist(),
    'structuralEdges': selected,
    'trainingStructuralEdges': len(training_edges),
    'heldOutStructuralEdges': len(heldout_edges),
    'trainingLineResidualRmsPixels': rms(training_edge_errors),
    'trainingLineResidualMedianPixels': float(np.median(training_edge_errors)),
    'heldOutLineResidualRmsPixels': rms(heldout_edge_errors),
    'heldOutLineResidualMedianPixels': float(np.median(heldout_edge_errors)),
    'projectedControls': projected_controls.tolist(),
    'radialDistortion': {'model': 'none', 'reason': 'Not introduced without independent evidence of held-out improvement.'},
    'applied': False,
    'accuracy': 'Photographic registration with withheld manual roof controls and withheld image-derived PLATEAU structural edges; not surveyed control.',
}
print(json.dumps({key: result[key] for key in [
    'cameraPosition', 'focalPixels', 'trainingPointRmsPixels', 'heldOutPointRmsPixels',
    'trainingLineResidualMedianPixels', 'heldOutLineResidualMedianPixels',
    'trainingStructuralEdges', 'heldOutStructuralEdges'
]}), flush=True)
assert result['trainingPointRmsPixels'] < case.get('maximumTrainingPointResidualPixels', 10), 'Poor training point fit'
assert result['heldOutPointRmsPixels'] < case.get('maximumHeldOutPointResidualPixels', 18), 'Poor held-out point fit'
assert result['heldOutLineResidualMedianPixels'] < case.get('maximumHeldOutLineMedianPixels', 14), 'Poor held-out edge fit'
assert abs(result['cameraPosition'][1] - prior[1]) < case.get('maximumCameraHeightPriorDelta', 12), 'Fit violates camera-height prior'

overlay = image.copy()
for index, edge in enumerate(selected):
    projected = project([edge['bottom'], edge['top']], fitted).astype(int)
    observed = np.asarray(edge['observedLine'], int)
    cv2.line(overlay, tuple(projected[0]), tuple(projected[1]), (0, 210, 255), 2)
    color = (255, 0, 255) if index in heldout_edge_indices else (255, 255, 0)
    cv2.line(overlay, tuple(observed[0]), tuple(observed[1]), color, 1)
for i, p in enumerate(pixels):
    color = (255, 0, 255) if i in holdout_set else (0, 0, 255)
    cv2.circle(overlay, tuple(p.astype(int)), 7, color, 2)
    cv2.putText(overlay, str(i + 1), tuple((p + [10, 0]).astype(int)), cv2.FONT_HERSHEY_SIMPLEX, .8, color, 2)

out = ROOT / 'data/texture-city/registration'
out.mkdir(parents=True, exist_ok=True)
(out / f'{case["caseId"]}.json').write_text(json.dumps(result, indent=2), encoding='utf8')
cv2.imwrite(str(out / f'{case["caseId"]}-wireframe.jpg'), overlay)
print(json.dumps({'written': str(out / f'{case["caseId"]}.json'), 'applied': result['applied']}))
