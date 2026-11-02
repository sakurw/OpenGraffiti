import { readFile, writeFile } from 'node:fs/promises';

// Expand registration candidates into executable batch units. This stage keeps
// candidate discovery separate from observation certification.

const input = 'public/assets/universal-all-areas/photo-registration-jobs.json';
const output = 'public/assets/universal-all-areas/photo-registration-batch-manifest.json';

const source = JSON.parse(await readFile(input, 'utf8'));
const batches = [];
const batchSize = 500;

for (let i = 0; i < source.jobs.length; i += batchSize) {
  batches.push({
    batchId: Math.floor(i / batchSize),
    jobs: source.jobs.slice(i, i + batchSize),
    state: 'awaiting-render-and-geometry-validation'
  });
}

await writeFile(output, JSON.stringify({
  method: 'universal-photo-registration-batch-manifest-v1',
  totalJobs: source.jobs.length,
  batchCount: batches.length,
  certifiedObservations: 0,
  batches
}, null, 2), 'utf8');

console.log(JSON.stringify({ totalJobs: source.jobs.length, batchCount: batches.length }));
