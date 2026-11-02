import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
for(const area of ['tokyo-tower','tocho']){
 const before=JSON.parse(await readFile(`data/texture-city/top6-baseline-${area}.json`,'utf8'));
 const after=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 assert.equal(before.facadePolicy,after.facadePolicy);assert.equal(before.totalBuildings,after.totalBuildings);
 const previous=new Map(before.buildings.map(b=>[b.buildingId,b]));let recovered=0,addedTriangles=0,addedArea=0,maxRank=0;
 for(const b of after.buildings){
  const old=previous.get(b.buildingId);assert.ok(old);
  assert.ok(b.projectedArea+1e-6>=old.projectedArea,b.buildingId);
  assert.equal(b.triangles-old.triangles,b.diagnostic.acceptedBeyondSix,b.buildingId);
  assert.ok(old.sourceIds.every(id=>b.sourceIds.includes(id)),b.buildingId);
  if(!old.triangles&&b.triangles)recovered++;addedTriangles+=b.triangles-old.triangles;addedArea+=b.projectedArea-old.projectedArea;maxRank=Math.max(maxRank,b.diagnostic.maxAcceptedRank);
 }
 const result={area,previousBuildings:before.projectedBuildings,projectedBuildings:after.projectedBuildings,recoveredBuildings:recovered,addedTriangles,addedArea,maxAcceptedRank:maxRank};results.push(result);console.log(result);
}
await writeFile('data/texture-city/candidate-expansion-audit.json',JSON.stringify(results,null,2));
