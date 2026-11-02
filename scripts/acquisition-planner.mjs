import { readFile, writeFile } from 'node:fs/promises';

const areaId = process.argv[2] || 'tocho';
const limit = Number(process.argv[3] || 20);

const coverage = JSON.parse(await readFile(`data/texture-city/coverage-${areaId}.json`, 'utf8'));
let viewDemand = { demand: [] };
try {
  viewDemand = JSON.parse(await readFile(`data/texture-city/coverage-view-demand-${areaId}.json`, 'utf8'));
} catch {}
const snapPath = `data/texture-city/msls/snap-surfaces-${areaId}-target.json`;
const snap = JSON.parse(await readFile(snapPath, 'utf8'));
const wallPhotoCandidates = snap.wallPhotoCandidates || [];

const demandBySurface = new Map((viewDemand.demand || []).map((item) => [item.surfaceId, item]));

const sources = new Map();
for (const surface of snap.surfaces || []) {
  const ids = surface.sourceIds || (surface.sourceId ? [surface.sourceId] : []);
  for (const id of ids) {
    if (!sources.has(id)) sources.set(id, []);
    sources.get(id).push(surface);
  }
}

// snap-surfaces contains source-level visibility information after projection.
// Keep the mapping attached to candidates so that acquisition ranking can use
// the actual camera/view quality instead of the wall aggregate value.
const sourceQuality = new Map();
for (const surface of snap.surfaces || []) {
  for (const mapping of surface.sourceMappings || []) {
    sourceQuality.set(`${surface.key}|${mapping.sourceId}`, mapping);
  }
}

function priority(surface) {
  const unknown = surface.evidence?.unknown ?? 1;
  const area = surface.area || 0;
  return unknown * Math.log10(area + 10);
}

function viewRequirement(surface) {
  const pose = surface.pose;
  return {
    preferredDistance: Math.max(20, Math.sqrt(surface.area || 1) * 3),
    elevation: pose ? pose.viewOrigin[1] : 'surface-dependent',
    direction: pose ? pose.normal : 'surface-normal-required',
    targetPoint: pose?.center || null,
  };
}

function candidateScore(target) {
  const candidates = [];
  for (const [sourceId, surfaces] of sources) {
    let best = 0;
    let matched = null;
    for (const surface of surfaces) {
      const mapping = sourceQuality.get(`${surface.key}|${sourceId}`);
      const normalScore = target.acquisition.direction !== 'surface-normal-required'
        ? Math.max(0, mapping?.frontalCosine ?? surface.frontalCosine ?? 0)
        : 0;
      const areaScore = Math.min(1, (surface.area || 0) / Math.max(1, target.area));
      // Prefer views that can close an uncovered region. This remains an
      // acquisition heuristic; the final decision is made after reprojection
      // and union-mask evaluation in coverage-acquisition-loop.
      const unknownScore = target.unknown ?? 0;
      const score = normalScore * 0.6 + areaScore * 0.25 + unknownScore * 0.15;
      if (score > best) {
        best = score;
        matched = surface;
        matched.mapping = mapping;
      }
    }
    if (matched) {
      candidates.push({
        sourceId,
        score: best,
        projectedArea: matched.area || 0,
        expectedGain: Math.min(target.area * target.unknown, matched.area || 0) * best,
        frontalCosine: matched.mapping?.frontalCosine ?? matched.frontalCosine ?? 0,
        sourceQuality: matched.mapping?.sourceQuality ?? matched.sourceQuality ?? null,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}

const targets = coverage.buildings
  .flatMap((building) => building.surfaces.map((surface) => ({
    buildingId: building.buildingId,
    name: building.name,
    surfaceId: surface.surfaceId,
    unknown: surface.evidence?.unknown ?? null,
    area: surface.area,
    priority: priority(surface),
    acquisition: viewRequirement(surface),
  })))
  .filter((target) => target.unknown > 0)
  .sort((a, b) => b.priority - a.priority)
  .slice(0, limit)
  .map((target) => ({
    ...target,
    imageCandidates: candidateScore(target),
  }))
  .map((target) => ({
    ...target,
    bestCandidate: target.imageCandidates[0] || null,
    estimatedCoverageGain: target.imageCandidates[0]?.expectedGain || 0,
  }));

const result = {
  areaId,
  generatedAt: new Date().toISOString(),
  strategy: 'rank candidates by uncovered facade evidence, view angle, projected area, and defer final gain to union-mask reprojection',
  targets,
  selected: targets.flatMap((target) =>
    (target.imageCandidates || []).map((candidate) => ({
      surfaceId: target.surfaceId,
      buildingId: target.buildingId,
      sourceId: candidate.sourceId,
      expectedGainArea: candidate.expectedGain,
      estimatedCoverageGain: candidate.expectedGain,
      bestCandidate: candidate,
    }))
  ).sort((a, b) => b.expectedGainArea - a.expectedGainArea),
};

// Prefer the complete wall x photo candidate set when available. The previous
// source aggregation intentionally collapses multiple views of one wall, which
// prevents greedy selection from finding complementary images.
if (wallPhotoCandidates.length) {
  result.selected = wallPhotoCandidates.map((candidate) => {
    const demand = demandBySurface.get(candidate.surfaceId);
    const surface = candidate.surface || {};
    const directionScore = demand?.normal && surface.normal
      ? Math.max(0, demand.normal[0] * surface.normal[0] + demand.normal[1] * surface.normal[1] + demand.normal[2] * surface.normal[2])
      : 0;
    const missingArea = (demand?.unknown || 0) * (demand?.area || surface.geometryArea || 0);
    return {
    surfaceId: candidate.surfaceId,
    buildingId: candidate.buildingId,
    sourceId: candidate.sourceId,
    expectedGainArea: missingArea * directionScore * (candidate.surface?.coverageRatio || 0),
    estimatedCoverageGain: missingArea * directionScore * (candidate.surface?.coverageRatio || 0),
    bestCandidate: {
      sourceId: candidate.sourceId,
      frontalCosine: candidate.frontalCosine,
      sourceQuality: candidate.sourceQuality,
      observationMatch: directionScore,
    },
  };
  }).sort((a, b) => b.expectedGainArea - a.expectedGainArea);
}

await writeFile(`data/texture-city/acquisition-plan-${areaId}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
