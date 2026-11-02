"""Conservative semantic masks for real ground photos; never synthesize colors."""
import json, pathlib, hashlib, argparse, urllib.request
import numpy as np
import torch
import cv2
from PIL import Image
from transformers import AutoImageProcessor, SegformerForSemanticSegmentation

parser = argparse.ArgumentParser()
parser.add_argument('--limit', type=int, default=100000)
parser.add_argument('--device', choices=['cpu','cuda'], default='cpu')
parser.add_argument('--provider', choices=['mapillary','msls'], default='mapillary')
parser.add_argument('--image')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
photos = root / f'data/texture-city/photos/{args.provider}'
out = root / ('data/texture-city/masks' if args.provider=='mapillary' else 'data/texture-city/msls/masks')
out.mkdir(parents=True, exist_ok=True)
model_id = 'nvidia/segformer-b0-finetuned-cityscapes-1024-1024'
record = out / 'model.json'
if args.provider=='msls' and not record.exists():
    # Reuse the exact model revision used for the other source when that cache is
    # still present. The user may legitimately remove the Mapillary experiment,
    # so MSLS must also be able to initialize its own pinned revision.
    legacy_record=root/'data/texture-city/masks/model.json'
    if legacy_record.exists():
        config=json.loads(legacy_record.read_text(encoding='utf8'))
        record.write_text(json.dumps(config,indent=2),encoding='utf8')
if record.exists():
    config = json.loads(record.read_text(encoding='utf8'))
else:
    with urllib.request.urlopen('https://huggingface.co/api/models/' + model_id, timeout=30) as r:
        revision = json.load(r)['sha']
    config = {'model': model_id, 'revision': revision}
config.update({
    'class': 'building',
    'threshold': 0.8,
    'boundaryErosionPixels': 0,
    'policy': 'cityscapes-building-probability-and-argmax-v3-no-erosion',
    'note': 'Automatic mask, not ground truth. Boundary shrink is deferred to one final atlas-space margin; this stage does not distinguish roofs from facades or validate camera registration.',
})
record.write_text(json.dumps(config, indent=2), encoding='utf8')
torch.set_num_threads(4)
processor = AutoImageProcessor.from_pretrained(model_id, revision=config['revision'])
model = SegformerForSemanticSegmentation.from_pretrained(model_id, revision=config['revision']).eval().to(args.device)
label = next(int(k) for k,v in model.config.id2label.items() if v == 'building')
count = 0
paths = [photos / (args.image + '.json')] if args.image else sorted(photos.glob('*.json'))
for path in paths:
    if not path.exists():
        raise FileNotFoundError(path)
    if args.provider=='mapillary' and not path.stem.isdecimal(): continue
    meta = json.loads(path.read_text(encoding='utf8'))
    camera_type=meta.get('camera_type') if args.provider=='mapillary' else {'PLANE':'perspective','UNCONFIRMED':'perspective','SPHERE':'spherical'}.get(meta.get('projection'))
    if camera_type not in ('spherical','equirectangular','perspective'): continue
    dest = out / (path.stem + '.png')
    source_hash = meta['sha256']
    key = hashlib.sha256((source_hash + json.dumps(config, sort_keys=True)).encode()).hexdigest()
    stamp = out / (path.stem + '.json')
    if dest.exists() and stamp.exists() and json.loads(stamp.read_text(encoding='utf8')).get('key') == key: continue
    photo_path=photos / (path.stem + '.jpg')
    if args.provider=='msls' and hashlib.sha256(photo_path.read_bytes()).hexdigest()!=source_hash:
        raise RuntimeError('MSLS source image hash mismatch')
    im = Image.open(photo_path).convert('RGB')
    # Four native panorama strips reduce aspect-ratio distortion in the classifier.
    w,h = im.size
    full = np.zeros((h,w), dtype=np.uint8)
    panorama = camera_type in ('spherical','equirectangular')
    step = w//4 if panorama else w
    for left in range(0,w,step):
        right=min(w,left+step)
        patch=im.crop((left,0,right,h))
        size = {'height':512,'width':256} if panorama else {'height':max(32,round(h/max(w,h)*512/32)*32),'width':max(32,round(w/max(w,h)*512/32)*32)}
        inputs=processor(images=patch,return_tensors='pt',size=size).to(args.device)
        with torch.inference_mode():
            logits=model(**inputs).logits
            probs=torch.nn.functional.interpolate(logits,size=(h,right-left),mode='bilinear',align_corners=False).softmax(1)
            mask=((probs[0,label] >= .8)&(probs[0].argmax(0)==label)).cpu().numpy().astype(np.uint8)*255
        full[:,left:right]=mask
    if not cv2.imwrite(str(dest),full): raise RuntimeError('Cannot write mask')
    stamp.write_text(json.dumps({'key':key,'sourceSha256':source_hash,'fraction':float((full>0).mean()),'device':args.device,'registration':'not-verified'}),encoding='utf8')
    count+=1
    if count%25==0: print(json.dumps({'id':path.stem,'masked':count,'buildingFraction':float((full>0).mean())}),flush=True)
    if count >= args.limit: break
print(json.dumps({'masked':count,'status':'completed-current-photo-snapshot'}),flush=True)
