import {Ray,Vector3,BufferGeometry,BufferAttribute,DoubleSide} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

// Official Mapillary mesh PBF: repeated float32 field 1, uint index field 2.
// Keep raw depths: the viewer's 5..200m display clamp is not measurement evidence.
export function decodeSpatialMesh(bytes){
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=0;
 const need=n=>{if(at+n>bytes.length)throw Error('Truncated spatial mesh');};
 const uint=()=>{let n=0,shift=0;for(let i=0;i<8;i++){need(1);const b=data.getUint8(at++);n+=(b&127)*2**shift;if(!(b&128)){if(!Number.isSafeInteger(n))throw Error('Unsafe mesh integer');return n;}shift+=7;}throw Error('Invalid mesh varint');};
 const vertices=[],faces=[];
 while(at<bytes.length){const key=uint(),tag=Math.floor(key/8),wire=key%8;
  if(tag===1&&wire===5){need(4);vertices.push(data.getFloat32(at,true));at+=4;}
  else if(tag===2&&wire===0)faces.push(uint());
  else if(wire===0)uint();else if(wire===5){need(4);at+=4;}else if(wire===1){need(8);at+=8;}else if(wire===2){const n=uint();need(n);at+=n;}else throw Error('Unsupported mesh wire type');
 }
 if(vertices.length%3||faces.length%3||!vertices.every(Number.isFinite)||faces.some(i=>i<0||i>=vertices.length/3))throw Error('Invalid spatial mesh geometry');
 return {vertices,faces};
}

export function spatialDepthSampler(mesh,scale,{cameraType='perspective',skipCornerVertices=cameraType==='perspective'?4:0,accelerated=false}={}){
 if(!(scale>0&&Number.isFinite(scale)))throw Error('Invalid atomic scale');
 if(!['perspective','spherical','equirectangular'].includes(cameraType))throw Error('Unsupported spatial camera');
 const points=Array.from({length:mesh.vertices.length/3},(_,i)=>new Vector3(...mesh.vertices.slice(i*3,i*3+3)).divideScalar(scale));
 const triangles=[];
 for(let i=0;i<mesh.faces.length;i+=3){const ids=mesh.faces.slice(i,i+3);if(ids.some(j=>j<skipCornerVertices))continue;const tri=ids.map(j=>points[j]);if(cameraType==='perspective'&&tri.some(p=>p.z<=0))continue;triangles.push(tri);}
 const ray=new Ray(new Vector3()),hit=new Vector3();
 const geometry=accelerated&&triangles.length?new BufferGeometry().setAttribute('position',new BufferAttribute(new Float64Array(triangles.flatMap(t=>t.flatMap(p=>p.toArray()))),3)):null;
 const bvh=geometry?new MeshBVH(geometry):null;
 return {triangles:triangles.length,dispose(){geometry?.dispose();},sample(cameraPoint){
  if(cameraPoint.length!==3||!cameraPoint.every(Number.isFinite))return null;
  const p=new Vector3(...cameraPoint),length=p.length();if(!(length>0))return null;ray.direction.copy(p).normalize();let nearest=Infinity;
  if(bvh)return bvh.raycastFirst(ray,DoubleSide)?.distance??null;
  for(const [a,b,c] of triangles)if(ray.intersectTriangle(a,b,c,false,hit))nearest=Math.min(nearest,hit.length());
  return Number.isFinite(nearest)?nearest:null;
 }};
}

// Deliberately wide experimental tolerance. Unknown depth is not an agreement.
export function depthConflict(targetDistance,depth){
 return Number.isFinite(targetDistance)&&Number.isFinite(depth)&&depth>0&&targetDistance>depth*2&&targetDistance-depth>10;
}

// A farther reconstructed subject is also evidence of a different surface.
// Keep unknown depth separate; neither branch certifies correct correspondence.
export function depthDisagreement(targetDistance,depth){
 if(!Number.isFinite(targetDistance)||targetDistance<=0||!Number.isFinite(depth)||depth<=0)return null;
 if(depthConflict(targetDistance,depth))return 'photo-depth-foreground';
 if(depth>targetDistance*2&&depth-targetDistance>10)return 'photo-depth-background';
 return null;
}
