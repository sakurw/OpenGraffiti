import {Ray,Vector3,DoubleSide} from 'three';
import {sub,cross,dot} from './plateau-geometry.mjs';
import {projectGroundPhotoSet} from './texture-ground-camera.mjs';
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const triangleArea=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
export function createGroundSurfaceTester(bvh){
 const ray=new Ray(),dir=new Vector3();
 return function test(r,t,n) {
  const cameras=r.positionValidation==='projection-ensemble'?[r,...r.projectionEnsemble]:[r];
  const facing=Math.min(...cameras.map(c=>{const view=sub(c.cameraPosition,t[0]);return dot(n,view)/Math.hypot(...view);}));
  if(facing<.3) return {reason:'backface'};
  const range=r.supportedHeightRangeMetres;
  if(t.some(p=>p[1]<range[0]||p[1]>range[1])) return {reason:'outside-validated-height'};
  const samples=[...t,t[0].map((_,i)=>(t[0][i]+t[1][i]+t[2][i])/3),...t.map((p,i)=>mid(p,t[(i+1)%3]))];
  const q=[];const [w,h]=r.imageSize;
  for(const p of samples) {
    const projected=projectGroundPhotoSet(r,p);if(projected.reason)return projected;
    for(let i=0;i<cameras.length;i++){
      const uv=projected.projections[i];
      if(uv[0]<r.margin||uv[1]<r.margin||uv[0]>=w-r.margin||uv[1]>=h-r.margin) return {reason:'image-border'};
      if(r.mask[Math.floor(uv[1])*w+Math.floor(uv[0])]!==255) return {reason:'facade-mask'};
      ray.origin.set(...cameras[i].cameraPosition);dir.set(...p).sub(ray.origin);const length=dir.length();ray.direction.copy(dir).normalize();
      if(bvh.raycastFirst(ray,DoubleSide,.05,length-.08)) return {reason:'occlusion'};
    }
    q.push(projected.projections);
  }
  const ppm=Math.min(...cameras.map((_,i)=>{
    const [a,b,c]=q.slice(0,3).map(point=>point[i]);
    const pixArea=Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/2;
    return Math.sqrt(pixArea/Math.max(triangleArea(t),1e-12));
  }));
  if(ppm<2) return {reason:'resolution'};
  return {score:ppm*facing,uv:q.slice(0,3).map(p=>[p[0][0]/w,p[0][1]/h])};
}
}
