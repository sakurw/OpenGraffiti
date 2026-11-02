// Audit real GLB bytes against rectified source pixels and the complete catalog.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {KHRMaterialsUnlit} from '@gltf-transform/extensions';
import sharp from 'sharp';
const area=process.argv[2];assert.ok(['tocho','tokyo-tower'].includes(area));
const root='data/texture-city/kartaview',hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(`${root}/snap-surfaces-${area}.json`),surfaces=JSON.parse(bytes),reportBytes=await readFile(`public/assets/texture-poc/experimental/snap-sfm/${area}.json`),report=JSON.parse(reportBytes),rectified=JSON.parse(await readFile(`${root}/snap-rectified-${area}/report.json`,'utf8'));
assert.equal(report.inputSurfaceSha256,hash(bytes));assert.equal(rectified.surfaceRecordSha256,hash(bytes));
assert.equal(report.snapCommit,'d194f8891eddb965af1894e5cc6b67541ca7f307');
const catalog=JSON.parse(await readFile('public/assets/texture-poc/city-catalog.json','utf8')),expected=catalog.buildings.filter(b=>b.areaId===area);
assert.equal(report.scope.kind,'all-buildings');assert.equal(report.totalBuildings,expected.length);
assert.deepEqual(report.coverage.map(b=>b.buildingId).sort(),expected.map(b=>b.id).sort());
const modelBytes=await readFile('public'+report.model),doc=await new NodeIO().registerExtensions([KHRMaterialsUnlit]).readBinary(modelBytes),byBuilding=new Map(),colors=[],sourceImages=new Map();let triangles=0;
for(const s of report.sources){
 const photo=surfaces.photos.find(p=>p.id===s.id);assert.equal(s.sourceSha256,photo.sourceSha256);assert.equal(s.provider,'kartaview');
 assert.equal(hash(await readFile(`data/texture-city/photos/kartaview/${s.id}.jpg`)),s.sourceSha256);
 assert.equal(hash(await readFile(photo.alignmentSource)),s.alignmentSha256);assert.ok(photo.anchorErrorMetres<=10);
 const image=await readFile(photo.imagePath);assert.equal(hash(image),photo.imageSha256);
 sourceImages.set(s.id,await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true}));
}
const pixel=(im,x,y)=>{x=Math.max(0,Math.min(im.info.width-1,Math.round(x)));y=Math.max(0,Math.min(im.info.height-1,Math.round(y)));const offset=(y*im.info.width+x)*4;return Array.from(im.data.slice(offset,offset+4));};
for(const node of doc.getRoot().listNodes())if(node.getMesh()){
 const meta=node.getExtras(),surface=surfaces.surfaces.find(s=>s.key===node.getName()),textureRecord=rectified.textures.find(t=>t.key===node.getName());assert.ok(surface&&textureRecord);
 assert.equal(meta.buildingId,surface.buildingId);assert.equal(meta.sourceId,surface.sourceId);
 const photo=surfaces.photos.find(p=>p.id===surface.sourceId),source=sourceImages.get(photo.id);assert.ok(source);
 assert.equal(meta.sourceSha256,photo.sourceSha256);
 const primitives=node.getMesh().listPrimitives();assert.equal(primitives.length,1);const primitive=primitives[0],p=primitive.getAttribute('POSITION').getArray(),uv=primitive.getAttribute('TEXCOORD_0').getArray();
 assert.equal(primitive.getIndices(),null);assert.deepEqual(p,new Float32Array(surface.positions.map((v,i)=>v+surface.normal[i%3]*.025)));assert.deepEqual(uv,new Float32Array(surface.uv));
 assert.equal(primitive.getMaterial().getAlphaMode(),'MASK');const image=primitive.getMaterial().getBaseColorTexture().getImage();assert.equal(hash(image),textureRecord.sha256);
 const texture=await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 byBuilding.set(meta.buildingId,(byBuilding.get(meta.buildingId)||0)+surface.area);triangles+=p.length/9;
 const stride=Math.max(1,Math.ceil(p.length/9/100));
 for(let t=0;t<p.length/9;t+=stride){
  const xyz=[0,1,2].map(k=>(surface.positions[t*9+k]+surface.positions[t*9+k+3]+surface.positions[t*9+k+6])/3),v=photo.camFromWorld.map(r=>r[0]*xyz[0]+r[1]*xyz[1]+r[2]*xyz[2]+r[3]),k=photo.cameraMatrix;
  const q=[k[0][0]*v[0]/v[2]+k[0][2],k[1][1]*v[1]/v[2]+k[1][2]],tex=[0,1].map(k=>(uv[t*6+k]+uv[t*6+k+2]+uv[t*6+k+4])/3);
  const a=pixel(source,...q),b=pixel(texture,tex[0]*(texture.info.width-1),tex[1]*(texture.info.height-1));if(b[3]<128)continue;
  colors.push((Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3);
 }
}
assert.deepEqual([...byBuilding.keys()].sort(),report.buildings.map(b=>b.buildingId).sort());assert.equal(report.projectedBuildings,byBuilding.size);
for(const row of report.coverage){const area=byBuilding.get(row.buildingId)||0;assert.ok(Math.abs(area-row.projectedArea)<1e-6);assert.ok(area<=expected.find(b=>b.id===row.buildingId).wallArea+.01);}
colors.sort((a,b)=>a-b);const median=colors[Math.floor(colors.length/2)];assert.ok(colors.length>0);assert.ok(median<25,'Rectified source pixel correspondence failed');
const result={area,modelSha256:hash(modelBytes),reportSha256:hash(reportBytes),totalBuildings:expected.length,projectedBuildings:byBuilding.size,triangles,sourceColorSamples:colors.length,medianSourceColorError:median,p95SourceColorError:colors[Math.floor(colors.length*.95)],
 note:'Verifies artifact, source pixel mapping and accounting; NOT photo-to-building identity, camera accuracy, complete facade restoration or independent capture.'};
await writeFile(`${root}/snap-audit-${area}.json`,JSON.stringify(result,null,2));console.log(result);
