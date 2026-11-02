"""Recover relative cameras from reusable Commons ground photos, never from GPS.

This is an unregistered hypothesis until independent PLATEAU controls validate it.
Images taken with different lenses have separate intrinsics. Native source bytes
are preserved; 35mm-equivalent EXIF is used only to initialize focal length.
"""
import argparse, hashlib, json, math, os, pathlib, shutil, sqlite3, time
import pycolmap
from texture_sfm_quality import audit_sfm

ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(data): return hashlib.sha256(data).hexdigest()
def save(path,data): path.write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf8')
def rational(value):
    if isinstance(value,str) and '/' in value:
        a,b=value.split('/');return float(a)/float(b)
    return float(value)

p=argparse.ArgumentParser()
p.add_argument('--discovery',default='data/texture-city/commons/discovery-tocho.json')
p.add_argument('--ids',nargs='*')
p.add_argument('--max-runtime',type=int,default=600)
p.add_argument('--intrinsics-mode',choices=['refine','fixed'],default='refine')
a=p.parse_args()
assert pycolmap.__version__=='4.2.0'
source=ROOT/'data/texture-city/photos/commons'
control_registration=ROOT/'data/texture-city/commons/control-registration'
discovery=json.loads((ROOT/a.discovery).read_text(encoding='utf8'))
info={str(photo['pageId']):photo for photo in discovery['photos']}
photos=[]
for file in sorted(source.glob('*.json')):
    if not file.stem.isdigit() or (a.ids and file.stem not in a.ids): continue
    meta=json.loads(file.read_text(encoding='utf8'))
    if meta.get('status')!='downloaded': continue
    assert sha(file.with_suffix('.jpg').read_bytes())==meta['sha256']
    md={v['name']:v['value'] for v in info[file.stem]['imageInfo'].get('metadata',[])}
    w,h=meta['downloadSize']
    focal35=rational(md.get('FocalLengthIn35mmFilm',0))
    focal=math.hypot(w,h)*focal35/math.hypot(36,24) if 8<=focal35<=300 else 1.2*max(w,h)
    camera_params=[focal,w/2,h/2,0.0];intrinsics_source='EXIF-35mm-equivalent' if focal35 else 'uncalibrated-default'
    if a.intrinsics_mode=='fixed':
        registration_path=control_registration/f'{file.stem}.json'
        if registration_path.exists():
            registration=json.loads(registration_path.read_text(encoding='utf8'))
            if registration.get('accepted'):
                rw,rh=registration['imageSize'];matrix=registration['cameraMatrix'];model=registration.get('cameraModel','pinhole')
                if model not in ('pinhole','simple-radial'): raise ValueError(f'Unsupported accepted camera model for {file.stem}: {model}')
                sx,sy=w/rw,h/rh
                f=.5*(matrix[0][0]*sx+matrix[1][1]*sy)
                k=registration.get('distortionCoefficients',[0])[0] if model=='simple-radial' else 0.0
                camera_params=[f,matrix[0][2]*sx,matrix[1][2]*sy,k]
                intrinsics_source='accepted-control-registration'
    photos.append({'id':file.stem,'sha256':meta['sha256'],'size':[w,h],'focalPriorPixels':focal,
                   'focal35mm':focal35 or None,'focalPriorSource':'EXIF-35mm-equivalent' if focal35 else 'uncalibrated-default',
                   'cameraParams':camera_params,'intrinsicsSource':intrinsics_source,
                   'sourcePage':meta['sourcePage'],'license':meta['license']})
assert len(photos)>=4
config={'pycolmap':pycolmap.__version__,'cameraModel':'SIMPLE_RADIAL','maxFeatures':16384,'maxImageSize':2400,
        'threads':8,'seed':0,'guidedMatching':True,'useGpsPrior':False,'maxRuntimeSeconds':a.max_runtime,
        'intrinsicsMode':a.intrinsics_mode}
key=sha(json.dumps({'photos':photos,'config':config},sort_keys=True).encode())[:20]
work=ROOT/f'data/texture-city/commons/sfm/daylight-{key}'
images=work/'images';images.mkdir(parents=True,exist_ok=True)
save(work/'inputs.json',{'config':config,'photos':photos,'note':'Unregistered relative reconstruction only; do not count as wall evidence.'})
if (work/'result.json').exists():
    cached=json.loads((work/'result.json').read_text(encoding='utf8'))
    audit=audit_sfm(cached);save(work/'intrinsics-audit.json',audit)
    print(json.dumps({'work':str(work),'status':audit['status'],'registeredImages':cached['registeredImages'],'cached':True}));raise SystemExit(0)
db=work/'database.db'
execution={'pid':os.getpid(),'startedAt':time.time(),'matchingThreads':2,'matchingBlockSize':8,'stage':'features'}
save(work/'execution.json',execution)
extraction=pycolmap.FeatureExtractionOptions(max_image_size=config['maxImageSize'],num_threads=8,use_gpu=False)
extraction.sift.max_num_features=config['maxFeatures']
for photo in photos:
    name=photo['id']+'.jpg';dest=images/name
    if dest.exists(): assert sha(dest.read_bytes())==photo['sha256']
    else: shutil.copyfile(source/name,dest)
    if db.exists():
        with sqlite3.connect(db) as database:
            cached=database.execute('SELECT keypoints.rows FROM images JOIN keypoints USING(image_id) WHERE images.name=?',(name,)).fetchone()
        if cached and cached[0]>0: continue
    reader=pycolmap.ImageReaderOptions(camera_model='SIMPLE_RADIAL',camera_params=','.join(map(str,photo['cameraParams'])))
    print(json.dumps({'stage':'features','id':photo['id'],'work':str(work)}),flush=True)
    pycolmap.extract_features(db,images,image_names=[name],camera_mode=pycolmap.CameraMode.PER_IMAGE,
                              reader_options=reader,extraction_options=extraction,device=pycolmap.Device.cpu)
matching=pycolmap.FeatureMatchingOptions(num_threads=execution['matchingThreads'],use_gpu=False,guided_matching=True)
execution['stage']='matching';save(work/'execution.json',execution)
print(json.dumps({'stage':'matching','images':len(photos)}),flush=True)
pycolmap.match_exhaustive(db,matching_options=matching,pairing_options=pycolmap.ExhaustivePairingOptions(block_size=execution['matchingBlockSize']),device=pycolmap.Device.cpu)
with sqlite3.connect(db) as database:
    pairs=database.execute('SELECT pair_id,rows,config FROM two_view_geometries WHERE rows>=15 ORDER BY rows DESC').fetchall()
    feature_counts=database.execute('SELECT images.name,keypoints.rows FROM keypoints JOIN images USING(image_id)').fetchall()
save(work/'matching.json',{'featureCounts':feature_counts,'verifiedPairs':pairs})
attempt=work/('sparse-'+time.strftime('%Y%m%d-%H%M%S'));attempt.mkdir()
options=pycolmap.IncrementalPipelineOptions(num_threads=8,random_seed=0,max_runtime_seconds=a.max_runtime)
options.mapper.num_threads=8;options.mapper.random_seed=0
if a.intrinsics_mode=='fixed':
    options.ba_refine_focal_length=False
    options.ba_refine_principal_point=False
    options.ba_refine_extra_params=False
print(json.dumps({'stage':'mapping','output':str(attempt)}),flush=True)
execution['stage']='mapping';save(work/'execution.json',execution)
models=pycolmap.incremental_mapping(db,images,attempt,options=options)
summaries=[];registered=set()
for mid,model in models.items():
    records=[]
    for image_id in model.reg_image_ids():
        image=model.images[image_id];identity=pathlib.Path(image.name).stem;registered.add(identity)
        records.append({'id':identity,'imageId':image_id,'name':image.name,'cameraId':image.camera_id,
                        'relativeCenter':image.projection_center().tolist(),'camFromWorld':image.cam_from_world().matrix().tolist()})
    cameras=[{'id':c.camera_id,'model':c.model_name,'width':c.width,'height':c.height,'params':c.params.tolist()} for c in model.cameras.values()]
    row={'modelId':mid,'registeredImages':len(records),'points3D':model.num_points3D(),
         'meanReprojectionError':model.compute_mean_reprojection_error(),'cameras':cameras,'images':records}
    save(attempt/f'model-{mid}-cameras.json',row)
    summaries.append(row)
result={'key':key,'work':str(work.relative_to(ROOT)),'output':str(attempt.relative_to(ROOT)),
        'inputImages':len(photos),'registeredImages':len(registered),'unregisteredIds':[p['id'] for p in photos if p['id'] not in registered],
        'models':summaries,'applied':False,'georegistered':False,'status':'relative-reconstruction-unverified' if models else 'no-reconstruction'}
save(work/'result.json',result)
save(work/'intrinsics-audit.json',audit_sfm(result))
execution['stage']='finished';execution['finishedAt']=time.time();save(work/'execution.json',execution)
print(json.dumps(result),flush=True)
