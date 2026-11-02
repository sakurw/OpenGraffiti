import {NodeIO} from '@gltf-transform/core';
import {BufferAttribute,BufferGeometry,Mesh,MeshBasicMaterial,DoubleSide,Vector3,Raycaster} from 'three';
import {computeBoundsTree,acceleratedRaycast} from 'three-mesh-bvh';

let cached:Promise<{id:string;mesh:Mesh}[]>;
export async function facadeInFront(visible:string[],viewOffset:number[],point:number[]){
 cached??=(async()=>{const doc=await new NodeIO().read('public/assets/pv-adopted-20261029/city.glb'),parts=[];for(const node of doc.getRoot().listNodes()){
  const id=node.getExtras().buildingId as string;if(!id)continue;
  for(const p of node.getMesh()?.listPrimitives()||[]){const g=new BufferGeometry().setAttribute('position',new BufferAttribute(p.getAttribute('POSITION')!.getArray()!,3));if(p.getIndices())g.setIndex(new BufferAttribute(p.getIndices()!.getArray()!,1));computeBoundsTree.call(g);const mesh=new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));mesh.raycast=acceleratedRaycast;parts.push({id,mesh});}
 }return parts;})();
 const target=new Vector3(...point as [number,number,number]),eye=target.clone().addScaledVector(new Vector3(...viewOffset as [number,number,number]).normalize(),10000),ray=new Raycaster(eye,target.clone().sub(eye).normalize(),0,eye.distanceTo(target)-.05);ray.firstHitOnly=true;
 return ray.intersectObjects((await cached).filter(p=>visible.includes(p.id)).map(p=>p.mesh),false).length>0;
}
