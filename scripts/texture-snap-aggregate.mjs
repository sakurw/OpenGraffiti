// Assemble independently registered cases without replacing earlier buildings.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {Document,NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {mergeDocuments,unpartition} from '@gltf-transform/functions';
import {pathToFileURL} from 'node:url';

export function aggregateSnapReports(cases,areaId,catalog){
 const selected=cases.filter(c=>c.areaId===areaId).sort((a,b)=>a.caseId.localeCompare(b.caseId));
 const seen=new Set(),sources=new Map(),buildings=[],polygons=[];
 for(const c of selected){
  if(c.registration!=='estimated-unverified'||c.buildings.length!==1)throw Error('Invalid SNAP case report');
  for(const b of c.buildings){
   const original=catalog.buildings.find(x=>x.id===b.buildingId&&x.areaId===areaId);
   if(!original||b.projectedArea<=0||b.projectedArea>original.wallArea+.01)throw Error('Invalid SNAP building area');
   // Until a geometric union is implemented, never double-count overlapping cases.
   if(seen.has(b.buildingId))throw Error('Overlapping SNAP building cases require a geometric union');
   seen.add(b.buildingId);buildings.push({...b,caseId:c.caseId});
   polygons.push(...c.polygons.map(p=>({...p,buildingId:b.buildingId,caseId:c.caseId})));
  }
  for(const s of c.sources){
   const previous=sources.get(s.id);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(s))throw Error('Conflicting SNAP source provenance');
   sources.set(s.id,s);
  }
 }
 const commits=[...new Set(selected.map(c=>c.snapCommit))];
 if(commits.length>1)throw Error('Mixed SNAP versions');
 return {areaId,model:selected.length?`/assets/texture-poc/experimental/snap/${areaId}-snap.glb`:'',
  projectedBuildings:buildings.length,registration:selected.length?'estimated-unverified':'not-applied',
  method:'Independent Commons photos, official SNAP rectification, per-building manual camera registration',
  snapCommit:commits[0],buildings,sources:[...sources.values()],polygons,
  cases:selected.map(c=>({caseId:c.caseId,model:c.model,buildingId:c.buildings[0].buildingId,camera:c.camera,minimumHeight:c.minimumHeight})),
  // Compatibility for a single-case report; multiple cases must use per-building cameras.
  ...(selected.length===1?{camera:selected[0].camera,minimumHeight:selected[0].minimumHeight}:{}),
  warnings:['Partial experimental coverage only; not included in verified counts.','Original photos, PLATEAU models and painting history are unchanged.']};
}

async function main(){
 const base='public/assets/texture-poc/experimental',files=(await readdir(`${base}/snap/cases`)).filter(f=>f.endsWith('.json'));
 const cases=await Promise.all(files.map(async f=>JSON.parse(await readFile(`${base}/snap/cases/${f}`,'utf8'))));
 const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 const reports=['tocho','tokyo-tower'].map(area=>aggregateSnapReports(cases,area,catalog));
 const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
 for(const report of reports){
  if(report.model){
   const doc=new Document(),scene=doc.createScene('Independent SNAP registered buildings');
   for(const item of report.cases){
    if(!/^\/assets\/texture-poc\/experimental\/snap\/[a-z0-9-]+\.glb$/.test(item.model))throw Error('Invalid local SNAP model');
    const source=await io.read('public'+item.model);
    for(const node of source.getRoot().listNodes())if(node.getMesh()&&node.getExtras().buildingId!==item.buildingId)throw Error('SNAP model building mismatch');
    mergeDocuments(doc,source);
   }
   for(const imported of [...doc.getRoot().listScenes()])if(imported!==scene){for(const child of [...imported.listChildren()])scene.addChild(child);imported.dispose();}
   doc.getRoot().setDefaultScene(scene);
   // Each independent GLB brings its own buffer. GLB output permits only one.
   await doc.transform(unpartition());
   doc.getRoot().getAsset().copyright=report.sources.map(s=>`Photo © ${s.author}, ${s.license}, ${s.url}`).join('; ')+`; PLATEAU / Tokyo 2025; SNAP ${report.snapCommit}; experimental reprojection`;
   await io.write('public'+report.model,doc);
  }
  await writeFile(`${base}/${report.areaId}-snap.json`,JSON.stringify(report,null,2));
  console.log({areaId:report.areaId,buildings:report.projectedBuildings,model:report.model});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
