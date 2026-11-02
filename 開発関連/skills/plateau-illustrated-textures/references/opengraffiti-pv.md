# Current OpenGraffiti model workflow

Workspace: `E:/OpenGraffiti`. Authority: `開発関連/設計/PLATEAU建物テクスチャ生成/正式採用方式.md`. Read it before choosing models or regenerating materials. Historical donor or reconstruction outputs must not replace formally adopted native-UV models.

Current runtime: `/areas/tocho/city`, default port 3100. Exporter: `scripts/build-pv-adopted-model.mjs`; inspect its inputs and `PV_MODEL_OUT` candidate output option before running. Runtime assets are under `public/assets/pv-adopted-20261029/`. Preserve manifest building IDs, material/part keys, bounds, texture mappings, native positions and UVs. Check both public files and assets served from `dist` when publishing changes.

Before rebuilding, run `scripts/audit-pv-native-coordinates.mjs` and inspect exporter inputs and the formal document. Verify atlas provenance with the applicable own-only atlas verifier rather than inferring identity from filenames. A hash proves file identity, not photographic registration. Keep observed, inferred, source-limited and procedural material categories explicit; do not claim universal photographic certification from a successful export.

Export to a separate candidate directory. Compare source and candidate building coverage, source identities, geometry/UV preservation, triangle counts, bounds, material keys and provenance. Inspect city, isolated drawing, gallery and street views. Promote after the intended scope passes and preserve previous files for recovery. Regenerate dependent road coverage, constrained contacts or flat layout when their input hashes or bounds changed.

Flat PV mode is a reversible runtime vertical offset per whole building. It does not modify source geometry or certify native source heights. Use the roads/terrain skill for generation and recovery. Keep the original contact-constrained mode available.

Version-controlled skill source: `開発関連/skills/plateau-illustrated-textures/`. Run `scripts/sync-opengraffiti-skills.ps1` after edits, then `-Check` to verify installed copies. Retain the historical reference for tracing old experiments.
