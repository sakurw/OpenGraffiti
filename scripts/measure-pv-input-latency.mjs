import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
// Isolated browser context; never publishes or changes the user's saved work.
const origin=process.argv[2]||'http://127.0.0.1:3100',browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1857,height:872}}),samples=[];
 await page.goto(origin+'/buildings/bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7/edit?terrain=flat');
 await page.locator('canvas[data-buildings="127"]').waitFor();await page.locator('.pv-stage>.pv-loading').waitFor({state:'hidden'});
 const endpoint=async(x,y)=>page.evaluate(async({x,y})=>{const c=document.querySelector('canvas'),start=performance.now();let frames=0;while((Math.abs(Number(c.dataset.paintRenderedX)-x)>.1||Math.abs(Number(c.dataset.paintRenderedY)-y)>.1||Number(c.dataset.paintPending)>0)&&performance.now()-start<5000){await new Promise(requestAnimationFrame);frames++;}if(Number(c.dataset.paintPending)>0)throw Error('Stroke backlog did not drain');return {frames,remainingMs:performance.now()-start,inputToRenderMs:Number(c.dataset.paintInputToRenderMs),workMs:Number(c.dataset.paintWorkMs),scopeMs:Number(c.dataset.scopeMs),uploadMs:Number(c.dataset.paintCpuMs)};},{x,y});
 for(let attempt=0;attempt<2;attempt++){await page.mouse.move(825,390);await page.mouse.down();const firstDotMs=Number(await page.locator('canvas').getAttribute('data-paint-input-to-render-ms'));await page.mouse.move(825,720);samples.push({path:attempt?'cached-330px':'cold-330px',firstDotMs,...await endpoint(825,720)});await page.mouse.up();}
 const short=[];await page.mouse.move(825,520);await page.mouse.down();for(let y=525;y<=620;y+=5){await page.mouse.move(825,y);short.push(await endpoint(825,y));}await page.mouse.up();
 const values=short.map(s=>s.inputToRenderMs).sort((a,b)=>a-b),report={method:'Pointer event timestamp to WebGL render submission, not physical display latency',origin,viewport:{width:1857,height:872},samples,short5px:{count:values.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1],maxMs:values.at(-1)},shortSamples:short};
 await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/input-latency-20261102.json',JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{await browser.close();}
