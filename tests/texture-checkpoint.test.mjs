import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkpointKey,loadCheckpoint,saveCheckpoint,validateCheckpoint} from '../scripts/texture-checkpoint.mjs';
const key=checkpointKey(['source','geometry']),ids=['building-a','building-b'],photos=new Set(['photo-a']);
const state=()=>({version:1,key,results:[{buildingId:ids[0],triangles:1,projectedArea:2,sourceIds:['photo-a']}],totalTriangles:1,chunks:[{id:'photo-a',positions:[0,0,0,1,0,0,0,1,0],uv:[0,0,1,0,0,1]}]});
test('checkpoint preserves exact geometry and ignores an interrupted partial write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'opengraffiti-checkpoint-')),path=join(dir,'checkpoint.json');
 try{assert.equal(await loadCheckpoint(path,key,ids,photos),null);const input=state();await saveCheckpoint(path,input);await writeFile(path+'.partial','incomplete');assert.deepEqual(await loadCheckpoint(path,key,ids,photos),input);}finally{await rm(path,{force:true});await rm(path+'.partial',{force:true});await rm(dir,{recursive:true});}
});
test('checkpoint rejects changed inputs, reordered buildings and broken mesh counts',()=>{
 assert.notEqual(checkpointKey(['ab','c']),checkpointKey(['a','bc']));
 assert.throws(()=>validateCheckpoint(state(),'different',ids,photos));assert.throws(()=>validateCheckpoint(state(),key,[...ids].reverse(),photos));
 const broken=state();broken.chunks[0].uv.pop();assert.throws(()=>validateCheckpoint(broken,key,ids,photos));
 const nonfinite=state();nonfinite.chunks[0].positions[0]=NaN;assert.throws(()=>validateCheckpoint(nonfinite,key,ids,photos));
 assert.throws(()=>validateCheckpoint(state(),key,ids,new Set()));
});
