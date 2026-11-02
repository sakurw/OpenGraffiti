import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {inflateRawSync,crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {xml, descendants, first, nums, polygon,triangulate} from './plateau-geometry.mjs';
import {buildingGeometry} from './plateau-building.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='data/plateau/plateau-13104-shinjuku-ku-2025';
const out=path.join(root,'data/texture-city/tocho-district-illustrated-20261018');
const g=JSON.parse(await fs.readFile(path.join(root,base,'53394525-geometry.json'),'utf8'));
const index=JSON.parse(await fs.readFile(path.join(root,base,'zip-index.json'),'utf8'));
const catalog=JSON.parse(await fs.readFile(path.join(root,base,'catalog.json'),'utf8'));
const zipURL=catalog.result.resources.find(r=>r.name.startsWith('CityGML')).url;
const sources=[];
async function source(name){
 const entry=index.find(e=>e.name===name);let bytes;
 try{bytes=await fs.readFile(path.join(root,base,name));}catch{
  const range=async(start,end)=>{const r=await fetch(zipURL,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(120000)});if(r.status!==206)throw Error(`Expected 206: ${r.status}`);return Buffer.from(await r.arrayBuffer());};
  console.log('Official ranged download '+name+' '+entry.compressed+' bytes');
  const h=await range(entry.offset,entry.offset+29);if(h.readUInt32LE(0)!==0x04034b50)throw Error('ZIP header');
  const start=entry.offset+30+h.readUInt16LE(26)+h.readUInt16LE(28);
  const raw=await range(start,start+entry.compressed-1);bytes=entry.method===8?inflateRawSync(raw):raw;
 }
 if(bytes.length!==entry.size||crc32(bytes)!==entry.crc)throw Error('Source size/CRC mismatch: '+name);
 const dest=path.join(root,base,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);
 sources.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),crc32:entry.crc,zipURL});
 return bytes.toString('utf8');
}
const roadSources=await Promise.all(['53394525','53394524','53394534','53394535'].map(async mesh=>({mesh,text:await source(`udx/tran/${mesh}_tran_6697_op.gml`)})));
const roads=[],renderRoads=[];
for(const {mesh,text} of roadSources){
for(const m of text.matchAll(/<tran:Road\b[^>]*>[\s\S]*?<\/tran:Road>/g)){
 const r=xml(m[0]); let index=0;
 let renderIndex=0;
 for(const s of descendants(r,'tran:lod3MultiSurface'))for(const pn of descendants(s,'gml:Polygon')){
  const p=polygon(pn,g.origin);if(!p)continue;
  // LOD3 includes both TrafficArea and AuxiliaryTrafficArea; preserve every source ring.
  renderRoads.push({sourceMesh:mesh,sourceRoadId:r.a['gml:id'],sourcePolygonId:p.id??null,polygonIndex:renderIndex++,lod:3,rings:p.rings});
 }
 for(const s of descendants(r,'tran:lod1MultiSurface'))for(const pn of descendants(s,'gml:Polygon')){
  const p=polygon(pn,g.origin);if(!p)continue;
  roads.push({sourceMesh:mesh,sourceRoadId:r.a['gml:id'],name:first(r,'gml:name')?.text??'',function:r.c.find(n=>n.t==='tran:function')?.text,sourcePolygonId:p.id??null,polygonIndex:index++,lod:1,rings:p.rings});
 }
}
}
await fs.mkdir(out,{recursive:true});
const bounds=[-700,-700,500,450];
const hull=points=>{const a=[...new Map(points.map(p=>[p.join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(a.length<3)return a;const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],hi=[];for(const p of a){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}for(const p of a.toReversed()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}return lo.slice(0,-1).concat(hi.slice(0,-1));};
// Survey topology: complement of the actual road footprints, not a distance radius.
const cell=.5, rw=Math.round((bounds[2]-bounds[0])/cell),rh=Math.round((bounds[3]-bounds[1])/cell);
const rasterSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="${bounds[0]} ${bounds[1]} ${bounds[2]-bounds[0]} ${bounds[3]-bounds[1]}"><rect x="${bounds[0]}" y="${bounds[1]}" width="${bounds[2]-bounds[0]}" height="${bounds[3]-bounds[1]}" fill="black"/>${roads.map(r=>`<path d="${r.rings.map(r=>r.points.map((p,i)=>(i?'L':'M')+[p[0],p[2]].join(',')).join(' ')+'Z').join(' ')}" fill="white" stroke="white" stroke-width="0.5" fill-rule="evenodd"/>`).join('')}</svg>`;
const raster=await sharp(Buffer.from(rasterSVG)).greyscale().raw().toBuffer();
const labels=new Int32Array(rw*rh);const queue=new Int32Array(rw*rh),components=[];
for(let start=0;start<labels.length;start++){
 if(labels[start]||raster[start]>=128)continue;
 const id=components.length+1;let head=0,tail=1;queue[0]=start;labels[start]=id;
 let minX=rw,minZ=rh,maxX=0,maxZ=0,sx=0,sz=0,touchesEdge=false;
 while(head<tail){const p=queue[head++],x=p%rw,z=Math.floor(p/rw);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);sx+=x;sz+=z;if(!x||!z||x===rw-1||z===rh-1)touchesEdge=true;
  for(const q of [x?p-1:-1,x<rw-1?p+1:-1,z?p-rw:-1,z<rh-1?p+rw:-1])if(q>=0&&!labels[q]&&raster[q]<128){labels[q]=id;queue[tail++]=q;}
 }
 components.push({id,area:tail*cell*cell,bounds:[minX*cell+bounds[0],minZ*cell+bounds[1],(maxX+1)*cell+bounds[0],(maxZ+1)*cell+bounds[1]],center:[(sx/tail+.5)*cell+bounds[0],(sz/tail+.5)*cell+bounds[1]],touchesEdge});
}
const labelAt=([x,z])=>labels[Math.floor((z-bounds[1])/cell)*rw+Math.floor((x-bounds[0])/cell)];
const positions=[['C',[0,0]],['N',[-40,-180]],['NE',[80,-205]],['E',[117,-16]],['SE',[152,163]],['S',[30,190]],['SW',[-80,210]],['W',[-210,-60]],['NW',[-200,-185]]];
const selectedLabels=new Set(positions.map(([,p])=>labelAt(p)));
if(selectedLabels.has(0)||selectedLabels.size!==8)throw Error('Road topology changed: expected eight distinct bounded blocks (W=NW).');
for(const id of selectedLabels)if(components[id-1].touchesEdge)throw Error('Selected block is not closed within the survey.');
function signedArea(r){return r.reduce((s,a,i)=>{const b=r[(i+1)%r.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;}
function distanceSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function simplifyLine(a,tolerance){if(a.length<=2)return a;let max=0,index=0;for(let i=1;i<a.length-1;i++){const d=distanceSegment(a[i],a[0],a.at(-1));if(d>max){max=d;index=i;}}return max>tolerance?simplifyLine(a.slice(0,index+1),tolerance).slice(0,-1).concat(simplifyLine(a.slice(index),tolerance)):[a[0],a.at(-1)];}
function contour(mask,tolerance=.75){
 const edges=new Map(),stride=rw+1;
 const add=(a,b)=>{if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);};
 for(let z=0;z<rh;z++)for(let x=0;x<rw;x++){const p=z*rw+x;if(!mask[p])continue;const v=z*stride+x;if(!z||!mask[p-rw])add(v,v+1);if(x===rw-1||!mask[p+1])add(v+1,v+1+stride);if(z===rh-1||!mask[p+rw])add(v+1+stride,v+stride);if(!x||!mask[p-1])add(v+stride,v);}
 const loops=[];
 while(edges.size){const start=edges.keys().next().value;let at=start,loop=[];do{loop.push([(at%stride)*cell+bounds[0],Math.floor(at/stride)*cell+bounds[1]]);const next=edges.get(at);if(!next?.length)throw Error('Open raster contour');const to=next.pop();if(!next.length)edges.delete(at);at=to;}while(at!==start);if(loop.length>3)loops.push(loop);}
 const ring=loops.sort((a,b)=>Math.abs(signedArea(b))-Math.abs(signedArea(a)))[0];
 let split=1;for(let i=2;i<ring.length;i++)if(Math.hypot(...ring[i].map((v,j)=>v-ring[0][j]))>Math.hypot(...ring[split].map((v,j)=>v-ring[0][j])))split=i;
 return simplifyLine(ring.slice(0,split+1),tolerance).slice(0,-1).concat(simplifyLine(ring.slice(split).concat([ring[0]]),tolerance));
}
const blocks=[...selectedLabels].map(id=>{
 const c=components[id-1],mask=Uint8Array.from(labels,v=>v===id?1:0);
 return {...c,id:'block-'+positions.find(([,p])=>labelAt(p)===id)[0],rasterLabel:id,positions:positions.filter(([,p])=>labelAt(p)===id).map(([n])=>n),polygonXZ:contour(mask),selectedBuildingIds:[]};
});
// Assign road pixels to the nearest land component. This places the outer envelope
// along the dividing roads, while joining blocks across their intervening roads.
const owner=new Int32Array(labels);let head=0,tail=0;
for(let i=0;i<owner.length;i++)if(owner[i])queue[tail++]=i;
while(head<tail){const p=queue[head++],x=p%rw,z=Math.floor(p/rw);for(const q of [x?p-1:-1,x<rw-1?p+1:-1,z?p-rw:-1,z<rh-1?p+rw:-1])if(q>=0&&!owner[q]){owner[q]=owner[p];queue[tail++]=q;}}
const envelopeMask=Uint8Array.from(owner,v=>selectedLabels.has(v)?1:0);
const selectionPolygonXZ=contour(envelopeMask);
const extent=selectionPolygonXZ.reduce((a,p)=>[Math.min(a[0],p[0]),Math.min(a[1],p[1]),Math.max(a[2],p[0]),Math.max(a[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const inRing=(p,r)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
const inRoad=(p,r)=>inRing(p,r.rings[0].points.map(p=>[p[0],p[2]]))&&!r.rings.slice(1).some(r=>inRing(p,r.points.map(p=>[p[0],p[2]])));
const roadBounds=r=>r.rings[0].points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[2]),Math.max(b[2],p[0]),Math.max(b[3],p[2])],[Infinity,Infinity,-Infinity,-Infinity]);
const intersectsBounds=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const roadExtent=extent.map((v,i)=>v+(i<2?-20:20));
const topologyRoads=roads.filter(r=>intersectsBounds(roadBounds(r),roadExtent));
const renderSelected=renderRoads.filter(r=>intersectsBounds(roadBounds(r),roadExtent));
// Retain source ring identities in topology data. Render surfaces are clipped below
// by triangulating only boundary-crossing polygons and interpolating native Y.
console.log(JSON.stringify({selectedBlocks:blocks.map(b=>({id:b.id,positions:b.positions,bounds:b.bounds})),selectionBoundsXZ:extent,renderRoadPolygons:renderSelected.length}));
const additional={origin:g.origin,buildings:[],textures:{},sources:[]};
const existing=new Set(g.buildings.map(b=>b.id));
for(const mesh of ['53394524','53394534','53394535']){
 const s=await source(`udx/bldg/${mesh}_bldg_6697_op.gml`);
 console.log('Parsing buildings '+mesh);
 for(const m of s.matchAll(/<bldg:Building\b[^>]*>[\s\S]*?<\/bldg:Building>/g)){
  const b=xml(m[0]);if(existing.has(b.a['gml:id']))continue;
  const lod=[4,3,2,1].find(l=>descendants(b,`bldg:lod${l}Solid`).length||descendants(b,`bldg:lod${l}MultiSurface`).length)||1;
  const {geom,walls}=buildingGeometry(b,lod,g.origin);if(!geom.length)continue;
  const points=geom.flatMap(p=>p.rings[0].points),min=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max=[0,1,2].map(i=>Math.max(...points.map(p=>p[i])));
  // Keep complete native geometry for the district and an explicitly non-selection margin.
  if(!intersectsBounds([min[0],min[2],max[0],max[2]],roadExtent))continue;
  const building={id:b.a['gml:id'],name:first(b,'gml:name')?.text||'',lod,min,max,walls,polygons:geom,sourceMesh:mesh};
  additional.buildings.push(building);existing.add(building.id);
 }
 const polygonIds=new Set(additional.buildings.filter(b=>b.sourceMesh===mesh).flatMap(b=>b.polygons.map(p=>p.id)));
 for(const m of s.matchAll(/<app:ParameterizedTexture\b[^>]*>[\s\S]*?<\/app:ParameterizedTexture>/g)){
  const t=xml(m[0]),image=first(t,'app:imageURI')?.text.trim();
  for(const target of descendants(t,'app:target')){const id=target.a.uri?.replace(/^#/,'');if(!polygonIds.has(id))continue;const rings={};for(const tc of descendants(target,'app:textureCoordinates'))rings[tc.a.ring.replace(/^#/,'')]=nums(tc.text);additional.textures[id]={image,rings};}
 }
}
additional.sources=sources.filter(s=>s.path.includes('/bldg/'));
await fs.writeFile(path.join(out,'additional-geometry.json'),JSON.stringify(additional));
console.log(JSON.stringify({additionalBuildings:additional.buildings.length,textures:Object.keys(additional.textures).length}));
g.buildings.push(...additional.buildings);
function segmentsIntersect(a,b,c,d){const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(!intersectsBounds([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],[Math.min(c[0],d[0]),Math.min(c[1],d[1]),Math.max(c[0],d[0]),Math.max(c[1],d[1])]))return false;return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;}
function ringHits(a,b){return a.some(p=>inRing(p,b))||b.some(p=>inRing(p,a))||a.some((p,i)=>b.some((q,j)=>segmentsIntersect(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));}
const selectedBuildings=g.buildings.filter(b=>intersectsBounds([b.min[0],b.min[2],b.max[0],b.max[2]],extent)&&b.polygons.some(p=>ringHits(p.rings[0].points.map(p=>[p[0],p[2]]),selectionPolygonXZ)));
for(const block of blocks){
 block.selectedBuildingIds=selectedBuildings.filter(b=>intersectsBounds([b.min[0],b.min[2],b.max[0],b.max[2]],block.bounds)&&b.polygons.some(p=>ringHits(p.rings[0].points.map(p=>[p[0],p[2]]),block.polygonXZ))).map(b=>b.id);
 block.boundaryRoads=topologyRoads.filter(r=>intersectsBounds(roadBounds(r),block.bounds.map((v,i)=>v+(i<2?-2:2)))&&block.polygonXZ.some(p=>r.rings.some(r=>r.points.some((q,i)=>distanceSegment(p,[q[0],q[2]],[r.points[(i+1)%r.points.length][0],r.points[(i+1)%r.points.length][2]])<2)))).map(r=>({sourceRoadId:r.sourceRoadId,name:r.name,sourceMesh:r.sourceMesh}));
}
const scope={schemaVersion:1,scopeLabel:'Tocho first-main-building street block + one neighboring street-block layer (3x3 positions, 8 unique road-bounded blocks; W and NW are one park block)',origin:g.origin,coordinateSystem:{axis:'local X east, Y up, Z south; metres',horizontalCRS:'JGD2011 Japan Plane Rectangular CS IX (EPSG:6677)',originOrder:'projected easting, projected northing, altitude',projectionModule:'scripts/plateau-geometry.mjs'},centralBuildingId:'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7',geometryFiles:[base+'/53394525-geometry.json','data/texture-city/tocho-district-illustrated-20261018/additional-geometry.json'],selectedBuildingIds:selectedBuildings.map(b=>b.id),selectionPolygonXZ,selectionBoundsXZ:extent,blocks,roadsFile:'data/texture-city/tocho-district-illustrated-20261018/roads.json',renderRoadsFile:'data/texture-city/tocho-district-illustrated-20261018/render-roads.json',coverage:{complete:true,originalMeshAloneComplete:false,requiredAdditionalMeshes:['53394524','53394534','53394535'],missingMeshes:[],selectedBlocksClosed:blocks.every(b=>!b.touchesEdge),additionalGeometryBoundsFilter:roadExtent,buildingSelectionRule:'Include complete building when any projected native polygon intersects the district envelope; no building geometry is clipped.'},method:{blockTopology:'Connected components of complement of actual tran:lod1MultiSurface road polygons; 0.5m raster with 0.5m road stroke to seal sub-pixel seams.',positions:positions.map(([position,seedXZ])=>({position,seedXZ,blockId:blocks.find(b=>b.positions.includes(position)).id})),selectionEnvelope:'Assign road pixels to nearest non-road component using four-neighbor grid distance; trace outer perimeter of selected components plus their intervening road halves. Fill internal traffic-island holes. Simplify at 0.75m tolerance.',topologyResolutionMetres:cell,roadSeamSealStrokeMetres:.5,polygonSimplificationToleranceMetres:.75},sources,notes:['No radius was used to select buildings or blocks.','The first-main-building block is C. The assembly/council building block east across 都道11号 is E and is included.','The park west and northwest is one continuous road-bounded component, so nine grid positions resolve to eight unique blocks.','Native geometry and all imageURI/UV references are retained for additional buildings; images are fetched separately by the main builder.','All coordinates use the original 53394525 geometry.origin, including every additional tile.','LOD1 road Y=0 is a topology footprint, not a usable surveyed render elevation. Use renderRoadsFile for native LOD3 Y values.','The street layer is topological in XZ, including grade-separated streets in LOD1; this does not certify pedestrian-level accessibility.']};
if(!scope.selectedBuildingIds.includes(scope.centralBuildingId))throw Error('Central Tocho building missing');
await fs.writeFile(path.join(out,'scope.json'),JSON.stringify(scope,null,2));
console.log(JSON.stringify({scopeReady:true,selectedBuildings:selectedBuildings.length,geometryFiles:scope.geometryFiles}));
function clipRing(points,box){let result=points;for(const [axis,limit,greater] of [[0,box[0],true],[0,box[2],false],[2,box[1],true],[2,box[3],false]]){const input=result;result=[];if(!input.length)break;for(let i=0;i<input.length;i++){const a=input[(i+input.length-1)%input.length],b=input[i],ina=greater?a[axis]>=limit:a[axis]<=limit,inb=greater?b[axis]>=limit:b[axis]<=limit;if(ina!==inb){const t=(limit-a[axis])/(b[axis]-a[axis]);result.push(a.map((v,j)=>v+(b[j]-v)*t));}if(inb)result.push(b);}}return result.map(p=>p.map(v=>Math.round(v*1000)/1000));}
const clippedRender=[];
for(const r of renderSelected){
 if(r.rings.every(r=>r.points.every(p=>p[0]>=roadExtent[0]&&p[0]<=roadExtent[2]&&p[2]>=roadExtent[1]&&p[2]<=roadExtent[3]))){clippedRender.push(r);continue;}
 const t=triangulate(r.rings.map(r=>r.points));
 for(let i=0;i<t.indices.length;i+=3){const points=clipRing(t.indices.slice(i,i+3).map(j=>t.points[j]),roadExtent);if(points.length<3||Math.abs(signedArea(points.map(p=>[p[0],p[2]])))<.000001)continue;clippedRender.push({...r,clipped:true,sourceRingIds:r.rings.map(r=>r.id??null),fragmentIndex:i/3,rings:[{id:`${r.sourcePolygonId??r.sourceRoadId+'-'+r.polygonIndex}-clip-${i/3}`,points}]});}
}
const roadMetadata={origin:g.origin,axis:'X east,Y up,Z south; metres',selectionBoundsXZ:extent,marginMetres:20,clipBoundsXZ:roadExtent,sourceFiles:sources.filter(s=>s.path.includes('/tran/'))};
await fs.writeFile(path.join(out,'roads.json'),JSON.stringify({...roadMetadata,lod:1,purpose:'street block topology; Y=0 is not surveyed ground',roads:topologyRoads}));
await fs.writeFile(path.join(out,'render-roads.json'),JSON.stringify({...roadMetadata,lod:3,purpose:'native surveyed-height road surfaces; clipped with interpolated Y at selection extent + 20m rectangle',roads:clippedRender}));
let minHeight=Infinity,maxHeight=-Infinity;for(const r of clippedRender)for(const ring of r.rings)for(const p of ring.points){minHeight=Math.min(minHeight,p[1]);maxHeight=Math.max(maxHeight,p[1]);}
scope.renderRoads={file:scope.renderRoadsFile,sourcePolygonCount:renderSelected.length,outputPolygonCount:clippedRender.length,boundsXZ:roadExtent,heightRange:[minHeight,maxHeight],clipped:true,missingElevationSubstitution:false};
scope.coverage.sourceChecks='All six additional road/building GML files checked against official ZIP uncompressed length and CRC32 and persisted under the original dataset udx paths.';
const originalBuildings=g.buildings.filter(b=>!b.sourceMesh);
scope.evidence={originalGeometryFile:scope.geometryFiles[0],originalGeometrySha256:createHash('sha256').update(await fs.readFile(path.join(root,scope.geometryFiles[0]))).digest('hex'),originalBuildingCount:originalBuildings.length,originalBuildingBoundsXYZ:originalBuildings.reduce((a,b)=>a.map((v,i)=>i<3?Math.min(v,b.min[i]):Math.max(v,b.max[i-3])),[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]),roadBoundsByMesh:Object.fromEntries(roadSources.map(({mesh})=>[mesh,roads.filter(r=>r.sourceMesh===mesh).reduce((a,r)=>{const b=roadBounds(r);return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];},[Infinity,Infinity,-Infinity,-Infinity])])),originalSelectedBuildingCount:selectedBuildings.filter(b=>!b.sourceMesh).length,additionalSelectedBuildingCount:selectedBuildings.filter(b=>b.sourceMesh).length,roadEnvelopeBuildingIds:scope.selectedBuildingIds.filter(id=>!blocks.some(b=>b.selectedBuildingIds.includes(id)))};
scope.notes.push('Three selected structures lie in the intervening road portion of the envelope rather than its eight land components; they remain included as complete native buildings. See evidence.roadEnvelopeBuildingIds.');
await fs.writeFile(path.join(out,'scope.json'),JSON.stringify(scope,null,2));
const mapBounds=extent.map((v,i)=>v+(i<2?-48:48)),mapScale=Math.min(1050/(mapBounds[2]-mapBounds[0]),920/(mapBounds[3]-mapBounds[1]));
const mapXY=([x,z])=>[65+(x-mapBounds[0])*mapScale,125+(z-mapBounds[1])*mapScale];
const mapD=points=>points.map((p,i)=>(i?'L':'M')+mapXY(p).join(',')).join(' ')+'Z';
const selectedIds=new Set(scope.selectedBuildingIds),escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const labelsByBlock={'block-C':'C · Tocho No.1','block-N':'N','block-NE':'NE · Sumitomo','block-E':'E · Council','block-SE':'SE · NS','block-S':'S · Tocho No.2','block-SW':'SW','block-W':'W + NW · Central Park'};
const mapSVG=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1160" viewBox="0 0 1200 1160">
<defs><clipPath id="map"><rect x="58" y="119" width="1070" height="940"/></clipPath></defs>
<rect width="1200" height="1160" fill="#f7f5ef"/>
<g font-family="sans-serif" fill="#243b43"><text x="40" y="38" font-size="25" font-weight="bold">都庁を中心に周囲1街区（中央公園を含む8街区）</text>
<text x="40" y="67" font-size="16">83 buildings · actual PLATEAU road polygons · 3×3 positions; W and NW share one park block</text>
<text x="40" y="93" font-size="13">Orange: Tocho No.1   Teal: selected blocks/buildings   Blue: road-based district perimeter   N ↑ / X east, Z south</text></g>
<g clip-path="url(#map)">
${blocks.map(b=>`<path d="${mapD(b.polygonXZ)}" fill="${b.id==='block-C'?'#f6dfc5':'#dbe9df'}"/>`).join('')}
${topologyRoads.map(r=>`<path d="${r.rings.map(r=>mapD(r.points.map(p=>[p[0],p[2]]))).join(' ')}" fill="#c4cbd0" stroke="#8a959d" stroke-width="0.35" fill-rule="evenodd"/>`).join('')}
${g.buildings.filter(b=>intersectsBounds([b.min[0],b.min[2],b.max[0],b.max[2]],mapBounds)).map(b=>`<path d="${mapD(hull(b.polygons.flatMap(p=>p.rings[0].points.map(p=>[p[0],p[2]]))))}" fill="${b.id===scope.centralBuildingId?'#d86b35':selectedIds.has(b.id)?'#6a9288':'#dbdcd7'}" stroke="${selectedIds.has(b.id)?'#385e58':'#b6bab5'}" stroke-width="0.65"/>`).join('')}
<path d="${mapD(selectionPolygonXZ)}" fill="none" stroke="#1465a4" stroke-width="3" stroke-linejoin="round"/>
${blocks.map(b=>{const p=mapXY([b.center[0],b.bounds[1]+(b.id==='block-W'?140:20)]);return `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="16" fill="#183b4b" stroke="#f7f5ef" stroke-width="4" paint-order="stroke">${escape(labelsByBlock[b.id])}</text>`;}).join('')}
</g>
<g font-family="sans-serif" fill="#40545b" font-size="13">${[-400,-200,0,200].map(x=>`<text x="${mapXY([x,0])[0]}" y="115">X ${x}</text>`).join('')}${[-200,0,200].map(z=>`<text x="4" y="${mapXY([0,z])[1]}">${z}</text>`).join('')}
<path d="M70 1085h${100*mapScale}" stroke="#243b43" stroke-width="3"/><text x="70" y="1110">100 m</text>
<text x="300" y="1085">Boundary from road topology at 0.5 m; simplified at 0.75 m.</text><text x="300" y="1108">Buildings: convex-hull footprint previews; complete native geometry is retained.</text>
<text x="40" y="1141">Source: PLATEAU Shinjuku 2025 · meshes 53394525 / 24 / 34 / 35 · original 53394525 origin</text></g></svg>`;
await fs.writeFile(path.join(out,'scope-map.svg'),mapSVG);
await sharp(Buffer.from(mapSVG)).png().toFile(path.join(out,'scope-map.png'));
console.log(JSON.stringify({complete:true,selectedBuildings:scope.selectedBuildingIds.length,topologyRoads:topologyRoads.length,renderRoads:scope.renderRoads,origin:g.origin}));
