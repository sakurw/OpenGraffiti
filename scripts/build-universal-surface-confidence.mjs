import {readFile, writeFile} from 'node:fs/promises';

// Convert building-level evidence into a surface-level lineage manifest.
// This is the bridge between the existing universal color pipeline and the
// WallSurface based reconstruction stage.

const root = 'public/assets/universal-all-areas';
const areas = ['tocho', 'tokyo-tower'];

const classify = (confidence, observed) => {
  if (observed && confidence >= 0.9) return 'direct-observation';
  if (confidence >= 0.6) return 'expanded-from-observed';
  if (confidence >= 0.3) return 'attribute-inference';
  return 'unknown';
};

const reports = [];

for (const area of areas) {
  const registry = JSON.parse(await readFile(`${root}/${area}-surface-registry.json`, 'utf8'));
  const evidence = JSON.parse(await readFile(`${root}/${area}-building-evidence.json`, 'utf8'));
  const byBuilding = new Map(evidence.buildings.map(b => [b.buildingId, b]));

  const surfaces = registry.walls.map(surface => {
    const building = byBuilding.get(surface.buildingId);
    const candidates = (building?.polygons ?? []).filter(p => p.semanticClass !== 'RoofSurface');
    const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    const confidence = best?.confidence ?? 0;
    return {
      area,
      surfaceId: surface.surfaceId,
      buildingId: surface.buildingId,
      geometry: {
        center: surface.center,
        normal: surface.normal,
        width: surface.width,
        height: surface.height,
      },
      source: best?.sourceImage ?? null,
      provenance: best?.provenance ?? 'attribute-prior-fallback',
      confidence,
      state: classify(confidence, best?.directlyObserved === true),
      semanticClass: best?.semanticClass ?? 'WallSurface',
    };
  });

  const result = {
    area,
    method: 'wall-surface-confidence-manifest-v1',
    surfaces,
    summary: {
      surfaces: surfaces.length,
      directObservation: surfaces.filter(s => s.state === 'direct-observation').length,
      expanded: surfaces.filter(s => s.state === 'expanded-from-observed').length,
      inferred: surfaces.filter(s => s.state === 'attribute-inference').length,
      unknown: surfaces.filter(s => s.state === 'unknown').length,
    },
  };

  await writeFile(`${root}/${area}-surface-confidence.json`, JSON.stringify(result, null, 2));
  reports.push(result.summary);
}

await writeFile(`${root}/surface-confidence-report.json`, JSON.stringify({method:'wall-surface-confidence-manifest-v1', areas: reports}, null, 2));
console.log(JSON.stringify(reports));
