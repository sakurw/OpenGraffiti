import { readFile, writeFile } from 'node:fs/promises';

const [gpuFile, cpuFile, output = 'data/texture-city/vertex-diagnostic-report.json'] = process.argv.slice(2);
if (!gpuFile || !cpuFile) {
  console.error('Usage: node texture-building-vertex-diagnostic-compare.mjs <gpu.json> <triangle-input.json> [output]');
  process.exit(1);
}

const gpu = JSON.parse(await readFile(gpuFile, 'utf8'));
const cpuData = JSON.parse(await readFile(cpuFile, 'utf8'));

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const report = {
  compared: 0,
  world: { max: 0, mean: 0 },
  view: { max: 0, mean: 0 },
  missing: 0
};

let worldSum = 0;
let viewSum = 0;
for (const vertex of cpuData.vertices) {
  const candidates = gpu.filter((v) => v.index === vertex.sourceIndex);
  const candidate = candidates.reduce((best, value) => {
    if (!best) return value;
    return distance(vertex.world, value.world) < distance(vertex.world, best.world) ? value : best;
  }, null);
  if (!candidate) {
    report.missing++;
    continue;
  }
  const worldError = distance(vertex.world, candidate.world);
  const viewError = distance(vertex.view, candidate.view);
  report.compared++;
  report.world.max = Math.max(report.world.max, worldError);
  report.view.max = Math.max(report.view.max, viewError);
  worldSum += worldError;
  viewSum += viewError;
}

if (report.compared) {
  report.world.mean = worldSum / report.compared;
  report.view.mean = viewSum / report.compared;
}

await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
