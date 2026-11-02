"""Fit external ground imagery to unchanged PLATEAU controls with held-out checks.

Only training points enter initialization, camera fitting or model selection.
Unverified or rejected camera hypotheses are retained as diagnostics, not evidence.
"""
import argparse, hashlib, json, pathlib
import cv2
import numpy as np
from scipy.optimize import least_squares

ROOT = pathlib.Path(__file__).resolve().parents[1]
def sha(b): return hashlib.sha256(b).hexdigest()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('config')
    p.add_argument('--output-dir', help='Diagnostic/test destination; defaults to provider control-registration directory')
    p.add_argument('--export-ensemble', action='store_true', help='Export training-only sensitivity cameras for independent projection diagnostics; does not change acceptance')
    a = p.parse_args()
    config_bytes = (ROOT / a.config).read_bytes()
    c = json.loads(config_bytes)
    position_validation=c.get('positionValidation','gps-consistency')
    assert position_validation in ('gps-consistency','independent-geometry','projection-ensemble')
    assert c['provider'] in ('commons', 'kartaview', 'msls')
    source = ROOT / f'data/texture-city/photos/{c["provider"]}/{c["sourceId"]}.jpg'
    meta = json.loads(source.with_suffix('.json').read_text(encoding='utf8'))
    assert sha(source.read_bytes()) == meta['sha256']
    geometry_bytes = (ROOT / c['geometryPath']).read_bytes()
    building = next(b for b in json.loads(geometry_bytes)['buildings'] if b['id'] == c['buildingId'])
    vertices = np.array([v for wall in building['walls'] for ring in wall['rings'] for v in ring['points']])
    image = cv2.imread(str(source)); ih, iw = image.shape[:2]
    refw, refh = c['referenceSize']
    image = cv2.resize(image, (refw, refh))
    controls = c['controls']
    world = np.array([v['world'] for v in controls], float)
    pixels = np.array([v['pixel'] for v in controls], float)
    for point in world:
        assert np.min(np.linalg.norm(vertices - point, axis=1)) < .02, 'Control is not an actual geometry vertex'
    train = np.array([i for i,v in enumerate(controls) if v['role'] == 'train'])
    held = np.array([i for i,v in enumerate(controls) if v['role'] == 'held-out'], dtype=int)
    lines = c.get('lineControls', [])
    # An observed segment lies on a real mesh edge, but its endpoints need not
    # coincide with 3D vertices. Never invent an endpoint height from the photo.
    edges = [(np.asarray(ring['points'][i],float),np.asarray(ring['points'][(i+1)%len(ring['points'])],float))
             for wall in building['walls'] for ring in wall['rings'] for i in range(len(ring['points']))]
    for line in lines:
        aa, bb = np.asarray(line['world'],float)
        assert any((np.linalg.norm(aa-ea)<.02 and np.linalg.norm(bb-eb)<.02) or
                   (np.linalg.norm(aa-eb)<.02 and np.linalg.norm(bb-ea)<.02) for ea,eb in edges), 'Line is not a real mesh edge'
        observed=np.asarray(line['pixels'],float)
        assert len(observed)>=2 and max(np.linalg.norm(aa-bb) for aa in observed for bb in observed)>=100, 'Observed line too short'
    assert len(train) >= 6
    prior = np.array(c['cameraPrior'], float)
    camera_model = c.get('cameraModel', 'pinhole')
    assert camera_model in ('pinhole','simple-radial')
    radial = camera_model == 'simple-radial'
    lens=None; lens_values=None
    if c.get('lensCalibrationPath'):
        assert radial and position_validation in ('independent-geometry','projection-ensemble')
        lens_path=ROOT/c['lensCalibrationPath'];lens_bytes=lens_path.read_bytes()
        calibration=json.loads(lens_bytes)
        assert calibration['consistentRotationHypothesis'] and len(calibration['sources'])>=3, 'Unvalidated shared lens'
        assert calibration['sources'][0]['sourceId']==c['sourceId']
        for source_record in calibration['sources']:
            assert sha((ROOT/f'data/texture-city/photos/commons/{source_record["sourceId"]}.jpg').read_bytes())==source_record['sha256']
        leave_one_pair=[];jackknife_hashes={}
        for relative in c['lensPairCalibrationPaths']:
            pair_bytes=(ROOT/relative).read_bytes();pair=json.loads(pair_bytes)
            assert pair['consistentRotationHypothesis'] and len(pair['sources'])==2
            assert pair['sources'][0]['sha256']==calibration['sources'][0]['sha256']
            assert pair['sources'][1] in calibration['sources']
            leave_one_pair.append(pair);jackknife_hashes[relative]=sha(pair_bytes)
        assert len(leave_one_pair)>=2 and len(set(p['sources'][1]['sourceId'] for p in leave_one_pair))>=2
        fref=calibration['focalPerLongSide']*max(refw,refh)
        sigma_f=max(.01,max(abs(np.log(p['focalPerLongSide']/calibration['focalPerLongSide'])) for p in leave_one_pair))
        sigma_k=max(.005,max(abs(p['radialK1']-calibration['radialK1']) for p in leave_one_pair))
        lens_values=np.array([np.log(fref),calibration['radialK1']])
        lens={'path':c['lensCalibrationPath'],'sha256':sha(lens_bytes),'pairSha256':jackknife_hashes,
              'focalReferencePixels':fref,'radialK1':calibration['radialK1'],
              'logFocalSigma':sigma_f,'radialSigma':sigma_k,
              'policy':'Independent feature-match lens estimate. Sigma uses the worst pair-vs-joint discrepancy with floors of 1 percent focal / 0.005 radial; uncertainty is resampled in every pose sensitivity trial.'}
    def distortion(x):
        return np.array([x[7],0,0,0,0]) if radial else None
    def unpack(x):
        k = np.array([[np.exp(x[6]),0,refw/2],[0,np.exp(x[6]),refh/2],[0,0,1]])
        r = cv2.Rodrigues(x[:3])[0]
        return k, r, -r @ x[3:6]
    def project(pts, x):
        k, _, t = unpack(x)
        return cv2.projectPoints(np.asarray(pts, float), x[:3], t, k, distortion(x))[0].reshape(-1,2)
    def residual(x):
        return np.concatenate([(project(world[train],x)-pixels[train]).ravel(),
                     *[line_residual(line,x) for line in lines if line['role']=='train'],
                     (x[3:6]-prior) / np.array(c.get('positionPriorSigmaMetres',[30,10,30])) if position_validation=='gps-consistency' and c.get('cameraPriorSource')!='unverified-initialization' else np.array([]),
                     *([np.array([x[7]/.1])] if radial and lens is None else []),
                     *([(x[[6,7]]-lens_values)/[lens['logFocalSigma'],lens['radialSigma']]] if lens else [])])
    def line_residual(line,x):
        # A straight world edge is curved in a distorted source. Compare in
        # undistorted pixel coordinates instead of joining distorted endpoints.
        k,_,t = unpack(x)
        uv = cv2.projectPoints(np.asarray(line['world'],float),x[:3],t,k,None)[0].reshape(-1,2)
        eq = np.cross(np.r_[uv[0],1],np.r_[uv[1],1])
        eq /= max(np.linalg.norm(eq[:2]),1e-10)
        observed = np.asarray(line['pixels'],float)
        if radial:
            observed = cv2.undistortPoints(observed[:,None,:],k,distortion(x),P=k).reshape(-1,2)
        return np.c_[observed,np.ones(len(observed))] @ eq
    fits = []
    for f in np.geomspace(refw*.4, refw*4, 20):
        k = np.array([[f,0,refw/2],[0,f,refh/2],[0,0,1]],float)
        ok,r,t = cv2.solvePnP(world[train], pixels[train], k, None, flags=cv2.SOLVEPNP_SQPNP)
        if not ok: continue
        pos = -(cv2.Rodrigues(r)[0].T @ t).ravel()
        x0 = np.r_[r.ravel(),pos,np.log(f)]
        if radial: x0=np.r_[x0,0.]
        lower=np.full(len(x0),-np.inf);upper=np.full(len(x0),np.inf)
        if radial: lower[7]=-.25;upper[7]=.25
        fit = least_squares(residual,x0,bounds=(lower,upper),max_nfev=400,xtol=1e-10,ftol=1e-10,gtol=1e-10)
        k,rr,tt = unpack(fit.x)
        if np.min((world[train] @ rr.T + tt)[:,2]) > 0 and refw*.25 < k[0,0] < refw*6:
            fits.append((np.sum(residual(fit.x)**2),fit.x))
    assert fits, 'No forward-facing training fit'
    _,x = min(fits,key=lambda row: row[0])
    stability=None; ensemble_fits=[]
    if position_validation in ('independent-geometry','projection-ensemble'):
        # Additional training-only sensitivity test for images without trusted
        # geolocation. This cannot improve the pose using held-out observations.
        rng=np.random.default_rng(20260911)
        original_pixels=pixels.copy()
        original_lines=[np.array(line['pixels'],float) for line in lines]
        original_lens=lens_values.copy() if lens else None
        trials=[]
        for _ in range(64):
            pixels[train]=original_pixels[train]+rng.normal(0,2,(len(train),2))
            for line,original in zip(lines,original_lines):
                if line['role']=='train': line['pixels']=(original+rng.normal(0,2,original.shape)).tolist()
            if lens: lens_values[:]=original_lens+rng.normal(0,[lens['logFocalSigma'],lens['radialSigma']])
            perturb=least_squares(residual,x,bounds=(lower,upper),max_nfev=160)
            ensemble_fits.append((perturb.x.copy(),bool(perturb.success),'training-noise'))
            rr=cv2.Rodrigues(perturb.x[:3])[0]@cv2.Rodrigues(x[:3])[0].T
            angle=np.degrees(np.arccos(np.clip((np.trace(rr)-1)/2,-1,1)))
            trials.append([np.linalg.norm(perturb.x[3:6]-x[3:6]),angle,abs(np.exp(perturb.x[6]-x[6])-1)])
        pixels[:]=original_pixels
        for line,original in zip(lines,original_lines): line['pixels']=original.tolist()
        if lens: lens_values[:]=original_lens
        threshold=min(score for score,_ in fits)+4*(2*len(train)+sum(len(line['pixels']) for line in lines if line['role']=='train'))
        alternatives=[fit for score,fit in fits if score<=threshold]
        ensemble_fits.extend((alternative.copy(),True,'near-optimal-initialization') for alternative in alternatives)
        stability={'trials':64,'annotationNoiseSigmaPixels':2,'seed':20260911,
                   'positionP95Metres':float(np.quantile(np.array(trials)[:,0],.95)),
                   'rotationP95Degrees':float(np.quantile(np.array(trials)[:,1],.95)),
                   'focalP95Fraction':float(np.quantile(np.array(trials)[:,2],.95)),
                   'nearOptimalInitializationCount':len(alternatives),
                   'nearOptimalPositionSpreadMetres':max(float(np.linalg.norm(fit[3:6]-x[3:6])) for fit in alternatives)}
    k,r,t = unpack(x)
    predicted = project(world,x)
    error = np.linalg.norm(predicted-pixels,axis=1)
    rms = lambda ids: float(np.sqrt(np.mean(error[ids]**2))) if len(ids) else None
    # Thresholds are in the fixed annotation reference resolution, not a changing download size.
    gates = {'minimumTrainingControls':6,'minimumHeldOutControls':4,
             'maximumTrainingRmsPixels':4,'maximumHeldOutRmsPixels':6,
             'maximumHeldOutErrorPixels':10,'maximumHorizontalPriorDeltaMetres':10,
             'maximumHeightPriorDeltaMetres':10,'minimumControlHeightSpanMetres':80,
             'maximumLineRmsPixels':4,'maximumLineErrorPixels':6,'minimumObservedLineLengthPixels':100,
             'minimumHeldOutLinesForHeightExtension':2}
    horizontal = float(np.linalg.norm((x[3:6]-prior)[[0,2]]))
    height_delta = float(abs(x[4]-prior[1]))
    reasons = []
    if c.get('projectionProvenanceUnresolved'): reasons.append('projection-provenance-unresolved')
    if position_validation=='gps-consistency' and c.get('cameraPriorSource')=='unverified-initialization': reasons.append('position-prior-unverified')
    if radial:
        radius2 = ((refw/2)**2+(refh/2)**2)/k[0,0]**2
        if abs(x[7])>=.249: reasons.append('radial-boundary')
        if 1+3*x[7]*radius2<=0: reasons.append('non-monotonic-lens')
    if len(held)<gates['minimumHeldOutControls']: reasons.append('insufficient-held-out-controls')
    if rms(train)>gates['maximumTrainingRmsPixels']: reasons.append('training-error')
    if len(held) and rms(held)>gates['maximumHeldOutRmsPixels']: reasons.append('held-out-rms')
    if len(held) and float(error[held].max())>gates['maximumHeldOutErrorPixels']: reasons.append('held-out-max')
    if position_validation=='gps-consistency':
        if horizontal>gates['maximumHorizontalPriorDeltaMetres']: reasons.append('horizontal-prior')
        if height_delta>gates['maximumHeightPriorDeltaMetres']: reasons.append('height-prior')
    else:
        gates.update({'minimumTrainingControls':10,'minimumHeldOutControls':8,
                      'minimumHeldOutHeightSpanMetres':60,'minimumHeldOutSpatialSingularValueMetres':1,
                      'maximumPositionSensitivityP95Metres':5,'maximumRotationSensitivityP95Degrees':1,
                      'maximumFocalSensitivityP95Fraction':.05,'maximumNearOptimalPositionSpreadMetres':5})
        if len(train)<10 or len(held)<8: reasons.append('insufficient-independent-geometry-controls')
        if len(held)<4 or np.ptp(world[held,1])<60: reasons.append('held-out-height-span')
        if len(held)<4 or np.linalg.svd(world[held]-world[held].mean(axis=0),compute_uv=False)[-1]<1:
            reasons.append('held-out-geometry-degenerate')
        if position_validation=='independent-geometry':
            if stability['positionP95Metres']>5 or stability['rotationP95Degrees']>1 or stability['focalP95Fraction']>.05:
                reasons.append('unstable-camera')
            if stability['nearOptimalPositionSpreadMetres']>5: reasons.append('ambiguous-camera-initialization')
        else:
            # A stable projection does not imply an accurate surveyed camera.
            # This alternative certifies no camera location: downstream cells
            # MUST pass visibility and <=4px projection spread for every member.
            for key in ['maximumPositionSensitivityP95Metres','maximumRotationSensitivityP95Degrees','maximumFocalSensitivityP95Fraction','maximumNearOptimalPositionSpreadMetres']:
                gates.pop(key)
            gates.update({'minimumProjectionEnsembleTrials':64,'maximumProjectionSpreadReferencePixels':4,
                          'everyEnsembleCameraMustPassHeldOutGates':True,'validatedControlHullRequired':True})
            if len(ensemble_fits)<64: reasons.append('insufficient-projection-ensemble')
            for xx,success,_ in ensemble_fits:
                kk,rr,tt=unpack(xx)
                radius2=((refw/2)**2+(refh/2)**2)/kk[0,0]**2
                invalid=not success or not np.isfinite(xx).all() or not refw*.25<kk[0,0]<refw*6
                invalid=invalid or np.min(world@rr.T+tt,axis=0)[2]<=0
                invalid=invalid or (radial and (abs(xx[7])>=.249 or 1+3*xx[7]*radius2<=0))
                if invalid: reasons.append('invalid-projection-ensemble-camera');break
                if len(held):
                    ee=np.linalg.norm(project(world[held],xx)-pixels[held],axis=1)
                    if np.sqrt(np.mean(ee**2))>6 or np.max(ee)>10:
                        reasons.append('projection-ensemble-held-out-error');break
    if float(np.ptp(world[:,1]))<gates['minimumControlHeightSpanMetres']: reasons.append('control-height-span')
    if not c.get('groundPhotoVerified'): reasons.append('ground-viewpoint-unverified')
    line_results = []
    for line in lines:
        err = line_residual(line,x)
        # Closest point on the projected edge -> 3D line parameter, using the
        # perspective projection equation. This is a visibility bound only.
        aa,bb = np.asarray(line['world'],float)
        heights, fractions = [], []
        for observed in line['pixels']:
            if radial:
                observed=cv2.undistortPoints(np.asarray(observed,float).reshape(1,1,2),k,distortion(x),P=k).reshape(2)
            origin_cam = r@aa+t
            delta_cam = r@(bb-aa)
            xn,yn = (np.asarray(observed)-k[:2,2])/k[0,0]
            u = np.array([delta_cam[0]-xn*delta_cam[2],delta_cam[1]-yn*delta_cam[2]])
            v = np.array([xn*origin_cam[2]-origin_cam[0],yn*origin_cam[2]-origin_cam[1]])
            frac = float(u@v / max(u@u,1e-12))
            fractions.append(frac)
            heights.append(float((aa+np.clip(frac,0,1)*(bb-aa))[1]))
        line_results.append({**line,'errorsPixels':err.tolist(),'rmsPixels':float(np.sqrt(np.mean(err**2))),
                             'segmentFractions':fractions,'observedHeightRangeMetres':[min(heights),max(heights)]})
        if any(frac<0 or frac>1 for frac in fractions):
            reasons.append('observation-outside-real-edge:'+line['name'])
        if np.sqrt(np.mean(err**2))>4 or np.max(np.abs(err))>6:
            reasons.append('line-error:'+line['name'])
    support = [float(world[:,1].min()),float(world[:,1].max())]
    held_lines = [row for row in line_results if row['role']=='held-out']
    # At least two independently annotated long edges must both validate the
    # extension. The more conservative lower endpoint governs the whole range.
    if len(held_lines)>=2:
        support[0] = min(support[0],max(row['observedHeightRangeMetres'][0] for row in held_lines))
    scaling = np.diag([iw/refw,ih/refh,1])
    result = {**c,'sourceSha256':meta['sha256'],'geometrySha256':sha(geometry_bytes),'configSha256':sha(config_bytes),
              'configPath':str(pathlib.Path(a.config).as_posix()),
              'cameraModel':camera_model,'distortionCoefficients':distortion(x).tolist() if radial else [0,0,0,0,0],
              'positionValidation':position_validation,'cameraStability':stability,
              'independentLensCalibration':lens,
              'imageSize':[iw,ih],'cameraMatrix':(scaling@k).tolist(),'referenceCameraMatrix':k.tolist(),
              'rotationMatrix':r.tolist(),'rotationVector':x[:3].tolist(),'translationVector':t.tolist(),
              'cameraPosition':x[3:6].tolist(),'trainingRmsPixels':rms(train),'heldOutRmsPixels':rms(held),
              'pointErrorsPixels':error.tolist(),'projectedControls':predicted.tolist(),
              'horizontalPriorDeltaMetres':horizontal,'heightPriorDeltaMetres':height_delta,
              'gates':gates,'accepted':not reasons,'rejectionReasons':reasons,'applied':False,
              'lineControlResults':line_results,
              'supportedHeightRangeMetres':support,
              'supportPolicy':'Observed point height range; lower extension requires at least two independent held-out real-edge observations, each >=100px and RMS<=4px/max<=6px. Use the conservative common height interval.',
              'method':'training-only SQPnP and nonlinear perspective point/line calibration; independent held-out observed geometry corners and optional real edges; no synthetic texture evidence'}
    if a.export_ensemble or position_validation=='projection-ensemble':
        assert stability is not None and len(ensemble_fits)>=64, 'Ensemble requires independent-geometry sensitivity fit'
        result['projectionEnsemble']=[]
        for xx,success,kind in ensemble_fits:
            kk,rr,tt=unpack(xx)
            result['projectionEnsemble'].append({'kind':kind,'converged':success,'cameraModel':camera_model,
                'cameraPosition':xx[3:6].tolist(),'rotationMatrix':rr.tolist(),'translationVector':tt.tolist(),
                'cameraMatrix':(scaling@kk).tolist(),'referenceCameraMatrix':kk.tolist(),
                'distortionCoefficients':distortion(xx).tolist() if radial else [0,0,0,0,0]})
        result['projectionEnsemblePolicy']='64 independent 2px Gaussian perturbations of training observations and all near-optimal training-only initializations. No held-out data fits, selects or filters cameras. Diagnostic export does not waive failed position gates.'
    if position_validation=='projection-ensemble':
        result['worldCameraPositionVerified']=False
        result['requiresPerSurfaceEnsembleValidation']=True
        errors=[np.linalg.norm(project(world[held],xx)-pixels[held],axis=1) for xx,_,_ in ensemble_fits] if len(held) else []
        result['projectionEnsembleValidation']={'heldOutWorstRmsPixels':max(float(np.sqrt(np.mean(e**2))) for e in errors) if errors else None,
                                               'heldOutWorstMaxPixels':max(float(np.max(e)) for e in errors) if errors else None}
        result['validatedControlHullReferencePixels']=cv2.convexHull(pixels.astype(np.float32)).reshape(-1,2).tolist()
        result['projectionEnsemblePolicy']='No surveyed camera-position claim. All 64 training-only noise trials plus all near-optimal initializations must pass held-out point RMS<=6px/max<=10px. Each credited surface must remain within the observed control hull, project within 4 reference pixels of nominal, and pass masks, facing, resolution and city occlusion under EVERY camera. This is a finite empirical sensitivity test, not a probabilistic guarantee.'
    out = ROOT / a.output_dir if a.output_dir else ROOT / 'data/texture-city' / c['provider'] / 'control-registration'
    out.mkdir(parents=True,exist_ok=True)
    (out/f'{c["sourceId"]}.json').write_text(json.dumps(result,indent=2),encoding='utf8')
    overlay = image.copy()
    for wall in building['walls']:
        pts = np.array(wall['rings'][0]['points'],float)
        normal = np.cross(pts,np.roll(pts,-1,axis=0)).sum(axis=0)
        if np.dot(normal,x[3:6]-pts.mean(axis=0))<=0: continue
        # Visual diagnostics must also show the curved projection of long
        # straight edges; joining only the corners conceals lens distortion.
        dense=np.concatenate([aa[None,:]+np.linspace(0,1,33,endpoint=False)[:,None]*(bb-aa)[None,:]
                              for aa,bb in zip(pts,np.roll(pts,-1,axis=0))]) if radial else pts
        uv = project(dense,x)
        if np.all(np.isfinite(uv)) and np.max(np.abs(uv))<50000:
            cv2.polylines(overlay,[np.rint(uv).astype(np.int32)],True,(50,180,250),1,cv2.LINE_AA)
    for i,control in enumerate(controls):
        at=tuple(np.rint(pixels[i]).astype(int)); pp=tuple(np.rint(predicted[i]).astype(int))
        color=(0,220,0) if control['role']=='train' else (255,0,255)
        cv2.circle(overlay,at,5,color,1);cv2.line(overlay,at,pp,(0,0,255),1)
        cv2.putText(overlay,control['name'],(at[0]+6,at[1]),cv2.FONT_HERSHEY_SIMPLEX,.4,color,1)
    for line in lines:
        color=(0,220,0) if line['role']=='train' else (255,0,255)
        pts=np.rint(np.array(line['pixels'])).astype(int)
        cv2.line(overlay,tuple(pts[0]),tuple(pts[1]),color,1,cv2.LINE_AA)
        for at in pts: cv2.circle(overlay,tuple(at),4,color,1)
    cv2.imwrite(str(out/f'{c["sourceId"]}-overlay.jpg'),overlay)
    print(json.dumps({key:result[key] for key in ['sourceId','accepted','cameraPosition','trainingRmsPixels','heldOutRmsPixels','horizontalPriorDeltaMetres','heightPriorDeltaMetres','rejectionReasons']}))
if __name__ == '__main__': main()
