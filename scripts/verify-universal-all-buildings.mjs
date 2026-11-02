import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
const report=JSON.parse(await readFile('public/assets/universal-all-areas/per-building-report.json','utf8'));
const fusionReport=JSON.parse(await readFile('public/assets/universal-all-areas/photo-fusion-report.json','utf8'));
if(report.areas.length!==2||report.areas.reduce((sum,a)=>sum+a.buildingCount,0)!==2858)throw Error('Missing building scope');
for(const entry of report.areas){
 const evidence=JSON.parse(await readFile(`public${entry.evidence}`,'utf8'));
 if(evidence.buildings.length!==entry.buildingCount||evidence.buildings.some(b=>!b.polygons.length)||evidence.buildings.reduce((sum,b)=>sum+b.polygons.length,0)!==entry.summary.polygons)throw Error(`Incomplete per-building evidence: ${entry.areaId}`);
 if(entry.summary.failedTriangulations||entry.summary.missingSurfaces)throw Error(`Missing surfaces: ${entry.areaId}`);
 const source=JSON.parse(await readFile(`data/texture-city/universal-all-buildings/ground/${entry.areaId}-discovery.json`,'utf8'));
 if(source.buildings.length!==entry.buildingCount||source.buildings.some(b=>!b.candidateCount))throw Error(`Missing photo candidates: ${entry.areaId}`);
 const fused=fusionReport.areas.find(a=>a.area===entry.areaId);
 if(!fused?.geometryUVIdentical||!fused.altered||!fused.buildingsWithEligiblePhotoAlbedo)throw Error(`Missing original-UV photographic color fusion: ${entry.areaId}`);
}
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1480,height:900}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
try{
 await page.goto('http://127.0.0.1:3111/universal-all-areas.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__allAreas?.loaded,undefined,{timeout:120000});
 for(const entry of report.areas)for(const mode of ['fusion','appearance','inferred']){
  let prior=await page.evaluate(()=>window.__allAreas);
  if(prior.area!==entry.areaId){
   await page.locator(`button[data-area="${entry.areaId}"]`).click();
   await page.waitForFunction(({id,mode})=>window.__allAreas?.loaded&&window.__allAreas?.area===id&&window.__allAreas?.mode===mode,{id:entry.areaId,mode:prior.mode},{timeout:120000});
   prior=await page.evaluate(()=>window.__allAreas);
  }
  if(prior.mode!==mode)await page.locator(`button[data-mode="${mode}"]`).click();
  await page.waitForFunction(({id,mode})=>window.__allAreas?.loaded&&window.__allAreas?.area===id&&window.__allAreas?.mode===mode,{id:entry.areaId,mode},{timeout:120000});
  const data=await page.evaluate(()=>window.__allAreas),canvas=page.locator('.viewport canvas');
  if(!data.perBuilding||data.buildingCount!==entry.buildingCount||data.summary.polygons!==entry.summary.polygons||(mode==='inferred'&&data.meshCount[1]<entry.buildingCount*.99)||data.geometryUvIdentical!==(mode!=='inferred'))throw Error('Incorrect rendered model: '+entry.areaId+' '+mode);
  if(await canvas.count()!==2)throw Error('Comparison canvases missing');
  const box=await canvas.first().boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
  await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.57,{steps:6});await page.mouse.up();
  await page.mouse.wheel(0,-280);await page.waitForTimeout(400);
  if(mode==='fusion'){
   // Screenshot the page once; element.screenshot() can trigger a renderer crash
   // while Playwright scrolls a WebGL canvas into view on Windows/SwiftShader.
   const boxes=await Promise.all([canvas.nth(0).boundingBox(),canvas.nth(1).boundingBox()]);
   if(boxes.some(b=>!b))throw Error('Canvas outside visible page');
   const shots=[];
   for(const b of boxes)shots.push(await page.screenshot({animations:'disabled',clip:{x:b.x,y:b.y,width:b.width,height:b.height},timeout:30000}));
   const raw=await Promise.all(shots.map(buffer=>sharp(buffer).removeAlpha().raw().toBuffer({resolveWithObject:true})));
   if(raw[0].info.width!==raw[1].info.width||raw[0].info.height!==raw[1].info.height)throw Error('Canvas dimensions differ');
   let differing=0,content=0;
   for(let i=0;i<raw[0].data.length;i+=3){
    const a=raw[0].data,b=raw[1].data;
    if(Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])>9||Math.min(a[i],a[i+1],a[i+2])<218)content++;
    if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)differing++;
   }
   if(content<1000||differing<500)throw Error(`Fusion not visually evidenced: ${entry.areaId} content ${content}, differences ${differing}`);
   data.rasterCheck={contentPixels:content,differingPixels:differing};
  }
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:`test-results/universal-all-per-building-${entry.areaId}-${mode}.png`,fullPage:true});
  checks.push(data);
 }
 if(errors.length)throw Error('Browser errors: '+errors.join(' | '));
 const result={verdict:'both-areas-rendered-and-interacted',checks,errors};
 await writeFile('test-results/universal-all-per-building-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await browser.close()}
