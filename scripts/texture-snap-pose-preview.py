"""Diagnostic camera preview for candidate photos; never publishes a texture."""
import json, pathlib, hashlib, argparse
import cv2
import numpy as np

parser=argparse.ArgumentParser()
parser.add_argument('case_id')
parser.add_argument('--height',type=float,default=25)
parser.add_argument('--target-height',type=float,default=160)
parser.add_argument('--focal',type=float,default=2600)
parser.add_argument('--principal-x',type=float)
parser.add_argument('--principal-y',type=float)
parser.add_argument('--minimum-height',type=float,default=150)
parser.add_argument('--camera-x',type=float)
parser.add_argument('--camera-z',type=float)
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
candidate=next(c for c in json.loads((root/'scripts/texture-snap-candidates.json').read_text(encoding='utf8'))['candidates'] if c['caseId']==args.case_id)
image_path=root/f'data/texture-city/photos/commons/{candidate["sourceId"]}.jpg'
assert hashlib.sha256(image_path.read_bytes()).hexdigest()==candidate['sourceSha256']
im=cv2.imread(str(image_path));h,w=im.shape[:2]
g=json.loads((root/candidate['geometryPath']).read_text(encoding='utf8'))
b=next(b for b in g['buildings'] if b['id']==candidate['buildingId'])
prior=candidate['cameraHorizontalPrior'];position=np.array([prior[0],args.height,prior[1]])
if args.camera_x is not None:position[0]=args.camera_x
if args.camera_z is not None:position[2]=args.camera_z
center=(np.array(b['min'])+b['max'])/2;center[1]=args.target_height
forward=center-position;forward/=np.linalg.norm(forward)
right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right)
down=np.cross(forward,right);rotation=np.array([right,down,forward])
r=cv2.Rodrigues(rotation)[0];t=-rotation@position
k=np.array([[args.focal,0,args.principal_x if args.principal_x is not None else w/2],[0,args.focal,args.principal_y if args.principal_y is not None else h/2],[0,0,1]],float)
points={}
for wall in b['walls']:
 outer=np.array(wall['rings'][0]['points'],float)
 normal=np.cross(outer,np.roll(outer,-1,axis=0)).sum(axis=0)
 if np.dot(normal,position-outer.mean(axis=0))<=0:continue
 for ring in wall['rings']:
  vertices=np.array(ring['points'],float)
  for i,a in enumerate(vertices):
   other=vertices[(i+1)%len(vertices)]
   if max(a[1],other[1])<args.minimum_height:continue
   if min(a[1],other[1])<args.minimum_height:
    a=a.copy();other=other.copy()
    fraction=(args.minimum_height-a[1])/(other[1]-a[1]);intersection=a+fraction*(other-a)
    if a[1]<args.minimum_height:a=intersection
    else:other=intersection
   uv=cv2.projectPoints(np.array([a,other]),r,t,k,None)[0].reshape(-1,2)
   if np.max(np.abs(uv))<10000:cv2.line(im,tuple(uv[0].astype(int)),tuple(uv[1].astype(int)),(0,180,255),1)
   if a[1]>=args.minimum_height:points[tuple(a)]=a.tolist()
out=root/'data/texture-city/registration';out.mkdir(exist_ok=True,parents=True)
cv2.imwrite(str(out/f'{args.case_id}-initial-preview.jpg'),im)
(out/f'{args.case_id}-initial-preview.json').write_text(json.dumps({'applied':False,'candidate':candidate,'cameraPosition':position.tolist(),'target':center.tolist(),'focalPixels':args.focal,'cameraMatrix':k.tolist(),'minimumHeight':args.minimum_height,'rotationVector':r.reshape(3).tolist(),'translationVector':t.tolist(),'crownPoints':list(points.values()),'note':'Guessed pose only; no fitted correspondences or texture application.'},indent=2),encoding='utf8')
print(json.dumps({'caseId':args.case_id,'crownPoints':len(points),'applied':False}))
