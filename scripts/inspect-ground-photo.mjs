// Coordinate-labelled source crops for manual observations, never projected fit points.
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [sourceId,cropText='0,0,900,1200',scaleText='2']=process.argv.slice(2);
if(!/^\d+$/.test(sourceId??''))throw Error('Supply a numeric Commons photo ID');
const [left,top,width,height]=cropText.split(',').map(Number),scale=Number(scaleText);
if(![left,top,width,height,scale].every(Number.isFinite)||left<0||top<0||width<=0||height<=0||scale<1||scale>4)throw Error('Invalid crop');
const input=`data/texture-city/photos/commons/${sourceId}.jpg`,meta=await sharp(input).metadata();
const refWidth=900,refHeight=Math.round(meta.height*refWidth/meta.width);
const crop={left,top,width,height};
const reference=await sharp(input).resize(refWidth,refHeight).png().toBuffer();
const extracted=await sharp(reference).extract(crop).png().toBuffer();
const raw=await sharp(extracted).resize(width*scale,height*scale).png().toBuffer();
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width*scale}" height="${height*scale}">`;
for(let x=Math.ceil(left/20)*20;x<left+width;x+=20){
  const px=(x-left)*scale;
  svg+=`<path d="M${px},0V${height*scale}" stroke="#ff44dd" opacity=".3"/><text x="${px+2}" y="14" font-size="12" fill="#000" stroke="white" stroke-width=".3">${x}</text>`;
}
for(let y=Math.ceil(top/20)*20;y<top+height;y+=20){
  const py=(y-top)*scale;
  svg+=`<path d="M0,${py}H${width*scale}" stroke="#ff44dd" opacity=".3"/><text x="2" y="${py-2}" font-size="12" fill="#000" stroke="white" stroke-width=".3">${y}</text>`;
}
const output=`data/texture-city/commons/controls/${sourceId}-grid-${left}-${top}.png`;
await mkdir(path.dirname(output),{recursive:true});
await sharp(raw).composite([{input:Buffer.from(svg+'</svg>')}]).png().toFile(output);
console.log(JSON.stringify({sourceId,referenceSize:[refWidth,refHeight],crop,scale,output,note:'Raw source coordinates only. No predicted landmarks.'}));
