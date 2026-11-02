import { readFile, writeFile } from 'node:fs/promises';

// Universal registration execution controller.
// Candidate photos remain candidates until geometric validation promotes them.

const manifestPath = 'public/assets/universal-all-areas/photo-registration-batch-manifest.json';
const statePath = 'public/assets/universal-all-areas/photo-registration-execution-state.json';

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const state = JSON.parse(await readFile(statePath, 'utf8'));

const batchLimit = Number(process.argv[2] ?? manifest.batchCount);
const batches = manifest.batches.slice(0, batchLimit).map((batch) => ({
  batchId: batch.batchId,
  jobs: batch.jobs.length,
  status: 'requires-image-geometry-validation',
}));

state.method = 'universal-photo-registration-execution-v2';
state.scope = { totalJobs: manifest.totalJobs, totalBatches: manifest.batchCount };
state.executedBatches = batches;
state.status = 'geometry-validation-queue-created';
state.nextStages = [
  'candidate-photo-load',
  'surface-render-generation',
  'feature-matching',
  'camera-estimation',
  'reprojection-validation',
  'visibility-validation',
  'direct-observation-promotion',
  'texture-projection',
];

await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
console.log(JSON.stringify({
  status: state.status,
  queuedBatches: batches.length,
  jobs: batches.reduce((sum, b) => sum + b.jobs, 0),
  certifiedObservations: state.counters?.certifiedObservations ?? 0,
}));
