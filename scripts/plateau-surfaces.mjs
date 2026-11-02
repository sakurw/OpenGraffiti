import {triangulate,dot,sub,cross} from './plateau-geometry.mjs';
export function quadrant(normal){const azimuth=(Math.atan2(normal[0],-normal[2])*180/Math.PI+360)%360;return Math.floor(((azimuth+45)%360)/90);}
export function planarSurfaces(g){
 const result=[],rejected={};
 const reject=why=>rejected[why]=(rejected[why]||0)+1;
 for(const b of g.buildings.filter(b=>b.lod>=2)){const surfaceId=b.id,polys=b.walls;
  // Split non-coplanar thematic surfaces into planar polygon groups, preserving original IDs.
  const groups=[];
  for(const p of polys){const f=triangulate(p.rings.map(r=>r.points));
   if(Math.abs(f.normal[1])>.35||f.indices.length===0){reject('not-vertical');continue;}
   if(!p.id||!g.textures[p.id]||p.rings.some(r=>!g.textures[p.id].rings[r.id]||g.textures[p.id].rings[r.id].length<r.points.length*2)){reject('no-valid-texture');continue;}
   const pts=p.rings.flatMap(r=>r.points);if(pts.some(v=>Math.abs(dot(sub(v,f.o),f.normal))>.05)){reject('non-planar');continue;}
   let group=groups.find(h=>quadrant(h.f.normal)===quadrant(f.normal)&&dot(h.f.normal,f.normal)>.9999&&pts.every(v=>Math.abs(dot(sub(v,h.f.o),h.f.normal))<.02));
   if(!group){group={f,polys:[]};groups.push(group);}group.polys.push(p);
  }
  for(const {f,polys:ps}of groups){
   const pts=ps.flatMap(p=>p.rings.flatMap(r=>r.points)),xy=pts.map(p=>[dot(sub(p,f.o),f.u),dot(sub(p,f.o),f.v)]),lo=[0,1].map(i=>Math.min(...xy.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...xy.map(p=>p[i]))),width=hi[0]-lo[0],height=hi[1]-lo[1];
   let area=0;for(const p of ps){const t=triangulate(p.rings.map(r=>r.points));for(let i=0;i<t.indices.length;i+=3){const [a,b,c]=t.indices.slice(i,i+3).map(j=>t.points[j]);area+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}}
   if(width<.01||height<.01||area<.0001){reject('sub-half-meter');continue;}
   const center=f.o.map((v,i)=>v+f.u[i]*(lo[0]+hi[0])/2+f.v[i]*(lo[1]+hi[1])/2),errors=pts.map(p=>Math.abs(dot(sub(p,f.o),f.normal)));
   result.push({buildingId:b.id,lod:b.lod,surfaceId,partId:ps.map(p=>p.id).sort().join('|'),polygonIds:ps.map(p=>p.id),width,height,area,rms:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length),maxDeviation:Math.max(...errors),normal:f.normal,u:f.u,v:f.v,origin:f.o,lo,hi,center,minHeight:Math.min(...pts.map(p=>p[1])),holeCount:ps.reduce((a,p)=>a+p.rings.length-1,0),openingCount:Math.max(...ps.map(p=>p.openings||0))});
  }
 }
 return {walls:result,rejected};
}
