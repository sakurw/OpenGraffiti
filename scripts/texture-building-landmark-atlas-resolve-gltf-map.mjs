import { readFile, writeFile } from 'node:fs/promises';

const [atlasFile, semanticFile, output] = process.argv.slice(2);
if (!atlasFile || !semanticFile || !output) process.exit(1);

const atlas = JSON.parse(await readFile(atlasFile, 'utf8'));
const semantic = JSON.parse(await readFile(semanticFile, 'utf8'));

// primitiveId/indexOffset are only local to a mesh.  Some PLATEAU exports reuse
// the same primitive layout, so include vertex identity when resolving.
const triangles = new Map(semantic.triangles.map((t) => [
  `${t.primitiveId}:${t.indexOffset}:${(t.vertexIds || []).join(',')}`,
  t,
]));

const mappings = [];
let resolved = 0;
for (const m of atlas.mappings) {
  const t = triangles.get(`${m.primitiveId}:${m.indexOffset}:${(m.vertexIds || []).join(',')}`)
    || triangles.get(`${m.primitiveId}:${m.indexOffset}:${(m.vertexIds || []).slice().reverse().join(',')}`);
  if (!t) continue;
  mappings.push({
    ...m,
    meshIndex: t.meshIndex,
    meshName: t.meshName,
    gltfIndexOffset: t.indexOffset,
  });
  resolved++;
}

await writeFile(output, JSON.stringify({
  status: 'resolved-atlas-gltf-map',
  sourceCount: atlas.mappings.length,
  resolved,
  mappings,
}, null, 2));

console.log(JSON.stringify({sourceCount: atlas.mappings.length, resolved}));
