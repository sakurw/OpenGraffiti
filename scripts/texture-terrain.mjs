import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='data/texture-city/terrain',zoom=15;
export function terrainPixel([lon,lat],z=zoom){
 const scale=256*2**z,phi=lat*Math.PI/180;
 const px=Math.floor((lon+180)/360*scale),py=Math.floor((1-Math.asinh(Math.tan(phi))/Math.PI)/2*scale);
 return {z,x:Math.floor(px/256),y:Math.floor(py/256),px:((px%256)+256)%256,py:((py%256)+256)%256};
}
export function decodeElevation(r,g,b){const n=r*65536+g*256+b;return n===8388608?null:(n>8388608?n-16777216:n)*.01;}
export async function terrainFor(coordinates){
 await mkdir(root,{recursive:true});const tiles=new Map(),queue=[...new Set(coordinates.map(ll=>{const p=terrainPixel(ll);return `${p.z}/${p.x}/${p.y}`;}))];let next=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<queue.length){
  const key=queue[next++],name=key.replaceAll('/','-'),url=`https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/${key}.png`;let bytes;
  try{bytes=await readFile(`${root}/${name}.png`);const provenance=JSON.parse(await readFile(`${root}/${name}.json`,'utf8'));if(provenance.url!==url||provenance.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('GSI terrain cache hash mismatch');}catch(e){if(e.code!=='ENOENT')throw e;
   const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'OpenGraffitiLocalResearch/0.1'}});
   if(response.status===404){tiles.set(key,null);continue;}if(!response.ok)throw Error(`GSI terrain HTTP ${response.status}`);
   bytes=Buffer.from(await response.arrayBuffer());await writeFile(`${root}/${name}.png`,bytes);
   await writeFile(`${root}/${name}.json`,JSON.stringify({url,fetchedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),credit:'国土地理院 DEM5A 標高タイル',specification:'https://maps.gsi.go.jp/development/demtile.html'},null,2));
  }
  const image=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(image.info.width!==256||image.info.height!==256||image.info.channels!==3)throw Error('Invalid GSI elevation tile');
  tiles.set(key,{...image,url});
 }}));
 return {tiles:queue.length,sample:ll=>{const p=terrainPixel(ll),tile=tiles.get(`${p.z}/${p.x}/${p.y}`);if(!tile)return null;
  const offset=(p.py*256+p.px)*3,h=decodeElevation(...tile.data.subarray(offset,offset+3));
  return h===null?null:{height:h+1.65,groundHeight:h,method:'GSI-DEM5A-ground-plus-1.65m-estimate',source:tile.url,pixel:[p.px,p.py],distance:0};
 }};
}
