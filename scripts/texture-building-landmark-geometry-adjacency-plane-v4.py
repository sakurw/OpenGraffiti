"""Create continuous plane domains from geometry adjacency output."""

import argparse
import json
import math
from pathlib import Path


def normalize(v):
    n = math.sqrt(sum(x*x for x in v))
    return [x/n for x in v] if n else [0, 0, 0]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--triangles', required=True)
    p.add_argument('--surface', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()

    triangles = {t['id']: t for t in json.loads(Path(args.triangles).read_text(encoding='utf-8'))['triangles']}
    selected = set(json.loads(Path(args.surface).read_text(encoding='utf-8'))['triangles'])

    points = []
    normals = []
    for tid in selected:
        t = triangles.get(tid)
        if not t:
            continue
        points.extend(t.get('worldVertices', []))
        normals.append(t['normal'])

    # The triangle input may not contain worldVertices. Preserve provenance and
    # emit a domain description; world coordinate attachment is filled by the
    # next mesh-aware stage.
    normal = normalize([sum(n[i] for n in normals) for i in range(3)]) if normals else [0, 1, 0]
    result = {
        'status': 'geometry-adjacency-plane-domain-generated',
        'triangleCount': len(selected),
        'normal': normal,
        'triangles': sorted(selected),
        'method': 'connected-v4-triangle-plane-domain'
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'status': result['status'], 'triangleCount': result['triangleCount']}))


if __name__ == '__main__':
    main()
