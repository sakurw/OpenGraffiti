"""Validate a fitted Commons camera on PLATEAU structural edges not used as controls.

The validator never changes the camera. It projects visible PLATEAU vertical
edges, searches the source photograph only in the direction normal to each
projected edge, and reports the image-edge offset. Edges sharing X/Z with the
manual roof/line controls are excluded so the reported set is independent of
the registration controls.
"""
import hashlib
import json
import math
import argparse

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


parser = argparse.ArgumentParser()
parser.add_argument(
    'case_id',
    nargs='?',
    default='park-tower-west',
    help='SNAP case ID (kept as argv[1] for the shared load_case helper).',
)
parser.add_argument(
    '--registration',
    help='Registration JSON to validate. Defaults to the active case registration.',
)
parser.add_argument(
    '--output-tag',
    help='Suffix used for validation JSON/JPG outputs. Defaults to registration filename suffix.',
)
args = parser.parse_args()

case, geometry_path = load_case()
default_registration_path = ROOT / f'data/texture-city/registration/{case["caseId"]}.json'
registration_path = ROOT / args.registration if args.registration else default_registration_path
registration_bytes = registration_path.read_bytes()
fit = json.loads(registration_bytes.decode('utf8'))
source = ROOT / f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
meta = json.loads(source.with_suffix('.json').read_text(encoding='utf8'))
assert hashlib.sha256(source.read_bytes()).hexdigest() == meta['sha256']

image = cv2.imread(str(source))
assert image is not None
h, w = image.shape[:2]
geometry = json.loads(geometry_path.read_text(encoding='utf8'))
building = next(b for b in geometry['buildings'] if b['id'] == case['buildingId'])

rvec = np.asarray(fit['rotationVector'], dtype=float)
tvec = np.asarray(fit['translationVector'], dtype=float)
camera = np.asarray(fit['cameraMatrix'], dtype=float)
position = np.asarray(fit['cameraPosition'], dtype=float)


def project(points):
    return cv2.projectPoints(np.asarray(points, dtype=float), rvec, tvec, camera, None)[0].reshape(-1, 2)


def wall_facing(points):
    p = np.asarray(points, dtype=float)
    normal = np.cross(p, np.roll(p, -1, axis=0)).sum(axis=0)
    return float(np.dot(normal, position - p.mean(axis=0))) > 0


def clip_segment(a, b, margin=18.0):
    """Liang-Barsky clip to an inset image rectangle."""
    x0, y0 = map(float, a)
    x1, y1 = map(float, b)
    dx, dy = x1 - x0, y1 - y0
    xmin, xmax = margin, w - 1 - margin
    ymin, ymax = margin, h - 1 - margin
    p = (-dx, dx, -dy, dy)
    q = (x0 - xmin, xmax - x0, y0 - ymin, ymax - y0)
    lo, hi = 0.0, 1.0
    for pi, qi in zip(p, q):
        if abs(pi) < 1e-12:
            if qi < 0:
                return None
            continue
        r = qi / pi
        if pi < 0:
            lo = max(lo, r)
        else:
            hi = min(hi, r)
        if lo > hi:
            return None
    return np.array([x0 + lo * dx, y0 + lo * dy]), np.array([x0 + hi * dx, y0 + hi * dy])


manual_xz = []
for p in case.get('worldPoints', []):
    manual_xz.append(np.asarray([p[0], p[2]], dtype=float))
for line in case.get('verticalLines', []):
    p = line['worldPoint']
    manual_xz.append(np.asarray([p[0], p[2]], dtype=float))


def independent_xz(xz):
    return all(float(np.linalg.norm(np.asarray(xz) - p)) > 0.75 for p in manual_xz)


edges = {}
for wall in building['walls']:
    outer = wall['rings'][0]['points']
    if not wall_facing(outer):
        continue
    for ring in wall['rings']:
        points = np.asarray(ring['points'], dtype=float)
        for i, a in enumerate(points):
            b = points[(i + 1) % len(points)]
            horizontal = math.hypot(a[0] - b[0], a[2] - b[2])
            vertical = abs(a[1] - b[1])
            if horizontal > 0.08 or vertical < 8:
                continue
            lo, hi = (a, b) if a[1] <= b[1] else (b, a)
            xz = (float((a[0] + b[0]) / 2), float((a[2] + b[2]) / 2))
            if not independent_xz(xz):
                continue
            key = (round(xz[0], 3), round(xz[1], 3))
            if key not in edges or vertical > edges[key]['height']:
                edges[key] = {'bottom': lo.tolist(), 'top': hi.tolist(), 'height': float(vertical), 'xz': list(key)}

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)


def sample_map(array, points):
    mx = points[:, 0].astype(np.float32).reshape(-1, 1)
    my = points[:, 1].astype(np.float32).reshape(-1, 1)
    return cv2.remap(array, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).reshape(-1)


def detect(edge):
    projected = project([edge['bottom'], edge['top']])
    clipped = clip_segment(projected[0], projected[1])
    if clipped is None:
        return None
    a, b = clipped
    d = b - a
    length = float(np.linalg.norm(d))
    if length < 180:
        return None
    direction = d / length
    normal = np.array([-direction[1], direction[0]])
    # Avoid endpoints, where roof/ground silhouettes and occluders dominate.
    ts = np.linspace(.15, .85, min(180, max(60, int(length / 8))))
    base = a[None, :] + ts[:, None] * d[None, :]
    offsets = np.arange(-42, 43, dtype=float)
    scores = []
    for offset in offsets:
        samples = base + normal[None, :] * offset
        directional = sample_map(gx, samples) * normal[0] + sample_map(gy, samples) * normal[1]
        # A real facade edge need not be strong over its entire visible length.
        scores.append(float(np.percentile(np.abs(directional), 68)))
    scores = np.asarray(scores)
    best_index = int(np.argmax(scores))
    best_offset = float(offsets[best_index])
    baseline = float(np.median(scores))
    prominence = float((scores[best_index] + 1) / (baseline + 1))
    if scores[best_index] < 38 or prominence < 1.08:
        return None
    observed = projected + normal[None, :] * best_offset
    return {
        **edge,
        'projected': projected.tolist(),
        'visibleLengthPixels': length,
        'offsetPixels': best_offset,
        'absoluteOffsetPixels': abs(best_offset),
        'gradientScore': float(scores[best_index]),
        'prominence': prominence,
        'observed': observed.tolist(),
    }


matches = [m for edge in edges.values() if (m := detect(edge)) is not None]
# Prefer spatially distinct edges; duplicate lines from near-coincident LOD faces
# would otherwise make the validation look stronger than it is.
matches.sort(key=lambda m: (-m['visibleLengthPixels'], -m['prominence']))
selected = []
for match in matches:
    center = np.mean(np.asarray(match['projected']), axis=0)
    if any(np.linalg.norm(center - np.mean(np.asarray(other['projected']), axis=0)) < 90 for other in selected):
        continue
    selected.append(match)
selected.sort(key=lambda m: np.mean(np.asarray(m['projected']), axis=0)[0])

offsets = np.asarray([m['absoluteOffsetPixels'] for m in selected], dtype=float)
median = float(np.median(offsets)) if len(offsets) else None
p90 = float(np.percentile(offsets, 90)) if len(offsets) else None
maximum = float(np.max(offsets)) if len(offsets) else None
minimum_count = int(case.get('validationMinimumIndependentEdges', 3))
maximum_median = float(case.get('validationMaximumMedianPixels', 18))
maximum_p90 = float(case.get('validationMaximumP90Pixels', 32))
passed = bool(len(selected) >= minimum_count and median <= maximum_median and p90 <= maximum_p90)

result = {
    'caseId': case['caseId'],
    'sourceSha256': meta['sha256'],
    'registrationFile': str(registration_path.relative_to(ROOT)).replace('\\', '/'),
    'registrationSha256': hashlib.sha256(registration_bytes).hexdigest(),
    'method': 'held-out automatic image-gradient search around projected PLATEAU vertical edges',
    'manualControlExclusionRadiusMetres': 0.75,
    'candidateIndependentEdges': len(edges),
    'matchedIndependentEdges': len(matches),
    'selectedIndependentEdges': len(selected),
    'medianAbsoluteOffsetPixels': median,
    'p90AbsoluteOffsetPixels': p90,
    'maximumAbsoluteOffsetPixels': maximum,
    'thresholds': {
        'minimumIndependentEdges': minimum_count,
        'maximumMedianPixels': maximum_median,
        'maximumP90Pixels': maximum_p90,
    },
    'passed': passed,
    'edges': selected,
}

overlay = image.copy()
for index, match in enumerate(selected, 1):
    projected = np.asarray(match['projected'], dtype=int)
    observed = np.asarray(match['observed'], dtype=int)
    cv2.line(overlay, tuple(projected[0]), tuple(projected[1]), (0, 210, 255), 3)
    cv2.line(overlay, tuple(observed[0]), tuple(observed[1]), (255, 0, 255), 2)
    center = np.mean(projected, axis=0).astype(int)
    cv2.putText(overlay, f'{index}:{match["absoluteOffsetPixels"]:.1f}px', tuple(center),
                cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 0, 255), 2)

out = ROOT / 'data/texture-city/registration'
if args.output_tag:
    output_tag = args.output_tag
elif registration_path.resolve() == default_registration_path.resolve():
    output_tag = ''
else:
    stem = registration_path.stem
    prefix = f'{case["caseId"]}-'
    output_tag = stem[len(prefix):] if stem.startswith(prefix) else stem
output_suffix = f'-{output_tag}' if output_tag else ''
json_path = out / f'{case["caseId"]}-validation{output_suffix}.json'
image_path = out / f'{case["caseId"]}-validation{output_suffix}.jpg'
json_path.write_text(json.dumps(result, indent=2), encoding='utf8')
assert cv2.imwrite(str(image_path), overlay)
print(json.dumps({k: result[k] for k in [
    'caseId', 'candidateIndependentEdges', 'matchedIndependentEdges', 'selectedIndependentEdges',
    'medianAbsoluteOffsetPixels', 'p90AbsoluteOffsetPixels', 'maximumAbsoluteOffsetPixels', 'passed'
]}))
if not passed:
    raise SystemExit(2)
