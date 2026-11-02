import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';

const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'data/texture-city/tocho-district-photo-v2-20261018');
const dir=path.join(base,'landmark-photos');
await fs.mkdir(dir,{recursive:true});
const categories=['Shinjuku Sumitomo Building','Shinjuku NS Building','Tokyo Metropolitan Government Building No.2 (1991)','Hyatt Regency Tokyo','Odakyu Dai-ichi Seimei Building','Tokyo Metropolitan Assembly Building (1991)'];
async function api(params){
 const u=new URL('https://commons.wikimedia.org/w/api.php');
 for(const [k,v] of Object.entries({action:'query',format:'json',...params}))u.searchParams.set(k,v);
 const r=await request(u);
 if(!r.ok)throw Error(`API ${r.status}`);const j=await r.json();if(j.error)throw Error(JSON.stringify(j.error));return j;
}
async function request(u){
 for(let attempt=0;attempt<5;attempt++){
  const r=await fetch(u,{headers:{'User-Agent':'OpenGraffitiPhotoResearch/1.0 (source attribution collection)'},signal:AbortSignal.timeout(90000)});
  if(r.status!==429&&r.status!==503)return r;
  if(attempt===4)return r;
  const seconds=Math.max(10*(attempt+1),Number(r.headers.get('retry-after'))||0);
  if(seconds>60)throw Error(`Server requests ${seconds}s cooldown; stop this download and reuse verified local source when available.`);
  console.log(`Rate limit; waiting ${seconds}s`);await new Promise(resolve=>setTimeout(resolve,seconds*1000));
 }
}
const mode=process.argv[2]??'discover';
if(mode==='discover'){
 const all=[];
 for(const category of (process.argv[3]?categories.filter(c=>c.includes(process.argv[3])):categories)){
  let continuation={}; do {
   const j=await api({generator:'categorymembers',gcmtitle:'Category:'+category,gcmtype:'file',gcmlimit:'100',prop:'imageinfo',iiprop:'url|size|extmetadata|timestamp|sha1',iiurlwidth:'2400',...continuation});
   for(const p of Object.values(j.query?.pages??{}))all.push({category,...p});continuation=j.continue;
  }while(continuation);
 }
 let previous=[];try{previous=JSON.parse(await fs.readFile(path.join(dir,'commons-discovery.json'),'utf8'));}catch{}
 await fs.writeFile(path.join(dir,'commons-discovery.json'),JSON.stringify([...previous.filter(p=>!all.some(a=>a.category===p.category)),...all],null,2));
 for(const category of categories)console.log(category+'\n'+all.filter(p=>p.category===category).map(p=>p.title).join('\n'));
} else if(mode==='download'){
 const title=process.argv[3],key=process.argv[4];
 let cache=[];try{cache=JSON.parse(await fs.readFile(path.join(dir,'commons-discovery.json'),'utf8'));}catch{}
 let p=cache.find(p=>p.title===title);
 if(!p){const j=await api({titles:title,prop:'imageinfo',iiprop:'url|size|extmetadata|timestamp|sha1',iiurlwidth:'2400'});p=Object.values(j.query.pages)[0];}
 const info=p.imageinfo?.[0];if(!info)throw Error('No imageinfo: '+title);
 const u=process.argv[5]==='thumbnail'?(info.thumburl??info.url):info.url; const r=await request(u);if(!r.ok)throw Error(`Image ${r.status}`);
 const raw=Buffer.from(await r.arrayBuffer());
 // Commons may return the full original for an unscaled thumbnail URL. Bound the saved derivative explicitly.
 const bytes=await sharp(raw).rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:true}).jpeg({quality:94}).toBuffer();
 const filename=key+'.jpg';await fs.writeFile(path.join(dir,filename),bytes);
 const meta=await sharp(bytes).metadata();
 const entry={key,filename,pageURL:info.descriptionurl,originalURL:info.url,downloadURL:u,source: p,sha256:createHash('sha256').update(bytes).digest('hex'),resolution:[meta.width,meta.height],downloadedAt:new Date().toISOString(),transformation:'EXIF autorotation, bounded 3000px JPEG quality 94; no perspective rectification'};
 await fs.writeFile(path.join(dir,key+'.source.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({filename,resolution:entry.resolution,pageURL:entry.pageURL}));
} else if(mode==='import-local'){
 const id=process.argv[3],key=process.argv[4],localDir=path.join(root,'data/texture-city/photos/commons');
 const metadata=JSON.parse(await fs.readFile(path.join(localDir,id+'.json'),'utf8'));
 let inputPath=path.join(localDir,id+'.source');try{await fs.access(inputPath);}catch{inputPath=path.join(localDir,id+'.jpg');}
 const input=await fs.readFile(inputPath),sourceMeta=await sharp(input).metadata();
 if(inputPath.endsWith('.source')&&metadata.sourceBytesSha256&&createHash('sha256').update(input).digest('hex')!==metadata.sourceBytesSha256)throw Error('Original local source hash mismatch');
 const bytes=await sharp(input).rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:true}).jpeg({quality:94}).toBuffer();
 const m=await sharp(bytes).metadata(),cache=JSON.parse(await fs.readFile(path.join(dir,'commons-discovery.json'),'utf8'));
 const p=cache.find(p=>p.title===metadata.title)??{title:metadata.title,imageinfo:[{url:metadata.originalImageUrl,descriptionurl:metadata.sourcePage,width:sourceMeta.width,height:sourceMeta.height,extmetadata:Object.fromEntries(Object.entries({Artist:metadata.author,Credit:metadata.credit,LicenseShortName:metadata.license,LicenseUrl:metadata.licenseUrl,DateTimeOriginal:metadata.captureDate,ImageDescription:metadata.description}).map(([k,v])=>[k,{value:v}]))}]};
 const filename=key+'.jpg';await fs.writeFile(path.join(dir,filename),bytes);
 const entry={key,filename,pageURL:metadata.sourcePage,originalURL:metadata.originalImageUrl,downloadURL:metadata.originalImageUrl,source:p,sha256:createHash('sha256').update(bytes).digest('hex'),resolution:[m.width,m.height],downloadedAt:null,reusedAt:new Date().toISOString(),localOriginalPath:path.relative(root,inputPath).replaceAll('\\','/'),localOriginalSha256:createHash('sha256').update(input).digest('hex'),transformation:'Reused hash-verified original source cached in repository; EXIF autorotation; max 3000px JPEG quality 94'};
 await fs.writeFile(path.join(dir,key+'.source.json'),JSON.stringify(entry,null,2));console.log(JSON.stringify({key,title:metadata.title,resolution:entry.resolution}));
} else if(mode==='contact'){
 const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.jpg')&&!f.startsWith('contact-')).sort();
 const w=600,h=520,cols=3,composite=[];
 for(let i=0;i<files.length;i++){
  const b=await sharp(path.join(dir,files[i])).resize({width:w,height:h-40,fit:'contain',background:'#eeeeee'}).toBuffer();
  const left=i%cols*w,top=Math.floor(i/cols)*h;composite.push({input:b,left,top});
  composite.push({input:Buffer.from(`<svg width="${w}" height="40"><rect width="100%" height="100%" fill="white"/><text x="8" y="26" font-size="19">${files[i]}</text></svg>`),left,top:top+h-40});
 }
 await sharp({create:{width:w*cols,height:h*Math.ceil(files.length/cols),channels:3,background:'white'}}).composite(composite).jpeg({quality:91}).toFile(path.join(dir,'contact-all.jpg'));
} else if(mode==='finalize'){
 const geometryPath='data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
 const geometryBytes=await fs.readFile(path.join(root,geometryPath));const g=JSON.parse(geometryBytes);
 const buildings=[
  ['sumitomo','bldg_684ae520-48d2-4754-b87e-ac4e9e6711f3','Shinjuku Sumitomo Building'],
  ['ns','bldg_6e9c9041-3a29-47ac-aaa3-28429eddcca2','Shinjuku NS Building'],
  ['tocho2','bldg_d0967cf5-1f32-48d1-9dda-11320828a076','Tokyo Metropolitan Government Building No.2'],
  ['hyatt','bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21','Hyatt Regency Tokyo / Odakyu Century Building'],
  ['daiichi','bldg_89e585dc-50ee-485f-bed1-ce0101523b1e','Shinjuku Daiichi Seimei Building (formerly Odakyu Dai-ichi Seimei)'],
  ['assembly','bldg_c0f762a4-cfc0-49fb-85d0-660765c6b6ca','Tokyo Metropolitan Assembly main hall'],
  ['assembly-south-bridge','bldg_178c97c9-6d9b-4418-84ec-b6eb23f41490','Assembly south connecting gallery/bridge'],
  ['assembly-north-arc','bldg_7e673dbb-95f1-4a0c-bdab-b0d7bb352d3b','Assembly northeast gallery'],
  ['assembly-south-arc','bldg_773000d3-5879-4899-b555-44b9037656c5','Assembly southeast gallery'],
  ['assembly-north-bridge','bldg_fa3ef9ba-cd3c-4ddf-b8b9-87becc2b5792','Assembly north connecting gallery/bridge'],
 ].map(([key,id,name])=>{
  const b=g.buildings.find(b=>b.id===id);if(!b)throw Error('Missing geometry '+id);
  const centerXZ=[(b.min[0]+b.max[0])/2,(b.min[2]+b.max[2])/2];
  const lonLat=proj4(CRS,GEO,[g.origin[0]+centerXZ[0],g.origin[1]-centerXZ[1]]);
  return {key,buildingId:id,name,sourceName:b.name,centerXZ,height:b.max[1]-b.min[1],bounds:{min:b.min,max:b.max},centerLonLat:lonLat,
   mappingEvidence:{geometryPath,geometrySha256:createHash('sha256').update(geometryBytes).digest('hex'),coordinateConvention:'X east; Z south; EPSG:6697 horizontal JGD2011 Japan Plane Rectangular IX; inverse using GRS80',
    identity:key==='hyatt'?'South tower center 35.69093513 N,139.69127024 E; official Tokyo Tourist Information Hyatt point 35.690909,139.691273 is ~2.9m away; photograph shows recessed terracotta hotel facade.':key==='daiichi'?'North tower, 70.67m north and 17.53m west of hotel; Commons category point 35.6916,139.691 matches north footprint; official owner brochure distinguishes north office from adjacent Odakyu Century hotel.':key.startsWith('assembly')?'Geometry location relative to main hall and east-facing concave civic plaza; individual photo assignment requires visible identifiable segment.':'PLATEAU source building name and Commons subject agree.',
    sourceURLs:key==='hyatt'?['https://tokyotouristinfo.com/detail/M0364','https://www.dai-ichi-building.co.jp/building/352/pdf']:key==='daiichi'?['https://commons.wikimedia.org/wiki/Category:Odakyu_Dai-ichi_Seimei_Building','https://www.dai-ichi-building.co.jp/building/352/pdf']:[]}};
 });
 const annotations=JSON.parse(await fs.readFile(path.join(dir,'visual-inspection.json'),'utf8'));
 const photos=[];
 for(const filename of (await fs.readdir(dir)).filter(f=>f.endsWith('.source.json')).sort()){
  const s=JSON.parse(await fs.readFile(path.join(dir,filename),'utf8')),ii=s.source.imageinfo[0],m=ii.extmetadata;
  const a=annotations[s.key];if(!a)throw Error('Missing actual visual inspection: '+s.key);
  const keys=a.buildingKeys??[s.key.split('-')[0]],bs=buildings.filter(b=>keys.includes(b.key));
  const value=k=>m[k]?.value??null;
  const bytes=await fs.readFile(path.join(dir,s.filename));if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw Error('Hash mismatch');
  photos.push({...s,source:undefined,localPath:path.relative(root,path.join(dir,s.filename)).replaceAll('\\','/'),author:value('Artist'),credit:value('Credit'),license:value('LicenseShortName'),licenseURL:value('LicenseUrl'),usageTerms:value('UsageTerms'),attributionRequired:value('AttributionRequired'),originalResolution:[ii.width,ii.height],originalCommonsSha1:ii.sha1,dates:{taken:value('DateTimeOriginal'),uploaded:ii.timestamp,downloaded:s.downloadedAt,visuallyInspected:'2026-10-18'},buildingIds:bs.map(b=>b.buildingId),mappingEvidence:bs.map(b=>({buildingId:b.buildingId,...b.mappingEvidence,photoEvidence:a.mappingEvidence??'Building-specific subject and visible facade confirmed in contact sheet.'})),viewOrientation:a.viewOrientation??null,visualInspection:a,rectificationStatus:'source photo only; no homography or camera calibration yet',sourceDescription:value('ImageDescription')});
 }
 for(const b of buildings)b.usefulDaylightFacadePhotoKeys=photos.filter(p=>p.buildingIds.includes(b.buildingId)&&p.visualInspection.usefulFacade===true).map(p=>p.key);
 const manifest={schemaVersion:2,createdAt:new Date().toISOString(),purpose:'Actual building-specific daylight exterior source photographs for subsequent facade rectification; no generic motifs.',scope:'Five major towers plus assembly main hall and four galleries/bridges',buildings,photos,acceptance:{majorBuildingsAtLeastTwo:buildings.slice(0,5).every(b=>b.usefulDaylightFacadePhotoKeys.length>=2),allAssemblyIdsHaveEvidence:buildings.slice(5).every(b=>b.usefulDaylightFacadePhotoKeys.length>=1)},limitations:['Photo appearance depends on lighting and white balance. No material color calibrated from these photographs.','No window count extrapolation from generic motifs. Exact counts require individual rectified facade crops.','Original sha1 is Commons-reported; saved derivative SHA-256 is computed locally.','Rectification and projection are downstream work, not claimed by this source collection.']};
 for(const p of photos){p.path=p.localPath;p.width=p.resolution[0];p.height=p.resolution[1];p.authorText=p.author?.replace(/<[^>]*>/g,'')??null;p.windowSpacing=p.visualInspection.pixelSpacing??'Not metrically measured; source perspective must be rectified first.';}
 manifest.photosByBuildingId=Object.fromEntries(buildings.map(b=>[b.buildingId,photos.filter(p=>p.buildingIds.includes(b.buildingId)&&p.visualInspection.usefulFacade).map(p=>({key:p.key,path:p.path,width:p.width,height:p.height,viewOrientation:p.viewOrientation,observations:p.visualInspection.observations}))]));
 manifest.builderNotes={preferred:{hyatt:'hyatt-01',daiichi:'daiichi-01',tocho2:'tocho2-03',assembly:'assembly-11',northGallery:'assembly-11',southGallery:'assembly-11',northBridge:'assembly-06',southBridge:'assembly-09'},coordinates:'X east, Z south. Image-pixel positions are not UVs.',assembly11Sides:'Camera faces east: north arc left, south arc right, main hall center.',excludedPhotoKeys:photos.filter(p=>!p.visualInspection.usefulFacade).map(p=>p.key)};
 await fs.writeFile(path.join(base,'landmark-sources.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({photos:photos.length,acceptance:manifest.acceptance,counts:buildings.map(b=>[b.key,b.usefulDaylightFacadePhotoKeys.length])}));
} else if(mode==='geometry'){
 const g=JSON.parse(await fs.readFile(path.join(root,'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json'),'utf8'));
 const ids=['bldg_684ae520-48d2-4754-b87e-ac4e9e6711f3','bldg_6e9c9041-3a29-47ac-aaa3-28429eddcca2','bldg_d0967cf5-1f32-48d1-9dda-11320828a076','bldg_9eabfa88-e9b7-402d-b38a-08a5f2544e21','bldg_89e585dc-50ee-485f-bed1-ce0101523b1e'];
 console.log('origin',g.origin);for(const b of g.buildings.filter(b=>ids.includes(b.id)))console.log(JSON.stringify(b).slice(0,1100));
}
