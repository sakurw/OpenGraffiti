import { readFile, writeFile } from 'node:fs/promises';

// Attach existing photo candidates to WallSurfaces with an explicit confidence
// boundary. A GPS candidate alone is never marked as direct observation.
const root = 'public/assets/universal-all-areas';
const areas = ['tocho', 'tokyo-tower'];

for (const area of areas) {
  const registry = JSON.parse(await readFile(`${root}/${area}-surface-registry.json`, 'utf8'));
  const discovery = JSON.parse(await readFile(`data/texture-city/universal-all-buildings/ground/${area}-discovery.json`, 'utf8'));
  const surfaces = registry.walls;
  const rows = [];

  for (const surface of surfaces) {
    const building = discovery.buildings.find(item => item.buildingId === surface.buildingId);
    const candidates = building?.candidates ?? [];
    const ranked = candidates.map(candidate => ({
      imageId: candidate.imageId,
      geographicScore: candidate.score ?? 0,
      registration: 'candidate-only',
      surfaceRegistration: 'not-established'
    })).sort((a, b) => b.geographicScore - a.geographicScore);
    rows.push({
      surfaceId: surface.surfaceId,
      buildingId: surface.buildingId,
      topCandidates: ranked.slice(0, 5),
      state: ranked[0]?.geographicScore > 0.5 ? 'candidate-strong' : 'needs-registration'
    });
  }

  await writeFile(`${root}/${area}-surface-photo-lineage.json`, JSON.stringify({
    method: 'wall-surface-photo-lineage-v1',
    area,
    surfaces: rows,
    summary: {
      surfaces: rows.length,
      candidateStrong: rows.filter(row => row.state === 'candidate-strong').length
    }
  }, null, 2));
}

console.log('surface photo lineage generated');
