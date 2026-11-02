import {test,expect} from '@playwright/test';

test('workspace controls, wall dismissal and gallery zoom are keyboard accessible',async({page})=>{
 await page.goto('/areas/tokyo-tower/city');
 await expect(page.locator('.city-scene canvas')).toBeVisible();
 await expect(page.locator('.wall-browser')).toHaveCount(0);
 await expect(page.locator('.demo-bar')).toHaveCount(0);
 await page.getByRole('button',{name:'壁を探す',exact:true}).click();
 await page.getByRole('button',{name:/WALL 01/}).click();
 await expect(page.getByRole('button',{name:'この壁に描く'})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.wall-browser')).toHaveCount(0);
 await page.getByRole('button',{name:'デモ操作',exact:true}).click();
 await expect(page.locator('.demo-bar')).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.locator('.demo-bar')).toHaveCount(0);
 await page.getByRole('button',{name:'区画一覧',exact:true}).click();
 await expect(page.locator('.gallery-card')).toHaveCount(12);
 const gallery=page.locator('.gallery-viewport');
 await gallery.hover();await page.mouse.wheel(0,-200);
 await expect(page.locator('.gallery-grid')).not.toHaveAttribute('style','width: 100%;');
 await page.getByRole('button',{name:'全体表示',exact:true}).click();
 await expect(page.locator('.gallery-grid')).toHaveAttribute('style','width: 100%;');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/gallery-mobile.png',fullPage:true});
});

test('editor shortcuts preserve text fields and fixed base',async({page})=>{
 await page.goto('/walls/wall-10/edit/source');
 await page.getByRole('button',{name:'この状態で描き始める'}).click();
 await expect(page.getByRole('button',{name:'デモ操作',exact:true})).toHaveCount(0);
 const canvas=page.getByLabel('描画キャンバス');
 const initial=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());
 await page.keyboard.press('s');await expect(page.getByRole('button',{name:'スプレー',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('b');await page.keyboard.press(']');
 await expect(page.getByRole('slider',{name:'サイズ',exact:true})).toHaveValue('28');
 const bounds=(await canvas.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width*.3,bounds.y+bounds.height*.5);await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+bounds.height*.5,{steps:8});await page.mouse.up();
 const drawing=await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL());expect(drawing).not.toBe(initial);
 await page.keyboard.press('Control+z');expect(await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(initial);
 await page.keyboard.press('Control+Shift+z');expect(await canvas.evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(drawing);
 await page.getByRole('button',{name:'キャンセル',exact:true}).click();
 await expect(page.getByRole('heading',{name:'未公開の編集があります'})).toBeVisible();
 await page.getByRole('button',{name:'編集を続ける',exact:true}).click();
 await page.screenshot({path:'test-results/editor-shortcuts.png',fullPage:true});
});
