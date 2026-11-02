"""Reject ceilings/bridges incorrectly accepted by the street-scene mask.
Independent ADE20K building-class agreement; no invented facade pixels.
"""
import argparse, pathlib, json, hashlib, urllib.request
import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

parser=argparse.ArgumentParser()
parser.add_argument('--image')
parser.add_argument('--limit',type=int,default=100000)
parser.add_argument('--device',choices=['cpu','cuda'],default='cpu')
parser.add_argument('--provider',choices=['mapillary','msls'],default='mapillary')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
photos=root/f'data/texture-city/photos/{args.provider}'
base=root/('data/texture-city/masks' if args.provider=='mapillary' else 'data/texture-city/msls/masks')
out=root/('data/texture-city/facade-masks' if args.provider=='mapillary' else 'data/texture-city/msls/facade-masks')
out.mkdir(parents=True,exist_ok=True)
record=out/'model.json'
model_id='nvidia/segformer-b0-finetuned-ade-512-512'
if args.provider=='msls' and not record.exists():
    legacy_record=root/'data/texture-city/facade-masks/model.json'
    if legacy_record.exists():
        config=json.loads(legacy_record.read_text(encoding='utf8'))
        record.write_text(json.dumps(config,indent=2),encoding='utf8')
if record.exists(): config=json.loads(record.read_text(encoding='utf8'))
else:
    with urllib.request.urlopen('https://huggingface.co/api/models/'+model_id,timeout=30) as r: revision=json.load(r)['sha']
    config={'model':model_id,'revision':revision}
config.update({'classes':['building','house','skyscraper'],'threshold':0.4,'boundaryErosionPixels':0,'policy':'intersect-cityscapes-building-and-ade20k-building-family-v3-no-erosion','note':'Automatic classifier agreement, not proof of correct building correspondence. Boundary shrink is deferred to one final atlas-space margin.'})
config.pop('class',None)
record.write_text(json.dumps(config,indent=2),encoding='utf8')
torch.set_num_threads(4)
processor=AutoImageProcessor.from_pretrained(model_id,revision=config['revision'])
model=SegformerForSemanticSegmentation.from_pretrained(model_id,revision=config['revision']).eval().to(args.device)
labels=[int(k) for k,v in model.config.id2label.items() if v in config['classes']]
assert len(labels)==len(config['classes']), 'Missing expected ADE building class'
count=0
paths=[photos/(args.image+'.json')] if args.image else sorted(photos.glob('*.json'))
for path in paths:
    if (args.provider=='mapillary' and not path.stem.isdecimal()) or not (base/(path.stem+'.png')).exists(): continue
    meta=json.loads(path.read_text(encoding='utf8'))
    primary_provenance=json.loads((base/(path.stem+'.json')).read_text(encoding='utf8'))
    if primary_provenance.get('sourceSha256') != meta['sha256']:
        print(json.dumps({'id':path.stem,'status':'primary-mask-source-mismatch'}),flush=True)
        continue
    mask_bytes=(base/(path.stem+'.png')).read_bytes()
    key=hashlib.sha256(mask_bytes+meta['sha256'].encode()+json.dumps({**config,'device':args.device},sort_keys=True).encode()).hexdigest()
    stamp=out/(path.stem+'.json'); dest=out/(path.stem+'.png')
    if stamp.exists() and dest.exists() and json.loads(stamp.read_text(encoding='utf8')).get('key')==key: continue
    photo_path=photos/(path.stem+'.jpg')
    if args.provider=='msls' and hashlib.sha256(photo_path.read_bytes()).hexdigest()!=meta['sha256']:
        raise RuntimeError('MSLS source image hash mismatch')
    im=Image.open(photo_path).convert('RGB'); w,h=im.size
    full=np.zeros((h,w),dtype=np.uint8)
    camera_type=meta.get('camera_type') if args.provider=='mapillary' else {'PLANE':'perspective','UNCONFIRMED':'perspective','SPHERE':'spherical'}.get(meta.get('projection'))
    if camera_type not in ('spherical','equirectangular','perspective'): continue
    pano=camera_type in ('spherical','equirectangular')
    step=w//4 if pano else w
    for left in range(0,w,step):
        right=min(w,left+step); patch=im.crop((left,0,right,h))
        size={'height':512,'width':256} if pano else {'height':max(32,round(h/max(w,h)*512/32)*32),'width':max(32,round(w/max(w,h)*512/32)*32)}
        inputs=processor(images=patch,return_tensors='pt',size=size).to(args.device)
        with torch.inference_mode():
            probs=model(**inputs).logits.softmax(1)[0]
            top=probs.argmax(0)
            family=torch.stack([top==label for label in labels]).any(0)
            valid=((probs[labels].sum(0)>=config['threshold'])&family).cpu().numpy().astype(np.uint8)*255
        full[:,left:right]=cv2.resize(valid,(right-left,h),interpolation=cv2.INTER_NEAREST)
    previous=cv2.imdecode(np.frombuffer(mask_bytes,np.uint8),cv2.IMREAD_GRAYSCALE)
    result=cv2.bitwise_and(previous,full)
    if not cv2.imwrite(str(dest),result): raise RuntimeError('Cannot save facade mask')
    summary={'id':path.stem,'key':key,'policy':config['policy'],'device':args.device,'sourceSha256':meta['sha256'],'beforePixels':int((previous>0).sum()),'afterPixels':int((result>0).sum()),'registration':'not-verified'}
    stamp.write_text(json.dumps(summary,indent=2),encoding='utf8')
    count+=1
    if args.image or count%25==0: print(json.dumps({'id':path.stem,'beforePixels':summary['beforePixels'],'afterPixels':summary['afterPixels'],'processed':count}),flush=True)
    if count>=args.limit: break
print(json.dumps({'processed':count,'status':'completed-current-mask-snapshot'}),flush=True)
