import {dot} from './plateau-geometry.mjs';
// Clip projected triangles while interpolating world positions and source UVs.
// The resulting pieces are shared by the 2D bake and 3D paint overlay.
const eps=1e-8;
function cut(poly,fn){
 const out=[];
 for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],fa=fn(a),fb=fn(b);
  if(fa>=0)out.push(a);
  if((fa>=0)!==(fb>=0)){const t=fa/(fa-fb);out.push(a.map((v,j)=>v+(b[j]-v)*t));}
 }
 return out;
}
const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2;
function triangle(p,ids,frame){
 let v=ids.map(i=>{const pt=p.points[i];return [dot(pt,frame.u),pt[1],dot(pt,frame.normal),...pt,...(p.sourceUV?.slice(i*2,i*2+2)||[0,0])];});
 if(Math.abs(area(v))<eps)return null;if(area(v)<0)v.reverse();
 const [a,b,c]=v,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
 const dx=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/den,dy=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/den;
 return {v,id:p.id,depth:q=>a[2]+dx*(q[0]-a[0])+dy*(q[1]-a[1]),minX:Math.min(...v.map(p=>p[0])),maxX:Math.max(...v.map(p=>p[0])),minY:Math.min(...v.map(p=>p[1])),maxY:Math.max(...v.map(p=>p[1]))};
}
function triangles(p,frame){const out=[];for(let i=0;i<p.indices.length;i+=3){const t=triangle(p,p.indices.slice(i,i+3),frame);if(t)out.push(t);}return out;}
export function visibleFacades(polygons,occluders,frame){
 const blockers=occluders.flatMap(p=>triangles(p,frame)),result=[];
 for(const p of polygons){
  const points=[],sourceUV=[],canvasUV=[],indices=[];
  for(const t of triangles(p,frame)){
   let pieces=[t.v];
   for(const b of blockers){
    if(b.id===p.id||b.maxX<=t.minX||b.minX>=t.maxX||b.maxY<=t.minY||b.minY>=t.maxY)continue;
    const cover=cut(b.v,q=>b.depth(q)-t.depth(q)-1e-6);if(cover.length<3||Math.abs(area(cover))<eps)continue;
    const remainder=[];
    for(const piece of pieces){
     let overlap=piece;for(let i=0;i<cover.length&&overlap.length>=3;i++){const a=cover[i],c=cover[(i+1)%cover.length];overlap=cut(overlap,q=>(c[0]-a[0])*(q[1]-a[1])-(c[1]-a[1])*(q[0]-a[0]));}
     if(overlap.length<3||Math.abs(area(overlap))<=eps){remainder.push(piece);continue;}
     let inside=piece;
     for(let i=0;i<cover.length&&inside.length>=3;i++){
      const a=cover[i],c=cover[(i+1)%cover.length],side=q=>(c[0]-a[0])*(q[1]-a[1])-(c[1]-a[1])*(q[0]-a[0]);
      const outside=cut(inside,q=>-side(q));if(outside.length>=3&&Math.abs(area(outside))>eps)remainder.push(outside);
      inside=cut(inside,side);
     }
    }
    pieces=remainder;if(!pieces.length)break;
   }
   for(const piece of pieces){const offset=points.length;
    for(const v of piece){points.push(v.slice(3,6));sourceUV.push(...v.slice(6,8));canvasUV.push((v[0]-frame.lo[0])/frame.width,(frame.hi[1]-v[1])/frame.height);}
    for(let i=1;i<piece.length-1;i++)indices.push(offset,offset+i,offset+i+1);
   }
  }
  if(indices.length)result.push({...p,points,sourceUV,canvasUV,indices});
 }
 return result;
}
