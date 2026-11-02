"""Render geometry-only control landmarks beside a source photo for annotation.

An approximate camera in this diagnostic is never an accepted registration.
"""
import argparse, json, pathlib
import cv2
import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--source', required=True)
p.add_argument('--geometry', required=True)
p.add_argument('--building', required=True)
p.add_argument('--camera', nargs=3, type=float, required=True)
p.add_argument('--target', nargs=3, type=float, default=[0, 155, 10])
p.add_argument('--focal', type=float, default=1000)
p.add_argument('--levels', nargs='+', type=float, default=[277.68, 249.36, 225.9, 178.56])
p.add_argument('--output', required=True)
p.add_argument('--registration')
p.add_argument('--reference-width',type=int,default=900)
a = p.parse_args()
g = json.loads((root / a.geometry).read_text(encoding='utf8'))
b = next(v for v in g['buildings'] if v['id'] == a.building)
photo = cv2.imread(str(root / f'data/texture-city/photos/commons/{a.source}.jpg'))
h, w = photo.shape[:2]
scale = a.reference_width / w
photo = cv2.resize(photo, (a.reference_width, round(h * scale)))
h, w = photo.shape[:2]
cam = np.array(a.camera)
fwd = np.array(a.target) - cam
fwd /= np.linalg.norm(fwd)
right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right)
r = np.array([right, np.cross(fwd, right), fwd])
k = np.array([[a.focal, 0, w/2], [0, a.focal, h/2], [0, 0, 1]])
distortion=None
if a.registration:
    registered = json.loads((root/a.registration).read_text(encoding='utf8'))
    cam = np.array(registered['cameraPosition'])
    r = np.array(registered['rotationMatrix'])
    k = np.diag([w/registered['referenceSize'][0],h/registered['referenceSize'][1],1]) @ np.array(registered['referenceCameraMatrix'])
    distortion=np.asarray(registered.get('distortionCoefficients',[0,0,0,0,0]),float)
def project(pts):
    return cv2.projectPoints(np.asarray(pts,float),cv2.Rodrigues(r)[0],-r@cam,k,distortion)[0].reshape(-1,2)
canvas = np.full_like(photo, 245)
visible = []
for wall in b['walls']:
    pts = np.asarray(wall['rings'][0]['points'])
    n = np.cross(pts, np.roll(pts, -1, axis=0)).sum(axis=0)
    if np.dot(n, cam - pts.mean(axis=0)) <= 0: continue
    visible.append(wall)
    uv = project(pts)
    if np.all(np.isfinite(uv)):
        cv2.polylines(canvas, [np.rint(uv).astype(np.int32)], True, (130, 130, 130), 1, cv2.LINE_AA)
points = sorted(set(tuple(v) for wall in visible for ring in wall['rings'] for v in ring['points'] if any(abs(v[1]-level)<.02 for level in a.levels)), key=lambda v: (-v[1], v[2], v[0]))
landmarks = []
for v in points:
    if any(np.linalg.norm(np.array(v)-np.array(l['world'])) < 1 for l in landmarks): continue
    uv = project([v])[0]
    if not (0 < uv[0] < w and 0 < uv[1] < h): continue
    i = len(landmarks)
    landmarks.append({'id': i, 'world': list(v), 'approximatePixel': uv.tolist()})
    at = tuple(np.rint(uv).astype(int))
    cv2.circle(canvas, at, 3, (0, 0, 220), -1)
    cv2.putText(canvas, str(i), (at[0]+3, at[1]-3), cv2.FONT_HERSHEY_SIMPLEX, .45, (30,30,180), 1, cv2.LINE_AA)
out = root / a.output
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out.with_suffix('.jpg')), np.hstack([photo, canvas]))
out.with_suffix('.json').write_text(json.dumps({'sourceId': a.source, 'referenceSize': [w,h], 'cameraPrior': a.camera, 'landmarks': landmarks, 'status': 'annotation-guide-only'}, indent=2), encoding='utf8')
print(json.dumps({'landmarks':len(landmarks), 'path':str(out.with_suffix('.jpg'))}))
