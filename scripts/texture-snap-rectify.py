"""Official SNAP rectification for independently registered building polygons."""
import pathlib, sys, json, subprocess, hashlib
import numpy as np
import cv2
from texture_snap_case import ROOT, load_case
from texture_snap_albedo import normalize_atlas_group
root=ROOT
case, _ = load_case()
repo=root/'data/texture-poc/PLATEAU-SNAP-Server'
commit=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
assert commit=='d194f8891eddb965af1894e5cc6b67541ca7f307', 'Unexpected SNAP version'
sys.path.insert(0,str(repo/'lambdas'))
from src.ortho_transform.image_processing import rectify_facade
record=json.loads((root/f'data/texture-city/registration/{case["caseId"]}-surfaces.json').read_text(encoding='utf-8'))
fit=record['fit'];source=root/f'data/texture-city/photos/commons/{fit["sourceId"]}.jpg'
assert fit['buildingId']==case['buildingId'] and fit['sourceId']==case['sourceId'], 'Stale SNAP surfaces'
assert hashlib.sha256(source.read_bytes()).hexdigest()==fit['sourceSha256']
image=cv2.imread(str(source));out=root/f'data/texture-city/registration/{case["caseId"]}-rectified';out.mkdir(parents=True,exist_ok=True)
results=[];local_images={}
for s in record['surfaces']:
    width,height=s['width'],s['height']
    plane=[[0,0],[width,0],[width,height],[0,height]]
    warped,dest=rectify_facade(image,s['imagePoints'],plane,facade_buffer_px=0)
    w=max(16,min(2048,round(width*8)));h=max(16,min(2048,round(height*8)))
    matrix=cv2.getPerspectiveTransform(np.asarray(dest,np.float32),np.asarray([[0,h-1],[w-1,h-1],[w-1,0],[0,0]],np.float32))
    texture=cv2.warpPerspective(warped,matrix,(w,h))
    path=out/(s['polygonId']+'.png');assert cv2.imwrite(str(path),texture)
    local_images[s['polygonId']]=texture
    results.append({'polygonId':s['polygonId'],'groupKey':s['groupKey'],'texture':str(path.relative_to(root)).replace('\\','/'),'size':[w,h],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})

# Compose one coherent 2D canvas for each building + direction quadrant.  The
# pixels come only from the official SNAP-rectified surface images; uncovered
# atlas pixels stay transparent.
groups=[]
group_images=[]
for group_key in sorted({s['groupKey'] for s in record['surfaces']}):
    surfaces=[s for s in record['surfaces'] if s['groupKey']==group_key]
    dominant=max(surfaces,key=lambda s:s['area'])
    normal=np.asarray(dominant['normal'],float);u=np.array([normal[2],0,-normal[0]],float);u/=np.linalg.norm(u)
    all_positions=np.asarray([p for s in surfaces for p in np.asarray(s['positions'],float).reshape(-1,3)],float)
    coord_u=all_positions@u;coord_y=all_positions[:,1]
    lo=[float(coord_u.min()),float(coord_y.min())];hi=[float(coord_u.max()),float(coord_y.max())]
    width,height=hi[0]-lo[0],hi[1]-lo[1]
    ppm=min(8.0,4096/max(width,1e-6),4096/max(height,1e-6));aw=max(16,round(width*ppm));ah=max(16,round(height*ppm))
    atlas=np.zeros((ah,aw,4),np.uint8);painted=np.zeros((ah,aw),np.uint8)
    triangle_count=0
    for s in surfaces:
        local=local_images[s['polygonId']]
        if local.ndim==2: local=cv2.cvtColor(local,cv2.COLOR_GRAY2BGR)
        lh,lw=local.shape[:2]
        positions=np.asarray(s['positions'],float).reshape(-1,3);uv=np.asarray(s['uv'],float).reshape(-1,2)
        src=np.column_stack((uv[:,0]*(lw-1),uv[:,1]*(lh-1)))
        dst=np.asarray([[(p@u-lo[0])*ppm,(hi[1]-p[1])*ppm] for p in positions],float)
        design=np.column_stack((src,np.ones(len(src))))
        affine=np.linalg.lstsq(design,dst,rcond=None)[0].T.astype(np.float32)
        predicted=np.column_stack((design@affine[0],design@affine[1]))
        assert float(np.max(np.linalg.norm(predicted-dst,axis=1)))<.25, 'Direction-atlas affine mapping drifted'
        source_mask=np.zeros((lh,lw),np.uint8)
        for i in range(0,len(src),3):
            cv2.fillConvexPoly(source_mask,np.round(src[i:i+3]).astype(np.int32),255);triangle_count+=1
        warped_color=cv2.warpAffine(local,affine,(aw,ah),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT)
        warped_mask=cv2.warpAffine(source_mask,affine,(aw,ah),flags=cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
        valid=warped_mask>0
        atlas[valid,:3]=warped_color[valid,:3];atlas[valid,3]=255;painted[valid]=255
    safe=''.join(c if c.isalnum() or c in '-_' else '-' for c in group_key)
    raw_path=out/(safe+'.raw.atlas.png');assert cv2.imwrite(str(raw_path),atlas)
    groups.append({'groupKey':group_key,'quadrant':dominant['quadrant'],'rawTexture':str(raw_path.relative_to(root)).replace('\\','/'),'rawSha256':hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                   'size':[aw,ah],'pixelsPerMetre':ppm,'u':u.tolist(),'lo':lo,'hi':hi,'width':width,'height':height,'surfaceCount':len(surfaces),'triangles':triangle_count,
                   'paintedPixelRatio':float(np.count_nonzero(painted)/(aw*ah))})
    group_images.append(atlas)

albedo_images,inferred_tiles,albedo_report=normalize_atlas_group(group_images,[g['pixelsPerMetre'] for g in groups])
for group,albedo,tile,metrics in zip(groups,albedo_images,inferred_tiles,albedo_report['atlases']):
    safe=''.join(c if c.isalnum() or c in '-_' else '-' for c in group['groupKey'])
    path=out/(safe+'.atlas.png');assert cv2.imwrite(str(path),albedo)
    tile_path=out/(safe+'.inferred-tile.png');assert cv2.imwrite(str(tile_path),tile)
    group.update({'texture':str(path.relative_to(root)).replace('\\','/'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                  'inferredTexture':str(tile_path.relative_to(root)).replace('\\','/'),'inferredSha256':hashlib.sha256(tile_path.read_bytes()).hexdigest(),
                  'albedoMetrics':metrics})
(out/'report.json').write_text(json.dumps({'caseId':fit['caseId'],'snapCommit':commit,'sourceSha256':fit['sourceSha256'],'textures':results,'groups':groups,
                                           'atlasPolicy':'one-albedo-normalized-source-canvas-per-building-direction',
                                           'albedoNormalization':{key:value for key,value in albedo_report.items() if key!='atlases'}},indent=2),encoding='utf-8')
print(json.dumps({'rectified':len(results),'groups':len(groups),'snapCommit':commit,'albedoNormalization':albedo_report}))
