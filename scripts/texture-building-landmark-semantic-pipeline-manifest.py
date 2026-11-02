"""Create a reproducible manifest for landmark semantic atlas generation.

This records the artifact chain used by the high precision landmark workflow
so that a result can be traced from photo fusion to GLB validation.
"""

import argparse
import json
from pathlib import Path


def exists(path):
    return Path(path).exists()


def load_config(path):
    if not path:
        return None
    return json.loads(Path(path).read_text(encoding="utf-8"))


def resolve_config(path, building, root):
    if path:
        return path
    candidate = root / f"{building}-landmark-config.json"
    if candidate.exists():
        return str(candidate)
    return None


def validate_config(config):
    if not config:
        return False, ["missing-config"]
    required = [
        ("buildingId", config.get("buildingId")),
        ("input.plateauModel", config.get("input", {}).get("plateauModel")),
        ("input.photos", config.get("input", {}).get("photos")),
        ("input.cameraQuality", config.get("input", {}).get("cameraQuality")),
        ("reconstruction.surfaceClass", config.get("reconstruction", {}).get("surfaceClass")),
        ("reconstruction.semanticPropagation", config.get("reconstruction", {}).get("semanticPropagation")),
        ("reconstruction.fusion.method", config.get("reconstruction", {}).get("fusion", {}).get("method")),
        ("reconstruction.provenance", config.get("reconstruction", {}).get("provenance")),
        ("reconstruction.surfaceQuality", config.get("reconstruction", {}).get("surfaceQuality")),
        ("validation.audit", config.get("validation", {}).get("audit")),
        ("validation.minimumViewCoverage", config.get("validation", {}).get("minimumViewCoverage")),
    ]
    missing = [name for name, value in required if value is None]
    return len(missing) == 0, missing


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", required=True)
    p.add_argument("--building", default="tocho")
    p.add_argument("--root", default="data/texture-city")
    p.add_argument("--semantic-mapping")
    p.add_argument("--atlas-texture")
    p.add_argument("--generated-glb")
    p.add_argument("--multi-view-audit")
    p.add_argument("--final-audit")
    p.add_argument("--config")
    args = p.parse_args()

    root = Path(args.root)
    config_path = resolve_config(args.config, args.building, root)
    config = load_config(config_path)
    config_valid, config_errors = validate_config(config)
    artifacts = {
        "semanticMapping": args.semantic_mapping or str(root / "landmark-atlas-uv-semantic-upper-bound.json"),
        "atlasTexture": args.atlas_texture or str(root / "landmark-atlas-v2.png"),
        "generatedGlb": args.generated_glb or str(root / "tocho-semantic-upper-bound-test.glb"),
        "multiViewAudit": args.multi_view_audit or str(root / "landmark-multi-view-final-audit.json"),
        "finalAudit": args.final_audit or str(root / "final-audit-semantic-glb-path.json"),
    }

    result = {
        "status": "landmark-semantic-pipeline-manifest",
        "building": args.building,
        "coverageTarget": config.get("reconstruction", {}).get("coverageTarget", 0.90) if config else 0.90,
        "configuration": config_path,
        "config": config,
        "configurationValid": config_valid,
        "configurationErrors": config_errors,
        "artifacts": [
            {"name": name, "path": path, "available": exists(path)}
            for name, path in artifacts.items()
        ],
    }
    result["allArtifactsAvailable"] = all(x["available"] for x in result["artifacts"])
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "allArtifactsAvailable": result["allArtifactsAvailable"],
    }))


if __name__ == "__main__":
    main()
