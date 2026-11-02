"""Compare camera candidates against one frozen set of independent image edges.

The reference validation file supplies world edges and already-detected image
lines.  Those image observations are kept fixed while every candidate camera is
projected onto them, avoiding candidate-dependent re-detection during model
selection.
"""
import json
import pathlib
import sys

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


case, _ = load_case()
registration_dir = ROOT / 'data/texture-city/registration'
reference_tag = sys.argv[2] if len(sys.argv) > 2 else 'linefit-fixedpp'
reference_path = registration_dir / f'{case["caseId"]}-validation-{reference_tag}.json'
reference = json.loads(reference_path.read_text(encoding='utf8'))
edges = reference.get('edges', [])
assert edges, f'No frozen validation edges in {reference_path}'

names = [
    case['caseId'],
    f'{case["caseId"]}-linefit',
    f'{case["caseId"]}-linefit-regularizedpp',
    f'{case["caseId"]}-linefit-fixedpp',
]


def project(points, fit):
    camera = np.asarray(fit['cameraMatrix'], dtype=float)
    rvec = np.asarray(fit['rotationVector'], dtype=float)
    tvec = np.asarray(fit['translationVector'], dtype=float)
    return cv2.projectPoints(np.asarray(points, dtype=float), rvec, tvec, camera, None)[0].reshape(-1, 2)


def line_distance(point, a, b):
    direction = b - a
    length = max(float(np.linalg.norm(direction)), 1e-9)
    return float(abs(direction[0] * (point - a)[1] - direction[1] * (point - a)[0]) / length)


def percentile(values, q):
    return float(np.percentile(np.asarray(values, dtype=float), q))


rows = []
for name in names:
    path = registration_dir / f'{name}.json'
    if not path.exists():
        continue
    fit = json.loads(path.read_text(encoding='utf8'))
    sample_errors = []
    edge_errors = []
    for edge in edges:
        bottom = np.asarray(edge['bottom'], dtype=float)
        top = np.asarray(edge['top'], dtype=float)
        samples = np.asarray([bottom, (bottom + top) / 2, top])
        projected = project(samples, fit)
        observed = np.asarray(edge['observed'], dtype=float)
        errors = [line_distance(p, observed[0], observed[1]) for p in projected]
        sample_errors.extend(errors)
        edge_errors.append(float(np.median(errors)))
    camera = np.asarray(fit['cameraMatrix'], dtype=float)
    width, height = fit['imageSize']
    principal = np.asarray([camera[0, 2], camera[1, 2]], dtype=float)
    center = np.asarray([width / 2, height / 2], dtype=float)
    rows.append({
        'candidate': name,
        'registration': fit.get('registration', 'unspecified'),
        'principalPoint': principal.tolist(),
        'principalOffsetPixels': float(np.linalg.norm(principal - center)),
        'principalOffsetWidthFraction': float(np.linalg.norm(principal - center) / width),
        'focalPixels': float(camera[0, 0]),
        'frozenEdges': len(edges),
        'sampleRmsPixels': float(np.sqrt(np.mean(np.asarray(sample_errors) ** 2))),
        'sampleMedianPixels': float(np.median(sample_errors)),
        'sampleP90Pixels': percentile(sample_errors, 90),
        'edgeMedianPixels': float(np.median(edge_errors)),
        'edgeP90Pixels': percentile(edge_errors, 90),
        'edgeResidualPixels': edge_errors,
    })

result = {
    'caseId': case['caseId'],
    'referenceValidation': str(reference_path.relative_to(ROOT)).replace('\\', '/'),
    'referenceMethod': reference.get('method'),
    'frozenEdgeCount': len(edges),
    'candidates': rows,
}
out = registration_dir / f'{case["caseId"]}-frozen-edge-audit.json'
out.write_text(json.dumps(result, indent=2), encoding='utf8')
print(json.dumps(result, indent=2))
