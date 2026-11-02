import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeSpatialMesh,spatialDepthSampler} from './texture-spatial-depth.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function spatialEvidence(photo,{root='data/texture-city/spatial',accelerated=true}={}){
 if(!/^\d+$/.test(photo.id))throw Error('Invalid spatial photo ID');
 let bytes;try{bytes=await readFile(`${root}/${photo.id}.json`);}catch(e){if(e.code==='ENOENT')return {status:'not-acquired',key:'not-acquired'};throw e;}
 const meta=JSON.parse(bytes),key=hash(bytes);
 if(meta.id!==photo.id||meta.sourceSha256&&meta.sourceSha256!==photo.sha256)throw Error('Spatial source identity mismatch');
 if(!meta.resources?.mesh?.available)return {status:'not-provided',key};
 if(!(meta.atomicScale>0&&Number.isFinite(meta.atomicScale)))return {status:'scale-unavailable',key};
 const meshBytes=await readFile(`${root}/${photo.id}.mesh.bin`);
 if(hash(meshBytes)!==meta.resources.mesh.sha256)throw Error('Spatial mesh hash mismatch');
 const sampler=spatialDepthSampler(decodeSpatialMesh(meshBytes),meta.atomicScale,{cameraType:photo.camera_type,accelerated});
 return {status:sampler.triangles?'available':'no-supported-triangles',key,meshSha256:meta.resources.mesh.sha256,atomicScale:meta.atomicScale,sampler};
}
