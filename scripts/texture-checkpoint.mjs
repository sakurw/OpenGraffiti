import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export function checkpointKey(parts){const hash=createHash('sha256');for(const part of parts){const bytes=Buffer.isBuffer(part)?part:Buffer.from(part);hash.update(String(bytes.length)+':');hash.update(bytes);}return hash.digest('hex');}
export function validateCheckpoint(state,key,buildingIds,photoIds){
 assert.equal(state.version,1);assert.equal(state.key,key);assert.ok(Array.isArray(state.results)&&state.results.length<=buildingIds.length);
 let triangles=0;for(const [i,r] of state.results.entries()){assert.equal(r.buildingId,buildingIds[i]);assert.ok(Number.isSafeInteger(r.triangles)&&r.triangles>=0);assert.ok(Number.isFinite(r.projectedArea)&&r.projectedArea>=0);assert.ok(r.sourceIds.every(id=>photoIds.has(id)));triangles+=r.triangles;}
 let meshTriangles=0;const seen=new Set();for(const c of state.chunks){assert.ok(photoIds.has(c.id)&&!seen.has(c.id));seen.add(c.id);assert.equal(c.positions.length%9,0);assert.equal(c.uv.length,c.positions.length*2/3);assert.ok(c.positions.every(Number.isFinite)&&c.uv.every(Number.isFinite));meshTriangles+=c.positions.length/9;}
 assert.equal(state.totalTriangles,triangles);assert.equal(meshTriangles,triangles);return state;
}
export async function loadCheckpoint(path,key,buildingIds,photoIds){
 let state;try{state=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
 return validateCheckpoint(state,key,buildingIds,photoIds);
}
export async function saveCheckpoint(path,state){await mkdir(dirname(path),{recursive:true});await writeFile(path+'.partial',JSON.stringify(state));await rename(path+'.partial',path);}
