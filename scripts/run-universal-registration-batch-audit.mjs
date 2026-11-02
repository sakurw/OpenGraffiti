import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Expands universal registration jobs into auditable execution records.
// A record is promoted only after geometric validation creates evidence.

const jobs = JSON.parse(await readFile(
  'public/assets/universal-all-areas/photo-registration-jobs.json',
  'utf8'
));
const resolution = JSON.parse(await readFile(
  'public/assets/universal-all-areas/msls-photo-input-resolution.json',
  'utf8'
));
const statePath = 'public/assets/universal-all-areas/photo-registration-execution-state.json';
const state = JSON.parse(await readFile(statePath, 'utf8'));

const limit = Number(process.argv[2] ?? 1);
const selected = jobs.jobs.slice(0, limit * 500);

const resolvedByImage = new Map(resolution.records.map((r) => [r.imageId, r]));
const records = selected.map((job) => ({
  surfaceId: job.surfaceId,
  buildingId: job.buildingId,
  imageId: job.imageId,
  sourceCandidate: resolvedByImage.get(job.imageId)?.resolvedPath ?? null,
  sourceExists: Boolean(resolvedByImage.get(job.imageId)?.resolvedPath),
  sourceResolution: resolvedByImage.get(job.imageId)?.status ?? 'unresolved',
  registrationState: 'requires-image-geometry-validation',
  directObservation: false,
  requiredStages: [
    'feature-matching',
    'camera-estimation',
    'reprojection-validation',
    'visibility-validation',
    'texture-projection',
  ],
}));

state.batchAudit = {
  generatedAt: new Date().toISOString(),
  records: records.length,
  sourceCandidatesFound: records.filter((x) => x.sourceExists).length,
  sourceCandidatesMissing: records.filter((x) => !x.sourceExists).length,
};
state.status = 'registration-inputs-audited';

await writeFile(
  'public/assets/universal-all-areas/registration-input-audit.json',
  JSON.stringify({ records }, null, 2),
  'utf8'
);
await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');

console.log(JSON.stringify(state.batchAudit));
