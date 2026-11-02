import type {Building,Road} from './pv-data';

// A road selects a direction through the whole adopted district. Source road
// polygons are short intersection-to-intersection pieces, not panorama limits.
export function streetBuildings(buildings:Building[],road:Pick<Road,'start'|'end'|'rings'>){
 const [x,z]=road.start,dx=road.end[0]-x,dz=road.end[1]-z,length=Math.hypot(dx,dz);
 if(length<.001)return {left:[] as string[],right:[] as string[]};
 const u=dx/length,v=dz/length,rows=buildings.map(b=>{const cx=(b.bounds[0]+b.bounds[3])/2,cz=(b.bounds[2]+b.bounds[5])/2;return {id:b.id,along:(cx-x)*u+(cz-z)*v,side:u*(cz-z)-v*(cx-x)};}).sort((a,b)=>a.along-b.along);
 return {left:rows.filter(b=>b.side<0).map(b=>b.id),right:rows.filter(b=>b.side>=0).map(b=>b.id)};
}
