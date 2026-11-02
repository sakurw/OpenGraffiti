// Explicitly reviewed source-image regions, before SNAP rectification.
export function imageRegionFilter(regions,imageSize){
 if(!regions)return ()=>true;
 if(!Array.isArray(imageSize)||imageSize.length!==2||imageSize.some(n=>!Number.isFinite(n)||n<=0))throw Error('Invalid source image size');
 const {referenceSize,polygons}=regions;
 if(!Array.isArray(referenceSize)||referenceSize.length!==2||referenceSize.some(n=>!Number.isFinite(n)||n<=0)
   ||!Array.isArray(polygons)||!polygons.length)throw Error('Invalid SNAP image regions');
 for(const polygon of polygons){
  if(!Array.isArray(polygon)||polygon.length<3||polygon.some(p=>!Array.isArray(p)||p.length!==2||p.some((n,i)=>!Number.isFinite(n)||n<0||n>referenceSize[i])))throw Error('Invalid SNAP image polygon');
  // Convex polygons guarantee the retained triangle interior is also included.
  let sign=0;
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[(i+2)%polygon.length];
   const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
   if(Math.abs(cross)<1e-8)continue;
   if(sign&&Math.sign(cross)!==sign)throw Error('SNAP source regions must be convex');
   sign=Math.sign(cross);
  }
  if(!sign)throw Error('Degenerate SNAP source region');
 }
 const contains=(p,polygon)=>{
  let sign=0;
  for(let i=0;i<polygon.length;i++){
   const a=polygon[i],b=polygon[(i+1)%polygon.length];
   const cross=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
   if(Math.abs(cross)<1e-7)continue;
   if(sign&&Math.sign(cross)!==sign)return false;
   sign=Math.sign(cross);
  }
  return true;
 };
 return points=>Array.isArray(points)&&points.length>0&&polygons.some(polygon=>points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)
  &&contains(p.map((n,i)=>n*referenceSize[i]/imageSize[i]),polygon)));
}
