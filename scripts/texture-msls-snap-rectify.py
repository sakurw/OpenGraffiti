"""Build PLATEAU wall atlases directly from locally registered ground photos."""
import argparse, hashlib, json, pathlib, subprocess, sys
import cv2
import numpy as np
from texture_kartaview_sfm_io import save
ROOT=pathlib.Path(__file__).resolve().parents[1]
PLANE_NORMAL_TOLERANCE_DEGREES=1.5
PLANE_OFFSET_TOLERANCE_METRES=.5
RGB_PIXELS_PER_METRE=8.0
MAX_TEXTURE_DIMENSION=2048
CORNER_ORDER=['bottom-left','bottom-right','top-right','top-left']

def _signed_area(points):
    p=np.asarray(points,float)
    return .5*float(np.sum(p[:,0]*np.roll(p[:,1],-1)-p[:,1]*np.roll(p[:,0],-1)))

def _perspective(src,dst):
    src=np.asarray(src,np.float32);dst=np.asarray(dst,np.float32)
    matrix=cv2.getPerspectiveTransform(src,dst)
    projected=cv2.perspectiveTransform(src.reshape(1,-1,2),matrix).reshape(-1,2)
    errors=np.linalg.norm(projected-dst,axis=1)
    if not np.all(np.isfinite(matrix)) or float(errors.max())>.05:
        raise ValueError('direct-homography-corner-reprojection')
    source_area=_signed_area(src);destination_area=_signed_area(dst)
    if abs(source_area)<1e-6 or abs(destination_area)<1e-6:
        raise ValueError('degenerate-direct-homography')
    return matrix,{
        'cornerOrder':CORNER_ORDER,
        'sourcePoints':src.astype(float).tolist(),
        'destinationPoints':dst.astype(float).tolist(),
        'sourceOrientationSign':1 if source_area>0 else -1,
        'destinationOrientationSign':1 if destination_area>0 else -1,
        'orientationSignChanged':bool(source_area*destination_area<0),
        'cornerReprojectionMaxPixels':float(errors.max()),
        'cornerReprojectionRmsPixels':float(np.sqrt(np.mean(errors**2))),
        'homography':matrix.astype(float).tolist(),
    }

def _source_mappings(surface):
    mappings=surface.get('sourceMappings')
    if mappings:
        return mappings
    return [{'sourceId':surface['sourceId'],'imagePoints':surface['imagePoints'],'visibilityMask':surface['visibilityMask']}]

def _source_resolution(surface,mapping):
    p=np.asarray(mapping['imagePoints'],float);width=max(float(surface['width']),1e-9);height=max(float(surface['height']),1e-9)
    polygon_area=abs(_signed_area(p));area_ppm=float(np.sqrt(polygon_area/(width*height))) if polygon_area>0 else 0.
    edge_ppm=[float(np.linalg.norm(p[1]-p[0])/width),float(np.linalg.norm(p[2]-p[3])/width),float(np.linalg.norm(p[3]-p[0])/height),float(np.linalg.norm(p[2]-p[1])/height)]
    return {'areaPixelsPerMetre':area_ppm,'minimumEdgePixelsPerMetre':min(edge_ppm),'edgePixelsPerMetre':edge_ppm}

def _load_visibility(surface):
    record=surface.get('visibilityMask')
    if not record: raise ValueError('missing-continuous-visibility-mask')
    path=ROOT/record['path']
    if hashlib.sha256(path.read_bytes()).hexdigest()!=record['sha256']: raise ValueError('visibility-mask-hash-mismatch')
    mask=cv2.imread(str(path),cv2.IMREAD_GRAYSCALE)
    if mask is None or [mask.shape[1],mask.shape[0]]!=record['size']: raise ValueError('visibility-mask-size-mismatch')
    return mask,record

def _surface_uv_to_atlas(surface,u,lo,hi,ppm):
    positions=np.asarray(surface['positions'],float).reshape(-1,3);uv=np.asarray(surface['uv'],float).reshape(-1,2)
    dst=np.asarray([[(p@u-lo[0])*ppm,(hi[1]-p[1])*ppm] for p in positions],float)
    design=np.column_stack((uv,np.ones(len(uv))));affine=np.linalg.lstsq(design,dst,rcond=None)[0].T
    predicted=np.column_stack((design@affine[0],design@affine[1]))
    error=float(np.max(np.linalg.norm(predicted-dst,axis=1)))
    if error>=.35: raise ValueError('coplanar-atlas-affine-drift')
    canonical_uv=np.asarray([[0,1],[1,1],[1,0],[0,0]],float);canonical_design=np.column_stack((canonical_uv,np.ones(4)))
    corners=np.column_stack((canonical_design@affine[0],canonical_design@affine[1]))
    return affine.astype(np.float32),corners.astype(np.float32),error

def _surface_plane(surface):
    positions=np.asarray(surface['positions'],float).reshape(-1,3)
    normal=np.asarray(surface['normal'],float)
    normal/=np.linalg.norm(normal)
    return normal,positions.mean(axis=0),positions

def _plane_clusters(surfaces):
    """Keep logical direction groups, but never flatten distinct physical planes."""
    clusters=[]
    minimum_dot=float(np.cos(np.deg2rad(PLANE_NORMAL_TOLERANCE_DEGREES)))
    for surface in sorted(surfaces,key=lambda s:(-s['area'],s['key'])):
        normal,origin,positions=_surface_plane(surface)
        selected=None
        for cluster in clusters:
            reference_normal,reference_origin=cluster['normal'],cluster['origin']
            if float(np.dot(reference_normal,normal))<minimum_dot:
                continue
            deviation=float(np.max(np.abs((positions-reference_origin)@reference_normal)))
            if deviation<=PLANE_OFFSET_TOLERANCE_METRES:
                selected=cluster;break
        if selected is None:
            selected={'normal':normal,'origin':origin,'surfaces':[]};clusters.append(selected)
        selected['surfaces'].append(surface)
    return clusters

def run(area):
    assert area in ['tocho','tokyo-tower']
    repo=ROOT/'data/texture-poc/PLATEAU-SNAP-Server'
    commit=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
    assert commit=='d194f8891eddb965af1894e5cc6b67541ca7f307'
    path=ROOT/f'data/texture-city/msls/snap-surfaces-{area}.json'
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
    out=ROOT/f'data/texture-city/msls/snap-rectified-{area}';out.mkdir(exist_ok=True)
    textures,failures=[],[];surface_diagnostics={}
    for s in record['surfaces']:
        try:
            width,height=s['width'],s['height']
            w=max(16,min(MAX_TEXTURE_DIMENSION,round(width*RGB_PIXELS_PER_METRE)));h=max(16,min(MAX_TEXTURE_DIMENSION,round(height*RGB_PIXELS_PER_METRE)))
            destination=np.asarray([[0,h-1],[w-1,h-1],[w-1,0],[0,0]],np.float32)
            texture=np.zeros((h,w,4),np.uint8);source_index=np.zeros((h,w),np.uint8);mapping_diagnostics=[];source_usage={}
            mappings=_source_mappings(s)
            if len(mappings)>255: raise ValueError('too-many-source-mappings')
            for source_number,mapping in enumerate(mappings,1):
                matrix,transform=_perspective(mapping['imagePoints'],destination)
                warped=cv2.warpPerspective(images[mapping['sourceId']],matrix,(w,h),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
                assert warped.shape==(h,w,4)
                visibility,visibility_record=_load_visibility(mapping)
                visibility=cv2.resize(visibility,(w,h),interpolation=cv2.INTER_NEAREST)
                visibility=cv2.erode(visibility,np.ones((3,3),np.uint8),iterations=1)
                valid=(visibility>=128)&(texture[:,:,3]<128)
                if np.any(valid):
                    texture[valid]=warped[valid];texture[valid,3]=255;source_index[valid]=source_number
                    source_usage[mapping['sourceId']]=int(np.count_nonzero(valid))
                mapping_diagnostics.append({'sourceId':mapping['sourceId'],'transform':transform,'sourceResolution':_source_resolution(s,mapping),'visibilityMaskSha256':visibility_record['sha256']})
            if not np.any(texture[:,:,3]>=128):
                failures.append({'key':s['key'],'reason':'empty-alpha-after-rectification'});continue
            target=out/(s['key']+'.png');assert cv2.imwrite(str(target),texture)
            source_target=out/(s['key']+'.sources.png');assert cv2.imwrite(str(source_target),source_index)
            resolutions=[d['sourceResolution']['areaPixelsPerMetre'] for d in mapping_diagnostics]
            surface_diagnostics[s['key']]={'localTransforms':mapping_diagnostics,'sourceAreaPixelsPerMetreMinimum':min(resolutions),'sourceAreaPixelsPerMetreMedian':float(np.median(resolutions))}
            textures.append({'key':s['key'],'groupKey':s['groupKey'],'sourceIds':[m['sourceId'] for m in mappings],'buildingId':s['buildingId'],'path':str(target.relative_to(ROOT)).replace('\\','/'),
                             'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'size':[w,h],
                             'sourceMap':{'path':str(source_target.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(source_target.read_bytes()).hexdigest(),'indexToSourceId':[None]+[m['sourceId'] for m in mappings]},
                             'sourceUsagePixels':source_usage,'rgbResamplingStages':1,'transforms':mapping_diagnostics,
                             'sourceAreaPixelsPerMetreMinimum':min(resolutions),'sourceAreaPixelsPerMetreMedian':float(np.median(resolutions))})
        except Exception as error:
            failures.append({'key':s['key'],'reason':str(error)})
    groups=[];texture_group_by_surface={}
    valid_keys={t['key'] for t in textures}
    for group_key in sorted({s['groupKey'] for s in record['surfaces'] if s['key'] in valid_keys}):
        logical_surfaces=[s for s in record['surfaces'] if s['groupKey']==group_key and s['key'] in valid_keys]
        for cluster in _plane_clusters(logical_surfaces):
            surfaces=cluster['surfaces'];dominant=max(surfaces,key=lambda s:s['area'])
            normal=np.asarray(dominant['normal'],float);normal/=np.linalg.norm(normal)
            u=np.array([normal[2],0,-normal[0]],float);u/=np.linalg.norm(u)
            all_positions=np.asarray([p for s in surfaces for p in np.asarray(s['positions'],float).reshape(-1,3)],float)
            coord_u=all_positions@u;coord_y=all_positions[:,1]
            lo=[float(coord_u.min()),float(coord_y.min())];hi=[float(coord_u.max()),float(coord_y.max())]
            width,height=hi[0]-lo[0],hi[1]-lo[1]
            ppm=min(RGB_PIXELS_PER_METRE,MAX_TEXTURE_DIMENSION/max(width,1e-6),MAX_TEXTURE_DIMENSION/max(height,1e-6));aw=max(16,round(width*ppm));ah=max(16,round(height*ppm))
            atlas=np.zeros((ah,aw,4),np.uint8);painted=np.zeros((ah,aw),np.uint8);triangle_count=0
            surface_keys=sorted(s['key'] for s in surfaces)
            texture_group_key=f"{group_key}|plane-{hashlib.sha256(','.join(surface_keys).encode('utf-8')).hexdigest()[:8]}"
            group_source_ids=sorted({m['sourceId'] for s in surfaces for m in _source_mappings(s)})
            if len(group_source_ids)>255: raise ValueError('too-many-group-sources')
            group_source_index={source_id:i+1 for i,source_id in enumerate(group_source_ids)};provenance=np.zeros((ah,aw),np.uint8);group_source_usage={source_id:0 for source_id in group_source_ids}
            reference_origin=np.asarray(dominant['positions'],float).reshape(-1,3).mean(axis=0)
            max_plane_deviation=0.;max_normal_angle=0.
            for s in surfaces:
                positions=np.asarray(s['positions'],float).reshape(-1,3);uv=np.asarray(s['uv'],float).reshape(-1,2)
                surface_normal=np.asarray(s['normal'],float);surface_normal/=np.linalg.norm(surface_normal)
                max_plane_deviation=max(max_plane_deviation,float(np.max(np.abs((positions-reference_origin)@normal))))
                max_normal_angle=max(max_normal_angle,float(np.rad2deg(np.arccos(np.clip(np.dot(normal,surface_normal),-1,1)))))
                try:
                    uv_affine,destination,affine_error=_surface_uv_to_atlas(s,u,lo,hi,ppm)
                    surface_filled=np.zeros((ah,aw),bool);atlas_transforms=[]
                    for mapping in _source_mappings(s):
                        matrix,transform=_perspective(mapping['imagePoints'],destination)
                        warped_color=cv2.warpPerspective(images[mapping['sourceId']],matrix,(aw,ah),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
                        visibility,_=_load_visibility(mapping);vh,vw=visibility.shape
                        mask_src=np.asarray([[0,0],[vw-1,0],[0,vh-1]],np.float32)
                        mask_uv=np.asarray([[0,0],[1,0],[0,1]],float);mask_design=np.column_stack((mask_uv,np.ones(3)))
                        mask_dst=np.column_stack((mask_design@uv_affine[0],mask_design@uv_affine[1])).astype(np.float32)
                        mask_affine=cv2.getAffineTransform(mask_src,mask_dst)
                        warped_mask=cv2.warpAffine(visibility,mask_affine,(aw,ah),flags=cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
                        warped_mask=cv2.erode(warped_mask,np.ones((3,3),np.uint8),iterations=1)
                        valid=(warped_mask>=128)&(~surface_filled)
                        if np.any(valid):
                            atlas[valid]=warped_color[valid];atlas[valid,3]=255;painted[valid]=255;surface_filled[valid]=True
                            provenance[valid]=group_source_index[mapping['sourceId']];group_source_usage[mapping['sourceId']]+=int(np.count_nonzero(valid))
                        atlas_transforms.append({'sourceId':mapping['sourceId'],'transform':transform})
                    if not np.any(surface_filled): raise ValueError('empty-alpha-after-direct-atlas-transform')
                    triangle_count+=len(positions)//3
                    surface_diagnostics[s['key']]['atlasTransforms']=[{'sourceId':row['sourceId'],'transform':{**row['transform'],'uvAffineMaxErrorPixels':affine_error,'destinationAtlasSize':[aw,ah]}} for row in atlas_transforms]
                    surface_diagnostics[s['key']]['finalAtlasPixelsPerMetre']=ppm
                    surface_diagnostics[s['key']]['rgbResamplingStages']=1
                    texture_group_by_surface[s['key']]=texture_group_key
                except Exception as error:
                    failures.append({'key':s['key'],'reason':str(error)})
            successful_surface_keys=sorted(s['key'] for s in surfaces if s['key'] in texture_group_by_surface)
            if not successful_surface_keys: continue
            safe=hashlib.sha256(texture_group_key.encode('utf-8')).hexdigest()[:24]
            target=out/(safe+'.atlas.png');assert cv2.imwrite(str(target),atlas)
            provenance_target=out/(safe+'.sources.png');assert cv2.imwrite(str(provenance_target),provenance)
            source_ppm=[surface_diagnostics[key]['sourceAreaPixelsPerMetreMedian'] for key in successful_surface_keys]
            groups.append({'textureGroupKey':texture_group_key,'groupKey':group_key,'buildingId':dominant['buildingId'],'quadrant':dominant['quadrant'],'sourceIds':group_source_ids,'surfaceKeys':successful_surface_keys,'path':str(target.relative_to(ROOT)).replace('\\','/'),
                           'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'size':[aw,ah],'pixelsPerMetre':ppm,'u':u.tolist(),'lo':lo,'hi':hi,'width':width,'height':height,
                           'surfaceCount':len(successful_surface_keys),'triangles':triangle_count,'paintedPixelRatio':float(np.count_nonzero(painted)/(aw*ah)),
                           'maxPlaneDeviationMetres':max_plane_deviation,'maxNormalAngleDegrees':max_normal_angle,'rgbResamplingStages':1,
                           'sourceAreaPixelsPerMetreMinimum':min(source_ppm),'sourceAreaPixelsPerMetreMedian':float(np.median(source_ppm)),'sourceUsagePixels':group_source_usage,
                           'provenanceMap':{'path':str(provenance_target.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(provenance_target.read_bytes()).hexdigest(),'indexToSourceId':[None]+group_source_ids}})
    textures=[{**t,'textureGroupKey':texture_group_by_surface.get(t['key']),'atlasTransforms':surface_diagnostics[t['key']].get('atlasTransforms'),'finalAtlasPixelsPerMetre':surface_diagnostics[t['key']].get('finalAtlasPixelsPerMetre')} for t in textures if t['key'] in texture_group_by_surface]
    report={'areaId':area,'surfaceRecordSha256':hashlib.sha256(source_bytes).hexdigest(),'snapCommit':commit,'textures':textures,'groups':groups,'failures':failures,
            'atlasPolicy':'one logical canvas per building-direction; coplanar physical-plane atlases use ordered per-wall multi-source fallback from locally registered photos without cross-source blending',
            'planeClustering':{'normalToleranceDegrees':PLANE_NORMAL_TOLERANCE_DEGREES,'offsetToleranceMetres':PLANE_OFFSET_TOLERANCE_METRES},
            'visibilityPolicy':'preserve original PLATEAU wall triangles; each locally registered source has a continuous per-wall semantic/border/BVH-occlusion mask; ordered fallback fills only pixels invalid in higher-priority sources, with one conservative final atlas-space erosion per source mask',
            'rgbResamplingPolicy':'prepared source RGB is mapped directly to each final physical-plane atlas with one cubic projective resample per chosen source; sources are selected discretely by validity/priority and never color-blended; wall-local PNGs are independent diagnostics and are never reused as atlas RGB',
            'rgbResamplingStagesToFinalAtlas':1,
            'cornerMappingPolicy':'semantic corners are fixed as bottom-left, bottom-right, top-right, top-left from PLATEAU wall coordinates; no correlation-based axis flip is applied in the final color path'}
    save(out/'report.json',report)
    print(json.dumps({'area':area,'textures':len(textures),'groups':len(groups),'failures':len(failures),'snapCommit':commit}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('area');run(parser.parse_args().area)
