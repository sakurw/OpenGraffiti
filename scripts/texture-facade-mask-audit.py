"""Check that the second semantic filter never adds pixels, including a known ceiling."""
import pathlib,json,cv2,numpy as np
root=pathlib.Path(__file__).resolve().parents[1]/'data/texture-city'
count=0;before=0;after=0
for path in (root/'facade-masks').glob('*.json'):
    if not path.stem.isdecimal(): continue
    meta=json.loads(path.read_text())
    assert meta.get('policy')=='intersect-cityscapes-building-and-ade20k-building-family-v2', path.stem
    source=json.loads((root/'photos/mapillary'/(path.stem+'.json')).read_text())
    assert meta['sourceSha256']==source['sha256'], path.stem
    original=cv2.imread(str(root/'masks'/(path.stem+'.png')),cv2.IMREAD_GRAYSCALE)
    filtered=cv2.imread(str(root/'facade-masks'/(path.stem+'.png')),cv2.IMREAD_GRAYSCALE)
    assert original is not None and filtered is not None
    assert original.shape==filtered.shape
    assert not np.any((filtered>0)&(original==0)), path.stem
    assert int((filtered>0).sum())==meta['afterPixels']
    count+=1;before+=int((original>0).sum());after+=int((filtered>0).sum())
example='1283779498724440'
a=cv2.imread(str(root/'masks'/(example+'.png')),0)
b=cv2.imread(str(root/'facade-masks'/(example+'.png')),0)
for x,y in [(100,100),(1800,100)]:
    assert a[y,x]==255 and b[y,x]==0, 'Known underside ceiling was not removed'
assert (b>0).sum()>0, 'The entire reference photo was discarded rather than filtered'
expected=sum(p.stem.isdecimal() for p in (root/'photos/mapillary').glob('*.json'))
assert count==expected, 'Every downloaded photo must have an up-to-date facade mask'
report={'checkedMasks':count,'beforePixels':before,'afterPixels':after,'removedPixels':before-after,'knownCeilingSamplesRemoved':2,'note':'Mask consistency and two manually inspected ceiling samples only; not proof of facade registration.'}
(root/'facade-mask-audit.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report))
