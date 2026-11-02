import {chromium} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:3111';
const report=JSON.parse(await readFile('public/assets/universal-all-areas/report.json','utf8'));
if(report.areas.length!==2||report.areas.reduce((n,a)=>n+a.buildingCount,0)!==2858||report.areas.some(a=>!a.geometryUvIdentical||a.processedTextures<1))throw Error('Batch coverage invalid');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1450,height:900}});const errors=[];
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const checks=[];
try{
 await page.goto(base+'/universal-all-areas.html',{waitUntil:'domcontentloaded'});
 for(const area of ['tocho','tokyo-tower']){
  if(area==='tokyo-tower')await page.locator('button[data-area="tokyo-tower"]').click();
  await page.waitForFunction(a=>window.__allAreas?.loaded&&window.__allAreas?.area===a,area,{timeout:120000});
  const data=await page.evaluate(()=>window.__allAreas);
  const canvases=page.locator('.viewport canvas');if(await canvases.count()!==2)throw Error('Two viewer canvases missing');
  for(let i=0;i<2;i++){const size=await canvases.nth(i).evaluate(el=>[el.width,el.height]);if(size.some(n=>n<100))throw Error('Canvas too small '+JSON.stringify(size));}
  const bounds=await canvases.first().boundingBox();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.68,bounds.y+bounds.height*.53,{steps:6});await page.mouse.up();
  await page.screenshot({path:`test-results/universal-all-${area}.png`,fullPage:true});
  checks.push(data);
 }
 if(errors.length)throw Error('Browser errors: '+errors.join(' | '));
 const output={verdict:'browser-rendered',checks,errors};await mkdir('test-results',{recursive:true});await writeFile('test-results/universal-all-areas-verification.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output));
}finally{await browser.close()}
