import { readFile, writeFile } from 'node:fs/promises';

const [candidates, index = '0', output = 'data/texture-city/virtual-candidate-camera.json'] = process.argv.slice(2);

const data = JSON.parse(await readFile(candidates, 'utf8'));
const camera = data.cameras[Number(index)];

await writeFile(output, JSON.stringify({
  sourceId: camera.sourceId,
  cameraMatrix: camera.cameraMatrix,
  resolution: camera.resolution,
  rotationVector: camera.rotationVector,
  translationVector: camera.translationVector,
}, null, 2));

console.log(JSON.stringify({ output, sourceId: camera.sourceId }));
