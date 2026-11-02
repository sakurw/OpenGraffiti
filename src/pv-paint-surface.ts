import * as T from 'three';
import {PAINT_SIZE} from './pv-paint';
export interface PaintMesh {mesh:T.Mesh;key:string}
export interface SurfaceTriangle {id:number;key:string;mesh:T.Mesh;face:number;world:T.Vector3[];uv:T.Vector2[]}
export interface SurfaceSeam {a:SurfaceTriangle;b:SurfaceTriangle;au:T.Vector2[];bu:T.Vector2[]}
interface Edge {triangle:SurfaceTriangle;a:T.Vector3;b:T.Vector3;ua:T.Vector2;ub:T.Vector2;va:number;vb:number}
export class PaintSurface {
 triangles:SurfaceTriangle[]=[];private adjacent=new Map<number,Set<number>>();private seams:SurfaceSeam[]=[];
 private pixelBins=new Map<string,Projection[]>();
 private sampleCount=0;
 private samples=new Map<number,Map<number,{triangle:SurfaceTriangle;world:T.Vector3}|undefined>>();
 private scopes=new Map<string,Map<number,ClipVertex[][]>>();
 private projected:Projection[]=[];private visibility=new Map<Projection,ClipVertex[][]>();private occlusion=new Map<Projection,{cuts:((v:T.Vector4)=>number)[];x0:number;x1:number;y0:number;y1:number;near:number;far:number}>();private planeKeys=new Map<number,string>();
 private stamp='';private width=1;private height=1;private bins=new Map<string,Projection[]>();
 constructor(parts:PaintMesh[]){
  const vertices:T.Vector3[]=[],bins=new Map<string,number[]>(),edges=new Map<string,Edge[]>(),cell=.06;
  const vertex=(p:T.Vector3)=>{const q=p.toArray().map(v=>Math.floor(v/cell));let best=-1,d=cell;for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const i of bins.get([q[0]+x,q[1]+y,q[2]+z].join(','))||[]){const v=vertices[i].distanceTo(p);if(v<d){best=i;d=v;}}if(best>=0)return best;const id=vertices.length,k=q.join(',');vertices.push(p);if(!bins.has(k))bins.set(k,[]);bins.get(k)!.push(id);return id;};
  for(const {mesh,key}of parts){mesh.updateWorldMatrix(true,false);const g=mesh.geometry,p=g.getAttribute('position'),uv=g.getAttribute('uv'),ix=g.index;for(let i=0;i<(ix?.count||p.count);i+=3){const ids=[0,1,2].map(k=>ix?ix.getX(i+k):i+k),world=ids.map(j=>new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(mesh.matrixWorld)),tex=ids.map(j=>new T.Vector2(uv.getX(j)*PAINT_SIZE,uv.getY(j)*PAINT_SIZE)),triangle={id:this.triangles.length,key,mesh,face:i/3,world,uv:tex};if(new T.Triangle(...world as [T.Vector3,T.Vector3,T.Vector3]).getArea()<.00001)continue;this.triangles.push(triangle);const normal=new T.Triangle(...world as [T.Vector3,T.Vector3,T.Vector3]).getNormal(new T.Vector3());if((Math.abs(normal.x)>.001?normal.x:Math.abs(normal.y)>.001?normal.y:normal.z)<0)normal.negate();this.planeKeys.set(triangle.id,normal.toArray().map(v=>v.toFixed(2)).join(',')+'/'+normal.dot(world[0]).toFixed(1));const vs=world.map(vertex);for(let k=0;k<3;k++){const j=(k+1)%3,a=vs[k],b=vs[j],id=[a,b].sort((a,b)=>a-b).join(',');if(a===b)continue;if(!edges.has(id))edges.set(id,[]);edges.get(id)!.push({triangle,a:world[k],b:world[j],ua:tex[k],ub:tex[j],va:a,vb:b});}}}
  const connect=(a:Edge,b:Edge,lo=0,hi=1)=>{if(a.triangle===b.triangle)return;for(const [x,y]of [[a.triangle.id,b.triangle.id],[b.triangle.id,a.triangle.id]]){if(!this.adjacent.has(x))this.adjacent.set(x,new Set());this.adjacent.get(x)!.add(y);}const ab=a.b.clone().sub(a.a),ba=b.b.clone().sub(b.a),world=[a.a.clone().addScaledVector(ab,lo),a.a.clone().addScaledVector(ab,hi)],au=[a.ua.clone().lerp(a.ub,lo),a.ua.clone().lerp(a.ub,hi)],bu=world.map(p=>b.ua.clone().lerp(b.ub,T.MathUtils.clamp(p.clone().sub(b.a).dot(ba)/ba.lengthSq(),0,1)));if(a.triangle.key!==b.triangle.key||au.some((p,i)=>p.distanceTo(bu[i])>.5))this.seams.push({a:a.triangle,b:b.triangle,au,bu});};
  const loose:Edge[]=[];for(const es of edges.values()){if(es.length===1)loose.push(es[0]);for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++)connect(es[i],es[j]);}
  // Connect partial shared edges too (a long edge meeting two shorter edges).
  for(let i=0;i<loose.length;i++){const a=loose[i],ab=a.b.clone().sub(a.a),length=ab.length();if(length<.06)continue;const dir=ab.clone().divideScalar(length),box=new T.Box3().setFromPoints([a.a,a.b]).expandByScalar(cell);for(let j=i+1;j<loose.length;j++){const b=loose[j];if(!box.intersectsBox(new T.Box3().setFromPoints([b.a,b.b])))continue;const ba=b.b.clone().sub(b.a),bl=ba.length();if(bl<.06||Math.abs(dir.dot(ba)/bl)<.9999)continue;const offset=b.a.clone().sub(a.a);if(offset.clone().addScaledVector(dir,-offset.dot(dir)).length()>cell)continue;const q=[offset.dot(dir),b.b.clone().sub(a.a).dot(dir)].sort((a,b)=>a-b),lo=Math.max(0,q[0]),hi=Math.min(length,q[1]);if(hi-lo>.06)connect(a,b,lo/length,hi/length);}}
 }
 component(seed:number){const found=new Set([seed]),todo=[seed];while(todo.length){for(const n of this.adjacent.get(todo.pop()!)||[])if(!found.has(n)){found.add(n);todo.push(n);}}return {triangles:[...found].map(i=>this.triangles[i]),seams:this.seams.filter(s=>found.has(s.a.id)&&found.has(s.b.id))};}
 seed(mesh:T.Object3D,face:number){return this.triangles.find(t=>t.mesh===mesh&&t.face===face);}
 project(camera:T.Camera,w:number,h:number){camera.updateMatrixWorld();const stamp=camera.matrixWorld.elements.join(',')+'/'+camera.projectionMatrix.elements.join(',')+'/'+w+'/'+h;if(stamp===this.stamp)return;this.stamp=stamp;this.scopes.clear();this.samples.clear();this.sampleCount=0;this.width=w;this.height=h;this.bins.clear();this.pixelBins.clear();this.projected=[];this.visibility.clear();this.occlusion.clear();const vp=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);for(const triangle of this.triangles){const clip=triangle.world.map(p=>new T.Vector4(p.x,p.y,p.z,1).applyMatrix4(vp));if(clip.some(p=>p.w<=.01))continue;const screen=clip.map(p=>new T.Vector2((p.x/p.w+1)*w/2,(1-p.y/p.w)*h/2));const minX=Math.max(0,Math.floor(Math.min(...screen.map(p=>p.x))/64)),maxX=Math.min(Math.ceil(w/64),Math.floor(Math.max(...screen.map(p=>p.x))/64)),minY=Math.max(0,Math.floor(Math.min(...screen.map(p=>p.y))/64)),maxY=Math.min(Math.ceil(h/64),Math.floor(Math.max(...screen.map(p=>p.y))/64)),p={triangle,screen,clip};this.projected.push(p);for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const key=x+','+y;if(!this.bins.has(key))this.bins.set(key,[]);this.bins.get(key)!.push(p);}for(let j=Math.max(0,Math.floor(Math.min(...screen.map(v=>v.y))/16));j<=Math.min(Math.ceil(h/16),Math.floor(Math.max(...screen.map(v=>v.y))/16));j++)for(let i=Math.max(0,Math.floor(Math.min(...screen.map(v=>v.x))/16));i<=Math.min(Math.ceil(w/16),Math.floor(Math.max(...screen.map(v=>v.x))/16));i++){const key=i+','+j;if(!this.pixelBins.has(key))this.pixelBins.set(key,[]);this.pixelBins.get(key)!.push(p);}}}
 private prepareOcclusion(){if(this.occlusion.size)return;const w=this.width,h=this.height;for(const q of this.projected){const [a,b,c]=q.screen,den=cross(b.clone().sub(a),c.clone().sub(a)),sign=Math.sign(den),za=q.clip[0].z/q.clip[0].w,zb=q.clip[1].z/q.clip[1].w,zc=q.clip[2].z/q.clip[2].w,A=((zb-za)*(c.y-a.y)-(zc-za)*(b.y-a.y))/den,B=((b.x-a.x)*(zc-za)-(c.x-a.x)*(zb-za))/den,C=za-A*a.x-B*a.y;
 const cuts=Math.abs(den)>.001?[...q.screen.map((a,i)=>{const b=q.screen[(i+1)%3],dx=b.x-a.x,dy=b.y-a.y;return (v:T.Vector4)=>sign*(dx*((v.w-v.y)*h/2-a.y*v.w)-dy*((v.x+v.w)*w/2-a.x*v.w));}),(v:T.Vector4)=>v.z-A*(v.x+v.w)*w/2-B*(v.w-v.y)*h/2-(C+1e-8)*v.w]:[];
 this.occlusion.set(q,{cuts,x0:Math.min(...q.screen.map(v=>v.x)),x1:Math.max(...q.screen.map(v=>v.x)),y0:Math.min(...q.screen.map(v=>v.y)),y1:Math.max(...q.screen.map(v=>v.y)),near:Math.min(...q.clip.map(v=>v.w)),far:Math.max(...q.clip.map(v=>v.w))});}}
 private visibleProjection(p:Projection){const cached=this.visibility.get(p);if(cached)return cached;this.prepareOcclusion();const w=this.width,h=this.height,pb=this.occlusion.get(p)!;let fragments=pb.cuts.length?[clippedProjection(p,w/2,h/2,Math.hypot(w,h),w,h)]:[];
 const nearby=new Set<Projection>();for(let y=Math.max(0,Math.floor(pb.y0/64));y<=Math.min(Math.ceil(h/64),Math.floor(pb.y1/64));y++)for(let x=Math.max(0,Math.floor(pb.x0/64));x<=Math.min(Math.ceil(w/64),Math.floor(pb.x1/64));x++)for(const q of this.bins.get(x+','+y)||[])nearby.add(q);
 for(const q of [...nearby].sort((a,b)=>this.occlusion.get(a)!.near-this.occlusion.get(b)!.near)){if(!fragments.length)break;const qb=this.occlusion.get(q)!;if(q===p||!qb.cuts.length||qb.near>pb.far+.01||qb.x1<pb.x0||qb.x0>pb.x1||qb.y1<pb.y0||qb.y0>pb.y1)continue;fragments=fragments.flatMap(f=>subtract(f,qb.cuts));}
 fragments=fragments.filter(f=>projectedArea(f,w,h)>.001);this.visibility.set(p,fragments);return fragments;
 }
 prepare(){for(const p of this.projected)this.visibleProjection(p);}
 sample(x:number,y:number){let best:Projection|undefined,depth=Infinity;for(const p of this.pixelBins.get(Math.floor(x/16)+','+Math.floor(y/16))||[]){const [a,b,c]=p.screen,d=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(d)<1e-8)continue;const v=((x-a.x)*(c.y-a.y)-(y-a.y)*(c.x-a.x))/d,q=((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x))/d,u=1-v-q;if(u<0||v<0||q<0)continue;const z=1/(u/p.clip[0].w+v/p.clip[1].w+q/p.clip[2].w);if(z<depth){depth=z;best=p;}}return best?{triangle:best.triangle,world:worldAt(best,x,y)}:undefined;}

 scope(x:number,y:number,r:number,camera:T.Camera){
  const sample=(x:number,y:number)=>{const ix=Math.round(x*1e5),iy=Math.round(y*1e5);let row=this.samples.get(iy);if(!row){row=new Map();this.samples.set(iy,row);}if(row.has(ix))return row.get(ix);const hit=this.sample(x,y);row.set(ix,hit);if(++this.sampleCount>131072){this.samples.clear();this.sampleCount=0;}return hit;};
  // Supporting faces can lie just outside a small dab. Ink is still clipped
  // to the original particle by scopedRegions; this margin only finds anchors.
  const core=Math.ceil(r)+6;const tile=8,cx=(Math.floor(x/tile)+.5)*tile,cy=(Math.floor(y/tile)+.5)*tile,cr=Math.max(32,2**Math.ceil(Math.log2(Math.max(1,r))))+55,key=[cx,cy,cr,Math.ceil(core)].join(',');
  const cached=this.scopes.get(key);if(cached)return cached;x=cx;y=cy;r=cr;
  const candidates=this.candidates(x,y,r,true),byId=new Map(candidates.map(p=>[p.triangle.id,p])),regions=new Map<number,ClipVertex[][]>(),visible=new Set<number>(),hidden=new Set<number>(),planes=new Map<number,string>(),w=this.width,h=this.height;
  const inverseTranspose=new T.Matrix4().multiplyMatrices(camera.matrixWorld,camera.projectionMatrixInverse).transpose(),supportPlanes=new Map<number,{plane:T.Plane;coefficients:T.Vector4}>();
  const support=(hit:SurfaceTriangle)=>{let found=supportPlanes.get(hit.id);if(!found){const plane=new T.Plane().setFromCoplanarPoints(...hit.world as [T.Vector3,T.Vector3,T.Vector3]);found={plane,coefficients:new T.Vector4(...plane.normal.toArray() as [number,number,number],plane.constant).applyMatrix4(inverseTranspose)};supportPlanes.set(hit.id,found);}return found;};
  const area=(p:Projection)=>cross(p.screen[1].clone().sub(p.screen[0]),p.screen[2].clone().sub(p.screen[0]));
  for(const p of candidates){planes.set(p.triangle.id,this.planeKeys.get(p.triangle.id)!);
   let fragments=this.visibleProjection(p).map(source=>clippedProjection(p,x,y,r,w,h,undefined,undefined,undefined,source));
   fragments=fragments.filter(p=>projectedArea(p,w,h)>.001);
   if(fragments.length){visible.add(p.triangle.id);regions.set(p.triangle.id,fragments);}
   // A partially visible return also needs its occluded portion closed.
   if(Math.abs(area(p))<=.001||fragments.reduce((sum,f)=>sum+projectedArea(f,w,h),0)<projectedArea(clippedProjection(p,x,y,r,w,h),w,h)-.01)hidden.add(p.triangle.id);
  }
  // A hidden strip must have a visible supporting surface on BOTH sides at
  // that screen location. Global min/max depths would paint unbounded ends.
  const visited=new Set<number>();for(const seed of hidden){if(visited.has(seed))continue;const todo=[seed],group:number[]=[],anchors=new Set<string>();visited.add(seed);while(todo.length){const id=todo.pop()!;group.push(id);for(const next of this.adjacent.get(id)||[]){if(visible.has(next))anchors.add(planes.get(next)!);if(hidden.has(next)&&!visited.has(next)){visited.add(next);todo.push(next);}}}if(anchors.size<2)continue;
   const polygons=new Map(group.map(id=>[id,clippedProjection(byId.get(id)!,x,y,r,w,h)])),sliceExtents=new Map<string,number[]>(),hitCache=new Map<string,({triangle:SurfaceTriangle;world:T.Vector3}|undefined)[]>();
   const planeGroups=new Map<string,number[]>();for(const id of group){const key=planes.get(id)!;if(!planeGroups.has(key))planeGroups.set(key,[]);planeGroups.get(key)!.push(id);}
   for(const id of group){const p=byId.get(id)!,polygon=clippedProjection(p,x,y,core,w,h);if(polygon.length<3)continue;const screen=polygon.map(v=>new T.Vector2((v.clip.x/v.clip.w+1)*w/2,(1-v.clip.y/v.clip.w)*h/2)),xs=screen.map(v=>v.x),ys=screen.map(v=>v.y),vertical=Math.max(...ys)-Math.min(...ys)>=Math.max(...xs)-Math.min(...xs),long=vertical?ys:xs,lo=Math.min(...long),hi=Math.max(...long),pieces:ClipVertex[][]=[];
    const axis=(v:T.Vector4)=>vertical?(v.w-v.y)*h/2:(v.x+v.w)*w/2,other=(v:T.Vector4)=>vertical?(v.x+v.w)*w/2:(v.w-v.y)*h/2;
    for(let start=Math.floor(lo/4)*4;start<hi;start+=4){const end=Math.min(hi,start+4),strip=clipPlane(clipPlane(polygon,v=>axis(v)-start*v.w),v=>end*v.w-axis(v));if(strip.length<3)continue;// Probe across the entire connected coplanar face, not an individual
     // atlas triangle: the latter can put an endpoint inside its neighbour.
     const sliceKey=[planes.get(id),vertical,start,end].join('/');let across=sliceExtents.get(sliceKey);if(!across){across=planeGroups.get(planes.get(id)!)!.flatMap(n=>clipPlane(clipPlane(polygons.get(n)!,v=>axis(v)-start*v.w),v=>end*v.w-axis(v)).map(v=>other(v.clip)/v.clip.w));sliceExtents.set(sliceKey,across);}const middle=(start+end)/2,left=Math.min(...across)-.8,right=Math.max(...across)+.8,probes=vertical?[[left,middle],[right,middle]]:[[middle,left],[middle,right]];
     if(probes.some(([px,py])=>px<0||py<0||px>=w||py>=h))continue;
     let hits=hitCache.get(sliceKey);if(!hits){hits=probes.map(([px,py])=>sample(px,py));
     // The far edge of a recessed return can itself be occluded by the near
     // facade. Search the nearby projected surface for its visible supporting face.
     // Stop at the viewport or bounded support neighbourhood; an open end never bridges.
     for(let side=0;side<2;side++){
      const own=()=>hits![side]&&planes.get(hits![side]!.triangle.id),opposite=()=>hits![1-side]&&planes.get(hits![1-side]!.triangle.id);
      for(let offset=2;offset<=Math.max(64,r*2)&&(!own()||!anchors.has(own()!)||own()===opposite());offset+=2){const [sx,sy]=probes[side],px=sx+(vertical?(side?offset:-offset):0),py=sy+(vertical?0:(side?offset:-offset));if(px<0||py<0||px>=w||py>=h)break;const next=sample(px,py);if(next&&anchors.has(planes.get(next.triangle.id)!))hits[side]=next;}
     }
     hitCache.set(sliceKey,hits);}
     if(hits.some(v=>!v))continue;const [a,b]=hits as {triangle:SurfaceTriangle;world:T.Vector3}[],pa=planes.get(a.triangle.id),pb=planes.get(b.triangle.id);if(!pa||!pb||pa===pb||!anchors.has(pa)||!anchors.has(pb))continue;
     // Clip by the two actual supporting planes, not global triangle depth
     // extrema, which would extend ink past oblique visible endpoints.
     let between=strip;
     for(const [hit,otherHit]of [[a,b],[b,a]]){const {plane,coefficients}=support(hit.triangle),sign=Math.sign(plane.distanceToPoint(otherHit.world));if(!sign){between=[];break;}between=clipPlane(between,v=>sign*coefficients.dot(v)+.02);}
     if(between.length>=3)pieces.push(between);
    }
    if(pieces.length)regions.set(id,[...(regions.get(id)||[]),...pieces]);
   }
  }
  if(this.scopes.size>512)this.scopes.clear();this.scopes.set(key,regions);return regions;
 }

 candidates(x:number,y:number,r:number,through=false){const found=new Set<Projection>();for(let j=Math.floor((y-r)/64);j<=Math.floor((y+r)/64);j++)for(let i=Math.floor((x-r)/64);i<=Math.floor((x+r)/64);i++)for(const p of this.bins.get(i+','+j)||[])found.add(p);return [...found].filter(p=>(through||Math.abs(cross(p.screen[1].clone().sub(p.screen[0]),p.screen[2].clone().sub(p.screen[0])))>=.001)&&closest(p.screen,new T.Vector2(x,y)).distanceToSquared(new T.Vector2(x,y))<=r*r);}
}
interface Projection {triangle:SurfaceTriangle;screen:T.Vector2[];clip:T.Vector4[]}
interface ClipVertex {clip:T.Vector4;uv:T.Vector2}
function clipPlane(polygon:ClipVertex[],distance:(v:T.Vector4)=>number){const out:ClipVertex[]=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a.clip),db=distance(b.clip);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({clip:a.clip.clone().lerp(b.clip,t),uv:a.uv.clone().lerp(b.uv,t)});}}return out;}
function subtract(polygon:ClipVertex[],cuts:((v:T.Vector4)=>number)[]){if(cuts.some(c=>polygon.every(v=>c(v.clip)<=0)))return [polygon];let inside=polygon;const out:ClipVertex[][]=[];for(const cut of cuts){if(inside.length<3)break;const outside=clipPlane(inside,v=>-cut(v));if(outside.length>=3)out.push(outside);inside=clipPlane(inside,cut);}return out;}
function projectedArea(polygon:ClipVertex[],w:number,h:number){const ps=polygon.map(v=>[(v.clip.x/v.clip.w+1)*w/2,(1-v.clip.y/v.clip.w)*h/2]);return Math.abs(ps.reduce((s,a,i)=>{const b=ps[(i+1)%ps.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;}
function cross(a:T.Vector2,b:T.Vector2){return a.x*b.y-a.y*b.x;}
function weights(p:Projection,x:number,y:number){const [a,b,c]=p.screen,d=cross(b.clone().sub(a),c.clone().sub(a)),v=new T.Vector2(x,y),b1=cross(v.clone().sub(a),c.clone().sub(a))/d,b2=cross(b.clone().sub(a),v.clone().sub(a))/d,q=[1-b1-b2,b1,b2].map((v,i)=>v/p.clip[i].w),sum=q.reduce((a,b)=>a+b,0);return q.map(v=>v/sum);}
export function uvAt(p:Projection,x:number,y:number){const q=weights(p,x,y);return p.triangle.uv.reduce((s,p,i)=>s.addScaledVector(p,q[i]),new T.Vector2());}
export function worldAt(p:Projection,x:number,y:number){const q=weights(p,x,y);return p.triangle.world.reduce((s,p,i)=>s.addScaledVector(p,q[i]),new T.Vector3());}
export function nearest(p:Projection,x:number,y:number){return closest(p.screen,new T.Vector2(x,y));}
function closest(ps:T.Vector2[],p:T.Vector2){const [a,b,c]=ps,area=cross(b.clone().sub(a),c.clone().sub(a)),v=cross(p.clone().sub(a),c.clone().sub(a))/area,w=cross(b.clone().sub(a),p.clone().sub(a))/area;if(Math.abs(area)>.001&&v>=0&&w>=0&&v+w<=1)return p;let best=a,d=Infinity;for(let i=0;i<3;i++){const a=ps[i],b=ps[(i+1)%3],ab=b.clone().sub(a),q=a.clone().addScaledVector(ab,T.MathUtils.clamp(p.clone().sub(a).dot(ab)/ab.lengthSq(),0,1)),dist=q.distanceToSquared(p);if(dist<d){d=dist;best=q;}}return best;}
export function triangleRegion(uv:T.Vector2[],padding=1.5){const path=new Path2D(),area=uv.reduce((s,p,i)=>{const q=uv[(i+1)%uv.length];return s+p.x*q.y-p.y*q.x;},0),points=area>0?uv:[...uv].reverse();path.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))path.lineTo(p.x,p.y);path.closePath();for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,d=Math.max(.0001,Math.hypot(dx,dy)),nx=-dy/d*padding,ny=dx/d*padding;path.moveTo(a.x-nx,a.y-ny);path.lineTo(b.x-nx,b.y-ny);path.lineTo(b.x+nx,b.y+ny);path.lineTo(a.x+nx,a.y+ny);path.closePath();path.moveTo(a.x+padding,a.y);path.arc(a.x,a.y,padding,0,Math.PI*2);path.closePath();}return path;}

// Clip in homogeneous screen space; no inverse UV projection is needed even
// when a perpendicular face projects to a line. UVs interpolate on the model.
function clippedProjection(p:Projection,x:number,y:number,r:number,w:number,h:number,shape?:{x:number;y:number}[],minDepth?:number,maxDepth?:number,source?:ClipVertex[]){
 let polygon=source||p.clip.map((clip,i)=>({clip,uv:p.triangle.uv[i]}));
 if(!source)for(const cut of [(v:T.Vector4)=>v.x+v.w,(v:T.Vector4)=>v.w-v.x,(v:T.Vector4)=>v.y+v.w,(v:T.Vector4)=>v.w-v.y])polygon=clipPlane(polygon,cut);
 for(let side=0;side<(shape?.length||24)&&polygon.length;side++){
  const a=side*Math.PI/12,edge=shape&&shape[(side+1)%shape.length],point=shape?.[side],dx=edge&&point?edge.x-point.x:0,dy=edge&&point?edge.y-point.y:0,nx=shape?dy:Math.cos(a),ny=shape?-dx:Math.sin(a),offset=point?nx*point.x+ny*point.y:0,distance=(c:T.Vector4)=>shape?offset*c.w-nx*(c.x+c.w)*w/2-ny*(c.w-c.y)*h/2:r*c.w-nx*((c.x+c.w)*w/2-x*c.w)-ny*((c.w-c.y)*h/2-y*c.w),out:typeof polygon=[];
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a.clip),db=distance(b.clip);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({clip:a.clip.clone().lerp(b.clip,t),uv:a.uv.clone().lerp(b.uv,t)});}}
  polygon=out;
 }
 if(minDepth!==undefined&&maxDepth!==undefined)for(const [sign,limit]of [[1,minDepth],[-1,maxDepth]]){const out:typeof polygon=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*(a.clip.w-limit),db=sign*(b.clip.w-limit);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push({clip:a.clip.clone().lerp(b.clip,t),uv:a.uv.clone().lerp(b.uv,t)});}}polygon=out;}
 return polygon;
}

export function throughRegion(p:Projection,x:number,y:number,r:number,w:number,h:number,shape?:{x:number;y:number}[],minDepth?:number,maxDepth?:number){return clippedProjection(p,x,y,r,w,h,shape,minDepth,maxDepth).map(p=>p.uv);}
export function scopedRegions(p:Projection,regions:ClipVertex[][],x:number,y:number,r:number,w:number,h:number,shape?:{x:number;y:number}[]){return regions.map(source=>clippedProjection(p,x,y,r,w,h,shape,undefined,undefined,source).map(v=>v.uv)).filter(p=>p.length>=3);}
