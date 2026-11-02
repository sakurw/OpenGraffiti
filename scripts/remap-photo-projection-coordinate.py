import json
from pathlib import Path
from math import sqrt

base = Path('data/texture-city')
old = json.loads((base/'triangle-input-108038344.json').read_text())
new = json.loads((base/'triangle-input-v18-108038344.json').read_text())
proj = json.loads((base/'landmark-photo-projection-108038344-v2.json').read_text())

# Exact coordinate remap. The v18 build kept triangle order but regenerated vertex ids.
lookup = {}
for v in new['vertices']:
    lookup.setdefault(tuple(round(x, 6) for x in v['world']), []).append(v['id'])

old_to_new = {}
miss = 0
for v in old['vertices']:
    key = tuple(round(x, 6) for x in v['world'])
    ids = lookup.get(key)
    if ids:
        old_to_new[v['id']] = ids[0]
    else:
        miss += 1

tri_lookup = {tuple(t['vertexIds']): t for t in new['triangles']}
tri_lookup.update({tuple(reversed(t['vertexIds'])): t for t in new['triangles']})

resolved = []
missing = 0
for s in proj['samples']:
    mapped = [old_to_new.get(i) for i in s['vertexIds']]
    t = tri_lookup.get(tuple(mapped)) if None not in mapped else None
    if t is None:
        missing += 1
        continue
    resolved.append({**s, 'meshIndex': t['meshIndex'], 'primitiveId': t['primitiveId'], 'indexOffset': t['indexOffset'], 'gltfVertexIds': mapped})

out = {'status':'coordinate-remap-photo-atlas-map','resolved':len(resolved),'missing':missing,'vertexMissing':miss,'mappings':resolved}
(base/'photo-projection-coordinate-resolved-v1.json').write_text(json.dumps(out))
print(json.dumps({'resolved':len(resolved),'missing':missing,'vertexMissing':miss}))
