import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const input='data/texture-city/tocho-district-photo-v2-20261018';
const assetDir='public/assets/tocho-district-photo-v3-20261018';
const sourceDir=assetDir+'/sources';
// Run explicitly only after main declares the v3 profiles ready. No collection or v2 writes.
const absolute=p=>path.join(root,p);
const load=async p=>JSON.parse(await fs.readFile(absolute(p),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function write(p,b){const rel=path.relative(absolute(sourceDir),absolute(p));assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Write outside owned v3 sources subtree');await fs.mkdir(path.dirname(absolute(p)),{recursive:true});await fs.writeFile(absolute(p),b);}
const scope=await load('data/texture-city/tocho-district-illustrated-20261018/scope.json');
const native=await load(input+'/native-photo-sources.json');
assert.equal(scope.selectedBuildingIds.length,83);assert.deepEqual(native.frozen83SelectedBuildingIds,scope.selectedBuildingIds);
const profilePath=assetDir+'/photo-profiles.json';
const profileBytes=await fs.readFile(absolute(profilePath)),profiles=JSON.parse(profileBytes);
assert(Array.isArray(profiles.buildings));assert.equal(profiles.buildings.length,83);
assert.deepEqual([...profiles.buildings.map(p=>p.buildingId)].sort(),[...scope.selectedBuildingIds].sort());
if(profiles.selectedBuildingIds)assert.deepEqual([...profiles.selectedBuildingIds].sort(),[...scope.selectedBuildingIds].sort());
const baselinePath='public/assets/tocho-district-photo-v2-20261018/photo-profiles.json',baselineBytes=await fs.readFile(absolute(baselinePath));
const baseline=JSON.parse(baselineBytes),baselineById=new Map(baseline.buildings.map(p=>[p.buildingId,p]));
const roofPath=input+'/own-roof-materials.json',roofBytes=await fs.readFile(absolute(roofPath)),roofInput=JSON.parse(roofBytes);
const roofById=new Map(roofInput.buildings.map(p=>[p.buildingId,p]));
const semantics=(await load('data/texture-city/tocho-district-illustrated-20261018/semantics.json')).polygons;
const geometry=new Map();for(const f of scope.geometryFiles)for(const b of (await load(f)).buildings)if(scope.selectedBuildingIds.includes(b.id))geometry.set(b.id,b);
const photos=[],streetBuildings=new Map(),manifests=[];
const plain=v=>String(v??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const safeLocal=p=>{if(typeof p!=='string'||!p)return null;const f=path.resolve(root,p),rel=path.relative(root,f);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel)?f:null;};
async function thumb(p,name,width=420,height=300){const file=safeLocal(p);if(!file)return null;try{const bytes=await sharp(file).rotate().resize(width,height,{fit:'inside',withoutEnlargement:true}).flatten({background:'#747c82'}).jpeg({quality:73,mozjpeg:true}).toBuffer();await write(sourceDir+'/'+name,bytes);return {url:name,bytes:bytes.length,sourcePath:p,sourceSha256:hash(await fs.readFile(file))};}catch{return null;}}
for(const kind of ['landmark','park']){
 const file=input+'/'+kind+'-sources.json';let d;try{d=await load(file);}catch(e){if(e.code!=='ENOENT')throw e;manifests.push({file,status:'PENDING'});continue;}
 manifests.push({file,status:d.status??'AVAILABLE',sha256:hash(await fs.readFile(absolute(file)))});
 for(const b of d.buildings??[])streetBuildings.set(b.buildingId,{...(streetBuildings.get(b.buildingId)??{}),...b});
 for(const [i,p] of (d.photos??[]).entries()){
  const key=kind+'-'+(p.key??p.id??i),verifiedIds=p.buildingIds??[],candidateIds=p.candidateBuildingIds??[];
  const inspected=p.visualInspection?.inspected===true||!!p.inspectionStatus;
  const eligible=p.facadeConditioningEligible===true||(p.visualInspection?.inspected===true&&p.visualInspection?.usefulFacade===true&&p.visualInspection?.daylight===true&&p.visualInspection?.exterior===true);
  photos.push({key,manifest:file,buildingIds:verifiedIds.filter(id=>scope.selectedBuildingIds.includes(id)),candidateBuildingIds:candidateIds.filter(id=>scope.selectedBuildingIds.includes(id)),thumb:await thumb(p.localPath??p.path,'street-'+key.replace(/[^a-zA-Z0-9_-]/g,'_')+'.jpg',640,420),sourcePath:p.localPath??p.path??null,pageURL:p.pageURL??p.sourcePage??null,originalURL:p.originalURL??p.originalUrl??null,author:plain(p.authorText??p.author??p.authorHtml)||'未記載',credit:plain(p.credit),license:typeof p.license==='object'?p.license.name:p.license??'未記載',licenseURL:typeof p.license==='object'?p.license.url:p.licenseURL??null,originalResolution:p.originalResolution??null,reviewedResolution:p.resolution??null,upscaled:p.upscaled??null,inspected,eligible,mappingStatus:p.mappingStatus??(verifiedIds.length?'MANIFEST_ASSIGNED':'UNASSIGNED'),description:p.visualInspection?.observations??p.sourceDescription??null,mappingEvidence:p.mappingEvidence??null,observedMaterials:p.observableMaterials??null,rectificationStatus:p.rectificationStatus??'No camera registration/projection certified'});
 }
}
// Prefer the later building-specific identity review over preliminary photo notes.
for(const photo of photos){
 const localId=photo.key.replace(/^park-/,'');
 const current=[...streetBuildings.values()].find(b=>b.mappingEvidence?.status==='verified'&&(b.materialConditioning?.photoIds??[]).includes(localId));
 if(current){
  photo.mappingEvidence={currentBuildingReview:current.mappingEvidence,preliminaryPhotoReview:photo.mappingEvidence,preliminaryDescription:photo.description};
  photo.description=current.materialConditioning.observations?.facade??photo.description;
 }
}
const records=[];
for(const [i,id] of scope.selectedBuildingIds.entries()){
 const b=native.buildings.find(b=>b.buildingId===id),g=geometry.get(id),street=streetBuildings.get(id),walls=[];
 for(const w of b?.walls??[]){const thumbnail=await thumb(w.file,id+'--wall-'+w.wallIndex+'.jpg');walls.push({wallIndex:w.wallIndex,thumb:thumbnail,sourcePath:w.file,sourceImagePath:w.sourceImagePath,sourceImageURI:w.sourceImageURI,sourceGML:w.sourceGML,sourceGMLPolygon:w.sourceGMLPolygon,effectiveUVpixels:w.effectiveUVpixels,uniqueSourcePixelsActuallySampled:w.uniqueSourcePixelsActuallySampled,effectivePixelFootprint:w.effectivePixelFootprint,rasterDims:w.rasterDims,quality:w.quality,readability:w.readability??null,occlusion:w.occlusion??null,facadeDetailsObserved:w.facadeDetailsObserved===true,windowAllowed:w.windowAllowed===true,windowAllowedReason:w.windowAllowedReason,windowAllowedScope:w.windowAllowedScope??null,minmaxHeight:w.minmaxHeight,analysis:w.analysis??null});}
 const assigned=photos.filter(p=>p.buildingIds.includes(id)),candidates=photos.filter(p=>p.candidateBuildingIds.includes(id));
 const observedNative=walls.some(w=>w.facadeDetailsObserved),observedStreet=assigned.some(p=>p.inspected&&p.eligible);
 records.push({order:i+1,buildingId:id,name:g?.name||b?.name||street?.nativeName||street?.sourceName||street?.name||null,isCentral:id===scope.centralBuildingId,nativeStatus:b?'AVAILABLE':'NOT_IN_NEIGHBOR_NATIVE_EXTRACTION',quality:b?.quality??'NOT_ASSESSED',evidenceStatus:observedNative||observedStreet?'observed':'pending',evidenceMeaning:observedNative||observedStreet?'Some localized appearance evidence is recorded; no full facade/whole-building certification.':'Facade appearance is unconfirmed; original atlas assignment alone is not an observation.',observedNative,observedStreet,wallCount:b?.wallCount??g?.walls?.length??0,uncoveredWallCount:b?.uncoveredWalls?.length??null,walls,streetPhotoKeys:assigned.map(p=>p.key),candidatePhotoKeys:candidates.map(p=>p.key),streetMappingStatus:street?.mappingStatus??null,gaps:street?.gaps??[],artworkPath:'../artwork/'+id+'.png'});
}
const displayNames={
 'bldg_97587988-3e50-452d-a887-1e6411aca704':'SHUKNOVA',
 'bldg_7e9c0c6b-e707-43eb-8ead-ba50333f188b':'新宿中央公園 エコギャラリー新宿',
 'bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21':'ハイアット リージェンシー 東京',
 'bldg_89e585dc-50ee-485f-bed1-ce0101523b1e':'新宿第一生命ビルディング'
};
for(const b of records)b.name=profiles?.buildings.find(p=>p.buildingId===b.buildingId)?.name||displayNames[b.buildingId]||b.name;
const profileCounts={},artworkChecks=[];
const sourcePath=s=>typeof s==='string'?s:s?.path??s?.localPath??s?.sourcePath??s?.file??null;
const effectiveStatus=p=>p.evidenceStatus==='insufficient'&&p.artwork?'source-limited-inference':p.evidenceStatus;
const isRoofOnly=(p,detail,file,roofSources)=>detail.roofOnly===true||/roof|屋根/i.test([detail.surfaceRole,detail.surfaceType,detail.surface,detail.kind,detail.scope,detail.evidenceScope,detail.role].filter(Boolean).join(' '))||roofSources.includes(safeLocal(file))||/own-roof-inputs|RoofSurfaceTexture/i.test(file)||(!!p.sourcePolygon&&semantics[p.sourcePolygon]?.type==='RoofSurface');
const statuses=['street-photo','native-photo-pattern','native-photo-inference','source-limited-inference','photo-inferred','insufficient','approved-central'];
function creditForSource(source,detail={}){
 const photo=photos.find(p=>safeLocal(p.sourcePath)===safeLocal(source)&&safeLocal(source));
 const license=detail.license;
 return {pageURL:detail.pageURL??detail.pageUrl??detail.pageurl??detail.sourcePage??detail.page_url??photo?.pageURL??null,
  author:plain(detail.authorText??detail.author??detail.authorHtml??photo?.author)||'未記載',
  license:plain(typeof license==='object'?license?.name:license??photo?.license)||'未記載',
  licenseURL:detail.licenseURL??detail.licenseUrl??(typeof license==='object'?license?.url:null)??photo?.licenseURL??null,
  originalURL:detail.originalURL??detail.originalUrl??photo?.originalURL??null};
}
for(const b of records){
 const p=profiles.buildings.find(p=>p.buildingId===b.buildingId),old=baselineById.get(b.buildingId),roof=roofById.get(b.buildingId);
 assert(statuses.includes(p.evidenceStatus),'Unknown evidence status: '+p.evidenceStatus);
 b.baselineEvidenceStatus=old?.evidenceStatus??null;b.originalProfile=structuredClone(p);b.profile=structuredClone(p);
 b.profile.sourceEvidenceStatus=p.evidenceStatus;b.profile.evidenceStatus=effectiveStatus(p);
 b.profile.photoCoverageCertified=false;b.profileEvidenceStatus=effectiveStatus(p);
 profileCounts[b.profileEvidenceStatus]=(profileCounts[b.profileEvidenceStatus]??0)+1;
 b.evidenceStatus=['native-photo-inference','source-limited-inference','photo-inferred'].includes(b.profileEvidenceStatus)?'inferred':b.profileEvidenceStatus==='insufficient'?'pending':'observed';
 b.evidenceMeaning=b.evidenceStatus==='inferred'?'同じ建物の色・素材を手掛かりにした許可済みの推論です。壁の窓・未観測面・全面の写真一致は未検証です。':b.evidenceStatus==='pending'?'写真の根拠は不足しています。未確認という状態を保持します。':b.isCentral?'既存の中央棟資料。未観測面の推論を含み、全面写真認証ではありません。':'局所の写真観察と生成材の推論を記録しています。建物全面の写真認証ではありません。';
 b.sourceEvidenceInsufficient=p.evidenceStatus==='insufficient';b.photoCoverageCertified=false;
 b.conditioningPhotos=[];
 const details=Array.isArray(p.sourcePhotoDetails)?p.sourcePhotoDetails:[];
 const sources=[...(p.sourcePaths??[])];
 for(const d of details)if(sourcePath(d)&&!sources.some(s=>safeLocal(sourcePath(s))===safeLocal(sourcePath(d))))sources.push(d);
 const roofSources=[sourcePath(roof?.photo),sourcePath(roof?.source),...(p.roofSourcePaths??[]).map(sourcePath),sourcePath(p.roofEvidence?.photo)].map(safeLocal).filter(Boolean);
 for(const [i,s]of sources.entries()){
  const file=sourcePath(s);assert(file,'Source path required');
  const detail=details.find(d=>sourcePath(d)&&safeLocal(sourcePath(d))===safeLocal(file))??(!sourcePath(details[i])?details[i]:null)??(typeof s==='object'?s:{});
  const roofOnly=isRoofOnly(p,detail,file,roofSources);
  const thumbnail=await thumb(file,b.buildingId+'--conditioning-'+(i+1)+'.jpg',500,360),local=safeLocal(file);
  let sha256=null;try{if(local)sha256=hash(await fs.readFile(local));}catch(e){if(e.code!=='ENOENT')throw e;}
  const claimed=detail.sha256??(typeof s==='object'?s.sha256:null);if(claimed&&sha256)assert.equal(sha256,claimed,'Input photo SHA changed: '+file);
  b.conditioningPhotos.push({sourcePath:file,thumb:thumbnail,sourceSha256:sha256,availability:sha256?'AVAILABLE':'UNAVAILABLE',kind:'REAL_PHOTO_CONDITIONING_SOURCE',roofOnly,wallWindowsProven:false,
   limitation:roofOnly?'屋根だけの資料です。同じ建物の色・素材の推論には利用できますが、壁の窓・配置の証明にはなりません。':'入力写真の局所情報です。窓配置・未観測面・全面被覆の証明ではありません。',...creditForSource(file,detail),sourcePhotoDetails:detail});
 }
 const r=p.roofEvidence??(roof?{photo:roof.photo,source:roof.source,polygonId:roof.polygonId,review:roof.visualReview,observed:roof.materialConditioning?.roof}:old?.roofEvidence);
 if(r){if(r.review?.buildingId)assert.equal(r.review.buildingId,b.buildingId,'Roof review belongs to another building');if(r.polygonId)assert(geometry.get(b.buildingId)?.polygons.some(p=>p.id===r.polygonId),'Roof polygon belongs to another building');const t=await thumb(r.photo?.path,b.buildingId+'--roof.jpg',320,240);if(t&&r.photo?.sha256)assert.equal(t.sourceSha256,r.photo.sha256);b.roofRecord={thumb:t,sourcePath:r.photo?.path,sourceSha256:r.photo?.sha256??null,polygonId:r.polygonId,source:r.source,review:r.review??null,observed:r.observed??null,color:p.roofColor??old?.roofColor??null,colorBasis:p.roofColorBasis??old?.roofColorBasis??null,colorUsable:r.review?.roofColorUsable===true,roofOnly:true,wallWindowsProven:false};}
 b.artworkPath=null;b.artworkStatus='NOT_PROVIDED';
 if(p.artwork){
  const file=assetDir+'/'+p.artwork,local=safeLocal(file),rel=local&&path.relative(absolute(assetDir),local);assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Artwork must remain in v3 assets');
  const bytes=await fs.readFile(local),sha256=hash(bytes);if(p.artworkSha256)assert.equal(sha256,p.artworkSha256);
  b.artworkPath='../'+p.artwork;b.artworkStatus='READY';b.generatedMaterialIsPhotoEvidence=false;
  artworkChecks.push({buildingId:b.buildingId,file,sha256,bytes:bytes.length});
 }else if(b.isCentral){const preview=await thumb((p.sourcePaths??[]).map(sourcePath).find(s=>s?.endsWith('.png')),'approved-central-material.jpg',420,420);if(preview){b.artworkPath=preview.url;b.artworkStatus='APPROVED_EXISTING_MATERIAL_PREVIEW';}}
}
const central=records.find(b=>b.isCentral),centralSource='data/texture-city/checkpoint-recovery/source-145064071.jpg';
assert(central,'Central building missing');
const centralThumb=await thumb(centralSource,'central-original-145064071.jpg',640,480);
central.conditioningPhotos.push({sourcePath:centralSource,thumb:centralThumb,sourceSha256:centralThumb?.sourceSha256??null,kind:'EXISTING_MATCHED_REAL_PHOTO',label:'既存の対応済み実写真 / 今回の新規収集ではありません',pageURL:'https://commons.wikimedia.org/?curid=145064071',author:'Syced',license:'CC0',licenseURL:'https://creativecommons.org/publicdomain/zero/1.0/',roofOnly:false,wallWindowsProven:false});
// Applied counts require a current successful build/verification, separately from source quality.
let application={status:'NOT_VERIFIED',appliedBuildingIds:[],appliedBuildingCount:null,allSelectedBuildingsApplied:false,fullBuildingPhotoVerificationClaim:false};
try{
 const reportPath='data/texture-city/tocho-district-photo-v3-20261018/build-report.json',verificationPath='data/texture-city/tocho-district-photo-v3-20261018/verification.json';
 const report=await load(reportPath),verification=await load(verificationPath),manifest=await load(assetDir+'/manifest.json');
 const [reportStat,verificationStat]=await Promise.all([fs.stat(absolute(reportPath)),fs.stat(absolute(verificationPath))]);
 assert(verification.passed&&verification.allSelectedBuildingsPresent&&verification.allNativeTrianglesPresentExactlyOnce&&verificationStat.mtimeMs>=reportStat.mtimeMs,'Current verification required');
 assert.equal(report.profileSha256,hash(profileBytes));assert.equal(manifest.profileSha256,hash(profileBytes));
 assert.equal(report.sha256,hash(await fs.readFile(absolute(assetDir+'/district.glb'))));
 const applied=new Set(report.polygons.filter(f=>f.textured).map(f=>f.buildingId));
 const configured=profiles.centralAsset??manifest.centralAsset??manifest.centralApprovedAsset;
 assert(configured&&safeLocal(configured.path));assert.equal(hash(await fs.readFile(safeLocal(configured.path))),configured.sha256);
 assert.deepEqual(configured,manifest.centralAsset??manifest.centralApprovedAsset);
 if(manifest.buildings.some(b=>b.id===central.buildingId))applied.add(central.buildingId);
 assert([...applied].every(id=>scope.selectedBuildingIds.includes(id)));
 application={status:'VERIFIED_BUILD_REPORT',appliedBuildingIds:[...applied],appliedBuildingCount:applied.size,allSelectedBuildingsApplied:applied.size===scope.selectedBuildingIds.length,fullBuildingPhotoVerificationClaim:false};
}catch(e){application.reason=e.code==='ENOENT'?'Build or verification not available':e.message;}
for(const b of records)b.applicationStatus=application.appliedBuildingIds.includes(b.buildingId)?'APPLIED_IN_VERIFIED_BUILD':'NOT_VERIFIED';
const baselineCounts=Object.fromEntries(['street-photo','native-photo-pattern'].map(s=>[s,baseline.buildings.filter(p=>p.evidenceStatus===s).length]));
const summary={frozenBuildings:records.length,profileBuildings:profiles.buildings.length,nativeBuildings:records.filter(b=>b.walls.length).length,nativeThumbnails:records.reduce((n,b)=>n+b.walls.filter(w=>w.thumb).length,0),localizedEvidenceBuildings:records.filter(b=>b.observedNative||b.observedStreet).length,pendingBuildings:records.filter(b=>b.evidenceStatus==='pending').length,inferredBuildings:records.filter(b=>b.evidenceStatus==='inferred').length,streetPhotos:photos.length,profileCounts,baselineCounts,newArtworkReady:artworkChecks.length,appliedBuildingCount:application.appliedBuildingCount,allSelectedBuildingsApplied:application.allSelectedBuildingsApplied,roofOnlyInputPhotos:records.reduce((n,b)=>n+b.conditioningPhotos.filter(p=>p.roofOnly).length,0),conditioningPhotoThumbnails:records.reduce((n,b)=>n+b.conditioningPhotos.filter(p=>p.thumb).length,0),reviewedRoofColors:records.filter(b=>b.roofRecord?.colorUsable).length,fullBuildingPhotoVerificationClaim:false};
// Supplemental collection stays separate from profiles, conditioning sources and coverage.
// Pure reconciliation also permits an immediate withdrawal correction without a profile refresh.
function applyIdentityReview(data,input,source){
 const normalized=p=>typeof p==='string'?p.replaceAll('\\','/').toLowerCase():null;
 const withdrawn=input.withdrawnClaims??[];
 for(const w of withdrawn){
  const b=data.buildings.find(b=>b.buildingId===w.buildingId);if(!b)continue;
  const note='旧管理事務所との同一視は撤回されました。native形状の施設同定は未解決です。別の施設名も付けていません。';
  b.identityWithdrawals=[{claim:w.claim,status:'WITHDRAWN',note,reason:w.reason}];b.facilityIdentityStatus='unresolved';
  if(/管理事務所|management.office/i.test(b.name??''))b.name=null;
  for(const photo of data.photos){if(/management/i.test(photo.key)&&((photo.candidateBuildingIds??[]).includes(b.buildingId)||(photo.buildingIds??[]).includes(b.buildingId))){
   photo.candidateBuildingIds=(photo.candidateBuildingIds??[]).filter(id=>id!==b.buildingId);photo.buildingIds=(photo.buildingIds??[]).filter(id=>id!==b.buildingId);
   photo.withdrawnCandidateBuildingIds=[...new Set([...(photo.withdrawnCandidateBuildingIds??[]),b.buildingId])];photo.identityClaimStatus='WITHDRAWN';photo.withdrawalNote=note;
   b.candidatePhotoKeys=b.candidatePhotoKeys.filter(k=>k!==photo.key);b.streetPhotoKeys=b.streetPhotoKeys.filter(k=>k!==photo.key);
  }}
  for(const group of data.additionalGround?.groups??[])if(/management|管理事務所/i.test(group.subject??''))group.candidateBuildingIds=group.candidateBuildingIds.filter(id=>id!==b.buildingId);
 }
 const matches=(input.matches??[]).filter(m=>m.status==='visual-identity-supported'&&!withdrawn.some(w=>w.buildingId===m.buildingId)).map(m=>{
  const b=data.buildings.find(b=>b.buildingId===m.buildingId);const paths=new Set((m.photoPaths??[]).map(normalized)),hashes=new Set((m.photos??[]).map(p=>p.sha256).filter(Boolean));
  const used=!!b&&(b.conditioningPhotos??[]).some(p=>paths.has(normalized(p.sourcePath))||hashes.has(p.sourceSha256??p.thumb?.sourceSha256));
  const result={...structuredClone(m),generationInputUsed:used,photoOrigin:m.newGroundPhotoMatch?'NEW_GROUND_PHOTOS':'REMAPPED_EXISTING_GROUND_PHOTO',perFaceCertificationClaim:m.projectionCertified===true};
  if(b){b.identitySupport=result;b.facilityIdentityStatus='visual-identity-supported';}
  return result;
 });
 const review={source,visualIdentityCount:matches.length,projectionCertifiedCount:matches.filter(m=>m.projectionCertified===true).length,newGroundIdentityCount:matches.filter(m=>m.newGroundPhotoMatch).length,remappedExistingIdentityCount:matches.filter(m=>!m.newGroundPhotoMatch).length,generationInputUsedCount:matches.filter(m=>m.generationInputUsed).length,matches,withdrawnClaims:withdrawn};
 data.identityReview=review;
 if(data.additionalGround){data.additionalGround.identityReview=review;data.additionalGround.generationInput=matches.some(m=>m.generationInputUsed);for(const p of data.additionalGround.photos??[]){p.usedByProfileBuildingIds=matches.filter(m=>m.generationInputUsed&&(m.photoPaths??[]).some(file=>normalized(file)===normalized(p.sourcePath))).map(m=>m.buildingId);p.generationInput=p.usedByProfileBuildingIds.length>0;p.visualIdentityBuildingIds=matches.filter(m=>(m.photoPaths??[]).some(file=>normalized(file)===normalized(p.sourcePath))).map(m=>m.buildingId);}
 for(const group of data.additionalGround.groups??[]){group.visualIdentityBuildingIds=matches.filter(m=>(data.additionalGround.photos??[]).some(p=>group.photoKeys.includes(p.key)&&(m.photoPaths??[]).some(file=>normalized(file)===normalized(p.sourcePath)))).map(m=>m.buildingId);group.generationInput=matches.some(m=>m.generationInputUsed&&group.visualIdentityBuildingIds.includes(m.buildingId));}}
 return data;
}
// End pure identity reconciliation.
const groundPath='data/texture-city/tocho-district-photo-v3-20261018/additional-ground/results.json';
let additionalGround={available:false,generationInput:false,certified:false,groups:[],photos:[]};
try{
 const bytes=await fs.readFile(absolute(groundPath)),collection=JSON.parse(bytes);
 const all=[...(collection.photos??[]),...(collection.officialPageAssets??[])];
 const groupedPhotos=(collection.candidates??[]).flatMap(c=>c.photos??[]);
 const byPath=new Map();
 for(const p of [...all,...groupedPhotos]){const file=sourcePath(p);if(file)byPath.set(file,{...(byPath.get(file)??{}),...p});}
 const groundPhotos=[];
 for(const [i,[file,p]]of [...byPath].entries()){
  const local=safeLocal(file);let actualHash=null;try{if(local)actualHash=hash(await fs.readFile(local));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(p.sha256&&actualHash)assert.equal(actualHash,p.sha256,'Additional ground photo changed: '+file);
  groundPhotos.push({key:'ground-'+(i+1),title:plain(p.title??p.subject??p.id??'追加写真'),sourcePath:file,sourceSha256:actualHash,availability:actualHash?'AVAILABLE':'UNAVAILABLE',status:p.status??'reference-only-unmapped',isActualGroundPhoto:p.isActualGroundPhoto??null,description:plain(p.description),...creditForSource(file,{...p,pageURL:p.sourceURL??p.pageURL,originalURL:p.originalURL??p.photoURL}),generationInput:false,certified:false,assignedBuildingIds:[],thumb:null});
 }
 const groups=[];let thumbnailCount=0;
 for(const [i,c]of (collection.candidates??[]).entries()){
  const keys=(c.photos??[]).map(p=>groundPhotos.find(g=>g.sourcePath===sourcePath(p))?.key).filter(Boolean);
  // Collector-selected representative only: at most one thumbnail per group, five total.
  const representative=groundPhotos.find(p=>keys.includes(p.key)&&p.availability==='AVAILABLE');
  if(representative&&thumbnailCount<5){representative.thumb=await thumb(representative.sourcePath,'additional-ground-candidate-'+(i+1)+'.jpg',520,360);if(representative.thumb)thumbnailCount++;}
  groups.push({key:'ground-candidate-'+(i+1),subject:c.subject,status:'CANDIDATE_UNASSIGNED',candidateBuildingIds:c.candidateBuildingIds??[],photoKeys:keys,observedMaterial:c.observedMaterial??null,evidence:c.evidence??[],limits:c.limits??[],nextCheck:c.nextCheck??null,generationInput:false,certified:false});
 }
 const statusCounts={};for(const p of groundPhotos)statusCounts[p.status]=(statusCounts[p.status]??0)+1;
 additionalGround={available:true,file:groundPath,publicIndex:'additional-ground.json',sha256:hash(bytes),generatedAt:collection.generatedAt,status:collection.status,collectorCounts:collection.counts??{},exactMatchesReported:collection.verifiedMatches?.length??collection.counts?.verifiedMatches??0,statusCounts,photoCount:groundPhotos.length,thumbnailCount,groups,photos:groundPhotos,buildingStatuses:(collection.buildings??[]).map(b=>({buildingId:b.buildingId,status:b.status,groundFacadeProof:b.groundFacadeProof===true})),referenceDocuments:collection.referenceDocuments??[],limits:collection.limits??[],generationInput:false,certified:false};

}catch(e){if(e.code!=='ENOENT')throw e;}
summary.additionalGroundPhotos=additionalGround.collectorCounts?.commonsActualGroundPhotos??0;
summary.additionalGroundExactMatches=additionalGround.exactMatchesReported??0;
const data={schemaVersion:3,generatedAt:new Date().toISOString(),scopePath:'data/texture-city/tocho-district-illustrated-20261018/scope.json',nativeManifest:input+'/native-photo-sources.json',nativeManifestSha256:hash(await fs.readFile(absolute(input+'/native-photo-sources.json'))),profileManifest:{file:profilePath,sha256:hash(profileBytes),counts:profileCounts},baselineManifest:{file:baselinePath,sha256:hash(baselineBytes),counts:baselineCounts},roofManifest:{file:roofPath,sha256:hash(roofBytes)},frozenBuildingIds:scope.selectedBuildingIds,summary,application,additionalGround,manifests,buildings:records,photos,artworkChecks,viewerPath:'/tocho-district-photo-v3-review-20261018.html',notes:['Same-building color/material inference is authorized; generated material is not photographic evidence.','Roof-only input cannot prove wall windows. Source SHA lineage is not full photo certification.','Insufficient source evidence remains disclosed even if its generated material is displayed as source-limited-inference.','V2 native, street, landmark and roof inputs are read-only; current profile status and historic baseline counts are distinct.']};
const identityPath='data/texture-city/tocho-district-photo-v3-20261018/additional-ground/identity-matches.json';
try{const bytes=await fs.readFile(absolute(identityPath));applyIdentityReview(data,JSON.parse(bytes),{file:identityPath,sha256:hash(bytes)});await write(sourceDir+'/identity-review.json',JSON.stringify(data.identityReview,null,2)+'\n');}catch(e){if(e.code!=='ENOENT')throw e;}
if(additionalGround.available)await write(sourceDir+'/additional-ground.json',JSON.stringify(additionalGround,null,2)+'\n');
await write(sourceDir+'/data.json',JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({profileCounts,baselineCounts,generatedMaterials:artworkChecks.length,appliedBuildingCount:application.appliedBuildingCount,allSelectedBuildingsApplied:application.allSelectedBuildingsApplied,allPhotoCertified:false}));
