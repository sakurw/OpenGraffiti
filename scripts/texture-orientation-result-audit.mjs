import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const results=[];
for(const area of ['tokyo-tower','tocho']){
 const before=JSON.parse(await readFile(`data/texture-city/orientation-baseline-${area}.json`,'utf8'));
 const after=JSON.parse(await readFile(`public/assets/texture-poc/experimental/${area}.json`,'utf8'));
 assert.equal(before.totalBuildings,after.totalBuildings);assert.deepEqual(after.skippedPhotos,[]);
 const previous=new Map(before.buildings.map(b=>[b.buildingId,b]));let gained=0,lost=0,changed=0;
 for(const b of after.buildings){const old=previous.get(b.buildingId);assert.ok(old);if(!old.triangles&&b.triangles)gained++;if(old.triangles&&!b.triangles)lost++;if(b.triangles!==old.triangles||Math.abs(b.projectedArea-old.projectedArea)>1e-6)changed++;}
 const orientations={};
 for(const s of after.sources){
  const p=JSON.parse(await readFile(`data/texture-city/photos/mapillary/${s.id}.json`,'utf8'));
  const o=JSON.parse(await readFile(`data/texture-city/orientation/${s.id}.json`,'utf8'));
  assert.equal(s.exifOrientation,o.exif_orientation);assert.deepEqual(s.originalSize,[o.width,o.height]);assert.equal(s.sourceSha256,p.sha256);
  const expected=s.exifOrientation>=5?o.height/o.width:o.width/o.height;
  assert.ok(Math.abs(p.downloadSize[0]/p.downloadSize[1]-expected)<.002,'Unexpected display aspect ratio '+s.id);
  orientations[s.exifOrientation]=(orientations[s.exifOrientation]||0)+1;
 }
 const result={area,previousBuildings:before.projectedBuildings,projectedBuildings:after.projectedBuildings,gained,lost,changed,usedOrientations:orientations};results.push(result);console.log(result);
}
await writeFile('data/texture-city/orientation-result-audit.json',JSON.stringify(results,null,2));
