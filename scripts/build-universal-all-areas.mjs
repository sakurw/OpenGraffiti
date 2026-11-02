import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import {EXTMeshoptCompression,KHRMaterialsUnlit} from '@gltf-transform/extensions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';

// Batch applies appearance stabilization to *all* geometry already present in
// the official-source PLATEAU area extracts. No external image is presented as
// camera-registered evidence here. Geometry, UV and mesh partitions are kept.
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions([EXTMeshoptCompression,KHRMaterialsUnlit])
  .registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const root='public/assets/datasets/plateau-2025-v4';
const out='public/assets/universal-all-areas';
await mkdir(out,{recursive:true});
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const output={method:'appearance-stabilization-v1',source:'PLATEAU 2025 v4 area GLBs',scope:'every building included in the two source-area extracts',limitations:'Uses PLATEAU appearance; no per-building external-photo camera registration or facade semantic reconstruction.',areas:[]};
for(const areaId of ['tocho','tokyo-tower']){
  const area=JSON.parse(await readFile(`${root}/areas/${areaId}.json`,'utf8'));
  const input=await readFile(`${root}/models/${areaId}.glb`);
  const document=await io.readBinary(input);
  const before=document.getRoot().listMeshes().map(mesh=>mesh.listPrimitives().map(p=>({
    positions:digest(Buffer.from(p.getAttribute('POSITION').getArray().buffer)),
    indices:digest(Buffer.from(p.getIndices().getArray().buffer)),
    uv:digest(Buffer.from(p.getAttribute('TEXCOORD_0').getArray().buffer))
  })));
  let processed=0;
  for(const texture of document.getRoot().listTextures()){
    const image=texture.getImage();if(!image)continue;
    // Gentle dynamic-range recovery and desaturation reduce strong casts and
    // inconsistent aerial-photo shadows without inventing building features.
    const corrected=await sharp(image).linear(1.035,-3).modulate({saturation:.82})
      .jpeg({quality:89,mozjpeg:true}).toBuffer();
    texture.setImage(corrected).setMimeType('image/jpeg');processed++;
  }
  const after=document.getRoot().listMeshes().map(mesh=>mesh.listPrimitives().map(p=>({
    positions:digest(Buffer.from(p.getAttribute('POSITION').getArray().buffer)),
    indices:digest(Buffer.from(p.getIndices().getArray().buffer)),
    uv:digest(Buffer.from(p.getAttribute('TEXCOORD_0').getArray().buffer))
  })));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error(`Geometry or UV changed: ${areaId}`);
  const file=`${out}/${areaId}-universal.glb`;
  const bytes=await io.writeBinary(document);await writeFile(file,bytes);
  const record={areaId,buildingCount:area.buildingCount,sourceUrl:area.sourceUrl,model:`/assets/universal-all-areas/${areaId}-universal.glb`,baseline:area.model,processedTextures:processed,geometryUvIdentical:true,baselineSha256:digest(input),outputSha256:digest(bytes),bytes:bytes.length};
  output.areas.push(record);console.log(JSON.stringify(record));
}
await writeFile(`${out}/report.json`,JSON.stringify(output,null,2));
