import {planarSurfaces,quadrant} from './plateau-surfaces.mjs';
import {dot} from './plateau-geometry.mjs';
export {quadrant} from './plateau-surfaces.mjs';
export const directions=['北','東','南','西'];
export function groupedSurfaces(g){
 const plan=planarSurfaces(g),walls=[],panels=[];
 const buildings=new Map(g.buildings.map(b=>[b.id,b]));
 for(const items of Map.groupBy(plan.walls,p=>p.buildingId+'|'+quadrant(p.normal)).values()){
  const q=quadrant(items[0].normal),dominant=items.reduce((a,b)=>a.area>=b.area?a:b).normal,horizontalLength=Math.hypot(dominant[0],dominant[2]),normal=[dominant[0]/horizontalLength,0,dominant[2]/horizontalLength],u=[normal[2],0,-normal[0]],partId=items[0].buildingId+'|direction-'+q;
  const polygons=new Map(buildings.get(items[0].buildingId).walls.map(p=>[p.id,p]));
  const points=p=>p.polygonIds.flatMap(id=>polygons.get(id).rings.flatMap(r=>r.points));
  const bounds=pts=>({lo:[Math.min(...pts.map(p=>dot(p,u))),Math.min(...pts.map(p=>p[1]))],hi:[Math.max(...pts.map(p=>dot(p,u))),Math.max(...pts.map(p=>p[1]))]});
  const all=items.flatMap(points),{lo,hi}=bounds(all),width=hi[0]-lo[0],height=hi[1]-lo[1];
  const center=[0,1,2].map(i=>all.reduce((s,p)=>s+p[i],0)/all.length);
  const grouped=items.map((p,i)=>{const b=bounds(points(p)),slot={x:b.lo[0]-lo[0],y:hi[1]-b.hi[1],width:b.hi[0]-b.lo[0],height:b.hi[1]-b.lo[1]};return {...p,panelId:partId+'|panel-'+i,partId,slot,crop:{x:slot.x/width,y:slot.y/height,width:slot.width/width,height:slot.height/height}};});
  panels.push(...grouped);
  walls.push({buildingId:items[0].buildingId,lod:items[0].lod,surfaceId:partId,partId,quadrant:q,direction:directions[q],projection:'orthographic-visible',panels:grouped,polygonIds:grouped.flatMap(p=>p.polygonIds),width,height,area:items.reduce((s,p)=>s+p.area,0),normal,u,v:[0,1,0],origin:[0,0,0],lo,hi,center,minHeight:lo[1],rms:Math.max(...items.map(p=>p.rms)),maxDeviation:Math.max(...items.map(p=>p.maxDeviation)),holeCount:items.reduce((s,p)=>s+p.holeCount,0)});
 }
 return {walls,panels,rejected:plan.rejected};
}
