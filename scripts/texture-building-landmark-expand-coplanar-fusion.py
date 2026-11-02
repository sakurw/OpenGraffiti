import argparse
import json
from pathlib import Path
import numpy as np


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--fusion', required=True)
    p.add_argument('--triangles', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--normal-dot', type=float, default=0.995)
    args = p.parse_args()

    fusion = json.loads(Path(args.fusion).read_text(encoding='utf-8'))['selected']
    triangles = json.loads(Path(args.triangles).read_text(encoding='utf-8'))['triangles']
    seed = {str(x) for x in fusion}

    # Landmark photos directly observe a PLATEAU triangle. Extend only inside
    # the same primitive and nearly identical facade plane. This keeps the
    # evidence on the same geometric surface and avoids arbitrary texture fill.
    seed_tri = [t for t in triangles if str(t['id']) in seed]
    normal_bins = {}
    for t in triangles:
        n = np.asarray(t.get('normal', [0, 0, 0]), dtype=float)
        length = np.linalg.norm(n)
        if length:
            key = (t['primitiveId'], tuple(np.round(n / length, 3)))
            normal_bins.setdefault(key, []).append(t)

    primitive_bins = {}
    for (primitive_id, normal_key), candidates in normal_bins.items():
        primitive_bins.setdefault(primitive_id, []).append((normal_key, candidates))

    expanded = set(seed)
    expansion_cache = {}
    for t in seed_tri:
        n = np.asarray(t.get('normal', [0, 0, 0]), dtype=float)
        length = np.linalg.norm(n)
        if length == 0:
            continue
        n /= length
        rounded_normal = tuple(np.round(n, 3))
        cache_key = (t['primitiveId'], rounded_normal)
        if cache_key in expansion_cache:
            expanded.update(expansion_cache[cache_key])
            continue
        additions = set()
        # Search only nearby normal buckets. This keeps the extension bounded
        # for large PLATEAU meshes while preserving the coplanar constraint.
        for normal_key, candidates in primitive_bins.get(t['primitiveId'], []):
            if float(np.dot(n, np.asarray(normal_key, dtype=float))) >= args.normal_dot:
                for c in candidates:
                    additions.add(str(c['id']))
        expansion_cache[cache_key] = additions
        expanded.update(additions)

    out = {'accepted': [{'triangleId': int(x), 'depthConfidence': 1.0} for x in expanded],
           'sourceSeedCount': len(seed), 'expandedCount': len(expanded)}
    Path(args.output).write_text(json.dumps(out, indent=2), encoding='utf-8')
    print(json.dumps(out))


if __name__ == '__main__':
    main()
