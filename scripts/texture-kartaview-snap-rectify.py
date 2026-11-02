"""Run the pinned official SNAP rectifier on source-derived RGBA photographs."""
import argparse, hashlib, json, pathlib, subprocess, sys
import cv2
import numpy as np
from texture_kartaview_sfm_io import save
ROOT=pathlib.Path(__file__).resolve().parents[1]

def run(area):
    assert area in ['tocho','tokyo-tower']
    repo=ROOT/'data/texture-poc/PLATEAU-SNAP-Server'
    commit=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
    assert commit=='d194f8891eddb965af1894e5cc6b67541ca7f307'
    sys.path.insert(0,str(repo/'lambdas'))
    from src.ortho_transform.image_processing import rectify_facade
    path=ROOT/f'data/texture-city/kartaview/snap-surfaces-{area}.json'
    source_bytes=path.read_bytes(); record=json.loads(source_bytes)
    assert record['areaId']==area
    images={}
    for p in record['photos']:
        image_path,mask_path=ROOT/p['imagePath'],ROOT/p['maskPath']
        assert hashlib.sha256(image_path.read_bytes()).hexdigest()==p['imageSha256']
        assert hashlib.sha256(mask_path.read_bytes()).hexdigest()==p['maskSha256']
        color=cv2.imread(str(image_path));mask=cv2.imread(str(mask_path),cv2.IMREAD_GRAYSCALE)
        assert color is not None and mask is not None and color.shape[:2]==mask.shape
        images[p['id']]=np.dstack((color,mask))
    out=ROOT/f'data/texture-city/kartaview/snap-rectified-{area}';out.mkdir(exist_ok=True)
    textures,failures=[],[]
    for s in record['surfaces']:
        try:
            width,height=s['width'],s['height']
            warped,dest=rectify_facade(images[s['sourceId']],s['imagePoints'],[[0,0],[width,0],[width,height],[0,height]],facade_buffer_px=0)
            w=max(16,min(2048,round(width*8)));h=max(16,min(2048,round(height*8)))
            matrix=cv2.getPerspectiveTransform(np.asarray(dest,np.float32),np.asarray([[0,h-1],[w-1,h-1],[w-1,0],[0,0]],np.float32))
            texture=cv2.warpPerspective(warped,matrix,(w,h))
            assert texture.shape==(h,w,4)
            if not np.any(texture[:,:,3]>=128):
                failures.append({'key':s['key'],'reason':'empty-alpha-after-rectification'});continue
            target=out/(s['key']+'.png');assert cv2.imwrite(str(target),texture)
            textures.append({'key':s['key'],'sourceId':s['sourceId'],'buildingId':s['buildingId'],'path':str(target.relative_to(ROOT)).replace('\\','/'),
                             'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'size':[w,h]})
        except Exception as error:
            failures.append({'key':s['key'],'reason':str(error)})
    report={'areaId':area,'surfaceRecordSha256':hashlib.sha256(source_bytes).hexdigest(),'snapCommit':commit,'textures':textures,'failures':failures}
    save(out/'report.json',report)
    print(json.dumps({'area':area,'textures':len(textures),'failures':len(failures),'snapCommit':commit}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('area');run(parser.parse_args().area)
