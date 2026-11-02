/** Independent read-only source semantic/geometry audit. Only writes ownership-inventory.json. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {SaxesParser} from 'saxes';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {polygon,triangulate,descendants,sub,dot,cross} from './plateau-geometry.mjs';

const paths={
  geometry:'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json',
  cityGml:'data/plateau/plateau-13104-shinjuku-ku-2025/udx/bldg/53394525_bldg_6697_op.gml',
  v106:'public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb',
  v32:'public/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb',
  positionMap:'data/texture-city/tocho-style-pilot-20261015/v33-diagnostics-20261018/v106-to-v32-position-face-map-v33.json',
  approvedStyle:'public/assets/tocho-landmark/wall-hour-20261018/wall-illustrated-v1.png',
};
const output='data/texture-city/tocho-whole-illustrated-20261018/ownership-inventory.json';
const buildingId='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const hashes=Object.fromEntries(Object.entries(paths).map(([k,v])=>[k,sha(fs.readFileSync(v))]));
const geo=JSON.parse(fs.readFileSync(paths.geometry)),building=geo.buildings.find(b=>b.id===buildingId);
const previousMap=JSON.parse(fs.readFileSync(paths.positionMap));
check(previousMap.hashes.v106===hashes.v106&&previousMap.hashes.v32===hashes.v32,'Position map input hash mismatch');

// Retain only the requested building subtree, not the whole 94 MB document.
let tree=null,stack=[],active=false;
const parser=new SaxesParser({xmlns:false});
parser.on('opentag',t=>{
  if(t.attributes['gml:id']===buildingId)active=true;
  if(!active)return;
  const n={t:t.name,a:t.attributes,c:[],text:''};
  if(stack.length)stack.at(-1).c.push(n);else tree=n;
  stack.push(n);
});
parser.on('text',t=>{if(active)stack.at(-1).text+=t;});
parser.on('closetag',()=>{if(active){stack.pop();if(!stack.length)active=false;}});
for await(const chunk of fs.createReadStream(paths.cityGml,{encoding:'utf8'}))parser.write(chunk);
parser.close();check(tree,'CityGML building not found');
const semantics=new Map(),installationMetadata=[];
function walk(n,ancestors=[]){
  const chain=[...ancestors,n];
  if(n.t==='bldg:BuildingInstallation')installationMetadata.push({id:n.a['gml:id'],
    properties:n.c.filter(c=>!c.t.includes('Geometry')&&!c.t.includes('boundedBy')).map(c=>({name:c.t,text:c.text.trim(),attributes:c.a})),
    polygonCount:descendants(n,'gml:Polygon').length});
  if(n.t==='gml:Polygon'&&n.a['gml:id']){
    const inst=chain.find(c=>c.t==='bldg:BuildingInstallation');
    const surf=[...chain].reverse().find(c=>/^bldg:(WallSurface|RoofSurface|GroundSurface|ClosureSurface|OuterCeilingSurface|OuterFloorSurface)$/.test(c.t));
    const type=surf?.t.split(':')[1]??(inst?'BuildingInstallation':'Unclassified');
    semantics.set(n.a['gml:id'],{type,surfaceId:surf?.a['gml:id']??null,installationId:inst?.a['gml:id']??null,
      lodPath:chain.filter(c=>/^bldg:lod/.test(c.t)).map(c=>c.t),source:polygon(n,geo.origin)});
  }
  for(const child of n.c)walk(child,chain);
}
walk(tree);
const minmax=pts=>({min:[0,1,2].map(d=>Math.min(...pts.map(p=>p[d]))),max:[0,1,2].map(d=>Math.max(...pts.map(p=>p[d])))});
const normalClass=n=>Math.abs(n[1])<.15?'vertical':Math.abs(n[1])>.95?'horizontal':'sloped';
const area2=pts=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p[0]*q[1]-q[0]*p[1];},0))*.5;
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function clippedPolygon(subject,clip){
  let result=subject;
  const sense=Math.sign(cross2(...clip))||1;
  for(let e=0;e<3&&result.length;e++){
    const a=clip[e],b=clip[(e+1)%3],input=result;result=[];
    let old=input.at(-1),dOld=sense*cross2(a,b,old);
    for(const p of input){
      const d=sense*cross2(a,b,p);
      if((d>=0)!==(dOld>=0)){
        const t=dOld/(dOld-d);result.push([old[0]+t*(p[0]-old[0]),old[1]+t*(p[1]-old[1])]);
      }
      if(d>=0)result.push(p);
      old=p;dOld=d;
    }
  }
  return result;
}
const sourcePolygons=building.polygons.map((p,index)=>{
  const s=semantics.get(p.id);check(s,`Missing CityGML id ${p.id}`);
  check(JSON.stringify(s.source)===JSON.stringify(p),`CityGML coordinate/ring mismatch ${p.id}`);
  const t=triangulate(p.rings.map(r=>r.points)),pts=p.rings.flatMap(r=>r.points),bbox=minmax(pts);
  const planeError=Math.max(...pts.map(p=>Math.abs(dot(sub(p,t.o),t.normal))));
  const ears=[];
  for(let k=0;k<t.indices.length;k+=3)ears.push(t.indices.slice(k,k+3).map(i=>[t.flat[2*i],t.flat[2*i+1]]));
  return {index,id:p.id,type:s.type,surfaceId:s.surfaceId,installationId:s.installationId,lodPath:s.lodPath,
    rings:p.rings.length,bbox,normal:t.normal,orientation:normalClass(t.normal),planeError,area:ears.reduce((s,e)=>s+area2(e),0),
    sourceImage:geo.textures[p.id]?.image??null,t,ears};
});
check(building.walls.every(w=>semantics.get(w.id)?.type==='WallSurface'),'Extracted walls disagree with GML');

// Full triangle containment: project into each source plane, clip against an
// earcut triangulation including holes, and require union area >= 99.9999%.
// 3 mm is source-coordinate tolerance; 80 mm is diagnostic offset only.
const strictTolerance=.003,offsetTolerance=.08,coverageThreshold=.999999,boundaryPrecision=.00003;
const cellCache=new Map();
function candidatesAt(c){
  const cell=c.map(v=>Math.floor(v/10)),key=cell.join(',');
  if(!cellCache.has(key))cellCache.set(key,sourcePolygons.filter(p=>
    cell.every((v,d)=>p.bbox.max[d]+offsetTolerance>=v*10&&p.bbox.min[d]-offsetTolerance<=(v+1)*10)));
  return cellCache.get(key);
}
function ownerCandidates(vertices,n){
  const centre=[0,1,2].map(d=>vertices.reduce((s,v)=>s+v[d],0)/3),out=[];
  for(const p of candidatesAt(centre)){
    if(vertices.some(v=>v.some((x,d)=>x<p.bbox.min[d]-offsetTolerance||x>p.bbox.max[d]+offsetTolerance)))continue;
    if(Math.abs(dot(n,p.normal))<.999)continue;
    let maxDistance=Math.max(...vertices.map(v=>Math.abs(dot(sub(v,p.t.o),p.normal))));
    if(maxDistance>offsetTolerance+p.planeError)continue;
    const xy=vertices.map(v=>[dot(sub(v,p.t.o),p.t.u),dot(sub(v,p.t.o),p.t.v)]),area=area2(xy);
    if(area<1e-12)continue;
    let covered=0,strictCovered=0,supportMax=0,strictMax=0;
    for(let ei=0;ei<p.ears.length;ei++){
      const fragment=clippedPolygon(xy,p.ears[ei]),fa=fragment.length>=3?area2(fragment):0;
      if(fa<=1e-14)continue;
      let distance=maxDistance;
      if(p.planeError>strictTolerance){
        // Nonplanar source polygons are interpreted as their actual earcut
        // support triangles, never by merely widening the plane tolerance.
        const ids=p.t.indices.slice(ei*3,ei*3+3),sv=ids.map(i=>p.t.points[i]);
        const nn=cross(sub(sv[1],sv[0]),sub(sv[2],sv[0])),nl=Math.hypot(...nn);
        if(nl<1e-12)continue;
        const sn=nn.map(v=>v/nl);if(Math.abs(dot(sn,n))<.999)continue;
        const den=cross2(...xy);
        distance=Math.max(...fragment.map(f=>{
          const w1=cross2(xy[0],f,xy[2])/den,w2=cross2(xy[0],xy[1],f)/den;
          const world=[0,1,2].map(d=>vertices[0][d]*(1-w1-w2)+vertices[1][d]*w1+vertices[2][d]*w2);
          return Math.abs(dot(sub(world,sv[0]),sn));
        }));
      }
      if(distance<=offsetTolerance){covered+=fa;supportMax=Math.max(supportMax,distance);}
      if(distance<=strictTolerance){strictCovered+=fa;strictMax=Math.max(strictMax,distance);}
    }
    const perimeter=xy.reduce((s,v,i)=>s+Math.hypot(v[0]-xy[(i+1)%3][0],v[1]-xy[(i+1)%3][1]),0);
    const precisionArea=perimeter*boundaryPrecision;
    const isFull=a=>a>=area*.999&&a>=area*coverageThreshold-precisionArea&&a<=area*1.00001;
    if(isFull(strictCovered)){covered=strictCovered;maxDistance=strictMax;}
    else maxDistance=Math.max(supportMax,strictTolerance+1e-10);
    const coverage=covered/area;
    if(isFull(covered))out.push({index:p.index,maxDistance,coverage});
  }
  return out;
}
const runs=(arr)=>{
  const out=[];for(const n of arr){const r=out.at(-1);if(r&&r[1]+1===n)r[1]=n;else out.push([n,n]);}return out;
};
function addGroup(groups,key,record,face,area,vertical){
  let g=groups.get(key);if(!g){g={...record,faces:[],count:0,area:0,verticalFaces:0};groups.set(key,g);}
  g.faces.push(face);g.count++;g.area+=area;if(vertical)g.verticalFaces++;
}
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc=await io.read(paths.v106),parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
check(parts.length===34,'Unexpected v106 primitive count');
const meshMatrices=new Map();
for(const n of doc.getRoot().listNodes())if(n.getMesh()){
  check(!meshMatrices.has(n.getMesh()),'Instanced mesh requires separate instance inventory');
  meshMatrices.set(n.getMesh(),n.getWorldMatrix());
}
const point=(p,m)=>[0,1,2].map(d=>m[d]*p[0]+m[4+d]*p[1]+m[8+d]*p[2]+m[12+d]);
const totals={},primitiveInventory=[],faceCatalog=new Map(),faceResults=[];
const keyPoint=p=>p.map(v=>Math.round(v*1000)).join(',');
const keyFace=v=>v.map(keyPoint).sort().join('|');
function count(k,area=0){totals[k]??={faces:0,area:0};totals[k].faces++;totals[k].area+=area;}
for(let id=0;id<parts.length;id++){
  const p=parts[id],mesh=doc.getRoot().listMeshes().find(m=>m.listPrimitives().includes(p)),matrix=meshMatrices.get(mesh);
  const a=p.getAttribute('POSITION'),P=a.getArray(),I=p.getIndices()?.getArray()??Uint32Array.from({length:a.getCount()},(_,i)=>i);
  const groups=new Map(),results=[];check(p.getMode()===4,'Non-triangle primitive');
  for(let k=0;k<I.length;k+=3){
    const vertices=[0,1,2].map(j=>point([...P.slice(I[k+j]*3,I[k+j]*3+3)],matrix));
    const v=cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])),length=Math.hypot(...v),area=length/2;
    const normal=length>1e-12?v.map(x=>x/length):[0,0,0],orientation=normalClass(normal);
    const candidates=length>1e-12?ownerCandidates(vertices,normal):[],strict=candidates.filter(c=>c.maxDistance<=strictTolerance);
    const selected=strict.length?strict:candidates;
    const kind=length<=1e-12?'degenerate':strict.length===1?'strictUnique':strict.length>1?'strictAmbiguous':selected.length?'offsetCandidate':'unmatched';
    const indices=selected.map(c=>c.index).sort((a,b)=>a-b),types=[...new Set(indices.map(i=>sourcePolygons[i].type))].sort();
    const semantic=kind==='strictUnique'?types[0]:'Unknown';
    const windowDecision=semantic==='WallSurface'&&orientation==='vertical'?'wallCandidateNeedsWindowEvidence':'deny';
    const rec={kind,polygonIndices:indices,semantic,candidateTypes:types,orientation,windowDecision};
    const key=JSON.stringify(rec),face=k/3;
    addGroup(groups,key,rec,face,area,orientation==='vertical');
    const result={...rec,primitive:id,face,area,maxPlaneDistance:selected.length?Math.max(...selected.map(c=>c.maxDistance)):null};
    results.push(result);const fk=keyFace(vertices);check(!faceCatalog.has(fk),'v106 duplicate millimetre triangle key');faceCatalog.set(fk,result);
    count(kind,area);count(`semantic:${semantic}`,area);
    if(semantic==='BuildingInstallation'&&orientation==='vertical')count('strictInstallationVertical',area);
  }
  faceResults.push(results);
  primitiveInventory.push({id,mesh:mesh.getName(),triangles:I.length/3,attributes:p.listSemantics(),
    material:p.getMaterial()?.getName(),primitiveExtrasUntrusted:p.getExtras(),
    groups:[...groups.values()].map(g=>({...g,faces:undefined,faceRanges:runs(g.faces)}))});
  console.log(JSON.stringify({v106Primitive:id,faces:I.length/3,groups:groups.size,kinds:Object.fromEntries([...new Set(results.map(r=>r.kind))].map(k=>[k,results.filter(r=>r.kind===k).length]))}));
}

// Transfer only identity from v32. Its role is retained as an untrusted label.
const target=await io.read(paths.v32),targetParts=target.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const targetInventory=[],targetSeen=new Set();let targetMatched=0,targetUnmatched=0,windowLabeledNonWall=0;
for(let id=0;id<targetParts.length;id++){
  const p=targetParts[id],P=p.getAttribute('POSITION').getArray(),I=p.getIndices().getArray(),role=p.getExtras()?.semantic;
  const groups=new Map(),sourceIds=new Set();
  // Both versions have identity world transforms, verified below.
  for(let k=0;k<I.length;k+=3){
    const vertices=[0,1,2].map(j=>[...P.slice(I[k+j]*3,I[k+j]*3+3)]),r=faceCatalog.get(keyFace(vertices));
    if(!r){targetUnmatched++;continue;}
    check(!targetSeen.has(`${r.primitive}:${r.face}`),'Duplicate target identity');
    targetSeen.add(`${r.primitive}:${r.face}`);targetMatched++;sourceIds.add(r.primitive);
    if(['wall','cartoon-window-wall'].includes(role)&&['RoofSurface','BuildingInstallation','GroundSurface'].includes(r.semantic))windowLabeledNonWall++;
    const rec={kind:r.kind,polygonIndices:r.polygonIndices,semantic:r.semantic,candidateTypes:r.candidateTypes,orientation:r.orientation,windowDecision:r.windowDecision};
    addGroup(groups,JSON.stringify(rec),rec,k/3,r.area,r.orientation==='vertical');
  }
  targetInventory.push({id,roleUntrusted:role,triangles:I.length/3,v106SourcePrimitives:[...sourceIds],
    groups:[...groups.values()].map(g=>({...g,faces:undefined,faceRanges:runs(g.faces)}))});
}
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
check([...doc.getRoot().listNodes(),...target.getRoot().listNodes()].every(n=>n.getWorldMatrix().every((v,i)=>Math.abs(v-identity[i])<1e-10)),'Nonidentity transform: v32 transfer invalid');
check(targetUnmatched===0&&targetMatched===previousMap.totals.matched,'v32 transfer differs from supplied map');
const sourceTypeCounts={};for(const p of sourcePolygons){sourceTypeCounts[p.type]??={polygons:0,orientations:{},area:0};const r=sourceTypeCounts[p.type];r.polygons++;r.orientations[p.orientation]=(r.orientations[p.orientation]??0)+1;r.area+=p.area;}
const installationInventory=installationMetadata.map(m=>{
  const pp=sourcePolygons.filter(p=>p.installationId===m.id);
  const matches=faceResults.flat().filter(r=>r.kind==='strictUnique'&&pp.some(p=>p.index===r.polygonIndices[0]));
  return {...m,matchedGeometryPolygons:pp.length,bbox:pp.length?minmax(pp.flatMap(p=>[p.bbox.min,p.bbox.max])):null,
    verticalPolygons:pp.filter(p=>p.orientation==='vertical').length,strictUniqueFaces:matches.length,
    strictUniqueVerticalFaces:matches.filter(r=>r.orientation==='vertical').length};
});
const exclusionPredicates={
  installationCertain:r=>r.semantic==='BuildingInstallation',
  installationVerticalCertain:r=>r.semantic==='BuildingInstallation'&&r.orientation==='vertical',
  installationAmbiguous:r=>r.kind==='strictAmbiguous'&&r.candidateTypes.includes('BuildingInstallation'),
  installationOffsetCandidates:r=>r.kind==='offsetCandidate'&&r.candidateTypes.includes('BuildingInstallation'),
  roofCertain:r=>r.semantic==='RoofSurface',
  roofAmbiguous:r=>r.kind==='strictAmbiguous'&&r.candidateTypes.includes('RoofSurface'),
  roofOffsetCandidates:r=>r.kind==='offsetCandidate'&&r.candidateTypes.includes('RoofSurface'),
  groundCertain:r=>r.semantic==='GroundSurface',
  unknownOrOffset:r=>r.semantic==='Unknown',
  denyWindows:r=>r.windowDecision==='deny',
};
const perPrimitiveExclusions=faceResults.map((rr,id)=>({primitive:id,
  ...Object.fromEntries(Object.entries(exclusionPredicates).map(([name,predicate])=>{
    const triangleIds=rr.filter(predicate).map(r=>r.face);
    return [name,{count:triangleIds.length,triangleIds,faceRanges:runs(triangleIds)}];
  }))}));
const validateRanges=primitives=>{
  for(const p of primitives){
    const seen=new Uint8Array(p.triangles);
    for(const g of p.groups){
      let count=0;
      for(const [lo,hi]of g.faceRanges)for(let f=lo;f<=hi;f++){
        check(f>=0&&f<p.triangles&&!seen[f],`Invalid or overlapping face range ${p.id}/${f}`);seen[f]=1;count++;
      }
      check(count===g.count,'Range count mismatch');
    }
    check(seen.every(v=>v===1),'Face inventory incomplete');
  }
};
validateRanges(primitiveInventory);validateRanges(targetInventory);
for(const [k,v]of Object.entries(paths))check(sha(fs.readFileSync(v))===hashes[k],`Input changed during audit: ${k}`);
const report={schemaVersion:1,createdAt:new Date().toISOString(),buildingId,paths,sha256:hashes,
  scope:'Source CityGML semantic ancestry and full-triangle geometry ownership; no image/model/browser generation',
  approvedStyle:'User approval identifies style quality only; this audit does not infer window placement from the PNG.',
  coordinates:{origin:geo.origin,axes:'X east, Y up, Z south; millimetre-rounded source coordinates',worldTransformsIdentity:true},
  source:{buildingName:building.name,lod:building.lod,polygons:sourcePolygons.length,wallArrayCount:building.walls.length,
    allPolygonIdsRingsAndCoordinatesDirectCityGmlVerified:true,sourceTypeCounts,
    sourcePolygons:sourcePolygons.map(({t,ears,...r})=>r),installationInventory,
    allWallOpeningsZero:building.walls.every(w=>w.openings===0)},
  method:{strictPlaneToleranceMeters:strictTolerance,offsetDiagnosticToleranceMeters:offsetTolerance,
    minimumAbsoluteNormalDot:.999,fullTriangleCoverageThreshold:coverageThreshold,
    verticalAbsoluteNormalYLessThan:.15,horizontalAbsoluteNormalYGreaterThan:.95,
    containment:'Hole-aware earcut triangulation; sum of triangle/ear intersection areas. For source nonplanarity over 3 mm, intersecting fragments are checked against actual source ear support planes.',
    sourceNonplanaritySwitchMeters:strictTolerance,boundaryFloat32PrecisionMeters:boundaryPrecision,
    coverageAreaPrecisionAllowance:'projected triangle perimeter * 0.00003 square metres, in addition to 1 ppm relative area; handles Float32 boundary roundoff.',
    minimumCoverageEvenWithPrecisionAllowance:.999,
    positionIdentityQuantizationMeters:.001,
    faceRanges:'Inclusive [first,last], zero-based face indices inside the primitive; polygonIndices refer to source.sourcePolygons[].index.',
    decision:'Only strictUnique vertical WallSurface becomes a wall candidate. Roof, installation, ground, ambiguity, offsets and unmatched faces deny windows. WallSurface alone does not prove windows.'},
  totals,v106:{primitives:parts.length,triangles:faceResults.reduce((s,r)=>s+r.length,0),primitiveInventory,
    exclusions:{indexing:'Zero-based flattened mesh/primitive order. Triangle IDs are index-buffer triplets, or sequential POSITION triplets for non-indexed primitives. Do not use these IDs after reordering/retriangulating geometry.',
      categoryOverlap:'Lists intentionally overlap. denyWindows is the union gate; certain categories require strictUnique source ownership, ambiguous/offset categories never certify an owner.',
      integration:'Retain source photo/native TEXCOORD_0 values. Apply exclusions by triangle membership, not by primitive/material name. UV preservation alone does not establish that an atlas region contains windows.',
      perPrimitive:perPrimitiveExclusions}},
  v32:{primitives:targetParts.length,identityMatches:targetMatched,identityUnmatched:targetUnmatched,
    suppliedMapHashesVerified:true,windowLabeledStrictNonWallFaces:windowLabeledNonWall,primitiveInventory:targetInventory},
  limitations:[
    'geometry.json polygons have only id/rings; explicit semantic types require CityGML parent elements. The walls array only identifies WallSurface membership.',
    'BuildingInstallation is a semantic object, not a universal rooftop-equipment category. It can contain attachments elsewhere; rooftop location needs height/support context.',
    'Detailed facade relief and 0.065 m photographic overlays may not lie on coarse LOD2 source planes. Offset matches are diagnostic only, never strict ownership.',
    'A 3 mm plane tolerance and 30 micrometre boundary precision allowance are not exact arithmetic identity; thin coincident source faces may be ambiguous. Unsupported boundary crossing and unmatched detail remain unknown.',
    'No Window/Door geometry or per-window approval follows from WallSurface; openings=0 means absent modeled openings, not proof of a windowless real wall.',
    'v106 extras/material names and v32 semantic/windowAllowed labels are historical claims, not independent source semantics.',
    'This is source-semantic attribution, not real-photo correspondence, visual acceptance or approval of the full illustrated result.'
  ],
  completeWholeModelSemanticOwnership:totals.strictUnique?.faces===faceResults.reduce((s,r)=>s+r.length,0),
  validation:{allV106AndV32TriangleRangesDisjointAndComplete:true,oneToOnePositionIdentityTransfer:true,allInputHashesPreserved:true},
  fullIllustratedAppearanceApproved:false,inputsModified:false};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,sourceTypeCounts,totals,installations:installationInventory.length,v32WindowLabeledStrictNonWallFaces:windowLabeledNonWall,bytes:fs.statSync(output).size},null,2));
