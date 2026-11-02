import { readFile, writeFile } from 'node:fs/promises';

// Pilot runner for the universal registration path. It keeps candidates and
// certified observations separate while preparing deterministic execution.

const statePath = 'public/assets/universal-all-areas/photo-registration-execution-state.json';
const auditPath = 'public/assets/universal-all-areas/registration-input-audit.json';

const state = JSON.parse(await readFile(statePath, 'utf8'));
const audit = JSON.parse(await readFile(auditPath, 'utf8'));

const records = audit.records.map((record) => ({
  ...record,
  stages: {
    renderCandidate: 'required',
    featureMatch: 'required',
    cameraEstimation: 'required',
    reprojectionValidation: 'required',
    visibilityValidation: 'required',
    textureProjection: 'required',
  },
}));

state.status = 'registration-render-and-validation-ready';
state.pilot = {
  records: records.length,
  certifiedObservations: 0,
  directObservationPromotionEnabled: false,
};

await writeFile(
  'public/assets/universal-all-areas/registration-validation-pilot.json',
  JSON.stringify({ method: 'universal-registration-validation-pilot-v1', records }, null, 2),
  'utf8'
);
await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

console.log(JSON.stringify(state.pilot));
