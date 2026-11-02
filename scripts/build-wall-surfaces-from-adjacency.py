import json
from pathlib import Path
import argparse

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--triangles', required=True)
    p.add_argument('--adjacency', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding='utf8'))
    ids = set(json.loads(Path(args.adjacency).read_text(encoding='utf8'))['triangles'])
    triangles = {int(t['id']): t for t in data['triangles']}

    # Keep the generated domains conservative: the geometry adjacency stage
    # already selected facade candidates. Split by mesh and near-identical
    # normals to avoid merging unrelated sides of the building.
    buckets = {}
    for tid in ids:
        t = triangles.get(tid)
        if not t:
            continue
        n = t.get('normal', [0, 0, 0])
        key = (t.get('meshName'), round(n[0], 2), round(n[1], 2), round(n[2], 2))
        buckets.setdefault(key, []).append(tid)

    surfaces = []
    for i, tri_ids in enumerate(buckets.values()):
        first = triangles[tri_ids[0]]
        surfaces.append({
            'wallId': 'adjacency-wall-%d' % i,
            'triangles': sorted(tri_ids),
            'normal': first.get('normal'),
            'method': 'mesh-normal-adjacency-domain'
        })

    Path(args.output).write_text(json.dumps({'status':'wall-surfaces-generated','surfaceCount':len(surfaces),'surfaces':surfaces}, indent=2), encoding='utf8')
    print(json.dumps({'surfaceCount':len(surfaces),'triangleCount':sum(len(x['triangles']) for x in surfaces)}))

if __name__ == '__main__':
    main()
