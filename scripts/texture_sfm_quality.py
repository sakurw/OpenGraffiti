"""Reject impossible SfM intrinsics before any later registration is attempted.

Passing this sanity check does NOT validate an SfM pose or count wall evidence.
The output is a diagnostic only, with explicit applied/georegistered false.
"""
import argparse, json, math, pathlib

def audit_sfm(result):
    models=[]
    for model in result.get('models',[]):
        cameras=[]
        for c in model.get('cameras',[]):
            reasons=[];params=c['params'];w,h=c['width'],c['height']
            if c['model']!='SIMPLE_RADIAL': reasons.append('unsupported-camera-model')
            if len(params)!=4 or not all(math.isfinite(v) for v in params):
                reasons.append('invalid-intrinsics')
            else:
                f,cx,cy,k=params
                if f<=0: reasons.append('nonpositive-focal-length')
                if not .1<f/max(w,h)<10: reasons.append('focal-length-range')
                if abs(k)>1: reasons.append('extreme-radial-distortion')
                if f>0:
                    r2=max((x-cx)**2+(y-cy)**2 for x in [0,w] for y in [0,h])/f**2
                    if 1+3*k*r2<=0: reasons.append('non-monotonic-lens')
            cameras.append({'cameraId':c['id'],'sourceIds':[i['id'] for i in model['images'] if i['cameraId']==c['id']],
                            'rejectionReasons':reasons,'passed':not reasons})
        models.append({'modelId':model['modelId'],'registeredImages':model['registeredImages'],
                       'passedIntrinsicsSanity':bool(cameras) and all(c['passed'] for c in cameras),
                       'cameras':cameras})
    return {'status':'rejected-intrinsics' if any(not m['passedIntrinsicsSanity'] for m in models) else 'unregistered-hypothesis',
            'models':models,'applied':False,'georegistered':False,
            'policy':'All model cameras must pass physical intrinsics sanity. Neither passing nor low reprojection error counts as wall evidence; independent geometry registration is still required.'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('result');a=p.parse_args()
    path=pathlib.Path(a.result);report=audit_sfm(json.loads(path.read_text(encoding='utf8')))
    path.with_name('intrinsics-audit.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print(json.dumps(report))
