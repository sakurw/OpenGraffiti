import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Converts the universal surface photo ranking output into explicit
// registration jobs. Candidate proximity alone is intentionally not promoted
// to observation; every job remains pending geometric validation.

const areas = [
  ['tocho', 'public/assets/universal-all-areas/tocho-surface-photo-ranking.json'],
  ['tokyo-tower', 'public/assets/universal-all-areas/tokyo-tower-surface-photo-ranking.json'],
];

const jobs = [];
for (const [area, file] of areas) {
  const ranking = JSON.parse(await readFile(file, 'utf8'));
  for (const surface of ranking.surfaces) {
    for (const candidate of (surface.candidates ?? []).slice(0, 5)) {
      jobs.push({
        area,
        surfaceId: surface.surfaceId,
        buildingId: surface.buildingId,
        imageId: candidate.imageId,
        registrationState: 'requires-image-geometry-validation',
        rankingScore: candidate.rankingScore,
        distance: candidate.distance,
        directObservation: false,
      });
    }
  }
}

await mkdir('public/assets/universal-all-areas', { recursive: true });
await writeFile(
  'public/assets/universal-all-areas/photo-registration-jobs.json',
  JSON.stringify({
    method: 'universal-photo-registration-job-generation-v1',
    jobCount: jobs.length,
    directObservationCount: 0,
    jobs,
  }, null, 2),
  'utf8'
);

console.log(JSON.stringify({ jobCount: jobs.length, directObservationCount: 0 }));
