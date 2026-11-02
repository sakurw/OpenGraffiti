"""Extract only regional images; preserve original JPEG and sequence metadata."""
import csv, hashlib, io, json, pathlib, zipfile
from collections import Counter
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
base=ROOT/'data/texture-city/msls'
report=json.loads((base/'inspection.json').read_text(encoding='utf8'))
meta={}
for split in ['database','query']:
    p=base/f'train_val/tokyo/{split}'
    seq={r['key']:r for r in csv.DictReader((p/'seq_info.csv').open(encoding='utf8'))}
    post={r['key']:r for r in csv.DictReader((p/'postprocessed.csv').open(encoding='utf8'))}
    meta[split]=(seq,post)
dest=ROOT/'data/texture-city/photos/msls';dest.mkdir(parents=True,exist_ok=True)
archives={};counts=Counter();sizes=Counter();photos=[]
try:
    for row in report['regionalPhotos']:
        item=row['image']
        if not item: continue
        if item['archive'] not in archives: archives[item['archive']]=zipfile.ZipFile(ROOT/'mapillary_dataset'/item['archive'])
        raw=archives[item['archive']].read(item['entry'])
        sha=hashlib.sha256(raw).hexdigest(); image=Image.open(io.BytesIO(raw)); orientation=image.getexif().get(274,1);image.verify()
        assert orientation==1, 'Rotated source needs explicit camera convention handling'
        seq,post=meta[row['split']];s=seq[row['key']];p=post[row['key']]
        record={**row,'id':row['key'],'provider':'msls','sequenceId':s['sequence_key'],'sequenceIndex':int(s['frame_number']),
                'status':'downloaded','sha256':sha,'downloadSize':list(image.size),'exifOrientation':orientation,'shotDate':row['captured_at'],'lng':row['lon'],
                'sourcePage':'https://github.com/mapillary/mapillary_sls','license':'CC BY-NC-SA (dataset LICENSE.txt links to by-nc/4.0; contradictory wording retained)',
                'postprocessed':p,'projection':'UNCONFIRMED','registration':'unregistered'}
        target=dest/(row['key']+'.jpg')
        if target.exists(): assert hashlib.sha256(target.read_bytes()).hexdigest()==sha
        else: target.write_bytes(raw)
        (dest/(row['key']+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8')
        photos.append(record);counts[s['sequence_key']]+=1;sizes[image.size]+=1
finally:
    for z in archives.values():z.close()
(base/'photos.json').write_text(json.dumps(photos,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'photos':len(photos),'sequences':counts.most_common(),'sizes':{str(k):v for k,v in sizes.items()}},ensure_ascii=False))
