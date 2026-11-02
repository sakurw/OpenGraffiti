import {test,expect} from '@playwright/test';
import * as T from 'three';
test('cursor-anchored zoom and fixed world-space pan at multiple zoom levels',async({page})=>{
 await page.goto('/areas/tocho/city');await page.getByText('表示・視点',{exact:true}).click();await expect(page.getByRole('button',{name:'視点をリセット',exact:true})).toBeVisible();
 const canvas=page.locator('.city-scene canvas'),b=(await canvas.boundingBox())!;
 const read=async()=>({position:(await canvas.getAttribute('data-camera-position'))!.split(',').map(Number),quaternion:(await canvas.getAttribute('data-camera-quaternion'))!.split(',').map(Number)});
 const project=(point:number[],state:any)=>{const c=new T.PerspectiveCamera(40,b.width/b.height,.1,5000);c.position.fromArray(state.position);c.quaternion.fromArray(state.quaternion);c.updateMatrixWorld();return new T.Vector3(...point as [number,number,number]).project(c);};
 const pan=async()=>{const before=await read();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.7);await page.mouse.down({button:'right'});await page.mouse.move(b.x+b.width*.6+80,b.y+b.height*.7,{steps:8});await page.mouse.up({button:'right'});await page.waitForTimeout(100);const after=await read();return new T.Vector3(...before.position as [number,number,number]).distanceTo(new T.Vector3(...after.position as [number,number,number]));};
 expect(await pan()).toBeCloseTo(60,3);
 for(const delta of [-40,-40,40]){await page.mouse.move(b.x+b.width*.52,b.y+b.height*.54);const before=await read();await page.mouse.wheel(0,delta);await page.waitForTimeout(150);const after=await read(),anchor=(await canvas.getAttribute('data-zoom-anchor'))!.split(',').map(Number),p=project(anchor,before),q=project(anchor,after);expect(Math.abs(p.x-q.x)*b.width/2).toBeLessThan(.2);expect(Math.abs(p.y-q.y)*b.height/2).toBeLessThan(.2);expect(new T.Vector3(...before.position as [number,number,number]).distanceTo(new T.Vector3(...after.position as [number,number,number]))).toBeCloseTo(12,3);}
 expect(await pan()).toBeCloseTo(60,3);
});
