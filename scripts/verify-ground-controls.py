"""Regression: held-out annotations cannot improve a fit or silently extend coverage."""
import copy, json, pathlib, subprocess, sys, tempfile
import numpy as np

root = pathlib.Path(__file__).resolve().parents[1]
(root/'test-results').mkdir(exist_ok=True)
out = pathlib.Path(tempfile.mkdtemp(prefix='ground-controls-',dir=root/'test-results'))
source = json.loads((root/'scripts/texture-snap-cases/tocho-commons-145064071.json').read_text(encoding='utf8'))
results = []
def run(name, config, expected_failure=False):
    folder=out/name; folder.mkdir()
    file=folder/'config.json'; file.write_text(json.dumps(config),encoding='utf8')
    cmd=[sys.executable,'-X','faulthandler',str(root/'scripts/texture-ground-control-fit.py'),str(file),'--output-dir',str(folder)]
    proc=subprocess.run(cmd,cwd=root,capture_output=True,text=True)
    if expected_failure:
        assert proc.returncode != 0, name
        expected='Line is not a real mesh edge' if expected_failure is True else expected_failure
        assert expected in proc.stderr, proc.stderr
        results.append({'test':name,'passed':True})
        return
    assert proc.returncode==0, f'{name}: exit={proc.returncode}\nstdout={proc.stdout}\nstderr={proc.stderr}'
    return json.loads((folder/(config['sourceId']+'.json')).read_text(encoding='utf8'))

baseline=run('accepted',source)
assert baseline['accepted'] and 75<baseline['supportedHeightRangeMetres'][0]<80
results.append({'test':'accepted independent point and line validation','passed':True})

shorter=copy.deepcopy(source)
for line in shorter['lineControls']:
    if line['role']=='held-out': line['pixels']=line['pixels'][:2]
old=run('shorter-independent-height-support',shorter)
assert old['accepted'] and 90<old['supportedHeightRangeMetres'][0]<110
assert np.array_equal(old['cameraPosition'],baseline['cameraPosition'])
assert np.array_equal(old['rotationMatrix'],baseline['rotationMatrix'])
assert old['supportedHeightRangeMetres'][0]>baseline['supportedHeightRangeMetres'][0]
results.append({'test':'new lower independent observations extend support without changing camera','passed':True})

changed=copy.deepcopy(source)
for point in changed['controls']:
    if point['role']=='held-out': point['pixel'][0]+=30
row=run('bad-held-corners',changed)
assert np.array_equal(row['cameraPosition'],baseline['cameraPosition'])
assert not row['accepted'] and 'held-out-rms' in row['rejectionReasons']
results.append({'test':'held-out corners cannot enter fitting or model selection','passed':True})

changed=copy.deepcopy(source)
for line in changed['lineControls']:
    if line['role']=='held-out':
        for pixel in line['pixels']: pixel[0]+=30
row=run('bad-held-lines',changed)
assert np.array_equal(row['cameraPosition'],baseline['cameraPosition'])
assert not row['accepted'] and any(r.startswith('line-error:') for r in row['rejectionReasons'])
results.append({'test':'held-out edges reject bad alignment without modifying pose','passed':True})

changed=copy.deepcopy(source)
changed['lineControls']=[line for line in changed['lineControls'] if line['role']=='train']
row=run('no-held-lines',changed)
assert np.array_equal(row['cameraPosition'],baseline['cameraPosition'])
assert row['supportedHeightRangeMetres'][0]==186.37
results.append({'test':'missing independent edges prohibit lower-height extension','passed':True})

changed=copy.deepcopy(source)
changed['lineControls'][0]['world'][0][0]+=5
run('fabricated-edge-rejected',changed,expected_failure=True)

radial_source=json.loads((root/'scripts/texture-snap-cases/tocho-commons-145089656.json').read_text(encoding='utf8'))
radial_baseline=run('radial-accepted',radial_source)
assert radial_baseline['accepted'] and radial_baseline['cameraModel']=='simple-radial'
assert 90<radial_baseline['supportedHeightRangeMetres'][0]<110
results.append({'test':'radial fit passes unchanged point line and GPS gates','passed':True})
changed=copy.deepcopy(radial_source)
for point in changed['controls']:
    if point['role']=='held-out': point['pixel'][0]+=30
for line in changed['lineControls']:
    if line['role']=='held-out':
        for pixel in line['pixels']: pixel[0]+=30
row=run('radial-bad-held-out',changed)
assert np.array_equal(row['cameraPosition'],radial_baseline['cameraPosition'])
assert row['distortionCoefficients']==radial_baseline['distortionCoefficients']
assert not row['accepted']
results.append({'test':'held-out observations cannot alter radial fit or distortion','passed':True})

geometry_source=json.loads((root/'scripts/texture-snap-cases/tocho-commons-76730224.json').read_text(encoding='utf8'))
geometry_baseline=run('independent-geometry',geometry_source)
assert geometry_baseline['cameraStability']['trials']==64
assert geometry_baseline['positionValidation']=='independent-geometry'
changed=copy.deepcopy(geometry_source)
changed['cameraPrior']=[1000,500,300]
row=run('invented-gps-cannot-change-geometry-fit',changed)
assert np.array_equal(row['cameraPosition'],geometry_baseline['cameraPosition'])
assert row['cameraStability']==geometry_baseline['cameraStability']
assert row['accepted']==geometry_baseline['accepted']
results.append({'test':'unverified location cannot change independent geometry fit or acceptance','passed':True})
changed=copy.deepcopy(geometry_source)
for point in changed['controls']:
    if point['role']=='held-out': point['pixel'][0]+=30
row=run('geometry-bad-held-out',changed)
assert np.array_equal(row['cameraPosition'],geometry_baseline['cameraPosition'])
assert row['cameraStability']==geometry_baseline['cameraStability']
assert not row['accepted'] and 'held-out-rms' in row['rejectionReasons']
results.append({'test':'independent geometry held-out observations cannot enter sensitivity trials','passed':True})
changed=copy.deepcopy(geometry_source)
held_controls=[p for p in changed['controls'] if p['role']=='held-out']
changed['controls']=[p for p in changed['controls'] if p['role']=='train']+held_controls[:4]
row=run('geometry-too-few-held-out',changed)
assert not row['accepted'] and 'insufficient-independent-geometry-controls' in row['rejectionReasons']
results.append({'test':'geometry mode cannot replace GPS with only four held-out corners','passed':True})
changed=copy.deepcopy(geometry_source)
changed['lensCalibrationPath']=changed['rejectedLensCalibrationPath']
changed['lensPairCalibrationPaths']=changed['rejectedLensPairCalibrationPaths']
run('rejected-lens-cannot-enter-camera-fit',changed,expected_failure='Unvalidated shared lens')

ensemble_source=copy.deepcopy(geometry_source)
ensemble_source['positionValidation']='projection-ensemble'
ensemble_baseline=run('projection-ensemble-conditional',ensemble_source)
assert ensemble_baseline['accepted'] and not ensemble_baseline['worldCameraPositionVerified']
assert ensemble_baseline['requiresPerSurfaceEnsembleValidation']
assert len([e for e in ensemble_baseline['projectionEnsemble'] if e['kind']=='training-noise'])==64
assert np.array_equal(ensemble_baseline['cameraPosition'],geometry_baseline['cameraPosition'])
results.append({'test':'projection ensemble is conditional surface evidence, not a camera-location claim','passed':True})
changed=copy.deepcopy(ensemble_source)
for point in changed['controls']:
    if point['role']=='held-out': point['pixel'][0]+=30
row=run('projection-ensemble-bad-held-out',changed)
assert not row['accepted'] and 'projection-ensemble-held-out-error' in row['rejectionReasons']
assert row['projectionEnsemble']==ensemble_baseline['projectionEnsemble']
assert np.array_equal(row['cameraPosition'],ensemble_baseline['cameraPosition'])
results.append({'test':'held-out data cannot fit or filter projection ensemble members','passed':True})
changed=copy.deepcopy(ensemble_source);changed['cameraPrior']=[999,888,777]
row=run('projection-ensemble-unverified-gps',changed)
assert row['accepted']==ensemble_baseline['accepted']
assert row['projectionEnsemble']==ensemble_baseline['projectionEnsemble']
results.append({'test':'unverified GPS cannot change projection ensemble or acceptance','passed':True})

report={'passed':True,'tests':results,'baselineCamera':baseline['cameraPosition'],'output':str(out)}
(out/'result.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
