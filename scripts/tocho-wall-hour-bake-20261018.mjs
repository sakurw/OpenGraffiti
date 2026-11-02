import fs from 'node:fs/promises';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const out='data/texture-city/tocho-wall-hour-20261018';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read('public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb');
const p=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives())[2];
const pos=p.getAttribute('POSITION').getArray(),uv=p.getAttribute('TEXCOORD_0').getArray(),idx=p.getIndices()?.getArray()??Array.from({length:pos.length/3},(_,i)=>i);
const tangent=[4.08/Math.hypot(4.08,21.35),0,21.35/Math.hypot(4.08,21.35)];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const verts=Array.from({length:pos.length/3},(_,i)=>({p:Array.from(pos.slice(i*3,i*3+3)),uv:Array.from(uv.slice(i*2,i*2+2))}));
const ts=verts.map(v=>dot(v.p,tangent));
const minT=Math.min(...ts),maxT=Math.max(...ts),minY=140,maxY=174;
const W=1024,H=Math.round(W*(maxY-minY)/(maxT-minT));
const photo=await sharp(p.getMaterial().getBaseColorTexture().getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
const target=Buffer.alloc(W*H*4),covered=new Uint8Array(W*H);
const sample=(u,v,c)=>{
 const x=Math.max(0,Math.min(photo.info.width-1,u*photo.info.width-.5)),y=Math.max(0,Math.min(photo.info.height-1,v*photo.info.height-.5));
 const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,photo.info.width-1),y1=Math.min(y0+1,photo.info.height-1),fx=x-x0,fy=y-y0;
 const at=(xx,yy)=>photo.data[(yy*photo.info.width+xx)*photo.info.channels+c];
 return (at(x0,y0)*(1-fx)+at(x1,y0)*fx)*(1-fy)+(at(x0,y1)*(1-fx)+at(x1,y1)*fx)*fy;
};
let selectedTriangles=0;
for(let i=0;i<idx.length;i+=3){
 const vs=Array.from(idx.slice(i,i+3),j=>verts[j]);
 const ps=vs.map(v=>[(dot(v.p,tangent)-minT)/(maxT-minT)*W,(maxY-v.p[1])/(maxY-minY)*H]);
 const minX=Math.max(0,Math.floor(Math.min(...ps.map(p=>p[0])))),maxX=Math.min(W-1,Math.ceil(Math.max(...ps.map(p=>p[0]))));
 const minZ=Math.max(0,Math.floor(Math.min(...ps.map(p=>p[1])))),maxZ=Math.min(H-1,Math.ceil(Math.max(...ps.map(p=>p[1]))));
 if(maxX<minX||maxZ<minZ)continue;
 const [a,b,c]=ps,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
 if(Math.abs(den)<1e-10)continue;selectedTriangles++;
 for(let y=minZ;y<=maxZ;y++)for(let x=minX;x<=maxX;x++){
  const l0=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/den;
  const l1=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/den,l2=1-l0-l1;
  if(Math.min(l0,l1,l2)<-1e-6)continue;
  const u=vs[0].uv[0]*l0+vs[1].uv[0]*l1+vs[2].uv[0]*l2,v=vs[0].uv[1]*l0+vs[1].uv[1]*l1+vs[2].uv[1]*l2;
  const k=y*W+x;for(let c=0;c<3;c++)target[k*4+c]=Math.round(sample(u,v,c));target[k*4+3]=255;covered[k]=1;
 }
}
await sharp(target,{raw:{width:W,height:H,channels:4}}).png().toFile(out+'/wall-photo-rectified.png');
const config={primitive:2,sourcePhotoId:'145064071',tangent,minT,maxT,minY,maxY,width:W,height:H,selectedTriangles,coverage:covered.reduce((s,v)=>s+v,0)/(W*H)};
await fs.writeFile(out+'/patch-config.json',JSON.stringify(config,null,2));
console.log(JSON.stringify(config));
