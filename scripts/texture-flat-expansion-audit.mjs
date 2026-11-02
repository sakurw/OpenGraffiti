import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
const areas=process.argv[2]?[process.argv[2]]:['tokyo-tower','tocho'];
assert.ok(areas.every(a=>['tokyo-tower','tocho'].includes(a)));
for(const area of areas){
 const before=JSON.parse(await readFile(`data/texture-city/flat-baseline-${area}.json`,'utf8'));
 const after=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 assert.equal(before.totalBuildings,after.totalBuildings);assert.deepEqual(after.skippedPhotos,[]);
 assert.equal(before.facadePolicy,after.facadePolicy);assert.equal(before.candidatePolicy,after.candidatePolicy);
 const previous=new Map(before.buildings.map(b=>[b.buildingId,b]));let recovered=0,addedTriangles=0;
 for(const b of after.buildings){const old=previous.get(b.buildingId);assert.ok(old);assert.ok(b.triangles>=old.triangles,b.buildingId);assert.ok(b.projectedArea+1e-6>=old.projectedArea,b.buildingId);if(!old.triangles&&b.triangles)recovered++;addedTriangles+=b.triangles-old.triangles;}
 let newlyAcquiredSources=0;
 // This stage preserved the old acquisition records verbatim (orientation was
 // in sidecars); only the new downloads have inline orientation metadata.
 // Refuse to reuse this discriminator if the baseline records are enriched later.
 for(const s of before.sources){const p=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${s.id}.json`,'utf8'));assert.equal(p.exif_orientation,undefined,'Baseline acquisition metadata changed');}
 for(const s of after.sources){const p=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${s.id}.json`,'utf8'));assert.equal(p.sha256,s.sourceSha256);if(p.exif_orientation!==undefined){assert.equal(p.exif_orientation,s.exifOrientation);newlyAcquiredSources++;}}
 assert.ok(newlyAcquiredSources>0);
 const result={area,previousBuildings:before.projectedBuildings,projectedBuildings:after.projectedBuildings,recoveredBuildings:recovered,addedTriangles,newlyAcquiredSources,cachedPhotosWithoutSupportedCamera:after.cachedPhotosWithoutSupportedCamera};results.push(result);console.log(result);
}
await writeFile(`data/texture-city/flat-expansion-audit${process.argv[2]?'-'+process.argv[2]:''}.json`,JSON.stringify(results,null,2));
