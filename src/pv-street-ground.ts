import {surfaceHeight,type SurfaceField} from './pv-ground';
import type {Building,Road} from './pv-data';

// Display-only soil section: preserve the source DEM tops and building bases.
// Curtains fill the volume below them in the locked orthographic road view.
export function streetSoil(field:SurfaceField,road:Road,side:'left'|'right',buildings:Building[],lo:number,hi:number,bottom:number){
 const [x,z]=road.start,dx=road.end[0]-x,dz=road.end[1]-z,l=Math.hypot(dx,dz),ux=dx/l,uz=dz/l,sign=side==='left'?-1:1,nx=-uz*sign,nz=ux*sign,extent=Math.max(hi-lo,l,100)*1.5,mid=(lo+hi)/2,positions:number[]=[],quad=(ax:number,az:number,ay:number,bx:number,bz:number,by:number)=>positions.push(ax,ay,az,ax,bottom,az,bx,by,bz,bx,by,bz,ax,bottom,az,bx,bottom,bz);
 const maxDepth=Math.hypot(field.nx*field.step,field.nz*field.step),step=8;
 for(let depth=0;depth<=maxDepth;depth+=24)for(let t=mid-extent;t<mid+extent;t+=step){const ax=x+ux*t+nx*depth,az=z+uz*t+nz*depth,bx=x+ux*(t+step)+nx*depth,bz=z+uz*(t+step)+nz*depth;if(depth>0&&(ax<field.minX||ax>field.minX+field.nx*field.step||az<field.minZ||az>field.minZ+field.nz*field.step))continue;quad(ax,az,surfaceHeight(field,ax,az),bx,bz,surfaceHeight(field,bx,bz));}
 for(const b of buildings){const [x,y,z,X,,Z]=b.bounds;for(const [a,c]of [[[x,z],[X,z]],[[X,z],[X,Z]],[[X,Z],[x,Z]],[[x,Z],[x,z]]])quad(a[0],a[1],y,c[0],c[1],y);}
 return new Float32Array(positions);
}
