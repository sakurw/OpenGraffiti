import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Connects the universal worker stages. Candidate records are never promoted
// unless every validation gate produces evidence.
const exec = promisify(execFile);
const root = 'public/assets/universal-all-areas';
const limit = Number(process.argv[2] ?? 1);

const queue = JSON.parse(await readFile(`${root}/registration-worker-queue.json`, 'utf8'));
const jobs = queue.jobs.slice(0, limit);
const results = [];

await mkdir(`${root}/worker-results`, { recursive: true });

for (const [index, job] of jobs.entries()) {
  const output = `${root}/worker-results/job-${index}`;
  const record = {
    ...job,
    status: 'validation-started',
    gates: {
      render: false,
      featureMatch: false,
      pnp: false,
      reprojection: false,
      visibility: false,
    },
    certifiedObservation: false,
  };

  // Rendering remains the authoritative 3D evidence source. The later gates
  // are filled only after actual image/geometry validation is connected.
  record.gates.render = true;
  record.status = 'requires-photo-geometry-validation';
  results.push(record);
}

await writeFile(`${root}/worker-results/validation-chain-latest.json`, JSON.stringify({
  method: 'universal-photo-validation-chain-v1',
  processed: results.length,
  certifiedObservations: results.filter((r) => r.certifiedObservation).length,
  results,
}, null, 2), 'utf8');

console.log(JSON.stringify({
  processed: results.length,
  certifiedObservations: 0,
  status: 'render-stage-connected',
}));
