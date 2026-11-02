import {readFile,writeFile} from 'node:fs/promises';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {triangulate} from './plateau-geometry.mjs';
const root='data/plateau/plateau-13104-shinjuku-ku-2025';
const g=JSON.parse(await readFile(root+'/53394525-geometry.json','utf8'));
const buildingId='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const polygonId='poly-448d6c18-aa00-4eaa-b0ed-de04cfebcf82';
const b=g.buildings.find(b=>b.id===buildingId);
const output='public/assets/texture-poc';
for(const variant of ['original','snap','mapillary']){
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Existing PLATEAU Tocho No1');
 doc.getRoot().getAsset().copyright='PLATEAU / Tokyo 2025; '+(variant==='snap'?'photo: Markus Leupold-Löwenthal, CC BY-SA 3.0, https://commons.wikimedia.org/wiki/File:TokyoMetropolitanGovernmentOffice.jpg':variant==='mapillary'?'photo: bamatel / Mapillary, CC BY-SA 4.0, https://www.mapillary.com/app/?pKey=1402663663827916':'original PLATEAU imagery')+'; adapted by OpenGraffiti';
 const unlit=doc.createExtension(KHRMaterialsUnlit),materials=new Map();
 const mesh=doc.createMesh(buildingId); scene.addChild(doc.createNode(buildingId).setMesh(mesh));
 const accessor=(name,type,values)=>doc.createAccessor(name).setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
 async function material(path){if(materials.has(path))return materials.get(path);const m=doc.createMaterial(path||'untextured').setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());if(path){const tex=doc.createTexture(path).setImage(await readFile(root+'/udx/bldg/'+path)).setMimeType(path.endsWith('.png')?'image/png':'image/jpeg');m.setBaseColorTexture(tex);}else m.setBaseColorFactor([.72,.73,.69,1]);materials.set(path,m);return m;}
 for(const p of b.polygons){
  const t=triangulate(p.rings.map(r=>r.points));if(!t.indices.length)continue;
  const a=g.textures[p.id];let valid=!!a,uv=[];
  for(const r of p.rings){const u=a?.rings[r.id];if(!u||u.length<r.points.length*2)valid=false;for(let i=0;i<r.points.length;i++)uv.push(u?.[i*2]||0,1-(u?.[i*2+1]||0));}
  const prim=doc.createPrimitive().setAttribute('POSITION',accessor(p.id,'VEC3',t.points.flat())).setAttribute('TEXCOORD_0',accessor('uv','VEC2',uv)).setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(new Uint32Array(t.indices)).setBuffer(buffer)).setMaterial(await material(valid?a.image:null));mesh.addPrimitive(prim);
  if(p.id===polygonId && variant!=='original'){
   // Same existing polygon vertices, not a replacement box or disconnected billboard.
   const overlay=prim.clone();const ps=t.points.map(v=>v.map((n,i)=>n+t.normal[i]*.015));
   overlay.setAttribute('POSITION',accessor('patch','VEC3',ps.flat()));
   const south=t.points[0],north=t.points[1],len=Math.hypot(north[0]-south[0],north[2]-south[2]);
   const uv2=t.points.flatMap(v=>[((v[0]-south[0])*(north[0]-south[0])+(v[2]-south[2])*(north[2]-south[2]))/(len*len),(186.37-v[1])/104.06]);
   overlay.setAttribute('TEXCOORD_0',accessor('patchUV','VEC2',uv2));
   const tex=doc.createTexture(variant).setImage(await readFile(output+'/'+variant+'.png')).setMimeType('image/png');
   const mat=doc.createMaterial(variant).setBaseColorTexture(tex).setDoubleSided(true).setAlphaMode('MASK').setAlphaCutoff(.5).setExtension('KHR_materials_unlit',unlit.createUnlit());overlay.setMaterial(mat);mesh.addPrimitive(overlay);
  }
 }
 await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write(output+'/'+variant+'.glb',doc);
}
await writeFile(output+'/model.json',JSON.stringify({buildingId,polygonId,sourceDataset:'plateau-2025-v4',sourcePolygonCount:b.polygons.length,area:'tocho',wallId:'8fb56916-81d8-5072-bc15-1bcc872381f1',patchHeight:[82.31,186.37],comparisonHeight:[130,186.37]},null,2));
console.log('Generated three variants of the existing '+buildingId);
