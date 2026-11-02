import json
from pathlib import Path

b = Path('data/texture-city')
tri = json.loads((b/'triangle-input-v18-108038344.json').read_text(encoding='utf-8'))
proj = json.loads((b/'landmark-photo-projection-108038344-v2.json').read_text(encoding='utf-8'))

by_id = {int(t['id']): t for t in tri['triangles']}
out = []
missing = 0
for s in proj['samples']:
    t = by_id.get(int(s['triangleId']))
    if not t:
        missing += 1
        continue
    out.append({
        **s,
        'meshIndex': t.get('meshIndex'),
        'primitiveId': t.get('primitiveId'),
        'indexOffset': t.get('indexOffset'),
        'gltfVertexIds': [tri['vertices'][i].get('sourceIndex', i) for i in t['vertexIds']],
        'v18VertexIds': t['vertexIds']
    })

result = {'status':'triangleid-v18-remap', 'resolved':len(out), 'missing':missing, 'mappings':out}
(b/'photo-projection-triangleid-v18-resolved.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({'resolved':len(out), 'missing':missing}))
