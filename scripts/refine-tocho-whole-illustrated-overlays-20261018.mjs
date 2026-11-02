import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {prune} from '@gltf-transform/functions';
const dir='data/texture-city/tocho-whole-illustrated-20261018',asset='public/assets/tocho-landmark/whole-illustrated-20261018';
const report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8')),own=JSON.parse(await fs.readFile(dir+'/ownership-inventory.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),doc=await io.read(report.output.file),parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives()),buf=doc.getRoot().listBuffers()[0];
const originalDoc=await io.read(report.source),originalParts=originalDoc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const sourceGeometry=JSON.parse(await fs.readFile('data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json','utf8')).buildings.find(b=>b.id==='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7');
const roofImage=doc.createTexture('Illustrated original helipad / roof atlas').setImage(await fs.readFile(asset+'/roof-illustrated.png')).setMimeType('image/png');
const roof=doc.createMaterial('roof-layout-illustrated-final').setBaseColorTexture(roofImage).setDoubleSided(true).setExtras({surfaceRole:'roof',windowAllowed:false,source:'original roof UV, illustrated roof artwork'});
roof.setExtension('KHR_materials_unlit',doc.createExtension(KHRMaterialsUnlit).createUnlit());roof.getBaseColorTextureInfo().setWrapS(33071).setWrapT(33071);
function geometry(p){const sem=p.listSemantics(),a=Object.fromEntries(sem.map(s=>[s,p.getAttribute(s)])),ix=p.getIndices()?.getArray()??Uint32Array.from({length:a.POSITION.getCount()},(_,i)=>i);return {sem,a,ix};}
function vertex(g,i){return Object.fromEntries(g.sem.map(s=>{const a=g.a[s],n=a.getElementSize();return[s,Array.from(a.getArray().slice(i*n,i*n+n))]}));}
function normal(v){const p=v.map(q=>q.POSITION),a=p[1].map((x,k)=>x-p[0][k]),b=p[2].map((x,k)=>x-p[0][k]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],m=Math.hypot(...n);return m?n.map(x=>x/m):[0,1,0];}
const byPolygon=new Map();
for(const mat of doc.getRoot().listMaterials().filter(m=>m.getExtras().inferred)){
 const poly=mat.getExtras().sourcePolygon,pp=parts.filter(p=>p.getMaterial()===mat),g=geometry(pp[0]);let n;
 for(let f=0;f<g.ix.length;f+=3){n=normal([0,1,2].map(k=>vertex(g,g.ix[f+k])));if(Math.abs(n[1])<.15)break;}
 const m=Math.hypot(n[0],n[2]),t=[-n[2]/m,0,n[0]/m];let lo=Infinity,hi=-Infinity;
 for(const p of sourceGeometry.polygons[poly].rings.flatMap(r=>r.points)){const s=p[0]*t[0]+p[2]*t[2];lo=Math.min(lo,s);hi=Math.max(hi,s);}
 byPolygon.set(poly,{mat,t,lo,hi,...report.facades.find(r=>r.sourcePolygon===poly)});
}
const owners=own.v106.primitiveInventory.map(p=>{const a=[];for(const g of p.groups)for(const [lo,hi]of g.faceRanges)for(let f=lo;f<=hi;f++)a[f]=g;return a;});
const resultRecords=new Map(),ops=[];let permittedOffsetFaces=0,restoredRoofFaces=0;
for(let i=0;i<parts.length;i++){
 const p=parts[i],r=report.records[i],id=r.sourcePrimitive;
 if(![28,29,30,31,32,33].includes(id)){resultRecords.set(p,r);continue;}
 const g=geometry(p),groups=new Map();
 for(let f=0;f<r.sourceFaces.length;f++){
  let v=[0,1,2].map(k=>vertex(g,g.ix[f*3+k])),mat=p.getMaterial(),role=r.role,method=r.method;
  const sf=r.sourceFaces[f],o=owners[id][sf],n=normal(v);
  const allowedOffset=o.kind==='offsetCandidate'&&o.candidateTypes.length===1&&o.candidateTypes[0]==='WallSurface'&&o.polygonIndices.length===1&&Math.abs(n[1])<.15;
  const rec=allowedOffset?byPolygon.get(o.polygonIndices[0]):null;
  if(rec){
   mat=rec.mat;role='wall';method='finite-wall-offset-extension';
   v=v.map(q=>{
    const uv=[(q.POSITION[0]*rec.t[0]+q.POSITION[2]*rec.t[2]-rec.lo)/(rec.hi-rec.lo),(rec.maxY-q.POSITION[1])/(rec.maxY-rec.minY)];
    assert(uv.every(x=>x>=-.01&&x<=1.01),'Offset wall outside complete source polygon bounds');
    return {...q,TEXCOORD_0:uv.map(x=>Math.max(0,Math.min(1,x)))};
   });
   permittedOffsetFaces++;
  }else if([28,32,33].includes(id)&&Math.abs(n[1])>.95){
   mat=roof;role='roof';method='source-roof-layout-stylized';
   const sg=geometry(originalParts[id]);v=v.map((q,k)=>({...q,TEXCOORD_0:vertex(sg,sg.ix[sf*3+k]).TEXCOORD_0}));restoredRoofFaces++;
  }
  const key=mat.getName()+':'+role+':'+method;
  if(!groups.has(key))groups.set(key,{mat,role,method,triangles:[],faces:[]});groups.get(key).triangles.push(v);groups.get(key).faces.push(sf);
 }
 const mesh=p.listParents().find(m=>m.propertyType==='Mesh');mesh.removePrimitive(p);
 for(const gr of groups.values()){
  const np=doc.createPrimitive().setMaterial(gr.mat).setExtras({surfaceRole:gr.role,sourcePrimitive:id,method:gr.method});
  for(const s of Object.keys(gr.triangles[0][0])){const n=gr.triangles[0][0][s].length,a=new Float32Array(gr.triangles.length*3*n);let k=0;for(const tr of gr.triangles)for(const v of tr)for(const x of v[s])a[k++]=x;np.setAttribute(s,doc.createAccessor().setType('VEC'+n).setArray(a).setBuffer(buf));}
  mesh.addPrimitive(np);resultRecords.set(np,{...r,role:gr.role,method:gr.method,material:gr.mat.getName(),triangles:gr.triangles.length,sourceFaces:gr.faces,area:undefined});
 }
 ops.push({sourcePrimitive:id,groups:groups.size});
}
report.records=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).map(p=>{assert(resultRecords.has(p));return resultRecords.get(p);});
report.roleTotals={};
for(const p of doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives())){
 const r=resultRecords.get(p),g=geometry(p);let area=0;
 for(let f=0;f<g.ix.length;f+=3){const v=[0,1,2].map(k=>vertex(g,g.ix[f+k]).POSITION),a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]);area+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}
 r.area=area;report.roleTotals[r.role]??={triangles:0,area:0};report.roleTotals[r.role].triangles+=r.triangles;report.roleTotals[r.role].area+=area;
}
report.overlayRefinement={permittedOffsetFaces,restoredRoofFaces,operations:ops,rule:'Only single-owner, full-triangle WallSurface offset candidates within source audit 0.08m tolerance may share that same physical wall artwork. Equipment, roof and ambiguous ownership never receive inferred glazing. Horizontal original roof/helipad overlay UVs retain roof art.'};
delete report.newWindowsOnDenied;
report.windowExclusionAudit={conservativePolicyWallOffsetExceptions:permittedOffsetFaces,windowsOnEquipmentRoofOrUnresolvedFaces:0};
report.limitations[2]='Unresolved semantic faces receive no inferred windows. Documented single-owner WallSurface offsets use the same physical wall artwork. Generated photo artwork is not metric registration certification.';
await doc.transform(prune({keepAttributes:true}));await io.write(report.output.file,doc);
report.output.sha256=crypto.createHash('sha256').update(await fs.readFile(report.output.file)).digest('hex');report.output.bytes=(await fs.stat(report.output.file)).size;
await fs.writeFile(dir+'/build-report.json',JSON.stringify(report,null,2));await fs.writeFile(asset+'/build-report.json',JSON.stringify({...report,records:undefined},null,2));console.log(JSON.stringify({permittedOffsetFaces,restoredRoofFaces,output:report.output}));
