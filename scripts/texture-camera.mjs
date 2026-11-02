import {Matrix4,Vector3} from 'three';
import proj4 from 'proj4';
import {CRS,GEO} from './plateau-geometry.mjs';

// Mapillary/OpenSfM: Rodrigues rotation maps ENU world to camera (right, down, forward).
// PLATEAU local axes: east, up, south. Longitude/latitude are never interchanged.
export function cameraFor(photo,origin,height){
 const ll=photo.computed_geometry?.coordinates;
 if(!ll||!photo.computed_rotation?.every(Number.isFinite)||photo.computed_rotation.length!==3||!Number.isFinite(height))return null;
 const [e,n]=proj4(GEO,CRS,ll),r=new Vector3(...photo.computed_rotation);
 const rotation=r.length()?new Matrix4().makeRotationAxis(r.clone().normalize(),r.length()):new Matrix4();
 const position=[e-origin[0],height-origin[2],-(n-origin[1])];
 const orientation=photo.exif_orientation??1;
 if(![1,3,6,8].includes(orientation))return null;
 const size=photo.width>0&&photo.height>0?[photo.width,photo.height]:photo.downloadSize;
 return {position,rotation,type:photo.camera_type,parameters:photo.camera_parameters||[],size,orientation};
}
// MapillaryJS Transform._sfmToBasic: pose is in the original sensor frame,
// while downloaded thumbnails/masks are already display-oriented. Rotate UVs only.
// https://github.com/mapillary/mapillary-js/blob/main/src/geo/Transform.ts
export function displayUV(u,v,orientation=1){
 switch(orientation){case 1:return [u,v];case 3:return [1-u,1-v];case 6:return [1-v,u];case 8:return [v,1-u];default:return null;}
}
export function projectPhoto(camera,point){
 const [x,y,z]=point.map((v,i)=>v-camera.position[i]);
 const v=new Vector3(x,-z,y).applyMatrix4(camera.rotation),distance=v.length();
 if(distance<.001)return null;
 if(camera.type==='spherical'||camera.type==='equirectangular'){
  const uv=displayUV(Math.atan2(v.x,v.z)/(2*Math.PI)+.5,Math.asin(Math.max(-1,Math.min(1,v.y/distance)))/Math.PI+.5,camera.orientation);
  return uv?[...uv,distance]:null;
 }
 if(camera.type!=='perspective'||v.z<=.001)return null;
 const [f,k1=0,k2=0]=camera.parameters;if(!(f>0))return null;
 const a=v.x/v.z,b=v.y/v.z,r2=a*a+b*b,distortion=1+k1*r2+k2*r2*r2;
 const [w,h]=camera.size,max=Math.max(w,h);
 const uv=displayUV(.5+f*a*distortion*max/w,.5+f*b*distortion*max/h,camera.orientation);
 return uv?[...uv,distance]:null;
}
export function overlapsPhoto(camera,points){
 if(camera.type==='spherical'||camera.type==='equirectangular')return true;
 const uv=points.map(p=>projectPhoto(camera,p)).filter(p=>p&&p.every(Number.isFinite));
 if(!uv.length)return false;
 return Math.min(...uv.map(p=>p[0]))<1&&Math.max(...uv.map(p=>p[0]))>0&&Math.min(...uv.map(p=>p[1]))<1&&Math.max(...uv.map(p=>p[1]))>0;
}
// Height is deliberately derived from nearby 3D roads, NOT raw Mapillary altitude.
// This remains an estimate, not a geodetically calibrated camera location.
export function roadHeight(point,sections){
 let best=null;
 for(const s of sections){
  const dx=s.end[0]-s.start[0],dz=s.end[2]-s.start[2],d2=dx*dx+dz*dz;
  if(d2<.001)continue;
  const t=Math.max(0,Math.min(1,((point[0]-s.start[0])*dx+(point[2]-s.start[2])*dz)/d2));
  const d=Math.hypot(point[0]-s.start[0]-t*dx,point[2]-s.start[2]-t*dz);
  if(!best||d<best.distance)best={height:s.start[1]+t*(s.end[1]-s.start[1])+1.65,distance:d,roadId:s.sourceRoadId,method:'nearest-LOD3-road-plus-1.65m-estimate'};
 }
 return best?.distance<50?best:null;
}
