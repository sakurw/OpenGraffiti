import {test} from 'node:test';
import {packMask,maskContains} from '../scripts/texture-mask.mjs';
import {terrainPixel,decodeElevation} from '../scripts/texture-terrain.mjs';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {cameraFor,displayUV,projectPhoto,roadHeight,overlapsPhoto} from '../scripts/texture-camera.mjs';

test('sensor EXIF orientation maps into upright thumbnail UV without changing source pixels',()=>{
 assert.deepEqual(displayUV(.2,.7,1),[.2,.7]);
 for(const [o,expected] of [[3,[.8,.3]],[6,[.3,.2]],[8,[.7,.8]]]){
  const actual=displayUV(.2,.7,o);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12));
 }
 assert.equal(displayUV(.2,.7,2),null);
 const p={computed_geometry:{coordinates:[139.69,35.68]},computed_rotation:[0,0,0],camera_type:'perspective',camera_parameters:[.5],width:4000,height:3000,downloadSize:[1500,2000],exif_orientation:6};
 const c=cameraFor(p,[0,0,0],0);assert.deepEqual(c.size,[4000,3000]);assert.equal(c.orientation,6);
 const relative={...c,position:[0,0,0]};const uv=projectPhoto(relative,[1,10,-2]);
 assert.ok(Math.abs(uv[0]-(.5-.5*.2*4/3))<1e-12);assert.ok(Math.abs(uv[1]-.55)<1e-12);
 assert.equal(cameraFor({...p,exif_orientation:2},[0,0,0],0),null);
});
test('real south-facing orientation-3 camera projects world up above its image center',()=>{
 // Mapillary 903863565816629: upright downloaded 2048x1536 JPEG, original EXIF=3.
 const r=new Vector3(-1.5811799902685,-.2178225243946,-.042951816360746);
 const c={position:[0,0,0],rotation:new Matrix4().makeRotationAxis(r.clone().normalize(),r.length()),type:'perspective',parameters:[.73404674830286,.015043756740919,-.01066496445311],size:[4032,3024],orientation:3};
 const center=projectPhoto(c,[0,0,20]),up=projectPhoto(c,[0,5,20]);assert.ok(up[1]<center[1]);
 const wrong=projectPhoto({...c,orientation:1},[0,5,20]);assert.ok(wrong[1]>.5);
 assert.ok(Math.abs(up[0]+wrong[0]-1)<1e-12);assert.ok(Math.abs(up[1]+wrong[1]-1)<1e-12);
});
test('GSI DEM preserves signed centimetres, sea level and no-data separately',()=>{
 assert.equal(decodeElevation(0,0,0),0);assert.equal(decodeElevation(0,1,0),2.56);
 assert.equal(decodeElevation(255,255,156),-1);assert.equal(decodeElevation(128,0,0),null);
 assert.deepEqual(terrainPixel([0,0],1),{z:1,x:1,y:1,px:0,py:0});
 const tokyo=terrainPixel([139.6917,35.6896]);assert.ok(tokyo.x>0&&tokyo.y>0&&tokyo.px>=0&&tokyo.px<256&&tokyo.py>=0&&tokyo.py<256);
});
test('one-bit mask preserves every threshold decision including final partial byte',()=>{
 const input=Uint8Array.from({length:1003},(_,i)=>i%256),bits=packMask(input);
 assert.equal(bits.length,Math.ceil(input.length/8));
 for(let i=0;i<input.length;i++)assert.equal(maskContains(bits,i),input[i]>=200);
});
test('nearby perspective photographs facing elsewhere do not displace useful candidates',()=>{
 const camera={position:[0,0,0],rotation:new Matrix4().makeRotationX(Math.PI/2),type:'perspective',parameters:[.5,0,0],size:[2000,1000]};
 assert.equal(overlapsPhoto(camera,[[-1,0,-10],[1,0,-10],[0,1,-10]]),true);
 assert.equal(overlapsPhoto(camera,[[-1,0,10],[1,0,10],[0,1,10]]),false);
 assert.equal(overlapsPhoto(camera,[[40,0,-10],[41,0,-10],[40,1,-10]]),false);
});
import {cropTextureRegion} from '../scripts/texture-uv.mjs';
import {heightSampler} from '../scripts/texture-road-surface.mjs';
test('road triangle sampler uses camera XY and rejects ambiguous bridge levels',()=>{
 const triangle=[0,40,0,10,40,0,0,40,10],s=heightSampler(triangle);
 assert.equal(s.sample([2,0,2]).height,41.65);assert.equal(s.sample([20,0,20]),null);s.dispose();
 const bridge=heightSampler([...triangle,...triangle.map((v,i)=>i%3===1?v+10:v)]);
 assert.equal(bridge.sample([2,0,2]).ambiguous,true);bridge.dispose();
});
test('cropped UVs preserve original source pixel coordinates',()=>{
 const input=[.1,.2,.8,.3,.4,.9],{rect,uv}=cropTextureRegion(input,2000,1000);
 for(let i=0;i<input.length;i++)assert.ok(Math.abs(uv[i]*(i%2?rect.height:rect.width)+(i%2?rect.top:rect.left)-input[i]*(i%2?1000:2000))<1e-9);
 assert.throws(()=>cropTextureRegion([NaN,0],100,100));assert.throws(()=>cropTextureRegion([2,0],100,100));
});
test('ENU north projects to spherical center; east to right; up above horizon',()=>{
 const c={position:[0,0,0],rotation:new Matrix4().makeRotationX(Math.PI/2),type:'spherical'};
 const center=projectPhoto(c,[0,0,-10]);
 assert.ok(Math.abs(center[0]-.5)<1e-9);assert.ok(Math.abs(center[1]-.5)<1e-9);
 assert.ok(projectPhoto(c,[10,0,0])[0]>.5);assert.ok(projectPhoto(c,[0,10,-10])[1]<.5);
});
test('perspective rejects behind-camera and does not stretch aspect ratio',()=>{
 const c={position:[0,0,0],rotation:new Matrix4().makeRotationX(Math.PI/2),type:'perspective',parameters:[.5,0,0],size:[2000,1000]};
 assert.equal(projectPhoto(c,[0,0,10]),null);
 assert.ok(Math.abs(projectPhoto(c,[5,0,-10])[0]-.75)<1e-9);
 assert.ok(Math.abs(projectPhoto(c,[0,5,-10])[1])<1e-9);
});
test('road height interpolates actual elevation and rejects remote roads',()=>{
 const road={start:[0,40,0],end:[100,50,0],sourceRoadId:'r'};
 assert.equal(roadHeight([50,0,5],[road]).height,46.65);
 assert.equal(roadHeight([50,0,100],[road]),null);
});
