/**
 * Independent v30 -> v31 structural, semantic, image and sampler verification.
 * The recipe that generated v31 is not imported or called.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = path.resolve('data/texture-city/tocho-style-pilot-20261015');
const source = path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v30-20261017.glb');
const candidate = path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v31-20261018.glb');
const manifestPath = path.join(root, 'full-v31-style-20261018.json');
const auditPath = path.join(root, 'full-v31-whole-independent-audit.json');
const deltaPath = path.join(root, 'full-v31-v30-direct-delta-audit.json');
for (const output of [auditPath, deltaPath]) {
  if (fs.existsSync(output)) throw Error('Refusing to overwrite independent audit: ' + output);
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sourceHash = sha(fs.readFileSync(source));
const candidateHash = sha(fs.readFileSync(candidate));
if (sourceHash !== '1bbd72ae0e62dc4549affcf6ea8ea08cd586a3bd0080bf669a2d5a83f0218d92' ||
    candidateHash !== '55f317b981dc55bd70b13baad9fd7358836b2b114595a29a3e6dd7c66dc490a9') {
  throw Error('One of the protected model hashes has changed');
}
const errors = [], observations = [];
const fail = (id, kind, detail) => {
  if (errors.length < 120) errors.push({ id, kind, detail });
};
const equalBytes = (a,b) => a && b && a.constructor === b.constructor &&
  a.length === b.length &&
  Buffer.from(a.buffer, a.byteOffset, a.byteLength)
    .equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const rgb = (data,i) => data[i]+','+data[i+1]+','+data[i+2];
const rgbPalette = new Set(Object.values(manifest.palette).map(v => v.join(',')));
const stone = manifest.palette.stone.join(',');
const windowIDs = new Set([1,4,5,17,18,19,20,21,22,23,24,25]);
const glass = new Set(['glass','shine','sill','frame','frameLight'].map(v=>manifest.palette[v].join(',')));
const groupedIDs = new Map();
const dataFor = new Map();
for (const group of manifest.textureChanges) {
  for (const id of group.ids) {
    if (groupedIDs.has(id)) fail(id, 'manifest-duplicate', 'Multiple declared groups');
    groupedIDs.set(id, group);
  }
}
if (manifest.textureChanges.length !== 21) fail(-1,'groups','Expected 21 declared texture groups');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const [a,b] = await Promise.all([io.read(source),io.read(candidate)]);
const oldParts = a.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const newParts = b.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
if (oldParts.length!==51 || newParts.length!==51) fail(-1,'primitive-count',oldParts.length+'/'+newParts.length);
let triangles=0, guardedPixels=0, windowAtlasCount=0, imageChangedPrimitives=0;
let structureChanged=0, invalidSamplers=0, invalidOwners=0, helipadMismatch=0;
const seenTextures = new Map();
const windowsByRole = {wall:0,'cartoon-window-wall':0};
const helipadSourceToTarget = new Map([
  ['50,70,81','outline'],['169,186,178','shade'],['100,133,140','roofDeep'],
  ['229,214,171','warm'],['123,177,183','roof'],['145,194,196','sill'],
  ['73,123,135','frame'],['236,225,186','light']
]);
for (let id=0;id<Math.min(oldParts.length,newParts.length);id++) {
  const p=oldParts[id],q=newParts[id],r=p.getExtras()?.semantic,s=q.getExtras()?.semantic;
  const expectWindow=windowIDs.has(id), group=groupedIDs.get(id);
  if (!group || group.role!==r) fail(id,'role-manifest','Missing or unexpected group/semantic');
  if (r!==s || JSON.stringify(p.getExtras())!==JSON.stringify(q.getExtras())) {
    fail(id,'primitive-semantic','Semantic extras changed');structureChanged++;
  }
  triangles+=(q.getIndices()?.getCount()||0)/3;
  if (!equalBytes(p.getIndices()?.getArray(),q.getIndices()?.getArray())) {
    fail(id,'index-changed','Geometry indices changed');structureChanged++;
  }
  for (const semantic of new Set([...p.listSemantics(),...q.listSemantics()])) {
    if (!equalBytes(p.getAttribute(semantic)?.getArray(),q.getAttribute(semantic)?.getArray())) {
      fail(id,'attribute-changed',semantic);structureChanged++;
    }
  }
  const before=p.getMaterial(),after=q.getMaterial();
  const e0=before.getBaseColorTextureInfo(),e1=after.getBaseColorTextureInfo();
  for (const field of ['getWrapS','getWrapT','getMinFilter','getMagFilter','getTexCoord']) {
    if (e0[field]()!==e1[field]()) {fail(id,'sampler-delta',field);invalidSamplers++;}
  }
  if (e1.getMinFilter()!==9728 || e1.getMagFilter()!==9728) {
    fail(id,'non-nearest-filter','Sampling should be pixel-perfect');invalidSamplers++;
  }
  for (const field of ['getBaseColorFactor','getEmissiveFactor','getMetallicFactor',
    'getRoughnessFactor','getAlphaMode','getAlphaCutoff','getDoubleSided']) {
    if (JSON.stringify(before[field]())!==JSON.stringify(after[field]())) {
      fail(id,'material-property-delta',field);structureChanged++;
    }
  }
  if ((after.getExtras()?.windowAllowed===true)!==expectWindow ||
      (before.getExtras()?.windowAllowed===true)!==expectWindow ||
      expectWindow!==(r==='wall'||r==='cartoon-window-wall')) {
    fail(id,'window-ownership','Window flag or semantic inconsistent');invalidOwners++;
  }
  if (expectWindow && e1.getWrapS()!==(r==='wall'?10497:33071)) {
    fail(id,'window-wrap','Incorrect repetition/clamping');invalidSamplers++;
  }
  if (after.getExtras()?.styleMethod!==group?.method)
    fail(id,'method-tag','Unexpected v31 styleMethod');
  const oldImage=before.getBaseColorTexture()?.getImage();
  const newImage=after.getBaseColorTexture()?.getImage();
  if (!oldImage || !newImage) {fail(id,'missing-texture','One texture missing');continue;}
  if (sha(oldImage)!==group?.sourceSHA256 || sha(newImage)!==group?.resultSHA256)
    fail(id,'texture-hash','Source or output PNG differs from construction manifest');
  if (sha(oldImage)===sha(newImage)) fail(id,'not-converted','Expected changed image');
  else imageChangedPrimitives++;
  if (seenTextures.has(after.getBaseColorTexture())) {
    const prev=seenTextures.get(after.getBaseColorTexture());
    if (prev.role!==r) fail(id,'shared-cross-semantic','Image used by different classes');
    continue;
  }
  seenTextures.set(after.getBaseColorTexture(),{id,role:r});
  const A=await sharp(oldImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const B=await sharp(newImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width,height}=B.info;
  if (width!==A.info.width || height!==A.info.height ||
      width!==group?.width || height!==group?.height) {
    fail(id,'image-size','Texture dimensions changed or incorrect');continue;
  }
  let changedAlpha=0, paletteErrors=0, guardErrors=0, bayErrors=0, glassPixels=0, blockErrors=0;
  for (let i=0;i<B.data.length;i+=4) {
    if (A.data[i+3]!==B.data[i+3]) changedAlpha++;
    if (!rgbPalette.has(rgb(B.data,i))) paletteErrors++;
    if (expectWindow && glass.has(rgb(B.data,i))) glassPixels++;
    if (id===49) {
      const label=helipadSourceToTarget.get(rgb(A.data,i));
      if (!label || rgb(B.data,i)!==manifest.palette[label].join(',')) helipadMismatch++;
    }
  }
  if (changedAlpha) fail(id,'alpha-delta',changedAlpha+' alpha pixels modified');
  if (paletteErrors) fail(id,'palette',paletteErrors+' unknown-color pixels');
  if (expectWindow) {
    windowAtlasCount++;
    windowsByRole[r]++;
    if (width%96 || height!==(r==='wall'?1024:1152))
      fail(id,'window-dimension',width+'x'+height);
    for (let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=(y*width+x)*4, xx=x%96;
      if (xx<20||xx>=76) {
        guardedPixels++;
        if (rgb(B.data,i)!==stone) guardErrors++;
      }
      if (x>=96) {
        const ref=(y*width+xx)*4;
        if (!B.data.subarray(i,i+4).equals(B.data.subarray(ref,ref+4))) bayErrors++;
      }
    }
    if (!glassPixels||guardErrors||bayErrors)
      fail(id,'window-guards','glass='+glassPixels+',guard='+guardErrors+',repeat='+bayErrors);
  }
  if (id===45||id===50) {
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4, reference=((y-y%4)*width+x-x%4)*4;
      if (!B.data.subarray(i,i+4).equals(B.data.subarray(reference,reference+4))) blockErrors++;
    }
    if (blockErrors) fail(id,'roof-pixel-scale',blockErrors+' pixels not aligned to 4x4');
  }
  observations.push({id,role:r,width,height,changedAlpha,paletteErrors,guardErrors,bayErrors,
    glassPixels,blockErrors});
  dataFor.set(id,{width,height});
}
const na=a.getRoot().listNodes(),nb=b.getRoot().listNodes();
if (na.length!==nb.length) fail(-1,'nodes','Node count changed');
for(let id=0;id<Math.min(na.length,nb.length);id++)
  for(const field of ['getTranslation','getRotation','getScale','getExtras']) {
    if(JSON.stringify(na[id][field]())!==JSON.stringify(nb[id][field]())) {
      fail(id,'node-transform',field);structureChanged++;
    }
  }
if (groupedIDs.size!==51) fail(-1,'manifest-coverage',groupedIDs.size);
if (triangles!==298489) fail(-1,'triangle-count',triangles);
if (windowAtlasCount!==12) fail(-1,'window-image-count',windowAtlasCount);
if (helipadMismatch) fail(49,'helipad-symbol',helipadMismatch+' mapping pixels');
const common = {date:new Date().toISOString(),source,sourceSHA256:sourceHash,
  candidate,candidateSHA256:candidateHash,primitives:newParts.length,triangles,
  passed:errors.length===0,errors};
const audit={...common,kind:'independent-whole-building',
  windowPrimitiveIDs:[...windowIDs].sort((x,y)=>x-y),
  windowAtlasesChecked:windowAtlasCount,guardedPixels,
  prohibitedWindowOwnershipViolations:invalidOwners,
  samplerViolations:invalidSamplers,textureGroups:seenTextures.size,
  manifestGroups:manifest.textureChanges.length,helipadMismatch,
  roofPrimitiveIDs:[45,49,50],observations,
  limitation:'Raster validation alone does not certify visible screen-space corner overlaps or user aesthetic approval.'};
const delta={...common,kind:'direct-v30-v31-delta',
  attributeOrTransformChanges:structureChanged,changedTexturePrimitives:imageChangedPrimitives,
  unchangedGeometryUVAndNormals:structureChanged===0,
  unchangedAlphaMasks:!observations.some(o=>o.changedAlpha>0),
  roofNativeConverted:[45,49,50],uniqueTextureObjects:seenTextures.size,
  limitation:'Visible corner geometry ownership and 19 known near-UV mismatches require separate classification.'};
fs.writeFileSync(auditPath,JSON.stringify(audit,null,2));
fs.writeFileSync(deltaPath,JSON.stringify(delta,null,2));
console.log(JSON.stringify({passed:common.passed,primitives:newParts.length,triangles,
  windowAtlases:windowAtlasCount,textureGroups:seenTextures.size,guardedPixels,
  ownerViolations:invalidOwners,changedPrimitives:imageChangedPrimitives,
  geometryChanges:structureChanged,helipadMismatch,errors:errors.slice(0,15),
  auditPath,deltaPath}));
if (!common.passed) process.exitCode=2;
