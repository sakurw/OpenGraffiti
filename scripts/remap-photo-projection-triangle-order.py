import json
from pathlib import Path

base = Path('data/texture-city')
tri = json.loads((base/'triangle-input-v18-108038344.json').read_text())
proj = json.loads((base/'landmark-photo-projection-108038344-v2.json').read_text())

# v18 retained the triangle list length and ordering. Preserve the photographic
# projection and only replace the vertex/primitive identity with current data.
out = []
missing = 0
for s in proj['samples']:
    tid = s['triangleId']
    if tid >= len(tri['triangles']):
        missing += 1
        continue
    t = tri['triangles'][tid]
    out.append({**s, 'meshIndex': t['meshIndex'], 'primitiveId': t['primitiveId'], 'indexOffset': t['indexOffset'], 'gltfVertexIds': [tri['vertices'][i]['sourceIndex'] for i in t['vertexIds']]})

result = {'status':'triangle-order-remap-photo-atlas-map','resolved':len(out),'missing':missing,'mappings':out}
(base/'photo-projection-triangle-resolved-v1.json').write_text(json.dumps(result))
print(json.dumps({'resolved':len(out),'missing':missing}))
