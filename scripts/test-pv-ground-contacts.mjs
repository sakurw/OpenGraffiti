import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {meshHeight,surfaceHeight} from '../src/pv-ground.ts';

const dir='public/assets/pv-adopted-20261029/',read=async n=>JSON.parse(await fs.readFile(dir+n)),field=await read('walk-surface.json'),manifest=await read('manifest.json'),source=await new NodeIO().read(dir+'city.glb');
assert.equal(createHash('sha256').update(await fs.readFile(dir+'city.glb')).digest('hex'),manifest.modelSha256);
const by=new Map(manifest.buildings.flatMap(b=>b.parts.map(p=>[p,b]))),elevated='bldg_5da56097-5f78-481b-bcb6-a50a2d6aaad1',buildings=new Set(),failures=[];
let checks=0,maxContactError=0,maxUnconstrainedContactError=0;const samples=[],bottoms=[];
// Independently extract native bottom triangles; do not trust generator metadata.
for(const mesh of source.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
 const b=by.get(primitive.getMaterial()?.getExtras().partKey);if(!b||b.id===elevated)continue;
 const attr=primitive.getAttribute('POSITION'),index=primitive.getIndices();
 for(let i=0;i<(index?.getCount()||attr.getCount());i+=3){const t=[0,1,2].map(j=>attr.getElement(index?index.getScalar(i+j):i+j,[]));
  if(Math.max(...t.map(p=>p[1]))>b.bounds[1]+.1)continue;
  const [a,c,d]=t,area=(c[0]-a[0])*(d[2]-a[2])-(c[2]-a[2])*(d[0]-a[0]);if(Math.abs(area)<1e-5)continue;
  buildings.add(b.id);bottoms.push(t);
  for(let u=0;u<=4;u++)for(let v=0;v<=4-u;v++){
   const w=[u/4,v/4,1-(u+v)/4],p=[0,1,2].map(k=>t.reduce((s,a,j)=>s+a[k]*w[j],0)),y=meshHeight(field,p[0],p[2]),error=y===undefined?Infinity:Math.abs(y-p[1]);
   maxContactError=Math.max(maxContactError,error);checks++;samples.push({id:b.id,p,y,error,t,w});
  }
 }
}
// Native adjacent buildings have one shared X/Z boundary with a 12 cm
// difference in original bottom elevations. A continuous height field cannot
// equal two heights at the same point. Derive that tolerance ONLY from source
// contacts at each triangle vertex; elsewhere require 1.5 cm, not a global waiver.
const nativeLow=(x,z,y)=>{let low=y;for(const t of bottoms){const[a,b,c]=t,A=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]),u=((b[0]-x)*(c[2]-z)-(b[2]-z)*(c[0]-x))/A,v=((c[0]-x)*(a[2]-z)-(c[2]-z)*(a[0]-x))/A,w=1-u-v;if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)low=Math.min(low,u*a[1]+v*b[1]+w*c[1]);}return low;};
let nativeJointSamples=0,maxConstraintError=0;
for(const s of samples){maxUnconstrainedContactError=Math.max(maxUnconstrainedContactError,Math.abs(surfaceHeight({...field,vertices:undefined,triangles:undefined},s.p[0],s.p[2])-s.p[1]));const expected=s.t.reduce((y,p,i)=>y+nativeLow(p[0],p[2],p[1])*s.w[i],0),error=Math.abs(expected-s.y);if(Math.abs(expected-s.p[1])>.015)nativeJointSamples++;maxConstraintError=Math.max(maxConstraintError,error);if(error>.015)failures.push({id:s.id,p:s.p,y:s.y,expected,error});}
assert(maxUnconstrainedContactError>1,'regression control does not reproduce the unconstrained smoothing defect');
assert(maxContactError<.121,'source joint difference grew beyond 12 cm');
assert.equal(buildings.size,126,'missing original building contacts');
const rendered=await new NodeIO().read(dir+'walk-terrain.glb'),p=rendered.getRoot().listMeshes()[0].listPrimitives()[0];
assert.deepEqual(Array.from(p.getAttribute('POSITION').getArray()),field.vertices,'render and collision positions differ');
assert.deepEqual(Array.from(p.getIndices().getArray()),field.triangles,'render and collision topology differ');
const edges=new Map();for(let i=0;i<field.triangles.length;i+=3)for(let j=0;j<3;j++){const a=field.triangles[i+j],b=field.triangles[i+(j+1)%3],k=[a,b].sort((a,b)=>a-b).join(',');edges.set(k,(edges.get(k)||0)+1);}
let cracks=0;for(const [k,n]of edges){assert(n<=2,'non-manifold ground');if(n!==1)continue;const [a,b]=k.split(',').map(Number),ps=[a,b].map(i=>[field.vertices[i*3],field.vertices[i*3+2]]),border=[0,1].some(j=>Math.abs(ps[0][j]-ps[1][j])<.001&&[j?field.minZ:field.minX,(j?field.minZ:field.minX)+(j?field.nz:field.nx)*field.step].some(v=>Math.abs(ps[0][j]-v)<.001));if(!border)cracks++;}
assert.equal(cracks,0,'interior ground cracks');
const original=await read('surface.json'),W=field.nx+1,N=W*(field.nz+1),oldY=new Float64Array(N),newY=new Float64Array(N);
for(let z=0;z<=field.nz;z++)for(let x=0;x<=field.nx;x++){const X=field.minX+x*field.step,Z=field.minZ+z*field.step;oldY[z*W+x]=meshHeight(original,X,Z);newY[z*W+x]=meshHeight(field,X,Z);}
const curvature=ys=>{let total=0,n=0;for(let z=1;z<field.nz;z++)for(let x=1;x<field.nx;x++){const i=z*W+x;if(!Number.isFinite(ys[i]))continue;const v=Math.abs(ys[i-1]-2*ys[i]+ys[i+1])+Math.abs(ys[i-W]-2*ys[i]+ys[i+W]);if(Number.isFinite(v)){total+=v;n++;}}return total/n;};
const beforeCurvature=curvature(oldY),afterCurvature=curvature(newY);assert(afterCurvature<beforeCurvature,'constrained ground lost the smoothing improvement');
const raised=manifest.buildings.find(b=>b.id===elevated);assert(raised,'missing elevated native connector');const raisedClearance=raised.bounds[1]-meshHeight(field,(raised.bounds[0]+raised.bounds[3])/2,(raised.bounds[2]+raised.bounds[5])/2);assert(raisedClearance>10&&raisedClearance<20,'the original elevated connector was filled into a ground obstacle');
const report={passed:failures.length===0,buildings:buildings.size,checks,maxUnconstrainedContactError,beforeCurvature,afterCurvature,maxContactError,maxConstraintError,nativeJointSamples,cracks,renderMatchesCollision:true,preservedElevatedStructure:elevated,raisedClearance,failures};
await fs.writeFile(dir+'walk-contact-audit.json',JSON.stringify(report,null,2));console.log({...report,failures:failures.slice(0,5)});assert.equal(failures.length,0,'building is floating or buried');
