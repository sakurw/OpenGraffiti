import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { triangulate, sub, cross } from './plateau-geometry.mjs';

const areaId = process.argv[2] || 'tocho';
const buildingId = process.argv[3];
const projectionPathArg = process.argv.find((arg) => arg.startsWith('--projection='))?.slice('--projection='.length);
const sourceFilter = process.argv.find((arg) => arg.startsWith('--sources='))?.slice('--sources='.length)?.split(',').filter(Boolean);

const catalog = JSON.parse(await readFile('shared/generated/plateau.json', 'utf8'));
const area = catalog.areas.find((item) => item.id === areaId);
if (!area) throw new Error(`Unknown area: ${areaId}`);

const meshCode = areaId === 'tocho' ? '53394525' : '53393599';
const geometry = JSON.parse(await readFile(`data/plateau/${area.dataset}/${meshCode}-geometry.json`, 'utf8'));
const projection = JSON.parse(await readFile(projectionPathArg || `data/texture-city/msls/snap-surfaces-${areaId}.json`, 'utf8'));

// Multiple acquisition iterations can produce the same wall from different
// photos. Coverage is a union problem, so keep one representative surface per
// wall and preserve all photo provenance on that surface.
function mergeSameWallSurfaces(surfaces) {
  const merged = new Map();
  for (const surface of surfaces) {
    const key = `${surface.buildingId}|${surface.wallId || surface.surfaceId || surface.key}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...surface, sourceMappings: [...(surface.sourceMappings || [])] });
      continue;
    }

    current.sourceIds = [...new Set([...(current.sourceIds || []), ...(surface.sourceIds || [])])];
    current.sourceMappings = [...(current.sourceMappings || []), ...(surface.sourceMappings || [])];
    if ((surface.area || 0) > (current.area || 0)) {
      current.area = surface.area;
      current.coverageRatio = surface.coverageRatio;
    }
  }
  return [...merged.values()];
}

async function applyVisibilityUnion(surface) {
  const mappings = surface.sourceMappings || [];
  // Coverage is derived from visibility masks for every evidence source.
  // A single acquisition photo also needs this path; otherwise the evaluator
  // keeps the old atlas surface area and ignores newly acquired visibility.
  if (!mappings.length) return surface;

  const masks = [];
  for (const mapping of mappings) {
    const path = mapping.visibilityMask?.path;
    if (!path) continue;
    const raw = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
    masks.push(raw);
  }
  if (!masks.length) return surface;

  const width = masks[0].info.width;
  const height = masks[0].info.height;
  const union = Buffer.alloc(width * height);
  for (const mask of masks) {
    if (mask.info.width !== width || mask.info.height !== height) continue;
    for (let i = 0; i < union.length; i++) {
      if (mask.data[i] > union[i]) union[i] = mask.data[i];
    }
  }

  let visiblePixels = 0;
  for (const value of union) {
    if (value >= 128) visiblePixels++;
  }
  const geometryPixels = width * height;
  const coverageRatio = geometryPixels ? visiblePixels / geometryPixels : 0;

  return {
    ...surface,
    area: (surface.geometryArea || surface.area || 0) * coverageRatio,
    coverageRatio,
    visibilityUnion: { visiblePixels, geometryPixels, visibleRatio: coverageRatio },
  };
}

projection.surfaces = await Promise.all((mergeSameWallSurfaces(projection.surfaces || [])).map(applyVisibilityUnion));

const buildings = buildingId
  ? geometry.buildings.filter((item) => item.id === buildingId)
  : geometry.buildings;

function surfaceImportance(building, area) {
  // Famous-building evaluation prioritizes visible, large facade surfaces.
  // This remains an evaluation weight; it does not alter PLATEAU geometry.
  const normalizedArea = Math.min(1, area / 1000);
  const named = Boolean(building.name);
  return Math.min(3, 1 + normalizedArea + (named ? 0.5 : 0));
}

function evidenceState(surface, projectedArea) {
  const sourceCount = surface.sourceIds?.length || (surface.sourceId ? 1 : 0);
  const coverage = Math.max(0, Math.min(1, surface.coverageRatio ?? 0));
  if (!sourceCount || projectedArea <= 0) {
    return { verified: 0, estimated: 0, unknown: 1 };
  }
  const verified = Math.min(1, coverage * Math.min(1, sourceCount / 2));
  return {
    verified,
    estimated: Math.max(0, coverage - verified),
    unknown: Math.max(0, 1 - coverage),
  };
}

function polygonArea(wall) {
  const mesh = triangulate(wall.rings.map((ring) => ring.points));
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map((index) => mesh.points[index]);
    area += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
  }
  return area;
}

function surfacePose(wall) {
  const mesh = triangulate(wall.rings.map((ring) => ring.points));
  const points = mesh.points;
  let center = [0, 0, 0];
  let count = 0;
  for (const ring of wall.rings) {
    for (const point of ring.points) {
      center = center.map((value, index) => value + point[index]);
      count++;
    }
  }
  center = center.map((value) => value / Math.max(1, count));
  return {
    center,
    normal: mesh.normal,
    viewOrigin: mesh.normal.map((value, index) => center[index] + value * 30),
  };
}

function evidencePose(surface, building) {
  const wall = building.walls.find((item) => item.id === (surface.wallId || surface.surfaceId || surface.key));
  if (wall) return surfacePose(wall);
  if (surface.normal && surface.viewTarget) {
    return {
      center: surface.viewTarget,
      normal: surface.normal,
      viewOrigin: surface.viewTarget.map((value, index) => value + surface.normal[index] * 30),
    };
  }
  return null;
}

const reports = buildings.map((building) => {
  const source = projection.surfaces.filter((surface) => {
    if (surface.buildingId !== building.id) return false;
    if (!sourceFilter) return true;
    const ids = surface.sourceIds || (surface.sourceId ? [surface.sourceId] : []);
    return ids.some((id) => sourceFilter.includes(id));
  }).map((surface) => {
    if (!sourceFilter) return surface;
    const mappings = (surface.sourceMappings || []).filter((mapping) => sourceFilter.includes(mapping.sourceId));
    if (!mappings.length) return surface;
    const visible = mappings.reduce((sum, mapping) => sum + (mapping.visibilityMask?.visiblePixels || 0), 0);
    const pixels = mappings.reduce((sum, mapping) => sum + (mapping.visibilityMask?.geometryPixels || 0), 0);
    return {
      ...surface,
      sourceIds: mappings.map((mapping) => mapping.sourceId),
      area: (surface.geometryArea || surface.area) * (pixels ? Math.min(1, visible / pixels) : 0),
      coverageRatio: pixels ? visible / pixels : 0,
    };
  });
  const totalArea = building.walls.reduce((sum, wall) => sum + polygonArea(wall), 0);
  const verifiedArea = source.reduce((sum, surface) => sum + (surface.area || 0), 0);

  const weightedTotal = building.walls.reduce((sum, wall) => {
    const area = polygonArea(wall);
    return sum + area * surfaceImportance(building, area);
  }, 0);
  const weightedVerified = source.reduce((sum, surface) => {
    const area = surface.area || 0;
    return sum + area * surfaceImportance(building, area);
  }, 0);

  return {
    buildingId: building.id,
    name: building.name,
    wallCount: building.walls.length,
    totalArea,
    verifiedArea,
    coverage: totalArea ? verifiedArea / totalArea : 0,
    weightedCoverage: weightedTotal ? weightedVerified / weightedTotal : 0,
    confidence: source.length ? Math.min(1, source.length / 4) : 0,
    sources: [...new Set(source.flatMap((surface) => surface.sourceIds || (surface.sourceId ? [surface.sourceId] : [])))],
    surfaces: source.map((surface) => ({
      surfaceId: surface.wallId || surface.surfaceId || surface.key,
      coverage: surface.coverageRatio || null,
      area: surface.area || 0,
      evidence: evidenceState(surface, surface.area || 0),
      pose: evidencePose(surface, building),
    })),
  };
});

const result = { areaId, generatedAt: new Date().toISOString(), buildings: reports };
await writeFile(`data/texture-city/coverage-${areaId}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
