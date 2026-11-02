// One image-authored panorama sampled in continuous world space. Native mesh UVs
// are only the output storage; facade IDs never select or repeat the artwork.
export async function risingKoiField(points:{x:number;y:number;z:number}[]){
 const image=new Image();image.src='/artworks/rising-koi-panorama.png';await image.decode();
 const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
 const {data,width,height}=ctx.getImageData(0,0,canvas.width,canvas.height);
 const lo=Math.min(...points.map(p=>p.y)),hi=Math.max(...points.map(p=>p.y)),H=hi-lo;
 const body=points.filter(p=>p.y>lo+H*.3&&p.y<lo+H*.8);
 const cx=body.reduce((s,p)=>s+p.x,0)/body.length,cz=body.reduce((s,p)=>s+p.z,0)/body.length;
 const at=(x:number,y:number,k:number)=>data[(Math.min(height-1,Math.max(0,y))*width+(x%width+width)%width)*4+k];
 return(x:number,y:number,z:number)=>{
  const h=Math.max(0,Math.min(1,(y-lo)/H));
  // A modest change in azimuth with elevation gives the current a helical path.
  // Large shear would distort the animal's anatomy; the authored S-curve leads.
  const angle=Math.atan2(z-cz,x-cx)+.30*Math.sin(h*Math.PI*1.3);
  const u=((angle/(Math.PI*2)+.55)%1+1)%1;
  // Reserve the stepped crown above the head instead of clipping its mouth.
  const py=Math.max(0,Math.min(1,(.88-h)/.84))*(height-1),iy=Math.floor(py),fy=py-iy;
  const sample=(v:number,k:number)=>{const px=v*width,ix=Math.floor(px),fx=px-ix;return (at(ix,iy,k)*(1-fx)+at(ix+1,iy,k)*fx)*(1-fy)+(at(ix,iy+1,k)*(1-fx)+at(ix+1,iy+1,k)*fx)*fy;};
  const seam=Math.max(0,1-Math.min(u,1-u)/.025)*.5;
  const crown=Math.max(0,Math.min(1,(h-.89)/.05)),ink=[12,20,33];
  return [0,1,2].map(k=>Math.round((sample(u,k)*(1-seam)+sample(1-u,k)*seam)*(1-crown)+ink[k]*crown));
 };
}
