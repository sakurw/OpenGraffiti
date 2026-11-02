import { readFile } from 'node:fs/promises';

const path = 'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json';
const data = JSON.parse(await readFile(path, 'utf8'));
console.log('root keys', Object.keys(data));
console.log('origin', data.origin);
console.log('building count', data.buildings?.length ?? 0);
for (const [index, building] of (data.buildings ?? [])
  .map((building, index) => ({ building, index }))
  .sort((a, b) => (b.building.max?.[1] ?? 0) - (a.building.max?.[1] ?? 0))
  .slice(0, 20)
  .entries()) {
  const b = building.building;
  console.log(JSON.stringify({
    rank: index + 1,
    sourceIndex: building.index,
    id: b.id,
    name: b.name,
    lod: b.lod,
    min: b.min,
    max: b.max,
    center: b.center,
    polygonCount: b.polygons?.length,
    wallCount: b.walls?.length,
    keys: Object.keys(b),
  }));
}

const target = data.buildings[490];
console.log('target sample polygon', JSON.stringify(target.polygons?.[0]));
console.log('target sample wall', JSON.stringify(target.walls?.[0]));
