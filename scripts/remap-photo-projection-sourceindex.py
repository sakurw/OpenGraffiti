import json
from pathlib import Path

b = Path('data/texture-city')
old = json.loads((b / 'triangle-input-108038344.json').read_text())
new = json.loads((b / 'triangle-input-v18-108038344.json').read_text())
proj = json.loads((b / 'landmark-photo-projection-108038344-v2.json').read_text())

triangles = {}
for t in new['triangles']:
    key = ','.join(map(str, sorted(new['vertices'][i]['sourceIndex'] for i in t['vertexIds'])))
    triangles[key] = t

out = []
for s in proj['samples']:
    key = ','.join(map(str, sorted(old['vertices'][i]['sourceIndex'] for i in s['vertexIds'])))
    t = triangles.get(key)
    if t:
        out.append({**s, 'meshIndex': t['meshIndex'], 'primitiveId': t['primitiveId'],
                    'indexOffset': t['indexOffset'],
                    'gltfVertexIds': [new['vertices'][i]['sourceIndex'] for i in t['vertexIds']]})

(b / 'photo-projection-sourceindex-resolved-v1.json').write_text(
    json.dumps({'status':'sourceindex-remap', 'resolved':len(out),
                'missing':len(proj['samples'])-len(out), 'mappings':out}, indent=2))
print(json.dumps({'resolved': len(out), 'missing': len(proj['samples'])-len(out)}))
