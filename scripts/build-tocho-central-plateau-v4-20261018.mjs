import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {SaxesParser} from 'saxes';
import {Document, NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS, KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {BufferGeometry, Float32BufferAttribute, Vector3, Matrix4} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate, dot} from './plateau-geometry.mjs';

const id='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const source='data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
const gml='data/plateau/plateau-13104-shinjuku-ku-2025/udx/bldg/53394525_bldg_6697_op.gml';
const custom='public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb';
const art='public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png';
const oldArt='public/assets/tocho-landmark/whole-illustrated-20261018';
const output='public/assets/tocho-district-plateau-v4-20261018/central-plateau.glb';
const auditPath='data/texture-city/tocho-district-plateau-v4-20261018/central-audit.json';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceBytes=await fs.readFile(source),geo=JSON.parse(sourceBytes),building=geo.buildings.find(b=>b.id===id);
assert(building);assert.equal(geo.buildings.filter(b=>b.id===id).length,1);
// Re-read semantic ancestry from CityGML, rather than trusting custom mesh names.
const gmlBytes=await fs.readFile(gml),semantics=new Map(),stack=[];
const parser=new SaxesParser({xmlns:false});
parser.on('opentag',t=>{
 const parent=stack.at(-1),s={central:parent?.central||t.attributes['gml:id']===id,role:parent?.role,installation:parent?.installation||t.name==='bldg:BuildingInstallation'};
 if(['bldg:WallSurface','bldg:RoofSurface','bldg:GroundSurface'].includes(t.name))s.role=t.name.split(':')[1];
 if(s.central&&t.name==='gml:Polygon'&&t.attributes['gml:id'])semantics.set(t.attributes['gml:id'],{type:s.installation?'BuildingInstallation':s.role,installation:!!s.installation});
 stack.push(s);
});
parser.on('closetag',()=>stack.pop());parser.write(gmlBytes.toString('utf8')).close();
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=new Document(),buffer=doc.createBuffer();
const scene=doc.createScene('Central Tocho: source PLATEAU only'),mesh=doc.createMesh(id);
scene.addChild(doc.createNode(building.name||id).setMesh(mesh).setExtras({buildingId:id,source,origin:geo.origin,geometry:'native source polygons only'}));
const unlit=doc.createExtension(KHRMaterialsUnlit),artBytes=await fs.readFile(art);
const module=await sharp(artBytes).extract({left:48,top:188,width:880,height:181}).removeAlpha().raw().toBuffer();
const imageSources=[{path:art,sha256:hash(artBytes),crop:{left:48,top:188,width:880,height:181}}];
function material(name,png,role,windows){
 const tex=doc.createTexture(name).setImage(png).setMimeType('image/png');
 const m=doc.createMaterial(name).setBaseColorTexture(tex).setBaseColorFactor([1,1,1,1]).setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit()).setExtras({surfaceRole:role,windowAllowed:windows,appearanceInferred:true,photoRegistrationCertified:false});
 m.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);return m;
}
const mats={};
for(const [role,file]of [['stone','stone-panels.png'],['roof','roof-paving.png'],['equipment','equipment-louvers.png'],['ground','roof-paving.png']]){
 const bytes=await fs.readFile(oldArt+'/'+file);imageSources.push({path:oldArt+'/'+file,sha256:hash(bytes)});mats[role]=material(role,bytes,role==='stone'?'wall':role,false);
}
const polygons=[],nativeTriangles=[],skipped=[];
function vertexKey(v){return v.map(x=>Math.fround(x)||0).join(',');}
function key(t){return t.map(vertexKey).sort().join('|');}
function multiset(ts){const m=new Map();for(const t of ts){const k=key(t);m.set(k,(m.get(k)||0)+1);}return m;}
function digest(m){return hash(Buffer.from([...m].sort(([a],[b])=>a.localeCompare(b)).map(([k,n])=>k+'#'+n).join('\n')));}
const nativeSet=new Set();
for(const p of building.polygons){
 const s=semantics.get(p.id);assert(s?.type,'Missing native CityGML semantic '+p.id);
 const t=triangulate(p.rings.map(r=>r.points));
 if(!t.indices.length){skipped.push({id:p.id,reason:'Source triangulator returns zero triangles',points:p.rings.map(r=>r.points)});continue;}
 const role=s.installation?'equipment':s.type==='RoofSurface'?'roof':s.type==='GroundSurface'?'ground':s.type==='WallSurface'?'wall':null;
 assert(role,'Unresolved source semantic');
 const wall=role==='wall',u=wall?[-t.normal[2],0,t.normal[0]]:[1,0,0],len=Math.hypot(...u);
 if(len>1e-9)for(let i=0;i<3;i++)u[i]/=len;else u.splice(0,3,1,0,0);
 const coord=q=>dot(q,u),vertical=q=>wall?q[1]:dot(q,t.v);
 const lo=Math.min(...t.points.map(coord)),hi=Math.max(...t.points.map(coord));
 const bottom=Math.min(...t.points.map(vertical)),top=Math.max(...t.points.map(vertical));
 const width=hi-lo,height=top-bottom,windows=wall&&width>=2.9&&height>=2.6&&Math.abs(t.normal[1])<.15;
 let mat=mats[role==='wall'?'stone':role],boundaryPixels=0;
 if(windows){
  const bays=Math.max(1,Math.round(width/3.35)),W=Math.min(1024,Math.max(64,bays*90)),H=Math.min(2048,Math.max(64,Math.ceil(height*14))),pixels=Buffer.alloc(W*H*3);
  const edges=[0,149,278,429,572,702,880];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const X=x/(W-1)*width,Y=top-y/(H-1)*height,bay=x/(W-1)*bays,cell=Math.min(bays-1,Math.floor(bay))%6,phase=bay-Math.floor(bay);
   const sx=Math.min(879,Math.floor(edges[cell]+phase*(edges[cell+1]-edges[cell]))),sy=Math.min(180,Math.floor((((174-Y)/3.85%1+1)%1)*181));
   const cap=X<.25||X>width-.25||Y<bottom+.35||Y>top-.35;
   for(let c=0;c<3;c++)pixels[(y*W+x)*3+c]=cap?[166,160,147][c]:module[(sy*880+sx)*3+c];
  }
  // Trace every original ring, including holes: the artwork closes at real edges.
  const paths=p.rings.map(r=>r.points.map((q,i)=>(i?'L':'M')+coord(q)+','+(-q[1])).join(' ')+' Z').join(' ');
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${lo} ${-top} ${width} ${height}" preserveAspectRatio="none"><path d="${paths}" fill="none" stroke="#a6a093" stroke-width="0.65" stroke-linejoin="miter"/></svg>`);
  const png=await sharp(pixels,{raw:{width:W,height:H,channels:3}}).composite([{input:svg}]).png().toBuffer();
  const raw=await sharp(png).removeAlpha().raw().toBuffer();
  for(let y=0;y<H;y++)for(const x of [0,W-1]){const c=[...raw.subarray((y*W+x)*3,(y*W+x)*3+3)];assert(c.every((v,i)=>Math.abs(v-[166,160,147][i])<=1));boundaryPixels++;}
  mat=material('finite-wall '+p.id,png,'wall',true);
 }
 const positions=[],normals=[],uv=[];
 for(const q of t.points){positions.push(...q);normals.push(...t.normal);uv.push(width>1e-10?(coord(q)-lo)/width:0,height>1e-10?(top-vertical(q))/height:0);}
 assert(uv.every(x=>Number.isFinite(x)&&x>=-1e-8&&x<=1+1e-8));
 const accessor=(type,arr)=>doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
 mesh.addPrimitive(doc.createPrimitive().setMaterial(mat).setAttribute('POSITION',accessor('VEC3',new Float32Array(positions))).setAttribute('NORMAL',accessor('VEC3',new Float32Array(normals))).setAttribute('TEXCOORD_0',accessor('VEC2',new Float32Array(uv))).setIndices(accessor('SCALAR',new Uint32Array(t.indices))).setExtras({sourcePolygonId:p.id,sourceSemantic:s.type,surfaceRole:role,windows,geometryModified:false}));
 for(let i=0;i<t.indices.length;i+=3){const tri=t.indices.slice(i,i+3).map(j=>t.points[j]);nativeTriangles.push(tri);for(const v of tri)nativeSet.add(vertexKey(v));}
 polygons.push({id:p.id,semantic:s.type,role,windows,triangles:t.indices.length/3,rings:p.rings.length,width,height,finiteUV:true,edgeCollarMeters:windows?.325:0,verifiedBoundaryPixels:boundaryPixels,triangulationDeviation:t.deviation});
}
console.log(JSON.stringify({stage:'native-built',triangles:nativeTriangles.length,polygons:polygons.length,zeroTrianglePolygons:skipped.length}));
// Compare custom geometry in world coordinates against the source surface BVH.
const bg=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(nativeTriangles.flat(2),3)),bvh=new MeshBVH(bg);
const old=await io.read(custom),customRecords=[],distanceCache=new Map(),v=new Vector3(),tolerance=.003;
function distance(q){const k=q.join(',');if(!distanceCache.has(k)){v.fromArray(q);distanceCache.set(k,bvh.closestPointToPoint(v,{},0,Infinity).distance);}return distanceCache.get(k);}
const sourceCounts=multiset(nativeTriangles),customCounts=new Map();
for(const node of old.getRoot().listNodes()){
 if(!node.getMesh())continue;const matrix=new Matrix4().fromArray(node.getWorldMatrix());
 for(const [pi,p]of node.getMesh().listPrimitives().entries()){
  assert.equal(p.getMode(),4);const a=p.getAttribute('POSITION'),idx=p.getIndices()?.getArray()??Array.from({length:a.getCount()},(_,i)=>i),points=[];
  for(let i=0;i<a.getCount();i++)points.push(new Vector3().fromArray(a.getArray(),i*3).applyMatrix4(matrix).toArray());
  const rec={node:node.getName(),primitive:pi,material:p.getMaterial()?.getName(),extras:p.getExtras(),triangles:idx.length/3,exactSourceTriangles:0,trianglesWithOffSourceVertices:0,trianglesWithOffSourceCentroids:0,maxVertexSurfaceDistanceMeters:0,nonSourceVertexPositions:0,bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}};
  for(const q of points){if(!nativeSet.has(vertexKey(q)))rec.nonSourceVertexPositions++;for(let k=0;k<3;k++){rec.bounds.min[k]=Math.min(rec.bounds.min[k],q[k]);rec.bounds.max[k]=Math.max(rec.bounds.max[k],q[k]);}}
  for(let i=0;i<idx.length;i+=3){const tri=[points[idx[i]],points[idx[i+1]],points[idx[i+2]]],k=key(tri);customCounts.set(k,(customCounts.get(k)||0)+1);if(sourceCounts.has(k))rec.exactSourceTriangles++;
   const d=Math.max(...tri.map(distance));rec.maxVertexSurfaceDistanceMeters=Math.max(rec.maxVertexSurfaceDistanceMeters,d);if(d>tolerance)rec.trianglesWithOffSourceVertices++;
   const center=[0,1,2].map(j=>(tri[0][j]+tri[1][j]+tri[2][j])/3);if(distance(center)>tolerance)rec.trianglesWithOffSourceCentroids++;
  }
  customRecords.push(rec);
 }
}
const bytes=await io.writeBinary(doc);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,bytes);
// Reopen serialized bytes and independently enumerate the emitted triangles.
const reopened=await io.read(output),emitted=[],roleCounts={};let uvValues=0;
assert.equal(reopened.getRoot().listNodes().length,1);
for(const n of reopened.getRoot().listNodes())if(n.getMesh()){
 assert.equal(n.getExtras().buildingId,id);
 assert.deepEqual(n.getTranslation(),[0,0,0]);assert.deepEqual(n.getRotation(),[0,0,0,1]);assert.deepEqual(n.getScale(),[1,1,1]);
}
for(const p of reopened.getRoot().listMeshes().flatMap(m=>m.listPrimitives())){
 const a=p.getAttribute('POSITION').getArray(),idx=p.getIndices().getArray(),ex=p.getExtras(),mat=p.getMaterial();
 assert.equal(mat.getExtras().windowAllowed,ex.windows);assert.equal(mat.getExtras().surfaceRole,ex.surfaceRole);assert(['wall','roof','equipment','ground'].includes(mat.getExtras().surfaceRole));if(ex.windows)assert.equal(ex.sourceSemantic,'WallSurface');
 for(const x of p.getAttribute('TEXCOORD_0').getArray()){assert(Number.isFinite(x)&&x>=-1e-7&&x<=1+1e-7);uvValues++;}
 for(let i=0;i<idx.length;i+=3)emitted.push([0,1,2].map(j=>[...a.subarray(idx[i+j]*3,idx[i+j]*3+3)]));
 roleCounts[ex.surfaceRole]=(roleCounts[ex.surfaceRole]||0)+idx.length/3;
}
const emittedCounts=multiset(emitted);assert.deepEqual(emittedCounts,sourceCounts);
const missingFromCustom=[...sourceCounts].reduce((n,[k,c])=>n+Math.max(0,c-(customCounts.get(k)||0)),0);
const report={createdAt:new Date().toISOString(),buildingId:id,scope:'Central Tocho only; no district or v3 pipeline changes',source:{path:source,sha256:hash(sourceBytes),origin:geo.origin,bounds:{min:building.min,max:building.max},polygonCount:building.polygons.length},semanticSource:{path:gml,sha256:hash(gmlBytes),method:'Direct CityGML ancestry with BuildingInstallation taking priority',matchedPolygons:building.polygons.filter(p=>semantics.has(p.id)).length},artworkSources:imageSources,output:{path:output,sha256:hash(bytes),bytes:bytes.length,triangles:emitted.length,roleTriangles:roleCounts},triangleMultisetProof:{reference:'Triangulated central building polygons from source geometry JSON, never custom v106',method:'earcut via plateau-geometry.mjs; IEEE Float32 coordinates; sorted vertex triples preserving multiplicity, ignoring winding',sourceTriangleCount:nativeTriangles.length,outputTriangleCount:emitted.length,sourceDigest:digest(sourceCounts),outputDigest:digest(emittedCounts),missing:0,extra:0,pass:true,float32MaxCoordinateErrorMeters:Math.max(...nativeTriangles.flat().flatMap(v=>v.map(x=>Math.abs(x-Math.fround(x)))))},customComparison:{path:custom,sha256:hash(await fs.readFile(custom)),triangles:customRecords.reduce((n,r)=>n+r.triangles,0),toleranceMeters:tolerance,missingExactSourceTriangles:missingFromCustom,trianglesWithOffSourceVertices:customRecords.reduce((n,r)=>n+r.trianglesWithOffSourceVertices,0),trianglesWithOffSourceCentroids:customRecords.reduce((n,r)=>n+r.trianglesWithOffSourceCentroids,0),interpretation:'Exact mismatch alone may be subdivision. Off-source samples identify geometry differing from native source at 3mm tolerance; samples do not prove full-triangle containment or historical intent.',primitives:customRecords},polygons,zeroTriangleSourcePolygons:skipped,checks:{allSourcePolygonsAccountedFor:polygons.length+skipped.length===building.polygons.length,nativeTriangleMultiset:true,finiteUVValuesChecked:uvValues,windowsOnEquipmentRoofGround:0,originalPolygonRingsUsed:true,extraMeshes:0},limitations:['Artwork scale, floor phase and facade repetition are inferred, not calibrated photo registration.','No added louvers, helipad, overlay meshes or display ground; source installations retained.','Zero-triangle polygons are explicitly listed; they produce no faces under the shared source triangulator.'],humanAppearanceApproved:false};
await fs.mkdir(path.dirname(auditPath),{recursive:true});await fs.writeFile(auditPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({output:report.output,proof:report.triangleMultisetProof,customOffSourceTriangles:report.customComparison.trianglesWithOffSourceVertices,checks:report.checks}));
