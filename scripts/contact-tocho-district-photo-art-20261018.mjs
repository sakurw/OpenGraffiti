import fs from 'node:fs/promises';
import sharp from 'sharp';
const dir='data/texture-city/tocho-district-photo-v2-20261018',out='public/assets/tocho-district-photo-v2-20261018';
const j=JSON.parse(await fs.readFile(out+'/photo-profiles.json','utf8')),items=j.buildings.filter(p=>p.artwork);
for(let i=0;i<items.length;i+=6){const group=items.slice(i,i+6),parts=[];
for(let n=0;n<group.length;n++){const p=group[n],x=n%3*420,y=Math.floor(n/3)*470;
const img=await sharp(out+'/'+p.artwork).resize(400,400,{fit:'contain',background:'#eceae1'}).png().toBuffer();parts.push({input:img,left:x+10,top:y+55});
const label=`<svg width="420" height="52"><text x="10" y="16" font-size="12" fill="#222">${p.index}: ${p.name||p.buildingId.slice(0,18)}</text><text x="10" y="34" font-size="11" fill="#333">${p.evidenceStatus} | bays ${p.bays}, floors ${p.floors}</text></svg>`;parts.push({input:Buffer.from(label),left:x,top:y});}
await sharp({create:{width:1260,height:Math.ceil(group.length/3)*470,channels:3,background:'#e3e1d8'}}).composite(parts).png().toFile(`${dir}/art-contact-${Math.floor(i/6)+1}.png`);}
console.log(items.length);
