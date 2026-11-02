import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { triangulate, project } from './plateau-geometry.mjs';

const output = 'public/assets/universal-pipeline-demo';
const geometryPath = 'data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json';
const buildingId = 'bldg_cc9846aa-6527-4dc0-8d4d-fae87a2300ec';
const commonsPageId = '115209288';
const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&pageids=${commonsPageId}&iiprop=url%7Cextmetadata%7Csize&iiurlwidth=1200`;

await mkdir(output, { recursive: true });
const geometry = JSON.parse(await readFile(geometryPath, 'utf8'));
const building = geometry.buildings.find(item => item.id === buildingId);
if (!building) throw new Error(`Building ${buildingId} was not found`);

const page = (await (await fetch(api)).json()).query.pages[commonsPageId];
const imageInfo = page.imageinfo[0];
const sourceBytes = Buffer.from(await (await fetch(imageInfo.thumburl)).arrayBuffer());
await writeFile(`${output}/candidate-photo.jpg`, sourceBytes);
const metadata = await sharp(sourceBytes).metadata();
const crop = {
  left: Math.round(metadata.width * 0.61),
  top: Math.round(metadata.height * 0.43),
  width: Math.round(metadata.width * 0.39),
  height: Math.round(metadata.height * 0.48)
};
const facadeTexture = await sharp(sourceBytes)
  .extract(crop)
  .resize(1024, 1024, { fit: 'cover' })
  .jpeg({ quality: 90 })
  .toBuffer();
await writeFile(`${output}/facade-material-estimate.jpg`, facadeTexture);

const camera = project(
  Number(imageInfo.extmetadata.GPSLatitude.value),
  Number(imageInfo.extmetadata.GPSLongitude.value),
  2,
  geometry.origin
);
const walls = new Set(building.walls.map(wall => wall.id));
const wallDistances = building.walls.map(wall => {
  const points = wall.rings[0].points;
  const center = points[0].map((_, axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
  return { id: wall.id, distance: Math.hypot(center[0] - camera[0], center[2] - camera[2]) };
}).sort((a, b) => a.distance - b.distance);
const selectedWallId = wallDistances[0].id;

async function createModel(mode) {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene('PLATEAU universal one-building comparison');
  const node = document.createNode(buildingId);
  const mesh = document.createMesh(buildingId);
  node.setMesh(mesh);
  scene.addChild(node);
  const unlit = document.createExtension(KHRMaterialsUnlit);

  const neutral = document.createMaterial('geometry-only')
    .setBaseColorFactor([0.68, 0.7, 0.68, 1])
    .setDoubleSided(true)
    .setExtension('KHR_materials_unlit', unlit.createUnlit());
  const estimated = document.createMaterial('estimated-wall-material')
    .setBaseColorFactor([0.62, 0.66, 0.68, 1])
    .setDoubleSided(true)
    .setExtension('KHR_materials_unlit', unlit.createUnlit());
  const unknown = document.createMaterial('unconfirmed-surface')
    .setBaseColorFactor([0.48, 0.5, 0.47, 1])
    .setDoubleSided(true)
    .setExtension('KHR_materials_unlit', unlit.createUnlit());
  const photo = document.createMaterial('candidate-photo-material-estimate')
    .setBaseColorTexture(document.createTexture('Commons candidate crop').setImage(facadeTexture).setMimeType('image/jpeg'))
    .setDoubleSided(true)
    .setExtension('KHR_materials_unlit', unlit.createUnlit());

  const accessor = (name, type, values, ArrayType = Float32Array) => document.createAccessor(name)
    .setType(type)
    .setArray(new ArrayType(values))
    .setBuffer(buffer);

  for (const polygon of building.polygons) {
    const shape = triangulate(polygon.rings.map(ring => ring.points));
    if (!shape.indices.length) continue;
    const primitive = document.createPrimitive()
      .setAttribute('POSITION', accessor(`${polygon.id}-position`, 'VEC3', shape.points.flat()))
      .setIndices(accessor(`${polygon.id}-indices`, 'SCALAR', shape.indices, Uint32Array));
    if (mode === 'geometry') {
      primitive.setMaterial(neutral);
    } else if (polygon.id === selectedWallId) {
      const pairs = [];
      for (let index = 0; index < shape.flat.length; index += 2) pairs.push([shape.flat[index], shape.flat[index + 1]]);
      const minU = Math.min(...pairs.map(pair => pair[0]));
      const maxU = Math.max(...pairs.map(pair => pair[0]));
      const minV = Math.min(...pairs.map(pair => pair[1]));
      const maxV = Math.max(...pairs.map(pair => pair[1]));
      const uv = pairs.flatMap(([u, v]) => [(u - minU) / Math.max(1e-6, maxU - minU), (v - minV) / Math.max(1e-6, maxV - minV)]);
      primitive.setAttribute('TEXCOORD_0', accessor(`${polygon.id}-uv`, 'VEC2', uv)).setMaterial(photo);
    } else {
      primitive.setMaterial(walls.has(polygon.id) ? estimated : unknown);
    }
    mesh.addPrimitive(primitive);
  }

  document.getRoot().getAsset().copyright = 'PLATEAU / Tokyo 2025; candidate photo © Marko Kudjerski, CC BY 2.0; automatic low-confidence material assignment by OpenGraffiti';
  await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write(`${output}/${mode === 'geometry' ? 'geometry-only' : 'reconstructed'}.glb`, document);
}

await createModel('geometry');
await createModel('reconstructed');

const surfaceConfidence = building.polygons.map(polygon => ({
  surfaceId: polygon.id,
  classification: polygon.id === selectedWallId ? 'photo-derived-material-estimate' : walls.has(polygon.id) ? 'material-estimate' : 'unconfirmed',
  confidence: polygon.id === selectedWallId ? 0.48 : walls.has(polygon.id) ? 0.34 : 0.18,
  sourceImage: polygon.id === selectedWallId ? 'candidate-photo.jpg' : null,
  cameraAccuracy: polygon.id === selectedWallId ? 'position-only; pose-unverified' : 'not-applicable',
  textureResolution: polygon.id === selectedWallId ? [1024, 1024] : null
}));

const provenance = {
  buildingId,
  geometry: { source: geometryPath, dataset: 'PLATEAU Minato-ku 2025', lod: building.lod },
  candidatePhoto: {
    commonsPageId: Number(commonsPageId),
    title: page.title,
    descriptionUrl: imageInfo.descriptionurl,
    localFile: 'candidate-photo.jpg',
    author: 'Marko Kudjerski',
    license: imageInfo.extmetadata.LicenseShortName.value,
    licenseUrl: imageInfo.extmetadata.LicenseUrl.value,
    capturePosition: [Number(imageInfo.extmetadata.GPSLongitude.value), Number(imageInfo.extmetadata.GPSLatitude.value)],
    capturePositionLocal: camera,
    captureTime: imageInfo.extmetadata.DateTimeOriginal.value
  },
  selection: { method: 'nearest geotagged licensed candidate', distanceMetres: wallDistances[0].distance },
  geometryMatching: { method: 'nearest WallSurface from capture position', selectedWallId },
  cameraEstimation: { status: 'position-only', pose: 'unverified' },
  assignment: { method: 'photo-derived material estimate on selected wall; confidence fallback elsewhere' },
  limitation: 'The candidate image supplies a low-confidence facade material estimate. It is not claimed as metrically registered photographic reconstruction.'
};

const counts = Object.fromEntries([...Map.groupBy(surfaceConfidence, surface => surface.classification)].map(([key, value]) => [key, value.length]));
const report = {
  status: 'comparison-ready',
  comparison: { left: 'geometry-only.glb', right: 'reconstructed.glb', sameBuildingGeometry: true },
  buildingId,
  buildingLod: building.lod,
  polygonCount: building.polygons.length,
  wallSurfaceCount: building.walls.length,
  candidatePhotoCount: 1,
  selectedPhotoCount: 1,
  surfaceClasses: counts,
  overallConfidence: Number((surfaceConfidence.reduce((sum, surface) => sum + surface.confidence, 0) / surfaceConfidence.length).toFixed(3)),
  verdict: 'Universal low-confidence path demonstrated; strict camera registration was not reached and is represented in metadata.'
};

await writeFile(`${output}/confidence.json`, JSON.stringify({ buildingId, surfaces: surfaceConfidence }, null, 2));
await writeFile(`${output}/provenance.json`, JSON.stringify(provenance, null, 2));
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
