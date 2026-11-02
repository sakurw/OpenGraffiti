"""Audit whether render geometries are subsets of semantic primitives."""
import json
from pathlib import Path
from collections import defaultdict


def fp(points):
    return tuple(sorted(tuple(round(float(x), 5) for x in p) for p in points))


root = Path('.')
semantic = json.loads((root / 'data/texture-city/triangle-input-145064071-semantic-v4.json').read_text())
ranges = json.loads((root / 'data/texture-city/render-capture-photo-camera-three-145064071/triangle-id-ranges.json').read_text())

vertices = {int(v['id']): v['world'] for v in semantic['vertices']}
primitive_triangles = defaultdict(set)
triangle_lookup = {}
for t in semantic['triangles']:
    key = fp([vertices[int(v)] for v in t['vertexIds']])
    primitive_triangles[(int(t['meshIndex']), int(t['primitiveId']))].add(key)
    triangle_lookup[key] = int(t['id'])

matched = 0
contained = 0
best = []
for r in ranges:
    render_keys = {fp(x) for x in r.get('triangleVertices', [])}
    overlap = []
    for primitive, keys in primitive_triangles.items():
        count = len(render_keys & keys)
        if count:
            overlap.append((count, primitive))
    overlap.sort(reverse=True)
    if overlap:
        matched += 1
        if overlap[0][0] == len(render_keys):
            contained += 1
        best.append(overlap[0][0] / max(1, len(render_keys)))

print(json.dumps({
    'renderGeometryCount': len(ranges),
    'geometryWithTriangleOverlap': matched,
    'fullyContainedGeometry': contained,
    'bestOverlapAverage': sum(best) / max(1, len(best))
}, indent=2))
