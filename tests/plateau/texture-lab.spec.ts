import {test,expect} from '@playwright/test';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';
test('real photo variants preserve original geometry and mask sculpture',async()=>{
 const io=new NodeIO().registerExtensions([KHRMaterialsUnlit]);
 const a=await io.read('public/assets/texture-poc/original.glb');
 const original=a.getRoot().listMeshes()[0].listPrimitives();
 for(const name of ['snap','mapillary']){
  const b=await io.read('public/assets/texture-poc/'+name+'.glb');const ps=b.getRoot().listMeshes()[0].listPrimitives();
  expect(ps.length).toBe(original.length+1);
  const base=ps.filter(p=>p.getMaterial()?.getName()!==name);
  for(let i=0;i<original.length;i++){
   expect(base[i].getAttribute('POSITION')?.getArray()).toEqual(original[i].getAttribute('POSITION')?.getArray());
   expect(base[i].getAttribute('TEXCOORD_0')?.getArray()).toEqual(original[i].getAttribute('TEXCOORD_0')?.getArray());
  }
  const patch=ps.find(p=>p.getMaterial()?.getName()===name)!;
  expect(patch.getAttribute('POSITION')?.getCount()).toBe(4);
  for(const uv of patch.getAttribute('TEXCOORD_0')!.getArray()!)expect(uv).toBeGreaterThanOrEqual(-.00001);
 }
 const {data,info}=await sharp('public/assets/texture-poc/mapillary.png').raw().toBuffer({resolveWithObject:true});
 expect(data[3]).toBe(255);expect(data[(info.width*info.height-1)*4+3]).toBe(0);
});
test('three real textured models load and synchronized views respond',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/texture-lab');await expect(page.getByRole('status')).toContainText('モデル読込 3/3');
 const canvases=page.locator('.lab-viewport canvas');await expect(canvases).toHaveCount(3);
 await page.screenshot({path:'test-results/texture-lab-close.png',fullPage:true});
 const before=await Promise.all([0,1,2].map(i=>canvases.nth(i).screenshot()));
 expect(before[0].equals(before[1])).toBe(false);expect(before[1].equals(before[2])).toBe(false);
 const box=(await canvases.first().boundingBox())!;
 await page.mouse.move(box.x+100,box.y+180);await page.mouse.down();await page.mouse.move(box.x+145,box.y+200,{steps:8});await page.mouse.up();
 for(let i=0;i<3;i++)expect((await canvases.nth(i).screenshot()).equals(before[i])).toBe(false);
 await page.getByRole('button',{name:'建物全体を見る'}).click();
 await page.screenshot({path:'test-results/texture-lab-whole.png',fullPage:true});
 await expect(page.getByText('CC BY-SA 3.0',{exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
