import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {textureReportUrl} from '../../shared/texture-selection.mjs';
for(const area of ['tocho','tokyo-tower'])test(`real ${area} quality-filtered manifest and UI agree`,async({page})=>{
 const report=JSON.parse(await readFile('public'+textureReportUrl(area),'utf8'));
 expect(report.photoQualityPolicy).toBe('exclude-known-visual-quality-below-0.2-v1');
 const excluded=new Set(report.qualityExcludedPhotos.map(p=>p.id));expect(excluded.size).toBeGreaterThan(0);
 for(const p of report.qualityExcludedPhotos){expect(p.score).toBeGreaterThan(0);expect(p.score).toBeLessThan(.2);}
 for(const p of report.sources){expect(excluded.has(p.id)).toBe(false);expect(report.sourceQuality.find(q=>q.id===p.id).status).not.toBe('low-quality');}
 for(const b of report.buildings)for(const id of b.sourceIds)expect(excluded.has(id)).toBe(false);
 if(area==='tocho')for(const id of ['215593303325380','227471635813368','1173252296490528','190160779603384'])expect(excluded.has(id)).toBe(true);
 await page.goto('/texture-city');await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 await page.getByLabel('比較地域').selectOption(area);await expect(page.getByRole('status')).toContainText('都市モデル読込完了');
 const modelLoaded=page.waitForResponse(r=>r.url().endsWith(report.model)&&r.ok());
 await page.getByRole('checkbox',{name:'Mapillaryの暫定実写投影を表示（位置合わせ未確認）'}).check();
 await modelLoaded;
 await expect(page.locator('.city-compare-stage canvas')).toHaveAttribute('data-experimental','loaded');
 await expect(page.locator('.city-quality-diagnostic')).toContainText(`${excluded.size.toLocaleString()} 枚`);
 await expect(page.locator('.city-quality-diagnostic')).toContainText('未採点');
 await expect(page.getByRole('link',{name:'この表示の暫定結果・カメラ推定条件',includeHidden:true})).toHaveAttribute('href',textureReportUrl(area));
});
