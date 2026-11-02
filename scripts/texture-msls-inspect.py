"""Inspect user-provided MSLS archives without extracting foreign-city datasets."""
import csv, hashlib, io, json, math, pathlib, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
source = ROOT/'mapillary_dataset'
out = ROOT/'data/texture-city/msls'
out.mkdir(parents=True, exist_ok=True)
catalog = json.loads((ROOT/'public/assets/texture-poc/city-catalog.json').read_text(encoding='utf8'))
areas = {}
for area in catalog['areas']:
    bs = [b for b in catalog['buildings'] if b['areaId']==area['id']]
    areas[area['id']] = {'bbox':[min(b['lon'] for b in bs)-.002, min(b['lat'] for b in bs)-.002, max(b['lon'] for b in bs)+.002, max(b['lat'] for b in bs)+.002], 'center':[sum(b['lon'] for b in bs)/len(bs),sum(b['lat'] for b in bs)/len(bs)]}
rows, inventory, images = [], [], {}
for path in sorted(source.glob('*.zip')):
    with zipfile.ZipFile(path) as z:
        info = {'name':path.name, 'bytes':path.stat().st_size, 'cities':{}, 'metadata':[]}
        for entry in z.infolist():
            parts=entry.filename.split('/')
            if len(parts)>3 and parts[0]=='train_val' and entry.filename.endswith('.jpg'):
                info['cities'][parts[1]]=info['cities'].get(parts[1],0)+1
                if parts[1]=='tokyo': images[parts[-1][:-4]]={'archive':path.name,'entry':entry.filename,'crc':entry.CRC,'bytes':entry.file_size}
            if entry.filename.startswith('train_val/tokyo/') and entry.filename.endswith('.csv'):
                raw=z.read(entry); dest=out/entry.filename; dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
                info['metadata'].append({'entry':entry.filename,'sha256':hashlib.sha256(raw).hexdigest()})
                if entry.filename.endswith('/raw.csv'):
                    rows.extend({**r,'split':parts[2]} for r in csv.DictReader(io.StringIO(raw.decode('utf8'))))
            if entry.filename=='LICENSE.txt': (out/'LICENSE.txt').write_bytes(z.read(entry))
        inventory.append(info)
selected=[]
for r in rows:
    lon,lat=float(r['lon']),float(r['lat'])
    ids=[key for key,a in areas.items() if a['bbox'][0]<=lon<=a['bbox'][2] and a['bbox'][1]<=lat<=a['bbox'][3]]
    if ids: selected.append({**r,'areaIds':ids,'image':images.get(r['key'])})
report={'sourceDirectory':str(source),'archives':inventory,'areas':areas,'tokyoMetadataRows':len(rows),'tokyoImageKeys':len(images),'regionalPhotos':selected,'regionalCounts':{a:sum(a in p['areaIds'] for p in selected) for a in areas},'regionalImagesPresent':sum(p['image'] is not None for p in selected),'applied':False}
(out/'inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({k:v for k,v in report.items() if k not in ['archives','regionalPhotos']},ensure_ascii=False))
