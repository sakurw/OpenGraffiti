// Keep an accepted triangle intact. Only rejected geometry is subdivided.
// Acceptance (including all seven image/visibility/depth samples) is owned by caller.
export function* refineRejected(triangle, candidates, accept, depth, stats, level=0){
 for(const candidate of candidates){
  const value=accept(candidate,triangle);
  if(value){yield {triangle,candidate,value,level};return;}
 }
 if(!depth||!candidates.length)return;
 const edgeLengths=triangle.map((p,i)=>p.reduce((s,v,k)=>s+(v-triangle[(i+1)%3][k])**2,0));
 const edge=edgeLengths.indexOf(Math.max(...edgeLengths));
 const a=triangle[edge],b=triangle[(edge+1)%3],c=triangle[(edge+2)%3];
 const u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
 const area=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
 // Match the existing minimum area; each child must still be >= 0.01 m2.
 if(area<.02)return;
 const midpoint=a.map((x,k)=>(x+b[k])/2);
 stats.splits++;stats.maxDepth=Math.max(stats.maxDepth,level+1);
 yield* refineRejected([a,midpoint,c],candidates,accept,depth-1,stats,level+1);
 yield* refineRejected([midpoint,b,c],candidates,accept,depth-1,stats,level+1);
}
