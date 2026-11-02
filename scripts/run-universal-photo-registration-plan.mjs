import { readFile, writeFile } from 'node:fs/promises';

// Creates the execution state for universal registration without promoting
// candidate photos to observations. Promotion requires feature matching,
// camera estimation, projection and quality gates.

const manifestPath = 'public/assets/universal-all-areas/photo-registration-batch-manifest.json';
const outputPath = 'public/assets/universal-all-areas/photo-registration-execution-state.json';

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const state = {
  method: 'universal-photo-registration-execution-v1',
  scope: {
    totalJobs: manifest.totalJobs,
    batchCount: manifest.batchCount,
  },
  stages: [
    'candidate-photo-load',
    'plateau-surface-render',
    'feature-matching',
    'camera-estimation',
    'reprojection-validation',
    'visibility-validation',
    'direct-observation-promotion',
    'texture-projection',
  ],
  counters: {
    certifiedObservations: manifest.certifiedObservations ?? 0,
    completedBatches: 0,
    failedBatches: 0,
  },
  status: 'ready-for-registration-execution',
};

await writeFile(outputPath, JSON.stringify(state, null, 2), 'utf8');
console.log(JSON.stringify(state.counters));
