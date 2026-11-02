// Lossless triangle selection from the formally adopted native PLATEAU tiles.
// No photograph or donor geometry is exported. Own atlas links stay external.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO,Document} from '@gltf-transform/core';
import {Vector3,Triangle,Box3,Color,SRGBColorSpace} from 'three';

const source=process.env.PV_SCOPE_DIR||'public/assets/tocho-twelve-blocks-20261019',out=process.env.PV_MODEL_OUT||'public/assets/pv-adopted-20261029';
const stable=process.env.PV_STABLE_MANIFEST?JSON.parse(await fs.readFile(process.env.PV_STABLE_MANIFEST)):null,oldKeys=new Map(stable?.buildings.map(b=>[b.id,[...b.parts]])||[]);
const scope=JSON.parse(await fs.readFile(source+'/scope.json','utf8'));
const atlas=JSON.parse(await fs.readFile('public/assets/plateau-official-shinjuku-2025/own-only/texture-overrides.json','utf8'));
const profiles=new Map(JSON.parse(await fs.readFile('public/assets/tocho-district-photo-v3-20261018/photo-profiles.json','utf8')).buildings.map(p=>[p.buildingId,p]));
const sandbox={module:{exports:{}},exports:{},require:createRequire(import.meta.url),console};
vm.runInNewContext(await fs.readFile('node_modules/three/examples/jsm/libs/draco/draco_decoder.js','utf8'),sandbox);
const draco=await sandbox.module.exports({});
const hash=b=>createHash('sha256').update(b).digest('hex');
const lat=35.6896*Math.PI/180,lon=139.6917*Math.PI/180,e2=6.6943799901413165e-3;
const R=6378137/Math.sqrt(1-e2*Math.sin(lat)**2);
const origin=new Vector3(R*Math.cos(lat)*Math.cos(lon),R*Math.cos(lat)*Math.sin(lon),R*(1-e2)*Math.sin(lat));
const east=new Vector3(-Math.sin(lon),Math.cos(lon),0),north=new Vector3(-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat)),up=new Vector3(Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat));
const local=(a,rtc)=>{const p=new Vector3(rtc[0]+a[0],rtc[1]-a[2],rtc[2]+a[1]).sub(origin);return new Vector3(p.dot(east),p.dot(up),-p.dot(north));};
function parse(bytes){const lengths=[12,16,20,24].map(o=>bytes.readUInt32LE(o)),start=28+lengths.reduce((a,b)=>a+b,0),size=bytes.readUInt32LE(start+12);assert.equal(bytes.toString('ascii',start,start+4),'glTF');return {json:JSON.parse(bytes.subarray(start+20,start+20+size).toString()),bin:bytes.subarray(start+28+size,start+bytes.readUInt32LE(start+8))};}
function decode(g,p,bin){const ext=p.extensions.KHR_draco_mesh_compression,v=g.bufferViews[ext.bufferView],bytes=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength),d=new draco.Decoder(),b=new draco.DecoderBuffer(),m=new draco.Mesh();b.Init(new Int8Array(bytes),bytes.length);const status=d.DecodeBufferToMesh(b,m);assert(status.ok(),status.error_msg());const attrs={};for(const [name,id]of Object.entries(ext.attributes)){const attr=d.GetAttributeByUniqueId(m,id),a=new draco.DracoFloat32Array();d.GetAttributeFloatForAllPoints(m,attr,a);attrs[name]={size:attr.num_components(),array:Float32Array.from({length:a.size()},(_,i)=>a.GetValue(i))};draco.destroy(a);}const f=new draco.DracoInt32Array(),indices=[];for(let i=0;i<m.num_faces();i++){d.GetFaceFromMesh(m,i,f);for(let k=0;k<3;k++)indices.push(f.GetValue(k));}for(const o of [f,m,b,d])draco.destroy(o);return {attrs,indices};}
function tint(id){let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return profiles.get(id)?.baseColor??[[188,185,169],[173,179,172],[192,177,157],[165,175,180],[184,177,168],[176,185,178]][(h>>>0)%6];}
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(),nodes=new Map(),buildings=new Map(),sources=[];
let partNo=0,triangleCount=0;
const bounds=new Box3();
function attribute(name,type,arr){return doc.createAccessor(name).setType(type).setArray(new Float32Array(arr)).setBuffer(buffer);}
const envelope=scope.selectionPolygonENU;
const rect=envelope.reduce((r,p)=>[Math.min(r[0],p[0]),Math.min(r[1],p[1]),Math.max(r[2],p[0]),Math.max(r[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
for(const kind of ['buildings','roads','bridges']){
 const tiles=JSON.parse(await fs.readFile(`${source}/${kind}-tileset.json`,'utf8')).root.children;
 for(const tile of tiles){
  const url=tile.content.uri,file=url.split('/').at(-1),bytes=await fs.readFile('public'+url),{json:g,bin}=parse(bytes),rtc=g.extensions.CESIUM_RTC.center,entry=scope.tiles[file],allowed=kind==='buildings'?new Map(entry.batchIds.map((batch,i)=>[batch,entry.buildingIds[i]])):null;
  sources.push({url,sha256:hash(bytes),kind});
  for(const mesh of g.meshes)for(const p of mesh.primitives){
   const {attrs,indices}=decode(g,p,bin),pos=attrs.POSITION.array,batch=attrs._BATCHID?.array,uv=attrs.TEXCOORD_0?.array,points=Array.from({length:pos.length/3},(_,i)=>local(pos.subarray(i*3,i*3+3),rtc)),parts=new Map(),groups=new Map();
   for(let i=0;i<indices.length;i+=3){const ix=indices.slice(i,i+3),id=allowed?allowed.get(Math.round(batch[ix[0]])):kind;if(!id)continue;const q=ix.map(j=>points[j]);
    if(!allowed&&(Math.max(...q.map(v=>v.x))<rect[0]||Math.min(...q.map(v=>v.x))>rect[2]||Math.max(...q.map(v=>v.z))<rect[1]||Math.min(...q.map(v=>v.z))>rect[3]))continue;
    const n=new Triangle(...q).getNormal(new Vector3()),u=new Vector3(n.z,0,-n.x).normalize();if(u.length()<.1)u.set(1,0,0);
    const key=[id,Math.round(n.x*100),Math.round(n.y*100),Math.round(n.z*100),Math.round(n.dot(q[0])*5)].join(':');
    const group=groups.get(key)??{n,u,minU:Infinity,maxU:-Infinity,minY:Infinity,maxY:-Infinity,area:0};for(const v of q){const at=v.dot(u);group.minU=Math.min(group.minU,at);group.maxU=Math.max(group.maxU,at);group.minY=Math.min(group.minY,v.y);group.maxY=Math.max(group.maxY,v.y);}group.area+=new Triangle(...q).getArea();groups.set(key,group);
    const part=parts.get(id)??[];part.push({ix,q,group});parts.set(id,part);
   }
   for(const [id,triangles]of parts){
    const data={position:[],normal:[],uv:[],ownUv:[],color:[],role:[],shade:[]},b=scope.buildings[id],profile=profiles.get(id),rgb=kind==='buildings'?tint(id):kind==='roads'?[139,150,148]:[158,167,160],datum=atlas.tiles[file]?.verticalDatumOffsetMeters??37,light=new Vector3(-.5,.8,.4).normalize();
    for(const t of triangles){const f=t.group,width=f.maxU-f.minU,height=f.maxY-f.minY,bh=b?Math.max(3,b.maxHeight-b.minHeight):1,roof=Math.abs(f.n.y)>.65,wall=b&&Math.abs(f.n.y)<.2&&height>=4.8&&width>=2.4&&f.area>=18&&f.minY<b.maxHeight+datum-6&&profile?.windowAllowed!==false,bays=Math.max(1,Math.round(width/(profile?.bayWidth??3))),floors=Math.max(1,Math.round(bh/(profile?.floorHeight??3.5)));
     for(let k=0;k<3;k++){const v=t.q[k];data.position.push(v.x,v.y,v.z);data.normal.push(f.n.x,f.n.y,f.n.z);data.uv.push(uv?uv[t.ix[k]*2]:0,uv?uv[t.ix[k]*2+1]:0);data.ownUv.push(roof?v.x/2:(v.dot(f.u)-f.minU)/Math.max(width,.01)*bays,roof?v.z/2:(v.y-(b?.minHeight??0)-datum)/bh*floors);const color=new Color().setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255,SRGBColorSpace);if(roof&&b)color.lerp(new Color('#8b9691'),.48);data.color.push(color.r,color.g,color.b);data.role.push(wall?1:roof&&b?2:0);data.shade.push(b?.81+.19*Math.max(0,f.n.dot(light)):1);if(b)bounds.expandByPoint(v);}
    }
    const key=stable?(oldKeys.get(id)?.shift()||`expanded-part-${partNo++}`):`part-${partNo++}`,mat=doc.createMaterial(key).setDoubleSided(true).setExtras({ownOnly:true,atlasUrl:kind==='buildings'?atlas.tiles[file]?.images?.[0]?.url??null:null,partKey:key,kind});
    const primitive=doc.createPrimitive().setAttribute('POSITION',attribute(key,'VEC3',data.position)).setAttribute('NORMAL',attribute(key,'VEC3',data.normal)).setAttribute('TEXCOORD_0',attribute(key,'VEC2',data.uv)).setAttribute('_OWN_UV',attribute(key,'VEC2',data.ownUv)).setAttribute('_OWN_COLOR',attribute(key,'VEC3',data.color)).setAttribute('_OWN_ROLE',attribute(key,'SCALAR',data.role)).setAttribute('_OWN_SHADE',attribute(key,'SCALAR',data.shade)).setMaterial(mat);
    if(!nodes.has(id)){const node=doc.createNode(id).setMesh(doc.createMesh(id)).setExtras({buildingId:b?id:null,kind});scene.addChild(node);nodes.set(id,node);}
    nodes.get(id).getMesh().addPrimitive(primitive);triangleCount+=triangles.length;
    if(b){const rec=buildings.get(id)??{id,name:profile?.name||b.name||'',blockId:b.blockId,parts:[],bounds:[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]};for(const t of triangles)for(const q of t.q)for(let k=0;k<3;k++){rec.bounds[k]=Math.min(rec.bounds[k],q.getComponent(k));rec.bounds[k+3]=Math.max(rec.bounds[k+3],q.getComponent(k));}rec.parts.push(key);buildings.set(id,rec);}
   }
  }
  console.log(`${kind}: ${file} / ${buildings.size} buildings`);
 }
}
assert.deepEqual([...buildings.keys()].sort(),[...scope.selectedBuildingIds].sort());
await fs.mkdir(out,{recursive:true});const glb=await new NodeIO().writeBinary(doc);await fs.writeFile(out+'/city.glb',glb);
const metadata={version:1,methodDocument:'開発関連/設計/PLATEAU建物テクスチャ生成/正式採用方式.md',sourceScope:source+'/scope.json',sourceScopeSha256:hash(await fs.readFile(source+'/scope.json')),model:'/assets/pv-adopted-20261029/city.glb',modelSha256:hash(glb),buildings:[...buildings.values()],buildingCount:buildings.size,triangleCount,bounds:[bounds.min.toArray(),bounds.max.toArray()],envelope,sourcePhotoMaterials:0,donorGeometryUsed:false,sources};
await fs.writeFile(out+'/manifest.json',JSON.stringify(metadata));console.log(JSON.stringify({buildings:buildings.size,triangleCount,bytes:glb.length,output:out}));
