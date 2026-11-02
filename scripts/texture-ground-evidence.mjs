// Apply only accepted external-camera evidence. A common geometric partition
// makes the union area independent of photo count and prevents double counting.
import {readFile, writeFile, readdir, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import {Document, NodeIO} from '@gltf-transform/core';
import {BufferGeometry, Float32BufferAttribute} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {triangulate, sub, cross} from './plateau-geometry.mjs';
import {validateGroundCamera} from './texture-ground-camera.mjs';
import {createGroundSurfaceTester} from './texture-ground-surface.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(2,i),v.slice(i+1)];}));
const provider = args.provider ?? 'commons';
if (!['commons','kartaview','msls'].includes(provider)) throw Error('Unknown provider');
const buildingId = args.building ?? 'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const geometryPath = args.geometry ?? 'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
const bytes = await readFile(geometryPath), g = JSON.parse(bytes);
const b = g.buildings.find(b=>b.id===buildingId);
if (!b) throw Error('Target building missing');
const hash = v=>createHash('sha256').update(v).digest('hex');
const geometryHash = hash(bytes);
const sourceRoot = `data/texture-city/photos/${provider}`;
const root = `data/texture-city/${provider}`;
const out = args.output ?? `public/assets/ground-evidence/${buildingId}`;
const sourceIds=args.sources?.split(',');
const registrationRoot=args.registrations??`${root}/control-registration`;
if(args.registrations&&!args.output)throw Error('Alternative registrations require isolated output');
await mkdir(out,{recursive:true});
const accepted = [], rejected = [];
for (const file of await readdir(registrationRoot)) {
  if (!file.endsWith('.json')) continue;
  const regBytes = await readFile(`${registrationRoot}/${file}`), r = JSON.parse(regBytes);
  if (r.buildingId!==buildingId) continue;
  if(sourceIds&&!sourceIds.includes(r.sourceId))continue;
  if (!r.accepted) {rejected.push({sourceId:r.sourceId,reasons:r.rejectionReasons});continue;}
  if (r.geometrySha256!==geometryHash) throw Error('Registration geometry is stale');
  if (!r.configPath || hash(await readFile(r.configPath))!==r.configSha256) throw Error('Registration controls are stale');
  if (!r.supportedHeightRangeMetres) throw Error('Missing validated height support');
  validateGroundCamera(r);
  if(r.independentLensCalibration) {
    const lens=r.independentLensCalibration,blob=await readFile(lens.path);
    if(hash(blob)!==lens.sha256)throw Error('Shared lens calibration is stale');
    const record=JSON.parse(blob);
    if(!record.consistentRotationHypothesis)throw Error('Shared lens validation failed');
    for(const [file,expected] of Object.entries(lens.pairSha256))if(hash(await readFile(file))!==expected)throw Error('Shared lens pair calibration is stale');
    for(const source of record.sources)if(hash(await readFile(`data/texture-city/photos/commons/${source.sourceId}.jpg`))!==source.sha256)throw Error('Shared lens source image is stale');
  }
  const meta = JSON.parse(await readFile(`${sourceRoot}/${r.sourceId}.json`,'utf8'));
  const photoBytes = await readFile(`${sourceRoot}/${r.sourceId}.jpg`);
  if (hash(photoBytes)!==r.sourceSha256 || meta.sha256!==r.sourceSha256) throw Error('Source photo hash mismatch');
  if (provider==='commons' && !/^(CC BY(?:-SA)? [\d.]+|CC0|Public domain)$/i.test(meta.license)) throw Error('Unverified Commons license');
  const maskMeta = JSON.parse(await readFile(`${root}/facade-masks/${r.sourceId}.json`,'utf8'));
  if (maskMeta.sourceSha256!==r.sourceSha256) throw Error('Mask photo hash mismatch');
  const maskBytes = await readFile(`${root}/facade-masks/${r.sourceId}.png`);
  // Erode in source-image pixels by measured pose uncertainty and a small
  // segmentation margin; do not count uncertain silhouette/foreground borders.
  const heldErrors = r.controls.map((c,i)=>c.role==='held-out'?r.pointErrorsPixels[i]:0);
  if(r.positionValidation==='projection-ensemble')heldErrors.push(r.projectionEnsembleValidation.heldOutWorstMaxPixels);
  for(const line of r.lineControlResults??[]) if(line.role==='held-out') heldErrors.push(...line.errorsPixels.map(Math.abs));
  const margin = Math.max(18,Math.ceil(Math.max(...heldErrors)*r.imageSize[0]/r.referenceSize[0]*2)+2);
  // sharp 0.35 morphology operates on black foreground. Dilation of invalid
  // black pixels is erosion of our white-valid mask (erode would expand it).
  const primaryMask = await sharp(maskBytes).greyscale().threshold(254).raw().toBuffer();
  const {data:mask,info} = await sharp(maskBytes).greyscale().threshold(254).dilate(margin).raw().toBuffer({resolveWithObject:true});
  if (info.width!==r.imageSize[0] || info.height!==r.imageSize[1]) throw Error('Mask dimensions mismatch');
  let validBefore=0,validAfter=0;
  for(let i=0;i<mask.length;i++) {
    if(primaryMask[i]===255)validBefore++;
    if(mask[i]===255){validAfter++;if(primaryMask[i]!==255)throw Error('Uncertainty margin expanded the accepted mask');}
  }
  accepted.push({...r,meta,photoBytes,mask,margin,validBefore,validAfter,registrationSha256:hash(regBytes),maskSha256:hash(maskBytes),reasons:{},area:0});
}
const scenePositions=[];
for(const building of g.buildings) for(const poly of building.polygons) {
  const t=triangulate(poly.rings.map(r=>r.points));
  for(const i of t.indices) scenePositions.push(...t.points[i]);
}
const sceneGeometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(scenePositions,3));
const bvh=new MeshBVH(sceneGeometry);
const triangleArea=t=>Math.hypot(...cross(sub(t[1],t[0]),sub(t[2],t[0])))/2;
const mid=(a,b)=>a.map((v,i)=>(v+b[i])/2);
function* split(t,depth=0) {
  const lengths=t.map((p,i)=>Math.hypot(...sub(p,t[(i+1)%3]))),length=Math.max(...lengths);
  if(length<=2||depth>=18) {yield t;return;}
  const i=lengths.indexOf(length),a=t[i],b=t[(i+1)%3],c=t[(i+2)%3],m=mid(a,b);
  yield*split([a,m,c],depth+1);yield*split([m,b,c],depth+1);
}
const test=createGroundSurfaceTester(bvh);
const buckets=new Map([['uncovered',{positions:[],normals:[],uv:[]}]]);
for(const r of accepted) buckets.set(r.sourceId,{positions:[],normals:[],uv:[]});
const wallIds=new Set(b.walls.map(w=>w.id));
let totalArea=0,coveredArea=0,totalTriangles=0,coveredTriangles=0;
const walls=[];
for(const poly of b.polygons) {
  const mesh=triangulate(poly.rings.map(r=>r.points)),isWall=wallIds.has(poly.id);
  const row={polygonId:poly.id,geometryArea:0,externalArea:0,sources:{}};
  for(let i=0;i<mesh.indices.length;i+=3) {
    const base=mesh.indices.slice(i,i+3).map(k=>mesh.points[k]);
    const partition=isWall?split(base):[base];
    for(const tri of partition) {
      const area=triangleArea(tri);if(area<1e-12) continue;
      let chosen=null,quality=null;
      if(isWall) {
        totalTriangles++;totalArea+=area;row.geometryArea+=area;
        for(const r of accepted) {
          const q=test(r,tri,mesh.normal);
          if(q.reason) {r.reasons[q.reason]=(r.reasons[q.reason]||0)+1;continue;}
          if(!quality||q.score>quality.score) {chosen=r;quality=q;}
        }
      }
      if(chosen) {
        coveredArea+=area;coveredTriangles++;row.externalArea+=area;chosen.area+=area;
        row.sources[chosen.sourceId]=(row.sources[chosen.sourceId]||0)+area;
      }
      const bucket=buckets.get(chosen?.sourceId??'uncovered');
      bucket.positions.push(...tri.flat());bucket.normals.push(...mesh.normal,...mesh.normal,...mesh.normal);
      if(chosen) bucket.uv.push(...quality.uv.flat());
    }
  }
  if(isWall) walls.push(row);
}
sceneGeometry.dispose();
// Both models use exactly the same partition of the original building mesh.
async function writeModel(textured,file) {
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();
  const mesh=doc.createMesh();
  const neutral=doc.createMaterial('Unverified / neutral').setBaseColorFactor([.68,.7,.72,1]).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true);
  for(const [key,bucket] of buckets) {
    if(!bucket.positions.length) continue;
    let material=neutral;
    if(textured&&key!=='uncovered') {
      const r=accepted.find(r=>r.sourceId===key),texture=doc.createTexture(key).setMimeType('image/jpeg').setImage(r.photoBytes);
      material=doc.createMaterial(`External photo ${key}`).setBaseColorTexture(texture).setMetallicFactor(0).setRoughnessFactor(1).setDoubleSided(true);
    }
    const primitive=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(bucket.positions)).setBuffer(buffer))
      .setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(new Float32Array(bucket.normals)).setBuffer(buffer)).setMaterial(material);
    if(textured&&key!=='uncovered') primitive.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(bucket.uv)).setBuffer(buffer));
    mesh.addPrimitive(primitive);
  }
  scene.addChild(doc.createNode(b.name||buildingId).setMesh(mesh));
  await new NodeIO().write(file,doc);
}
await writeModel(false,`${out}/neutral.glb`);
await writeModel(true,`${out}/external.glb`);
for(const r of accepted) {
  await copyFile(`${sourceRoot}/${r.sourceId}.jpg`,`${out}/source-${r.sourceId}.jpg`);
  // A display-only derivative avoids severe aliasing when the browser reduces
  // a 2K photo to a 100px card. GLB evidence still embeds the unchanged source.
  await sharp(r.photoBytes).resize(200,200,{fit:'cover'}).jpeg({quality:92}).toFile(`${out}/thumb-${r.sourceId}.jpg`);
}
const report={buildingId,buildingName:b.name,provider,geometryPath,geometrySha256:geometryHash,createdAt:new Date().toISOString(),
 totalWallSurfaces:walls.length,totalWallAreaSquareMetres:totalArea,externalEvidenceAreaSquareMetres:coveredArea,
 strictExternalAreaCoverage:totalArea?coveredArea/totalArea:0,goalThreshold:.9,goalReached:coveredArea/totalArea>.9,
 totalTriangles,coveredTriangles,walls,sources:accepted.map(r=>({id:r.sourceId,sourcePage:r.meta.sourcePage,author:r.meta.author,license:r.meta.license,licenseUrl:r.meta.licenseUrl,
 sourceSha256:r.sourceSha256,registrationSha256:r.registrationSha256,maskSha256:r.maskSha256,areaSquareMetres:r.area,
 trainingRmsPixels:r.trainingRmsPixels,heldOutRmsPixels:r.heldOutRmsPixels,supportedHeightRangeMetres:r.supportedHeightRangeMetres,
 cameraModel:r.cameraModel??'pinhole',distortionCoefficients:r.distortionCoefficients??[0,0,0,0,0],
 positionValidation:r.positionValidation,projectionEnsembleCameras:r.projectionEnsemble?.length??0,requiresPerSurfaceEnsembleValidation:r.requiresPerSurfaceEnsembleValidation??false,
 projectionEnsemblePolicy:r.projectionEnsemblePolicy,
 supportPolicy:r.supportPolicy,lineControlResults:r.lineControlResults??[],
 referenceSize:r.referenceSize,maskMarginPixels:r.margin,maskValidPixelsBeforeMargin:r.validBefore,maskValidPixelsAfterMargin:r.validAfter,rejectionCounts:r.reasons})),rejectedRegistrations:rejected,
 policy:'Area-weighted union of disjoint PLATEAU wall subtriangles, max edge 2m; accepted external ground-photo camera controls, held-out checks, validated height range, 7 visibility samples, full urban BVH occlusion, two-model semantic facade agreement, measured-uncertainty margin and >=2 pixels/metre. Neutral surfaces and PLATEAU-native imagery do not contribute.'};
if(!args.output)await writeFile(`${root}/evidence-${buildingId}.json`,JSON.stringify(report,null,2));
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({totalArea,coveredArea,coverage:report.strictExternalAreaCoverage,sources:report.sources.map(s=>({id:s.id,area:s.areaSquareMetres})),goalReached:report.goalReached,out}));
