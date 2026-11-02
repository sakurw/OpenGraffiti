import fs from 'fs';

const dir = 'data/texture-city/commons/candidate-148936434/';
const c = JSON.parse(fs.readFileSync(dir + '148936434.json', 'utf8'));
const edges = JSON.parse(fs.readFileSync(dir + 'edge-projection-review.json', 'utf8'));

function project(p) {
  const r = c.rotationMatrix;
  const t = c.translationVector;
  const v = r.map((row, i) => row.reduce((s, x, j) => s + x * p[j], t[i]));
  const x = v[0] / v[2];
  const y = v[1] / v[2];
  const k = c.referenceCameraMatrix;
  return [k[0][0] * x + k[0][2], k[1][1] * y + k[1][2]];
}

c.lineControls = edges.filter(x => [50, 2, 14, 76].includes(x.wall)).map((x, i) => ({
  name: `mesh-edge-${x.wall}`,
  world: [x.a, x.b],
  pixels: [project(x.a), project(x.b)],
  role: i === 3 ? 'held-out' : 'train'
}));

fs.writeFileSync('scripts/.tmp-tocho-commons-148936434-shared-projection-lines.json', JSON.stringify(c, null, 2));
console.log(c.lineControls.length);
