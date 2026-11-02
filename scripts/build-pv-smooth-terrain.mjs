import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {surfaceHeight} from '../src/pv-ground.ts';
import {buildingGround} from './pv-building-ground.mjs';

const dir=process.env.PV_MODEL_DIR||'public/assets/pv-adopted-20261029',sourceBytes=await fs.readFile(dir+'/surface.json'),source=JSON.parse(sourceBytes),{minX,minZ,nx,nz,step}=source,width=nx+1,height=nz+1,count=width*height;
const original=new Float64Array(count),median=new Float64Array(count),temporary=new Float64Array(count),smooth=new Float64Array(count),at=(x,z)=>Math.max(0,Math.min(nz,z))*width+Math.max(0,Math.min(nx,x));
for(let z=0;z<height;z++)for(let x=0;x<width;x++)original[z*width+x]=surfaceHeight(source,minX+x*step,minZ+z*step);
// Remove isolated spikes first, then use a symmetric 12 m Gaussian kernel.
for(let z=0;z<height;z++)for(let x=0;x<width;x++){const values=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)values.push(original[at(x+dx,z+dz)]);values.sort((a,b)=>a-b);median[z*width+x]=values[4];}
const sigma=12/step,radius=Math.ceil(sigma*3),weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2)),weight=weights.reduce((a,b)=>a+b,0);
for(let z=0;z<height;z++)for(let x=0;x<width;x++){let y=0;for(let k=-radius;k<=radius;k++)y+=median[at(x+k,z)]*weights[k+radius];temporary[z*width+x]=y/weight;}
for(let z=0;z<height;z++)for(let x=0;x<width;x++){let y=0;for(let k=-radius;k<=radius;k++)y+=temporary[at(x,z+k)]*weights[k+radius];smooth[z*width+x]=Math.fround(y/weight);}
const manifest=JSON.parse(await fs.readFile(dir+'/manifest.json'));
const ground=buildingGround(await new NodeIO().read(dir+'/city.glb'),manifest,source,(x,z)=>surfaceHeight({minX,minZ,step,nx,nz,heights:smooth},x,z));
// Building footprints are hard constraints. Smoothing is only the background
// field, never a subsequent filter that could move the building contacts.
const positions=Array.from(new Float32Array(ground.vertices)),triangles=ground.triangles,uv=[];
for(let i=0;i<positions.length;i+=3)uv.push((positions[i]-minX)/(nx*step),(positions[i+2]-minZ)/(nz*step));
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(),attribute=(type,values)=>doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer),map=doc.createTexture('walk-surface-map-placeholder').setImage(await sharp({create:{width:1,height:1,channels:4,background:'#ffffff'}}).png().toBuffer()).setMimeType('image/png');
const primitive=doc.createPrimitive().setAttribute('POSITION',attribute('VEC3',positions)).setAttribute('TEXCOORD_0',attribute('VEC2',uv)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(triangles)).setBuffer(buffer)).setMaterial(doc.createMaterial('smoothed-continuous-ground').setBaseColorTexture(map));scene.addChild(doc.createNode('smoothed-walk-surface').setMesh(doc.createMesh().addPrimitive(primitive)));
const finalSamples=new Float64Array(count),finalField={minX,minZ,step,nx,nz,heights:smooth,vertices:positions,triangles};for(let z=0;z<height;z++)for(let x=0;x<width;x++)finalSamples[z*width+x]=surfaceHeight(finalField,minX+x*step,minZ+z*step);
const delta=Array.from(finalSamples,(y,i)=>Math.abs(y-original[i])).sort((a,b)=>a-b),slope=(values)=>{let max=0,total=0,n=0;for(let z=1;z<nz;z++)for(let x=1;x<nx;x++){const i=z*width+x,second=Math.abs(values[i-1]-2*values[i]+values[i+1])+Math.abs(values[i-width]-2*values[i]+values[i+width]);max=Math.max(max,second);total+=second;n++;}return {meanCurvature:total/n,maxCurvature:max};},report={version:1,method:'Display-only 4m height grid sampled from official DEM; 3x3 median followed by Gaussian sigma 12m; same triangle surface for rendering and walking',sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),stepMetres:step,gaussianSigmaMetres:12,maxHeightChangeMetres:delta.at(-1),p95HeightChangeMetres:delta[Math.floor(delta.length*.95)],before:slope(original),after:slope(finalSamples),backgroundFilter:{before:slope(original),after:slope(smooth)},vertices:count,triangles:triangles.length/3,sourceFilesUnchanged:['city.glb','terrain.glb','surface.json']};
report.method='Official DEM median/Gaussian background with original building bottom triangles as exact constrained triangulation; one shared render/walk/road surface';
report.vertices=positions.length/3;report.triangles=triangles.length/3;report.contactTriangles=ground.contacts.length;report.groundedBuildings=new Set(ground.contacts.map(c=>c.id)).size;report.nativeJointLimitMetres=.12;report.nativeJointExplanation='Adjacent original building bottom vertices differ by 12 cm at one shared boundary; the lower original contact is retained and both buildings remain unchanged.';
report.preservedElevatedStructures=['bldg_5da56097-5f78-481b-bcb6-a50a2d6aaad1'];
await new NodeIO().write(dir+'/walk-terrain.glb',doc);await fs.writeFile(dir+'/walk-surface.json',JSON.stringify({version:5,minX,minZ,step,nx,nz,heights:[...smooth],vertices:positions,triangles,buildingContacts:ground.contacts,source:{derivedFrom:'surface.json',sha256:report.sourceSha256,smoothing:report.method}}));await fs.writeFile(dir+'/walk-smoothing-report.json',JSON.stringify(report,null,2)+'\n');
for(const name of ['walk-terrain.glb','walk-surface.json','walk-smoothing-report.json'])await fs.copyFile(dir+'/'+name,'dist/'+dir.replace(/^public\//,'')+'/'+name);
console.log(report);
