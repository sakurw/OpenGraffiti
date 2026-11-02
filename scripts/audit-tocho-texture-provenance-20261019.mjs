// Read-only provenance audit. Writes only the two reports named below.
// Run from any directory: .tools/node-v24.20.0-win-x64/node.exe scripts/audit-tocho-texture-provenance-20261019.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scopePath='public/assets/tocho-twelve-blocks-20261019/scope.json';
const profilePath='public/assets/tocho-district-photo-v3-20261018/photo-profiles.json';
const atlasPath='public/assets/plateau-official-shinjuku-2025/own-only/texture-overrides.json';
const viewerPath='scripts/tocho-nine-blocks-own-viewer-20261018.js';
const out='public/assets/tocho-twelve-blocks-20261019/texture-provenance.json';
const human='data/texture-city/tocho-twelve-blocks-20261019/texture-provenance-report.md';
const v2='data/texture-city/tocho-district-photo-v2-20261018';
const v3='data/texture-city/tocho-district-photo-v3-20261018';
const files=new Map(),issues=[],texts=new Map();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const normalize=p=>{p=p.replaceAll('\\','/');if(p.startsWith('/assets/'))p='public'+p;return path.isAbsolute(p)?path.relative(root,p).replaceAll('\\','/'):p;};
async function evidence(p,expected=null,role='input'){
 if(!p)return null;p=normalize(p);let f=files.get(p);
 if(!f){try{const b=await fs.readFile(path.resolve(root,p));f={path:p,exists:true,bytes:b.length,sha256:sha(b)};}catch(e){if(e.code!=='ENOENT')throw e;f={path:p,exists:false,bytes:null,sha256:null};}files.set(p,f);}
 const r={...f,role,expectedSha256:expected,hashMatches:expected?f.sha256===expected:null};
 if(!f.exists||r.hashMatches===false)issues.push({path:p,role,problem:!f.exists?'missing':'hash-mismatch',expected,actual:f.sha256});return r;
}
async function json(p){await evidence(p,null,'manifest');return JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));}
async function textFile(p){p=normalize(p);if(!texts.has(p))texts.set(p,await fs.readFile(path.resolve(root,p),'utf8'));return texts.get(p);}
async function glb(p,expected){const file=await evidence(p,expected,'texture donor GLB');const b=await fs.readFile(path.resolve(root,p));assert.equal(b.toString('ascii',0,4),'glTF');return {file,g:JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString())};}
const scope=await json(scopePath),profiles=await json(profilePath),atlas=await json(atlasPath);
assert.equal(scope.selectedBuildingIds.length,127);assert.equal(new Set(scope.selectedBuildingIds).size,127);
const viewer=await textFile(viewerPath);await evidence(viewerPath,null,'actual renderer');
// Fail closed if the renderer's routing changes; this audit describes this renderer only.
for(const token of ['own-only/texture-overrides.json','tocho-district-photo-v3-20261018/photo-profiles.json','palette[hash(id)%palette.length]','ownEntry?.images.length===1','ownBase=mix(ownBase,ownArt.rgb,ownArt.a)','o.material=m'])assert(viewer.includes(token),'Renderer changed: '+token);
const native=await json(v2+'/native-photo-sources.json');
const landmarks=await json(v2+'/landmark-sources.json'),park=await json(v2+'/park-sources.json');
const jobs=await json(v2+'/art-jobs.json'),generated=await json(v2+'/generated-results.json');
const remaining=await json(v3+'/remaining-generation-provenance.json');
const build=await json(v3+'/build-report.json');
const district=await glb('public/assets/tocho-district-photo-v3-20261018/district.glb',build.sha256);
const central=await glb(profiles.centralAsset.path,profiles.centralAsset.sha256);
const centralGen=await json('data/texture-city/tocho-whole-illustrated-20261018/generation.json');
const wallGen=await json('data/texture-city/tocho-wall-hour-20261018/generation.json');
const centralSources=await json('data/texture-city/tocho-whole-illustrated-20261018/source-assets.json');
const scripts=['assemble-tocho-district-photo-profiles-20261018.mjs','enrich-tocho-photo-profiles-20261018.mjs','fit-tocho-single-storey-photo-art-20261018.mjs','assemble-tocho-district-photo-v3-20261018.mjs','build-tocho-district-photo-v3-20261018.mjs','build-tocho-own-only-atlases-20261018.mjs','prepare-tocho-whole-illustrated-20261018.mjs','build-tocho-whole-illustrated-20261018.mjs','refine-tocho-whole-illustrated-overlays-20261018.mjs','tocho-wall-hour-bake-20261018.mjs'];
scripts.push('normalize-tocho-photo-modules-20261018.mjs','integrate-tocho-shrine-photo-art-20261018.mjs');
const generators=[];for(const s of scripts)generators.push(await evidence('scripts/'+s,null,'generation code'));
// Index actual photo records by local file, not evidenceStatus or filename guesses.
const photoRecords=[...landmarks.photos,...park.photos,...profiles.buildings.flatMap(p=>p.sourcePhotoDetails??[])];
const photoIndex=new Map();
for(const p of photoRecords){const local=p.localPath??p.path;if(local)photoIndex.set(normalize(local),p);}
const nativeIndex=new Map(native.buildings.flatMap(b=>b.walls.map(w=>[normalize(w.file),{...w,owner:b.buildingId}])));
const sourceImages=new Map(native.sourceImages.map(i=>[normalize(i.file),i]));
const originalGML=new Map(native.originalGML.map(i=>[normalize(i.file),i]));
const tileset=await json('public/assets/tocho-twelve-blocks-20261019/buildings-tileset.json');
const tileURLs=new Map();function walk(t){if(t.content?.uri)tileURLs.set(path.basename(t.content.uri),t.content.uri);for(const c of t.children??[])walk(c);}walk(tileset.root);
const tileEvidence={};
for(const [name,t] of Object.entries(scope.tiles)){
 const a=atlas.tiles[name],url=tileURLs.get(name);assert(url,'No tileset content for '+name);
 const source=await evidence(url,a?.sourceSha256??null,'native geometry/UV B3DM, never photo input to fallback');
 const images=[];for(const i of a?.images??[])images.push({imageIndex:i.imageIndex,primary:await evidence(i.url,i.sha256,'own-only atlas selected by viewer'),mask:await evidence(i.maskUrl,i.maskSha256,'donor mask'),padded:await evidence(i.paddedUrl,i.paddedSha256,'unused padded alternative'),donorTexels:i.donorTexels,transparentTexels:i.transparentTexels});
 tileEvidence[name]={source,viewerLoadsOwnAtlas:!!a&&a.images.length===1,buildingIds:t.buildingIds,donorBuildingIds:a?.buildingIds??[],images};
}
const palette=[[188,185,169],[173,179,172],[192,177,157],[165,175,180],[184,177,168],[176,185,178]];
function hashId(id){let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
async function photoSource(p,id,chain){
 const name=typeof p==='string'?p:p.path,local=normalize(name),w=nativeIndex.get(local),meta=photoIndex.get(local);
 const expected=(typeof p==='object'?p.sha256:null)??chain.find(c=>normalize(c.path)===local)?.sha256??meta?.sha256??null;
 const f=await evidence(local,expected,'generation photograph input');
 if(w){
  const im=sourceImages.get(normalize(w.sourceImagePath)),gm=originalGML.get(normalize(w.sourceGML));
  const source=await evidence(w.sourceImagePath,w.sourceImageSha256,'original PLATEAU aerial-derived atlas image');
  const gml=await evidence(w.sourceGML,gm?.sha256,'original CityGML');
  const xml=await textFile(w.sourceGML),start=xml.indexOf('gml:id="'+id+'"'),end=xml.indexOf('</bldg:Building>',start);
  const ownerBlock=start>=0?xml.slice(start,end):'';
  const polygonOwned=ownerBlock.includes('gml:id="'+w.sourceGMLPolygon+'"');
  const target=xml.indexOf('uri="#'+w.sourceGMLPolygon+'"');
  const appStart=xml.lastIndexOf('<app:ParameterizedTexture',target),appEnd=xml.indexOf('</app:ParameterizedTexture>',target);
  const app=target>=0?xml.slice(appStart,appEnd):'';
  const imageLinked=app.includes(w.sourceImageURI);
  const uvVerified=Object.entries(w.nativeUV??{}).every(([ring,uv])=>{const m=app.match(new RegExp('<app:textureCoordinates[^>]*ring="[#]?'+ring+'"[^>]*>([^<]+)'));return m&&m[1].trim().split(/\s+/).map(Number).length===uv.length&&m[1].trim().split(/\s+/).map(Number).every((n,i)=>Math.abs(n-uv[i])<1e-9);});
  if(w.owner!==id||!polygonOwned||!imageLinked||!uvVerified)issues.push({path:local,problem:'native-identity-or-UV-link-failed',id});
  return {kind:'native-PLATEAU-aerial-photo',file:f,original:source,cityGML:gml,sourceURLs:[im?.archiveURL??gm?.archiveURL].filter(Boolean),archiveEntry:im?.archiveEntry??null,buildingId:w.owner,polygonId:w.sourceGMLPolygon,nativeUV:w.nativeUV,effectiveUVpixels:w.effectiveUVpixels,identityChecks:{sameBuilding:w.owner===id,polygonOwned,imageLinked,uvVerified},limits:'Original mapped pixels may show trees, roof, shadow or background; aerial atlas assignment does not certify visible facade details.'};
 }
 if(meta){const originalPath=meta.localOriginalPath;return {kind:'street-photo',file:f,original:originalPath?await evidence(originalPath,meta.localOriginalSha256,'cached original street photograph'):null,sourceURLs:[meta.pageURL,meta.pageUrl,meta.sourcePage,meta.originalURL,meta.originalUrl,meta.pageURL,meta.downloadURL].filter((u,i,a)=>u&&a.indexOf(u)===i),author:meta.author??null,license:meta.license??null,mappedBuildingIds:meta.buildingIds??null,mappingEvidence:meta.mappingEvidence??null,limits:'Recorded identity/visual observation; no camera pose or per-face registration was certified.'};}
 return {kind:'unresolved-input',file:f,sourceURLs:[],limits:'Not found in photograph inventories; existence alone does not establish real photograph provenance.'};
}
const labels={street_photo:'街路実写真からの生成',native_plateau_photo_pattern:'PLATEAU航空写真由来の模様生成',same_building_photo_inference:'同一建物の追加実写真からの推測',source_limited_pattern:'資料不足の同一建物画像からのパターン生成',central_mixed_photo_and_inference:'都庁第一：実写真・PLATEAU・推測・手続き生成の混用',hash_palette_procedural:'個別写真なし・IDハッシュ配色と手続きシェーダー',unresolved:'写真出典未解決'};
const rows=[];
for(const id of scope.selectedBuildingIds){
 const b=scope.buildings[id],p=profiles.buildings.find(p=>p.buildingId===id),isCentral=id===scope.centralBuildingId;
 const row={buildingId:id,name:p?.name||b.name||null,displayName:p?.name||b.name||'名称未記録',blockId:b.blockId,category:null,recordedEvidenceStatus:p?.evidenceStatus??null,photoCoverageCertified:false,sourceURLs:[],sources:[],outputLinks:[],claimLimits:[],viewer:{tiles:b.tiles,profilePresent:!!p,hash:hashId(id),baseColor:p?.baseColor??palette[hashId(id)%palette.length],fallbackFloorHeight:p?.floorHeight??3.5,fallbackBayWidth:p?.bayWidth??3,alwaysProceduralUnderlay:true,originalPhotoMaterialReplaced:true}};
 row.viewer.tileLinks=b.tiles.map(name=>({tile:name,viewerLoadsOwnAtlas:tileEvidence[name].viewerLoadsOwnAtlas,donorCoverageRecorded:tileEvidence[name].donorBuildingIds.includes(id)}));
 if(!p){row.category='hash_palette_procedural';row.claimLimits.push('No individual photograph or generated building artwork is consumed. Palette chosen by FNV-like building-ID hash; generic window and seam shader uses geometry. Original tile photos exist as model data but are discarded by this viewer.');}
 else if(isCentral){
  row.category='central_mixed_photo_and_inference';
  row.sources.push({kind:'prior-mixed-photo-model',file:await evidence('public/assets/tocho-landmark/tocho-landmark-balanced-edges-v106-candidate-20261014.glb'),sourceURLs:[],limits:'Actual input to whole-building crop extraction and one-wall photographic bake; original photo registration not re-certified.'});
  row.sources.push({kind:'street-photo-generation-record',file:await evidence('data/texture-city/tocho-wall-hour-20261018/wall-photo-rectified.png',null,'rectified street photograph patch'),sourceURLs:[wallGen.sourcePhoto.page],metadata:wallGen.sourcePhoto,limits:wallGen.caveat});
  row.outputLinks.push({stage:'one-wall artwork',file:await evidence(wallGen.projectTexture),generatedOriginal:await evidence(wallGen.generatedOriginal),method:wallGen.method});
  for(const s of centralSources)row.sources.push({kind:s.name.startsWith('photo-')?'street-photo-extracted-from-prior-GLB':'native-atlas-or-material-extracted-from-prior-GLB',file:await evidence(s.file),sourceURLs:[],sourcePrimitives:s.ids,limits:'Crop extracted by prepare script from v106 GLB; no independent original-photo hash supplied in this record.'});
  for(const g of centralGen.outputs)row.outputLinks.push({stage:'whole-building artwork',file:await evidence('public/assets/tocho-landmark/whole-illustrated-20261018/'+g.name),generatedOriginal:await evidence(g.generatedOriginal),source:g.source,finalUse:g.finalUse??null});
  row.outputLinks.push({stage:'approved central donor',file:central.file});
  row.claimLimits.push(centralGen.inference,centralGen.notCertified,'native-atlas-illustrated.png was rejected for native wall faces; whole-building generator uses finite approved-art extension and procedural stone/equipment/roof materials. A generated surface is not necessarily a directly photographed surface.','Central historical source-photo lineage is partial: v106 extracted crops are available, but this audit does not independently re-prove all original source-photo-to-v106 mappings.');
 }else{
  const mats=district.g.materials.filter(m=>m.extras?.buildingId===id&&m.extras?.artworkSha256);
  const chain=mats.flatMap(m=>m.extras.sourceChain??[]);
  for(const src of p.sourcePaths??[])row.sources.push(await photoSource(src,id,chain));
  const allNative=row.sources.length>0&&row.sources.every(s=>s.kind==='native-PLATEAU-aerial-photo');
  const allStreet=row.sources.length>0&&row.sources.every(s=>s.kind==='street-photo');
  // Content/identity and the closed-face builder path determine inference class.
  row.category=p.featureOneFace&&allStreet?'same_building_photo_inference':p.facadeMode==='full-closed-face'&&allNative?'source_limited_pattern':allNative?'native_plateau_photo_pattern':allStreet?'street_photo':'unresolved';
  const artwork=await evidence('public/assets/tocho-district-photo-v3-20261018/'+p.artwork,p.artworkSha256,'selected building artwork');
  const record=remaining.results.find(r=>r.buildingId===id),oldResult=generated.find(r=>normalize(r.path)===normalize(p.generationSource??''));
  const origin=record?.selectedImage?.path??p.generationSource;
  let cropVerification=null;
  if(origin){
   const rect=p.moduleCrop?.rect??(p.moduleCrop?.width?Object.fromEntries(['left','top','width','height'].map(k=>[k,p.moduleCrop[k]])):null);
   const sourceFile=path.resolve(root,normalize(origin)),targetFile=path.resolve(root,artwork.path);
   const sourceImage=rect?sharp(sourceFile).extract(rect):sharp(sourceFile);
   const [a,z]=await Promise.all([sourceImage.ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(targetFile).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
   cropVerification={rect,method:rect?'replay recorded crop and compare decoded RGBA':'compare decoded RGBA',sourceCropSHA256:sha(a.data),artworkPixelsSHA256:sha(z.data),dimensionsMatch:a.info.width===z.info.width&&a.info.height===z.info.height,pixelsMatch:a.data.equals(z.data)};
   if(!cropVerification.dimensionsMatch||!cropVerification.pixelsMatch)issues.push({id,problem:'generation-to-artwork-pixel-link-failed'});
  }
  row.outputLinks.push({stage:'selected generated artwork',file:artwork,selectedGeneration:origin?await evidence(origin,record?.selectedImage?.sha256??null,'selected generation output'):null,selectedBytesMatch:origin?(await evidence(origin)).sha256===artwork.sha256:null,method:p.generationMethod??record?.generationMethod??'image generation recorded in baseline generated-results',prompt:record?.prompt??oldResult?.prompt??p.generationPrompt??null,job:jobs.find(j=>j.buildingId===id)??null});
  row.outputLinks.at(-1).cropVerification=cropVerification;
  const embedded=mats.map(m=>({name:m.name,artworkSha256:m.extras.artworkSha256,matchesCurrentArtwork:m.extras.artworkSha256===artwork.sha256,sourceChain:m.extras.sourceChain,textureIndex:m.pbrMetallicRoughness?.baseColorTexture?.index,artworkMapping:m.extras.artworkMapping}));
  const nodes=district.g.nodes.filter(n=>n.extras?.buildingId===id);
  row.outputLinks.push({stage:'district donor GLB',file:district.file,nodeCount:nodes.length,embeddedMaterials:embedded,limits:'Embedded extras and build code link artwork to rasterized per-face atlases. Hashes bind saved bytes, not a replay of historical AI conditioning or pixel-perfect regeneration.'});
  if(!nodes.length||!embedded.length||embedded.some(m=>!m.matchesCurrentArtwork))issues.push({id,problem:'donor-artwork-link-failed'});
  row.observed=p.observed;row.inferred=p.inferred;row.identityEvidence=p.identityEvidence??null;
  row.nativeResolutionQuality=p.nativeResolutionQuality??null;
  if(p.roofEvidence){row.roofEvidence={photo:await evidence(p.roofEvidence.photo?.path,p.roofEvidence.photo?.sha256,'roof evidence'),original:await evidence(p.roofEvidence.source?.localPath,p.roofEvidence.source?.sha256,'roof original'),appliedAppearanceColor:p.roofColor??null,roofColorUsable:p.roofEvidence.review?.roofColorUsable??false,limits:'Roof evidence is separate; it does not establish facade openings or physical material. Code-generated roof joints remain inferred.'};}
  row.claimLimits.push(p.inferenceLimitations??p.inferred,'Unseen elevations, placement and scale remain inferred. Generated wall artwork is extended to eligible faces; roofs, equipment, caps and fallback shader include code-generated surfaces. No complete-building registered-photography certificate.');
 }
 row.sourceURLs=[...new Set(row.sources.flatMap(s=>s.sourceURLs))];
 row.outputLinks.push({stage:'current own-only atlas rendering',tiles:row.viewer.tileLinks,buildingSampleRecord:atlas.buildings[id]??null,limits:'Tile-level saved manifest records donor hits. Current selected leaf tiles alone determine availability; transparent atlas texels use shader fallback. Donor hit counts are not photo-coverage measurements. This audit does not rerasterize donor projection or measure visible surface coverage.'});
 if(p?.evidenceStatus==='street-photo'&&row.category==='native_plateau_photo_pattern')row.claimLimits.push('Recorded street-photo status is misleading: actual generation input is a PLATEAU native wall crop, not a street photograph.');
 rows.push(row);
}
const counts=Object.fromEntries(Object.keys(labels).map(k=>[k,rows.filter(r=>r.category===k).length]));
const uniqueIssues=[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()];
const report={schemaVersion:1,generatedAt:new Date().toISOString(),scopePath,profilePath,atlasPath,viewerPath,question:'Is EACH current building texture generated from real photographs?',answer:'No. 44 additions have no individual photograph input; photo-conditioned buildings also include unobserved and procedural surfaces.',categoryDefinitions:labels,counts,buildingCount:rows.length,all127PhotographGenerated:false,fullBuildingPhotoCoverageCertified:0,integrityIssues:uniqueIssues,summary:{profileBuildings:rows.filter(r=>r.viewer.profilePresent).length,noProfileBuildings:rows.filter(r=>!r.viewer.profilePresent).length,uniqueFilesChecked:files.size,missingFiles:[...files.values()].filter(f=>!f.exists).length,hashMismatches:uniqueIssues.filter(i=>i.problem==='hash-mismatch').length,statusLabelCorrections:rows.filter(r=>r.recordedEvidenceStatus==='street-photo'&&r.category!=='street_photo').map(r=>r.buildingId)},auditLimits:['Offline audit of existing local files and recorded source URLs; URLs were not fetched and no new photographs were collected.','SHA-256 compared to historical hashes when available; otherwise the report records a current digest, explicitly hashMatches=null. Current hash alone cannot establish historical AI input use.','Native polygon ownership, image assignment and numeric UVs are checked against current CityGML; extraction pixels and AI calls are not replayed.','PLATEAU source images are aerial-derived native texture evidence; camera capture modality is not independently recoverable from these JPEG files alone.','The atlas generator reads native image dimensions but never decodes native image pixels for donor artwork. sourcePhotoPixelsCopied=0 means no direct native-pixel copy at that stage, not no photographic ancestry.','Viewer sourcePhotoMaterials=0 measures replaced materials, not whether generated artwork was photograph-conditioned.','Source URLs, attribution and license metadata are recorded evidence, not a new legal/license determination.','No live browser/render or side-by-side acceptance is claimed by this provenance audit.'],generators,tileEvidence,buildings:rows,files:[...files.values()]};
await fs.mkdir(path.dirname(path.resolve(root,out)),{recursive:true});await fs.mkdir(path.dirname(path.resolve(root,human)),{recursive:true});
await fs.writeFile(path.resolve(root,out),JSON.stringify(report,null,2)+'\n');
const esc=s=>String(s??'—').replaceAll('|','\\|').replaceAll('\n',' ');
const lines=['# 現在127棟のテクスチャ出典監査','',`生成日時: ${report.generatedAt}`,'','**全127棟が実写真から生成された、とは言えません。追加44棟は個別写真なしのIDハッシュ配色・手続きシェーダーです。83棟も全面の写真再現を意味しません。**','',`対象: \`${scopePath}\`。実際の表示コード: \`${viewerPath}\`。`, '', '| 実入力と生成経路による分類 | 棟数 |','|---|---:|',...Object.entries(counts).map(([k,n])=>`| ${labels[k]} (${k}) | ${n} |`),'','## 検証方法と結論の限界','',...report.auditLimits.map(s=>'- '+s),'','写真 → 生成画像 → 建物別 artwork → district/central donor GLB → native UV の own-only atlas → 現在の viewer という経路を追跡。83棟の背景にも手続きシェーダーがあり、透明アトラス領域はそのシェーダーになります。44棟は同じタイルにアトラスがあっても、その建物への donor hit がなければ写真由来とは数えません。','',`ファイル確認 ${files.size}件 / 不在 ${report.summary.missingFiles}件 / 既存SHA不一致 ${report.summary.hashMismatches}件 / その他を含む指摘 ${uniqueIssues.length}件。完全な建物写真カバレッジ認証は0棟。`,'', '## 全棟一覧','', '| 建物ID | 名称（未記録は明記） | 街区 | 分類 | 記録ラベル |','|---|---|---|---|---|',...rows.map(r=>`| ${r.buildingId} | ${esc(r.displayName)} | ${esc(r.blockId)} | ${labels[r.category]} | ${esc(r.recordedEvidenceStatus)} |`),'','## 建物別証拠',''];
for(const r of rows){lines.push(`### ${r.displayName} / ${r.buildingId}`,'',`分類: ${labels[r.category]}。記録ラベル: ${r.recordedEvidenceStatus??'なし'}。`,'');for(const s of r.sources){lines.push(`- 入力種別: ${s.kind}; URL: ${s.sourceURLs.join(' , ')||'未記録'}`);for(const f of [s.file,s.original,s.cityGML].filter(Boolean))lines.push(`  - \`${f.path}\`: exists=${f.exists}; SHA-256=${f.sha256??'なし'}; historicalHashMatch=${f.hashMatches??'比較元なし'}`);if(s.identityChecks)lines.push('  - CityGML照合: '+JSON.stringify(s.identityChecks));}for(const l of r.outputLinks){if(l.file)lines.push(`- 出力 ${l.stage}: \`${l.file.path}\`; exists=${l.file.exists}; SHA-256=${l.file.sha256}; historicalHashMatch=${l.file.hashMatches??'比較元なし'}`);if(l.selectedGeneration)lines.push(`  - 選択生成元 \`${l.selectedGeneration.path}\`; exists=${l.selectedGeneration.exists}; SHA-256=${l.selectedGeneration.sha256}; selectedBytesMatch=${l.selectedBytesMatch}`);}lines.push('- 表示タイル: '+r.viewer.tileLinks.map(t=>`${t.tile} (atlas=${t.viewerLoadsOwnAtlas}, donor=${t.donorCoverageRecorded})`).join(', '));if(!r.viewer.profilePresent)lines.push(`- 写真入力なし。hash=${r.viewer.hash}; baseColor=${JSON.stringify(r.viewer.baseColor)}; floorHeight=${r.viewer.fallbackFloorHeight}; bayWidth=${r.viewer.fallbackBayWidth}`);for(const lim of r.claimLimits)lines.push('- 限界: '+lim);lines.push('');}
lines.push('## 整合性指摘','',...(uniqueIssues.length?uniqueIssues.map(i=>'- '+JSON.stringify(i)):['なし。存在とハッシュ整合性は写真再現の認証ではありません。']),'','全ファイルの SHA-256、屋根証拠、GLB material extras、タイル別 atlas/mask の照合結果は機械可読の texture-provenance.json に収録。','', '再実行: `.tools/node-v24.20.0-win-x64/node.exe scripts/audit-tocho-texture-provenance-20261019.mjs`。`--strict` は整合性指摘がある場合に終了コード1。');
await fs.writeFile(path.resolve(root,human),lines.join('\n')+'\n');
console.log(JSON.stringify({counts,summary:report.summary,integrityIssueCount:uniqueIssues.length,outputs:[out,human]},null,2));
if(process.argv.includes('--strict')&&uniqueIssues.length)process.exitCode=1;
