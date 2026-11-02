import json
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--fusion', required=True)
parser.add_argument('--source', required=True)
parser.add_argument('--target', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()

fusion = json.loads(Path(args.fusion).read_text(encoding='utf-8'))['selected']
source = json.loads(Path(args.source).read_text(encoding='utf-8'))['triangles']
target = json.loads(Path(args.target).read_text(encoding='utf-8'))['triangles']

stable = {(x['primitiveId'], x['indexOffset']) for x in source if str(x['id']) in fusion}
accepted = [
    {'triangleId': x['id'], 'depthConfidence': 1.0}
    for x in target
    if (x['primitiveId'], x['indexOffset']) in stable
]

Path(args.output).write_text(json.dumps({'accepted': accepted}, indent=2), encoding='utf-8')
print(json.dumps({'accepted': len(accepted)}))
