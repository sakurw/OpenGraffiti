import fs from 'fs';

const dir = 'data/texture-city/commons/candidate-148936434/';
const base = JSON.parse(fs.readFileSync(dir + '148936434.json', 'utf8'));
const edges = JSON.parse(fs.readFileSync(dir + 'edge-projection-review.json', 'utf8'));

function project(p) {
  const r = base.rotationMatrix;
  const t = base.translationVector;
  const v = r.map((row, i) => row.reduce((s, x, j) => s + x * p[j], t[i]));
  if (v[2] <= 0) return null;
  const k = base.referenceCameraMatrix;
  return [k[0][0] * (v[0] / v[2]) + k[0][2], k[1][1] * (v[1] / v[2]) + k[1][2]];
}

const selected = [];
const usedWalls = new Set();
for (const edge of edges
  .filter((e) => e.projection.visible && e.projection.inFront)
  .sort((a, b) => b.projection.projectedLength - a.projection.projectedLength)) {
  if (usedWalls.has(edge.wall)) continue;
  const a = project(edge.a);
  const b = project(edge.b);
  if (!a || !b) continue;
  selected.push({
    name: `adaptive-edge-${edge.wall}`,
    world: [edge.a, edge.b],
    pixels: [a, b],
    role: selected.length < 3 ? 'train' : 'held-out',
    score: edge.projection.projectedLength,
  });
  usedWalls.add(edge.wall);
  if (selected.length === 6) break;
}

fs.writeFileSync('scripts/.tmp-tocho-adaptive-line-controls.json', JSON.stringify({ ...base, lineControls: selected }, null, 2));
console.log(JSON.stringify(selected.map((x) => ({ name: x.name, score: x.score })), null, 2));
