"""Label PLATEAU vertical wall edges in the currently fitted SNAP photograph.

This is a calibration diagnostic only.  It does not modify geometry or publish
textures.  The JSON output is intentionally small enough to inspect by hand.
"""
import json
import math

import cv2
import numpy as np

from texture_snap_case import ROOT, load_case


case, geometry_path = load_case()
registration_path = ROOT / f'data/texture-city/registration/{case["caseId"]}.json'
fit = json.loads(registration_path.read_text(encoding='utf8'))
image_path = ROOT / f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
image = cv2.imread(str(image_path))
if image is None:
    raise RuntimeError(f'Cannot read {image_path}')

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
            lo, hi = sorted((float(a[1]), float(b[1])))
            if hi < case.get('edgePreviewMinimumHeight', 65):
                continue
            key = (round(float((a[0] + b[0]) / 2), 3), round(float((a[2] + b[2]) / 2), 3))
            previous = edges.get(key)
            if previous is None or hi - lo > previous['height']:
                edges[key] = {
                    'worldPoint': [key[0], lo, key[1]],
                    'worldTop': [key[0], hi, key[1]],
                    'height': hi - lo,
                }

records = []
h, w = image.shape[:2]
for edge in edges.values():
    uv = project([edge['worldPoint'], edge['worldTop']])
    if not np.isfinite(uv).all():
        continue
    center = uv.mean(axis=0)
    if center[0] < -100 or center[0] > w + 100 or center[1] < -100 or center[1] > h + 100:
        continue
    records.append({**edge, 'projected': uv.tolist(), 'center': center.tolist()})

records.sort(key=lambda r: (r['center'][0], r['center'][1]))
for index, record in enumerate(records, 1):
    record['edgeId'] = index
    a, b = np.asarray(record['projected'], dtype=int)
    cv2.line(image, tuple(a), tuple(b), (0, 210, 255), 2)
    c = np.asarray(record['center'], dtype=int)
    cv2.circle(image, tuple(c), 8, (255, 0, 255), -1)
    cv2.putText(image, str(index), tuple(c + [8, -8]), cv2.FONT_HERSHEY_SIMPLEX, .7, (255, 0, 255), 2)

out = ROOT / 'data/texture-city/registration'
out.mkdir(parents=True, exist_ok=True)
(out / f'{case["caseId"]}-edge-preview.json').write_text(
    json.dumps({'caseId': case['caseId'], 'edges': records}, indent=2), encoding='utf8')
cv2.imwrite(str(out / f'{case["caseId"]}-edge-preview.jpg'), image)
print(json.dumps({'caseId': case['caseId'], 'edges': len(records)}))
