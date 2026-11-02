// Source-complete district extraction. Never writes to original cache/source files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import proj4 from 'proj4';
import {xml,descendants,first,nums,CRS,GEO} from './plateau-geometry.mjs';
import {buildingGeometry} from './plateau-building.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='data/plateau/plateau-13104-shinjuku-ku-2025';
const previous='data/texture-city/tocho-district-illustrated-20261018';
const output='data/texture-city/tocho-district-plateau-v4-20261018';
const read=async p=>fs.readFile(path.join(root,p));
const json=async p=>JSON.parse(await read(p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const old=await json(previous+'/scope.json');
const cachedBytes=await read(base+'/53394525-geometry.json');
const cached=JSON.parse(cachedBytes);
const oldAdditional=await json(previous+'/additional-geometry.json');
const zip=await json(base+'/zip-index.json');
const catalog=await json(base+'/catalog.json');
const zipURL=catalog.result.resources.find(r=>r.name.startsWith('CityGML')).url;
const origin=cached.origin;
const overlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const bounds=ring=>ring.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const inRing=(p,r)=>{let v=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])v=!v;}return v;};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const intersects=(a,b,c,d)=>overlap(bounds([a,b]),bounds([c,d]))&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
function ringHits(a,b){return overlap(bounds(a),bounds(b))&&(a.some(p=>inRing(p,b))||b.some(p=>inRing(p,a))||a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length]))));}
const footprint=p=>p.rings[0].points.map(p=>[p[0],p[2]]);
const hits=(b,r)=>overlap([b.min[0],b.min[2],b.max[0],b.max[2]],bounds(r))&&b.polygons.some(p=>ringHits(footprint(p),r));

// Derive required standard third-level meshes from the geographic envelope.
// 100 m guard also inspects tiles close enough for ordinary building overhangs.
const e=old.selectionBoundsXZ;
const geographic=(margin)=>bounds([[e[0]-margin,e[1]-margin],[e[0]-margin,e[3]+margin],[e[2]+margin,e[1]-margin],[e[2]+margin,e[3]+margin]].map(([x,z])=>proj4(CRS,GEO,[origin[0]+x,origin[1]-z])));
const geo=geographic(0),guardGeo=geographic(100);
function tileBounds(mesh){const lat=Number(mesh.slice(0,2))*2/3+Number(mesh[4])/12+Number(mesh[6])/120;const lon=Number(mesh.slice(2,4))+100+Number(mesh[5])/8+Number(mesh[7])/80;return [lon,lat,lon+1/80,lat+1/120];}
const tileCandidates=zip.filter(e=>/^udx\/bldg\/\d{8}_bldg_6697_op.gml$/.test(e.name)).map(e=>({entry:e,mesh:e.name.match(/(\d{8})_bldg/)[1]}));
const required=tileCandidates.filter(t=>overlap(tileBounds(t.mesh),guardGeo)).sort((a,b)=>a.mesh.localeCompare(b.mesh));
const geometry={schemaVersion:1,origin,buildings:[],textures:{},sources:[],textureReferences:[]};
const sourceCounts=[],failures=[],duplicates=[],allIds=new Set();
const oldIds=new Set(old.selectedBuildingIds),cacheIds=new Set(cached.buildings.map(b=>b.id));
const oldGeometryIds=new Set([...cached.buildings,...oldAdditional.buildings].map(b=>b.id));
const native25Ids=new Set();
for(const {entry,mesh} of required){
 console.log('Auditing native GML '+mesh);
 const bytes=await read(base+'/'+entry.name);
 if(bytes.length!==entry.size||crc32(bytes)!==entry.crc)throw Error('ZIP size/CRC failed '+entry.name);
 const text=bytes.toString('utf8');
 const source={path:base+'/'+entry.name,zipEntry:entry.name,mesh,bytes:bytes.length,sha256:sha(bytes),crc32:crc32(bytes),zipURL,validatedAgainstOfficialZipIndex:true};
 geometry.sources.push(source);
 const count={mesh,sourceBuildingCount:0,parsedBuildingCount:0,selectedBuildingCount:0,selectedPolygonCount:0,emptyGeometryIds:[],lodCounts:{}};
 const selected=[];
 for(const m of text.matchAll(/<bldg:Building\b[^>]*>[\s\S]*?<\/bldg:Building>/g)){
  const b=xml(m[0]),id=b.a['gml:id'];count.sourceBuildingCount++;
  if(mesh==='53394525')native25Ids.add(id);
  if(allIds.has(id)){duplicates.push({id,mesh});continue;}allIds.add(id);
  let result,lod;
  for(const l of [4,3,2,1]){if(!descendants(b,`bldg:lod${l}Solid`).length&&!descendants(b,`bldg:lod${l}MultiSurface`).length&&!descendants(b,`bldg:lod${l}Geometry`).length)continue;const r=buildingGeometry(b,l,origin);if(r.geom.length){result=r;lod=l;break;}}
  if(!result){count.emptyGeometryIds.push(id);failures.push({id,mesh,reason:'No supported native polygon geometry; completeness cannot be assumed'});continue;}
  count.parsedBuildingCount++;
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of result.geom)for(const ring of p.rings)for(const v of ring.points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],v[i]);max[i]=Math.max(max[i],v[i]);}
  const building={id,name:first(b,'gml:name')?.text||'',lod,min,max,walls:result.walls,polygons:result.geom,sourceMesh:mesh,sourceGml:source.path};
  if(!hits(building,old.selectionPolygonXZ))continue;
  selected.push(building);geometry.buildings.push(building);count.selectedBuildingCount++;count.selectedPolygonCount+=result.geom.length;count.lodCounts[lod]=(count.lodCounts[lod]||0)+1;
 }
 const polygonIds=new Set(selected.flatMap(b=>b.polygons.map(p=>p.id)));
 for(const m of text.matchAll(/<app:ParameterizedTexture\b[^>]*>[\s\S]*?<\/app:ParameterizedTexture>/g)){
  const t=xml(m[0]),image=first(t,'app:imageURI')?.text.trim();
  for(const target of descendants(t,'app:target')){
   const id=target.a.uri?.replace(/^#/,'');if(!polygonIds.has(id))continue;
   const rings={};for(const tc of descendants(target,'app:textureCoordinates'))rings[tc.a.ring.replace(/^#/,'')]=nums(tc.text);
   const reference={image,rings,sourceMesh:mesh,sourceGml:source.path,imagePath:path.posix.normalize(path.posix.join(path.posix.dirname(source.path),image)),textureId:t.a['gml:id']??null};
   geometry.textureReferences.push({polygonId:id,...reference});
   if(geometry.textures[id]&&JSON.stringify(geometry.textures[id])!==JSON.stringify(reference))failures.push({id,mesh,reason:'Conflicting texture assignments'});
   geometry.textures[id]=reference;
  }
 }
 sourceCounts.push(count);console.log(JSON.stringify(count));
}
geometry.buildings.sort((a,b)=>a.id.localeCompare(b.id));
const ids=new Set(geometry.buildings.map(b=>b.id));
const omitted=geometry.buildings.filter(b=>!oldIds.has(b.id));
const removed=old.selectedBuildingIds.filter(id=>!ids.has(id));
const blocks=old.blocks.map(block=>({...block,selectedBuildingIds:geometry.buildings.filter(b=>hits(b,block.polygonXZ)).map(b=>b.id)}));
const assigned=new Set(blocks.flatMap(b=>b.selectedBuildingIds));
const blockAudit=blocks.map(b=>({blockId:b.id,positions:b.positions,previousCount:old.blocks.find(o=>o.id===b.id).selectedBuildingIds.length,nativeCount:b.selectedBuildingIds.length,omittedIds:b.selectedBuildingIds.filter(id=>!oldIds.has(id)),previouslyAssignedIdsNowAbsent:old.blocks.find(o=>o.id===b.id).selectedBuildingIds.filter(id=>!b.selectedBuildingIds.includes(id))}));
// Check UV closure against source LinearRing vertex counts (CityGML includes closure).
const uvErrors=[];let uvRingCount=0;
for(const b of geometry.buildings)for(const p of b.polygons){const t=geometry.textures[p.id];if(!t)continue;for(const r of p.rings){const uv=t.rings[r.id];uvRingCount++;if(!uv||![r.points.length*2,(r.points.length+1)*2].includes(uv.length)||!uv.every(Number.isFinite))uvErrors.push({buildingId:b.id,polygonId:p.id,ringId:r.id,vertices:r.points.length,uvNumbers:uv?.length??0});}}
const missingCachedIds=[...native25Ids].filter(id=>!cacheIds.has(id));
const originalScopeBytes=await read(previous+'/scope.json');
const audit={schemaVersion:1,createdAt:new Date().toISOString(),complete:failures.length===0&&uvErrors.length===0&&removed.length===0&&duplicates.length===0,scopeDefinition:old.scopeLabel,scopeTopology:{inheritedFrom:previous+'/scope.json',sha256:sha(originalScopeBytes),uniqueClosedRoadBlocks:blocks.length,positions:old.method.positions,selectionBoundsXZ:e,topologyUnchanged:true},tileCoverage:{geographicEnvelopeLonLat:geo,guardEnvelopeLonLat:guardGeo,guardMetres:100,requiredTiles:required.map(t=>t.mesh),allDatasetBuildingTilesExamined:tileCandidates.map(t=>({mesh:t.mesh,boundsLonLat:tileBounds(t.mesh),required:required.includes(t)})),missingTiles:[],method:'Standard 8-digit third-level mesh geographic bounds intersecting district envelope plus 100m guard; every Building in each required GML re-parsed, not cached geometry.'},sourceCounts,cacheAudit:{file:base+'/53394525-geometry.json',sha256:sha(cachedBytes),cachedBuildingCount:cached.buildings.length,nativeSourceBuildingCount:native25Ids.size,missingNativeIds:missingCachedIds,staleCachedIds:cached.buildings.filter(b=>!native25Ids.has(b.id)).map(b=>b.id)},previousSelectedCount:old.selectedBuildingIds.length,nativeSelectedCount:ids.size,omittedCount:omitted.length,omittedBuildings:omitted.map(b=>({id:b.id,name:b.name,sourceMesh:b.sourceMesh,lod:b.lod,blocks:blocks.filter(k=>k.selectedBuildingIds.includes(b.id)).flatMap(k=>k.positions),absentFromPreviousGeometry:!oldGeometryIds.has(b.id),min:b.min,max:b.max})),previousIdsAbsentFromNativeSelection:removed,blocks:blockAudit,roadEnvelopeBuildingIds:geometry.buildings.filter(b=>!assigned.has(b.id)).map(b=>b.id),geometry:{buildingCount:ids.size,polygonCount:geometry.buildings.reduce((n,b)=>n+b.polygons.length,0),completeBuildingsUnclipped:true,highestAvailableNativeLOD:true,emptyGeometryFailures:failures,duplicateBuildingIds:duplicates},textures:{polygonCount:Object.keys(geometry.textures).length,assignmentCount:geometry.textureReferences.length,uvRingCount,uvErrors,nativeImageURIUnchanged:true,nativeUVNumbersUnchanged:true,imagePathsResolvedRelativeToSourceGml:true,imagesDownloaded:false,untexturedPolygons:geometry.buildings.reduce((n,b)=>n+b.polygons.filter(p=>!geometry.textures[p.id]).length,0)},limitations:['Coverage concerns PLATEAU native buildings in the existing actual-road 3x3 district; W and NW are one continuous park block.','Road topology (0.5m raster, 0.75m simplification) is inherited, not resurveyed.','Images remain native URI/UV references; availability of image bytes and viewer/artwork application are separate tasks.','100m adjacent-tile guard does not assert completeness for arbitrary features spanning more than 100m into the district from a nonintersecting tile.']};
const scope={...old,schemaVersion:2,geometryFiles:[output+'/geometry.json'],selectedBuildingIds:geometry.buildings.map(b=>b.id),blocks,sources:geometry.sources,coverage:{complete:audit.complete,requiredMeshes:required.map(t=>t.mesh),missingMeshes:[],selectedBlocksClosed:blocks.every(b=>!b.touchesEdge),nativeSelectedBuildingCount:ids.size,sourceBuildingCounts:sourceCounts,buildingSelectionRule:old.coverage.buildingSelectionRule,allRequiredBuildingGmlReparsed:true,scopeAuditFile:output+'/scope-audit.json'},evidence:{previousScopeFile:previous+'/scope.json',previousSelectedCount:old.selectedBuildingIds.length,omittedCount:omitted.length,roadEnvelopeBuildingIds:audit.roadEnvelopeBuildingIds},notes:[...old.notes.filter(n=>!n.startsWith('Three selected')&&!n.startsWith('Native geometry')),'All selected buildings re-extracted from CRC-checked native GML, including original mesh 53394525.','Native imageURI strings and UV values are preserved; texture.imagePath resolves against source GML directory.','Road files remain the previous verified topology/surveyed-height products. No artwork or viewer modifications are performed.']};
await fs.mkdir(path.join(root,output),{recursive:true});
for(const [name,data] of [['geometry.json',geometry],['scope.json',scope],['scope-audit.json',audit]])await fs.writeFile(path.join(root,output,name),JSON.stringify(data,name==='geometry.json'?null:2),{flag:'wx'});
console.log(JSON.stringify({complete:audit.complete,nativeSelectedCount:ids.size,omittedCount:omitted.length,blocks:blockAudit,uvErrors:uvErrors.length,failures,output},null,2));
if(!audit.complete)process.exitCode=1;
