import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { planarSurfaces } from './plateau-surfaces.mjs';

const configs = {
  tocho: 'data/plateau/plateau-13104-shinjuku-ku-2025/53394525-geometry.json',
  'tokyo-tower': 'data/plateau/plateau-13103-minato-ku-2025/53393599-geometry.json'
};

const output = 'public/assets/universal-all-areas';
await mkdir(output, { recursive: true });

const report = { method: 'universal-wall-surface-registry-v1', areas: [] };
for (const [area, file] of Object.entries(configs)) {
  const geometry = JSON.parse(await readFile(file, 'utf8'));
  const result = planarSurfaces(geometry);
  const path = `${output}/${area}-surface-registry.json`;
  await writeFile(path, JSON.stringify({ area, ...result }, null, 2));
  report.areas.push({ area, surfaces: result.walls.length, rejected: result.rejected, registry: `/assets/universal-all-areas/${area}-surface-registry.json` });
}
await writeFile(`${output}/surface-registry-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
