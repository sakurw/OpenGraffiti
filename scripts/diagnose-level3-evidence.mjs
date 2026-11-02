import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const buildingId = process.argv[2] || 'bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7';
const recipePath = 'public/assets/datasets/plateau-2025-v4/recipes/tocho.json';
const recipe = JSON.parse(await readFile(recipePath, 'utf8'));
const polygons = new Map();

function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item);
    return;
  }
  if (value.buildingId === buildingId && Array.isArray(value.polygons)) {
    for (const polygon of value.polygons) {
      if (polygon?.id && polygon?.image && Array.isArray(polygon.sourceUV)) {
        polygons.set(polygon.id, polygon);
      }
    }
  }
  for (const child of Object.values(value)) visit(child);
}
visit(recipe);

const cache = new Map();
async function loadTexture(webPath) {
  if (!cache.has(webPath)) {
    const localPath = webPath.startsWith('/') ? `public${webPath}` : webPath;
    cache.set(webPath, await sharp(localPath).raw().toBuffer({ resolveWithObject: true }));
  }
  return cache.get(webPath);
}

function sample(texture, u, v, legacyDoubleFlip) {
  const x = Math.max(0, Math.min(texture.info.width - 1, Math.round(u * (texture.info.width - 1))));
  const sourceV = legacyDoubleFlip ? 1 - v : v;
  const y = Math.max(0, Math.min(texture.info.height - 1, Math.round(sourceV * (texture.info.height - 1))));
  const offset = (y * texture.info.width + x) * texture.info.channels;
  return [texture.data[offset], texture.data[offset + 1], texture.data[offset + 2]];
}

function usable(rgb) {
  const luminance = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return luminance >= 28 && luminance <= 235;
}

const weights = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6],
  [0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8],
];

const rows = [];
for (const polygon of polygons.values()) {
  const texture = await loadTexture(polygon.image);
  const uv = polygon.sourceUV;
  const indices = Array.isArray(polygon.indices) && polygon.indices.length >= 3
    ? polygon.indices
    : Array.from({ length: polygon.points?.length || 0 }, (_, index) => index);
  let current = 0;
  let legacyDoubleFlip = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const triangle = indices.slice(i, i + 3);
    for (const barycentric of weights) {
      let u = 0;
      let v = 0;
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = triangle[corner];
        u += uv[vertex * 2] * barycentric[corner];
        v += uv[vertex * 2 + 1] * barycentric[corner];
      }
      if (usable(sample(texture, u, v, false))) current += 1;
      if (usable(sample(texture, u, v, true))) legacyDoubleFlip += 1;
    }
  }
  const us = uv.filter((_, index) => index % 2 === 0);
  const vs = uv.filter((_, index) => index % 2 === 1);
  rows.push({
    id: polygon.id,
    current,
    legacyDoubleFlip,
    uvBounds: [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)],
    image: polygon.image,
  });
}

const currentUsable = rows.filter((row) => row.current > 0).length;
const legacyDoubleFlipUsable = rows.filter((row) => row.legacyDoubleFlip > 0).length;
const currentFailed = rows.filter((row) => row.current === 0);
const onlyLegacyDoubleFlip = currentFailed.filter((row) => row.legacyDoubleFlip > 0);
const neither = rows.filter((row) => row.current === 0 && row.legacyDoubleFlip === 0);

console.log(JSON.stringify({
  buildingId,
  polygonCount: rows.length,
  currentUsable,
  legacyDoubleFlipUsable,
  currentFailed: currentFailed.length,
  onlyLegacyDoubleFlip: onlyLegacyDoubleFlip.length,
  neither: neither.length,
  currentFailedPolygons: currentFailed,
}, null, 2));
