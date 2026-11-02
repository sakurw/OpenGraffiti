"""Apply the official SNAP rectifier to two real photos; no generated pixels.
Prerequisite: git clone Project-PLATEAU/PLATEAU-SNAP-Server into data/texture-poc.
"""
import sys, json, pathlib, hashlib, subprocess
import cv2
import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
snap_commit = subprocess.check_output(['git','-C',str(root / 'data/texture-poc/PLATEAU-SNAP-Server'),'rev-parse','HEAD'],text=True).strip()
if snap_commit != 'd194f8891eddb965af1894e5cc6b67541ca7f307':
    raise RuntimeError('SNAP revision differs from the validated experiment: '+snap_commit)
sys.path.insert(0, str(root / 'data/texture-poc/PLATEAU-SNAP-Server/lambdas'))
from src.ortho_transform.image_processing import rectify_facade

out = root / 'public/assets/texture-poc'
out.mkdir(parents=True, exist_ok=True)
# Correspondence order: lower south, lower north, upper north, upper south.
# Points measured on displayed 1920x1280 Commons and 1152x1536 Mapillary photos.
cases = {
 'snap': {'file':'commons-tocho.jpg','reference':[1920,1280],
          'points':[[839,894],[1095,853],[1032,346],[877,392]]},
 'mapillary': {'file':'mapillary-tocho.jpg','reference':[1152,1536],
          'points':[[416,995],[641,942],[626,437],[478,504]]}
}
width, height = 31.614, 104.06
plane = np.array([[0,0],[width,0],[width,height],[0,height]], dtype=np.float32)
report = {}
for name, case in cases.items():
    path = out / 'raw' / case['file']
    img = cv2.imread(str(path)); assert img is not None
    ih, iw = img.shape[:2]
    pts = np.array(case['points'], dtype=np.float32) * [iw/case['reference'][0], ih/case['reference'][1]]
    warped, dest = rectify_facade(img, pts.tolist(), plane.tolist(), facade_buffer_px=0)
    # A fixed-size, identically oriented texture. Crop SNAP's margin via returned correspondences.
    dst = np.array([[0,2047],[623,2047],[623,0],[0,0]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(np.array(dest,dtype=np.float32),dst)
    texture = cv2.warpPerspective(warped,transform,(624,2048))
    alpha = np.full((2048,624),255,dtype=np.uint8)
    if name == 'mapillary':
        # The sculpture crosses the lower facade. Keep original texture below a conservative
        # horizontal cut at 130m elevation instead of baking the sculpture onto the wall.
        alpha[int((186.37-130)/height*2047):,:] = 0
    rgba = cv2.cvtColor(texture,cv2.COLOR_BGR2BGRA); rgba[:,:,3] = alpha
    cv2.imwrite(str(out / (name+'.png')),rgba)
    annotated=img.copy()
    cv2.polylines(annotated,[pts.astype(np.int32)],True,(0,200,255),max(2,iw//600))
    for i,p in enumerate(pts): cv2.putText(annotated,str(i+1),tuple(p.astype(int)),cv2.FONT_HERSHEY_SIMPLEX,iw/1200,(0,0,255),max(2,iw//600))
    cv2.imwrite(str(out/(name+'-source.jpg')),annotated,[cv2.IMWRITE_JPEG_QUALITY,90])
    report[name] = {'snapCommit':snap_commit,'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceSize':[iw,ih],
       'imagePoints':pts.tolist(),'snapOutputPoints':np.asarray(dest).tolist(),'textureSize':[624,2048],
       'visibleHeightRange':[130 if name=='mapillary' else 82.31,186.37]}
(out/'processing.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
