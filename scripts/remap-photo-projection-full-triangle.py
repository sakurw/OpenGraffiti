import json
from pathlib import Path

base=Path('data/texture-city')
old=json.loads((base/'triangle-input-108038344.json').read_text())
new=json.loads((base/'triangle-input-v18-108038344.json').read_text())
proj=json.loads((base/'landmark-photo-projection-108038344-v2.json').read_text())

def sig(vertices, ids):
    return tuple(sorted(tuple(round(x,6) for x in vertices[i]['world']) for i in ids))

new_by_sig={}
for t in new['triangles']:
    new_by_sig[sig(new['vertices'], t['vertexIds'])]=t

resolved=[]
missing=0
for s in proj['samples']:
    if s['triangleId'] >= len(old['triangles']):
        missing+=1; continue
    old_t=old['triangles'][s['triangleId']]
    t=new_by_sig.get(sig(old['vertices'], old_t['vertexIds']))
    if not t:
        missing+=1; continue
    resolved.append({**s,'meshIndex':t['meshIndex'],'primitiveId':t['primitiveId'],'indexOffset':t['indexOffset'],'gltfVertexIds':[new['vertices'][i]['sourceIndex'] for i in t['vertexIds']]})

(base/'photo-projection-full-triangle-resolved-v1.json').write_text(json.dumps({'status':'full-triangle-remap','resolved':len(resolved),'missing':missing,'mappings':resolved}))
print(json.dumps({'resolved':len(resolved),'missing':missing}))
