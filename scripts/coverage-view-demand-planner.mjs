import { readFile, writeFile } from 'node:fs/promises';

const area = process.argv[2] || 'tocho';
const coverage = JSON.parse(await readFile(`data/texture-city/coverage-${area}.json`, 'utf8'));
const snap = JSON.parse(await readFile(`data/texture-city/msls/snap-surfaces-${area}-target.json`, 'utf8'));

const visible = new Map();
for (const surface of snap.surfaces || []) {
  visible.set(surface.key || surface.surfaceId, {
    key: surface.key || surface.surfaceId,
    area: surface.area || 0,
    normal: surface.pose?.normal || null,
    center: surface.pose?.center || null,
    availableViews: (surface.sourceMappings || []).length,
  });
}

const building = coverage.buildings?.[0];
const demand = (building?.surfaces || [])
  .filter((surface) => (surface.evidence?.unknown || 0) > 0)
  .map((surface) => {
    const candidate = visible.get(surface.surfaceId);
    const center = surface.pose?.center || candidate?.center || null;
    const normal = surface.pose?.normal || candidate?.normal || null;
    const observationPoints = [];
    if (center && normal) {
      for (const distance of [20, 40, 80]) {
        for (const heightOffset of [-10, 0, 10]) {
          observationPoints.push({
            distance,
            heightOffset,
            position: [
              center[0] + normal[0] * distance,
              center[1] + normal[1] * distance + heightOffset,
              center[2] + normal[2] * distance,
            ],
            lookAt: center,
          });
        }
      }
    }
    return {
      surfaceId: surface.surfaceId,
      unknown: surface.evidence?.unknown || 0,
      area: surface.area || candidate?.area || 0,
      normal,
      center,
      existingViewCount: candidate?.availableViews || 0,
      observationPoints,
      priority: (surface.evidence?.unknown || 0) * (surface.area || 0),
    };
  })
  .sort((a, b) => b.priority - a.priority);

const result = {
  area,
  generatedAt: new Date().toISOString(),
  strategy: 'rank uncovered surfaces by unknown area and expose required observation direction for photo acquisition',
  totalUncoveredSurfaces: demand.length,
  demand,
};

await writeFile(`data/texture-city/coverage-view-demand-${area}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: `data/texture-city/coverage-view-demand-${area}.json`, surfaces: demand.length }, null, 2));
