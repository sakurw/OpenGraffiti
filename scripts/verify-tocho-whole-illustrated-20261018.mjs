import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
const dir='data/texture-city/tocho-whole-illustrated-20261018',asset='public/assets/tocho-landmark/whole-illustrated-20261018';
const report=JSON.parse(await fs.readFile(dir+'/build-report.json','utf8'));
const ownership=JSON.parse(await fs.readFile(dir+'/ownership-inventory.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const before=await io.read(report.source),after=await io.read(report.output.file);
const parts=d=>d.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const source=parts(before),target=parts(after);
function face(p,f,s){const a=p.getAttribute(s);if(!a)return null;const n=a.getElementSize(),idx=p.getIndices()?.getArray();return Array.from({length:3},(_,k)=>Array.from(a.getArray().slice((idx?idx[f*3+k]:f*3+k)*n,(idx?idx[f*3+k]:f*3+k)*n+n)));}
const seen=source.map(p=>new Uint8Array((p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3));
assert.equal(target.length,report.records.length);
let checked=0,photoVertices=0,inferredVertices=0,equipmentFaces=0,roofFaces=0;
for(let i=0;i<target.length;i++){
 const p=target[i],r=report.records[i],src=source[r.sourcePrimitive],mat=p.getMaterial();
 assert.equal((p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,r.triangles);
 for(let f=0;f<r.triangles;f++){
  const sf=r.sourceFaces[f];assert.equal(seen[r.sourcePrimitive][sf],0);seen[r.sourcePrimitive][sf]=1;
  assert.deepEqual(face(p,f,'POSITION'),face(src,sf,'POSITION'),'Position changed');
  assert.deepEqual(face(p,f,'NORMAL'),face(src,sf,'NORMAL'),'Normal changed');checked++;
 }
 if(['equipment','roof','other'].includes(r.role)){assert.equal(mat.getExtras().windowAllowed,false);if(r.role==='equipment')equipmentFaces+=r.triangles;else roofFaces+=r.triangles;}
 if(mat.getExtras().inferred){
  const denied=new Set(ownership.v106.exclusions.perPrimitive[r.sourcePrimitive].denyWindows.triangleIds);
  const owners=ownership.v106.primitiveInventory[r.sourcePrimitive].groups;
  for(const f of r.sourceFaces){
   const o=owners.find(g=>g.faceRanges.some(([a,b])=>f>=a&&f<=b));
   const verifiedWallOffset=r.method==='finite-wall-offset-extension'&&o.kind==='offsetCandidate'&&o.candidateTypes.length===1&&o.candidateTypes[0]==='WallSurface'&&o.polygonIndices.length===1;
   assert(!denied.has(f)||verifiedWallOffset,'New windows on excluded equipment/roof/unknown');
  }
 }
 if(['photo-layout-stylized','finite-wall-extension','finite-wall-offset-extension'].includes(r.method)){
  const uv=p.getAttribute('TEXCOORD_0').getArray();for(const x of uv)assert(Number.isFinite(x)&&x>=-.0002&&x<=1.0002,`UV outside finite atlas: source ${r.sourcePrimitive} ${r.method} value ${x}`);
  if(r.method==='photo-layout-stylized')photoVertices+=uv.length/2;else inferredVertices+=uv.length/2;
 }
}
assert(seen.every(a=>a.every(x=>x===1)));assert.equal(checked,298489);
let finiteAtlasEdges=0;
for(const t of after.getRoot().listMaterials().filter(m=>m.getExtras().inferred)){
 const png=t.getBaseColorTexture().getImage(),im=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
 for(let y=0;y<im.info.height;y++)for(const x of [0,im.info.width-1]){
  const k=(y*im.info.width+x)*3,c=Array.from(im.data.slice(k,k+3));
  assert(c.every((v,k)=>v>=[93,91,84][k]&&v<=[184,178,165][k])&&c[0]>=c[2]-4,`Non-masonry at finite facade end: ${t.getName()} (${x},${y}) ${c}`);finiteAtlasEdges++;
 }
}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(hash(await fs.readFile(report.source)),report.sourceSHA256);
assert.equal(hash(await fs.readFile(report.output.file)),report.output.sha256);
const result={createdAt:new Date().toISOString(),pass:true,checkedTriangles:checked,allOriginalFacesExactlyOnce:true,positionsAndNormalsUnchanged:true,photoVertices,inferredVertices,equipmentFacesWithNoWindowArtwork:equipmentFaces,roofOrGroundFacesWithNoNewWindowArtwork:roofFaces,finiteAtlasBoundaryPixelsChecked:finiteAtlasEdges,inferredWindowsOnEquipmentRoofOrUnresolvedFaces:0,verifiedSingleOwnerWallOffsetFaces:report.overlayRefinement?.permittedOffsetFaces??0,humanAppearanceApproved:false,browserVerification:'separate-browser-verification.json'};
await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
