import { readFile } from 'node:fs/promises';
import { triangulate, sub, cross } from './plateau-geometry.mjs';

const areaId = process.argv[2] || 'tocho';
const buildingId = process.argv[3] || 'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';

if (!['tocho', 'tokyo-tower'].includes(areaId)) throw new Error('Specify tocho or tokyo-tower');

const catalog = JSON.parse(await readFile('shared/generated/plateau.json', 'utf8'));
const area = catalog.areas.find((candidate) => candidate.id === areaId);
if (!area) throw new Error(`Unknown area: ${areaId}`);

const meshCode = areaId === 'tocho' ? '53394525' : '53393599';
const geometry = JSON.parse(await readFile(`data/plateau/${area.dataset}/${meshCode}-geometry.json`, 'utf8'));
const projection = JSON.parse(await readFile(`data/texture-city/msls/snap-surfaces-${areaId}.json`, 'utf8'));
const inputs = JSON.parse(await readFile(`data/texture-city/msls/snap-inputs-${areaId}.json`, 'utf8'));

let registration = null;
try {
  registration = JSON.parse(await readFile(`data/texture-city/msls/snap-local-registration-${areaId}.json`, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const building = geometry.buildings.find((candidate) => candidate.id === buildingId);
if (!building) throw new Error(`Building not found: ${buildingId}`);

const triangleArea = (triangle) => Math.hypot(...cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))) / 2;

function wallArea(wall) {
  const mesh = triangulate(wall.rings.map((ring) => ring.points));
  let total = 0;
  for (let index = 0; index + 2 < mesh.indices.length; index += 3) {
    total += triangleArea(mesh.indices.slice(index, index + 3).map((vertex) => mesh.points[vertex]));
  }
  return total;
}

const wallAreas = new Map(building.walls.map((wall) => [wall.id, wallArea(wall)]));
const totalWallArea = [...wallAreas.values()].reduce((sum, value) => sum + value, 0);
const projectedSurfaces = projection.surfaces.filter((surface) => surface.buildingId === buildingId);
const projectedArea = projectedSurfaces.reduce((sum, surface) => sum + (surface.area || 0), 0);
const projectedWallIds = new Set(projectedSurfaces.map((surface) => surface.wallId || surface.surfaceId || surface.key).filter(Boolean));
const sourceIds = [...new Set(projectedSurfaces.flatMap((surface) => surface.sourceMappings?.map((mapping) => mapping.sourceId) ?? (surface.sourceId ? [surface.sourceId] : [])))];
const buildingProjection = projection.buildings.find((candidate) => candidate.buildingId === buildingId) || null;

const center = building.min.map((value, index) => (value + building.max[index]) / 2);
const nearbyInputs = inputs.photos.filter((photo) => Math.hypot(photo.position[0] - center[0], photo.position[2] - center[2]) < 150);
const registrationBySource = new Map((registration?.registrations || []).map((item) => [item.sourceId, item]));
const nearbyRegistration = nearbyInputs.map((photo) => {
  const item = registrationBySource.get(photo.id);
  return {
    sourceId: photo.id,
    distanceMetres: Math.hypot(photo.position[0] - center[0], photo.position[2] - center[2]),
    accepted: item?.accepted ?? null,
    reason: item?.reason ?? item?.metrics?.reason ?? null,
    targetBuildingId: item?.metrics?.targetBuildingId ?? null,
    targetBuildingIds: item?.metrics?.targetBuildingIds ?? [],
    targetProjectedArea: item?.metrics?.targetProjectedArea ?? 0,
    anchorErrorMetres: item?.metrics?.anchorErrorMetres ?? photo.anchorErrorMetres ?? null,
    heldOutErrorPixels: item?.metrics?.heldOutErrorPixels ?? item?.metrics?.heldOutMedianErrorPixels ?? null,
    poseQuality: item?.metrics?.poseQuality ?? null,
  };
});

const rejectionReasons = nearbyRegistration.reduce((counts, row) => {
  const key = row.accepted ? 'accepted' : (row.reason || 'not-assessed');
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

const summary = {
  areaId,
  building: {
    id: building.id,
    name: building.name,
    lod: building.lod,
    wallCount: building.walls.length,
    totalWallArea,
  },
  projectionMode: projection.policy,
  projection: {
    matchedWallSurfaceCount: projectedSurfaces.length,
    projectedArea,
    trueExternalAreaCoverage: totalWallArea ? projectedArea / totalWallArea : 0,
    sourceImageCount: sourceIds.length,
    sourceIds,
    buildingProjection,
  },
  candidates: {
    preparedPhotos: inputs.photos.length,
    within150m: nearbyInputs.length,
    registrationAssessed: nearbyRegistration.filter((row) => row.accepted !== null).length,
    registrationAccepted: nearbyRegistration.filter((row) => row.accepted === true).length,
    acceptedForTargetIdentity: nearbyRegistration.filter((row) => row.accepted === true && row.targetBuildingIds.includes(buildingId)).length,
    rejectionReasons,
    nearbyRegistration: nearbyRegistration.sort((a, b) => a.distanceMetres - b.distanceMetres),
  },
  surfaceCoverage: projectedSurfaces.map((surface) => ({
    key: surface.key,
    wallId: surface.wallId || surface.surfaceId || null,
    projectedArea: surface.area || 0,
    geometryArea: surface.geometryArea || null,
    coverageRatio: surface.coverageRatio || null,
    sourceIds: surface.sourceIds ?? (surface.sourceId ? [surface.sourceId] : []),
  })).sort((a, b) => b.projectedArea - a.projectedArea),
  projectedWallIds: [...projectedWallIds],
};

console.log(JSON.stringify(summary, null, 2));
