import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
for(const area of ['tokyo-tower','tocho']){
 const before=JSON.parse(await readFile(`data/texture-city/distance-baseline-${area}.json`,'utf8'));
 const after=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 assert.equal(before.facadePolicy,after.facadePolicy);assert.equal(before.totalBuildings,after.totalBuildings);
 const previous=new Map(before.buildings.map(b=>[b.buildingId,b]));let recovered=0,addedTriangles=0,maxDistance=0;
 for(const b of after.buildings){const old=previous.get(b.buildingId);assert.ok(old);
  assert.ok(b.projectedArea+1e-6>=old.projectedArea,b.buildingId);
  assert.equal(b.triangles-old.triangles,b.diagnostic.acceptedExtendedRange,b.buildingId);
  assert.ok(old.sourceIds.every(id=>b.sourceIds.includes(id)),b.buildingId);
  assert.ok(b.diagnostic.maxAcceptedDistance<300);
  if(!old.triangles&&b.triangles)recovered++;addedTriangles+=b.triangles-old.triangles;maxDistance=Math.max(maxDistance,b.diagnostic.maxAcceptedDistance);
 }
 const result={area,previousBuildings:before.projectedBuildings,projectedBuildings:after.projectedBuildings,recoveredBuildings:recovered,addedTriangles,maxDistance};results.push(result);console.log(result);
}
await writeFile('data/texture-city/distance-expansion-audit.json',JSON.stringify(results,null,2));
