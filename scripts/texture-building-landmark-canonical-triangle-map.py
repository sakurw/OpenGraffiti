"""Create a stable triangle identity map across extraction and render captures."""
import argparse, json
from pathlib import Path

def fp(points):
    return tuple(sorted(tuple(round(float(x),5) for x in p) for p in points))

def geometry_fp(items):
    return hash(tuple(sorted(items)))

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--triangles', required=True)
    p.add_argument('--ranges', required=True)
    p.add_argument('--output', required=True)
    a=p.parse_args()
    src=json.loads(Path(a.triangles).read_text(encoding='utf-8'))
    ranges=json.loads(Path(a.ranges).read_text(encoding='utf-8'))
    verts={int(v['id']):v['world'] for v in src.get('vertices',[])}
    source_indices={int(v['id']):int(v.get('sourceIndex',-1)) for v in src.get('vertices',[])}
    index={}
    index_by_primitive_offset={}
    index_by_source_indices={}
    index_by_semantic_primitive_source={}
    index_by_mesh_primitive_vertices={}
    index_by_mesh_primitive_vertex_overlap={}
    semantic_geometry={}
    semantic_geometry_triangles={}
    for t in src.get('triangles',[]):
        index.setdefault(fp([verts[int(v)] for v in t['vertexIds']]),[]).append(int(t['id']))
        index_by_primitive_offset[(str(t.get('meshName','')), int(t.get('primitiveId',-1)), int(t.get('indexOffset',-1)))] = int(t['id'])
        index_by_source_indices.setdefault((int(t.get('meshIndex',-1)), int(t.get('primitiveId',-1)), tuple(sorted(source_indices[int(v)] for v in t['vertexIds']))), []).append(int(t['id']))
        index_by_semantic_primitive_source.setdefault((int(t.get('meshIndex',-1)), int(t.get('primitiveId',-1)), tuple(sorted(source_indices[int(v)] for v in t['vertexIds']))), []).append(int(t['id']))
        index_by_mesh_primitive_vertices.setdefault((str(t.get('meshName','')), int(t.get('primitiveId',-1)), fp([verts[int(v)] for v in t['vertexIds']])), []).append(int(t['id']))
        key=(int(t.get('meshIndex',-1)), int(t.get('primitiveId',-1)))
        for v in t['vertexIds']:
            index_by_mesh_primitive_vertex_overlap.setdefault((key, int(v)), []).append(int(t['id']))
        gkey=(int(t.get('meshIndex',-1)), int(t.get('primitiveId',-1)))
        semantic_geometry.setdefault(gkey, []).append(fp([verts[int(v)] for v in t['vertexIds']]))
        semantic_geometry_triangles.setdefault(gkey, []).append(int(t['id']))
    semantic_geometry_hash={k:geometry_fp(v) for k,v in semantic_geometry.items()}
    semantic_geometry_by_hash={v:k for k,v in semantic_geometry_hash.items()}
    # Keep a lightweight semantic adjacency index for triangles that lose their
    # direct identity during GLTFLoader index expansion. Boundary triangles can
    # still inherit provenance from a same-primitive neighbour.
    semantic_neighbors={}
    vertex_to_triangles={}
    for t in src.get('triangles',[]):
        tid=int(t['id'])
        semantic_neighbors.setdefault(tid,set())
        for v in t['vertexIds']:
            vertex_to_triangles.setdefault(int(v),[]).append(tid)
    for tids in vertex_to_triangles.values():
        for tid_a in tids:
            for tid_b in tids:
                if tid_a != tid_b:
                    semantic_neighbors[tid_a].add(tid_b)
    entries=[]
    confidence_scores=[]
    matched=0
    methods={'sourceIndex':0,'sourceVertexIndex':0,'semanticPrimitiveSource':0,'meshVertex':0,'worldFingerprint':0}
    for r in ranges:
        association = r.get('gltfAssociation') or {}
        render_mesh_index = int(association.get('meshes', r.get('meshIndex', -1)))
        render_primitive_index = int(association.get('primitives', r.get('semanticPrimitiveId', -1)))
        for i,pts in enumerate(r.get('triangleVertices',[])):
            m=[]
            matched_method=None
            source = r.get('sourceTriangles', [])
            if i < len(source):
                m=index_by_semantic_primitive_source.get((render_mesh_index, render_primitive_index, tuple(sorted(int(v) for v in source[i]))),[])
                if m:
                    methods['semanticPrimitiveSource'] += 1
                    matched_method='semanticPrimitiveSource'
            if i < len(source):
                # Render capture stores original indexed positions before the
                # temporary non-indexed conversion. Semantic extraction keeps
                # the original indexOffset.
                start = min(source[i])
                m = [index_by_primitive_offset.get((str(r.get('meshName','')), render_primitive_index, start), -1)]
                m = [x for x in m if x >= 0]
                if m:
                    methods['sourceIndex'] += 1
                    matched_method='sourceIndex'
            if not m and i < len(source):
                m=index_by_source_indices.get((render_mesh_index, render_primitive_index, tuple(sorted(int(v) for v in source[i]))),[])
                if m:
                    methods['sourceVertexIndex'] += 1
                    matched_method='sourceVertexIndex'
            if not m:
                m=index_by_mesh_primitive_vertices.get((str(r.get('meshName','')), render_primitive_index, fp(pts)),[])
                if m:
                    methods['meshVertex'] += 1
                    matched_method='meshVertex'
            if not m:
                m=index.get(fp(pts),[])
                if m:
                    methods['worldFingerprint'] += 1
                    matched_method='worldFingerprint'
            if not m:
                # Boundary fallback. Use the render triangle source vertices to
                # find a nearby semantic triangle from the same primitive. This
                # preserves provenance for tiny faces where exact ordering was
                # changed but the surface topology remains identical.
                if i < len(source):
                    source_vertices=set(int(v) for v in source[i])
                    candidates=[]
                    counts={}
                    for v in source_vertices:
                        for tid in index_by_mesh_primitive_vertex_overlap.get(((render_mesh_index, render_primitive_index), v), []):
                            counts[tid]=counts.get(tid,0)+1
                    candidates=[(overlap, tid) for tid, overlap in counts.items() if overlap >= 2]
                    if candidates:
                        # Prefer candidates that preserve the local surface shape.
                        # Shared vertex count alone can select a neighboring face
                        # when GLTF export split a mesh boundary.
                        scored=[]
                        source_normal=None
                        for tid in counts:
                            tri=next((x for x in src.get('triangles',[]) if int(x['id'])==int(tid)), None)
                            if tri:
                                normal=tri.get('normal',[0,0,0])
                                score=counts[tid]*10.0
                                if normal and i < len(r.get('normals', [])):
                                    rn=r['normals'][i]
                                    score += sum(float(a)*float(b) for a,b in zip(normal,rn))
                                scored.append((score,tid))
                        scored.sort(reverse=True)
                        m=[scored[0][1] if scored else candidates[0][1]]
                        methods['meshVertex'] += 1
                        matched_method='meshVertex'
            if not m and i < len(source):
                # Some GLTFLoader-expanded boundary triangles keep the same
                # source vertex ids but move across a primitive association.
                # Recover only very local neighbors with two shared vertices;
                # this keeps the provenance conservative while covering split
                # index buffers.
                source_vertices=set(int(v) for v in source[i])
                counts={}
                for v in source_vertices:
                    for tid in index_by_mesh_primitive_vertex_overlap.get(((render_mesh_index, render_primitive_index), v), []):
                        counts[tid]=counts.get(tid,0)+1
                candidates=[(overlap, tid) for tid, overlap in counts.items() if overlap >= 2]
                if candidates:
                    candidates.sort(reverse=True)
                    m=[candidates[0][1]]
                    methods['meshVertex'] += 1
                    matched_method='meshVertex'
            if not m and i < len(source):
                # Final topology fallback for duplicated render primitives.
                # Some GLTF exports duplicate identical triangles into separate
                # mesh groups. In that case meshIndex is not a stable identity,
                # but the original source vertex triplet is still exact.
                source_vertices = tuple(sorted(int(v) for v in source[i]))
                candidates = index_by_source_indices.get((render_mesh_index, render_primitive_index, source_vertices), [])
                if not candidates:
                    for key, values in index_by_source_indices.items():
                        if key[1] == render_primitive_index and key[2] == source_vertices:
                            candidates.extend(values)
                if candidates:
                    m=sorted(set(candidates))
                    methods['sourceVertexIndex'] += 1
                    matched_method='sourceVertexIndex'
            method = matched_method
            confidence = {'sourceIndex':1.0,'sourceVertexIndex':0.95,'semanticPrimitiveSource':0.9,'meshVertex':0.8,'worldFingerprint':0.7}.get(method, 0.0)
            ambiguous = len(m) > 1
            if ambiguous and method in ('meshVertex', 'worldFingerprint'):
                confidence = min(confidence, 0.6)
            if method is None and m:
                confidence = 0.8
                method = 'meshVertex'
            if m:
                confidence_scores.append(confidence)
            matched += bool(m)
            entries.append({'renderTriangleId':int(r.get('start',0))+i,'semanticTriangleIds':m,'provenanceMethod':method,'confidence':confidence,'ambiguous':ambiguous,'candidateCount':len(m)})
    # Recover tiny GLTF split boundary triangles after direct provenance matching.
    # These triangles can lose source indices while remaining part of the same
    # rendered surface. Only copy from immediate render neighbours with a valid
    # semantic assignment to avoid broad ambiguous propagation.
    by_render={e['renderTriangleId']:e for e in entries}
    for e in entries:
        if e['semanticTriangleIds']:
            continue
        rid=e['renderTriangleId']
        neighbours=[]
        for delta in (-2,-1,1,2):
            n=by_render.get(rid+delta)
            if n and n['semanticTriangleIds']:
                neighbours.append(n)
        if len(neighbours)==1:
            e['semanticTriangleIds']=list(neighbours[0]['semanticTriangleIds'])
            e['provenanceMethod']='renderBoundaryNeighbor'
            e['confidence']=0.7
            matched += 1
            methods.setdefault('renderBoundaryNeighbor',0)
            methods['renderBoundaryNeighbor'] += 1
            confidence_scores.append(0.7)
    out={'status':'canonical-triangle-map','semanticTriangleCount':len(src.get('triangles',[])),'renderTriangleCount':len(entries),'renderMatchedCount':matched,'renderMatchRatio':matched/max(1,len(entries)),'matchMethods':methods,'confidence':{'mean':sum(confidence_scores)/max(1,len(confidence_scores)),'min':min(confidence_scores) if confidence_scores else 0,'matchedTriangles':len(confidence_scores)},'entries':entries}
    Path(a.output).write_text(json.dumps(out,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in out.items() if k!='entries'}))
if __name__=='__main__': main()
