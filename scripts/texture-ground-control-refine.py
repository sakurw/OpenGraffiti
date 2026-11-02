"""Refine an accepted camera with additional PLATEAU edge constraints.

This keeps the existing camera hypothesis as the initialization and avoids
replacing a valid pose with a fresh solvePnP search.
"""
import argparse, json, pathlib
import cv2
import numpy as np
from scipy.optimize import least_squares

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser()
    p.add_argument('config')
    p.add_argument('--output')
    p.add_argument('--line-weight', type=float, default=0.25)
    a = p.parse_args()
    c = json.loads((ROOT / a.config).read_text())
    refw, refh = c['referenceSize']
    K0 = np.array(c['referenceCameraMatrix'], float)
    existing_R = np.array(c.get('rotationMatrix'), float)
    existing_t = np.array(c.get('translationVector'), float)
    lines = c.get('lineControls', [])

    world = np.array([x['world'] for x in c['controls']], float)
    pixels = np.array([x['pixel'] for x in c['controls']], float)
    train = np.array([i for i,x in enumerate(c['controls']) if x['role']=='train'])

    def unpack(x):
        K = np.array([[np.exp(x[6]),0,K0[0,2]],[0,np.exp(x[6]),K0[1,2]],[0,0,1]], float)
        R = cv2.Rodrigues(x[:3])[0]
        t = -R @ x[3:6]
        return K, R, t

    def project_shared(points, x):
        K, R, t = unpack(x)
        out = []
        for p in points:
            v = R @ p + t
            if v[2] <= 0:
                out.append([1e6, 1e6])
                continue
            nx, ny = v[0] / v[2], v[1] / v[2]
            out.append([K[0,0] * nx + K[0,2], K[1,1] * ny + K[1,2]])
        return np.array(out)

    def project(points, x):
        K,R,t = unpack(x)
        return project_shared(points, x)

    def residual(x):
        out = list((project(world[train], x)-pixels[train]).ravel())
        for line in lines:
            if line.get('role') != 'train':
                continue
            uv = project(np.array(line['world'], float), x)
            obs = np.array(line['pixels'], float)
            # PLATEAU edges stabilize geometry but should remain weaker than
            # manually verified photo controls.
            out.extend(((uv-obs) * a.line_weight).ravel())
        # Keep the refinement local. The purpose is adding geometric
        # constraints around an existing pose, not discovering a new camera.
        out.extend(((x[:3] - x0[:3]) / np.array([0.03,0.03,0.03])).tolist())
        out.extend(((x[3:6] - x0[3:6]) / np.array([5,5,5])).tolist())
        out.append((x[6]-x0[6]) / 0.05)
        return np.array(out)

    r0 = cv2.Rodrigues(existing_R)[0].reshape(3)
    x0 = np.r_[r0, -(existing_R.T @ existing_t), np.log(K0[0,0])]
    lower = x0.copy()
    upper = x0.copy()
    lower[:3] -= 0.1
    upper[:3] += 0.1
    lower[3:6] -= 10
    upper[3:6] += 10
    lower[6] -= 0.1
    upper[6] += 0.1
    result = least_squares(residual, x0, bounds=(lower, upper), max_nfev=500)
    K,R,t = unpack(result.x)
    train_error = project(world[train], result.x) - pixels[train]
    train_rms = float(np.sqrt(np.mean(train_error**2)))
    line_errors = []
    for line in lines:
        uv = project(np.array(line['world'], float), result.x)
        obs = np.array(line['pixels'], float)
        line_errors.extend((uv - obs).ravel().tolist())
    out = {
        'success': bool(result.success),
        'cost': float(result.cost),
        'cameraPosition': (-R.T @ t).tolist(),
        'rotationVector': result.x[:3].tolist(),
        'focal': float(K[0,0]),
        'trainingRms': train_rms,
        'lineRms': float(np.sqrt(np.mean(np.array(line_errors) ** 2))) if line_errors else 0.0,
        'lineWeight': a.line_weight,
        'lineCount': len(lines)
    }
    print(json.dumps(out, indent=2))
    if a.output:
        (ROOT / a.output).write_text(json.dumps(out, indent=2))

if __name__ == '__main__':
    main()
