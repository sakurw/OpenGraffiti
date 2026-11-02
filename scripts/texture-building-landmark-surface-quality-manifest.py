"""Create a compact surface quality summary for landmark reconstruction."""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.input).read_text(encoding="utf-8"))
    surfaces = source.get("surfaces", [])
    quality_surfaces = []
    unresolved_surfaces = 0
    triangle_to_surface = {}
    for index, surface in enumerate(surfaces):
        triangles = surface.get("triangles", [])
        expanded = surface.get("expandedTriangleCount", 0)
        direct = len(triangles)
        total = max(direct + expanded, 1)
        if surface.get("wallId") is None or total == 1 and direct == 0 and expanded == 0:
            unresolved_surfaces += 1
        for triangle_id in surface.get("triangles", []):
            triangle_to_surface[str(triangle_id)] = index
        quality_surfaces.append({
            "surfaceId": index,
            "seedTriangle": surface.get("seedTriangle"),
            "wallId": surface.get("wallId"),
            "triangleCount": direct + expanded,
            "area": {
                "triangleCount": direct + expanded,
                "directPhotoTriangleCount": direct,
                "semanticExpandedTriangleCount": expanded,
            },
            "sourcePhotos": surface.get("photos", []),
            "confidence": round(direct / total, 4),
            "method": surface.get("method", "unknown"),
        })

    result = {
        "status": "landmark-surface-quality-manifest",
        "source": args.input,
        "surfaceCount": source.get("surfaceCount", 0),
        "reconstructedTriangleCount": source.get("reconstructedTriangleCount", 0),
        "surfaceStatistics": {
            "withWallId": sum(1 for x in source.get("surfaces", []) if x.get("wallId") is not None),
            "withExpandedTriangles": sum(1 for x in source.get("surfaces", []) if x.get("expandedTriangleCount", 0) > 0),
            "unresolvedSurfaces": unresolved_surfaces,
            "methodCounts": {},
        },
        "qualityPolicy": {
            "directObservationRequired": False,
            "semanticExpansionTracked": True,
            "provenanceRequired": True,
            "triangleCountIsNotArea": True,
        },
        "coverageInterpretation": {
            "renderCoverageAuditRequired": True,
            "photoBackedCoverageTarget": 0.9,
        },
        "surfaceQuality": quality_surfaces,
        "triangleToSurface": triangle_to_surface,
        "surfaceQualitySummary": {
            "resolvedSurfaceCount": len(surfaces) - unresolved_surfaces,
            "unresolvedSurfaceCount": unresolved_surfaces,
            "directObservationTriangleCount": sum(len(x.get("triangles", [])) for x in surfaces),
            "semanticExpansionTriangleCount": sum(x.get("expandedTriangleCount", 0) for x in surfaces),
            "renderAreaMeasurementAvailable": False,
        },
    }

    for surface in surfaces:
        method = surface.get("method", "unknown")
        result["surfaceStatistics"]["methodCounts"][method] = result["surfaceStatistics"]["methodCounts"].get(method, 0) + 1

    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "surfaceCount": result["surfaceCount"],
        "reconstructedTriangleCount": result["reconstructedTriangleCount"],
    }))


if __name__ == "__main__":
    main()
