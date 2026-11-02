import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {meshHeight} from '../src/pv-ground.ts';

const directory='public/assets/pv-adopted-20261029/';
const read=name=>fs.readFileSync(directory+name);
const fieldName=process.argv.includes('--smoothed')?'walk-surface.json':'surface.json';
const field=JSON.parse(read(fieldName)),roads=JSON.parse(read('roads.json')).roads;
const failures=[];
let samples=0,maxStep=0,missingSurface=0;
for(const road of roads){
 const path=road.path||[road.start,road.end];
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.4);
  let previous=meshHeight(field,...a);
  for(let k=1;k<=steps;k++){
   const t=k/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t,height=meshHeight(field,x,z);
   if(height===undefined||previous===undefined)missingSurface++;
   else{
    const rise=Math.abs(height-previous);
    maxStep=Math.max(maxStep,rise);
    if(rise>1.1)failures.push({id:road.id,x,z,rise});
   }
   previous=height;samples++;
  }
 }
}
const report={version:1,field:fieldName,roads:roads.length,sampleSpacingMaxMetres:.4,samples,maxStepMetres:maxStep,missingSurface,stepLimitMetres:1.1,failures,sourceHashes:Object.fromEntries(['city.glb','terrain.glb','surface.json','roads.json',...(fieldName==='walk-surface.json'?['walk-terrain.glb',fieldName]:[])].map(name=>[name,createHash('sha256').update(read(name)).digest('hex')]))};
fs.writeFileSync(directory+(fieldName==='walk-surface.json'?'walk-smoothed-profile-audit.json':'walk-profile-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(report);
if(missingSurface||failures.length)process.exitCode=1;
