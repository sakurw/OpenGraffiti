import sharp from 'sharp';
import { walls, START, WIDTH, HEIGHT } from '../shared/catalog.mjs';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
const palette = ['#bbee56', '#ff7f5a', '#4dcece', '#9c8cec', '#f1cf62', '#ec8caa'];
function baseSvg(w) {
  let lines = '';
  for(let y=0;y<1024;y+=128) { lines += `<path d="M0 ${y}H2048"/>`; for(let x=(y/128%2)*128;x<2048;x+=256) lines += `<path d="M${x} ${y}v128"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><rect width="2048" height="1024" fill="${w.color}"/><g stroke="#646d67" stroke-opacity=".18" stroke-width="3">${lines}</g><path d="M0 1005H2048" stroke="#82897f" stroke-width="38"/><g fill="#626a64" opacity=".4">${[120,1928].flatMap(x=>[120,880].map(y=>`<circle cx="${x}" cy="${y}" r="9"/>`)).join('')}</g></svg>`;
}
function artSvg(i) {
 const c = palette[i % palette.length], word = ['FLOW', 'HELLO', 'STAY', 'BLOOM', 'PLAY', 'TOKYO'][i % 6];
 return `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><g transform="translate(1024 500) rotate(-6)"><path d="M-790 30Q-390 -600 10 -210T810 10" fill="none" stroke="${c}" stroke-width="190" stroke-linecap="round"/><ellipse cx="-590" cy="250" rx="200" ry="150" fill="${c}"/><circle cx="560" cy="-190" r="168" fill="#f4efde"/><path d="M-760 280Q0 480 760 230" fill="none" stroke="#273b35" stroke-width="44"/><text x="0" y="180" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-style="italic" font-size="440" letter-spacing="-25" stroke="#253630" stroke-width="20" paint-order="stroke" fill="#f5f2df">${word}</text><g stroke="#263b32" stroke-width="28" stroke-linecap="round"><path d="M660 -160l0 62m90 -62v62m-96 90q50 55 103 0"/><path d="M-780 -280l50 -75m50 65l24 -91"/></g></g><text x="1830" y="932" fill="#273b35" font-family="monospace" font-size="40">OG / ${String(i+1).padStart(2,'0')}</text></svg>`;
}
export async function prepareAssets(dir,selected=walls) {
 await mkdir(dir, { recursive: true });
 for (let i=0;i<selected.length;i++) {
   const w=selected[i];if(w.lazy)continue;if(w.baseImage){await copyFile('public'+w.baseImage,`${dir}/${w.id}-base.png`);continue;}const base=await sharp(Buffer.from(baseSvg(w))).png().toBuffer();
   await writeFile(`${dir}/${w.id}-base.png`, base);
   const art=await sharp(base).composite([{input:Buffer.from(artSvg(i))}]).png().toBuffer();
   await writeFile(`${dir}/${w.id}-seed.png`, art);
 }
}
export function seedScenario(selected=walls,fixture=true) {
 const id=randomUUID();
 return { id, startedAt:START, now:START+60000, playing:false, anchor:Date.now(), speed:1, version:1, attempts:{},
   walls:Object.fromEntries(selected.map((w,i)=>[w.id, [
    {id:`${id}-${w.id}-0`, no:0, start:START, end:fixture&&i<9?START+60000:null, title:'0番目の作品', author:'SYSTEM', image:`${w.id}-base.png`, createdAt:START, source:null},
    ...(fixture&&i<9?[{id:`${id}-${w.id}-1`,no:1,start:START+60000,end:null,title:['街に、ひと筆。','路地からこんにちは','Stay curious','小さな開花','遊びの余白','東京のリズム'][i%6],author:['AOI','NAGI','Haru'][i%3],image:`${w.id}-seed.png`,createdAt:START+60000,source:{no:0,asOf:START+60000,progress:1000}}]:[])
   ]])) };
}
