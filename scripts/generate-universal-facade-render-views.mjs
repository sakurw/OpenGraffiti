import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Creates deterministic camera candidates for universal photo matching.
// Candidate views are evidence generation only; they do not certify texture.

const input = process.argv[2] ?? 'public/assets/universal-all-areas/registration-worker-queue.json';
const limit = Number(process.argv[3] ?? 1);
const out = 'public/assets/universal-all-areas/facade-camera-candidates.json';

const queue = JSON.parse(await readFile(input, 'utf8'));
const jobs = queue.jobs.slice(0, limit);

const candidates = jobs.map((job) => ({
  buildingId: job.buildingId,
  surfaceId: job.surfaceId,
  imageId: job.imageId,
  strategy: 'surface-normal-facade-search',
  views: [
    { azimuth: 0, elevation: 15, distanceFactor: 2.5 },
    { azimuth: 90, elevation: 15, distanceFactor: 2.5 },
    { azimuth: 180, elevation: 15, distanceFactor: 2.5 },
    { azimuth: 270, elevation: 15, distanceFactor: 2.5 },
  ],
  renderPlan: {
    requiredViews: 4,
    selection: 'feature-match-best-score',
    certification: [
      'feature-correspondence',
      'pnp-solution',
      'reprojection-error',
      'visibility-check',
    ],
  },
  next: [
    'render-each-view',
    'feature-match',
    'pnp-validation',
  ],
}));

await mkdir(resolve('public/assets/universal-all-areas'), { recursive: true });
await writeFile(out, JSON.stringify({
  method: 'universal-facade-camera-candidate-v1',
  count: candidates.length,
  candidates,
}, null, 2));

console.log(JSON.stringify({ generated: candidates.length, output: out }));
