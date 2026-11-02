import test from 'node:test';
import assert from 'node:assert/strict';
import {groupedSurfaces,quadrant} from '../scripts/facade-groups.mjs';
import {bakeWall,overlayGeometry} from '../server/wall-bake.mjs';
const face=(id,x,z)=>({id,surfaceId:id,openings:0,rings:[{id:id+'r',points:[[x,0,z],[x+2,0,z],[x+2,2,z],[x,2,z]]}]});
test('quadrants use north-centered half-open 90 degree sectors',()=>{
 for(const [n,q]of [[[0,0,-1],0],[[1,0,0],1],[[0,0,1],2],[[-1,0,0],3]])assert.equal(quadrant(n),q);
 const n=d=>[Math.sin(d*Math.PI/180),0,-Math.cos(d*Math.PI/180)];
 assert.equal(quadrant(n(44.99)),0);assert.equal(quadrant(n(45)),1);assert.equal(quadrant(n(315)),0);
});
test('same building and quadrant merges different source surfaces and depths',()=>{
 const polys=[face('a',0,0),face('b',2,0),face('c',0,2)],textures=Object.fromEntries(polys.map(p=>[p.id,{image:p.id,rings:{[p.id+'r']:[0,0,1,0,1,1,0,1]}}]));
 const g=groupedSurfaces({buildings:[{id:'building',lod:2,walls:polys}],textures});
 assert.equal(g.walls.length,1);assert.equal(g.walls[0].panels.length,2);assert.equal(g.walls[0].polygonIds.length,3);
 const [a,b]=g.walls[0].panels.map(p=>p.slot);assert.equal(a.x,b.x);assert.equal(a.y,b.y);assert.equal(g.walls[0].width,4);assert.equal(g.walls[0].height,2);
});
test('depth-separated panels keep independent source colors and offset normals',async()=>{
 const recipe={width:4,height:2,normal:[0,0,1],polygons:[0,1].map(i=>({points:face('p',0,i*2).rings[0].points,normal:[0,0,1],indices:[0,1,2,0,2,3],sourceUV:[0,1,1,1,1,0,0,0],canvasUV:[i*.5,1,(i+1)*.5,1,(i+1)*.5,0,i*.5,0],image:String(i)}))};
 const b=await bakeWall(recipe,async id=>({data:Buffer.from(id==='0'?[255,0,0,255]:[0,0,255,255]),info:{width:1,height:1}}),4);
 assert.deepEqual([...b.data.subarray(0,4)],[255,0,0,255]);assert.deepEqual([...b.data.subarray(8,12)],[0,0,255,255]);
 const geometry=overlayGeometry(recipe);assert.equal(geometry.positions[2],.002);assert.equal(geometry.positions[14],2.002);
});
test('elevation faces the actual dominant wall rather than a building corner',()=>{
 const p=face('rotated',0,0),angle=Math.PI/6;
 p.rings[0].points=p.rings[0].points.map(([x,y,z])=>[x*Math.cos(angle)+z*Math.sin(angle),y,-x*Math.sin(angle)+z*Math.cos(angle)]);
 const {walls:[w]}=groupedSurfaces({buildings:[{id:'rotated-building',lod:2,walls:[p]}],textures:{rotated:{image:'photo',rings:{rotatedr:[0,0,1,0,1,1,0,1]}}}});
 assert.equal(w.quadrant,2);assert.ok(Math.abs(w.width-2)<1e-8);assert.ok(Math.abs(w.normal[0]-.5)<1e-8);assert.ok(Math.abs(w.normal[2]-Math.cos(angle))<1e-8);
});
