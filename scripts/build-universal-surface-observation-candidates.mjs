import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

// Surface observation candidate stage. Geographic proximity and heading are
// retained as candidates only. Direct observation requires later image/model
// verification.
const root = 'public/assets/universal-all-areas';
const photoRoot = 'data/texture-city/photos/msls';

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

for (const area of ['tocho', 'tokyo-tower']) {
  const registry = JSON.parse(await readFile(`${root}/${area}-surface-registry.json`, 'utf8'));
  const photos = [];
  for (const name of await readdir(photoRoot)) {
    if (!name.endsWith('.json')) continue;
    try {
      const row = JSON.parse(await readFile(`${photoRoot}/${name}`, 'utf8'));
      if (Number.isFinite(row.lon) && Number.isFinite(row.lat)) photos.push(row);
    } catch {}
  }

  const surfaces = registry.walls.map(surface => {
    const candidates = photos.map(photo => {
      const p = photo.localPosition ?? [0, 0, 0];
      const d = distance([surface.center[0], surface.center[2]], [p[0], p[2]]);
      return { imageId: photo.id ?? name, distance: d, state: 'candidate-only' };
    }).sort((a, b) => a.distance - b.distance).slice(0, 5);
    return { surfaceId: surface.surfaceId, buildingId: surface.buildingId, candidates };
  });

  await writeFile(`${root}/${area}-surface-observation-candidates.json`, JSON.stringify({
    method: 'surface-observation-candidates-v1',
    area,
    surfaces
  }, null, 2));
}

console.log('surface observation candidates generated');
