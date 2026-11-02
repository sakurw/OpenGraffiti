import {readFile,writeFile} from 'node:fs/promises';
import {motionHeading} from './texture-motion-heading.mjs';
const discovery=JSON.parse(await readFile('data/texture-city/kartaview/discovery.json','utf8'));
const results=[];
for(const [id,photos] of Map.groupBy(discovery.photos,p=>p.sequenceId)){
 photos.sort((a,b)=>Number(a.sequenceIndex)-Number(b.sequenceIndex));
 for(let i=0;i<photos.length;i++)results.push({id:photos[i].id,sequenceId:id,...motionHeading(photos,i)});
}
const groups=[...Map.groupBy(results,r=>r.sequenceId)],summary=groups.map(([id,rows])=>{
 const known=rows.filter(r=>r.status==='straight-motion-prior-unverified'),differences=known.filter(r=>r.apiDifference!==null).map(r=>Math.abs(r.apiDifference)).sort((a,b)=>a-b);
 return {sequenceId:id,photos:rows.length,straightMotionPriors:known.length,apiDisagreementsOver30Degrees:differences.filter(n=>n>30).length,medianAbsoluteDifference: differences.length?differences[Math.floor(differences.length/2)]:null};
});
const report={at:new Date().toISOString(),summary,results,note:'Motion-derived heading is only a forward-camera prior. It is not calibration, model registration, independent capture verification or texture application.'};
await writeFile('data/texture-city/kartaview/heading-audit.json',JSON.stringify(report,null,2));console.log(summary);
