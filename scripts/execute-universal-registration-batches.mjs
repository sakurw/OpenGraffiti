import { readFile, writeFile } from 'node:fs/promises';

// Batch controller for the universal photo registration pipeline.
// Candidate records remain untrusted until downstream geometry validation
// produces observation evidence.

const manifest = JSON.parse(await readFile(
  'public/assets/universal-all-areas/photo-registration-batch-manifest.json',
  'utf8'
));

const statePath = 'public/assets/universal-all-areas/photo-registration-execution-state.json';
const state = JSON.parse(await readFile(statePath, 'utf8'));

const nextBatches = manifest.batches.map((batch) => ({
  batchId: batch.batchId,
  jobs: batch.jobs.length,
  status: 'requires-photo-geometry-validation',
}));

state.batches = nextBatches;
state.status = 'registration-batches-prepared';
state.counters.totalJobs = manifest.totalJobs;
state.counters.totalBatches = manifest.batchCount;

await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
console.log(JSON.stringify({
  totalJobs: state.counters.totalJobs,
  totalBatches: state.counters.totalBatches,
  certifiedObservations: state.counters.certifiedObservations,
  status: state.status,
}));
