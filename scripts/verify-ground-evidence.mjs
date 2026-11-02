import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {createWorker} from 'tesseract.js';
import {NodeIO} from '@gltf-transform/core';
import {createHash} from 'node:crypto';
import {triangulate,cross,sub} from './plateau-geometry.mjs';

const root='public/assets/ground-evidence/bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const output='data/texture-city/commons/verification';await mkdir(output,{recursive:true});
const report=JSON.parse(await readFile(`${root}/report.json`,'utf8'));
const g=JSON.parse(await readFile(report.geometryPath,'utf8'));
const building=g.buildings.find(b=>b.id===report.buildingId);
let originalArea=0;
for(const wall of building.walls){const t=triangulate(wall.rings.map(r=>r.points));for(let i=0;i<t.indices.length;i+=3){const [a,b,c]=t.indices.slice(i,i+3).map(k=>t.points[k]);originalArea+=Math.hypot(...cross(sub(b,a),sub(c,a)))/2;}}
assert.ok(Math.abs(originalArea-report.totalWallAreaSquareMetres)<1e-5,'Subdivision changed denominator');
assert.ok(report.walls.every(w=>w.externalArea>=0&&w.externalArea<=w.geometryArea+1e-7),'Overlapping source areas counted more than once');
assert.ok(Math.abs(report.sources.reduce((s,p)=>s+p.areaSquareMetres,0)-report.externalEvidenceAreaSquareMetres)<1e-5);
assert.equal(report.goalReached,report.strictExternalAreaCoverage>.9);
const io=new NodeIO(),neutral=await io.read(`${root}/neutral.glb`),external=await io.read(`${root}/external.glb`);
const prim=d=>d.getRoot().listMeshes().flatMap(m=>m.listPrimitives());
const n=prim(neutral),e=prim(external);assert.equal(n.length,e.length);
const hash=v=>createHash('sha256').update(v).digest('hex');
for(const texture of external.getRoot().listTextures())assert.ok(report.sources.some(s=>s.sourceSha256===hash(texture.getImage())),'GLB texture does not match attributed source bytes');
for(const primitive of e){const uv=primitive.getAttribute('TEXCOORD_0');if(uv)assert.ok(uv.getArray().every(v=>Number.isFinite(v)&&v>=0&&v<=1),'Invalid projected UV');}
for(let i=0;i<n.length;i++)assert.deepEqual(n[i].getAttribute('POSITION').getArray(),e[i].getAttribute('POSITION').getArray(),'Comparison mesh shapes differ');
const errors=[],failed=[];
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
let shots=[],state,ocr;
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)failed.push({url:r.url(),status:r.status()});});
 await page.goto('http://127.0.0.1:3100/ground-evidence-review.html',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__GROUND_EVIDENCE__?.ready||window.__GROUND_EVIDENCE__?.error,{timeout:60000});
 state=await page.evaluate(()=>window.__GROUND_EVIDENCE__);
 assert.equal(state.error,null);assert.equal(state.loaded,2);assert.equal(state.coverage,report.strictExternalAreaCoverage);
 assert.ok(state.panes.neutral.vertices>0);assert.ok(state.panes.external.textured>0);
 assert.equal(await page.locator('.source').count(),report.sources.length,'Missing photo comparison links');
 for(let i=0;i<report.sources.length;i++){
  const source=report.sources[i],img=page.locator('.source img').nth(i);
  await img.evaluate(image=>image.decode());
  const capture=await img.screenshot(),actual=await sharp(capture).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const expected=await sharp(`${root}/thumb-${source.id}.jpg`).resize(actual.info.width,actual.info.height,{fit:'cover'}).removeAlpha().raw().toBuffer();
  let absoluteError=0;for(let j=0;j<expected.length;j++)absoluteError+=Math.abs(actual.data[j]-expected[j]);
  assert.ok(absoluteError/expected.length<15,`${source.id}: thumbnail resampling is visibly corrupted`);
  const served=Buffer.from(await(await page.request.get(`http://127.0.0.1:3100/assets/ground-evidence/${report.buildingId}/source-${source.id}.jpg`)).body());
  assert.equal(hash(served),source.sourceSha256,'Served full photo is not the registered original');
 }
 for(const view of ['southwest','northwest','upper','east']){
  await page.locator(`[data-view="${view}"]`).click();
  await page.screenshot({path:`${output}/${view}.png`});
  // Source thumbnails are overlays inside the canvas rectangle. Hide them
  // while measuring model pixels, so a photo card cannot mask a blank mesh.
  await page.locator('.sources').evaluate(element=>{element.style.visibility='hidden';});
  const paths=[];
  for(const id of ['neutral','external']){
    const file=`${output}/${view}-${id}.png`;await page.locator(`#${id} canvas`).screenshot({path:file});paths.push(file);
  }
  await page.locator('.sources').evaluate(element=>{element.style.visibility='';});
  const images=await Promise.all(paths.map(file=>sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true})));
  const stats=images.map(({data,info})=>{let foreground=0;for(let i=0;i<data.length;i+=3)if(Math.hypot(data[i]-233,data[i+1]-237,data[i+2]-240)>15)foreground++;return {size:[info.width,info.height],foregroundRatio:foreground/(info.width*info.height)};});
  assert.ok(stats.every(s=>s.foregroundRatio>.04),`${view}: blank or tiny model`);
  let different=0;for(let i=0;i<Math.min(images[0].data.length,images[1].data.length);i+=3)if(Math.hypot(images[0].data[i]-images[1].data[i],images[0].data[i+1]-images[1].data[i+1],images[0].data[i+2]-images[1].data[i+2])>20)different++;
  const differenceRatio=different/(images[0].info.width*images[0].info.height);
  if(view==='southwest'||view==='northwest'||view==='upper')assert.ok(differenceRatio>.005,'Photo texture not visibly distinguishable from neutral');
  shots.push({view,stats,differenceRatio});
 }
 await page.locator('[data-view="southwest"]').click();
 const before=await page.locator('#external canvas').screenshot();
 const rect=await page.locator('#neutral canvas').boundingBox();
 await page.mouse.move(rect.x+rect.width*.55,rect.y+rect.height*.45);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height*.5,{steps:8});await page.mouse.up();
 const after=await page.locator('#external canvas').screenshot();assert.notDeepEqual(before,after,'Other pane did not respond to camera movement');
 await page.setViewportSize({width:1280,height:720});
 await page.locator('[data-view="southwest"]').click();
 const layout=await page.evaluate(()=>({height:innerHeight,bottom:document.querySelector('footer').getBoundingClientRect().bottom,
   views:[...document.querySelectorAll('.view')].map(e=>({width:e.clientWidth,height:e.clientHeight}))}));
 assert.ok(layout.bottom<=layout.height+1,'Footer clipped at 1280x720');
 assert.ok(layout.views.every(v=>v.width>=600&&v.height>=400),'Comparison canvas too small');
 await page.screenshot({path:`${output}/small-screen.png`});
 const worker=await createWorker('eng');
 try{ocr=(await worker.recognize(`${output}/southwest.png`)).data.text;}finally{await worker.terminate();}
 assert.ok(ocr.includes((report.strictExternalAreaCoverage*100).toFixed(2)),'Coverage number not legible in screenshot OCR');
 assert.equal(errors.length,0,JSON.stringify(errors));assert.equal(failed.length,0,JSON.stringify(failed));
}finally{await browser.close();}
const result={verifiedAt:new Date().toISOString(),url:'http://127.0.0.1:3100/ground-evidence-review.html',passed:true,goalReached:report.goalReached,coverage:report.strictExternalAreaCoverage,originalArea,state,shots,ocr,errors,failed};
await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:true,coverage:result.coverage,goalReached:result.goalReached,views:shots.map(s=>({view:s.view,foreground:s.stats.map(s=>s.foregroundRatio),difference:s.differenceRatio})),output}));
