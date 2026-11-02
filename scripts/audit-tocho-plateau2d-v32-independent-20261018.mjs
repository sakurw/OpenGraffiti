/**
 * Independent v31 -> v32 audit. Does not call, import, or reuse the builder.
 * Enforces per-primitive semantic ownership and per-image pixel provenance.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root=path.resolve('data/texture-city/tocho-style-pilot-20261015');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'full-v32-style-20261018.json'),'utf8'));
const before=path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v31-20261018.glb');
const after=path.resolve('public/assets/tocho-landmark/tocho-stylized-full-pixel-v32-20261018.glb');
const out=path.join(root,'full-v32-v31-independent-audit.json');
if(fs.existsSync(out))throw Error('Refusing audit overwrite: '+out);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const issues=[];
const fail=(id,code,details)=>issues.push({id,code,details});
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
const eq=(a,b)=>Boolean(a&&b&&a.constructor===b.constructor&&a.length===b.length&&bytes(a).equals(bytes(b)));
const rgb=(d,i)=>[d[i],d[i+1],d[i+2]].join(',');
const c=manifest.palette;
const windowIDs=new Set([1,4,5,17,18,19,20,21,22,23,24,25]);
const architects=new Set(Array.from({length:19},(_,i)=>i+26));
const fixedTags=new Set([19,21,23,25]);
const renamedTags=new Set([26,27,28]);
const hashes={before:sha(fs.readFileSync(before)),after:sha(fs.readFileSync(after))};
if(hashes.before!==manifest.sourceSHA256||hashes.after!==manifest.outputSHA256)fail(-1,'binary-provenance',hashes);
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const [left,right]=await Promise.all([io.read(before),io.read(after)]);
const A=left.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const B=right.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const declared=new Map();
for(const texture of manifest.textureChanges)
  for(const id of texture.ids){
    if(declared.has(id))fail(id,'duplicate-manifest','Duplicate primitive');
    declared.set(id,texture);
  }
if(A.length!==51||B.length!==51||declared.size!==51||manifest.textureChanges.length!==21)
  fail(-1,'primitive-coverage',{before:A.length,after:B.length,declared:declared.size,images:manifest.textureChanges.length});
const uniqueImages=new Set(),windowImages=new Set(),checkedImages=new Set();
let triangleCount=0,pixelsInspected=0,modifiedPixels=0,windowSafePixels=0;
let repairedTagCount=0,architecturalTagCount=0,architecturalParts=0,windowPrimitiveCount=0;
for(let id=0;id<Math.min(A.length,B.length);id++){
  const a=A[id],b=B[id],expected=declared.get(id);
  const semantic=a.getExtras()?.semantic,afterSemantic=b.getExtras()?.semantic;
  if(JSON.stringify(a.getExtras())!==JSON.stringify(b.getExtras())||semantic!==afterSemantic||semantic!==expected?.role)
    fail(id,'semantic','Primitive extras or semantic differs');
  triangleCount+=(b.getIndices()?.getCount()||0)/3;
  if(!eq(a.getIndices()?.getArray(),b.getIndices()?.getArray()))fail(id,'indices','Geometry index buffer differs');
  for(const key of new Set([...a.listSemantics(),...b.listSemantics()]))
    if(!eq(a.getAttribute(key)?.getArray(),b.getAttribute(key)?.getArray()))fail(id,'geometry-attributes',key);
  const am=a.getMaterial(),bm=b.getMaterial(),ae=am.getExtras()||{},be=bm.getExtras()||{};
  if(!am||!bm) {fail(id,'material','Missing material');continue;}
  const allowed=windowIDs.has(id),architectural=architects.has(id);
  if(allowed!==(semantic==='wall'||semantic==='cartoon-window-wall')||be.windowAllowed!==allowed)
    fail(id,'window-ownership',{semantic,flag:be.windowAllowed});
  if(allowed)windowPrimitiveCount++;
  const oldMethod=ae.styleMethod,newMethod=be.styleMethod;
  const expectedMethod=architectural?'flat-masonry-reduced-panel-seams':expected?.method;
  if(newMethod!==expectedMethod)fail(id,'style-method',{expected:expectedMethod,actual:newMethod});
  if(oldMethod!==newMethod) {
    if(fixedTags.has(id)){repairedTagCount++;if(oldMethod===expectedMethod)fail(id,'stale-tag-not-repaired',oldMethod);}
    else if(renamedTags.has(id)){architecturalTagCount++;if(!architectural)fail(id,'architectural-tag-wrong-role',semantic);}
    else fail(id,'unplanned-metadata-change',{before:oldMethod,after:newMethod});
  }
  if(architectural)architecturalParts++;
  for(const getter of ['getBaseColorFactor','getEmissiveFactor','getMetallicFactor','getRoughnessFactor',
    'getAlphaMode','getAlphaCutoff','getDoubleSided'])
    if(JSON.stringify(am[getter]())!==JSON.stringify(bm[getter]()))fail(id,'material-property',getter);
  const ta=am.getBaseColorTexture(),tb=bm.getBaseColorTexture();
  const ea=am.getBaseColorTextureInfo(),eb=bm.getBaseColorTextureInfo();
  for(const getter of ['getWrapS','getWrapT','getMinFilter','getMagFilter','getTexCoord'])
    if(ea[getter]()!=eb[getter]())fail(id,'sampler-difference',getter);
  if(eb.getMinFilter()!==9728||eb.getMagFilter()!==9728)fail(id,'sampler-nearest',{min:eb.getMinFilter(),mag:eb.getMagFilter()});
  if(allowed&&eb.getWrapS()!==(semantic==='wall'?10497:33071))fail(id,'window-edge-wrap',eb.getWrapS());
  const oldImage=ta?.getImage(),newImage=tb?.getImage();
  if(!oldImage||!newImage){fail(id,'missing-image','Missing source/destination');continue;}
  if(sha(oldImage)!==expected.sourceSHA256||sha(newImage)!==expected.resultSHA256)
    fail(id,'per-primitive-texture-hash','Image does not match manifest');
  uniqueImages.add(tb);
  if(allowed)windowImages.add(tb);
  if(checkedImages.has(tb))continue;
  checkedImages.add(tb);
  const X=await sharp(oldImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const Y=await sharp(newImage).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(X.info.width!==Y.info.width||X.info.height!==Y.info.height||
     Y.info.width!==expected.width||Y.info.height!==expected.height)
    fail(id,'dimensions',{old:X.info,new:Y.info,manifest:[expected.width,expected.height]});
  const {width,height}=Y.info; let ownChanged=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=4*(y*width+x);pixelsInspected++;
    if(Y.data[k+3]!==X.data[k+3])fail(id,'alpha-change',{x,y});
    if(X.data.subarray(k,k+4).equals(Y.data.subarray(k,k+4)))continue;
    ownChanged++;modifiedPixels++;
    // v32 may only soften the first/last 2 columns of masonry panels.
    if(!architectural||!(x<2||x>=width-2)||
       rgb(X.data,k)!==c.outline.join(',')||rgb(Y.data,k)!==c.shadow.join(','))
      fail(id,'unplanned-pixel-change',{x,y,old:rgb(X.data,k),new:rgb(Y.data,k)});
  }
  if(architectural&&ownChanged!==height*4)fail(id,'architectural-coverage',{changed:ownChanged,expected:height*4});
  if(!architectural&&ownChanged!==0)fail(id,'unexpected-texture-change',ownChanged);
  if(allowed){
    if(width%96||height!==(semantic==='wall'?1024:1152))fail(id,'window-dimensions',{width,height});
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4;
      if((x%96)<20||(x%96)>=76) {
        windowSafePixels++;
        if(rgb(Y.data,i)!==c.stone.join(','))fail(id,'window-guard',{x,y});
      }
      if(x>=96){
        const ref=(y*width+x%96)*4;
        if(!Y.data.subarray(i,i+4).equals(Y.data.subarray(ref,ref+4)))
          fail(id,'window-bay-phase',{x,y});
      }
    }
  }
}
const N=left.getRoot().listNodes(),M=right.getRoot().listNodes();
if(N.length!==M.length)fail(-1,'node-count',[N.length,M.length]);
for(let k=0;k<Math.min(N.length,M.length);k++)
  for(const g of ['getTranslation','getRotation','getScale','getExtras'])
    if(JSON.stringify(N[k][g]())!==JSON.stringify(M[k][g]()))
      fail(k,'node-transform',g);
if(triangleCount!==298489)fail(-1,'triangle-count',triangleCount);
if(windowPrimitiveCount!==12||windowImages.size!==6)fail(-1,'window-scope',{windowPrimitiveCount,atlasCount:windowImages.size});
if(architecturalParts!==19||repairedTagCount!==4||architecturalTagCount!==3)
  fail(-1,'metadata-coverage',{architecturalParts,repairedTagCount,architecturalTagCount});
if(uniqueImages.size!==21)fail(-1,'unique-textures',uniqueImages.size);
const result={at:new Date().toISOString(),from:before,to:after,hashes,pass:issues.length===0,
  triangleCount,primitiveCount:B.length,uniqueTextureCount:uniqueImages.size,
  windowPrimitiveCount,independentWindowTextureCount:windowImages.size,windowSafePixels,
  architecturalParts,repairedTagCount,architecturalTagCount,pixelsInspected,modifiedPixels,
  issues:issues.slice(0,120),issuesTotal:issues.length,
  limitation:'Pixel and semantic integrity checks do not certify screen-space corner occlusion or visual design.'};
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({pass:result.pass,triangleCount,windowPrimitiveCount,
  independentWindowTextureCount:windowImages.size,modifiedPixels,issuesTotal:issues.length,issues:result.issues.slice(0,10),report:out}));
if(!result.pass)process.exitCode=2;
