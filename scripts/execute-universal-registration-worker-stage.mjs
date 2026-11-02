import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Connects the existing worker queue to executable stages.
// Candidate records remain untrusted until all validation stages succeed.

const root = 'public/assets/universal-all-areas';
const queuePath = `${root}/registration-worker-queue.json`;
const statePath = `${root}/photo-registration-execution-state.json`;
const limit = Number(process.argv[2] ?? 1);

const queue = JSON.parse(await readFile(queuePath, 'utf8'));
const state = JSON.parse(await readFile(statePath, 'utf8'));
const jobs = queue.jobs.slice(0, limit);

const results = [];
for (const job of jobs) {
  const result = {
    buildingId: job.buildingId,
    surfaceId: job.surfaceId,
    imageId: job.imageId,
    stages: job.stages,
    status: 'requires-stage-inputs',
    validationGate: {
      featureMatch: false,
      cameraEstimation: false,
      reprojectionValidation: false,
      visibilityValidation: false,
    },
    certifiedObservation: false,
  };
  results.push(result);
}

await mkdir(`${root}/worker-results`, { recursive: true });
await writeFile(`${root}/worker-results/latest.json`, JSON.stringify({
  method: 'universal-registration-worker-execution-v1',
  processed: results.length,
  results,
}, null, 2));

state.workerExecution = {
  processed: results.length,
  certifiedObservations: results.filter((r) => r.certifiedObservation).length,
  nextRequired: 'execute-render-feature-camera-validation-chain',
};
await writeFile(statePath, JSON.stringify(state, null, 2));

console.log(JSON.stringify(state.workerExecution));
