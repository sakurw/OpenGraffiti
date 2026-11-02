import { readFile, writeFile } from 'node:fs/promises';

// Worker bridge for the universal pipeline.
// It creates executable work units from the validation queue while keeping
// candidate photos separate from certified observations.

const root = 'public/assets/universal-all-areas';
const input = `${root}/registration-validation-pilot.json`;
const statePath = `${root}/photo-registration-execution-state.json`;
const output = `${root}/registration-worker-queue.json`;

const [validation, state] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse),
  readFile(statePath, 'utf8').then(JSON.parse),
]);

const jobs = validation.records.map((record) => ({
  buildingId: record.buildingId,
  surfaceId: record.surfaceId,
  imageId: record.imageId,
  stages: [
    'surface-render-generation',
    'feature-matching',
    'camera-estimation',
    'reprojection-validation',
    'visibility-validation',
  ],
  status: 'queued',
}));

await writeFile(output, JSON.stringify({
  method: 'universal-registration-worker-queue-v1',
  jobs,
  count: jobs.length,
}, null, 2), 'utf8');

state.status = 'registration-workers-queued';
state.workerQueue = {
  count: jobs.length,
  certifiedObservations: state.counters?.certifiedObservations ?? 0,
};
await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

console.log(JSON.stringify({
  queued: jobs.length,
  certifiedObservations: state.workerQueue.certifiedObservations,
}));
