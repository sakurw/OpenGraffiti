"""Fit a camera to independently acquired facade controls; never changes a model."""
import json, pathlib, hashlib
import cv2
import numpy as np
from texture_snap_case import ROOT, load_case

root = ROOT
case, geometry_path = load_case()
source = root/f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
meta = json.loads(source.with_suffix('.json').read_text(encoding='utf-8'))
assert hashlib.sha256(source.read_bytes()).hexdigest() == meta['sha256']
image = cv2.imread(str(source)); h,w = image.shape[:2]
points = np.asarray(case['worldPoints'],np.float64)
pixels = np.asarray(case['imagePoints'],np.float64)*[w/case['referenceSize'][0],h/case['referenceSize'][1]]
prior = np.asarray(case['cameraPrior'])
fits=[]
for focal in np.linspace(w*.5,w*5,181):
    camera = np.array([[focal,0,w/2],[0,focal,h/2],[0,0,1]],np.float64)
    ok,r,t = cv2.solvePnP(points,pixels,camera,None,flags=cv2.SOLVEPNP_SQPNP)
    if not ok: continue
    r,t = cv2.solvePnPRefineLM(points,pixels,camera,None,r,t)
    rotation=cv2.Rodrigues(r)[0]; position=-(rotation.T@t).reshape(3)
    if np.min((rotation@points.T+t)[2]) <= 0: continue
    projected=cv2.projectPoints(points,r,t,camera,None)[0].reshape(-1,2)
    rms=float(np.sqrt(np.mean(np.sum((projected-pixels)**2,axis=1))))
    horizontal=float(np.linalg.norm((position-prior)[[0,2]]))
    score=(rms/3)**2+(horizontal/100)**2+((position[1]-prior[1])/20)**2
    fits.append((score,rms,focal,position,r,t,camera,projected))
assert fits, 'No forward-facing camera fit'
fits.sort(key=lambda f:f[0]); score,rms,focal,position,r,t,camera,projected=fits[0]
geometry=json.loads(geometry_path.read_text(encoding='utf-8'))
building=next(b for b in geometry['buildings'] if b['id']==case['buildingId'])
annotated=image.copy()
for polygon in building['walls']:
    for ring in polygon['rings']:
        vertices=np.asarray(ring['points'],np.float64)
        # Show high-level edges, without drawing through foreground buildings.
        for i,a in enumerate(vertices):
            b=vertices[(i+1)%len(vertices)]
            if min(a[1],b[1])<case['minimumHeight']: continue
            uv=cv2.projectPoints(np.array([a,b]),r,t,camera,None)[0].reshape(-1,2)
            if np.all(np.isfinite(uv)) and np.max(np.abs(uv))<10000:
                cv2.line(annotated,tuple(uv[0].astype(int)),tuple(uv[1].astype(int)),(255,200,0),2)
for i,(observed,predicted) in enumerate(zip(pixels,projected)):
    cv2.circle(annotated,tuple(observed.astype(int)),8,(0,0,255),2)
    cv2.putText(annotated,str(i+1),tuple((observed+[8,-8]).astype(int)),cv2.FONT_HERSHEY_SIMPLEX,1,(0,0,255),2)
out=root/'data/texture-city/registration';out.mkdir(parents=True,exist_ok=True)
cv2.imwrite(str(out/(case['caseId']+'-wireframe.jpg')),annotated)
result={**case,'sourceSha256':meta['sha256'],'imageSize':[w,h],'imageControls':pixels.tolist(),
        'focalPixels':float(focal),'cameraPosition':position.tolist(),'rotationVector':r.reshape(3).tolist(),
        'translationVector':t.reshape(3).tolist(),'cameraMatrix':camera.tolist(),'rmsPixels':rms,
        'projectedControls':projected.tolist(),'priorScore':score,'applied':False}
(out/(case['caseId']+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:result[k] for k in ['caseId','focalPixels','cameraPosition','rmsPixels','priorScore','applied']}))
