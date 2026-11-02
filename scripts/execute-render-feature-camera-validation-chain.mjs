import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = 'public/assets/universal-all-areas';
const limit = Number(process.argv[2] ?? 1);

const queue = JSON.parse(await readFile(`${root}/registration-worker-queue.json`, 'utf8'));
const photoIndex = JSON.parse(await readFile(`${root}/msls-photo-input-resolution.json`, 'utf8')).records;
const jobs = queue.jobs.slice(0, limit);
const results = [];

function resolveModel(job) {
  if (job.model) return job.model;
  if (job.area === 'tokyo-tower') return 'public/assets/universal-all-areas/tokyo-tower-building-inferred.glb';
  return 'public/assets/universal-all-areas/tocho-building-inferred.glb';
}

function resolvePhoto(job) {
  return photoIndex.find((p) => p.imageId === job.imageId)?.resolvedPath ?? null;
}

await mkdir('data/universal-registration-worker', { recursive: true });

for (let i = 0; i < jobs.length; i++) {
  const job = jobs[i];
  const output = `data/universal-registration-worker/${i}`;
  const model = resolveModel(job);
  await exec('node', [
    'scripts/texture-building-render-capture.mjs',
    model,
    output,
  ]);

  const photo = resolvePhoto(job);
  let featureMatch = 'skipped-no-photo';
  let matchCount = 0;
  let correspondence = null;
  let pnpValidation = 'pending';
  let pnpOutput = null;
  if (photo) {
    const matchOutput = `${output}/feature-match.json`;
    try {
      await exec('python', [
        'scripts/texture-building-feature-match.py',
        photo,
        `${output}/render.png`,
        '--output',
        matchOutput,
      ]);
      const match = JSON.parse(await readFile(matchOutput, 'utf8'));
      featureMatch = match.status;
      matchCount = match.matches.length;
      correspondence = matchOutput;

      if (matchCount > 0) {
        const triangleInput = `${output}/triangle-input.json`;
        pnpOutput = `${output}/pnp-validation.json`;
        try {
          await exec('node', [
            'scripts/texture-building-triangle-input.mjs',
            model,
            `${output}/camera.json`,
            triangleInput,
          ]);
          await exec('python', [
            'scripts/texture-building-feature-pnp.py',
            matchOutput,
            `${output}/world-position.f32`,
            '--depth',
            `${output}/gpu-depth.f32`,
            '--triangle-input',
            triangleInput,
            '--output',
            pnpOutput,
          ]);
          pnpValidation = 'completed';
        } catch (error) {
          pnpValidation = `failed:${error.message.split('\n')[0]}`;
        }
      }
    } catch (error) {
      featureMatch = `failed:${error.message.split('\n')[0]}`;
    }
  }

  results.push({
    ...job,
    model,
    renderCapture: output,
    validationGate: {
      render: true,
      featureMatch,
      matchCount,
      correspondence,
      cameraEstimation: matchCount > 0 ? 'ready-for-pnp' : 'blocked-no-correspondence',
      pnpValidation,
      pnpOutput,
      reprojectionValidation: pnpValidation === 'completed' ? 'candidate' : 'pending',
      visibilityValidation: 'pending',
    },
    certifiedObservation: false,
  });
}

await writeFile(`${root}/worker-results/render-feature-camera-chain.json`, JSON.stringify({
  method: 'universal-render-feature-camera-validation-chain-v1',
  processed: results.length,
  certifiedObservations: 0,
  results,
}, null, 2));

console.log(JSON.stringify({ processed: results.length, certifiedObservations: 0 }));
