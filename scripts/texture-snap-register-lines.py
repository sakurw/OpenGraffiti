"""Fit a camera from roof points plus vertical-line controls.

Unlike texture-snap-register.py, this uses the case's verticalLines entries as
orientation constraints.  Each observed image point is constrained only to the
projection of the corresponding 3D vertical line, so no unknown facade height
is invented.  By default the result is written beside the active registration;
pass --write-main to replace the active registration after inspection.
"""
import hashlib
import json
import math
import sys

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


case, geometry_path = load_case()
fixed_principal_point = '--fixed-principal-point' in sys.argv or 'fixedpp' in sys.argv
regularized_principal_point = '--regularized-principal-point' in sys.argv or 'regularizedpp' in sys.argv
if fixed_principal_point and regularized_principal_point:
    raise SystemExit('Choose only one principal-point mode')
principal_point_mode = ('fixed' if fixed_principal_point else
                        'regularized' if regularized_principal_point else 'free')
source = ROOT / f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
meta = json.loads(source.with_suffix('.json').read_text(encoding='utf8'))
assert hashlib.sha256(source.read_bytes()).hexdigest() == meta['sha256']
image = cv2.imread(str(source))
assert image is not None
h, w = image.shape[:2]
scale = np.array([w / case['referenceSize'][0], h / case['referenceSize'][1]], dtype=float)
world = np.asarray(case['worldPoints'], dtype=float)
pixels = np.asarray(case['imagePoints'], dtype=float) * scale
prior = np.asarray(case['cameraPrior'], dtype=float)
vertical_controls = case.get('verticalLines', [])
assert len(vertical_controls) >= 2, 'Need at least two vertical-line controls'

geometry = json.loads(geometry_path.read_text(encoding='utf8'))
building = next(b for b in geometry['buildings'] if b['id'] == case['buildingId'])
building_min_y = min(p[1] for poly in building['polygons'] for ring in poly['rings'] for p in ring['points'])


def unpack(x):
    focal = math.exp(float(x[5]))
    principal_x = w / 2 if fixed_principal_point else x[6]
    principal_y = h / 2 if fixed_principal_point else x[7]
    camera = np.array([[focal, 0, principal_x], [0, focal, principal_y], [0, 0, 1]], dtype=float)
    rotation = cv2.Rodrigues(x[:3])[0]
    position = np.array([x[3], prior[1], x[4]], dtype=float)
    translation = -rotation @ position
    return camera, rotation, translation, position


def project(points, x):
    camera, _, translation, _ = unpack(x)
    return cv2.projectPoints(np.asarray(points, dtype=float), x[:3], translation, camera, None)[0].reshape(-1, 2)


def line_distance(point, a, b):
    d = b - a
    length = max(float(np.linalg.norm(d)), 1e-9)
    return float((d[0] * (point - a)[1] - d[1] * (point - a)[0]) / length)


def line_residuals(x):
    residuals = []
    for control in vertical_controls:
        top = np.asarray(control['worldPoint'], dtype=float)
        bottom = top.copy()
        bottom[1] = building_min_y
        a, b = project([bottom, top], x)
        for observed in np.asarray(control['imagePoints'], dtype=float) * scale:
            residuals.append(line_distance(observed, a, b))
    return np.asarray(residuals, dtype=float)


def prior_residuals(x):
    # Keep the road-derived eye-height prior fixed. The road audit checks the
    # fitted X/Z afterwards because a camera move can change the local road Z.
    values = [
        (x[3] - prior[0]) / 90.0,
        (x[4] - prior[2]) / 90.0,
        (x[5] - math.log(w * 1.4)) / 1.2,
    ]
    if not fixed_principal_point:
        principal_sigma = 0.04 if regularized_principal_point else 0.12
        values.extend([
            (x[6] - w / 2) / (w * principal_sigma),
            (x[7] - h / 2) / (h * principal_sigma),
        ])
    return np.asarray(values, dtype=float)


def robust(values, delta=16.0):
    return delta * np.arcsinh(np.asarray(values, dtype=float) / delta)


def residual(x):
    point_error = (project(world, x) - pixels).reshape(-1)
    # Vertical lines primarily constrain camera orientation. A moderate weight
    # keeps the three manually identified roof corners metrically anchored.
    return np.r_[point_error, robust(line_residuals(x)) * 0.8, prior_residuals(x)]


def optimize(x, iterations=360):
    x = x.copy()
    damping = 1e-3
    maximum_damping = 1e12
    steps = np.array([1e-6] * 3 + [1e-4] * 2 + [1e-6] +
                     ([] if fixed_principal_point else [1e-3, 1e-3]))
    eye = np.eye(len(x))
    for _ in range(iterations):
        e = residual(x)
        jacobian = np.column_stack([(residual(x + eye[i] * steps[i]) - e) / steps[i] for i in range(len(x))])
        lhs = jacobian.T @ jacobian
        rhs = jacobian.T @ e
        if not np.isfinite(lhs).all() or not np.isfinite(rhs).all():
            break
        diagonal = np.maximum(np.diag(lhs), 1.0)
        try:
            update = np.linalg.solve(lhs + np.diag(diagonal * damping), rhs)
        except np.linalg.LinAlgError:
            damping = min(maximum_damping, damping * 10)
            if damping >= maximum_damping:
                break
            continue
        trial = x - update
        principal_bounds = (0.38, 0.62) if regularized_principal_point else (0.30, 0.70)
        invalid_principal = (not fixed_principal_point and
                             (not w * principal_bounds[0] < trial[6] < w * principal_bounds[1] or
                              not h * principal_bounds[0] < trial[7] < h * principal_bounds[1]))
        if (not np.isfinite(trial).all()
                or not math.log(w * .4) < trial[5] < math.log(w * 6)
                or invalid_principal):
            damping = min(maximum_damping, damping * 10)
            if damping >= maximum_damping:
                break
            continue
        camera, rotation, translation, _ = unpack(trial)
        if np.min((rotation @ world.T + translation[:, None])[2]) <= 0:
            damping = min(maximum_damping, damping * 10)
            if damping >= maximum_damping:
                break
            continue
        if np.sum(residual(trial) ** 2) < np.sum(e ** 2):
            x = trial
            damping = max(1e-8, damping / 3)
            if np.linalg.norm(update) < 1e-7:
                break
        else:
            damping = min(maximum_damping, damping * 10)
            if damping >= maximum_damping:
                break
    return x


seeds = []
for focal in np.linspace(w * .7, w * 3.0, 32):
    camera = np.array([[focal, 0, w / 2], [0, focal, h / 2], [0, 0, 1]], dtype=float)
    ok, rvec, tvec = cv2.solvePnP(world, pixels, camera, None, flags=cv2.SOLVEPNP_SQPNP)
    if not ok:
        continue
    rotation = cv2.Rodrigues(rvec)[0]
    position = -(rotation.T @ tvec).reshape(3)
    seed = np.r_[rvec.reshape(3), position[0], position[2], math.log(focal)]
    if not fixed_principal_point:
        seed = np.r_[seed, w / 2, h / 2]
    fitted = optimize(seed)
    seeds.append((float(np.sum(residual(fitted) ** 2)), fitted))
assert seeds, 'No line-constrained camera fit'
_, fitted = min(seeds, key=lambda item: item[0])
camera, rotation, translation, camera_position = unpack(fitted)
projected = project(world, fitted)
point_errors = np.linalg.norm(projected - pixels, axis=1)
line_errors = np.abs(line_residuals(fitted))

result = {
    **case,
    'sourceSha256': meta['sha256'],
    'imageSize': [w, h],
    'imageControls': pixels.tolist(),
    'focalPixels': float(camera[0, 0]),
    'cameraPosition': camera_position.tolist(),
    'rotationVector': fitted[:3].tolist(),
    'translationVector': translation.tolist(),
    'cameraMatrix': camera.tolist(),
    'rmsPixels': float(np.sqrt(np.mean(point_errors ** 2))),
    'projectedControls': projected.tolist(),
    'verticalLineControlRmsPixels': float(np.sqrt(np.mean(line_errors ** 2))),
    'verticalLineControlMedianPixels': float(np.median(line_errors)),
    'verticalLineControlResidualPixels': line_errors.tolist(),
    'priorScore': float(np.sum(prior_residuals(fitted) ** 2)),
    'registration': f'manual-roof-points-plus-vertical-line-controls-{principal_point_mode}-principal-point',
    'principalPointMode': principal_point_mode,
    'accuracy': 'Fit uses three roof points and two manually read facade vertical lines; independent validation is stored separately.',
    'applied': False,
}

overlay = image.copy()
for polygon in building['walls']:
    for ring in polygon['rings']:
        vertices = np.asarray(ring['points'], dtype=float)
        for i, a in enumerate(vertices):
            b = vertices[(i + 1) % len(vertices)]
            if min(a[1], b[1]) < case['minimumHeight']:
                continue
            uv = project([a, b], fitted)
            if np.all(np.isfinite(uv)) and np.max(np.abs(uv)) < 10000:
                cv2.line(overlay, tuple(uv[0].astype(int)), tuple(uv[1].astype(int)), (255, 200, 0), 2)
for index, (observed, predicted) in enumerate(zip(pixels, projected), 1):
    cv2.circle(overlay, tuple(observed.astype(int)), 8, (0, 0, 255), 2)
    cv2.putText(overlay, str(index), tuple((observed + [8, -8]).astype(int)), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
for control in vertical_controls:
    observed = np.asarray(control['imagePoints'], dtype=float) * scale
    cv2.line(overlay, tuple(observed[0].astype(int)), tuple(observed[1].astype(int)), (255, 0, 255), 3)

out = ROOT / 'data/texture-city/registration'
preview_suffix = ('linefit-fixedpp' if fixed_principal_point else
                  'linefit-regularizedpp' if regularized_principal_point else 'linefit')
preview_json = out / f'{case["caseId"]}-{preview_suffix}.json'
preview_image = out / f'{case["caseId"]}-{preview_suffix}-wireframe.jpg'
preview_json.write_text(json.dumps(result, indent=2), encoding='utf8')
assert cv2.imwrite(str(preview_image), overlay)
if '--write-main' in sys.argv:
    (out / f'{case["caseId"]}.json').write_text(json.dumps(result, indent=2), encoding='utf8')
    assert cv2.imwrite(str(out / f'{case["caseId"]}-wireframe.jpg'), overlay)

print(json.dumps({
    'caseId': case['caseId'],
    'focalPixels': result['focalPixels'],
    'cameraPosition': result['cameraPosition'],
    'roofPointRmsPixels': result['rmsPixels'],
    'verticalLineControlRmsPixels': result['verticalLineControlRmsPixels'],
    'verticalLineControlMedianPixels': result['verticalLineControlMedianPixels'],
    'principalPoint': [float(camera[0, 2]), float(camera[1, 2])],
    'fixedPrincipalPoint': fixed_principal_point,
    'principalPointMode': principal_point_mode,
    'writeMain': '--write-main' in sys.argv,
}))
