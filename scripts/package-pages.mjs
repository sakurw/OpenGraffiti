import {readFile,copyFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
const output=process.argv[2]||'dist';
const files=new Set(['artworks/tocho-neon-tide.recipe.json']);
for(const scope of ['pv-adopted-20261029','pv-expanded-20261102']){
 const base='assets/'+scope;
 for(const file of ['manifest.json','city.glb','roads.json','flat-layout.json','walk-terrain.glb','walk-surface.json','walk-surface-map.png'])files.add(base+'/'+file);
 const buffer=await readFile('public/'+base+'/city.glb');
 const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString());
 for(const material of gltf.materials||[])if(material.extras?.atlasUrl)files.add(material.extras.atlasUrl.replace(/^\//,''));
}
let bytes=0;
for(const file of files){const target=output+'/' +file;await mkdir(dirname(target),{recursive:true});await copyFile('public/'+file,target);bytes+=(await stat(target)).size;}
for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md']){try{await copyFile(file,output+'/' +file);}catch(e){if(e.code!=='ENOENT')throw e;}}
await writeFile(output+'/.nojekyll','');
await writeFile(output+'/404.html',`<!doctype html><html lang="ja"><meta charset="utf-8"><title>OpenGraffiti</title><script>const base='/OpenGraffiti/';const route=location.pathname.slice(base.length-1)+location.search+location.hash;location.replace(base+'?__pages_route='+encodeURIComponent(route));</script><a href="/OpenGraffiti/">OpenGraffiti を開く</a></html>`);
await writeFile(output+'/deployment.json',JSON.stringify({source:'9af086a',files:files.size,assetBytes:bytes},null,2));
console.log(`Pages: ${files.size} runtime assets, ${(bytes/1024/1024).toFixed(1)} MiB; original geometry and textures copied unchanged.`);
