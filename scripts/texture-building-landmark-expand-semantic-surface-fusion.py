"""Expand landmark photo evidence only inside the same PLATEAU surface.

The coplanar expander is intentionally geometric. This variant adds semantic
provenance as an additional boundary: a seed triangle can expand only to
triangles carrying the same polygonId or wallId provenance.
"""

import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--fusion', required=True)
    p.add_argument('--triangles', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()

    fusion = json.loads(Path(args.fusion).read_text(encoding='utf-8'))
    seeds = {int(x['triangleId']) for x in fusion.get('accepted', [])}
    triangles = json.loads(Path(args.triangles).read_text(encoding='utf-8'))['triangles']
    by_id = {t['id']: t for t in triangles}

    groups = {}
    for t in triangles:
        semantic = t.get('semantic') or {}
        # A photo observation can cover only part of a PLATEAU polygon after
        # triangulation. Keep the expansion boundary at the semantic wall
        # surface level, which is the same facade object in PLATEAU.
        key = semantic.get('wallId')
        if key is not None:
            groups.setdefault(key, []).append(t['id'])

    expanded = set(seeds)
    used_groups = set()
    for seed_id in seeds:
        semantic = by_id.get(seed_id, {}).get('semantic') or {}
        key = semantic.get('wallId')
        if key in groups:
            used_groups.add(key)
            expanded.update(groups[key])

    result = {
        'status': 'semantic-surface-fusion',
        'sourceSeedCount': len(seeds),
        'expandedCount': len(expanded),
        'surfaceGroupCount': len(used_groups),
        'accepted': [{'triangleId': int(x), 'depthConfidence': 1.0} for x in sorted(expanded)]
    }
    Path(args.output).write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: result[k] for k in ['status', 'sourceSeedCount', 'expandedCount', 'surfaceGroupCount']}))


if __name__ == '__main__':
    main()
