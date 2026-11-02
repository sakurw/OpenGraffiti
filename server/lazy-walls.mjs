import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {bakeWall,overlayGeometry} from './wall-bake.mjs';
import {imageHash} from './render.mjs';
const recipeHashes=new WeakMap();
const catalogs=new Map(),pixels=new Map(),pending=new Map();let queue=Promise.resolve();
export async function recipeFor(w,datasetVersion){const path='public/assets/datasets/'+datasetVersion+'/recipes/'+w.areaId+'.json';if(!catalogs.has(path))catalogs.set(path,readFile(path,'utf8').then(JSON.parse));const r=(await catalogs.get(path))[w.id];if(!r)throw Error('Wall recipe missing');return r;}
async function texture(path){if(!pixels.has(path)){const value=await sharp('public'+path).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});if(pixels.size>=4)pixels.delete(pixels.keys().next().value);pixels.set(path,value);}return pixels.get(path);}
export async function wallGeometry(w,datasetVersion){const r=await recipeFor(w,datasetVersion);return {...w,projection:{origin:r.origin,u:r.u,v:r.v,lo:r.lo,hi:r.hi},geometry:overlayGeometry(r),overlayOffset:.002};}
export async function ensureWall(w,datasetVersion,dir){
 const file=join(dir,w.id+'-base.png'),mask=join(dir,w.id+'-mask.png'),meta=join(dir,w.id+'-base.json');
 const r=await recipeFor(w,datasetVersion);if(!recipeHashes.has(r))recipeHashes.set(r,createHash('sha256').update(JSON.stringify(r)).digest('hex'));const recipeHash=recipeHashes.get(r);
 try{const info=JSON.parse(await readFile(meta,'utf8'));if(info.recipeHash===recipeHash)return info;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(pending.has(file))return pending.get(file);
 const work=queue.then(async()=>{
  const b=await bakeWall(r,texture),info={recipeHash,baseHash:imageHash(b.data,b.width,b.height),maskHash:imageHash(b.mask,b.width,b.height),width:b.width,height:b.height};
  await mkdir(dir,{recursive:true});await writeFile(file+'.tmp',b.base);await rename(file+'.tmp',file);await writeFile(mask+'.tmp',b.maskPng);await rename(mask+'.tmp',mask);
  await writeFile(meta+'.tmp',JSON.stringify(info));await rename(meta+'.tmp',meta);return info;
 });
 queue=work.catch(()=>{});pending.set(file,work);try{return await work;}finally{pending.delete(file);}
}
