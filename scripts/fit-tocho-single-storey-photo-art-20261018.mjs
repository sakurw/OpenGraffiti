import fs from 'node:fs/promises';
import sharp from 'sharp';
import crypto from 'node:crypto';
const dir='data/texture-city/tocho-district-photo-v2-20261018',out='public/assets/tocho-district-photo-v2-20261018';
const p=JSON.parse(await fs.readFile(out+'/photo-profiles.json','utf8'));
const ids=['bldg_0fb03336-2d05-4c33-b2e9-22d1bd9baecb','bldg_c2d9973d-f4ab-47fe-ad19-89b5f6dd8d99','bldg_699dc005-5d67-4e13-9e9c-826921d5ef3c'];
const pitch=[2.9,2.9,2.7];
for(let i=0;i<ids.length;i++){
 const b=p.buildings.find(b=>b.buildingId===ids[i]);
 const meta=await sharp(b.generationSource).metadata(),height=Math.floor(meta.height/2);
 await sharp(b.generationSource).extract({left:0,top:0,width:meta.width,height}).png().toFile(out+'/'+b.artwork);
 Object.assign(b,{singleStoreyObserved:true,floors:1,floorHeight:pitch[i],bayWidth:2.3,artworkDimensions:[meta.width,height],moduleCrop:{method:'Visually reviewed upper complete window row; single-storey native photo and geometry',left:0,top:0,width:meta.width,height,originalFloors:2},artworkSha256:crypto.createHash('sha256').update(await fs.readFile(out+'/'+b.artwork)).digest('hex')});
 b.inferred+=' 平屋の実形状に合わせて一階分のみ配置。窓間隔と高さは推測寸法。';
}
await fs.writeFile(out+'/photo-profiles.json',JSON.stringify(p,null,2));
await fs.writeFile(dir+'/photo-profiles.json',JSON.stringify(p,null,2));
console.log('Fitted three observed single-storey profiles');
