import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
test('all buildings have truthful applied area and candidate-only records',async()=>{
 const c=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8'));
 const s=JSON.parse(await readFile('public/assets/texture-poc/city-survey.json','utf8'));
 expect(c.buildings).toHaveLength(2858);expect(new Set(c.buildings.map(b=>b.id)).size).toBe(2858);
 expect(c.buildings.reduce((n,b)=>n+b.wallIds.length,0)).toBe(8939);
 const ids=new Set(s.photos.map(p=>p.id));
 for(const b of c.buildings)for(const key of ['snap','mapillary']){
  assert(b[key].appliedArea>=0&&b[key].appliedArea<=b.wallArea);
  if(b.status==='unapplied')assert.equal(b[key].appliedArea,0);
  for(const p of b[key].candidates)assert(ids.has(p.id));
 }
 expect(s.photos.every(p=>p.verification==='not-reviewed')).toBe(true);
});
test('both city areas, buildings and independent input panels are usable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-city');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await expect(page.getByLabel('比較建物').locator('option')).toHaveCount(1601);
 await page.getByLabel('比較建物').selectOption('bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7');
 await expect(page.locator('.city-building')).toContainText('3.77% 適用');await expect(page.locator('.city-building')).toContainText('2.04% 適用');
 await page.screenshot({path:'test-results/texture-city-tocho.png',fullPage:true});
 const canvas=page.locator('.city-compare-stage canvas');
 for(const pane of await page.locator('.city-input').all()){
  await pane.scrollIntoViewIfNeeded();
  const before=await canvas.getAttribute('data-camera'),box=(await pane.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);
  await expect(canvas).not.toHaveAttribute('data-camera',before!);
 }
 await page.getByLabel('比較地域').selectOption('tokyo-tower');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await expect(page.getByLabel('比較建物').locator('option')).toHaveCount(1259);
 await page.getByLabel('比較建物').selectOption({index:1});await expect(page.locator('.city-building')).toContainText('0.00% 適用');
 await page.screenshot({path:'test-results/texture-city-tower.png',fullPage:true});
 await page.getByLabel('適用状態').selectOption('both');await expect(page.getByLabel('比較建物').locator('option')).toHaveCount(1);
 expect(errors).toEqual([]);
});
