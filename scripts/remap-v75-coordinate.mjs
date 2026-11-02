import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {readFile,writeFile} from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const atlas=JSON.parse(await readFile('data/texture-city/tocho-wall-atlas-16471-corrected.json','utf8'));
const sem=JSON.parse(await readFile('data/texture-city/triangle-input-108038344-semantic.json','utf8'));
const doc=await io.read('data/texture-city/tocho-photographic-v75-noflip.glb');
const vcoords=sem.vertices.map(v=>v.world.map(x=>Math.round(x*1000000)/1000000));
function key(a){return a.map(x=>x.join(',')).sort().join('|')}
const glbMap=new Map(); let tris=0;
for(const [mi,m] of doc.getRoot().listMeshes().entries()) for(const [pi,p] of m.listPrimitives().entries()){
 const pos=p.getAttribute('POSITION'),idx=p.getIndices(); if(!pos||!idx)continue;
 for(let off=0;off<idx.getCount();off+=3){let pts=[];for(let c=0;c<3;c++) pts.push([0,1,2].map(k=>Math.round(pos.getScalar(idx.getScalar(off+c)*3+k)*1000000)/1000000));glbMap.set(key(pts),{meshIndex:mi,primitiveId:pi,indexOffset:off});tris++;}
}
let matched=0; const out=[];
for(const r of atlas.records){const pts=(r.vertexIds||[]).map(id=>vcoords[id]);const hit=glbMap.get(key(pts)); if(hit){matched++;out.push({...r,...hit});} else out.push(r);}
await writeFile('data/texture-city/tocho-wall-atlas-16471-v75-coordinate-remap.json',JSON.stringify({matched,total:atlas.records.length,mappings:out},null,2));
console.log(JSON.stringify({matched,total:atlas.records.length,glbTriangles:tris}));
