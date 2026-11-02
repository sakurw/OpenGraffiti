import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {inflateRawSync,crc32} from 'node:zlib';
import {createHash} from 'node:crypto';

const root=resolve('data/plateau');
const id=process.argv[2]||'plateau-13103-minato-ku-2025';
const filter=process.argv[3]||'/udx/bldg/';
const extract=process.argv.includes('--extract');
await mkdir(resolve(root,id),{recursive:true});
const metaPath=resolve(root,id,'catalog.json');
let meta;
try{meta=JSON.parse(await readFile(metaPath,'utf8'));}catch{const r=await fetch('https://www.geospatial.jp/ckan/api/3/action/package_show?id='+id);if(!r.ok)throw Error(r.status);meta=await r.json();if(!meta.success)throw Error(JSON.stringify(meta));await writeFile(metaPath,JSON.stringify(meta,null,2));}
const resource=meta.result.resources.find(r=>r.name.startsWith('CityGML'));
if(!resource)throw Error('CityGML resource missing');
const url=resource.url;
async function range(start,end){const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(120000)});if(r.status!==206)throw Error(`Range unsupported: ${r.status}`);return Buffer.from(await r.arrayBuffer());}
const indexPath=resolve(root,id,'zip-index.json');
let entries;
try{entries=JSON.parse(await readFile(indexPath,'utf8'));}catch{
 const head=await fetch(url,{method:'HEAD'});const size=Number(head.headers.get('content-length'));if(!size)throw Error('No length');
 const tail=await range(Math.max(0,size-65557),size-1);let e=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){e=i;break;}if(e<0)throw Error('ZIP EOCD not found');
 let cdSize=tail.readUInt32LE(e+12),cdOffset=tail.readUInt32LE(e+16);
 if(cdOffset===0xffffffff||cdSize===0xffffffff){const loc=e-20;if(tail.readUInt32LE(loc)!==0x07064b50)throw Error('ZIP64 locator missing');const z=Number(tail.readBigUInt64LE(loc+8)),b=await range(z,z+55);cdSize=Number(b.readBigUInt64LE(40));cdOffset=Number(b.readBigUInt64LE(48));}
 const cd=await range(cdOffset,cdOffset+cdSize-1);entries=[];
 for(let p=0;p<cd.length;){if(cd.readUInt32LE(p)!==0x02014b50)throw Error('Bad central directory');const n=cd.readUInt16LE(p+28),x=cd.readUInt16LE(p+30),c=cd.readUInt16LE(p+32);let compressed=cd.readUInt32LE(p+20),size=cd.readUInt32LE(p+24),offset=cd.readUInt32LE(p+42);const name=cd.subarray(p+46,p+46+n).toString('utf8');
 for(let q=p+46+n;q<p+46+n+x;){const type=cd.readUInt16LE(q),len=cd.readUInt16LE(q+2);if(type===1){let z=q+4;if(size===0xffffffff){size=Number(cd.readBigUInt64LE(z));z+=8;}if(compressed===0xffffffff){compressed=Number(cd.readBigUInt64LE(z));z+=8;}if(offset===0xffffffff)offset=Number(cd.readBigUInt64LE(z));}q+=4+len;}
 entries.push({name,compressed,size,offset,method:cd.readUInt16LE(p+10),crc:cd.readUInt32LE(p+16)});p+=46+n+x+c;
 }
 await writeFile(indexPath,JSON.stringify(entries,null,2));console.log(JSON.stringify({id,url,totalBytes:size,entries:entries.length}));
}
const paths=filter.startsWith('@')?new Set(JSON.parse(await readFile(filter.slice(1),'utf8'))):null;
const selected=entries.filter(e=>(paths?paths.has(e.name):e.name.includes(filter))&&!e.name.endsWith('/'));
if(paths&&selected.length!==paths.size)throw Error('Some requested paths absent in official ZIP');
console.log(JSON.stringify({selected:selected.length,bytes:selected.reduce((a,e)=>a+e.size,0),files:selected.filter(e=>e.name.endsWith('.gml')).map(e=>({name:e.name,size:e.size,compressed:e.compressed})).slice(0,100)},null,2));
if(extract){const hashes=[];async function download(e){const dest=resolve(root,id,e.name);if(!dest.startsWith(resolve(root,id)+'/')&&!dest.startsWith(resolve(root,id)+'\\'))throw Error('Unsafe ZIP path');let bytes;try{bytes=await readFile(dest);if(bytes.length!==e.size||crc32(bytes)!==e.crc)throw Error('size or CRC32');}catch{
 const header=await range(e.offset,e.offset+29);if(header.readUInt32LE(0)!==0x04034b50)throw Error('Bad local header');const skip=30+header.readUInt16LE(26)+header.readUInt16LE(28),raw=await range(e.offset+skip,e.offset+skip+e.compressed-1);bytes=e.method===8?inflateRawSync(raw):e.method===0?raw:null;if(!bytes||bytes.length!==e.size||crc32(bytes)!==e.crc)throw Error('Invalid extracted length or ZIP CRC32');await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);
 }hashes.push({path:e.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});if(hashes.length%50===0||selected.length<5)console.log(`Extracted ${hashes.length}/${selected.length}: `+e.name);}
 const pending=[...selected];await Promise.all(Array.from({length:6},async()=>{while(pending.length)await download(pending.shift());}));hashes.sort((a,b)=>a.path.localeCompare(b.path));
 await writeFile(resolve(root,id,'download-'+createHash('sha256').update(filter).digest('hex').slice(0,8)+'.json'),JSON.stringify({id,url,filter,downloadedAt:new Date().toISOString(),files:hashes},null,2));}
