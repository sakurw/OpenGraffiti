import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptEncoder} from 'meshoptimizer';
import {triangulate,xml,descendants,polygon,dot,sub} from './plateau-geometry.mjs';
import {packAtlas} from './plateau-atlas.mjs';
import {visibleFacades} from './facade-visibility.mjs';
const datasetVersion='plateau-2025-v4',baseUrl='/assets/datasets/'+datasetVersion,out=resolve('public'+baseUrl);
await mkdir(out,{recursive:true});await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit]).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const catalog={schemaVersion:'2.0.0',datasetVersion,areas:[],walls:[],sections:[],excludedWalls:[]},files=[];
async function save(path,data){await mkdir(dirname(resolve(out,path)),{recursive:true});await writeFile(resolve(out,path),data);files.push({path,bytes:Buffer.byteLength(data),sha256:createHash('sha256').update(data).digest('hex')});}
function uuid(name){const b=createHash('sha1').update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8','hex')).update(name).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
for(const [id,mesh,areaId]of [['plateau-13103-minato-ku-2025','53393599','tokyo-tower'],['plateau-13104-shinjuku-ku-2025','53394525','tocho']]){
 const root='data/plateau/'+id,g=JSON.parse(await readFile(root+'/'+mesh+'-geometry.json','utf8')),plan=JSON.parse(await readFile(root+'/'+mesh+'-plan.json','utf8')),buildings=g.buildings;
 const needed=[...new Set(buildings.flatMap(b=>b.polygons.map(p=>g.textures[p.id]?.image).filter(Boolean)))];
 console.log('Packing '+areaId+' '+needed.length+' source textures');
 const atlas=await packAtlas(needed,root+'/udx/bldg',save,areaId);
 await save('textures/'+areaId+'-layout.json',JSON.stringify({size:atlas.size,entries:[...atlas.map.values()]}));
 const originals=new Map();for(const path of needed){const bytes=await readFile(root+'/udx/bldg/'+path),hash=createHash('sha256').update(bytes).digest('hex'),name='textures/source/'+hash+(path.toLowerCase().endsWith('.png')?'.png':'.jpg');if(!files.some(f=>f.path===name))await save(name,bytes);originals.set(path,baseUrl+'/'+name);}
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(areaId),groups=new Map(),recipes={},polyWalls=new Map(),partWalls=new Map();
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
 const unlit=doc.createExtension(KHRMaterialsUnlit),materials=atlas.buffers.map((bytes,i)=>{const texture=doc.createTexture('atlas-'+i).setImage(bytes).setMimeType('image/jpeg');return doc.createMaterial('atlas-'+i).setBaseColorTexture(texture).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());});
 materials.push(doc.createMaterial('untextured').setBaseColorFactor([.72,.73,.69,1]).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit()));
 function geometry(p){const t=triangulate(p.rings.map(r=>r.points)),a=g.textures[p.id],sourceUV=[];let valid=!!a;for(const r of p.rings){const uv=a?.rings[r.id];if(!uv||uv.length<r.points.length*2)valid=false;for(let i=0;i<r.points.length;i++)sourceUV.push(uv?.[i*2]||0,1-(uv?.[i*2+1]||0));}return {...t,sourceUV,image:valid?a.image:null};}
 const byBuilding=new Map(buildings.map(b=>[b.id,b]));
 for(let index=0;index<plan.walls.length;index++){
  const w=plan.walls[index],b=byBuilding.get(w.buildingId),ps=b.walls.filter(p=>w.polygonIds.includes(p.id)),wallId=uuid(datasetVersion+'|'+id+'|'+b.id+'|'+w.partId),scale=2048/Math.max(w.width,w.height);
  const recipe={...w,wallId,polygons:ps.map(p=>{const t=geometry(p),panel=w.panels.find(a=>a.polygonIds.includes(p.id));const canvasUV=t.points.flatMap(v=>[(dot(v,w.u)-w.lo[0])/w.width,(w.hi[1]-v[1])/w.height]);return {id:p.id,points:t.points,normal:t.normal,indices:t.indices,sourceUV:t.sourceUV,canvasUV,panelId:panel.panelId,image:originals.get(t.image)};})};
  recipe.visiblePolygons=visibleFacades(recipe.polygons,b.polygons.map(p=>({id:p.id,...geometry(p)})),w);
  if(!recipe.visiblePolygons.length){catalog.excludedWalls.push({wallId,buildingId:b.id,quadrant:w.quadrant,reason:'fully-occluded-from-cardinal-view'});continue;}
  recipes[wallId]=recipe;partWalls.set(w.partId,wallId);for(const p of ps)polyWalls.set(p.id,wallId);
  catalog.walls.push({id:wallId,number:index+1,name:(areaId==='tocho'?'都庁周辺':'東京タワー周辺')+' '+w.direction+'面 '+(index+1),street:areaId==='tocho'?'西新宿':'芝公園・神谷町',areaId,sectionId:'',width:w.width,height:w.height,canvasWidth:Math.max(1,Math.round(w.width*scale)),canvasHeight:Math.max(1,Math.round(w.height*scale)),position:w.center,normal:w.normal,baseImage:'/api/v1/walls/'+wallId+'/base',maskImage:'/api/v1/walls/'+wallId+'/mask',source:{dataset:id,mesh,buildingId:b.id,quadrant:w.quadrant,direction:w.direction,panelCount:w.panels.length,surfaceId:w.surfaceId,polygonIds:w.polygonIds,lod:b.lod},validation:{rms:w.rms,maxDeviation:w.maxDeviation,holeCount:w.holeCount},lazy:true,mock:false});
 }
 function addGeometry(t,lod,wallId,polygonId){
  const a=t.image?atlas.map.get(t.image):null,key=(a?.page??atlas.pages)+'|'+lod;let h=groups.get(key);
  if(!h){h={positions:[],normals:[],uvs:[],indices:[],faces:[],page:a?.page??atlas.pages,lod};groups.set(key,h);}
  const offset=h.positions.length/3,start=h.indices.length/3;h.positions.push(...t.points.flat());h.normals.push(...t.points.flatMap(()=>t.normal));
  h.uvs.push(...t.sourceUV.map((v,i)=>!a?0:i%2?(a.y+Math.max(0,Math.min(1,v))*a.height)/atlas.size:(a.x+Math.max(0,Math.min(1,v))*a.width)/atlas.size));h.indices.push(...t.indices.map(i=>i+offset));
  if(wallId)h.faces.push({start,count:t.indices.length/3,wallId,polygonId});
 }
 for(const b of buildings)for(const p of b.polygons){const t=geometry(p);if(t.indices.length)addGeometry(t,b.lod,polyWalls.get(p.id),p.id);}
 function prim(name,h,mat){return doc.createPrimitive().setAttribute('POSITION',doc.createAccessor(name+'p').setType('VEC3').setArray(new Float32Array(h.positions)).setBuffer(buffer)).setAttribute('NORMAL',doc.createAccessor(name+'n').setType('VEC3').setArray(new Float32Array(h.normals)).setBuffer(buffer)).setAttribute('TEXCOORD_0',doc.createAccessor(name+'uv').setType('VEC2').setArray(new Float32Array(h.uvs)).setBuffer(buffer)).setIndices(doc.createAccessor(name+'i').setType('SCALAR').setArray(new Uint32Array(h.indices)).setBuffer(buffer)).setMaterial(mat);}
 for(const [key,h]of groups){const p=prim(key,h,materials[h.page]);if(p.getMaterial().getBaseColorTexture())p.getMaterial().getBaseColorTextureInfo().setMinFilter(9729).setMagFilter(9729);scene.addChild(doc.createNode(key).setMesh(doc.createMesh(key).addPrimitive(p)).setExtras({plateau:{dataset:id,lod:h.lod,role:'original'},wallFaces:h.faces}));}
 const roadText=await readFile(root+'/udx/tran/'+mesh+'_tran_6697_op.gml','utf8'),h={positions:[],normals:[],uvs:[],indices:[]};let roadPolygons=0;
 for(const m of roadText.matchAll(/<tran:Road\b[^>]*>[\s\S]*?<\/tran:Road>/g)){const r=xml(m[0]);for(const scope of descendants(r,'tran:lod3MultiSurface'))for(const pn of descendants(scope,'gml:Polygon')){const p=polygon(pn,g.origin);if(!p)continue;const t=triangulate(p.rings.map(r=>r.points)),offset=h.positions.length/3;h.positions.push(...t.points.flat());h.normals.push(...t.points.flatMap(()=>t.normal));h.uvs.push(...t.points.flatMap(()=>[0,0]));h.indices.push(...t.indices.map(i=>i+offset));roadPolygons++;}}
 const roadMat=doc.createMaterial('road').setBaseColorFactor([.42,.45,.43,1]).setDoubleSided(true).setExtension('KHR_materials_unlit',unlit.createUnlit());
 scene.addChild(doc.createNode('roads').setMesh(doc.createMesh().addPrimitive(prim('roads',h,roadMat))).setExtras({plateau:{role:'road',lod:3}}));
 const glb=await io.writeBinary(doc);await save('models/'+areaId+'.glb',glb);await save('recipes/'+areaId+'.json',JSON.stringify(recipes));
 const areaWalls=catalog.walls.filter(w=>w.areaId===areaId);
 const sections=plan.roads.map(r=>({...r,layout:r.layout.filter(l=>partWalls.has(l.partId))})).map((r,i)=>({id:areaId+'-road-'+(i+1),areaId,name:(areaId==='tocho'?'都庁周辺':'東京タワー周辺')+' 道路 '+(i+1),subtitle:Math.round(r.length)+'m・直線近似',sourceRoadId:r.sourceRoadId,start:r.start,end:r.end,length:r.length,width:r.width,straightnessDrift:r.drift,wallIds:[...new Set(r.layout.map(l=>partWalls.get(l.partId)))],layout:r.layout.map(l=>({...l,partId:undefined,wallId:partWalls.get(l.partId)}))})).filter(s=>s.wallIds.length);
 for(const w of areaWalls)w.sectionId=sections.find(s=>s.wallIds.includes(w.id))?.id||'';
 catalog.sections.push(...sections);
 const bounds=buildings.reduce((a,b)=>[Math.min(a[0],b.min[0]-50),Math.max(a[1],b.max[0]+50),Math.min(a[2],b.min[2]-50),Math.max(a[3],b.max[2]+50)],[Infinity,-Infinity,Infinity,-Infinity]);
 const area={id:areaId,name:areaId==='tocho'?'都庁周辺':'東京タワー・神谷町',model:baseUrl+'/models/'+areaId+'.glb',dataset:id,sourceUrl:'https://www.geospatial.jp/ckan/dataset/'+id,origin:g.origin,roadPolygons,buildingCount:buildings.length,texturedBuildings:buildings.filter(b=>b.polygons.some(p=>g.textures[p.id])).length,lod3Buildings:buildings.filter(b=>b.lod>=3).length,drawable:true,camera:areaId==='tocho'?{position:[420,330,430],target:[0,90,0]}:{position:[-360,330,470],target:[0,160,0]},bounds,note:'同じ建物の壁を東西南北の4方向で統合。正面から見える壁を配置を保って1枚に描画します。',atlasPages:atlas.pages,resizedTextures:atlas.resized};
 catalog.areas.push(area);await save('areas/'+areaId+'.json',JSON.stringify(area));console.log(JSON.stringify({area:areaId,buildings:area.buildingCount,textured:area.texturedBuildings,walls:areaWalls.length,roads:sections.length,atlasPages:atlas.pages,glbBytes:glb.length}));
}
await save('catalog.json',JSON.stringify(catalog));
const sourceRecords=[];for(const id of ['plateau-13103-minato-ku-2025','plateau-13104-shinjuku-ku-2025']){const dir='data/plateau/'+id;for(const f of await readdir(dir))if(f.startsWith('download-')&&f.endsWith('.json'))sourceRecords.push(JSON.parse(await readFile(dir+'/'+f,'utf8')));}
await save('source-manifest.json',JSON.stringify({downloads:sourceRecords}));
await save('provenance.json',JSON.stringify({source:'3D都市モデル（Project PLATEAU）港区・新宿区（2025年度）（東京都）をOpenGraffitiが加工',licenseUrl:'https://www.mlit.go.jp/plateau/site-policy/',processing:'LOD2/3 planar WallSurface extraction; original UV to padded texture atlases; lazy 2048px wall baking; street-axis fit with building occlusion tests',limitations:'Source facade imagery errors cannot be reconstructed from a single aerial image; road visibility is a sampled approximation, no trees/vehicles; LOD2 painted windows are not geometric openings.'}));
await writeFile(out+'/manifest.json',JSON.stringify({schemaVersion:'2.0.0',datasetVersion,files},null,2));
await writeFile('shared/generated/plateau.json',JSON.stringify(catalog));
