"""Fail-closed, per-texel review gates for p171 photographic candidates.

The diagnostic source model differs from the formal delivery baseline.  A
source-space z-buffer match or a fitted photograph alone cannot authorize a
texture bake.  The three independently reviewed masks below require explicit,
hashed, component-scoped evidence.  Missing approvals always mean zero pixels.

Approval manifest (optional): p171-gray-visibility-review/p171-review-approvals.json
  schemaVersion: 1
  diagnosticModelSha256: <hash>
  formalBaselineSha256: <hash>
  polygonId: <id>
  atlasCropHalfOpen: [left, top, right, bottom]
  approvals:
    - sourceId: <id>
      componentId: <1-based 8-connected label within this source's safe mask>
      componentMaskSha256: <sha256 of 0/255 component mask crop bytes>
      gate: semanticOwnership | baselineCorrespondence | colourFit
      status: approved
      approvedMaskPath: <repo-relative 8-bit PNG, 0/255, cropped atlas size>
      approvedMaskSha256: <file hash>
      geometricMaskSha256: <hash of this run's source safe-mask PNG>
      evidencePath: <repo-relative, independently reviewed evidence file>
      evidenceSha256: <file hash>
      reviewedBy: <reviewer identifier>
      reviewNotes: <what was established for this component>

Mask hashes and metadata provide traceability, not automatic proof of physical
correspondence.  Evidence must be inspected before creating an approval entry.
"""

import hashlib
import json
from pathlib import Path

import cv2
import numpy as np


REVIEW_GATES = ("semanticOwnership", "baselineCorrespondence", "colourFit")


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def geometric_components(geometric_mask, atlas_crop):
    """Identify component labels and hashes for this source's geometric mask.

    OpenCV labels the 8-connected components in row-major order.  Hash each
    binary component mask over the full cropped atlas (255 inside, 0 outside).
    """
    geometric_mask = np.asarray(geometric_mask)
    if geometric_mask.ndim != 2 or geometric_mask.dtype != np.bool_:
        raise ValueError("geometric mask must be a 2D boolean array")
    if len(atlas_crop) != 4:
        raise ValueError("invalid atlas crop")
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        geometric_mask.astype(np.uint8), connectivity=8
    )
    left, top = int(atlas_crop[0]), int(atlas_crop[1])
    components = []
    for component_id in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[component_id])
        component_mask = (labels == component_id).astype(np.uint8) * 255
        components.append({
            "componentId": component_id,
            "safeTexels": area,
            "atlasBoundsHalfOpen": [left + x, top + y, left + x + w, top + y + h],
            "componentMaskSha256": hashlib.sha256(component_mask.tobytes()).hexdigest(),
        })
    return labels, components


def reviewed_masks(manifest_path, root, *, source_id, diagnostic_sha256,
                   baseline_sha256, polygon_id, atlas_crop, geometric_mask,
                   geometric_mask_sha256):
    """Load individually approved masks; reject stale or malformed evidence."""
    approved = {name: np.zeros_like(geometric_mask, dtype=bool) for name in REVIEW_GATES}
    if not manifest_path.is_file():
        return approved, []

    document = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    expected = {
        "schemaVersion": 1,
        "diagnosticModelSha256": diagnostic_sha256,
        "formalBaselineSha256": baseline_sha256,
        "polygonId": polygon_id,
        "atlasCropHalfOpen": list(atlas_crop),
    }
    for key, value in expected.items():
        if document.get(key) != value:
            raise ValueError(f"approval manifest {key} mismatch or missing")
    entries = document.get("approvals")
    if not isinstance(entries, list):
        raise ValueError("approval manifest approvals must be a list")

    root = Path(root).resolve()
    audit = []
    seen = set()
    labels, components = geometric_components(geometric_mask, atlas_crop)
    component_lookup = {c["componentId"]: c for c in components}

    def checked_path(raw):
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError("approval is missing an evidence/mask path")
        path = (root / raw).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"missing or out-of-tree approval file: {raw}")
        return path

    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("approval entry is not an object")
        if entry.get("sourceId") != source_id:
            continue
        component = entry.get("componentId")
        gate = entry.get("gate")
        if type(component) is not int or component not in component_lookup:
            raise ValueError("approval component identifier is absent from the current source mask")
        if entry.get("componentMaskSha256") != component_lookup[component]["componentMaskSha256"]:
            raise ValueError("component mask changed since approval")
        if gate not in REVIEW_GATES or entry.get("status") != "approved":
            raise ValueError("approval has unknown gate or status")
        key = (component, gate)
        if key in seen:
            raise ValueError(f"duplicate approval: {key}")
        seen.add(key)
        if entry.get("geometricMaskSha256") != geometric_mask_sha256:
            raise ValueError("geometric source mask changed since approval")
        for field in ("reviewedBy", "reviewNotes"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"approval is missing {field}")
        mask_path = checked_path(entry.get("approvedMaskPath"))
        evidence_path = checked_path(entry.get("evidencePath"))
        for path, key_name in ((mask_path, "approvedMaskSha256"),
                               (evidence_path, "evidenceSha256")):
            if file_sha256(path) != entry.get(key_name):
                raise ValueError(f"approval {key_name} is stale or incorrect")
        mask = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
        if mask is None or mask.ndim != 2 or mask.dtype != np.uint8:
            raise ValueError("approved mask must be an 8-bit grayscale PNG")
        if mask.shape != geometric_mask.shape or not np.isin(mask, (0, 255)).all():
            raise ValueError("approved mask must be cropped, binary, and shape-matched")
        eligible = mask == 255
        if not np.any(eligible) or np.any(eligible & ~geometric_mask):
            raise ValueError("approved pixels must be nonempty subset of geometric candidates")
        if np.any(eligible & (labels != component)):
            raise ValueError("approved pixels escape the specified connected component")
        approved[gate] |= eligible
        audit.append({
            "sourceId": source_id,
            "componentId": component,
            "gate": gate,
            "approvedTexels": int(eligible.sum()),
            "evidencePath": entry["evidencePath"],
            "evidenceSha256": entry["evidenceSha256"],
        })
    return approved, audit


def evaluate_bake_gates(geometric_mask, *, geometric_checks_pass,
                        colour_fit_candidate_usable, approvals):
    """Authorize only the intersection of the four independent conditions."""
    geometric_mask = np.asarray(geometric_mask, dtype=bool)
    masks = {}
    for gate in REVIEW_GATES:
        item = approvals.get(gate)
        if item is None:
            masks[gate] = np.zeros_like(geometric_mask)
        else:
            item = np.asarray(item)
            if item.shape != geometric_mask.shape or item.dtype != np.bool_:
                raise ValueError(f"invalid {gate} approval mask")
            if np.any(item & ~geometric_mask):
                raise ValueError(f"{gate} approval is outside geometric candidate")
            masks[gate] = item

    geometric_ready = bool(geometric_checks_pass) and bool(np.any(geometric_mask))
    semantic_safe = geometric_mask & masks["semanticOwnership"]
    bake_mask = (
        geometric_mask
        & masks["semanticOwnership"]
        & masks["baselineCorrespondence"]
        & masks["colourFit"]
    )
    if not geometric_ready or not colour_fit_candidate_usable:
        bake_mask[:] = False

    return bake_mask, {
        "geometricallySafeDirectObservation": geometric_ready,
        "geometricCandidateAtlasTexels": int(geometric_mask.sum()),
        "semanticOwnershipApprovedAtlasTexels": int(masks["semanticOwnership"].sum()),
        "semanticSafeAtlasTexels": int(semantic_safe.sum()),
        "baselineCorrespondenceApprovedAtlasTexels": int(masks["baselineCorrespondence"].sum()),
        "colourFitCandidateUsable": bool(colour_fit_candidate_usable),
        "colourFitApprovedAtlasTexels": int(masks["colourFit"].sum()),
        "safeForLaterBakeUnderThisAudit": bool(np.any(bake_mask)),
        "bakeReadySafeAtlasTexels": int(bake_mask.sum()),
        "reason": (
            "component-scoped semantic, baseline and colour-fit approvals intersect geometric-safe texels"
            if np.any(bake_mask)
            else "one or more reviewed gates are unapproved; diagnostic images cannot authorize a bake"
        ),
    }
