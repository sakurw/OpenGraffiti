import {sakuraField} from './pv-sakura-field';
import {bloomField} from './pv-bloom-field';
import {guardianField} from './pv-guardian-field';
import type {SurfaceTriangle} from './pv-paint-surface';
import {PaintDocument,PAINT_SIZE} from './pv-paint';
// One continuous field in world space. No camera, facade ID or projected image.
export function paintSpatialTide(doc:PaintDocument,triangles:SurfaceTriangle[],kind: string = 'guardian'){
 const points=triangles.flatMap(t=>t.world),lo=[0,1,2].map(k=>Math.min(...points.map(p=>p.getComponent(k)))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p.getComponent(k))));
 const color=kind==='sakura'?sakuraField(points):kind==='bloom'?bloomField(points):guardianField(points),palette=[[18,21,44]];
 doc.checkpoint();doc.layers[0].name=kind==='sakura'?'桜富士 · SAKURA FUJI':kind==='bloom'?'LUMINOUS BLOOM · 光の繭':'NEON GUARDIAN · 双塔の守り神';
 for(const key of new Set(triangles.map(t=>t.key))){const pixels=doc.pixels(key)!,ctx=pixels.color.getContext('2d')!,im=ctx.createImageData(PAINT_SIZE,PAINT_SIZE),data=im.data;for(let i=0;i<data.length;i+=4){data.set([...palette[0],255],i);}for(const t of triangles.filter(t=>t.key===key)){const [a,b,c]=t.uv,den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-7)continue;const x0=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))-1),x1=Math.min(PAINT_SIZE-1,Math.ceil(Math.max(a.x,b.x,c.x))+1),y0=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))-1),y1=Math.min(PAINT_SIZE-1,Math.ceil(Math.max(a.y,b.y,c.y))+1);for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const u=((b.y-c.y)*(x+.5-c.x)+(c.x-b.x)*(y+.5-c.y))/den,v=((c.y-a.y)*(x+.5-c.x)+(a.x-c.x)*(y+.5-c.y))/den,w=1-u-v;if(Math.min(u,v,w)<-.003)continue;const p=t.world,world=[0,1,2].map(k=>u*p[0].getComponent(k)+v*p[1].getComponent(k)+w*p[2].getComponent(k));data.set([...color(world[0],world[1],world[2]),255],(y*PAINT_SIZE+x)*4);}}ctx.putImageData(im,0,0);doc.dirty.add(key);}
}
