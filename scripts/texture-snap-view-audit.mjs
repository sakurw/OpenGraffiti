// Inspect occluders in the actual displayed model, not only source buildings.
import {readFile} from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {BufferGeometry,Float32BufferAttribute,Vector3,Matrix4,Ray,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {loadSnapCase} from './texture-snap-case.mjs';
const input=await loadSnapCase(),fit=JSON.parse(await readFile(`data/texture-city/registration/${input.caseId}.json`,'utf8'));
const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
const area=catalog.areas.find(a=>a.id===input.areaId),building=catalog.buildings.find(b=>b.id===input.buildingId);
await MeshoptDecoder.ready;
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read('public'+area.model);
const positions=[],ranges=[];
for(const n of doc.getRoot().listNodes())if(n.getMesh())for(const p of n.getMesh().listPrimitives()){
 const matrix=new Matrix4().fromArray(n.getWorldMatrix()),a=p.getAttribute('POSITION').getArray(),idx=p.getIndices()?.getArray();
 const start=positions.length/9;
 for(let j=0;j<(idx?.length??a.length/3);j++){const i=(idx?idx[j]:j)*3,v=new Vector3(a[i],a[i+1],a[i+2]).applyMatrix4(matrix);positions.push(...v.toArray());}
 ranges.push({start,end:positions.length/9,name:n.getName(),material:p.getMaterial()?.getName(),extras:n.getExtras()});
}
const geo=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geo,{indirect:true});
const target=[building.center[0],(Math.max(input.minimumHeight,building.min[1])+building.max[1])/2,building.center[2]];
const origin=new Vector3(...fit.cameraPosition),direction=new Vector3(...target).sub(origin).normalize(),hit=bvh.raycastFirst(new Ray(origin,direction),DoubleSide,.05,6000);
const roadHeights=bvh.raycast(new Ray(new Vector3(origin.x,1000,origin.z),new Vector3(0,-1,0)),DoubleSide).filter(h=>ranges.find(r=>h.faceIndex>=r.start&&h.faceIndex<r.end)?.extras?.plateau?.role==='road').map(h=>h.point.y);
const range=hit&&ranges.find(r=>hit.faceIndex>=r.start&&hit.faceIndex<r.end);
const wall=range?.extras?.wallFaces?.find(w=>hit.faceIndex-range.start>=w.start&&hit.faceIndex-range.start<w.start+w.count);
console.log(JSON.stringify({caseId:input.caseId,camera:fit.cameraPosition,target,roadHeights,hit:hit?{distance:hit.distance,point:hit.point.toArray(),name:range?.name,material:range?.material,role:range?.extras?.plateau?.role,wall}:null},null,2));
geo.dispose();
