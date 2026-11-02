// Source-search planning only. Hypothetical cameras do not establish image evidence.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {BufferGeometry,Float32BufferAttribute,Ray,Vector3,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate,sub,cross,dot} from './plateau-geometry.mjs';

export const area = t => Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
export function* partition(t,maxEdge=5,depth=0) {
  const lengths=t.map((p,i)=>Math.hypot(...sub(p,t[(i+1)%3])));
  const length=Math.max(...lengths);
  if(length<=maxEdge||depth>=18){yield t;return;}
  const i=lengths.indexOf(length),a=t[i],b=t[(i+1)%3],c=t[(i+2)%3],m=mid(a,b);
  yield*partition([a,m,c],maxEdge,depth+1);yield*partition([m,b,c],maxEdge,depth+1);
}
export function sceneBvh(buildings) {
  const positions=[],triangleOwners=[];
  for(const b of buildings)for(const p of b.polygons){
    const t=triangulate(p.rings.map(r=>r.points));
    for(const i of t.indices)positions.push(...t.points[i]);
    for(let i=0;i<t.indices.length;i+=3)triangleOwners.push({buildingId:b.id,polygonId:p.id});
  }
  const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
  return {geometry,bvh:new MeshBVH(geometry),triangleOwners};
}
const ray=new Ray(),direction=new Vector3();
export function visible(camera,p,normal,bvh) {
  const view=sub(camera,p),distance=Math.hypot(...view);
  if(distance<=.1||dot(normal,view)/distance<.3)return false;
  ray.origin.set(...camera);direction.set(...p).sub(ray.origin);ray.direction.copy(direction).normalize();
  return !bvh.raycastFirst(ray,DoubleSide,.05,distance-.08);
}
export function samples(tri) {
  return [tri[0].map((_,i)=>(tri[0][i]+tri[1][i]+tri[2][i])/3),...tri,...tri.map((p,i)=>mid(p,tri[(i+1)%3]))];
}

async function main() {
  const options=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return [arg.slice(2,i),arg.slice(i+1)];}));
  const geometryPath=options.geometry??'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
  const buildingId=options.building??'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
  const edge=Number(options.edge??5),step=Number(options.step??10);
  if(!(edge>=2&&edge<=10&&step>=5&&step<=90))throw Error('Unsupported sample density');
  const bytes=await readFile(geometryPath),g=JSON.parse(bytes),b=g.buildings.find(v=>v.id===buildingId);
  if(!b)throw Error('Target missing');
  const wallIds=new Set(b.walls.map(v=>v.id)),cells=[];
  for(const p of b.polygons)if(wallIds.has(p.id)){
    const t=triangulate(p.rings.map(r=>r.points));
    for(let i=0;i<t.indices.length;i+=3)for(const tri of partition(t.indices.slice(i,i+3).map(k=>t.points[k]),edge)){
      const a=area(tri);if(a>1e-12)cells.push({polygonId:p.id,area:a,normal:t.normal,samples:samples(tri)});
    }
  }
  const total=cells.reduce((s,c)=>s+c.area,0),city=sceneBvh(g.buildings),self=sceneBvh([b]);
  const heights=[40,100,180,260],radii=[90,140,220,350,550,850],scenarios=[];
  const accumulated=new Uint8Array(cells.length);
  for(const height of heights){
    const conservative=new Uint8Array(cells.length),centres=new Uint8Array(cells.length),selfCentres=new Uint8Array(cells.length);
    const cameraResults=[];
    for(const radius of radii)for(let angle=0;angle<360;angle+=step){
      // x is east; z is south. These positions have NOT been verified accessible.
      const camera=[radius*Math.cos(angle*Math.PI/180),height,10+radius*Math.sin(angle*Math.PI/180)];
      let singleArea=0,newArea=0;
      for(let i=0;i<cells.length;i++){
        const c=cells[i],p=c.samples[0];
        if(!selfCentres[i]&&visible(camera,p,c.normal,self.bvh))selfCentres[i]=1;
        if(!visible(camera,p,c.normal,city.bvh))continue;
        centres[i]=1;singleArea+=c.area;
        if(!conservative[i]&&c.samples.slice(1).every(p=>visible(camera,p,c.normal,city.bvh))){
          conservative[i]=1;newArea+=c.area;
        }
      }
      cameraResults.push({position:camera,radius,angleFromEastTowardSouth:angle,centroidVisibleArea:singleArea,incrementalSevenSampleArea:newArea});
    }
    const sum=mask=>cells.reduce((s,c,i)=>s+(mask[i]?c.area:0),0);
    for(let i=0;i<cells.length;i++)if(conservative[i])accumulated[i]=1;
    const walls=b.walls.map(w=>{
      const list=cells.map((c,i)=>[c,i]).filter(([c])=>c.polygonId===w.id);
      return {polygonId:w.id,totalArea:list.reduce((s,[c])=>s+c.area,0),sevenSampleArea:list.reduce((s,[c,i])=>s+(conservative[i]?c.area:0),0)};
    });
    const record={cameraHeightInModelCoordinates:height,cameraCount:cameraResults.length,
      sevenSampleCityArea:sum(conservative),centroidCityArea:sum(centres),centroidSelfArea:sum(selfCentres),
      sevenSampleCityFraction:sum(conservative)/total,cumulativeSevenSampleCityFraction:sum(accumulated)/total,
      bestSingleViews:cameraResults.sort((a,b)=>b.centroidVisibleArea-a.centroidVisibleArea).slice(0,12),walls};
    scenarios.push(record);console.log(JSON.stringify({...record,walls:undefined,bestSingleViews:undefined}));
  }
  const report={buildingId,geometryPath,geometrySha256:createHash('sha256').update(bytes).digest('hex'),createdAt:new Date().toISOString(),
    kind:'hypothetical-viewpoint-search-diagnostic',imageEvidenceContribution:0,
    totalWallAreaSquareMetres:total,wallCount:wallIds.size,cells:cells.length,maxEdgeMetres:edge,angleStepDegrees:step,radiiMetres:radii,scenarios,
    limitations:['No source images, camera registration, semantic masks, resolution or access permissions are established.',
      'Finite sampled visibility is NOT a global visibility bound or attainable evidence rate. Camera points may be inaccessible or inside structures.',
      'Surrounding occlusion uses only the loaded PLATEAU tile and may miss out-of-tile buildings; target and city geometry may simplify openings.',
      'Seven point samples approximate coverage within each cell. Centroid-only areas are a separate optimistic diagnostic.',
      'Model heights are absolute coordinates, not heights above local ground. No denominator or public evidence artifact is changed.']};
  const output=options.output??'data/texture-city/commons/visibility-planning.json';
  await mkdir(new URL('.',pathToFileURL(output)),{recursive:true});
  await writeFile(output,JSON.stringify(report,null,2));city.geometry.dispose();self.geometry.dispose();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
