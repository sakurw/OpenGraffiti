"""Record an explicitly provisional, image-inspected camera without claiming PnP accuracy."""
import hashlib, json
import cv2
import numpy as np
from texture_snap_case import ROOT, load_case

case,_=load_case()
assert case['registration']=='experimental-manual-camera'
source=ROOT/f'data/texture-city/photos/commons/{case["sourceId"]}.jpg'
meta=json.loads(source.with_suffix('.json').read_text(encoding='utf8'))
assert hashlib.sha256(source.read_bytes()).hexdigest()==meta['sha256']
image=cv2.imread(str(source));h,w=image.shape[:2]
position=np.asarray(case['cameraPosition'],float);forward=np.asarray(case['target'],float)-position
forward/=np.linalg.norm(forward);right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right)
rotation=np.array([right,np.cross(forward,right),forward]);k=np.asarray(case['cameraMatrix'],float)
assert np.isfinite(rotation).all() and k.shape==(3,3) and k[0,0]>0 and k[1,1]>0
result={**case,'sourceSha256':meta['sha256'],'imageSize':[w,h],'imageControls':[],
 'worldPoints':[],'focalPixels':float(k[0,0]),'rotationVector':cv2.Rodrigues(rotation)[0].reshape(3).tolist(),
 'translationVector':(-rotation@position).tolist(),'rmsPixels':None,'applied':False,
 'accuracy':'Not measured; manually aligned camera, not a surveyed or independently verified calibration'}
out=ROOT/'data/texture-city/registration';out.mkdir(parents=True,exist_ok=True)
(out/f'{case["caseId"]}.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps({'caseId':case['caseId'],'registration':case['registration'],'applied':False,'rmsPixels':None}))
