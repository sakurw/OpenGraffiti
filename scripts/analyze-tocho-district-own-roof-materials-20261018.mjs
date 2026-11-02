// Evidence only: native polygon UV texels; never assigns facade materials.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {inflateRawSync, crc32} from 'node:zlib';
import sharp from 'sharp';
import {triangulate, sub, cross} from './plateau-geometry.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='data/texture-city/tocho-district-photo-v2-20261018';
const inputDir=base+'/own-roof-inputs';
const plateau='data/plateau/plateau-13104-shinjuku-ku-2025';
const scopePath='data/texture-city/tocho-district-illustrated-20261018/scope.json';
const semanticsPath='data/texture-city/tocho-district-illustrated-20261018/semantics.json';
const abs=p=>path.resolve(root,p);
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFile(abs(p));
const json=async p=>JSON.parse(await read(p));
const writeJSON=async(p,v)=>fs.writeFile(abs(p),JSON.stringify(v,null,2)+'\n');
const exists=async p=>fs.access(abs(p)).then(()=>true,()=>false);
const assert=(v,m)=>{if(!v)throw Error(m);};
const area=p=>{const t=triangulate(p.rings.map(r=>r.points));let a=0;for(let i=0;i<t.indices.length;i+=3){const [x,y,z]=t.indices.slice(i,i+3).map(j=>t.points[j]);a+=Math.hypot(...cross(sub(y,x),sub(z,x)))/2;}return a;};
function inside(x,y,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function masked(x,y,rings){return inside(x,y,rings[0])&&!rings.slice(1).some(r=>inside(x,y,r));}
// Verify holes and concave exclusions independently of the production inputs.
assert(!masked(2,2,[[[0,0],[4,0],[4,4],[0,4]],[[1,1],[3,1],[3,3],[1,3]]]),'hole test');
assert(!masked(3,3,[[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]]),'concave test');
const quantile=(v,q)=>{const a=[...v].sort((a,b)=>a-b);const t=(a.length-1)*q,i=Math.floor(t);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(t-i);};
const rgbHex=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
const scope=await json(scopePath),sem=await json(semanticsPath),catalog=await json(plateau+'/catalog.json');
const zipUrl=catalog.result.resources.find(r=>r.name.startsWith('CityGML')).url;
const index=await json(plateau+'/zip-index.json');
const ids=scope.selectedBuildingIds.filter(id=>id!==scope.centralBuildingId);
assert(ids.length===82&&new Set(ids).size===82,'Frozen scope must contain exactly 82 unique neighbors');
await fs.mkdir(abs(inputDir),{recursive:true});
const geometry=await Promise.all(scope.geometryFiles.map(async p=>({path:p,sha256:sha(await read(p)),data:await json(p)})));
const entries=new Map();
for(const g of geometry){assert(JSON.stringify(g.data.origin)===JSON.stringify(scope.origin),'origin mismatch');for(const b of g.data.buildings)if(ids.includes(b.id)){assert(!entries.has(b.id),'duplicate building '+b.id);entries.set(b.id,{g,b});}}
async function range(start,end){const r=await fetch(zipUrl,{headers:{Range:`bytes=${start}-${end}`}});assert(r.status===206,'ZIP range HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}
async function source(image){
  assert(!image.includes('..')&&!path.isAbsolute(image),'unsafe texture path');
  const canonicalPath=plateau+'/udx/bldg/'+image;
  let localPath=canonicalPath,download=null;
  if(!await exists(localPath)){
    localPath=inputDir+'/source-images/'+image;
    const e=index.find(e=>e.name==='udx/bldg/'+image);assert(e,'ZIP entry absent');
    if(!await exists(localPath)){
      const h=await range(e.offset,e.offset+29);assert(h.readUInt32LE(0)===0x04034b50,'ZIP header');
      const start=e.offset+30+h.readUInt16LE(26)+h.readUInt16LE(28);
      const payload=await range(start,start+e.compressed-1);
      const bytes=e.method===8?inflateRawSync(payload):payload;
      assert(bytes.length===e.size&&crc32(bytes)===e.crc,'ZIP integrity');
      await fs.mkdir(path.dirname(abs(localPath)),{recursive:true});await fs.writeFile(abs(localPath),bytes);
    }
    const bytes=await read(localPath);assert(bytes.length===e.size&&crc32(bytes)===e.crc,'cached ZIP integrity');
    download={zipUrl,entry:e};
  }
  const bytes=await read(localPath);
  return {canonicalPath,localPath,sha256:sha(bytes),bytes:bytes.length,download};
}
const records=[];
for(const id of ids){
  const record={buildingId:id,status:'gap',facade:{status:'unobserved',material:'unknown',windows:'unobserved',inferenceAllowedOnlyIfExplicit:true},qualityFlags:[]};records.push(record);
  try{
    const entry=entries.get(id);assert(entry,'geometry absent');const {b,g}=entry;
    const candidates=b.polygons.filter(p=>sem.polygons[p.id]?.buildingId===id&&sem.polygons[p.id]?.type==='RoofSurface'&&!sem.polygons[p.id]?.installation).map(p=>({p,area:area(p)})).sort((a,b)=>b.area-a.area||a.p.id.localeCompare(b.p.id));
    record.geometry={path:g.path,sha256:g.sha256};record.candidateCount=candidates.length;
    record.excludedInstallationPolygonCount=b.polygons.filter(p=>sem.polygons[p.id]?.installation).length;
    assert(candidates.length,'no explicit noninstallation RoofSurface');
    const selected=candidates[0],p=selected.p,texture=g.data.textures[p.id];
    record.polygonId=p.id;record.areaM2=selected.area;assert(texture,'largest roof lacks texture');
    const uv=p.rings.map(r=>{const a=texture.rings[r.id];assert(a,'exact ring UV absent');assert(a.length===r.points.length*2||a.length===(r.points.length+1)*2,'UV vertex count mismatch');assert(a.every(v=>Number.isFinite(v)&&v>=0&&v<=1),'UV out of bounds');if(a.length===(r.points.length+1)*2)assert(Math.abs(a[0]-a.at(-2))<1e-6&&Math.abs(a[1]-a.at(-1))<1e-6,'UV closure mismatch');return r.points.map((_,i)=>[a[2*i],a[2*i+1]]);});
    record.source=await source(texture.image);
    const {data,info}=await sharp(abs(record.source.localPath)).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const W=info.width,H=info.height,points=uv.flat();
    const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0]))*W)),top=Math.max(0,Math.floor((1-Math.max(...points.map(p=>p[1])))*H));
    const right=Math.min(W,Math.ceil(Math.max(...points.map(p=>p[0]))*W)),bottom=Math.min(H,Math.ceil((1-Math.min(...points.map(p=>p[1])))*H));
    const w=right-left,h=bottom-top;assert(w>0&&h>0,'empty UV crop');
    const mask=Buffer.alloc(w*h),out=Buffer.alloc(w*h*4),sample=Buffer.alloc(w*h);let count=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(masked((left+x+.5)/W,1-(top+y+.5)/H,uv)){const i=y*w+x,j=((top+y)*W+left+x)*4;mask[i]=255;data.copy(out,i*4,j,j+4);count++;}
    assert(count>0,'no native texel centers inside UV polygon');
    let sampleCount=0;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(mask[i]&&out[i*4+3]===255&&[-w-1,-w,-w+1,-1,0,1,w-1,w,w+1].every(d=>mask[i+d])){sample[i]=255;sampleCount++;}}
    let erosion=1;if(sampleCount<16){erosion=0;sampleCount=0;for(let i=0;i<mask.length;i++)if(mask[i]&&out[i*4+3]===255){sample[i]=255;sampleCount++;}record.qualityFlags.push('too_few_eroded_texels_used_full_polygon');}
    assert(sampleCount>0,'no opaque own-roof samples');
    const pixels=[];for(let i=0;i<sample.length;i++)if(sample[i])pixels.push([out[4*i],out[4*i+1],out[4*i+2]]);
    const lum=p=>.2126*p[0]+.7152*p[1]+.0722*p[2],ls=pixels.map(lum),lo=quantile(ls,.1),hi=quantile(ls,.9);
    const trimmed=pixels.filter(p=>lum(p)>=lo&&lum(p)<=hi),median=[0,1,2].map(c=>quantile(trimmed.map(p=>p[c]),.5));
    const dark=pixels.filter(p=>lum(p)<40).length/pixels.length,bright=pixels.filter(p=>p.every(v=>v>245)).length/pixels.length;
    const green=pixels.filter(([r,g,b])=>g>r*1.12&&g>b*1.08&&g-r>12).length/pixels.length;
    const iqr=quantile(ls,.75)-quantile(ls,.25);
    if(count<256||Math.min(w,h)<16)record.qualityFlags.push('low_native_resolution');
    if(selected.area<10)record.qualityFlags.push('small_roof_under_10m2');
    if(dark>.2)record.qualityFlags.push('dark_texels_possible_shadow');
    if(bright>.1)record.qualityFlags.push('bright_texels_possible_clipping');
    if(green>.15)record.qualityFlags.push('green_texels_roof_color_or_possible_vegetation');
    if(iqr>50)record.qualityFlags.push('heterogeneous_photo_possible_objects_or_shadow');
    record.qualityFlags.push('orthophoto_occlusion_not_automatically_resolved','physical_roof_material_unverified');
    const dir=inputDir+'/'+id;await fs.mkdir(abs(dir),{recursive:true});
    const photo=dir+'/roof.png',maskPath=dir+'/mask.png',samplePath=dir+'/sample-mask.png';
    await sharp(out,{raw:{width:w,height:h,channels:4}}).png().toFile(abs(photo));
    await sharp(mask,{raw:{width:w,height:h,channels:1}}).png().toFile(abs(maskPath));
    await sharp(sample,{raw:{width:w,height:h,channels:1}}).png().toFile(abs(samplePath));
    // Verify every retained pixel is its original source texel, without resampling.
    const decoded=await sharp(abs(photo)).ensureAlpha().raw().toBuffer();assert(decoded.equals(out),'PNG texel identity failed');
    for(let i=0;i<mask.length;i++)if(!mask[i])assert(out[i*4+3]===0,'outside-polygon contamination');
    record.status='extracted';record.photo={path:photo,sha256:sha(await read(photo)),width:w,height:h,maskedTexels:count};
    record.masks={polygon:maskPath,sampling:samplePath,erosionPixels:erosion,sampleTexels:sampleCount};
    record.source.resolution={width:W,height:H};record.crop={left,top,width:w,height:h};
    record.colors={space:'sRGB 0..255; photographed appearance, not calibrated albedo',robustMedianRGB:median,robustMedianHex:rgbHex(median),method:'channel median after retaining luminance p10..p90; no green/shadow color substitution',trimmedSampleTexels:trimmed.length,luminanceP10:lo,luminanceP90:hi,luminanceIQR:iqr,darkFraction:dark,brightFraction:bright,greenHeuristicFraction:green};
    record.materialConditioning={roof:{basis:'exact native RoofSurface UV polygon photo',photoPath:photo,colorEvidence:record.colors.robustMedianHex,physicalMaterial:'unknown',confidence:'photo appearance only; not material identification'},facade:{basis:'none from roof evidence',status:'inferred_only_if_separately_requested',windows:'do_not_invent'}};
    record.visualReview={status:'pending',occlusion:'unknown',notes:[]};
    record.selectionPath=dir+'/selection.json';
    await writeJSON(record.selectionPath,{buildingId:id,polygonId:p.id,areaM2:selected.area,selection:'largest triangulated 3D area original v1 RoofSurface excluding installations; no smaller polygon fallback',semantics:sem.polygons[p.id],rings:p.rings.map((r,i)=>({id:r.id,pointsXYZ:r.points,uv:uv[i]})),source:record.source,crop:record.crop,pixelCenterTransform:'u=(sourceX+0.5)/sourceWidth; v=1-(sourceY+0.5)/sourceHeight',candidates:candidates.map(c=>({polygonId:c.p.id,areaM2:c.area,textured:!!g.data.textures[c.p.id]}))});
  }catch(e){record.gap=String(e.message);}
  console.log(`${records.length}/82 ${id} ${record.status}${record.gap?' '+record.gap:''}`);
}
const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),purpose:'Evidence-only own-roof photo basis for every frozen-scope neighbor; no facade inference or model changes',scope:{path:scopePath,sha256:sha(await read(scopePath)),totalScopeBuildings:83,centralBuildingId:scope.centralBuildingId,neighborCount:82,origin:scope.origin},semantics:{path:semanticsPath,sha256:sha(await read(semanticsPath)),sourceFiles:sem.sourceFiles},provenance:{catalogPath:plateau+'/catalog.json',author:catalog.result.author,license:catalog.result.license_title,licenseUrl:catalog.result.license_url,zipUrl},policy:{selection:'largest-area noninstallation original v1 RoofSurface',sampling:'native source pixel centers inside exact polygon UV exterior minus holes; transparent outside; no atlas-slot sampling',physicalMaterial:'unknown until separately established; RGB is photographed appearance',facades:'not grounded by roof photos; windows unobserved',occlusion:'heuristics flagged; no assumption every roof is visible'},summary:{indexed:records.length,extracted:records.filter(r=>r.status==='extracted').length,gaps:records.filter(r=>r.status!=='extracted').length},buildings:records};
const previous=await json(base+'/own-roof-materials.json').catch(()=>null);
const reviews=await json(inputDir+'/visual-reviews.json').catch(()=>null);
for(const r of records){
  const old=previous?.buildings?.find(b=>b.buildingId===r.buildingId);
  if(old?.photo?.sha256===r.photo?.sha256&&old?.visualReview)r.visualReview=old.visualReview;
  const review=reviews?.buildings?.find(b=>b.buildingId===r.buildingId&&b.photoSha256===r.photo?.sha256);
  if(review)r.visualReview=review;
  if(r.materialConditioning){
    r.materialConditioning.roof.roofColorUsable=r.visualReview?.roofColorUsable??false;
    r.materialConditioning.roof.application='evidence only; requires explicit downstream interpretation, never automatic application';
    r.materialConditioning.roof.appearanceDescription=r.visualReview?.appearance??'not visually reviewed';
    r.materialConditioning.roof.materialIdentificationConfidence='unknown';
    if(!r.materialConditioning.roof.roofColorUsable)r.qualityFlags.push('median_not_approved_as_roof_material_color');
  }
}
manifest.visualReviewSource=reviews?{path:inputDir+'/visual-reviews.json',sha256:sha(await read(inputDir+'/visual-reviews.json'))}:null;
manifest.summary.reviewed=records.filter(r=>r.visualReview?.status==='reviewed').length;
manifest.summary.roofColorUsable=records.filter(r=>r.materialConditioning?.roof?.roofColorUsable).length;
manifest.summary.roofMaterialColorGaps=records.length-manifest.summary.roofColorUsable;
manifest.summary.physicalMaterialIdentifications=0;
manifest.verification={uniqueNeighborIds:new Set(records.map(r=>r.buildingId)).size,centralBuildingExcluded:!records.some(r=>r.buildingId===scope.centralBuildingId),selection:'every successful extraction checks exact semantic owner, original RoofSurface, installation exclusion, and maximum triangulated area',texels:'every successful extraction round-trips PNG raw RGBA exactly and asserts transparency outside exact UV polygon',review:'manual reviews applied only when roof.png SHA256 matches',facadeObservationsAdded:0};
// Contact sheets are previews only; the referenced roof.png files remain native texels.
manifest.contactSheets=[];
const extracted=records.filter(r=>r.status==='extracted');
for(let start=0;start<extracted.length;start+=12){const group=extracted.slice(start,start+12),layers=[];for(let i=0;i<group.length;i++){const r=group[i],x=(i%3)*360,y=Math.floor(i/3)*280;const thumb=await sharp(abs(r.photo.path)).flatten({background:'#ddd'}).resize(340,235,{fit:'inside',withoutEnlargement:true}).png().toBuffer();layers.push({input:thumb,left:x+10,top:y+30});const label=`${start+i+1} ${r.buildingId.slice(5,13)} ${r.photo.width}x${r.photo.height} ${r.colors.robustMedianHex}`;layers.push({input:Buffer.from(`<svg width="360" height="28"><text x="8" y="20" font-size="15" fill="white">${label}</text></svg>`),left:x,top:y});}const out=inputDir+`/contact-${String(start/12+1).padStart(2,'0')}.jpg`;await sharp({create:{width:1080,height:1120,channels:3,background:'#303030'}}).composite(layers).jpeg({quality:90}).toFile(abs(out));manifest.contactSheets.push({path:out,buildingIds:group.map(r=>r.buildingId)});}
await writeJSON(base+'/own-roof-materials.json',manifest);
console.log(JSON.stringify(manifest.summary));
