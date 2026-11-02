// Bounded diagnostic search; the objective is supplied by the caller.
// A geometric minimum is not proof of correct building correspondence.
export function searchTranslation(objective,{bounds=[10,3,10],steps=[2,1,.5,.25,.125],maxSweeps=12}={}){
 if(bounds.length!==3||bounds.some(v=>!Number.isFinite(v)||v<0)||!steps.length||steps.some(v=>!Number.isFinite(v)||v<=0))throw Error('Invalid translation bounds or steps');
 let offset=[0,0,0],score=objective(offset);if(!Number.isFinite(score))throw Error('Non-finite initial objective');
 const initialScore=score;let evaluations=1;
 for(const step of steps)for(let sweep=0;sweep<maxSweeps;sweep++){
  let changed=false;
  for(let axis=0;axis<3;axis++){
   let best=offset,bestScore=score;
   for(const sign of [-1,1]){
    const candidate=offset.slice();candidate[axis]+=sign*step;
    if(Math.abs(candidate[axis])>bounds[axis]+1e-8)continue;
    const value=objective(candidate);evaluations++;
    if(Number.isFinite(value)&&value<bestScore-1e-9){best=candidate;bestScore=value;}
   }
   if(best!==offset){offset=best;score=bestScore;changed=true;}
  }
  if(!changed)break;
 }
 return {offset,initialScore,score,evaluations,bounds,steps,atBound:offset.some((v,i)=>bounds[i]>0&&Math.abs(v)>=bounds[i]-1e-8)};
}
