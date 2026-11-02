import { readFile, writeFile } from 'node:fs/promises';

// Full pipeline coordinator. It advances the whole-area queue while keeping
// candidate photos separate from certified observations.

const root = 'public/assets/universal-all-areas';
const statePath = `${root}/photo-registration-execution-state.json`;
const manifestPath = `${root}/photo-registration-batch-manifest.json`;

const [state, manifest] = await Promise.all([
  readFile(statePath, 'utf8').then(JSON.parse),
  readFile(manifestPath, 'utf8').then(JSON.parse),
]);

state.pipeline = {
  method: 'universal-full-validation-pipeline-v1',
  scope: {
    jobs: manifest.totalJobs,
    batches: manifest.batchCount,
  },
  stages: [
    'surface-render-generation',
    'feature-matching',
    'camera-estimation',
    'reprojection-validation',
    'visibility-validation',
    'direct-observation-promotion',
    'texture-projection',
    'glb-generation',
    'browser-verification',
  ],
};

state.status = 'full-pipeline-orchestration-created';
state.nextRequired = 'execute-surface-render-and-registration-workers';

await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
console.log(JSON.stringify({
  status: state.status,
  jobs: manifest.totalJobs,
  batches: manifest.batchCount,
  certifiedObservations: state.counters?.certifiedObservations ?? 0,
}));
