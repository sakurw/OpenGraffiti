import {readFile,writeFile,rename} from 'node:fs/promises';

// Attach candidate source provenance to every building. Candidate images have
// not been geometrically registered and MUST NOT be counted as observed color.
const root='public/assets/universal-all-areas';
const candidatesRoot='data/texture-city/universal-all-buildings/ground';
const summary=[];
for(const areaId of ['tocho','tokyo-tower']){
  const discovery=JSON.parse(await readFile(`${candidatesRoot}/${areaId}-discovery.json`,'utf8'));
  const evidencePath=`${root}/${areaId}-building-evidence.json`;
  const evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  const lookup=new Map(discovery.buildings.map(b=>[b.buildingId,b]));
  let candidates=0,buildingsWithCandidates=0,unmatched=0;
  for(const building of evidence.buildings){
    const found=lookup.get(building.buildingId);
    if(!found){unmatched++;building.groundImageDiscovery={status:'not-searched',candidates:[]};continue;}
    const matches=found.candidates.map(c=>({...c,provider:'Mapillary',directlyObserved:false}));
    candidates+=matches.length;
    if(matches.length)buildingsWithCandidates++;
    building.groundImageDiscovery={status:discovery.searchComplete?'candidate-search-complete':'candidate-search-incomplete',totalNearbyCandidates:found.candidateCount,candidates:matches};
  }
  if(unmatched||evidence.buildings.length!==discovery.buildingCount)throw Error(`${areaId}: unmatched buildings ${unmatched}`);
  evidence.groundImageSearch={provider:'Mapillary',status:discovery.searchComplete?'completed':'incomplete',discoveryMode:discovery.discoveryMode,uniqueImages:discovery.uniquePhotoMetadata,queriedTiles:discovery.requestedTiles,unqueriedTiles:discovery.unqueriedTiles,failedTiles:discovery.failedTiles,registration:'unverified-candidate-only',limitation:'Candidate presence is NOT evidence of an image-to-facade registration or successful color transfer.'};
  const temporary=`${evidencePath}.partial`;
  await writeFile(temporary,JSON.stringify(evidence));
  await rename(temporary,evidencePath);
  summary.push({areaId,buildings:evidence.buildings.length,buildingsWithCandidates,candidateAssignments:candidates,discovery:evidence.groundImageSearch});
}
await writeFile(`${root}/ground-image-coverage.json`,JSON.stringify({generatedAt:new Date().toISOString(),areas:summary},null,2));
console.log(JSON.stringify(summary));
