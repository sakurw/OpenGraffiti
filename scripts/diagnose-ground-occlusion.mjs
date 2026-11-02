// Read-only-to-model investigation. Blocked areas never become image evidence.
import {readFile,writeFile} from 'node:fs/promises';
import {Ray,Vector3,DoubleSide} from 'three';
import {triangulate,sub,dot} from './plateau-geometry.mjs';
import {sceneBvh,partition,area,samples} from './texture-ground-visibility.mjs';
import {projectGroundPhotoSet} from './texture-ground-camera.mjs';
const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw Error('Supply registration JSON and diagnostic output JSON');
const r=JSON.parse(await readFile(input)),g=JSON.parse(await readFile(r.geometryPath)),b=g.buildings.find(b=>b.id===r.buildingId);
const scene=sceneBvh(g.buildings),ray=new Ray(),dir=new Vector3(),blocked=new Map();
let visibleArea=0,candidateArea=0;
const hitOwner=hit=>scene.triangleOwners[Math.floor(scene.geometry.index.array[hit.faceIndex*3]/3)];
for(const wall of b.walls){
  const mesh=triangulate(wall.rings.map(r=>r.points));
  for(let i=0;i<mesh.indices.length;i+=3)for(const tri of partition(mesh.indices.slice(i,i+3).map(j=>mesh.points[j]))){
    const point=samples(tri)[0],view=sub(r.cameraPosition,point),facing=dot(mesh.normal,view)/Math.hypot(...view);
    if(facing<.3||point[1]<r.supportedHeightRangeMetres[0]||point[1]>r.supportedHeightRangeMetres[1]||projectGroundPhotoSet(r,point).reason)continue;
    const weight=area(tri);candidateArea+=weight;
    ray.origin.set(...r.cameraPosition);dir.set(...point).sub(ray.origin);const distance=dir.length();ray.direction.copy(dir).normalize();
    const hit=scene.bvh.raycastFirst(ray,DoubleSide,.05,distance-.08);
    if(!hit){visibleArea+=weight;continue;}
    const owner=hitOwner(hit),record=blocked.get(owner.buildingId)??{...owner,centroidBlockedArea:0,examples:[]};
    record.centroidBlockedArea+=weight;
    if(record.examples.length<4)record.examples.push({target:point,obstruction:hit.point.toArray(),distance:hit.distance,polygonId:owner.polygonId});
    blocked.set(owner.buildingId,record);
  }
}
const directions=[];
for(const direction of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
  ray.origin.set(...r.cameraPosition);ray.direction.set(...direction);
  const hit=scene.bvh.raycastFirst(ray,DoubleSide,.05,200);
  directions.push({direction,hit:hit?{...hitOwner(hit),point:hit.point.toArray(),distance:hit.distance}:null});
}
const report={sourceId:r.sourceId,registrationPath:input,cameraPosition:r.cameraPosition,candidateArea,centroidVisibleArea:visibleArea,
  blockers:[...blocked.values()].sort((a,b)=>b.centroidBlockedArea-a.centroidBlockedArea),directions,
  note:'Centroid-only obstruction diagnosis. Camera is an unverified estimate; geometry may simplify openings. No occlusion is removed and no image evidence is credited.'};
await writeFile(output,JSON.stringify(report,null,2));scene.geometry.dispose();console.log(JSON.stringify(report));
