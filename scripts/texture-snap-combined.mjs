// Preserve disjoint, actually projected Commons and KartaView buildings in one GLB.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {mergeDocuments,unpartition} from '@gltf-transform/functions';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function combineSnapReports(reports,areaId,catalog){
 const targets=catalog.buildings.filter(b=>b.areaId===areaId),seen=new Set(),sources=new Map(),buildings=[],polygons=[];
 const commits=new Set();
 for(const r of reports){
  if(r.areaId!==areaId||r.registration!=='estimated-unverified'||r.projectedBuildings!==r.buildings.length)throw Error('Invalid SNAP report');
  commits.add(r.snapCommit);
  for(const b of r.buildings){
   const target=targets.find(t=>t.id===b.buildingId);
   if(!target||!Number.isFinite(b.projectedArea)||b.projectedArea<=0||b.projectedArea>target.wallArea+.01)throw Error('Invalid building area');
   if(seen.has(b.buildingId))throw Error('Overlapping buildings require geometric union');
   if(!b.sourceIds.length||b.sourceIds.some(id=>!r.sources.some(s=>s.id===id)))throw Error('Missing source');
   seen.add(b.buildingId);buildings.push({...b});
  }
  for(const s of r.sources){
   if(sources.has(s.id)&&JSON.stringify(sources.get(s.id))!==JSON.stringify(s))throw Error('Source ID collision');
   sources.set(s.id,s);
  }
  polygons.push(...r.polygons);
 }
 if(commits.size!==1||!reports[0]?.snapCommit)throw Error('SNAP version mismatch');
 return {areaId,model:`/assets/texture-poc/experimental/snap-combined/${areaId}.glb`,totalBuildings:targets.length,scope:{kind:'all-buildings'},
  projectedBuildings:buildings.length,registration:'estimated-unverified',snapCommit:reports[0].snapCommit,
  method:'Preserved Commons and KartaView photographs rectified with official SNAP; disjoint building union',buildings,sources:[...sources.values()],polygons,
  coverage:targets.map(t=>({buildingId:t.id,projectedArea:buildings.find(b=>b.buildingId===t.id)?.projectedArea??0,outcome:seen.has(t.id)?'partially-projected':'not-applied'})),
  warnings:['Partial, provisional wall registration only. Unobserved buildings remain not applied.','KartaView/Mapillary capture independence is unverified.','Source variants, original photographs, PLATEAU and painting history are preserved.']};
}
// Hash each drawable's identity, exact attribute/index bytes, material and embedded photo.
export function drawableSignatures(doc){
 const result=[];
 for(const n of doc.getRoot().listNodes())for(const p of n.getMesh()?.listPrimitives()??[]){
  const a=p.listSemantics().sort().map(k=>{const v=p.getAttribute(k);return [k,v.getType(),v.getNormalized(),hash(new Uint8Array(v.getArray().buffer,v.getArray().byteOffset,v.getArray().byteLength))];});
  const m=p.getMaterial(),idx=p.getIndices()?.getArray(),tex=m?.getBaseColorTexture();
  result.push(hash(JSON.stringify({extras:n.getExtras(),matrix:n.getWorldMatrix(),mode:p.getMode(),a,index:idx?hash(new Uint8Array(idx.buffer,idx.byteOffset,idx.byteLength)):null,
   material:m?{color:m.getBaseColorFactor(),alpha:m.getAlphaMode(),cutoff:m.getAlphaCutoff(),double:m.getDoubleSided(),unlit:!!m.getExtension('KHR_materials_unlit'),image:tex?hash(tex.getImage()):null}:null})));
 }
 return result.sort();
}
async function main(){
 const base='public/assets/texture-poc/experimental',catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);await mkdir(`${base}/snap-combined`,{recursive:true});
 for(const area of ['tocho','tokyo-tower']){
  const paths=[`${base}/${area}-snap.json`,`${base}/snap-sfm/${area}.json`],raw=await Promise.all(paths.map(p=>readFile(p))),reports=raw.map(b=>JSON.parse(b));
  const report=combineSnapReports(reports,area,catalog),doc=new Document(),scene=doc.createScene('Commons and KartaView + official SNAP'),expected=[];
  report.inputs=[];
  for(let i=0;i<reports.length;i++){
   const r=reports[i];if(!/^\/assets\/texture-poc\/experimental\/(snap|snap-sfm)\/[a-z0-9-]+\.glb$/.test(r.model))throw Error('Invalid model path');
   const bytes=await readFile('public'+r.model),source=await io.readBinary(bytes),actual=new Set();
   for(const n of source.getRoot().listNodes())if(n.getMesh()){const id=n.getExtras().buildingId;if(!r.buildings.some(b=>b.buildingId===id))throw Error('Unreported GLB building');actual.add(id);}
   if(actual.size!==r.buildings.length)throw Error('Report contains missing geometry');
   expected.push(...drawableSignatures(source));mergeDocuments(doc,source);
   report.inputs.push({report:paths[i],reportSha256:hash(raw[i]),model:r.model,modelSha256:hash(bytes),projectedBuildings:r.projectedBuildings});
  }
  for(const s of [...doc.getRoot().listScenes()])if(s!==scene){for(const n of [...s.listChildren()])scene.addChild(n);s.dispose();}
  doc.getRoot().setDefaultScene(scene);await doc.transform(unpartition());
  doc.getRoot().getAsset().copyright=report.sources.map(s=>`Photo © ${s.author}; ${s.license}; ${s.url}`).join('; ')+`; PLATEAU Tokyo 2025; official SNAP ${report.snapCommit}; provisional reprojection`;
  const output=await io.writeBinary(doc),actual=drawableSignatures(await io.readBinary(output));
  if(JSON.stringify(expected.sort())!==JSON.stringify(actual))throw Error('Merged GLB changed input drawables');
  report.preservationAudit={passed:true,drawables:actual.length,signatureSha256:hash(JSON.stringify(actual)),outputSha256:hash(output)};
  await writeFile('public'+report.model,output);await writeFile(`${base}/snap-combined/${area}.json`,JSON.stringify(report,null,2));
  console.log({area,buildings:report.projectedBuildings,unapplied:report.totalBuildings-report.projectedBuildings,audit:report.preservationAudit});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
