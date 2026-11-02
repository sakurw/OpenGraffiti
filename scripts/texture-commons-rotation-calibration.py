"""Diagnostic shared-lens calibration from a same-camera Commons photo burst.

No GPS or PLATEAU controls enter this estimator. It assumes rotation about a
common optical center, and rejects a burst with inconsistent held-out matches.
The output is NOT a camera registration or accepted texture evidence.
"""
import argparse, hashlib, json, pathlib
import cv2
import numpy as np
from scipy.optimize import least_squares

root=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--ids',nargs='+',default=['76730224','76730229','76730228']);a=p.parse_args()
folder=root/'data/texture-city/photos/commons';out=root/'data/texture-city/commons/lens-calibration';out.mkdir(parents=True,exist_ok=True)
discovery=json.loads((root/'data/texture-city/commons/discovery-tocho.json').read_text(encoding='utf8'))
cohort=[]
for identity in a.ids:
    info=next(p['imageInfo'] for p in discovery['photos'] if str(p['pageId'])==identity)
    metadata={row['name']:row['value'] for row in info.get('metadata',[])}
    cohort.append({k:metadata.get(k) for k in ['Make','Model','FocalLength','DateTimeOriginal']})
assert cohort[0]['Make'] and cohort[0]['Model'] and cohort[0]['FocalLength']
assert all(all(row[k]==cohort[0][k] for k in ['Make','Model','FocalLength']) for row in cohort), 'Unverified shared lens'
records=[];images=[];features=[]
sift=cv2.SIFT_create(nfeatures=10000)
for identity in a.ids:
    path=folder/(identity+'.jpg');meta=json.loads(path.with_suffix('.json').read_text(encoding='utf8'))
    data=path.read_bytes();assert hashlib.sha256(data).hexdigest()==meta['sha256']
    image=cv2.imread(str(path));h,w=image.shape[:2];scale=1920/max(w,h)
    image=cv2.resize(image,(round(w*scale),round(h*scale)))
    points,desc=sift.detectAndCompute(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),None)
    features.append((np.array([k.pt for k in points],float),desc));images.append(image)
    records.append({'sourceId':identity,'sha256':meta['sha256'],'size':[image.shape[1],image.shape[0]],'scale':scale})
pairs=[];matcher=cv2.BFMatcher(cv2.NORM_L2)
for i in range(1,len(images)):
    raw=matcher.knnMatch(features[0][1],features[i][1],k=2)
    reverse=matcher.knnMatch(features[i][1],features[0][1],k=2)
    mutual={m.queryIdx:m.trainIdx for m,n in reverse if m.distance<.7*n.distance}
    good=[m for m,n in raw if m.distance<.7*n.distance and mutual.get(m.trainIdx)==m.queryIdx]
    aa=np.array([features[0][0][m.queryIdx] for m in good]);bb=np.array([features[i][0][m.trainIdx] for m in good])
    held=np.arange(len(aa))%3==0
    h,inliers=cv2.findHomography(aa[~held],bb[~held],cv2.USAC_MAGSAC,4,maxIters=20000,confidence=.999)
    assert h is not None
    # Held-out correspondences must not initialize/filter the homography or
    # camera rotation. Keep even their outliers for final validation statistics.
    accepted=held.copy();accepted[~held]=inliers.ravel()>0
    aa,bb,held=aa[accepted],bb[accepted],held[accepted]
    # Limit dense repeated-window clusters; retain at most 3 matches per 64px cell.
    keep=[];cells={}
    for j,point in enumerate(aa):
        cell=tuple((point//64).astype(int));cells[cell]=cells.get(cell,0)+1
        if cells[cell]<=3: keep.append(j)
    aa,bb,held=aa[keep],bb[keep],held[keep]
    assert len(aa)>100
    pairs.append({'imageIndex':i,'a':aa,'b':bb,'held':held,'rawMatches':len(good),'homographyInliers':int(np.sum(inliers))})
    print(json.dumps({'stage':'matches','source':a.ids[i],'retained':len(aa)}),flush=True)

def intrinsic(index,f):
    w,h=records[index]['size'];return np.array([[f,0,w/2],[0,f,h/2],[0,0,1]],float)
def distort(x):return np.array([x[1],0,0,0,0])
def predict(pair,x,points):
    f=np.exp(x[0]);index=pair['imageIndex']
    rays=cv2.undistortPoints(points[:,None,:],intrinsic(0,f),distort(x)).reshape(-1,2)
    rays=np.c_[rays,np.ones(len(rays))]
    return cv2.projectPoints(rays,x[2+3*(index-1):5+3*(index-1)],np.zeros(3),intrinsic(index,f),distort(x))[0].reshape(-1,2)
def residual(x):
    return np.concatenate([(predict(pair,x,pair['a'][~pair['held']])-pair['b'][~pair['held']]).ravel() for pair in pairs])
fits=[]
for fraction in [.4,.55,.65,.8,1.1,1.5]:
    focal=fraction*1920;initial=[np.log(focal),0]
    for pair in pairs:
        ra=cv2.undistortPoints(pair['a'][~pair['held'],None,:],intrinsic(0,focal),None).reshape(-1,2)
        rb=cv2.undistortPoints(pair['b'][~pair['held'],None,:],intrinsic(pair['imageIndex'],focal),None).reshape(-1,2)
        ra=np.c_[ra,np.ones(len(ra))];rb=np.c_[rb,np.ones(len(rb))]
        ra/=np.linalg.norm(ra,axis=1)[:,None];rb/=np.linalg.norm(rb,axis=1)[:,None]
        u,_,vt=np.linalg.svd(rb.T@ra);rotation=u@np.diag([1,1,np.linalg.det(u@vt)])@vt
        initial.extend(cv2.Rodrigues(rotation)[0].ravel())
    low=np.full(len(initial),-np.inf);high=np.full(len(initial),np.inf)
    low[:2]=[np.log(1920*.25),-.25];high[:2]=[np.log(1920*3),.25]
    fit=least_squares(residual,initial,bounds=(low,high),loss='soft_l1',f_scale=2,max_nfev=250)
    fits.append(fit)
fit=min(fits,key=lambda fit:fit.cost);x=fit.x
results=[]
for pair in pairs:
    error=np.linalg.norm(predict(pair,x,pair['a'])-pair['b'],axis=1)
    train=error[~pair['held']];held=error[pair['held']]
    results.append({'sourceId':a.ids[pair['imageIndex']],'trainingMatches':len(train),'heldOutMatches':len(held),
                    'trainingRmsPixels':float(np.sqrt(np.mean(train**2))),
                    'heldOutRmsPixels':float(np.sqrt(np.mean(held**2))),
                    'heldOutP95Pixels':float(np.quantile(held,.95)),
                    'heldOutMedianPixels':float(np.median(held)),
                    'heldOutInlierFraction':float(np.mean(held<=3)),
                    'rotationVector':x[2+3*(pair['imageIndex']-1):5+3*(pair['imageIndex']-1)].tolist()})
near=[v for v in fits if v.cost<=fit.cost*1.02]
reasons=[]
if any(v['heldOutMedianPixels']>1.5 or v['heldOutP95Pixels']>6 or v['heldOutInlierFraction']<.95 for v in results): reasons.append('rotation-only-held-out-error')
if abs(x[1])>.249: reasons.append('radial-boundary')
focal_spread=max(abs(np.exp(v.x[0]-x[0])-1) for v in near)
if focal_spread>.02: reasons.append('ambiguous-focal-length')
report={'sources':records,'captureMetadata':cohort,'normalizedLongSide':1920,'focalPixels':float(np.exp(x[0])),'focalPerLongSide':float(np.exp(x[0])/1920),
        'radialK1':float(x[1]),'pairs':results,'nearOptimalFocalSpreadFraction':float(focal_spread),
        'consistentRotationHypothesis':not reasons,'rejectionReasons':reasons,'applied':False,
        'validationPolicy':'Mutual descriptor matches split before training-only RANSAC. Unfiltered held-out residuals are reported including outliers; require median<=1.5px, P95<=6px, >=95 percent within 3px.',
        'warning':'Rotation-only lens hypothesis, not a surveyed calibration. Low parallax and independent pose validation still required.'}
destination=out/('-'.join(a.ids)+'.json');destination.write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
