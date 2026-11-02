import {readFile} from 'node:fs/promises';
import {roadSurfaceHeight} from './texture-road-surface.mjs';

const caseId=process.argv[2]??'park-tower-west';
if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(caseId))throw new Error('Invalid SNAP case ID');
const casePath=caseId==='park-tower-west'
 ? 'scripts/texture-snap-registration.json'
 : `scripts/texture-snap-cases/${caseId}.json`;
const item=JSON.parse(await readFile(casePath,'utf8'));
const dataset=/^data\/plateau\/([^/]+)\//.exec(item.geometryPath)?.[1];
if(!dataset)throw new Error('Cannot derive PLATEAU dataset from geometryPath');
const geometry=JSON.parse(await readFile(item.geometryPath,'utf8'));
if(!Array.isArray(geometry.origin)||geometry.origin.length!==3)throw new Error('Geometry origin missing');
const sampler=await roadSurfaceHeight({id:item.areaId,dataset},geometry.origin);
const names=[caseId,`${caseId}-linefit`,`${caseId}-linefit-fixedpp`];
const candidates=[];
try{
 for(const name of names){
  let fit;
  try{fit=JSON.parse(await readFile(`data/texture-city/registration/${name}.json`,'utf8'));}
  catch(error){if(error?.code==='ENOENT')continue;throw error;}
  const sample=sampler.sample(fit.cameraPosition);
  candidates.push({
   candidate:name,
   cameraPosition:fit.cameraPosition,
   roadCameraHeight:sample?.height??null,
   cameraHeightDeltaMetres:sample?.height==null?null:fit.cameraPosition[1]-sample.height,
   method:sample?.method??null,
   ambiguous:sample?.ambiguous??false,
  });
 }
}finally{sampler.dispose();}
console.log(JSON.stringify({caseId,dataset,roadTriangles:sampler.triangles,candidates},null,2));
