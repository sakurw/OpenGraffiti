import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
const dir=(process.env.PV_MODEL_DIR||'public/assets/pv-adopted-20261029')+'/',manifest=JSON.parse(await fs.readFile(dir+'manifest.json')),field=JSON.parse(await fs.readFile(dir+'walk-surface.json')),bytes=await fs.readFile(dir+'city.glb'),doc=await new NodeIO().readBinary(bytes),by=new Map(manifest.buildings.flatMap(b=>b.parts.map(p=>[p,b.id]))),bottoms=new Map();
for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()){const id=by.get(p.getMaterial()?.getExtras().partKey);if(!id)continue;const a=p.getAttribute('POSITION').getArray();let low=bottoms.get(id)??Infinity;for(let i=1;i<a.length;i+=3)low=Math.min(low,a[i]);bottoms.set(id,low);}
if(bottoms.size!==manifest.buildingCount)throw Error('Missing adopted buildings');
const hash=async name=>createHash('sha256').update(await fs.readFile(dir+name)).digest('hex');
if(await hash('city.glb')!==manifest.modelSha256)throw Error('Source model hash mismatch');
const config={version:1,mode:'flat',height:0,minX:field.minX,minZ:field.minZ,step:field.step,nx:field.nx,nz:field.nz,offsets:Object.fromEntries([...bottoms].map(([id,y])=>[id,-y])),sourceModelSha256:createHash('sha256').update(bytes).digest('hex'),constrainedSurface:'walk-surface.json',method:'Runtime vertical translation of each complete original building; original geometry, UVs, X/Z positions and source assets remain unchanged.'};
config.recovery={procedure:'scripts/build-pv-smooth-terrain.mjs',files:{'walk-terrain.glb':await hash('walk-terrain.glb'),'walk-surface.json':await hash('walk-surface.json')}};
await fs.writeFile(dir+'flat-layout.json',JSON.stringify(config,null,2)+'\n');await fs.mkdir('dist/'+dir.replace(/^public\//,''),{recursive:true});await fs.copyFile(dir+'flat-layout.json','dist/'+dir.replace(/^public\//,'')+'/flat-layout.json');console.log({buildings:bottoms.size,flatHeight:0,sourceModelSha256:config.sourceModelSha256});
