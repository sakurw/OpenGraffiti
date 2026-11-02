"""Regression checks for p171 photographic candidate approval boundaries."""

import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "tocho_p171_bake_gates", ROOT / "scripts/tocho-p171-bake-gates.py"
)
gates = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gates)


class BakeGateTests(unittest.TestCase):
    def setUp(self):
        self.geometric = np.array([[True, True, False], [False, True, True]])
        self.none = {key: np.zeros_like(self.geometric) for key in gates.REVIEW_GATES}

    def evaluate(self, approvals, fit=True, geometry=True):
        return gates.evaluate_bake_gates(
            self.geometric, approvals=approvals,
            geometric_checks_pass=geometry, colour_fit_candidate_usable=fit,
        )

    def create_component_review(self, root):
        """Create two disconnected synthetic facades for approval-boundary tests."""
        root = Path(root)
        geometric = np.zeros((7, 8), dtype=bool)
        geometric[1:3, 1:3] = True
        geometric[4:6, 5:7] = True
        crop = [10, 20, 18, 27]
        labels, components = gates.geometric_components(geometric, crop)
        source_mask_path = root / "geometric.png"
        self.assertTrue(cv2.imwrite(str(source_mask_path), geometric.astype(np.uint8) * 255))
        approved_mask_path = root / "approved.png"
        self.assertTrue(cv2.imwrite(str(approved_mask_path), (labels == 1).astype(np.uint8) * 255))
        evidence_path = root / "evidence.txt"
        evidence_path.write_text("synthetic geometry review", encoding="utf-8")
        document = {
            "schemaVersion": 1, "diagnosticModelSha256": "diagnostic-sha",
            "formalBaselineSha256": "baseline-sha", "polygonId": "polygon-171",
            "atlasCropHalfOpen": crop,
            "approvals": [{
                "sourceId": "145089656", "componentId": 1,
                "componentMaskSha256": components[0]["componentMaskSha256"],
                "gate": "semanticOwnership", "status": "approved",
                "approvedMaskPath": "approved.png",
                "approvedMaskSha256": gates.file_sha256(approved_mask_path),
                "geometricMaskSha256": gates.file_sha256(source_mask_path),
                "evidencePath": "evidence.txt",
                "evidenceSha256": gates.file_sha256(evidence_path),
                "reviewedBy": "synthetic-test", "reviewNotes": "synthetic fixture only",
            }],
        }
        options = {
            "source_id": "145089656", "diagnostic_sha256": "diagnostic-sha",
            "baseline_sha256": "baseline-sha", "polygon_id": "polygon-171",
            "atlas_crop": crop, "geometric_mask": geometric,
            "geometric_mask_sha256": gates.file_sha256(source_mask_path),
        }
        manifest_path = root / "approvals.json"
        self.write_manifest(manifest_path, document)
        return manifest_path, document, options, labels, components

    @staticmethod
    def write_manifest(path, document):
        path.write_text(json.dumps(document), encoding="utf-8")

    def test_geometric_components_stable_masks_hashes_and_bounds(self):
        with tempfile.TemporaryDirectory() as temp:
            _, _, options, labels, components = self.create_component_review(temp)
            self.assertEqual(len(components), 2)
            self.assertEqual([c["safeTexels"] for c in components], [4, 4])
            self.assertEqual([c["atlasBoundsHalfOpen"] for c in components],
                             [[11, 21, 13, 23], [15, 24, 17, 26]])
            for component in components:
                mask_bytes = (labels == component["componentId"]).astype(np.uint8) * 255
                self.assertEqual(component["componentMaskSha256"],
                                 hashlib.sha256(mask_bytes.tobytes()).hexdigest())
            self.assertTrue(np.array_equal(labels > 0, options["geometric_mask"]))

    def test_component_scoped_approval_accepts_only_its_own_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            path, _, options, labels, _ = self.create_component_review(temp)
            approved, audit = gates.reviewed_masks(path, temp, **options)
            self.assertEqual(len(audit), 1)
            self.assertEqual(audit[0]["componentId"], 1)
            self.assertTrue(np.array_equal(approved["semanticOwnership"], labels == 1))
            self.assertFalse(approved["baselineCorrespondence"].any())
            mask, summary = gates.evaluate_bake_gates(
                options["geometric_mask"], approvals=approved,
                geometric_checks_pass=True, colour_fit_candidate_usable=True,
            )
            self.assertFalse(mask.any())
            self.assertEqual(summary["geometricCandidateAtlasTexels"], 8)
            self.assertEqual(summary["semanticSafeAtlasTexels"], 4)
            self.assertEqual(summary["bakeReadySafeAtlasTexels"], 0)

    def test_missing_invalid_and_stale_component_identifiers_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path, document, options, _, _ = self.create_component_review(temp)
            original = document["approvals"][0]["componentId"]
            for bad_id in (None, 0, 3, True, "1"):
                with self.subTest(componentId=bad_id):
                    document["approvals"][0]["componentId"] = bad_id
                    self.write_manifest(path, document)
                    with self.assertRaisesRegex(ValueError, "component identifier"):
                        gates.reviewed_masks(path, temp, **options)
            document["approvals"][0]["componentId"] = original
            for sha in (None, "0" * 64):
                with self.subTest(componentHash=sha):
                    document["approvals"][0]["componentMaskSha256"] = sha
                    self.write_manifest(path, document)
                    with self.assertRaisesRegex(ValueError, "component mask changed"):
                        gates.reviewed_masks(path, temp, **options)

    def test_component_boundary_and_cross_component_mask_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path, document, options, labels, components = self.create_component_review(temp)
            approved_mask_path = Path(temp) / "approved.png"
            for candidate in ((labels == 2), (labels > 0)):
                with self.subTest(candidateTexels=int(candidate.sum())):
                    self.assertTrue(cv2.imwrite(str(approved_mask_path), candidate.astype(np.uint8) * 255))
                    document["approvals"][0]["approvedMaskSha256"] = gates.file_sha256(approved_mask_path)
                    self.write_manifest(path, document)
                    with self.assertRaisesRegex(ValueError, "escape the specified connected component"):
                        gates.reviewed_masks(path, temp, **options)
            document["approvals"][0]["componentId"] = 2
            document["approvals"][0]["componentMaskSha256"] = components[1]["componentMaskSha256"]
            self.assertTrue(cv2.imwrite(str(approved_mask_path), (labels == 2).astype(np.uint8) * 255))
            document["approvals"][0]["approvedMaskSha256"] = gates.file_sha256(approved_mask_path)
            self.write_manifest(path, document)
            approved, _ = gates.reviewed_masks(path, temp, **options)
            self.assertTrue(np.array_equal(approved["semanticOwnership"], labels == 2))

    def test_other_source_component_hash_cannot_authorize_changed_geometry(self):
        with tempfile.TemporaryDirectory() as temp:
            path, document, options, _, _ = self.create_component_review(temp)
            other = np.zeros_like(options["geometric_mask"])
            other[1:3, 2:4] = True
            _, components = gates.geometric_components(other, options["atlas_crop"])
            document["approvals"][0]["componentMaskSha256"] = components[0]["componentMaskSha256"]
            self.write_manifest(path, document)
            with self.assertRaisesRegex(ValueError, "component mask changed"):
                gates.reviewed_masks(path, temp, **options)

    def test_colour_fit_alone_must_not_enable_bake(self):
        mask, audit = self.evaluate(self.none)
        self.assertFalse(mask.any())
        self.assertEqual(audit["semanticSafeAtlasTexels"], 0)
        self.assertEqual(audit["bakeReadySafeAtlasTexels"], 0)

    def test_semantic_without_baseline_must_not_enable_bake(self):
        approved = {key: self.geometric.copy() for key in gates.REVIEW_GATES}
        approved["baselineCorrespondence"][:] = False
        mask, audit = self.evaluate(approved)
        self.assertFalse(mask.any())
        self.assertEqual(audit["semanticSafeAtlasTexels"], 4)
        self.assertFalse(audit["safeForLaterBakeUnderThisAudit"])

    def test_other_unverified_gates_and_missing_values_fail_closed(self):
        approved = {key: self.geometric.copy() for key in gates.REVIEW_GATES}
        for absent in gates.REVIEW_GATES:
            case = {key: val.copy() for key, val in approved.items()}
            case.pop(absent)
            mask, _ = self.evaluate(case)
            self.assertFalse(mask.any(), absent)
        for flag in ("fit", "geometry"):
            mask, _ = self.evaluate(approved, **{flag: False})
            self.assertFalse(mask.any(), flag)

    def test_only_intersection_of_approved_texels_is_bake_ready(self):
        approved = {key: self.geometric.copy() for key in gates.REVIEW_GATES}
        approved["semanticOwnership"][0, 1] = False
        approved["baselineCorrespondence"][1, 1] = False
        approved["colourFit"][1, 2] = False
        mask, audit = self.evaluate(approved)
        self.assertEqual(int(mask.sum()), 1)
        self.assertTrue(mask[0, 0])
        self.assertTrue(audit["safeForLaterBakeUnderThisAudit"])
        self.assertEqual(audit["semanticSafeAtlasTexels"], 3)

    def test_outside_geometry_cannot_be_approved(self):
        approved = {key: self.geometric.copy() for key in gates.REVIEW_GATES}
        approved["semanticOwnership"][0, 2] = True
        with self.assertRaises(ValueError):
            self.evaluate(approved)

    def test_mask_data_requires_binary_boolean_and_matching_shape(self):
        for malformed in (np.ones((1, 3), dtype=bool),
                          self.geometric.astype(np.uint8)):
            with self.assertRaises(ValueError):
                self.evaluate({"semanticOwnership": malformed})

    def test_review_manifest_missing_and_tampered_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = root / "approvals.json"
            options = {
                "source_id": "145089656", "diagnostic_sha256": "diag",
                "baseline_sha256": "formal", "polygon_id": "poly171",
                "atlas_crop": [0, 0, 3, 2], "geometric_mask": self.geometric,
                "geometric_mask_sha256": "source-mask-sha",
            }
            empty, entries = gates.reviewed_masks(manifest_path, root, **options)
            self.assertEqual(entries, [])
            self.assertFalse(any(value.any() for value in empty.values()))

            source_mask = root / "approved.png"
            self.assertTrue(cv2.imwrite(str(source_mask), self.geometric.astype(np.uint8) * 255))
            _, components = gates.geometric_components(self.geometric, options["atlas_crop"])
            evidence_file = root / "evidence.txt"
            evidence_file.write_text("component verified", encoding="utf-8")
            document = {
                "schemaVersion": 1, "diagnosticModelSha256": "diag",
                "formalBaselineSha256": "formal", "polygonId": "poly171",
                "atlasCropHalfOpen": [0, 0, 3, 2],
                "approvals": [{
                    "sourceId": "145089656", "componentId": 1,
                    "componentMaskSha256": components[0]["componentMaskSha256"],
                    "gate": "semanticOwnership", "status": "approved",
                    "approvedMaskPath": "approved.png",
                    "approvedMaskSha256": gates.file_sha256(source_mask),
                    "geometricMaskSha256": "source-mask-sha",
                    "evidencePath": "evidence.txt",
                    "evidenceSha256": gates.file_sha256(evidence_file),
                    "reviewedBy": "test-review", "reviewNotes": "test only",
                }],
            }
            manifest_path.write_text(json.dumps(document), encoding="utf-8")
            masks, entries = gates.reviewed_masks(manifest_path, root, **options)
            self.assertEqual(len(entries), 1)
            self.assertEqual(int(masks["semanticOwnership"].sum()), 4)
            self.assertFalse(masks["baselineCorrespondence"].any())
            evidence_file.write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "stale"):
                gates.reviewed_masks(manifest_path, root, **options)
            evidence_file.write_text("component verified", encoding="utf-8")
            document["formalBaselineSha256"] = "different"
            manifest_path.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "mismatch"):
                gates.reviewed_masks(manifest_path, root, **options)


if __name__ == "__main__":
    unittest.main()
