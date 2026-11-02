import sharp from 'sharp';
import {dot,sub} from '../scripts/plateau-geometry.mjs';
export function overlayGeometry(recipe){
 const positions=[],normals=[],uvs=[],indices=[];
 for(const p of (recipe.visiblePolygons||recipe.polygons)){const offset=positions.length/3;
  for(const v of p.points)positions.push(...v.map((n,i)=>n+(p.normal||recipe.normal)[i]*.002));
  for(const v of p.points)normals.push(...(p.normal||recipe.normal));
  for(const uv of (p.canvasUV||p.points.flatMap(v=>{const d=sub(v,recipe.origin);return [(dot(d,recipe.u)-recipe.lo[0])/recipe.width,1-(dot(d,recipe.v)-recipe.lo[1])/recipe.height];})))uvs.push(uv);
  for(const i of p.indices)indices.push(i+offset);
 }
 return {positions,normals,uvs,indices};
}
export async function bakeWall(recipe,readTexture,longSide=2048){
 const scale=longSide/Math.max(recipe.width,recipe.height),width=Math.max(1,Math.round(recipe.width*scale)),height=Math.max(1,Math.round(recipe.height*scale));
 const data=Buffer.alloc(width*height*4),mask=Buffer.alloc(data.length);
 for(const p of (recipe.visiblePolygons||recipe.polygons)){
  const tex=await readTexture(p.image),xy=p.canvasUV?Array.from({length:p.points.length},(_,i)=>[p.canvasUV[i*2]*width,p.canvasUV[i*2+1]*height]):p.points.map(v=>{const d=sub(v,recipe.origin);return [(dot(d,recipe.u)-recipe.lo[0])/recipe.width*width,(1-(dot(d,recipe.v)-recipe.lo[1])/recipe.height)*height];});
  for(let i=0;i<p.indices.length;i+=3){
   const idx=p.indices.slice(i,i+3),v=idx.map(j=>xy[j]),uv=idx.map(j=>p.sourceUV.slice(j*2,j*2+2)),[a,b,c]=v;
   const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-9)continue;
   const minX=Math.max(0,Math.floor(Math.min(...v.map(p=>p[0])))),maxX=Math.min(width-1,Math.ceil(Math.max(...v.map(p=>p[0])))),minY=Math.max(0,Math.floor(Math.min(...v.map(p=>p[1])))),maxY=Math.min(height-1,Math.ceil(Math.max(...v.map(p=>p[1]))));
   for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+.5,py=y+.5,wa=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/den,wb=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/den,wc=1-wa-wb;if(Math.min(wa,wb,wc)<-1e-7)continue;
    const tx=Math.max(0,Math.min(tex.info.width-1,(wa*uv[0][0]+wb*uv[1][0]+wc*uv[2][0])*tex.info.width-.5)),ty=Math.max(0,Math.min(tex.info.height-1,(wa*uv[0][1]+wb*uv[1][1]+wc*uv[2][1])*tex.info.height-.5));
    const x0=Math.floor(tx),y0=Math.floor(ty),x1=Math.min(x0+1,tex.info.width-1),y1=Math.min(y0+1,tex.info.height-1),fx=tx-x0,fy=ty-y0,k=(y*width+x)*4;
    for(let ch=0;ch<3;ch++){const at=(xx,yy)=>tex.data[(yy*tex.info.width+xx)*4+ch];data[k+ch]=Math.round(at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy);}data[k+3]=255;mask.fill(255,k,k+4);
   }
  }
 }
 if(!data.some((v,i)=>i%4===3&&v))throw Error('Empty wall mask');
 const options={raw:{width,height,channels:4}};
 return {data,mask,width,height,base:await sharp(data,options).png().toBuffer(),maskPng:await sharp(mask,options).png().toBuffer()};
}
