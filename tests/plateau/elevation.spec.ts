import {test,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
test('Tokyo Tower south canvas retains its silhouette and only visible geometry',async({page,request})=>{
 const state=await (await request.get('/api/v1/bootstrap')).json();
 const wall=state.walls.filter(w=>w.areaId==='tokyo-tower'&&w.source.quadrant===2).sort((a,b)=>b.height-a.height)[0];
 expect(wall.height).toBeGreaterThan(300);expect(wall.width/wall.height).toBeLessThan(.5);
 const recipes=JSON.parse(await readFile('public/assets/datasets/'+state.datasetVersion+'/recipes/tokyo-tower.json','utf8')),r=recipes[wall.id];
 expect(r.projection).toBe('orthographic-visible');expect(r.visiblePolygons.length).toBeGreaterThan(0);
 const geometry=await(await request.get('/api/v1/walls/'+wall.id+'/geometry')).json();
 expect(geometry.geometry.indices.length).toBe(r.visiblePolygons.reduce((sum,p)=>sum+p.indices.length,0));
 const base=await request.get(wall.baseImage);expect(base.ok()).toBe(true);
 const image=await sharp(await base.body()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let used=0;for(let i=3;i<image.data.length;i+=4)if(image.data[i])used++;
 expect(used).toBeGreaterThan(image.info.width*image.info.height*.05);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/tower-elevation.png',await base.body());
 await page.goto('/areas/tokyo-tower/city/walls/'+wall.id);
 await expect(page.locator('.scene-loading')).toHaveCount(0);await expect(page.locator('img.detail-art')).toBeVisible();
 await page.getByRole('button',{name:'選択した壁の全体へ'}).click();
 await page.waitForTimeout(500);await page.screenshot({path:'test-results/tower-elevation-screen.png'});
});
test('source comparison labels examples and supports local image comparison without upload',async({page})=>{
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('/texture-comparison.html');
 await expect(page.getByText('都庁の同一壁へ実画像を適用しました。',{exact:false})).toBeVisible();
 const png=await sharp({create:{width:16,height:12,channels:4,background:'#aa3322'}}).png().toBuffer();
 for(const id of ['snap','mapillary']){await page.locator('#'+id+'-file').setInputFiles({name:'test-wall.png',mimeType:'image/png',buffer:png});await expect(page.locator('#'+id+'-meta')).toContainText('16 × 12');}
 expect(posts).toEqual([]);
 await page.screenshot({path:'test-results/source-comparison-local-test.png'});
});
