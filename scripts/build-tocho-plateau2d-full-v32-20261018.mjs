/**
 * v32: retain the whole-building v31 UVs, facades and semantic ownership.
 * Reduce repetitive black seams in architectural infill (not window walls),
 * and repair metadata on secondary materials sharing an image.
 * Original v30/v31 GLBs and their reports are immutable.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

const root=path.resolve('data/texture-city/tocho-style-pilot-20261015');
const base=path.resolve('public/assets/tocho-landmark');
const source=path.join(base,'tocho-stylized-full-pixel-v31-20261018.glb');
const output=path.join(base,'tocho-stylized-full-pixel-v32-20261018.glb');
const manifestPath=path.join(root,'full-v32-style-20261018.json');
const pageSource=path.resolve('public/tocho-stylized-full-compare-v31-20261018.html');
const pageOut=path.resolve('public/tocho-stylized-full-compare-v32-20261018.html');
const EXPECT='55f317b981dc55bd70b13baad9fd7358836b2b114595a29a3e6dd7c66dc490a9';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(sha(fs.readFileSync(source))!==EXPECT)throw Error('Protected v31 SHA256 changed');
// A previous attempt may have written the binary before HTML preflight failed.
// Resume only when the sidecars are absent, and verify the exact rebuilt bytes.
for(const p of [manifestPath,pageOut])if(fs.existsSync(p))throw Error('Refusing overwrite: '+p);
const v31=JSON.parse(fs.readFileSync(path.join(root,'full-v31-style-20261018.json'),'utf8'));
const C=v31.palette;
const groups=new Map();
for(const g of v31.textureChanges)for(const id of g.ids){
  if(groups.has(id))throw Error('Duplicate primitive '+id);
  groups.set(id,g);
}
if(groups.size!==51)throw Error('v31 manifest lacks complete 51-piece scope');
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(source),parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
if(parts.length!==51||parts.reduce((n,p)=>n+p.getIndices().getCount()/3,0)!==298489)
  throw Error('Source geometry/topology changed');
const converted=new Map(),records=[],fixedMaterialIDs=[],retouchedPrimitiveIDs=[],retouchedMetadataIDs=[];
for(let id=0;id<parts.length;id++){
  const prim=parts[id],role=prim.getExtras()?.semantic,mat=prim.getMaterial();
  const tex=mat?.getBaseColorTexture(),g=groups.get(id);
  if(!tex?.getImage()||!g||role!==g.role)throw Error('Missing source, group or semantic '+id);
  const old=tex.getImage(),oldMeta=mat.getExtras()||{};
  const change=role==='cartoon-architectural-wall';
  const method=change?'flat-masonry-reduced-panel-seams':g.method;
  if(!converted.has(tex)){
    const info=await sharp(old).metadata();
    let next=old;
    let affectedPixels=0;
    if(change){
      if(info.width!==64||info.height!==72)throw Error('Unexpected architectural atlas '+id);
      const raw=await sharp(old).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
        if(x>=2&&x<62)continue;
        const i=(y*info.width+x)*4;
        if(raw.data[i]!==C.outline[0]||raw.data[i+1]!==C.outline[1]||raw.data[i+2]!==C.outline[2])
          throw Error(`Non-outline edge pixel in architectural material ${id} (${x},${y})`);
        raw.data[i]=C.shadow[0];raw.data[i+1]=C.shadow[1];raw.data[i+2]=C.shadow[2];
        affectedPixels++;
      }
      next=await sharp(raw.data,{raw:raw.info}).png().toBuffer();
      tex.setImage(next).setMimeType('image/png').setName('v32 architectural infill, subdued panel edge');
    }
    converted.set(tex,{role,method,sourceSHA256:sha(old),resultSHA256:sha(next),width:info.width,height:info.height,ids:[],affectedPixels});
    records.push(converted.get(tex));
  }
  const r=converted.get(tex);
  if(r.role!==role||r.method!==method)throw Error('Shared cross-semantic texture '+id);
  r.ids.push(id);
  if(change)retouchedPrimitiveIDs.push(id);
  // Update all materials even when the underlying image has already been processed.
  const nextMeta={...oldMeta,windowAllowed:role==='wall'||role==='cartoon-window-wall',
    styleSource:'PLATEAU-2D 2025 flat-color interpretation, Tocho 3D original pixel art',
    styleMethod:method,humanAppearanceApproval:false};
  // Distinguish repaired stale metadata from the intentional v32 method rename.
  if(oldMeta.styleMethod!==method){
    if(change)retouchedMetadataIDs.push(id);
    else fixedMaterialIDs.push(id);
  }
  mat.setExtras(nextMeta).setName('v32 '+role+' '+method);
}
if(records.length!==21||retouchedPrimitiveIDs.length!==19||
   fixedMaterialIDs.join(',')!=='19,21,23,25'||
   retouchedMetadataIDs.join(',')!=='26,27,28')
  throw Error(`Unexpected change coverage: texture groups=${records.length} retouched=${retouchedPrimitiveIDs.length} metadata=${fixedMaterialIDs} intentionalMetadata=${retouchedMetadataIDs}`);
const encoded=Buffer.from(await io.writeBinary(doc));
const saved=sha(encoded);
if(fs.existsSync(output)){
  if(sha(fs.readFileSync(output))!==saved)throw Error('Partial v32 binary differs from verified rebuild');
}else fs.writeFileSync(output,encoded);
let page=fs.readFileSync(pageSource,'utf8');
const once=(before,after)=>{
  const i=page.indexOf(before);
  if(i<0||page.indexOf(before,i+before.length)>=0)throw Error('Page anchor mismatch: '+before);
  page=page.slice(0,i)+after+page.slice(i+before.length);
};
once('<a href="?model=v31" data-model="v31">v31 全体・屋上ドット絵化</a>',
  '<a href="?model=v31" data-model="v31">v31 全体・屋上ドット絵化</a><a href="?model=v32" data-model="v32">v32 端部線整理・共有材修正</a>');
once("modelByKey.v31='/assets/tocho-landmark/tocho-stylized-full-pixel-v31-20261018.glb';",
  "modelByKey.v31='/assets/tocho-landmark/tocho-stylized-full-pixel-v31-20261018.glb';modelByKey.v32='/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb';");
once("Object.hasOwn(modelByKey,requested)?requested:'v31'", "Object.hasOwn(modelByKey,requested)?requested:'v32'");
once('PLATEAU-2D風 全体候補 v31</h2>', 'PLATEAU-2D風 全体候補 v32</h2>');
once('tocho-stylized-full-compare-v31-20261018.html\'+location.search',
     'tocho-stylized-full-compare-v32-20261018.html\'+location.search');
// Multiple lighting properties share the same condition, so replace all.
if(!page.includes("['v30','v31'].includes(state.version)"))throw Error('Lighting preflight mismatch');
page=page.replaceAll("['v30','v31'].includes(state.version)","['v30','v31','v32'].includes(state.version)");
fs.writeFileSync(pageOut,page);
const manifest={version:'v32',createdAt:new Date().toISOString(),source,sourceSHA256:EXPECT,
  output,outputSHA256:saved,reviewPath:pageOut,primitiveCount:51,triangleCount:298489,
  palette:C,textureChanges:records,retouchedPrimitiveIDs,fixedMaterialIDs,retouchedMetadataIDs,
  purpose:'Architectural panel edge density adjustment; fix 4 image-sharing materials; no windows/roof/geometry/UV changes.',
  independentAuditStatus:'pending',humanAppearanceApproval:false};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({version:'v32',output,hash:saved,retouchedPrimitiveIDs,fixedMaterialIDs,changedTextures:records.filter(r=>r.sourceSHA256!==r.resultSHA256).length,reviewPath:pageOut}));
