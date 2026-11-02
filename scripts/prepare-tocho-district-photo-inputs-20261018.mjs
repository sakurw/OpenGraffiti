import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {xml, polygon, triangulate, dot, sub} from './plateau-geometry.mjs';

// All writes are restricted to this task's native inputs and source manifest.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='data/plateau/plateau-13104-shinjuku-ku-2025';
const dest='data/texture-city/tocho-district-photo-v2-20261018';
const out=dest+'/native-inputs';
const read=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=async(p,b)=>{assert(p.startsWith(out+'/')||p===dest+'/native-photo-sources.json');await fs.mkdir(path.dirname(path.join(root,p)),{recursive:true});await fs.writeFile(path.join(root,p),b);};
const json=async(p,v)=>save(p,JSON.stringify(v,null,2)+'\n');
const scopePath='data/texture-city/tocho-district-illustrated-20261018/scope.json';
const scopeBytes=await fs.readFile(path.join(root,scopePath));
const scope=JSON.parse(scopeBytes), ids=scope.selectedBuildingIds;
const archiveIndex=new Map((await read(base+'/zip-index.json')).map(e=>[e.name,e]));
const catalog=await read(base+'/catalog.json');
const archiveURL=catalog.result.resources.find(r=>r.name.startsWith('CityGML')).url;
function verifyArchive(file,bytes){const name=file.slice(base.length+1),e=archiveIndex.get(name);assert(e,'Missing original archive entry '+name);assert.equal(bytes.length,e.size);assert.equal(crc32(bytes),e.crc);return {archiveEntry:name,archiveCRC32:e.crc,archiveURL};}
assert.equal(ids.length,83);assert.equal(new Set(ids).size,83);
const neighbors=ids.filter(id=>id!==scope.centralBuildingId);assert.equal(neighbors.length,82);
const buildings=new Map(),geometrySources=[];
for(const file of scope.geometryFiles){const bytes=await fs.readFile(path.join(root,file)),g=JSON.parse(bytes);assert.deepEqual(g.origin,scope.origin);geometrySources.push({file,sha256:hash(bytes),origin:g.origin});for(const b of g.buildings)if(neighbors.includes(b.id)){assert(!buildings.has(b.id));buildings.set(b.id,{b,g,file,mesh:b.sourceMesh??'53394525'});}}
assert.equal(buildings.size,82);
const metadata=new Map(), images=new Map(), sourceImages=new Map();
async function meta(uri){if(!metadata.has(uri)){const file=base+'/udx/bldg/'+uri,bytes=await fs.readFile(path.join(root,file));const provenance=verifyArchive(file,bytes),m=await sharp(bytes).metadata();metadata.set(uri,{file,width:m.width,height:m.height,sha256:hash(bytes),...provenance});}return metadata.get(uri);}
async function image(uri){if(!images.has(uri)){const m=await meta(uri);const {data,info}=await sharp(path.join(root,m.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});images.set(uri,{data,...info});if(images.size>5)images.delete(images.keys().next().value);}return images.get(uri);}
const det=(a,b)=>a[0]*b[1]-a[1]*b[0];
function inside(p,rings){function ring(r){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}return ring(rings[0])&&!rings.slice(1).some(ring);}
function bounds(points){return {min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};}
function candidate(w,t,m){
 const tri=triangulate(w.rings.map(r=>r.points)),u=tri.u;
 if(Math.abs(tri.normal[1])>.25)return null;
 const q=tri.points.map(p=>[dot(sub(p,tri.o),u),p[1]]),uv=[];
 for(const r of w.rings){const a=t.rings[r.id];assert(a&&a.length>=r.points.length*2,'Exact ring UV required '+w.id);for(let k=0;k<r.points.length;k++)uv.push([a[k*2]*m.width,(1-a[k*2+1])*m.height]);}
 const uvRings=[];let offset=0;for(const r of w.rings){uvRings.push(uv.slice(offset,offset+r.points.length));offset+=r.points.length;}
 const xmin=Math.min(...q.map(p=>p[0])),xmax=Math.max(...q.map(p=>p[0])),ymin=Math.min(...q.map(p=>p[1])),ymax=Math.max(...q.map(p=>p[1]));
 let area=0,pixelArea=0,du=0,dv=0,minDensity=Infinity;
 const triangles=[];
 for(let k=0;k<tri.indices.length;k+=3){const ii=tri.indices.slice(k,k+3),[a,b,c]=ii.map(i=>q[i]),[ta,tb,tc]=ii.map(i=>uv[i]),ab=sub(b,a),ac=sub(c,a),d=det(ab,ac);if(Math.abs(d)<1e-9)continue;
  const tu=sub(tb,ta),tv=sub(tc,ta),jx=[(tu[0]*ac[1]-tv[0]*ab[1])/d,(tu[1]*ac[1]-tv[1]*ab[1])/d],jy=[(-tu[0]*ac[0]+tv[0]*ab[0])/d,(-tu[1]*ac[0]+tv[1]*ab[0])/d];
  const ar=Math.abs(d)/2,pa=Math.abs(det(tu,tv))/2,trace=dot(jx,jx)+dot(jy,jy),dd=det(jx,jy),singularMin=Math.sqrt(Math.max(0,(trace-Math.sqrt(Math.max(0,trace*trace-4*dd*dd)))/2));
  area+=ar;pixelArea+=pa;du+=Math.hypot(...jx)*ar;dv+=Math.hypot(...jy)*ar;minDensity=Math.min(minDensity,singularMin);triangles.push({ii,a,b,c,ta,tb,tc,d});
 }
 assert(area>0);du/=area;dv/=area;
 const effectiveUVpixels=[(xmax-xmin)*du,(ymax-ymin)*dv];
 const short=Math.min(...effectiveUVpixels),quality=short<16||pixelArea<256?'INSUFFICIENT':short<64||pixelArea<16384?'LOW_RESOLUTION':'DETAIL_SOURCE';
 return {w,t,m,tri,q,uv,uvRings,triangles,xmin,xmax,ymin,ymax,area,pixelArea,du,dv,minDensity,effectiveUVpixels,quality,score:area*Math.min(1,Math.max(.001,short/32))};
}
const all=[];
for(const id of neighbors){const item=buildings.get(id),cs=[],unavailable=[];for(const w of item.b.walls){const t=item.g.textures[w.id];if(!t){unavailable.push({polygonId:w.id,reason:'NO_NATIVE_TEXTURE'});continue;}const c=candidate(w,t,await meta(t.image));if(c)cs.push(c);else unavailable.push({polygonId:w.id,reason:'SLOPED_OR_HORIZONTAL_WALL_CLASSIFICATION_NOT_SUITABLE_FOR_TANGENT_Y'});}cs.sort((a,b)=>b.score-a.score||b.area-a.area);all.push({...item,cs,unavailable});}
const overview={buildingCount:82,sourceImagesMissing:0,wallCount:all.reduce((s,x)=>s+x.b.walls.length,0),bestByUVArea:all.map(x=>{const c=[...x.cs].sort((a,b)=>b.pixelArea-a.pixelArea)[0];return {buildingId:x.b.id,name:x.b.name||null,polygonId:c?.w.id,effectiveUVpixels:c?.effectiveUVpixels,footprintPixels:c?.pixelArea,quality:c?.quality??'INSUFFICIENT'};})};
overview.bestByUVAreaQualityCounts=Object.fromEntries(['INSUFFICIENT','LOW_RESOLUTION','DETAIL_SOURCE'].map(q=>[q,overview.bestByUVArea.filter(x=>x.quality===q).length]));
await json(out+'/resolution-overview.json',overview);console.log('RESOLUTION_OVERVIEW',JSON.stringify({...overview,bestByUVArea:undefined}));
if(process.argv.includes('--overview-only'))process.exit(0);

// Re-read original CityGML. Verify geometry and UVs for ALL candidate walls, not only selected crops.
const gmlSources=[];
for(const mesh of [...new Set(all.map(x=>x.mesh))]){
 const file=base+`/udx/bldg/${mesh}_bldg_6697_op.gml`,bytes=await fs.readFile(path.join(root,file)),text=bytes.toString('utf8'),selected=all.filter(x=>x.mesh===mesh),wanted=new Map(selected.flatMap(x=>x.cs.map(c=>[c.w.id,c])));
 let verifiedUV=0,verifiedGeometry=0;
 for(const match of text.matchAll(/<app:ParameterizedTexture\b[^>]*>[\s\S]*?<\/app:ParameterizedTexture>/g)){
  const fragment=match[0],uri=fragment.match(/<app:imageURI>([^<]+)<\/app:imageURI>/)?.[1];
  for(const target of fragment.matchAll(/<app:target\s+uri="#([^"]+)"[^>]*>([\s\S]*?)<\/app:target>/g)){
   const c=wanted.get(target[1]);if(!c)continue;assert.equal(uri,c.t.image);
   const native={};for(const r of target[2].matchAll(/<app:textureCoordinates\s+ring="#([^"]+)"[^>]*>([^<]+)<\/app:textureCoordinates>/g))native[r[1]]=r[2].trim().split(/\s+/).map(Number);
   assert.deepEqual(native,c.t.rings);c.nativeVerified=true;verifiedUV++;
  }
 }
 for(const match of text.matchAll(/<gml:Polygon\b[^>]*gml:id="([^"]+)"[^>]*>[\s\S]*?<\/gml:Polygon>/g)){
  const c=wanted.get(match[1]);if(!c)continue;assert.deepEqual(polygon(xml(match[0]),scope.origin).rings,c.w.rings);c.geometryVerified=true;verifiedGeometry++;
 }
 assert.equal(verifiedUV,wanted.size);assert.equal(verifiedGeometry,wanted.size);
 gmlSources.push({file,sha256:hash(bytes),...verifyArchive(file,bytes),verifiedUV,verifiedGeometry});console.log('Verified original GML',mesh,wanted.size);
}

function choose(cs){const selected=[];if(!cs.length)return selected;selected.push(cs[0]);while(selected.length<3){const remaining=cs.filter(c=>!selected.includes(c)),different=remaining.filter(c=>c.quality!=='INSUFFICIENT'&&selected.every(a=>dot(c.tri.normal,a.tri.normal)<.85));const next=different[0]??remaining[0];if(!next)break;selected.push(next);}return selected;}
async function raster(c){
 const src=await image(c.t.image),spanX=c.xmax-c.xmin,spanY=c.ymax-c.ymin;
 // One isotropic world scale preserves physical facade aspect. Effective UV pixels remain separate.
 const scale=Math.min(Math.max(c.du,c.dv),4092/Math.max(spanX,spanY));
 const width=Math.max(1,Math.ceil(spanX*scale)),height=Math.max(1,Math.ceil(spanY*scale)),data=Buffer.alloc(width*height*4),mask=Buffer.alloc(width*height),sampleSet=new Set();
 let rejected=0;
 for(const t of c.triangles){const xs=[t.a[0],t.b[0],t.c[0]].map(x=>(x-c.xmin)*scale),ys=[t.a[1],t.b[1],t.c[1]].map(y=>(c.ymax-y)*scale);
  const x0=Math.max(0,Math.floor(Math.min(...xs))),x1=Math.min(width-1,Math.ceil(Math.max(...xs))),y0=Math.max(0,Math.floor(Math.min(...ys))),y1=Math.min(height-1,Math.ceil(Math.max(...ys)));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const p=[c.xmin+(x+.5)/scale,c.ymax-(y+.5)/scale],ap=sub(p,t.a),v=det(ap,sub(t.c,t.a))/t.d,w=det(sub(t.b,t.a),ap)/t.d,a=1-v-w;if(Math.min(a,v,w)<-1e-9)continue;
   const tx=t.ta[0]*a+t.tb[0]*v+t.tc[0]*w,ty=t.ta[1]*a+t.tb[1]*v+t.tc[1]*w,sx=Math.floor(tx),sy=Math.floor(ty);
   // No bilinear filtering: every fetched texel centre must be within this exact UV polygon, excluding holes.
   if(sx<0||sx>=src.width||sy<0||sy>=src.height||!inside([sx+.5,sy+.5],c.uvRings)){rejected++;continue;}
   const si=(sy*src.width+sx)*4,di=(y*width+x)*4;src.data.copy(data,di,si,si+4);mask[y*width+x]=255;sampleSet.add(sy*src.width+sx);
  }
 }
 const valid=mask.reduce((n,v)=>n+(v>0),0);
 const sum=[0,0,0],ss=[0,0,0],hist=new Map();let dark=0,light=0;
 for(const k of sampleSet){const rgb=[0,1,2].map(j=>src.data[k*4+j]);for(let j=0;j<3;j++){sum[j]+=rgb[j];ss[j]+=rgb[j]**2;}const l=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];dark+=l<48;light+=l>208;const key=rgb.map(v=>Math.floor(v/32)*32+16).join(',');hist.set(key,(hist.get(key)??0)+1);}
 const n=sampleSet.size,mean=sum.map(v=>n?v/n:0),std=ss.map((v,j)=>Math.sqrt(Math.max(0,n?v/n-mean[j]**2:0)));
 let hx=0,hy=0,nx=0,ny=0;const stride=Math.max(1,Math.floor(Math.max(width,height)/256)),dx=Math.max(1,Math.round(scale/c.du)),dy=Math.max(1,Math.round(scale/c.dv)),lum=k=>.2126*data[k*4]+.7152*data[k*4+1]+.0722*data[k*4+2];
 for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){const k=y*width+x;if(!mask[k])continue;if(x+dx<width&&mask[k+dx]){hx+=Math.abs(lum(k)-lum(k+dx));nx++;}if(y+dy<height&&mask[k+dy*width]){hy+=Math.abs(lum(k)-lum(k+dy*width));ny++;}}
 const analysis={color:{population:'Distinct original source texels actually sampled, not output/upsampled pixels',sampleCount:n,meanRGB:mean,stdRGB:std,darkFraction:n?dark/n:0,lightFraction:n?light/n:0,dominantQuantizedRGB:[...hist].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([rgb,count])=>({rgb:rgb.split(',').map(Number),fraction:count/n}))},pattern:{horizontalMeanAbsLumaDifference:nx?hx/nx:0,verticalMeanAbsLumaDifference:ny?hy/ny:0,samplingStepRasterPixels:[dx,dy],interpretation:c.quality==='INSUFFICIENT'?'Insufficient native detail for a window or repeat claim.':'Color variation and directional contrast only; these metrics do not detect windows or establish a repeat grid.'}};
 return {data,mask,width,height,scale,valid,rejected,uniqueSourcePixels:sampleSet.size,analysis};
}
const records=[],panels=[];
for(const item of all){
 const {b,mesh}=item,selected=choose(item.cs),walls=[];
 for(let i=0;i<selected.length;i++){
  const c=selected[i];assert(c.nativeVerified&&c.geometryVerified);const r=await raster(c),stem=out+`/${b.id}--wall-${i+1}`,file=stem+'.png',maskFile=stem+'--mask.png';
  await save(file,await sharp(r.data,{raw:{width:r.width,height:r.height,channels:4}}).png().toBuffer());await save(maskFile,await sharp(r.mask,{raw:{width:r.width,height:r.height,channels:1}}).png().toBuffer());
  const quality=r.uniqueSourcePixels<256?'INSUFFICIENT':c.quality;
  const record={buildingId:b.id,wallIndex:i+1,file,maskFile,quality,photoCoverageClaim:false,sourceImageURI:c.t.image,sourceImagePath:c.m.file,sourceImageSha256:c.m.sha256,sourceImageDimensions:[c.m.width,c.m.height],sourceGML:base+`/udx/bldg/${mesh}_bldg_6697_op.gml`,sourceGMLPolygon:c.w.id,surfaceId:c.w.surfaceId,nativeUV:c.t.rings,geometryRings:c.w.rings,normal:c.tri.normal,fullBounds:bounds(c.tri.points),minmaxHeight:[c.ymin,c.ymax],worldTangentYBounds:[c.xmin,c.ymin,c.xmax,c.ymax],projection:{origin:c.tri.o,tangent:c.tri.u,vertical:[0,1,0],pixelMetres:1/r.scale},rasterDims:[r.width,r.height],effectiveUVpixels:c.effectiveUVpixels,effectivePixelFootprint:c.pixelArea,uniqueSourcePixelsActuallySampled:r.uniqueSourcePixels,physicalAreaM2:c.area,texelsPerMetre:[c.du,c.dv],minimumTriangleSingularTexelsPerMetre:c.minDensity,validRasterPixels:r.valid,transparentRasterPixels:r.width*r.height-r.valid,rejectedOutsideUVTexelCenters:r.rejected,holeCount:c.w.rings.length-1,triangulationDeviation:c.tri.deviation,actualObserved:'Only original atlas texels whose centres lie inside the exact native polygon UV and outside hole UVs; no semantic window or photographic coverage certification.',inferred:'None. No filling, synthesis, repetition, or neighbor/roof-slot sampling.',windowModule:{status:'NOT_IDENTIFIED',reason:quality==='INSUFFICIENT'?'Insufficient original pixels; no guessed window module.':'Own-wall detail crop supplied for inspection; window semantics require visual confirmation.'}};
  // Preserve a local high-detail region without forcing the full physical height into a square.
  if(quality!=='INSUFFICIENT'&&r.width>=32&&r.height>=32){
   const cw=Math.min(256,r.width),ch=Math.min(256,r.height);let best=null;
   for(let gy=0;gy<5;gy++)for(let gx=0;gx<5;gx++){const left=Math.round((r.width-cw)*gx/4),top=Math.round((r.height-ch)*gy/4);let n=0,s=0,ss=0,total=0;for(let y=top;y<top+ch;y+=2)for(let x=left;x<left+cw;x+=2){total++;const k=y*r.width+x;if(!r.mask[k])continue;const j=k*4,v=(r.data[j]+r.data[j+1]+r.data[j+2])/3;n++;s+=v;ss+=v*v;}const coverage=n/total,variance=n?ss/n-(s/n)**2:0,score=coverage>=.98?variance:-1;if(!best||score>best.score)best={left,top,width:cw,height:ch,score,coverage};}
   if(best.score>=0){const detailFile=stem+'--own-detail.png';await save(detailFile,await sharp(r.data,{raw:{width:r.width,height:r.height,channels:4}}).extract({left:best.left,top:best.top,width:cw,height:ch}).png().toBuffer());record.ownDetailCrop={file:detailFile,rectifiedPixelRect:[best.left,best.top,cw,ch],worldTangentYBounds:[c.xmin+best.left/r.scale,c.ymax-(best.top+ch)/r.scale,c.xmin+(best.left+cw)/r.scale,c.ymax-best.top/r.scale],selection:'Maximum luminance variance among 5x5 own-wall crops with >=98% valid-mask samples; NOT a detected window module.',additionalResize:false,rectificationSamplingExpansion:[r.scale/c.du,r.scale/c.dv],effectiveUVpixels:[cw*c.du/r.scale,ch*c.dv/r.scale]};
    // Manually inspected own-detail crop: visible horizontal window bands at its top.
    // This is a photographed repeat patch, not an inferred single-window size or grid.
    if(b.id==='bldg_d0967cf5-1f32-48d1-9dda-11320828a076'&&i===0){const rect=[best.left+5,best.top+5,145,60],moduleFile=stem+'--observed-window-band.png';assert(rect[0]+rect[2]<=r.width&&rect[1]+rect[3]<=r.height);await save(moduleFile,await sharp(r.data,{raw:{width:r.width,height:r.height,channels:4}}).extract({left:rect[0],top:rect[1],width:rect[2],height:rect[3]}).png().toBuffer());record.windowModule={status:'OBSERVED_WINDOW_BAND_PATCH',file:moduleFile,rectifiedPixelRect:rect,effectiveUVpixels:[rect[2]*c.du/r.scale,rect[3]*c.dv/r.scale],worldTangentYBounds:[c.xmin+rect[0]/r.scale,c.ymax-(rect[1]+rect[3])/r.scale,c.xmin+(rect[0]+rect[2])/r.scale,c.ymax-rect[1]/r.scale],selection:'Human-visible repeated horizontal window bands in this own-wall crop; no inferred single-window grid, size, or repetition.',sourceGMLPolygon:c.w.id};}
   }
  }
  record.analysis=r.analysis;record.windowAllowed=record.windowModule.status==='OBSERVED_WINDOW_BAND_PATCH';record.windowAllowedReason=record.windowAllowed?'Visible window-band patch inspected in this own image; use only the supplied crop as observation, do not extrapolate a facade grid.':quality==='INSUFFICIENT'?'INSUFFICIENT original resolution; windows must not be invented.':'Window semantics unconfirmed; inspect this own facade/detail crop before enabling windows.';record.windowAllowedScope=record.windowAllowed?record.windowModule.worldTangentYBounds:null;
  record.facadeDetailsObserved=record.windowAllowed;record.facadeDetailsObservedScope=record.windowAllowedScope;record.occlusion={status:record.windowAllowed?'WINDOW_PATCH_VISIBLE_REMAINDER_UNASSESSED':'UNASSESSED_POSSIBLY_TREES_ROOF_OR_PROJECTED_BACKGROUND',coverageFraction:null,manualReviewRequired:true};record.readability={status:quality==='INSUFFICIENT'?'UNREADABLE_NATIVE_RESOLUTION':record.windowAllowed?'WINDOW_PATCH_READABLE_REMAINDER_UNVERIFIED':'UNVERIFIED_CONTENT_MAY_NOT_SHOW_FACADE',nativeResolutionQuality:quality};
  walls.push(record);panels.push(record);sourceImages.set(c.t.image,c.m);
 }
 const selectedIds=new Set(selected.map(c=>c.w.id));const uncovered=item.cs.filter(c=>!selectedIds.has(c.w.id)).map(c=>({polygonId:c.w.id,surfaceId:c.w.surfaceId,normal:c.tri.normal,areaM2:c.area,quality:c.quality,effectiveUVpixels:c.effectiveUVpixels,reason:'NOT_EXTRACTED_UP_TO_THREE_WALL_LIMIT'}));uncovered.push(...item.unavailable);
 records.push({buildingId:b.id,name:b.name||null,lod:b.lod,geometryFile:item.file,fullBuildingBounds:{min:b.min,max:b.max},minmaxHeight:[b.min[1],b.max[1]],wallCount:b.walls.length,texturedWallCount:item.cs.length,quality:walls.every(w=>w.quality==='INSUFFICIENT')?'INSUFFICIENT':walls.some(w=>w.quality==='DETAIL_SOURCE')?'DETAIL_SOURCE':'LOW_RESOLUTION',actualObservedWallIds:walls.map(w=>w.sourceGMLPolygon),uncoveredWalls:uncovered,windowModuleStatus:walls.some(w=>w.windowModule.status==='OBSERVED_WINDOW_BAND_PATCH')?'OBSERVED_WINDOW_BAND_PATCH':'NOT_IDENTIFIED',walls});
 if(records.length%10===0)console.log('Rasterized buildings',records.length,'/82');
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const contactPages=[];
for(let start=0;start<records.length;start+=8){const group=records.slice(start,start+8),composite=[];const cellW=620,cellH=300;
 for(let n=0;n<group.length;n++){const b=group[n],x=n%2*cellW,y=Math.floor(n/2)*cellH;const label=`<svg width="620" height="80"><rect width="620" height="80" fill="#20242a"/><text x="12" y="20" font-size="13" fill="white">${esc(b.buildingId)}</text><text x="12" y="43" font-size="15" fill="white">${esc(b.name??'Name absent in source')} | ${b.quality}</text><text x="12" y="64" font-size="12" fill="#ccc">${esc(b.walls.map(w=>w.effectiveUVpixels.map(v=>Math.round(v)).join('x')+'px').join(' / '))}</text></svg>`;composite.push({input:Buffer.from(label),left:x,top:y});for(let k=0;k<b.walls.length;k++){const p=await sharp(path.join(root,b.walls[k].file)).resize(196,206,{fit:'contain',background:'#737373',kernel:'nearest'}).flatten({background:'#737373'}).png().toBuffer();composite.push({input:p,left:x+8+k*204,top:y+86});}}
 const file=out+`/contact-${String(start/8+1).padStart(2,'0')}.png`;await save(file,await sharp({create:{width:1240,height:Math.ceil(group.length/2)*cellH,channels:3,background:'#42464b'}}).composite(composite).png().toBuffer());contactPages.push({file,buildingIds:group.map(b=>b.buildingId)});
}
// Four actual facades per sheet, no text inside the panels. The JSON is the authoritative identity map.
const sheetBatches=[];
for(let start=0;start<panels.length;start+=4){const group=panels.slice(start,start+4),size=768,gap=12,composite=[],mapping=[];
 for(let i=0;i<group.length;i++){const w=group[i],left=gap+(i%2)*(size+gap),top=gap+Math.floor(i/2)*(size+gap),m=await sharp(path.join(root,w.file)).metadata(),scale=Math.min(size/m.width,size/m.height),display=[Math.round(m.width*scale),Math.round(m.height*scale)];const bytes=await sharp(path.join(root,w.file)).resize(size,size,{fit:'contain',background:'#a0a0a0',kernel:'nearest'}).flatten({background:'#a0a0a0'}).png().toBuffer();composite.push({input:bytes,left,top});mapping.push({panelIndex:i,panelRect:[left,top,size,size],photoContentApproxRect:[left+Math.floor((size-display[0])/2),top+Math.floor((size-display[1])/2),...display],buildingId:w.buildingId,wallIndex:w.wallIndex,sourceFile:w.file,quality:w.quality,effectiveUVpixels:w.effectiveUVpixels,originalSourcePixelFootprint:w.effectivePixelFootprint,displayResizeOnly:true});}
 const file=out+`/sheet-4facades-${String(start/4+1).padStart(3,'0')}.png`;await save(file,await sharp({create:{width:size*2+gap*3,height:size*2+gap*3,channels:3,background:'#151515'}}).composite(composite).png().toBuffer());sheetBatches.push({file,panels:mapping,unusedPanels:4-group.length});
}
const buildingSheetBatches=[];
for(let start=0;start<records.length;start+=4){const group=records.slice(start,start+4),size=1024,gap=16,composite=[],mapping=[];
 for(let i=0;i<group.length;i++){const b=group[i],left=gap+(i%2)*(size+gap),top=gap+Math.floor(i/2)*(size+gap),wallMappings=[];const cellWidth=324,cellHeight=992;
  composite.push({input:await sharp({create:{width:size,height:size,channels:3,background:'#a0a0a0'}}).png().toBuffer(),left,top});
  for(let j=0;j<b.walls.length;j++){const w=b.walls[j],x=left+16+j*(cellWidth+10),y=top+16,meta=await sharp(path.join(root,w.file)).metadata(),fit=Math.min(cellWidth/meta.width,cellHeight/meta.height),contentWidth=Math.round(meta.width*fit),contentHeight=Math.round(meta.height*fit);composite.push({input:await sharp(path.join(root,w.file)).resize(cellWidth,cellHeight,{fit:'contain',background:'#a0a0a0',kernel:'nearest'}).flatten({background:'#a0a0a0'}).png().toBuffer(),left:x,top:y});wallMappings.push({wallIndex:w.wallIndex,sourceFile:w.file,wallCellRect:[x,y,cellWidth,cellHeight],photoContentRect:[x+Math.floor((cellWidth-contentWidth)/2),y+Math.floor((cellHeight-contentHeight)/2),contentWidth,contentHeight],sourceGMLPolygon:w.sourceGMLPolygon,effectiveUVpixels:w.effectiveUVpixels,quality:w.quality,windowAllowed:w.windowAllowed,facadeDetailsObserved:w.facadeDetailsObserved,occlusion:w.occlusion,readability:w.readability});}
  mapping.push({panelIndex:i,panelRect:[left,top,size,size],buildingId:b.buildingId,name:b.name,quality:b.quality,walls:wallMappings});
 }
 const file=out+`/sheet-4buildings-${String(start/4+1).padStart(3,'0')}.png`;await save(file,await sharp({create:{width:2096,height:2096,channels:3,background:'#151515'}}).composite(composite).png().toBuffer());buildingSheetBatches.push({file,panels:mapping,unusedPanels:4-group.length,rectangleConvention:'Integer pixels [left,top,width,height], top-left origin, half-open bounds; panel order TL,TR,BL,BR; one building per panel, three own walls left-to-right.'});
}
assert.equal(buildingSheetBatches.length,21);assert.deepEqual(buildingSheetBatches.flatMap(s=>s.panels.map(p=>p.buildingId)),neighbors);
const summary={buildingCount:records.length,facadeCount:panels.length,qualityCounts:Object.fromEntries(['INSUFFICIENT','LOW_RESOLUTION','DETAIL_SOURCE'].map(q=>[q,records.filter(b=>b.quality===q).length])),facadeQualityCounts:Object.fromEntries(['INSUFFICIENT','LOW_RESOLUTION','DETAIL_SOURCE'].map(q=>[q,panels.filter(w=>w.quality===q).length])),contactPages:contactPages.length,sheetBatches:buildingSheetBatches.length,legacyFacadeSheetBatches:sheetBatches.length,fullBuildingPhotoCoverageCertified:0,observedWindowBandPatches:panels.filter(w=>w.windowModule.status==='OBSERVED_WINDOW_BAND_PATCH').length,singleWindowModulesConfirmed:0,contentUnverifiedFacades:panels.filter(w=>!w.facadeDetailsObserved).length};
const manifest={schemaVersion:2,generatedAt:new Date().toISOString(),scopePath,scopeSha256:hash(scopeBytes),frozen83SelectedBuildingIds:ids,excludedCentralBuildingId:scope.centralBuildingId,neighbor82BuildingIds:neighbors,origin:scope.origin,coordinateSystem:scope.coordinateSystem,geometrySources,originalGML:gmlSources,sourceImages:[...sourceImages].map(([imageURI,m])=>({imageURI,...m})),method:{rasterization:'earcut exact rings including holes; world horizontal tangent and Y; barycentric UV interpolation; nearest texel with texel-centre UV polygon/hole test',quality:'INSUFFICIENT if effective short side <16 px, footprint <256 px or <256 source texels sampled; LOW_RESOLUTION if short side <64 px or footprint <16384 px; otherwise DETAIL_SOURCE. Quality describes source detail, never photo coverage.',selection:'Physical tangent/Y area weighted by source short-side resolution (saturates at 32px); prefer distinct signed normals for additional sufficiently resolved walls; maximum three polygons per building.',observed:'Only original PLATEAU atlas texels and exact native geometry/UV provenance. Texture provenance does not certify real-world visibility or semantic detail.',inferred:'None',sourceCrop:'Exact polygon UV sampling, never packed-atlas bounding-box extraction',sheetPanels:'Square display-only letterboxing; original raster and source pixel counts remain authoritative; labels only in JSON, outside photos in contacts.'},summary,contactPages,sheetBatches,buildings:records};
manifest.facadeSheetBatches=sheetBatches;manifest.sheetBatches=buildingSheetBatches;manifest.primaryStylizationInputs='sheetBatches: one building per panel, three own walls inside each panel. Do not use facadeSheetBatches as building batches.';
manifest.method.observationCaution='An original atlas assigned to a wall may depict trees, roofs, projected background or occlusion. Native resolution quality does not establish facade visibility. windowAllowed=false for all unverified details; the one inspected band patch is localized, not full-facade coverage.';
await json(dest+'/native-photo-sources.json',manifest);await json(out+'/index.json',manifest);
await save(out+'/index.txt',records.map(b=>`${b.buildingId}\t${b.name??'(unnamed)'}\t${b.quality}\t${b.walls.map(w=>`${w.file} [native ${w.effectiveUVpixels.map(v=>v.toFixed(2)).join('x')}px, ${w.uniqueSourcePixelsActuallySampled} sampled texels]`).join('\t')}`).join('\n')+'\n');
await json(out+'/sheet-batches.json',buildingSheetBatches);await json(out+'/facade-sheet-batches.json',sheetBatches);await json(out+'/contact-pages.json',contactPages);
console.log('COMPLETE',JSON.stringify(summary));
