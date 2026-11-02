import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryCorrection,faceWall} from '../shared/camera-bounds.mjs';
import {fitRoad,segmentHit} from '../scripts/plateau-roads.mjs';
import {bakeWall} from '../server/wall-bake.mjs';
test('1000 boundary pans preserve distance and camera offset',()=>{
 let target=[0,10,0],camera=[80,90,120];const offset=camera.map((v,i)=>v-target[i]);
 for(let n=0;n<1000;n++){const pan=[n<500?7:-7,0,3];target=target.map((v,i)=>v+pan[i]);camera=camera.map((v,i)=>v+pan[i]);const c=boundaryCorrection(target,[-50,50,-50,50]);target=target.map((v,i)=>v+c[i]);camera=camera.map((v,i)=>v+c[i]);assert.deepEqual(camera.map((v,i)=>v-target[i]),offset);}
});
test('face picking never selects roof gaps or adjacent triangle ranges',()=>{
 const ranges=[{start:2,count:3,wallId:'a'},{start:8,count:2,wallId:'b'}];assert.equal(faceWall(ranges,1),null);assert.equal(faceWall(ranges,2),'a');assert.equal(faceWall(ranges,4),'a');assert.equal(faceWall(ranges,5),null);assert.equal(faceWall(ranges,9),'b');
});
test('road fitting accepts straight strips and rejects square intersections and L bends',()=>{
 assert.ok(fitRoad([[0,0,-5],[100,0,-5],[100,0,5],[0,0,5]]));
 assert.equal(fitRoad([[0,0,0],[20,0,0],[20,0,20],[0,0,20]]),null);
 assert.equal(fitRoad([[0,0,0],[100,0,0],[100,0,100],[90,0,100],[90,0,10],[0,0,10]]),null);
});
test('road line of sight respects occluder and target endpoint',()=>{
 const triangle=[[-1,-1,5],[1,-1,5],[0,1,5]];
 assert.equal(segmentHit([0,0,0],[0,0,10],triangle),.5);
 assert.equal(segmentHit([2,0,0],[0,0,10],triangle),Infinity);
 assert.equal(segmentHit([0,0,0],[0,0,5],triangle),Infinity);
});
test('asymmetric image UV bake preserves top bottom and left right',async()=>{
 const pixels=Buffer.from([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255]);
 const recipe={width:2,height:2,origin:[0,0,0],u:[1,0,0],v:[0,1,0],lo:[0,0],polygons:[{points:[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],indices:[0,1,2,0,2,3],sourceUV:[0,1,1,1,1,0,0,0],image:'test'}]};
 const baked=await bakeWall(recipe,async()=>({data:pixels,info:{width:2,height:2}}),2);assert.deepEqual(baked.data,pixels);
});

