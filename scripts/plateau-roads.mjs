import {xml,descendants,polygon,triangulate,dot,sub,cross} from './plateau-geometry.mjs';
// Fit boundary points to a principal-axis road strip, then reject bends using binned center drift.
export function fitRoad(points){
 const n=points.length;if(n<4)return null;
 const center=[0,2].map(i=>points.reduce((s,p)=>s+p[i]/n,0));
 let xx=0,xz=0,zz=0;for(const p of points){const x=p[0]-center[0],z=p[2]-center[1];xx+=x*x;xz+=x*z;zz+=z*z;}
 const theta=.5*Math.atan2(2*xz,xx-zz),dir=[Math.cos(theta),0,Math.sin(theta)],normal=[-dir[2],0,dir[0]];
 const xy=points.map(p=>[dot(sub(p,[center[0],0,center[1]]),dir),dot(sub(p,[center[0],0,center[1]]),normal)]);
 const lo=Math.min(...xy.map(p=>p[0])),hi=Math.max(...xy.map(p=>p[0])),length=hi-lo;
 const offsets=[];for(let i=0;i<6;i++){const bin=xy.filter(p=>p[0]>=lo+length*i/6&&p[0]<=lo+length*(i+1)/6);if(bin.length>=2)offsets.push((Math.min(...bin.map(p=>p[1]))+Math.max(...bin.map(p=>p[1])))/2);}
 const width=Math.max(...xy.map(p=>p[1]))-Math.min(...xy.map(p=>p[1]));
 const drift=offsets.length?Math.max(...offsets)-Math.min(...offsets):Infinity;
 if(length<25||width<2||length/width<2.5||drift>Math.max(3,width*.35))return null;
 return {start:[center[0]+dir[0]*lo,0,center[1]+dir[2]*lo],end:[center[0]+dir[0]*hi,0,center[1]+dir[2]*hi],dir,normal,length,width,drift};
}
export function segmentHit(o,d,tri){const [a,b,c]=tri,e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-9)return Infinity;const q=sub(o,a),u=dot(q,h)/det;if(u<0||u>1)return Infinity;const k=cross(q,e1),v=dot(d,k)/det;if(v<0||u+v>1)return Infinity;const t=dot(e2,k)/det;return t>.0001&&t<.9999?t:Infinity;}
export function roadSections(text,g,walls){
 const grid=new Map(),cell=50;
 for(const b of g.buildings){const tris=b.polygons.flatMap(p=>{const t=triangulate(p.rings.map(r=>r.points));return Array.from({length:t.indices.length/3},(_,i)=>({id:p.id,tri:t.indices.slice(i*3,i*3+3).map(j=>t.points[j])}));});
  for(let x=Math.floor(b.min[0]/cell);x<=Math.floor(b.max[0]/cell);x++)for(let z=Math.floor(b.min[2]/cell);z<=Math.floor(b.max[2]/cell);z++){const k=x+','+z;if(!grid.has(k))grid.set(k,new Set());grid.get(k).add(tris);}
 }
 function visible(o,target,ids){const d=sub(target,o),candidates=new Set();for(let x=Math.floor(Math.min(o[0],target[0])/cell);x<=Math.floor(Math.max(o[0],target[0])/cell);x++)for(let z=Math.floor(Math.min(o[2],target[2])/cell);z<=Math.floor(Math.max(o[2],target[2])/cell);z++)for(const ts of grid.get(x+','+z)||[])candidates.add(ts);
  for(const ts of candidates)for(const t of ts)if(!ids.includes(t.id)&&segmentHit(o,d,t.tri)!==Infinity)return false;return true;
 }
 const roads=[];let rejected=0;
 for(const m of text.matchAll(/<tran:Road\b[^>]*>[\s\S]*?<\/tran:Road>/g)){const r=xml(m[0]);let k=0;
  const elevated=descendants(r,'tran:lod3MultiSurface').flatMap(s=>descendants(s,'gml:Polygon').map(p=>polygon(p,g.origin)).filter(Boolean)).flatMap(p=>p.rings[0].points);
  const ground=elevated.length?elevated.map(p=>p[1]).sort((a,b)=>a-b)[Math.floor(elevated.length*.2)]:null;
  for(const scope of descendants(r,'tran:lod1MultiSurface'))for(const pn of descendants(scope,'gml:Polygon')){
   const p=polygon(pn,g.origin);if(!p)continue;const fit=fitRoad(p.rings[0].points);if(!fit){rejected++;continue;}
   // LOD1 z=0 is not terrain height: require a same-road LOD3 height estimate.
   if(ground===null){rejected++;continue;}fit.start[1]=ground;fit.end[1]=ground;
   const layout=[];for(const w of walls){
    const delta=sub(w.center,fit.start),along=dot(delta,fit.dir),side=dot(delta,fit.normal),projectedWidth=Math.abs(dot(w.u,fit.dir))*w.width;
    if(along < -projectedWidth/2||along>fit.length+projectedWidth/2||Math.abs(side)>65||projectedWidth<.5)continue;
    const foot=fit.start.map((v,i)=>v+fit.dir[i]*Math.max(0,Math.min(fit.length,along)));foot[1]+=1.6;
    if(dot(w.normal,sub(foot,w.center))<=0)continue;
    let samples=0;for(const fraction of [-.3,0,.3]){const target=w.center.map((v,i)=>v+w.u[i]*w.width*fraction);if(visible(foot,target,w.polygonIds))samples++;}
    if(samples<2)continue;
    layout.push({partId:w.partId,panelId:w.panelId,crop:w.crop,along,side:side>=0?'left':'right',distance:Math.abs(side),displayWidth:projectedWidth,height:w.height,bottom:w.minHeight-ground,visibleSamples:samples,viewpoint:foot});
   }
   if(layout.length)roads.push({sourceRoadId:r.a['gml:id'],part:k++,...fit,layout:layout.sort((a,b)=>a.along-b.along)});
  }
 }
 return {roads,rejected};
}
