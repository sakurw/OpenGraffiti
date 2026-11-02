import {test,expect,type Page} from '@playwright/test';
const id='bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const ready=async(p:Page)=>{await expect(p.locator('canvas')).toHaveAttribute('data-buildings',/^(127|3492)$/);await expect(p.locator('.pv-stage>.pv-loading')).toHaveCount(0);};
test('Pages direct links, drawing, undo/redo, publication, reload, history, roads, walk and clock',async({page,context,baseURL})=>{
 const errors:string[]=[],badAssets:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&/\.(png|glb|json|js|css)(\?|$)/.test(r.url()))badAssets.push(r.url());});
 await page.goto(baseURL!);await ready(page);await expect(page.locator('canvas')).toHaveAttribute('data-buildings','3492');
 await page.goto(baseURL+'buildings/'+id+'/edit?scope=original&terrain=constrained');await ready(page);await expect(page.locator('canvas')).toHaveAttribute('data-view','edit');await expect(page.locator('canvas')).toHaveAttribute('data-buildings','127');
 const c=page.locator('canvas'),b=(await c.boundingBox())!;
 await page.mouse.move(b.x+b.width*.52,b.y+b.height*.5);await page.mouse.down();await page.mouse.move(b.x+b.width*.52,b.y+b.height*.5+50,{steps:20});await page.mouse.up();await expect(c).toHaveAttribute('data-strokes','1');
 await page.getByRole('button',{name:'元に戻す',exact:true}).click();await expect(c).toHaveAttribute('data-strokes','0');await page.getByRole('button',{name:'やり直す',exact:true}).click();await expect(c).toHaveAttribute('data-strokes','1');
 await page.getByRole('button',{name:'街へ反映',exact:true}).click();await page.getByLabel('作品タイトル').fill('Pages 通し確認');await page.getByRole('button',{name:'街へ反映する',exact:true}).click();await ready(page);
 await page.goto(baseURL+'buildings/'+id+'/history');await ready(page);await expect(page.getByRole('button',{name:/Pages 通し確認/})).toBeVisible();await page.reload();await ready(page);await expect(page.getByRole('button',{name:/Pages 通し確認/})).toBeVisible();
 await page.screenshot({path:'test-results/pages-history.png'});
 const control=await context.newPage();await control.goto(baseURL+'demo-control');await expect(control.getByRole('heading',{name:'撮影用コントロール'})).toBeVisible();await control.keyboard.press('Space');await control.keyboard.press('Home');await expect(control.locator('.pv-demo-clock')).toContainText('停止中');await control.close();
 await page.goto(baseURL+'areas/tocho/roads?road=road-4&side=left');await ready(page);await expect(c).toHaveAttribute('data-view','street');await page.getByRole('tab',{name:'右側の建物',exact:true}).click();await expect(c).toHaveAttribute('data-side','right');
 await page.getByRole('button',{name:'この道を歩く',exact:true}).click();await expect(c).toHaveAttribute('data-view','walk');const before=await c.getAttribute('data-camera-position');await c.click({position:{x:400,y:300}});await page.keyboard.down('w');await page.waitForTimeout(600);await page.keyboard.up('w');expect(await c.getAttribute('data-camera-position')).not.toBe(before);
 await page.screenshot({path:'test-results/pages-walk.png'});expect(errors).toEqual([]);expect(badAssets).toEqual([]);
});
test('Pages sample gallery and fade controls remain usable at a compact viewport',async({page,baseURL})=>{
 await page.setViewportSize({width:1280,height:720});await page.goto(baseURL+'demo-fade?scope=original');await expect(page).toHaveURL(/areas\/tocho\/city/);await ready(page);await page.keyboard.press('ArrowLeft');await page.keyboard.press('Space');await page.waitForTimeout(500);await page.keyboard.press('Space');await page.keyboard.press('ArrowLeft');
 await page.goto(baseURL+'areas/tocho/roads');await ready(page);await expect(page.locator('canvas')).toHaveAttribute('data-view','map');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight)).toBe(true);
 await page.screenshot({path:'test-results/pages-compact.png'});
});
