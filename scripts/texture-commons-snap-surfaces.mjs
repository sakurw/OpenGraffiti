// Commons adapter entry point.
// Commons SfM outputs are intentionally not treated as facade evidence until
// a PLATEAU coordinate registration exists. This adapter converts the stable
// camera/provenance part and keeps the missing registration gate explicit.

import { readFile, writeFile } from 'node:fs/promises';

const area = process.argv[2] || 'tocho';
if (area !== 'tocho') throw Error('Specify area');

const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
  || `data/texture-city/commons/snap-surfaces-${area}-target.json`;

const sfmRoot = 'data/texture-city/commons/sfm';
const files = await (await import('node:fs/promises')).readdir(sfmRoot, { withFileTypes: true });
const results = [];

for (const entry of files) {
  if (!entry.isDirectory()) continue;
  const path = `${sfmRoot}/${entry.name}/result.json`;
  try {
    const result = JSON.parse(await readFile(path, 'utf8'));
    if (!result.models?.length) continue;
    results.push(result);
  } catch {}
}

const photos = [];
for (const result of results) {
  for (const model of result.models) {
    for (const image of model.images || []) {
      const camera = model.cameras.find((item) => item.id === image.cameraId);
      if (!camera) continue;
      photos.push({
        id: image.id,
        provider: 'commons',
        cameraId: image.cameraId,
        camFromWorld: image.camFromWorld,
        relativeCenter: image.relativeCenter,
        camera,
        registered: false,
        evidenceState: 'requires-plateau-registration',
      });
    }
  }
}

const record = {
  areaId: area,
  applied: false,
  registrationRequired: true,
  surfaces: [],
  wallPhotoCandidates: [],
  photos,
  sourceMappings: [],
  policy: 'Commons SfM camera recovery is preserved; PLATEAU projection requires coordinate registration before coverage admission.',
};

await writeFile(output, JSON.stringify(record, null, 2));
console.log({ output, photos: photos.length, surfaces: 0, applied: false });
