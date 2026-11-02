import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

const area = process.argv[2] || 'tocho';
const limit = Number(process.argv[3] || 10);
const reset = process.argv.includes('--reset');
const projectionSource = process.argv.find((arg) => arg.startsWith('--projection-source='))?.split('=')[1] || 'msls';

const runNode = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: process.cwd() });
  let stderr = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${stderr || stdout || `exit ${code}`}`)));
});

const coveragePath = `data/texture-city/coverage-${area}.json`;
const planPath = `data/texture-city/acquisition-plan-${area}.json`;
const outPath = `data/texture-city/coverage-acquisition-loop-${area}.json`;
const cumulativePath = `data/texture-city/msls/acquisition-cumulative-${area}.json`;

const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
let plan;
try {
  plan = JSON.parse(await readFile(planPath, 'utf8'));
} catch {
  await runNode(['scripts/acquisition-planner.mjs', area]);
  plan = JSON.parse(await readFile(planPath, 'utf8'));
}

let previous = { iterations: [] };
try {
  if (!reset) previous = JSON.parse(await readFile(outPath, 'utf8'));
} catch {}

const candidates = plan.selected || plan.items || [];

let cumulative = { buildings: [] };
try {
  if (!reset) cumulative = JSON.parse(await readFile(cumulativePath, 'utf8'));
} catch {}

// A reset must rebuild the acquisition state from the verified baseline.
// Keeping the previous cumulative projection while resetting only the loop
// history makes already acquired photos compete again as if they were new.
if (reset) {
  cumulative = { buildings: [] };
}

// Acquisition starts from accepted evidence only. snap-surfaces contains
// available projections for candidate photos and must not be treated as
// acquired evidence. Loading it here makes every candidate appear selected
// and collapses the greedy marginal-gain search.
if (!cumulative.surfaces?.length) {
  try {
    const targetPath = `data/texture-city/msls/snap-surfaces-${area}-target.json`;
    const baseProjection = JSON.parse(await readFile(targetPath, 'utf8'));
    const initialBuilding = coverage.buildings.find((item) => item.buildingId === (previous.targetBuildingId || candidates?.[0]?.buildingId));
    const acceptedSources = new Set(initialBuilding?.sources || []);
    cumulative = {
      ...baseProjection,
      surfaces: (baseProjection.surfaces || []).map((surface) => ({
        ...surface,
        sourceIds: (surface.sourceIds || []).filter((id) => acceptedSources.has(id)),
        sourceMappings: (surface.sourceMappings || []).filter((mapping) => acceptedSources.has(mapping.sourceId)),
      })).filter((surface) => (surface.sourceMappings || []).length || (surface.sourceIds || []).length),
    };
  } catch {}
}

const mergeProjection = (projection) => {
  const existingSurfaces = cumulative.surfaces || [];
  const mergedSurfaces = [...existingSurfaces.map((surface) => ({
    ...surface,
    sourceMappings: [...(surface.sourceMappings || [])],
    sourceIds: [...(surface.sourceIds || [])],
  }))];
  const surfaceMap = new Map(mergedSurfaces.map((s, index) => [s.key || s.wallId || s.surfaceId, index]));

  for (const surface of projection.surfaces || []) {
    const key = surface.key || surface.wallId || surface.surfaceId;
    const existingIndex = surfaceMap.get(key);
    if (existingIndex === undefined) {
      mergedSurfaces.push(surface);
      surfaceMap.set(key, mergedSurfaces.length - 1);
    } else {
      const target = mergedSurfaces[existingIndex];
      const mappings = new Map((target.sourceMappings || []).map((m) => [m.sourceId, m]));
      for (const mapping of surface.sourceMappings || []) mappings.set(mapping.sourceId, mapping);
      target.sourceMappings = [...mappings.values()];
      target.sourceIds = [...new Set([...(target.sourceIds || []), ...(surface.sourceIds || [])])];
    }
  }

  const byBuilding = new Map(cumulative.buildings.map((b) => [b.buildingId, b]));
  for (const building of projection.buildings || []) {
    const current = byBuilding.get(building.buildingId) || { ...building, surfaces: [] };
    current.surfaces ||= [];
    const seen = new Set(current.surfaces.map((s) => JSON.stringify(s)));
    for (const surface of building.surfaces || []) {
      const key = JSON.stringify(surface);
      if (!seen.has(key)) current.surfaces.push(surface);
    }
    byBuilding.set(building.buildingId, current);
  }

  // snap-surfaces output stores projected surfaces at the root level. Keep
  // cumulative evidence in the same shape expected by coverage-evaluator.
  for (const surface of projection.surfaces || []) {
    const buildingId = surface.buildingId;
    if (!buildingId) continue;
    const current = byBuilding.get(buildingId) || { buildingId, surfaces: [] };
    current.surfaces ||= [];
    const seen = new Set(current.surfaces.map((s) => JSON.stringify(s)));
    const key = JSON.stringify(surface);
    if (!seen.has(key)) current.surfaces.push(surface);
    byBuilding.set(buildingId, current);
  }

  cumulative = { ...cumulative, ...projection, surfaces: mergedSurfaces, buildings: [...byBuilding.values()] };
  return cumulative;
};

// The acquisition order is estimated, but the accepted state comes from the
// existing projection backend and coverage evaluator.
const state = {
  area,
  targetCoverage: 0.9,
  targetBuildingId: previous.targetBuildingId || candidates?.[0]?.buildingId,
  initialCoverage: coverage.buildings.find((item) => item.buildingId === (previous.targetBuildingId || candidates?.[0]?.buildingId))?.coverage ?? 0,
  achieved: false,
  iterations: previous.iterations || [],
};

// Keep the acquisition loop building-local. Candidates from other buildings
// are useful for discovery, but cannot contribute to the target building's
// 90% coverage measurement.
const targetCandidates = candidates.filter((item) => item.buildingId === state.targetBuildingId);

const remainingCandidates = () => targetCandidates
  .filter((item) => {
    if (state.iterations.some((entry) => entry.surfaceId === item.surfaceId && entry.sourceId === item.sourceId && entry.status === 'verified-reprojection')) return false;
    // A photo can already provide evidence for one wall while still being
    // useful for another wall. Candidate elimination is performed at the
    // surface/photo contribution level below. Source-level exclusion removes
    // complementary views and prevents the marginal-mask evaluator from
    // finding additional facade coverage.
    return !(cumulative.surfaces || []).some((surface) => {
      const surfaceIds = [surface.key, surface.wallId, surface.surfaceId].filter(Boolean);
      const sameWall = surfaceIds.includes(item.surfaceId);
      const surfaceSources = [
        ...(surface.sourceIds || []),
        ...(surface.sourceMappings || []).map((mapping) => mapping.sourceId),
      ];
      return sameWall && surfaceSources.includes(item.sourceId);
    });
  })
;

const projectionCachePath = `data/texture-city/${projectionSource}/acquisition-candidates-${state.targetBuildingId}.json`;
let candidatePhotoMetadata = new Map();

async function ensureCandidateProjection() {
  try {
    return JSON.parse(await readFile(projectionCachePath, 'utf8'));
  } catch {}

  const generator = projectionSource === 'kartaview'
    ? 'scripts/texture-kartaview-snap-surfaces.mjs'
    : 'scripts/texture-msls-snap-surfaces.mjs';
  await runNode([generator, area, `--only-building=${state.targetBuildingId}`, '--include-all-photos', '--acquisition-mode', `--output=${projectionCachePath}`]);
  return JSON.parse(await readFile(projectionCachePath, 'utf8'));
}

async function ensureCandidatePhotoMetadata() {
  if (candidatePhotoMetadata.size) return candidatePhotoMetadata;
  const projection = await ensureCandidateProjection();
  for (const photo of projection.photos || []) {
    candidatePhotoMetadata.set(photo.id, photo);
  }
  return candidatePhotoMetadata;
}

function projectionForCandidate(projection, candidate) {
  const wallPhoto = projection.wallPhotoCandidates?.find((item) =>
    item.buildingId === candidate.buildingId &&
    item.wallId === candidate.surfaceId &&
    item.sourceId === candidate.sourceId
  );
  if (wallPhoto) {
    const surfaces = (projection.surfaces || [])
      .filter((surface) => [surface.key, surface.wallId, surface.surfaceId].filter(Boolean).includes(wallPhoto.wallId))
      .map((surface) => ({
        ...surface,
        sourceIds: [candidate.sourceId],
        sourceMappings: (surface.sourceMappings || []).filter((mapping) => mapping.sourceId === candidate.sourceId),
      }))
      .filter((surface) => surface.sourceMappings?.length || surface.sourceIds?.includes(candidate.sourceId));
    return {
      ...projection,
      surfaces,
      buildings: (projection.buildings || []).filter((building) => building.buildingId === candidate.buildingId),
    };
  }
  // Some generated acquisition candidates only expose the accepted source in
  // surface sourceIds and do not have a wallPhotoCandidates entry. Preserve
  // those candidates as valid evidence candidates as well.
  const directSurface = (projection.surfaces || [])
    .find((surface) =>
      [surface.key, surface.wallId, surface.surfaceId].filter(Boolean).includes(candidate.surfaceId) &&
      (surface.sourceIds || []).includes(candidate.sourceId)
    );
  if (directSurface) {
    return {
      ...projection,
      surfaces: [{
        ...directSurface,
        sourceIds: [candidate.sourceId],
        sourceMappings: (directSurface.sourceMappings || []).filter((mapping) => mapping.sourceId === candidate.sourceId),
      }],
      buildings: (projection.buildings || []).filter((building) => building.buildingId === candidate.buildingId),
    };
  }
  return {
    ...projection,
    surfaces: (projection.surfaces || []).filter((surface) => {
      const ids = surface.sourceIds || (surface.sourceId ? [surface.sourceId] : []);
      return surface.buildingId === candidate.buildingId && ids.includes(candidate.sourceId);
    }),
    buildings: (projection.buildings || []).filter((building) => building.buildingId === candidate.buildingId),
  };
}

function projectionForPhoto(projection, candidate) {
  const surfaces = (projection.surfaces || [])
    .filter((surface) => {
      const ids = surface.sourceIds || (surface.sourceId ? [surface.sourceId] : []);
      return surface.buildingId === candidate.buildingId && ids.includes(candidate.sourceId);
    })
    .map((surface) => ({
      ...surface,
      sourceIds: [candidate.sourceId],
      sourceMappings: (surface.sourceMappings || []).filter((mapping) => mapping.sourceId === candidate.sourceId),
    }))
    .filter((surface) => surface.sourceMappings?.length || surface.sourceIds?.includes(candidate.sourceId));

  return {
    ...projection,
    surfaces,
    buildings: (projection.buildings || []).filter((building) => building.buildingId === candidate.buildingId),
  };
}

async function loadSurfaceVisiblePixels(surfaces) {
  const result = new Map();
  for (const surface of surfaces || []) {
    const key = surface.wallId || surface.surfaceId || surface.key;
    const mappings = surface.sourceMappings || [];
    for (const mapping of mappings) {
      const path = mapping.visibilityMask?.path;
      if (!path) continue;
      const raw = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
      const existing = result.get(key) || { width: raw.info.width, height: raw.info.height, pixels: Buffer.alloc(raw.info.width * raw.info.height) };
      if (existing.width !== raw.info.width || existing.height !== raw.info.height) continue;
      for (let i = 0; i < existing.pixels.length; i++) {
        if (raw.data[i] > existing.pixels[i]) existing.pixels[i] = raw.data[i];
      }
      result.set(key, existing);
    }
  }
  return result;
}

async function calculateMarginalPixels(baseProjection, candidateProjection) {
  const existing = await loadSurfaceVisiblePixels(baseProjection.surfaces || []);
  const candidate = await loadSurfaceVisiblePixels(candidateProjection.surfaces || []);
  let gain = 0;
  for (const [key, mask] of candidate) {
    const current = existing.get(key);
    for (let i = 0; i < mask.pixels.length; i++) {
      if (mask.pixels[i] > 0 && (!current || current.pixels[i] === 0)) gain++;
    }
  }
  return gain;
}

async function evaluateCandidate(candidate, baseline) {
  const sourceProjection = await ensureCandidateProjection();
  const candidateProjection = projectionForPhoto(sourceProjection, candidate);
  if (!candidateProjection.surfaces.length) {
    return { candidate, measuredGain: Number.NEGATIVE_INFINITY };
  }

  const marginalPixels = await calculateMarginalPixels(cumulative, candidateProjection);
  // Use the in-memory visibility union for ranking. Running coverage-evaluator
  // once per candidate created a large number of Node child processes and was
  // unstable on Windows for large candidate pools. Final coverage is measured
  // after the selected candidate is committed.
  return { candidate, marginalPixels, measuredGain: marginalPixels };
}

function sourceDiversityPenalty(candidate) {
  const selectedSources = new Set((state.iterations || []).map((entry) => entry.sourceId).filter(Boolean));
  if (!selectedSources.size || !selectedSources.has(candidate.sourceId)) return 1;
  return 0.35;
}

async function cameraDiversityPenalty(candidate) {
  const metadata = await ensureCandidatePhotoMetadata();
  const current = metadata.get(candidate.sourceId);
  if (!current?.position) return 1;
  const selected = (state.iterations || [])
    .map((entry) => metadata.get(entry.sourceId))
    .filter((photo) => photo?.position);
  if (!selected.length) return 1;
  const nearest = Math.min(...selected.map((photo) => Math.hypot(
    current.position[0] - photo.position[0],
    current.position[2] - photo.position[2],
  )));
  // Nearby cameras usually produce redundant facade pixels. Keep a reduced
  // score until the candidate provides a genuinely different observation.
  if (nearest < 10) return 0.45;
  if (nearest < 25) return 0.75;
  return 1;
}

async function cameraClusterBonus(candidate) {
  const metadata = await ensureCandidatePhotoMetadata();
  const current = metadata.get(candidate.sourceId);
  if (!current?.position) return 1;
  const selected = (state.iterations || [])
    .map((entry) => metadata.get(entry.sourceId))
    .filter((photo) => photo?.position);
  if (!selected.length) return 1;

  const nearest = Math.min(...selected.map((photo) => Math.hypot(
    current.position[0] - photo.position[0],
    current.position[2] - photo.position[2],
  )));
  // Reward a new observation cluster. This prevents the greedy loop from
  // spending most iterations on the same street-side viewpoint.
  return nearest > 50 ? 1.25 : 1;
}

let pendingCandidates = remainingCandidates();

for (let i = 0; i < limit; i++) {
  pendingCandidates = remainingCandidates();
  const currentCoverageReport = JSON.parse(await readFile(coveragePath, 'utf8'));
  const currentCoverage = currentCoverageReport.buildings.find((item) => item.buildingId === state.targetBuildingId)?.coverage || 0;
  const scored = [];
  for (const candidate of pendingCandidates) {
    scored.push(await evaluateCandidate(candidate, currentCoverage));
  }
  const best = scored
    .sort((a, b) => b.marginalPixels - a.marginalPixels)
    .slice(0, 10);
  const bestCandidate = (await Promise.all(best
    .filter((entry) => Number.isFinite(entry.marginalPixels) && entry.marginalPixels > 0)
    .map(async (entry) => ({
      ...entry,
      selectionScore: entry.marginalPixels * sourceDiversityPenalty(entry.candidate) * await cameraDiversityPenalty(entry.candidate) * await cameraClusterBonus(entry.candidate),
    }))))
    .sort((a, b) => {
      if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
      return b.measuredGain - a.measuredGain;
    })[0];
  const item = bestCandidate?.candidate;
  if (!item) break;
  const existing = state.iterations.find((entry) => entry.surfaceId === item.surfaceId && entry.sourceId === item.sourceId);
  if (existing?.status === 'verified-reprojection') continue;
  const before = JSON.parse(await readFile(coveragePath, 'utf8'));
  console.log(JSON.stringify({ status: 'processing', buildingId: item.buildingId, surfaceId: item.surfaceId }));
  // Commit the same photo-wide projection that was used during marginal gain
  // evaluation. Using the wall-only projection here discards other surfaces
  // covered by the selected photo and underestimates multi-surface gains.
  const projection = projectionForPhoto(await ensureCandidateProjection(), item);
  await writeFile(cumulativePath, JSON.stringify(mergeProjection(projection), null, 2));
  // Re-evaluate the accumulated acquisition set. The source filter is only
  // used while estimating a single candidate's marginal value. Applying it
  // here would discard already acquired evidence and prevent coverage growth.
  await runNode(['scripts/coverage-evaluator.mjs', area, state.targetBuildingId, `--projection=${cumulativePath}`]);
  const after = JSON.parse(await readFile(coveragePath, 'utf8'));
  const beforeBuilding = before.buildings.find((b) => b.buildingId === item.buildingId);
  const afterBuilding = after.buildings.find((b) => b.buildingId === item.buildingId);
  state.iterations.push({
    surfaceId: item.surfaceId,
    sourceId: item.sourceId || item.bestCandidate?.sourceId,
    expectedGainArea: item.expectedGainArea || item.estimatedCoverageGain || 0,
    beforeCoverage: beforeBuilding?.coverage || 0,
    afterCoverage: afterBuilding?.coverage || 0,
    measuredGain: (afterBuilding?.coverage || 0) - (beforeBuilding?.coverage || 0),
    status: 'verified-reprojection',
  });
  const latest = after.buildings.find((b) => b.buildingId === state.targetBuildingId);
  state.currentCoverage = latest?.coverage ?? state.currentCoverage ?? 0;
  state.achieved = state.currentCoverage >= state.targetCoverage;
  await writeFile(outPath, JSON.stringify(state, null, 2));
}

await writeFile(outPath, JSON.stringify(state, null, 2));
console.log(JSON.stringify({ outPath, iterations: state.iterations.length, coverage: state.initialCoverage }, null, 2));
