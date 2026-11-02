import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {project, triangulate} from './plateau-geometry.mjs';

const DEFAULT_GEOMETRY = 'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';

function parseArgs(argv) {
  const result = new Map();
  for (const value of argv) {
    const at = value.indexOf('=');
    if (!value.startsWith('--') || at < 3) throw Error('Use --name=value arguments');
    const key = value.slice(2, at);
    const item = value.slice(at + 1);
    const list = result.get(key) ?? [];
    list.push(item);
    result.set(key, list);
  }
  return result;
}

function one(args, key, fallback = undefined) {
  const values = args.get(key);
  return values?.length ? values.at(-1) : fallback;
}

function numbers(value, name) {
  const parsed = String(value).split(',').map(Number);
  if (!parsed.length || parsed.some(v => !Number.isFinite(v))) {
    throw Error(`${name} must be comma-separated numbers`);
  }
  return parsed;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix3 = (a, b, c, wa, wb, wc) => [
  a[0] * wa + b[0] * wb + c[0] * wc,
  a[1] * wa + b[1] * wb + c[1] * wc,
  a[2] * wa + b[2] * wb + c[2] * wc,
];
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function rayTriangle(origin, direction, a, b, c) {
  const epsilon = 1e-9;
  const edge1 = sub(b, a);
  const edge2 = sub(c, a);
  const pvec = cross(direction, edge2);
  const determinant = dot(edge1, pvec);
  if (Math.abs(determinant) < epsilon) return null;
  const inverse = 1 / determinant;
  const tvec = sub(origin, a);
  const u = dot(tvec, pvec) * inverse;
  if (u < -epsilon || u > 1 + epsilon) return null;
  const qvec = cross(tvec, edge1);
  const v = dot(direction, qvec) * inverse;
  if (v < -epsilon || u + v > 1 + epsilon) return null;
  const t = dot(edge2, qvec) * inverse;
  return t > epsilon ? t : null;
}

function segmentIntersectsBox(origin, direction, min, max, limit = 0.9995) {
  let low = 0;
  let high = limit;
  const padding = 0.03;
  for (let axis = 0; axis < 3; axis++) {
    const lo = min[axis] - padding;
    const hi = max[axis] + padding;
    if (Math.abs(direction[axis]) < 1e-12) {
      if (origin[axis] < lo || origin[axis] > hi) return false;
      continue;
    }
    let a = (lo - origin[axis]) / direction[axis];
    let b = (hi - origin[axis]) / direction[axis];
    if (a > b) [a, b] = [b, a];
    low = Math.max(low, a);
    high = Math.min(high, b);
    if (high < low) return false;
  }
  return high > 1e-8 && low < limit;
}

function targetSamples(target, spacing) {
  const samples = [];
  for (let wallIndex = 0; wallIndex < (target.walls ?? []).length; wallIndex++) {
    const wall = target.walls[wallIndex];
    const rings = (wall.rings ?? []).map(ring => ring.points ?? []);
    if (!rings.length || rings[0].length < 3) continue;
    const mesh = triangulate(rings);
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const a = mesh.points[mesh.indices[index]];
      const b = mesh.points[mesh.indices[index + 1]];
      const c = mesh.points[mesh.indices[index + 2]];
      const longest = Math.max(distance3(a, b), distance3(b, c), distance3(c, a));
      const divisions = Math.max(1, Math.min(8, Math.ceil(longest / spacing)));
      for (let i = 0; i < divisions; i++) {
        for (let j = 0; j < divisions - i; j++) {
          const wa = (i + 1) / (divisions + 2);
          const wb = (j + 1) / (divisions + 2);
          const wc = 1 - wa - wb;
          if (wc <= 0) continue;
          samples.push({
            point: mix3(a, b, c, wa, wb, wc),
            surfaceId: wall.id ?? `wall-${wallIndex}`,
          });
        }
      }
      samples.push({
        point: mix3(a, b, c, 1 / 3, 1 / 3, 1 / 3),
        surfaceId: wall.id ?? `wall-${wallIndex}`,
      });
    }
  }
  const unique = new Map();
  for (const sample of samples) {
    const key = `${sample.surfaceId}|${sample.point.map(v => v.toFixed(3)).join(',')}`;
    unique.set(key, sample);
  }
  return [...unique.values()];
}

function occluderBuildings(geometry, targetId) {
  const result = [];
  for (const building of geometry.buildings ?? []) {
    if (building.id === targetId || !building.min || !building.max) continue;
    const triangles = [];
    for (const polygon of building.polygons ?? []) {
      const rings = (polygon.rings ?? []).map(ring => ring.points ?? []);
      if (!rings.length || rings[0].length < 3) continue;
      const mesh = triangulate(rings);
      for (let index = 0; index < mesh.indices.length; index += 3) {
        triangles.push([
          mesh.points[mesh.indices[index]],
          mesh.points[mesh.indices[index + 1]],
          mesh.points[mesh.indices[index + 2]],
        ]);
      }
    }
    if (triangles.length) result.push({id: building.id, min: building.min, max: building.max, triangles});
  }
  return result;
}

function horizontalBoxDistance(x, z, building) {
  const dx = x < building.min[0] ? building.min[0] - x : x > building.max[0] ? x - building.max[0] : 0;
  const dz = z < building.min[2] ? building.min[2] - z : z > building.max[2] ? z - building.max[2] : 0;
  return Math.hypot(dx, dz);
}

function estimateGroundY(geometry, cameraXZ, targetId) {
  const candidates = (geometry.buildings ?? [])
    .filter(building => building.id !== targetId && building.min && building.max)
    .map(building => ({building, distance: horizontalBoxDistance(cameraXZ[0], cameraXZ[1], building)}))
    .filter(item => item.distance <= 180)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12);
  if (!candidates.length) throw Error('Cannot estimate local ground height; pass --ground-y or --camera-y');
  const values = candidates.map(item => item.building.min[1]).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const y = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    y,
    method: 'median-min-y-of-12-nearest-buildings-within-180m',
    references: candidates.map(item => ({buildingId: item.building.id, distance: item.distance, minY: item.building.min[1]})),
  };
}

function trace(cameraXZ, cameraY, samples, occluders, includeVisiblePoints = false) {
  const origin = [cameraXZ[0], cameraY, cameraXZ[1]];
  const blockers = new Map();
  const surfaces = new Map();
  const visiblePoints = [];
  let visibleCount = 0;
  for (const sample of samples) {
    const direction = sub(sample.point, origin);
    let nearest = null;
    for (const building of occluders) {
      if (!segmentIntersectsBox(origin, direction, building.min, building.max)) continue;
      for (const [a, b, c] of building.triangles) {
        const t = rayTriangle(origin, direction, a, b, c);
        if (t === null || t >= 0.9995) continue;
        if (!nearest || t < nearest.t) nearest = {buildingId: building.id, t};
      }
    }
    const surface = surfaces.get(sample.surfaceId) ?? {surfaceId: sample.surfaceId, sampleCount: 0, visibleCount: 0};
    surface.sampleCount += 1;
    if (!nearest) {
      visibleCount += 1;
      surface.visibleCount += 1;
      if (includeVisiblePoints) visiblePoints.push({surfaceId: sample.surfaceId, point: sample.point});
    } else {
      blockers.set(nearest.buildingId, (blockers.get(nearest.buildingId) ?? 0) + 1);
    }
    surfaces.set(sample.surfaceId, surface);
  }
  const surfaceList = [...surfaces.values()].map(item => ({
    ...item,
    visibleRatio: item.sampleCount ? item.visibleCount / item.sampleCount : 0,
  }));
  return {
    cameraY,
    sampleCount: samples.length,
    visibleCount,
    blockedCount: samples.length - visibleCount,
    visibleRatio: samples.length ? visibleCount / samples.length : 0,
    visibleSurfaceIds: surfaceList.filter(item => item.visibleCount > 0).map(item => item.surfaceId),
    surfaces: surfaceList,
    blockers: [...blockers.entries()]
      .map(([buildingId, count]) => ({buildingId, count, ratio: samples.length ? count / samples.length : 0}))
      .sort((left, right) => right.count - left.count),
    ...(includeVisiblePoints ? {visiblePoints} : {}),
  };
}

async function loadViewpoints(args, geometry) {
  const photoArgs = args.get('photo') ?? [];
  if (photoArgs.length) {
    const result = [];
    for (const filename of photoArgs) {
      const metadata = JSON.parse(await readFile(path.resolve(filename), 'utf8'));
      const location = metadata.candidateLocation;
      if (!location || !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon))) {
        result.push({photoId: metadata.id ?? path.basename(filename, path.extname(filename)), photoPath: filename, error: 'missing-candidate-location'});
        continue;
      }
      const local = project(Number(location.lat), Number(location.lon), 0, geometry.origin);
      result.push({
        photoId: metadata.id ?? path.basename(filename, path.extname(filename)),
        photoPath: filename,
        sourcePage: metadata.sourcePage ?? null,
        location: {lat: Number(location.lat), lon: Number(location.lon)},
        cameraXZ: [local[0], local[2]],
      });
    }
    return result;
  }
  const localX = Number(one(args, 'local-x'));
  const localZ = Number(one(args, 'local-z'));
  if (Number.isFinite(localX) && Number.isFinite(localZ)) {
    return [{photoId: null, cameraXZ: [localX, localZ], location: null}];
  }
  const lat = Number(one(args, 'lat'));
  const lon = Number(one(args, 'lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw Error('Supply --photo=metadata.json, or --lat/--lon, or --local-x/--local-z');
  }
  const local = project(lat, lon, 0, geometry.origin);
  return [{photoId: null, cameraXZ: [local[0], local[2]], location: {lat, lon}}];
}

const args = parseArgs(process.argv.slice(2));
const geometryPath = path.resolve(one(args, 'geometry', DEFAULT_GEOMETRY));
const targetId = one(args, 'building');
if (!targetId) throw Error('Supply --building=<PLATEAU building id>');
const geometry = JSON.parse(await readFile(geometryPath, 'utf8'));
if (!Array.isArray(geometry.origin) || !Array.isArray(geometry.buildings)) throw Error('Invalid PLATEAU geometry JSON');
const target = geometry.buildings.find(building => building.id === targetId);
if (!target) throw Error(`Target building not found: ${targetId}`);

const spacing = Number(one(args, 'sample-spacing', '10'));
if (!Number.isFinite(spacing) || spacing <= 0) throw Error('--sample-spacing must be > 0');
const samples = targetSamples(target, spacing);
if (!samples.length) throw Error('Target building has no usable wall samples');
const occluders = occluderBuildings(geometry, targetId);
const triangleCount = occluders.reduce((sum, building) => sum + building.triangles.length, 0);
const viewpoints = await loadViewpoints(args, geometry);
const absoluteCameraY = one(args, 'camera-y');
const cameraHeights = absoluteCameraY ? null : numbers(one(args, 'camera-heights', '1.6,3,6,10'), '--camera-heights');
const groundOverride = one(args, 'ground-y');
const includeVisiblePoints = one(args, 'include-visible-points', 'false') === 'true';
const summaryOnly = one(args, 'summary-only', 'false') === 'true';

const results = [];
for (const viewpoint of viewpoints) {
  if (viewpoint.error) {
    results.push({...viewpoint, decision: 'reject-metadata', reason: viewpoint.error});
    continue;
  }
  let ground;
  let cameraYs;
  if (absoluteCameraY) {
    cameraYs = numbers(absoluteCameraY, '--camera-y');
    ground = {y: null, method: 'absolute-camera-y', references: []};
  } else {
    ground = groundOverride !== undefined
      ? {y: Number(groundOverride), method: 'user-supplied-ground-y', references: []}
      : estimateGroundY(geometry, viewpoint.cameraXZ, targetId);
    if (!Number.isFinite(ground.y)) throw Error('--ground-y must be numeric');
    cameraYs = cameraHeights.map(height => ground.y + height);
  }
  const traces = cameraYs.map(cameraY => trace(viewpoint.cameraXZ, cameraY, samples, occluders, false));
  const bestIndex = traces.reduce((best, item, index) => item.visibleCount > traces[best].visibleCount ? index : best, 0);
  const best = trace(viewpoint.cameraXZ, cameraYs[bestIndex], samples, occluders, includeVisiblePoints);
  results.push({
    ...viewpoint,
    ground,
    cameraYs,
    decision: best.visibleCount > 0 ? 'keep-visible' : 'reject-occluded',
    reason: best.visibleCount > 0
      ? 'At least one target wall sample is visible from a tested camera height.'
      : 'Every sampled target wall point is occluded at every tested camera height.',
    traces,
    best,
  });
}

const report = {
  schemaVersion: 1,
  purpose: 'PLATEAU line-of-sight prefilter. Geotag proximity alone is not evidence that the target facade is pictured.',
  geometryPath: path.relative(process.cwd(), geometryPath).replaceAll('\\', '/'),
  target: {id: target.id, min: target.min, max: target.max},
  sampling: {spacingMeters: spacing, sampleCount: samples.length},
  scene: {occluderBuildingCount: occluders.length, triangleCount},
  results,
};

const output = one(args, 'output');
if (output) {
  const absolute = path.resolve(output);
  await mkdir(path.dirname(absolute), {recursive: true});
  await writeFile(absolute, JSON.stringify(report, null, 2) + '\n');
}
if (summaryOnly) {
  console.log(JSON.stringify({
    target: report.target,
    sampling: report.sampling,
    scene: report.scene,
    results: report.results.map(result => ({
      photoId: result.photoId,
      decision: result.decision,
      location: result.location,
      cameraXZ: result.cameraXZ,
      groundY: result.ground?.y,
      cameraYs: result.cameraYs,
      visibleCount: result.best?.visibleCount,
      sampleCount: result.best?.sampleCount,
      visibleRatio: result.best?.visibleRatio,
      visibleSurfaceIds: result.best?.visibleSurfaceIds,
      blockers: result.best?.blockers?.slice(0, 5),
    })),
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
