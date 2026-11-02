"""Prepare real, undistorted KartaView inputs for a separate provisional SNAP trial."""
import argparse, hashlib, json, pathlib
import cv2
import numpy as np
from texture_kartaview_sfm_io import save, usable_radial_camera

ROOT = pathlib.Path(__file__).resolve().parents[1]
hash_bytes = lambda value: hashlib.sha256(value).hexdigest()

def run(area):
    assert area in ['tocho', 'tokyo-tower']
    base = ROOT / 'data/texture-city/kartaview'
    locations = json.loads((base/'locations.json').read_text(encoding='utf8'))['locations']
    anchors = {p['id']:p for p in locations if p['areaId']==area}
    best, rejected, used_alignment_files = {}, [], []
    for result_path in sorted((base/'sfm').glob('*/result.json')):
        result = json.loads(result_path.read_text(encoding='utf8'))
        sparse = (ROOT/result['output']).resolve()
        assert sparse.is_relative_to((base/'sfm').resolve())
        location_hash = hash_bytes((base/'locations.json').read_bytes())
        geo = sparse/f'geo-{location_hash[:16]}'
        alignment_path = geo/'alignment.json'
        if not alignment_path.exists():
            continue
        alignment = json.loads(alignment_path.read_text(encoding='utf8'))
        if alignment['areaId']!=area:
            continue
        assert alignment['locationSha256']==location_hash
        assert alignment['sourceResultSha256']==hash_bytes(result_path.read_bytes())
        used_alignment_files.append({'path': str(alignment_path.relative_to(ROOT)), 'sha256': hash_bytes(alignment_path.read_bytes())})
        for entry in alignment['models']:
            if entry['status']!='gps-aligned-unverified':
                continue
            model_path = geo/f"model-{entry['modelId']}-cameras.json"
            model = json.loads(model_path.read_text(encoding='utf8'))
            if model['heldOut']['count']<2 or model['heldOut']['rmseMetres']>10:
                rejected.extend({'id':p['id'],'reason':'model-held-out-GPS-RMSE-over-10m'} for p in model['images'])
                continue
            cameras = {c['id']:c for c in model['cameras']}
            for image in model['images']:
                photo_id=image['id']; anchor=anchors.get(photo_id)
                if not usable_radial_camera(cameras[image['cameraId']]):
                    rejected.append({'id':photo_id,'reason':'unsupported-or-degenerate-intrinsics'}); continue
                if not anchor or not anchor['position']:
                    rejected.append({'id':photo_id,'reason':'no-height-anchor'}); continue
                if anchor['height']['method'] not in ['LOD3-road-at-camera-XY-plus-1.65m-estimate','nearest-LOD3-road-plus-1.65m-estimate']:
                    rejected.append({'id':photo_id,'reason':'ground-height-not-road-deck'}); continue
                assert anchor['sourceSha256']==image['sourceSha256']
                error=float(np.linalg.norm(np.asarray(image['position'])-anchor['position']))
                if not np.isfinite(error) or error>10:
                    rejected.append({'id':photo_id,'reason':'gps-anchor-difference-over-10m'}); continue
                if photo_id not in best or error<best[photo_id]['anchorErrorMetres']:
                    best[photo_id]={**image,'intrinsics':cameras[image['cameraId']], 'anchorErrorMetres':error,
                                    'alignmentSource':str(model_path.relative_to(ROOT)), 'alignmentSha256':hash_bytes(model_path.read_bytes()), 'heightAnchor':anchor}
    prepared=[]
    for photo_id,item in best.items():
        raw_path=ROOT/f'data/texture-city/photos/kartaview/{photo_id}.jpg'
        meta=json.loads(raw_path.with_suffix('.json').read_text(encoding='utf8'))
        assert meta['sha256']==item['sourceSha256']==hash_bytes(raw_path.read_bytes())
        mask_path=base/f'facade-masks/{photo_id}.png'
        if not mask_path.exists() or not mask_path.with_suffix('.json').exists():
            rejected.append({'id':photo_id,'reason':'semantic-mask-missing'})
            continue
        mask_meta=json.loads(mask_path.with_suffix('.json').read_text(encoding='utf8'))
        assert mask_meta['sourceSha256']==meta['sha256']
        assert mask_meta['policy']=='intersect-cityscapes-building-and-ade20k-building-family-v3-no-erosion'
        camera=item['intrinsics']; assert camera['model']=='SIMPLE_RADIAL'
        f,cx,cy,k=camera['params']; w,h=camera['width'],camera['height']
        assert [w,h]==meta['downloadSize'] and meta['exifOrientation']==1
        matrix=np.array([[f,0,cx],[0,f,cy],[0,0,1]],float)
        key=hash_bytes(json.dumps({'source':meta['sha256'],'camera':camera,'mask':hash_bytes(mask_path.read_bytes()),'erosion':0},sort_keys=True).encode())[:20]
        out=base/f'snap-prepared/{photo_id}-{key}'; out.mkdir(parents=True,exist_ok=True)
        color_path,derived_mask=out/'image.png',out/'mask.png'
        if not color_path.exists() or not derived_mask.exists():
            image=cv2.imread(str(raw_path)); mask=cv2.imread(str(mask_path),cv2.IMREAD_GRAYSCALE)
            assert image is not None and mask is not None and image.shape[:2]==mask.shape==(h,w)
            mx,my=cv2.initUndistortRectifyMap(matrix,np.array([k,0,0,0]),None,matrix,(w,h),cv2.CV_32FC1)
            corrected=cv2.remap(image,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
            corrected_mask=cv2.remap(mask,mx,my,cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
            assert cv2.imwrite(str(color_path),corrected) and cv2.imwrite(str(derived_mask),corrected_mask)
        prepared.append({**item,'provider':'kartaview','areaId':area,'imagePath':str(color_path.relative_to(ROOT)).replace('\\','/'),
                         'maskPath':str(derived_mask.relative_to(ROOT)).replace('\\','/'),'imageSha256':hash_bytes(color_path.read_bytes()),
                         'maskSha256':hash_bytes(derived_mask.read_bytes()),'imageSize':[w,h],'cameraMatrix':matrix.tolist(),
                         'sourcePage':meta['sourcePage'],'license':meta['license']['name'],'author':'Grab and KartaView Contributors',
                         'independence':'unverified; KartaView and Mapillary may contain cross-platform captures'})
    report={'areaId':area,'photos':prepared,'rejected':rejected,'alignmentSources':used_alignment_files,'applied':False,
            'policy':'source-hash-checked-SfM-held-out-GPS-RMSE-and-road-anchor-difference-at-most-10m-undistorted-v2-no-early-erosion',
            'warning':'Provisional camera and masks, not surveyed registration. No existing SNAP or Mapillary inputs are replaced.'}
    save(base/f'snap-inputs-{area}.json',report)
    print(json.dumps({'area':area,'prepared':len(prepared),'rejected':len(rejected)}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('area'); run(parser.parse_args().area)
