// Preserve the camera-target vector at the world boundary; clamping only target causes zoom/pan decay.
export function boundaryCorrection(target,bounds){
 return [Math.max(bounds[0],Math.min(bounds[1],target[0]))-target[0],0,Math.max(bounds[2],Math.min(bounds[3],target[2]))-target[2]];
}
export function faceWall(ranges,index){let lo=0,hi=ranges.length-1;while(lo<=hi){const mid=(lo+hi)>>1,r=ranges[mid];if(index<r.start)hi=mid-1;else if(index>=r.start+r.count)lo=mid+1;else return r.wallId;}return null;}

