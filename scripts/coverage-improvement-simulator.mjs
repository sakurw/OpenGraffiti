import { readFile, writeFile } from 'node:fs/promises';

const areaId = process.argv[2] || 'tocho';
const limit = Number(process.argv[3] || 10);

const coverage = JSON.parse(await readFile(`data/texture-city/coverage-${areaId}.json`, 'utf8'));
const plan = JSON.parse(await readFile(`data/texture-city/acquisition-plan-${areaId}.json`, 'utf8'));

const buildings = new Map(coverage.buildings.map((building) => [building.buildingId, building]));
const remaining = [];
for (const target of plan.targets) {
  const building = buildings.get(target.buildingId);
  if (!building) continue;
  const wallArea = building.totalArea || 0;
  const current = building.verifiedArea || 0;
  const gain = target.estimatedCoverageGain || 0;
  remaining.push({
    surfaceId: target.surfaceId,
    buildingId: target.buildingId,
    currentCoverage: wallArea ? current / wallArea : 0,
    expectedGainArea: gain,
    expectedCoverageAfter: wallArea ? Math.min(1, (current + gain) / wallArea) : 0,
    sourceId: target.bestCandidate?.sourceId || null,
  });
}

// Keep complementary acquisitions visible. Selecting the same source for every
// wall hides the actual marginal gain problem because one photo can already
// be selected for another surface.
const selected = [];
const selectedSource = new Set();
for (const item of remaining.sort((a, b) => b.expectedGainArea - a.expectedGainArea)) {
  if (selectedSource.has(item.sourceId)) continue;
  selected.push(item);
  selectedSource.add(item.sourceId);
  if (selected.length >= limit) break;
}

const result = {
  areaId,
  strategy: 'simulate greedy image acquisition using estimated coverage gain',
  note: 'This is a planning simulation. It does not replace actual reprojection verification.',
  selected,
};

await writeFile(`data/texture-city/coverage-improvement-plan-${areaId}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
