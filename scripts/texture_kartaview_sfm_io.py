"""Small, independently testable persistence/metric helpers for SfM diagnostics."""
import json
import re
import numpy as np

def photo_id_from_sfm_name(name):
    match=re.fullmatch(r'\d{8}-([A-Za-z0-9_-]+)\.jpg',name)
    if not match:
        raise ValueError('Invalid SfM image name')
    return match.group(1)

def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf8')
    temporary.replace(path)

def anchor_metrics(predicted, expected):
    a, b = np.asarray(predicted, float), np.asarray(expected, float)
    if a.ndim != 2 or a.shape[1] != 3 or a.shape != b.shape or not len(a) or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError('Finite nonempty equal-sized 3D anchor arrays required')
    delta = a-b
    distance = np.linalg.norm(delta, axis=1)
    horizontal = np.linalg.norm(delta[:,[0,2]], axis=1)
    return {'count': len(a), 'rmseMetres': float(np.sqrt(np.mean(distance**2))),
            'medianMetres': float(np.median(distance)), 'maxMetres': float(distance.max()),
            'horizontalRmseMetres': float(np.sqrt(np.mean(horizontal**2))),
            'verticalRmseMetres': float(np.sqrt(np.mean(delta[:,1]**2))),
            'within10Metres': int(np.sum(distance <= 10))}

def usable_radial_camera(camera):
    if camera.get('model') != 'SIMPLE_RADIAL':
        return False
    try:
        w,h=float(camera['width']),float(camera['height'])
        values=np.asarray(camera['params'],float)
        if values.shape!=(4,) or not np.isfinite(values).all() or not np.isfinite([w,h]).all() or min(w,h)<=0:
            return False
        f,cx,cy,k=values
        if not .1<=f/max(w,h)<=10 or abs(k)>1:
            return False
        r2=max(((x-cx)/f)**2+((y-cy)/f)**2 for x in [0,w] for y in [0,h])
        return bool(1+3*k*r2>0)
    except (KeyError,TypeError,ValueError):
        return False
