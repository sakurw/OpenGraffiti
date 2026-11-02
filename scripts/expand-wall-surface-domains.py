import json, argparse, math
from pathlib import Path

def norm(v):
    l=math.sqrt(sum(x*x for x in v))
    return [x/l for x in v] if l else [0,0,0]
def dot(a,b):
    return sum(x*y for x,y in zip(a,b))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--triangles',required=True)
    p.add_argument('--surfaces',required=True)
    p.add_argument('--output',required=True)
    a=p.parse_args()
    d=json.loads(Path(a.triangles).read_text(encoding='utf8'))
    tris={int(t['id']):t for t in d['triangles']}
    verts={int(v['id']):v['world'] for v in d['vertices']}
    src=json.loads(Path(a.surfaces).read_text(encoding='utf8'))
    out=[]
    for s in src['surfaces']:
        t=tris[s['triangles'][0]]
        pts=[verts[i] for i in t['vertexIds']]
        origin=pts[0]
        u=norm([pts[1][i]-origin[i] for i in range(3)])
        n=norm([u[1]*(pts[2][2]-origin[2])-u[2]*(pts[2][1]-origin[1]),u[2]*(pts[2][0]-origin[0])-u[0]*(pts[2][2]-origin[2]),u[0]*(pts[2][1]-origin[1])-u[1]*(pts[2][0]-origin[0])])
        v=norm([n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]])
        out.append({**s,'origin':origin,'axisU':u,'axisV':v,'normal':n})
    Path(a.output).write_text(json.dumps({'status':'wall-plane-generated','surfaceCount':len(out),'surfaces':out},indent=2),encoding='utf8')
    print(json.dumps({'surfaceCount':len(out)}))
if __name__=='__main__': main()
