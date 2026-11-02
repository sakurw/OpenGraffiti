// Read-only effect estimate for source-image quality filtering. No model changes.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {classifyPhotoQuality} from './texture-photo-quality.mjs';
const root='data/texture-city',metadata=new Map();
for(const f of await readdir(`${root}/spatial`))if(/^\d+\.json$/.test(f)){
 const p=JSON.parse(await readFile(`${root}/spatial/${f}`,'utf8'));metadata.set(p.id,p);
}
const reports=[];
for(const area of ['tocho','tokyo-tower']){
 const bytes=await readFile(`public/assets/texture-poc/experimental/${area}.json`),report=JSON.parse(bytes);
 const rows=await Promise.all(report.sources.map(async s=>{
  const p=metadata.get(s.id);if(!p||(p.sourceSha256&&p.sourceSha256!==s.sourceSha256))throw Error('Missing or mismatched quality source evidence');
  const photo=JSON.parse(await readFile(`${root}/photos/mapillary/${s.id}.json`,'utf8'));
  if(photo.id!==s.id||photo.sha256!==s.sourceSha256)throw Error('Quality/photo identity mismatch');
  const score=p.qualityScore;
  // API may use zero as unscored; never label it a bad photograph.
  const status=classifyPhotoQuality(score);
  return {id:s.id,sourceSha256:s.sourceSha256,score:score??null,status,evidence:p.sourceSha256?'source-hash-bound':'legacy-image-id-and-acquisition-hash'};
 }));
 const low=new Set(rows.filter(r=>r.status==='low-quality').map(r=>r.id));
 const affected=report.buildings.filter(b=>b.sourceIds.some(id=>low.has(id))).map(b=>({buildingId:b.buildingId,lowQualitySourceIds:b.sourceIds.filter(id=>low.has(id)),allCurrentSourcesLowQuality:b.sourceIds.length>0&&b.sourceIds.every(id=>low.has(id))}));
 reports.push({area,reportSha256:createHash('sha256').update(bytes).digest('hex'),projectedBuildings:report.projectedBuildings,sourcePhotos:rows.length,lowQualityPhotos:low.size,affectedBuildings:affected.length,allCurrentSourcesLowQuality:affected.filter(b=>b.allCurrentSourcesLowQuality).length,buildings:affected,photos:rows});
}
const result={policy:'Audit only: 0 < quality_score < 0.2; zero/null/missing are unscored, not bad',
 reference:'https://filipbiljecki.com/publications/2025_ijprs_openfacades.pdf',
 limitation:'Score is predicted visual quality, not camera accuracy. Affected means a currently selected input would be excluded, not that the building would lose coverage after trying alternatives. No textures changed.',reports};
await writeFile(`${root}/photo-quality-audit.json`,JSON.stringify(result,null,2));
console.log(reports.map(({buildings,photos,...r})=>r));
