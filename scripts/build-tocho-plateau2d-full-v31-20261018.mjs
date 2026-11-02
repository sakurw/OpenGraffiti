/**
 * Whole-building PLATEAU-2D-inspired reinterpretation of Tocho v30.
 * All textures are independently authored; original third-party artwork is not embedded.
 * The source mesh, UVs, physical window-run layout and semantic ownership remain immutable.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';

const base=path.resolve('public/assets/tocho-landmark');
const source=path.join(base,'tocho-stylized-full-pixel-v30-20261017.glb');
const output=path.join(base,'tocho-stylized-full-pixel-v31-20261018.glb');
const stylePath=path.resolve('data/texture-city/tocho-style-pilot-20261015/full-v31-style-20261018.json');
const reviewTemplate=path.resolve('public/tocho-stylized-full-compare-v30-20261017.html');
const reviewPath=path.resolve('public/tocho-stylized-full-compare-v31-20261018.html');
const EXPECTED='1bbd72ae0e62dc4549affcf6ea8ea08cd586a3bd0080bf669a2d5a83f0218d92';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
if(sha(fs.readFileSync(source))!==EXPECTED)throw Error('v30 protected source mismatch');
for(const file of [output,stylePath,reviewPath])if(fs.existsSync(file))throw Error(`Refusing to overwrite ${file}`);

let html=fs.readFileSync(reviewTemplate,'utf8');
function once(a,b){const n=html.indexOf(a);if(n<0||html.indexOf(a,n+a.length)>=0)throw Error('Viewer preflight failure '+a);html=html.slice(0,n)+b+html.slice(n+a.length);}
once('v30 配色・輪郭・窓の終端</a>','v30 配色・輪郭・窓の終端</a><a href="?model=v31" data-model="v31">v31 全体・屋上ドット絵化</a>');
once("modelByKey.v30='/assets/tocho-landmark/tocho-stylized-full-pixel-v30-20261017.glb';","modelByKey.v30='/assets/tocho-landmark/tocho-stylized-full-pixel-v30-20261017.glb';modelByKey.v31='/assets/tocho-landmark/tocho-stylized-full-pixel-v31-20261018.glb';");
once("Object.hasOwn(modelByKey,requested)?requested:'v30'","Object.hasOwn(modelByKey,requested)?requested:'v31'");
once('右：PLATEAU-2D風 全体候補 v30','右：PLATEAU-2D風 全体候補 v31');
once('http://127.0.0.1:3110/tocho-stylized-full-compare-v30-20261017.html','http://127.0.0.1:3110/tocho-stylized-full-compare-v31-20261018.html');
once("state.version==='v30'?1.00", "['v30','v31'].includes(state.version)?1.00");
once("state.version==='v30'?1.15", "['v30','v31'].includes(state.version)?1.15");
once("state.version==='v30'?.8", "['v30','v31'].includes(state.version)?.8");

// PLATEAU-2D's limited flat tones, blue window panes and crisp borders are
// interpreted for Tocho's actual gray stone and rooftop architecture.
const C={
  outline:[33,48,64], shadow:[70,92,110], joint:[139,158,164],
  shade:[174,189,194], stone:[198,207,207], light:[217,225,224],
  warm:[209,202,189], glass:[89,177,223], shine:[168,218,246],
  sill:[114,199,229], roof:[152,180,185],roofDeep:[93,132,147],
  frame:[38,100,155],frameLight:[72,148,196],
};
const V30={
  outline:[30,46,60],shadow:[65,88,107],joint:[106,129,141],
  shade:[140,161,169],stone:[169,185,189],light:[202,212,212],
  warm:[204,200,188],glass:[65,164,219],shine:[145,216,249],
  sill:[94,174,210],roof:[119,152,158],roofDeep:[70,108,126],
  frame:[36,89,134],frameLight:[83,136,166],
};
const rgb=x=>x.join(',');
const palette=new Map(Object.keys(V30).map(k=>[rgb(V30[k]),C[k]]));
// Primitive 49 has eight intentionally distinct helipad colors inherited
// from a native rooftop drawing. These are not erroneous facade pixels.
// Recolor by original symbol class so the H, ring, border and ground keep
// their exact raster silhouettes and no facade/windows touch the helipad.
const helipadPalette=new Map([
  ['50,70,81',C.outline],      // outermost border
  ['169,186,178',C.shade],    // pale curb
  ['100,133,140',C.roofDeep], // inset border
  ['229,214,171',C.warm],     // original H / rings
  ['123,177,183',C.roof],     // deck
  ['145,194,196',C.sill],    // deck highlights
  ['73,123,135',C.frame],    // ring shadow
  ['236,225,186',C.light],   // high-value marking
]);
const windows=new Set(['wall','cartoon-window-wall']);
const roofNative=new Set(['roof-native-28','roof-native-33']);
const guard=20;

// All physically complete bays retain 20px solid stone at either side.
// The simplified panes are full rectangles and terminate inside every bay;
// their horizontal bands are complete rows (never clipped by the cap).
function windowRGB(x,y,height){
  const min=34.63,max=height===1152?282.3:249.3;
  const actualY=max-y/(height-1)*(max-min),n=(actualY-min)/3.85;
  const floor=Math.floor(n),f=n-floor;
  if(x<guard||x>=96-guard||actualY<min+2||actualY>max-3)return C.stone;
  if([85.4,185.85,225.58,248.63].some(v=>Math.abs(actualY-v)<.30))return C.joint;
  if(x<23||x>=73)return C.light;
  if(f<.13||f>.88)return floor%3===0?C.joint:C.stone;
  if(x<27||x>=69||f<.23||f>.81)return C.frame;
  if(x<30||x>=66)return C.frameLight;
  if(x>=33&&x<38)return C.shine;
  if(x>=38&&x<41)return C.sill;
  return C.glass;
}
const windowCache=new Map();
async function windowTexture(height,bays){
  const key=`${height}:${bays}`;if(windowCache.has(key))return windowCache.get(key);
  const width=96*bays,bytes=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<96;x++){
    const c=windowRGB(x,y,height);
    for(let bay=0;bay<bays;bay++){
      const i=4*(y*width+bay*96+x);
      bytes[i]=c[0];bytes[i+1]=c[1];bytes[i+2]=c[2];bytes[i+3]=255;
    }
  }
  for(let y=0;y<height;y++)for(let bay=0;bay<bays;bay++)for(let x=0;x<guard;x++){
    for(const xx of [bay*96+x,bay*96+95-x]){
      const i=4*(y*width+xx);
      if(bytes[i]!==C.stone[0]||bytes[i+1]!==C.stone[1]||bytes[i+2]!==C.stone[2])throw Error('Window edge guard invalid');
    }
  }
  const out=await sharp(bytes,{raw:{width,height,channels:4}}).png().toBuffer();
  windowCache.set(key,out);return out;
}

// A photo-derived roof can only be regarded as a color/edge hint. Blur and
// downsample its structures, then convert all colors to independently
// authored masonry/shadow tiles. This explicitly eliminates photo detail.
async function roofSprite(bytes){
  const low=await sharp(bytes).ensureAlpha().blur(2.4).resize(64,64,{fit:'fill',kernel:'lanczos3'})
    .median(3).raw().toBuffer({resolveWithObject:true});
  const lum=[],alpha=[];
  for(let i=0;i<64*64;i++){
    const j=i*4;lum.push(.2126*low.data[j]+.7152*low.data[j+1]+.0722*low.data[j+2]);alpha.push(low.data[j+3]);
  }
  const samples=lum.filter((_,i)=>alpha[i]>100).sort((a,b)=>a-b);
  if(samples.length<500)throw Error('Roof native sample area unexpectedly small');
  const q=p=>samples[Math.min(samples.length-1,Math.floor((samples.length-1)*p))];
  const cuts=[q(.10),q(.25),q(.46),q(.70),q(.89)];
  const tones=[C.outline,C.shadow,C.roofDeep,C.joint,C.roof,C.light];
  const out=Buffer.alloc(64*64*4);
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){
    const k=y*64+x,v=lum[k],j=k*4;
    let tone=cuts.findIndex(c=>v<=c);if(tone<0)tone=5;
    // Draw only strong edges surviving spatial filtering; avoid random
    // 1-pixel speckles and window-like blue rectangles on the roof.
    if(x>0&&y>0&&Math.abs(v-lum[k-1])>32&&Math.abs(v-lum[k-64])>32)tone=Math.max(0,tone-1);
    const c=tones[tone];out[j]=c[0];out[j+1]=c[1];out[j+2]=c[2];out[j+3]=alpha[k]>=128?255:0;
  }
  return sharp(out,{raw:{width:64,height:64,channels:4}})
    .resize(256,256,{kernel:'nearest'}).png().toBuffer();
}

async function simplerArchitectural(bytes){
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==64||info.height!==72)throw Error('Unexpected architectural texture size');
  const out=Buffer.alloc(data.length);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=(y*info.width+x)*4;
    // Only existing architectural primitives receive this pattern.
    // Physical edges remain closed, with subdued mortar and broad fill.
    const c=x<2||x>=62?C.outline:x<5||x>=59?C.joint:
      y<2||y>=70?C.shade:x<11?C.shade:C.stone;
    out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=data[i+3];
  }
  return sharp(out,{raw:info}).png().toBuffer();
}

async function flatPalette(bytes,role){
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const out=Buffer.from(data);
  const unexpected=new Set();
  const usePalette=role==='roof-native-32'?helipadPalette:palette;
  for(let i=0;i<data.length;i+=4){
    const key=`${data[i]},${data[i+1]},${data[i+2]}`,c=usePalette.get(key);
    if(!c){if(unexpected.size<10)unexpected.add(key);continue;}
    out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];
  }
  if(unexpected.size)throw Error('Noncanonical v30 palette: '+JSON.stringify([...unexpected]));
  return sharp(out,{raw:info}).png().toBuffer();
}

await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(source),parts=doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
if(parts.length!==51||parts.reduce((n,p)=>n+p.getIndices().getCount()/3,0)!==298489)throw Error('Source topology changed');
const processed=new Map(),textures=[],changes=[];
for(let id=0;id<parts.length;id++){
  const part=parts[id],role=part.getExtras()?.semantic,mat=part.getMaterial(),tex=mat?.getBaseColorTexture();
  if(!role||!tex?.getImage())throw Error('Missing semantic or texture '+id);
  if((mat.getExtras()?.windowAllowed===true)!==windows.has(role))throw Error('Window ownership mismatch '+id);
  if(processed.has(tex)){
    if(processed.get(tex).role!==role)throw Error('Cross-semantic shared texture '+id);
    processed.get(tex).ids.push(id);continue;
  }
  const bytes=tex.getImage(),info=await sharp(bytes).metadata();
  let next,method;
  if(windows.has(role)){
    if(info.width%96||info.height!==(role==='wall'?1024:1152))throw Error('Invalid physical window atlas '+id);
    next=await windowTexture(info.height,info.width/96);method='complete-bay-square-panes';
  }else if(roofNative.has(role)){
    if(info.width!==256||info.height!==256)throw Error('Native roof size changed '+id);
    next=await roofSprite(bytes);method='low-frequency-roof-sprite';
  }else if(role==='cartoon-architectural-wall'){
    next=await simplerArchitectural(bytes);method='flat-masonry-panels';
  }else{
    next=await flatPalette(bytes,role);method=role==='roof-native-32'?'helipad-symbol-palette':'restricted-palette';
  }
  tex.setImage(next).setMimeType('image/png').setName(`v31 ${role} ${method}`);
  mat.setName(`v31 ${role} PLATEAU-2D-inspired`);
  mat.setExtras({...mat.getExtras(),windowAllowed:windows.has(role),
    styleSource:'2025 PLATEAU-2D aesthetic interpreted as independent Tocho 3D pixel art',
    humanAppearanceApproval:false,styleMethod:method});
  const rec={ids:[id],role,method,width:info.width,height:info.height,sourceSHA256:sha(bytes),resultSHA256:sha(next)};
  textures.push(rec);processed.set(tex,rec);changes.push(id);
}
// Every physical facade ends on a whole protected window bay; UV + wrap
// remain frozen, so no partial pane can be introduced by a texture edit.
for(let id=0;id<parts.length;id++){
  const p=parts[id],role=p.getExtras().semantic,info=p.getMaterial().getBaseColorTextureInfo();
  if(info.getMinFilter()!==9728||info.getMagFilter()!==9728)throw Error('Pixel sampling changed '+id);
  if(role==='cartoon-window-wall'&&info.getWrapS()!==33071)throw Error('Window atlas clamp changed '+id);
  if(role==='wall'&&info.getWrapS()!==10497)throw Error('Whole wall bay repeat changed '+id);
}
await io.write(output,doc);
fs.writeFileSync(reviewPath,html);
const report={version:'v31',date:new Date().toISOString(),source,sourceSHA256:EXPECTED,
  output,outputSHA256:sha(fs.readFileSync(output)),reviewPath,primitiveCount:51,
  triangleCount:298489,scope:'Tokyo Metropolitan Government Building 1: all exterior and roof semantics',
  sourceStyle:['https://plateau2d.com/','https://protopedia.net/prototype/7547','https://www.mlit.go.jp/plateau/journal/j098/'],
  palette:C,windowOwnership:[1,4,5,17,18,19,20,21,22,23,24,25],
  roofPhotoConverted:[45,50],helipadSymbolPreservedGeometry:49,
  geometryAndUvs:'frozen from v30; independent audit required',
  finiteBayPolicy:'each 96px bay has 20px stone guard on both physical ends',
  textureChanges:textures,updatedTextureGroups:textures.length,
  status:'Candidate. Independent semantic/geometry/UV audit and eight-view real WebGL visual review required; no human approval.'};
fs.writeFileSync(stylePath,JSON.stringify(report,null,2));
console.log(JSON.stringify({version:'v31',output,sha256:report.outputSHA256,groups:textures.length,changedPrimitives:changes.length,reviewPath}));
