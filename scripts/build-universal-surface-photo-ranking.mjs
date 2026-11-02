import { readFile, writeFile } from 'node:fs/promises';

// Generic ranking stage for all buildings. Candidate photos remain candidates
// until image registration validates the projection.
const root = 'public/assets/universal-all-areas';

function score(surface, candidate) {
  const distance = Math.max(candidate.distance ?? 999, 1);
  const geometryPrior = 1 / distance;
  return geometryPrior;
}

for (const area of ['tocho', 'tokyo-tower']) {
  const input = JSON.parse(await readFile(`${root}/${area}-surface-observation-candidates.json`, 'utf8'));
  const surfaces = input.surfaces.map(surface => ({
    surfaceId: surface.surfaceId,
    buildingId: surface.buildingId,
    candidates: surface.candidates.map(candidate => ({
      ...candidate,
      rankingScore: score(surface, candidate),
      registrationState: 'requires-image-geometry-validation'
    })).sort((a, b) => b.rankingScore - a.rankingScore)
  }));

  await writeFile(`${root}/${area}-surface-photo-ranking.json`, JSON.stringify({
    method: 'surface-photo-ranking-v1',
    area,
    surfaces
  }, null, 2));
}

console.log('surface photo ranking generated');
