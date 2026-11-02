import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const [cameras, output = 'data/texture-city/candidate-depth-plan-145064071.json'] = process.argv.slice(2);

const data = JSON.parse(await readFile(cameras, 'utf8'));
const results = [];

for (const camera of data.cameras || []) {
  results.push({
    sourceId: camera.sourceId,
    position: camera.position,
    lookAt: camera.lookAt,
    expectedUncoveredPixels: camera.expectedUncoveredPixels,
    status: 'ready-for-depth-render',
  });
}

const result = {
  status: 'candidate-depth-plan',
  count: results.length,
  candidates: results,
  next: 'render each candidate with landmark-depth renderer and measure marginal photo coverage',
};

await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, count: results.length }));
