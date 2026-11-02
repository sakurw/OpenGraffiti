"""Build photo-backed wall-local domains from the v4 adjacency surface."""

import argparse
import json
from pathlib import Path


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def project(point, origin, u, v):
    return [dot([point[i] - origin[i] for i in range(3)], u), dot([point[i] - origin[i] for i in range(3)], v)]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--triangles', required=True)
    p.add_argument('--surface', required=True)
    p.add_argument('--projection', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()

    data = json.loads(Path(args.triangles).read_text(encoding='utf-8'))
    triangles = {t['id']: t for t in data['triangles']}
    vertices = {v['id']: v['world'] for v in data['vertices']}
    selected = set(json.loads(Path(args.surface).read_text(encoding='utf-8'))['triangles'])
    samples = {tuple(sorted(x['vertexIds'])): x for x in json.loads(Path(args.projection).read_text(encoding='utf-8'))['samples']}

    first = triangles[next(iter(selected))]
    normal = first['normal']
    origin = vertices[first['vertexIds'][0]]
    u = [1, 0, 0] if abs(normal[0]) < .9 else [0, 1, 0]
    # stable tangent on the facade plane
    length = sum((u[i] - normal[i] * dot(u, normal)) ** 2 for i in range(3)) ** .5
    u = [(u[i] - normal[i] * dot(u, normal)) / length for i in range(3)]
    v = [normal[1]*u[2]-normal[2]*u[1], normal[2]*u[0]-normal[0]*u[2], normal[0]*u[1]-normal[1]*u[0]]

    out = []
    for t in triangles.values():
        if t['id'] not in selected:
            continue
        sample = samples.get(tuple(sorted(t['vertexIds'])))
        if not sample:
            continue
        local = [project(vertices[i], origin, u, v) for i in t['vertexIds']]
        out.append({**sample, 'meshIndex': t['meshIndex'], 'primitiveId': t['primitiveId'], 'indexOffset': t['indexOffset'], 'wallId': 'adjacency-surface-v4', 'wallLocalPolygon': local})

    Path(args.output).write_text(json.dumps({'status':'adjacency-photo-domain-generated','sampleCount':len(out),'samples':out}, indent=2), encoding='utf-8')
    print(json.dumps({'status':'adjacency-photo-domain-generated','sampleCount':len(out)}))


if __name__ == '__main__':
    main()
