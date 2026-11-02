import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';

const root='public/assets/universal-all-areas';
const fusion=JSON.parse(await readFile(`${root}/photo-fusion-report.json`,'utf8'));
const results={generatedAt:new Date().toISOString(),scope:'two selected PLATEAU districts',areas:[],totals:{buildings:0,polygons:0,photoCandidateBuildings:0,photoTintEligibleBuildings:0,photoTintIneligibleBuildings:0,directlyObservedPolygons:0,withoutSourcePolygons:0},limitations:[
 'Candidate image IDs indicate nearby images, not verified pictures of the referenced building.',
 'The GLB photo tint uses building bounding boxes. A tint-eligible building count is not a count of accurately registered facade surfaces.',
 'A real-facade color quality improvement has not been established by this coverage audit.'
]};
for(const area of ['tocho','tokyo-tower']){
 const evidence=JSON.parse(await readFile(`${root}/${area}-building-evidence.json`,'utf8'));
 const discovery=JSON.parse(await readFile(`data/texture-city/universal-all-buildings/ground/${area}-discovery.json`,'utf8'));
 const merged=fusion.areas.find(x=>x.area===area);
 if(!merged||evidence.buildings.length!==discovery.buildings.length)throw Error(`Building count mismatch: ${area}`);
 const candidateMap=new Map(discovery.buildings.map(b=>[b.buildingId,b]));
 const rows=[];const methods={};let direct=0,noSource=0,photo=0;
 for(const building of evidence.buildings){
  const candidates=candidateMap.get(building.buildingId);
  if(!candidates)throw Error(`Missing candidate mapping: ${building.buildingId}`);
  const observed=building.polygons.filter(p=>p.directlyObserved).length;
  const absent=building.polygons.filter(p=>!p.sourceImage).length;
  for(const p of building.polygons)methods[p.provenance]=(methods[p.provenance]??0)+1;
  direct+=observed;noSource+=absent;
  if(building.groundPhotoEstimate)photo++;
  rows.push({buildingId:building.buildingId,polygonCount:building.polygons.length,candidateCount:candidates.candidateCount??candidates.candidates?.length??0,photoEstimateImageCount:building.groundPhotoEstimate?.imageIds?.length??0,photoEstimateRegistration:building.groundPhotoEstimate?.registration??null,observedPolygons:observed,withoutSourcePolygons:absent});
 }
 if(rows.some(x=>!x.candidateCount||!x.polygonCount))throw Error(`Missing polygon or candidate: ${area}`);
 const modelSize=(await stat(`${root}/${area}-photo-fused.glb`)).size;
 const result={area,buildings:rows.length,polygons:rows.reduce((s,r)=>s+r.polygonCount,0),photoCandidateBuildings:rows.filter(r=>r.candidateCount>0).length,photoEstimateBuildings:photo,photoTintEligibleBuildings:merged.buildingsWithEligiblePhotoAlbedo,photoTintIneligibleBuildings:rows.length-merged.buildingsWithEligiblePhotoAlbedo,directlyObservedPolygons:direct,withoutSourcePolygons:noSource,methodCounts:methods,sourceGeometryUVIdentical:merged.geometryUVIdentical,photoFusedModelBytes:modelSize,buildingsDetail:rows};
 results.areas.push(result);
 for(const k of Object.keys(results.totals))results.totals[k]+=result[k]??0;
}
if(results.totals.buildings!==2858||results.totals.polygons!==166898)throw Error('Scope incomplete');
await mkdir('test-results',{recursive:true});
await writeFile('test-results/universal-all-coverage-audit.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({totals:results.totals,areas:results.areas.map(({buildingsDetail,...rest})=>rest)},null,2));
