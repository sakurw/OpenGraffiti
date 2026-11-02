// Prove the stabilization did not rewrite photos, UVs, or unrelated geometry.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit,EXTTextureWebP} from '@gltf-transform/extensions';
const area=process.argv[2];assert.ok(['tocho','tokyo-tower'].includes(area));
const path=`public/assets/texture-poc/experimental/selection/wall-coverage-refine2-all/${area}.json`,report=JSON.parse(await readFile(path,'utf8')),change=report.geometryBiasStabilization;
if(!change){console.log({area,adjustedTriangles:0,status:'no-stabilization-record'});process.exit(0);}
const hash=b=>createHash('sha256').update(b).digest('hex'),io=new NodeIO().registerExtensions([KHRMaterialsUnlit,EXTTextureWebP]);
const oldBytes=await readFile(`data/texture-city/output-bias/${change.inputModelSha256}.glb`),oldReportBytes=await readFile(`data/texture-city/output-bias/${change.inputReportSha256}.json`);
assert.equal(hash(oldBytes),change.inputModelSha256);assert.equal(hash(oldReportBytes),change.inputReportSha256);
const {geometryBiasStabilization,...rest}=report;assert.deepEqual(rest,JSON.parse(oldReportBytes));
const before=await io.readBinary(oldBytes),after=await io.read('public'+report.model),a=before.getRoot().listMeshes(),b=after.getRoot().listMeshes();
assert.equal(a.length,b.length);let checked=0;
for(let m=0;m<a.length;m++){
 assert.equal(a[m].getName(),b[m].getName());const ap=a[m].listPrimitives(),bp=b[m].listPrimitives();assert.equal(ap.length,bp.length);
 for(let n=0;n<ap.length;n++){
  const ta=ap[n].getMaterial().getBaseColorTexture(),tb=bp[n].getMaterial().getBaseColorTexture(),id=ta.getName();
  assert.equal(id,tb.getName());assert.equal(hash(ta.getImage()),hash(tb.getImage()));
  assert.deepEqual(ap[n].getAttribute('TEXCOORD_0').getArray(),bp[n].getAttribute('TEXCOORD_0').getArray());
  const original=ap[n].getAttribute('POSITION').getArray(),expected=original.slice(),actual=bp[n].getAttribute('POSITION').getArray();
  for(const fix of change.fixes.filter(f=>f.id===id)){
   const start=fix.triangle*9;assert.deepEqual(Array.from(original.slice(start,start+9)),fix.originalPositions);
   assert.equal(fix.positions.length,9);assert.ok(fix.wallDistance>0&&fix.wallDistance<=.026);assert.ok(fix.fraction>0&&fix.fraction<1);
   const distances=[0,3,6].map(i=>Math.hypot(...fix.positions.slice(i,i+3).map((v,k)=>v-fix.originalPositions[i+k])));
   assert.ok(Math.max(...distances)<=.025);assert.ok(Math.abs(Math.max(...distances)-fix.maximumDisplacement)<1e-9);
   expected.set(fix.positions,start);checked++;
  }
  assert.deepEqual(actual,expected,'Unlisted output position changed');
 }
}
assert.equal(checked,change.adjustedTriangles);assert.equal(checked,change.fixes.length);
console.log({area,adjustedTriangles:checked,sourceImages:'byte-identical',uvs:'identical',unlistedPositions:'identical',buildingAccounting:'identical',maximumDisplacement:change.maximumDisplacement});
