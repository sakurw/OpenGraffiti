"""Recompute comparable camera-fit metrics for SNAP registration candidates."""
import json
import math
import pathlib
import sys

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


case, geometry_path = load_case()
registration_dir = ROOT / 'data/texture-city/registration'
names = [
    case['caseId'],
    f'{case["caseId"]}-linefit',
    f'{case["caseId"]}-linefit-fixedpp',
]

geometry = json.loads(geometry_path.read_text(encoding='utf8'))
building = next(b for b in geometry['buildings'] if b['id'] == case['buildingId'])
building_min_y = min(p[1] for poly in building['polygons'] for ring in poly['rings'] for p in ring['points'])
world = np.asarray(case['worldPoints'], dtype=float)
vertical_controls = case.get('verticalLines', [])


def project(points, fit):
    camera = np.asarray(fit['cameraMatrix'], dtype=float)
    rvec = np.asarray(fit['rotationVector'], dtype=float)
    tvec = np.asarray(fit['translationVector'], dtype=float)
    return cv2.projectPoints(np.asarray(points, dtype=float), rvec, tvec, camera, None)[0].reshape(-1, 2)


def line_distance(point, a, b):
    direction = b - a
    length = max(float(np.linalg.norm(direction)), 1e-9)
    return float(abs(direction[0] * (point - a)[1] - direction[1] * (point - a)[0]) / length)


rows = []
for name in names:
    path = registration_dir / f'{name}.json'
    if not path.exists():
        continue
    fit = json.loads(path.read_text(encoding='utf8'))
    width, height = fit['imageSize']
    scale = np.array([width / case['referenceSize'][0], height / case['referenceSize'][1]], dtype=float)
    pixels = np.asarray(case['imagePoints'], dtype=float) * scale
    projected = project(world, fit)
    roof_errors = np.linalg.norm(projected - pixels, axis=1)
    line_errors = []
    for control in vertical_controls:
        top = np.asarray(control['worldPoint'], dtype=float)
        bottom = top.copy()
        bottom[1] = building_min_y
        a, b = project([bottom, top], fit)
        for observed in np.asarray(control['imagePoints'], dtype=float) * scale:
            line_errors.append(line_distance(observed, a, b))
    camera = np.asarray(fit['cameraMatrix'], dtype=float)
    center = np.array([width / 2, height / 2], dtype=float)
    principal = np.array([camera[0, 2], camera[1, 2]], dtype=float)
    position = np.asarray(fit['cameraPosition'], dtype=float)
    prior = np.asarray(case['cameraPrior'], dtype=float)
    rotation = cv2.Rodrigues(np.asarray(fit['rotationVector'], dtype=float))[0]
    translation = np.asarray(fit['translationVector'], dtype=float)
    min_depth = float(np.min((rotation @ world.T + translation[:, None])[2]))
    rows.append({
        'candidate': name,
        'registration': fit.get('registration', 'unspecified'),
        'focalPixels': float(camera[0, 0]),
        'focalOverWidth': float(camera[0, 0] / width),
        'principalPoint': principal.tolist(),
        'principalOffsetPixels': float(np.linalg.norm(principal - center)),
        'principalOffsetWidthFraction': float(np.linalg.norm(principal - center) / width),
        'cameraPosition': position.tolist(),
        'cameraPriorHorizontalDeltaMetres': float(np.linalg.norm((position - prior)[[0, 2]])),
        'cameraPriorHeightDeltaMetres': float(position[1] - prior[1]),
        'roofRmsPixels': float(np.sqrt(np.mean(roof_errors ** 2))),
        'roofResidualPixels': roof_errors.tolist(),
        'verticalLineRmsPixels': (float(np.sqrt(np.mean(np.asarray(line_errors) ** 2))) if line_errors else None),
        'verticalLineMedianPixels': (float(np.median(line_errors)) if line_errors else None),
        'verticalLineResidualPixels': line_errors,
        'minimumControlDepth': min_depth,
    })

print(json.dumps({'caseId': case['caseId'], 'candidates': rows}, indent=2))
