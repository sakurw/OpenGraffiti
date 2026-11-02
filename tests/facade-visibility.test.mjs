import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleFacades} from '../scripts/facade-visibility.mjs';
import {bakeWall,overlayGeometry} from '../server/wall-bake.mjs';
const frame={width:4,height:2,u:[1,0,0],normal:[0,0,1],lo:[0,0],hi:[4,2]};
const quad=(id,x0,x1,z)=>({id,image:id,points:[[x0,0,z],[x1,0,z],[x1,2,z],[x0,2,z]],normal:[0,0,1],indices:[0,1,2,0,2,3],sourceUV:[0,1,1,1,1,0,0,0]});
test('front elevation preserves placement and clips hidden paint geometry',async()=>{
 const back=quad('red',0,4,0),front=quad('blue',1,3,2),ps=[back,front];
 const visible=visibleFacades(ps,ps,frame),recipe={...frame,polygons:ps,visiblePolygons:visible};
 const b=await bakeWall(recipe,async id=>({data:Buffer.from(id==='red'?[255,0,0,255]:[0,0,255,255]),info:{width:1,height:1}}),8);
 for(let x=0;x<8;x++)assert.deepEqual([...b.data.subarray(x*4,x*4+4)],x>=2&&x<6?[0,0,255,255]:[255,0,0,255]);
 for(const p of visible.filter(p=>p.id==='red'))for(let i=0;i<p.indices.length;i+=3){const center=p.indices.slice(i,i+3).reduce((s,j)=>s+p.points[j][0],0)/3;assert.ok(center<=1+1e-6||center>=3-1e-6);}
 const geometry=overlayGeometry(recipe);assert.ok(geometry.positions.length>0);
 for(const p of visible)for(let i=0;i<p.points.length;i++){assert.ok(Math.abs(p.canvasUV[i*2]-p.points[i][0]/4)<1e-8);assert.ok(Math.abs(p.canvasUV[i*2+1]-(1-p.points[i][1]/2))<1e-8);}
});
test('fully hidden facade does not receive paint even behind a nonpaintable face',()=>{
 const back=quad('back',0,4,0),blocker=quad('roof-or-other-direction',0,4,2);
 assert.deepEqual(visibleFacades([back],[back,blocker],frame),[]);
});
test('crossing planes are clipped at their depth intersection',()=>{
 const back=quad('flat',0,4,0),slope=quad('slope',0,4,-1);slope.points[1][2]=1;slope.points[2][2]=1;
 const result=visibleFacades([back,slope],[back,slope],frame);
 for(const p of result)for(let i=0;i<p.indices.length;i+=3){const x=p.indices.slice(i,i+3).reduce((s,j)=>s+p.points[j][0],0)/3;assert.ok(p.id==='flat'?x<=2.00001:x>=1.99999);}
});
