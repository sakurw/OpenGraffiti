import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import { CRS, GEO, triangulate } from './plateau-geometry.mjs';

const geometryPath = process.argv[2] || 'data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json';
const buildingId = process.argv[3] || 'bldg_cc9846aa-6527-4dc0-8d4d-fae87a2300ec';
const radiusMetres = Number(process.argv[4] || 200);
const outputPath = process.argv[5] || 'data/texture-city/universal-msls-candidates.json';
const metadataDir = 'data/texture-city/photos/msls';

const geometry = JSON.parse(await readFile(geometryPath, 'utf8'));
const building = geometry.buildings.find(item => item.id === buildingId);
if (!building) throw new Error(`Building ${buildingId} was not found in ${geometryPath}`);

const vector = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = value => {
  const magnitude = Math.hypot(...value);
  return magnitude > 1e-9 ? value.map(component => component / magnitude) : [0, 0, 0];
};
const centroid = points => [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
const horizontal = value => normalize([value[0], 0, value[2]]);
const clamp01 = value => Math.max(0, Math.min(1, value));

function triangleArea(a, b, c) {
  const u = vector(b, a);
  const v = vector(c, a);
  return 0.5 * Math.hypot(
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0]
  );
}

function polygonArea(shape) {
  let area = 0;
  for (let index = 0; index < shape.indices.length; index += 3) {
    area += triangleArea(shape.points[shape.indices[index]], shape.points[shape.indices[index + 1]], shape.points[shape.indices[index + 2]]);
  }
  return area;
}

const buildingPoints = building.polygons.flatMap(polygon => polygon.rings?.[0]?.points || []);
const buildingCenter = centroid(buildingPoints);
const [centerLon, centerLat] = proj4(CRS, GEO, [buildingCenter[0] + geometry.origin[0], -buildingCenter[2] + geometry.origin[1]]);

const walls = building.walls.map(wall => {
  const shape = triangulate(wall.rings.map(ring => ring.points));
  const center = centroid(wall.rings[0].points);
  let normal = shape.normal;
  if (dot(normal, vector(center, buildingCenter)) < 0) normal = normal.map(value => -value);
  return { surfaceId: wall.id, centroid: center, normal, area: polygonArea(shape) };
});

function projectGps(photo) {
  const [east, north] = proj4(GEO, CRS, [photo.lon, photo.lat]);
  return [east - geometry.origin[0], 2 - geometry.origin[2], -(north - geometry.origin[1])];
}

function headingVector(angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  return [Math.sin(radians), 0, -Math.cos(radians)];
}

function haversineMetres(aLon, aLat, bLon, bLat) {
  const radius = 6371008.8;
  const toRadians = value => value * Math.PI / 180;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

const files = (await readdir(metadataDir)).filter(file => file.endsWith('.json'));
const photos = [];
for (const file of files) {
  const photo = JSON.parse(await readFile(path.join(metadataDir, file), 'utf8'));
  if (!Number.isFinite(photo.lon) || !Number.isFinite(photo.lat) || !Number.isFinite(photo.compassAngle)) continue;
  const buildingDistance = haversineMetres(photo.lon, photo.lat, centerLon, centerLat);
  if (buildingDistance > radiusMetres) continue;
  const camera = projectGps(photo);
  const heading = headingVector(photo.compassAngle);
  const candidates = walls.map(wall => {
    const cameraToWall = vector(wall.centroid, camera);
    const wallToCamera = vector(camera, wall.centroid);
    const distance = Math.hypot(cameraToWall[0], cameraToWall[2]);
    const facingPhoto = clamp01(dot(horizontal(cameraToWall), heading));
    const facingCamera = clamp01(dot(horizontal(wall.normal), horizontal(wallToCamera)));
    const distanceScore = Math.exp(-Math.max(0, distance - 12) / 85);
    const score = facingPhoto * facingCamera * distanceScore;
    return {
      surfaceId: wall.surfaceId,
      score,
      distance,
      facingPhoto,
      facingCamera,
      area: wall.area,
      centroid: wall.centroid,
      normal: wall.normal
    };
  }).sort((a, b) => b.score - a.score);
  photos.push({
    id: photo.id,
    sequenceId: photo.sequenceId,
    sequenceIndex: photo.sequenceIndex,
    shotDate: photo.shotDate,
    lon: photo.lon,
    lat: photo.lat,
    compassAngle: photo.compassAngle,
    downloadSize: photo.downloadSize,
    image: photo.image,
    cameraLocal: camera,
    buildingDistance,
    bestSurface: candidates[0],
    topSurfaces: candidates.slice(0, 4)
  });
}

photos.sort((a, b) => b.bestSurface.score - a.bestSurface.score || a.buildingDistance - b.buildingDistance);
const bestBySequence = new Map();
for (const photo of photos) {
  const previous = bestBySequence.get(photo.sequenceId);
  if (!previous || photo.bestSurface.score > previous.bestSurface.score) bestBySequence.set(photo.sequenceId, photo);
}

const result = {
  generatedAt: new Date().toISOString(),
  geometryPath,
  buildingId,
  buildingLod: building.lod,
  buildingCenterLocal: buildingCenter,
  buildingCenterLonLat: [centerLon, centerLat],
  radiusMetres,
  wallCount: walls.length,
  photoCount: photos.length,
  sequenceCount: bestBySequence.size,
  scoring: {
    formula: 'camera-heading alignment * outward-wall-facing alignment * distance falloff',
    note: 'This ranks likely views only. It does not establish image-to-model registration or visibility through occluders.'
  },
  walls,
  topPhotos: photos.slice(0, 40),
  bestPerSequence: [...bestBySequence.values()].sort((a, b) => b.bestSurface.score - a.bestSurface.score)
};

await writeFile(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  buildingCenterLonLat: result.buildingCenterLonLat,
  wallCount: result.wallCount,
  photoCount: result.photoCount,
  sequenceCount: result.sequenceCount,
  topPhotos: result.topPhotos.slice(0, 12).map(photo => ({
    id: photo.id,
    sequenceId: photo.sequenceId,
    sequenceIndex: photo.sequenceIndex,
    buildingDistance: Number(photo.buildingDistance.toFixed(1)),
    compassAngle: Number(photo.compassAngle.toFixed(1)),
    surfaceId: photo.bestSurface.surfaceId,
    score: Number(photo.bestSurface.score.toFixed(3)),
    facingPhoto: Number(photo.bestSurface.facingPhoto.toFixed(3)),
    facingCamera: Number(photo.bestSurface.facingCamera.toFixed(3)),
    wallDistance: Number(photo.bestSurface.distance.toFixed(1))
  }))
}, null, 2));
