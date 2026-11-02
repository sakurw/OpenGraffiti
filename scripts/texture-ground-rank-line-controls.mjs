import fs from 'fs';

const input = 'data/texture-city/commons/candidate-148936434/edge-projection-review.json';
const output = 'scripts/.tmp-tocho-ranked-line-controls.json';
const c = JSON.parse(fs.readFileSync('data/texture-city/commons/candidate-148936434/148936434.json', 'utf8'));
const edges = JSON.parse(fs.readFileSync(input, 'utf8'));

function project(p) {
  const r = c.rotationMatrix;
  const t = c.translationVector;
  const v = r.map((row, i) => row.reduce((s, x, j) => s + x * p[j], t[i]));
  const k = c.referenceCameraMatrix;
  return [k[0][0] * (v[0] / v[2]) + k[0][2], k[1][1] * (v[1] / v[2]) + k[1][2]];
}

const ranked = edges
  .filter(e => e.projection.visible && e.projection.inFront)
  .map(e => ({
    ...e,
    score: e.projection.projectedLength * Math.min(1, e.reviewScore / 150)
  }))
  .sort((a, b) => b.score - a.score);

c.lineControls = ranked.slice(0, 3).map((e, i) => ({
  name: `ranked-edge-${e.wall}`,
  world: [e.a, e.b],
  pixels: [project(e.a), project(e.b)],
  role: i === 2 ? 'held-out' : 'train'
}));

fs.writeFileSync(output, JSON.stringify(c, null, 2));
console.log(JSON.stringify(ranked.slice(0, 5).map(e => ({ wall: e.wall, score: e.score })), null, 2));
