// Deterministic, area-stratified preflight. This ranks, never removes, candidates.
export function areaSamples(triangles,areaOf,limit=32){
 if(!Number.isSafeInteger(limit)||limit<1)throw Error('Invalid sample limit');
 const areas=triangles.map(areaOf);
 if(areas.some(n=>!Number.isFinite(n)||n<=0))throw Error('Invalid triangle area');
 const total=areas.reduce((a,b)=>a+b,0);if(!total)return [];
 const count=Math.min(limit,triangles.length),selected=new Map();let index=0,cumulative=areas[0];
 for(let i=0;i<count;i++){
  const target=(i+.5)*total/count;
  while(index+1<areas.length&&target>cumulative)cumulative+=areas[++index];
  const sample=selected.get(index)||{index,triangle:triangles[index],weight:0};sample.weight+=total/count;selected.set(index,sample);
 }
 return [...selected.values()];
}
export function coveragePriority(candidates,samples,accept){
 const ranked=candidates.map((candidate,index)=>{
  let area=0,acceptedSamples=0;
  for(const sample of samples)if(accept(candidate,sample.triangle)){area+=sample.weight;acceptedSamples++;}
  return {candidate,index,area,acceptedSamples};
 });
 ranked.sort((a,b)=>b.area-a.area||a.index-b.index);
 return ranked;
}
