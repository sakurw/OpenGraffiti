"""Expand photo evidence through geometric adjacency in v4 triangles.

The expansion is constrained by normal similarity and shared vertices. It
allows PLATEAU semantic polygon splits to form a continuous facade domain.
"""

import argparse
import json
import math
from pathlib import Path
from collections import defaultdict, deque


def cosine(a, b):
    return sum(x*y for x, y in zip(a, b)) / max(1e-9, math.sqrt(sum(x*x for x in a))*math.sqrt(sum(x*x for x in b)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--triangles', required=True)
    p.add_argument('--projection', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding='utf-8'))['triangles']
    projection = json.loads(Path(args.projection).read_text(encoding='utf-8'))['samples']

    by_vertices = {tuple(sorted(t['vertexIds'])): t for t in triangles}
    selected = set()
    for sample in projection:
        t = by_vertices.get(tuple(sorted(sample['vertexIds'])))
        if t:
            selected.add(t['id'])

    vertex_owner = defaultdict(list)
    for t in triangles:
        for v in t['vertexIds']:
            vertex_owner[v].append(t['id'])

    by_id = {t['id']: t for t in triangles}
    allowed = set()
    queue = deque(selected)
    while queue:
        tid = queue.popleft()
        if tid in allowed:
            continue
        allowed.add(tid)
        base = by_id[tid]
        for v in base['vertexIds']:
            for nid in vertex_owner[v]:
                if nid in allowed:
                    continue
                other = by_id[nid]
                if cosine(base['normal'], other['normal']) >= 0.999:
                    queue.append(nid)

    # Keep surface membership in the manifest. The previous output only stored
    # a flat triangle list, which made later pixel audits unable to determine
    # whether a visible triangle belonged to the reconstructed facade domain.
    surfaces = [{
        'surfaceId': 'geometry-adjacency-wall-domain-0',
        'triangles': sorted(allowed),
    }]

    result = {
        'status': 'geometry-adjacency-surface-generated',
        'photoTriangleCount': len(selected),
        'expandedTriangleCount': len(allowed),
        'triangles': sorted(allowed),
        'surfaces': surfaces,
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'status': result['status'], 'photoTriangleCount': len(selected), 'expandedTriangleCount': len(allowed)}))


if __name__ == '__main__':
    main()
