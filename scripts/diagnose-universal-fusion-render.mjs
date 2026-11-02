import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
browser.on('disconnected',()=>console.log('browser disconnected'));
const page=await browser.newPage({viewport:{width:1480,height:900}});
page.on('pageerror',e=>console.log('pageerror',String(e)));
page.on('crash',()=>console.log('PAGE CRASH'));
page.on('close',()=>console.log('PAGE CLOSED'));
page.on('console',e=>{if(e.type()==='error')console.log('browser console',e.text())});
try{
 console.log('starting navigation');
 await page.goto('http://127.0.0.1:3111/universal-all-areas.html',{waitUntil:'domcontentloaded',timeout:30000});
 console.log('navigated');
 await page.waitForFunction(()=>window.__allAreas?.loaded||window.__allAreas?.error,undefined,{timeout:120000});
 console.log('loaded',JSON.stringify(await page.evaluate(()=>window.__allAreas)));
 const canvas=page.locator('.viewport canvas');
 console.log('count',await canvas.count());
 console.log('before screenshot');
 await canvas.first().screenshot({path:'test-results/diagnostic-fusion-left.png',timeout:15000});
 console.log('left screenshot complete');
 await canvas.last().screenshot({path:'test-results/diagnostic-fusion-right.png',timeout:15000});
 console.log('right screenshot complete');
 const box=await canvas.first().boundingBox();
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);
 await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.57,{steps:6});await page.mouse.up();
 await page.mouse.wheel(0,-280);await page.waitForTimeout(400);
 console.log('interaction complete');
 await canvas.first().screenshot({path:'test-results/diagnostic-fusion-left-interacted.png',timeout:15000});
 await canvas.last().screenshot({path:'test-results/diagnostic-fusion-right-interacted.png',timeout:15000});
 console.log('interaction screenshot complete');
}catch(error){console.log('DIAG ERROR',String(error));}
finally{if(browser.isConnected())await browser.close();}
