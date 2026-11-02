import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeSpatialMesh,spatialDepthSampler,depthConflict,depthDisagreement} from '../scripts/texture-spatial-depth.mjs';
import {spatialEvidence} from '../scripts/texture-spatial-evidence.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
test('spatial mesh parses float vertices and integer faces with bounds checks',()=>{
 const values=[-1,-1,10,1,-1,10,0,1,10],parts=[];for(const v of values){const b=Buffer.alloc(5);b[0]=13;b.writeFloatLE(v,1);parts.push(b);}parts.push(Buffer.from([16,0,16,1,16,2]));
 const mesh=decodeSpatialMesh(Buffer.concat(parts));assert.deepEqual(mesh,{vertices:values,faces:[0,1,2]});
 assert.throws(()=>decodeSpatialMesh(Buffer.from([13,0])));assert.throws(()=>decodeSpatialMesh(Buffer.from([16,10])));
 const depth=spatialDepthSampler(mesh,.5,{skipCornerVertices:0});assert.equal(depth.sample([0,0,100]),20);assert.equal(depth.sample([100,0,1]),null);
 assert.equal(spatialDepthSampler(mesh,.5).sample([0,0,100]),null);assert.throws(()=>spatialDepthSampler(mesh,0));
});
test('accelerated mesh matches reference rays and conservative conflict requires known depth',()=>{
 const mesh={vertices:[-10,-10,10,10,-10,10,0,10,10,-10,-10,20,10,-10,20,0,10,20],faces:[0,1,2,3,4,5]};
 const slow=spatialDepthSampler(mesh,.81,{skipCornerVertices:0});
 const fast=spatialDepthSampler(mesh,.81,{skipCornerVertices:0,accelerated:true});
 for(let x=-20;x<=20;x++)for(let y=-20;y<=20;y++){
  const a=slow.sample([x,y,40]),b=fast.sample([x,y,40]);
  if(a===null)assert.equal(b,null);else assert.ok(Math.abs(a-b)<.0001);
 }
 fast.dispose();slow.dispose();
 assert.equal(depthConflict(171,67),true);
 assert.equal(depthConflict(20,10),false);
 assert.equal(depthConflict(11,1),false);
 for(const unknown of [null,undefined,NaN,Infinity,0,-1])assert.equal(depthConflict(100,unknown),false);
});
test('spatial evidence keeps unavailable data distinct and refuses mismatched source or mesh',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opengraffiti-spatial-test-'));
 const photo={id:'123',sha256:'source',camera_type:'spherical'};
 try{
  assert.equal((await spatialEvidence(photo,{root})).status,'not-acquired');
  const meta={id:'123',sourceSha256:'source',atomicScale:1,resources:{mesh:{available:false}}};
  const save=()=>writeFile(join(root,'123.json'),JSON.stringify(meta));
  await save();assert.equal((await spatialEvidence(photo,{root})).status,'not-provided');
  meta.resources.mesh.available=true;meta.atomicScale=0;await save();
  assert.equal((await spatialEvidence(photo,{root})).status,'scale-unavailable');
  meta.atomicScale=1;meta.sourceSha256='other';await save();
  await assert.rejects(spatialEvidence(photo,{root}),/identity mismatch/);
  meta.sourceSha256='source';meta.resources.mesh.sha256='bad';await save();
  const bytes=Buffer.alloc(0);await writeFile(join(root,'123.mesh.bin'),bytes);
  await assert.rejects(spatialEvidence(photo,{root}),/hash mismatch/);
  meta.resources.mesh.sha256=createHash('sha256').update(bytes).digest('hex');await save();
  const e=await spatialEvidence(photo,{root});assert.equal(e.status,'no-supported-triangles');e.sampler.dispose();
 }finally{await rm(root,{recursive:true,force:true});}
});
test('depth disagreement rejects foreground and background without treating unknown as agreement',()=>{
 assert.equal(depthDisagreement(171,67),'photo-depth-foreground');
 assert.equal(depthDisagreement(67,171),'photo-depth-background');
 for(const pair of [[20,10],[10,20],[11,1],[1,11],[100,110]])assert.equal(depthDisagreement(...pair),null);
 for(const unknown of [null,undefined,NaN,Infinity,0,-1]){
  assert.equal(depthDisagreement(100,unknown),null);assert.equal(depthDisagreement(unknown,100),null);
 }
});
test('spherical depth supports rear hemisphere and does not invent perspective corners',()=>{
 const mesh={vertices:[-1,-1,-10,1,-1,-10,0,1,-10],faces:[0,1,2]};
 const depth=spatialDepthSampler(mesh,1,{cameraType:'spherical'});
 assert.equal(depth.sample([0,0,-100]),10);
 assert.equal(depth.sample([0,0,100]),null);
 assert.equal(depth.sample([NaN,0,-1]),null);
 assert.equal(depth.sample([0,0,0]),null);
 assert.equal(spatialDepthSampler(mesh,1,{skipCornerVertices:0}).sample([0,0,-100]),null);
 assert.throws(()=>spatialDepthSampler(mesh,1,{cameraType:'fisheye'}));
});
