# Current OpenGraffiti model workflow

Workspace: `E:/OpenGraffiti`. Authority: `開発関連/設計/PLATEAU建物テクスチャ生成/正式採用方式.md`. Read it before choosing models or regenerating materials. Historical donor or reconstruction outputs must not replace formally adopted native-UV models.

Current runtime: `/areas/tocho/city`, default port 3100. Exporter: `scripts/build-pv-adopted-model.mjs`; inspect its inputs and `PV_MODEL_OUT` candidate output option before running. Runtime assets are under `public/assets/pv-adopted-20261029/`. Preserve manifest building IDs, material/part keys, bounds, texture mappings, native positions and UVs. Check both public files and assets served from `dist` when publishing changes.

Before rebuilding, run `scripts/audit-pv-native-coordinates.mjs` and inspect exporter inputs and the formal document. Verify atlas provenance with the applicable own-only atlas verifier rather than inferring identity from filenames. A hash proves file identity, not photographic registration. Keep observed, inferred, source-limited and procedural material categories explicit; do not claim universal photographic certification from a successful export.

Export to a separate candidate directory. Compare source and candidate building coverage, source identities, geometry/UV preservation, triangle counts, bounds, material keys and provenance. Inspect city, isolated drawing, gallery and street views. Promote after the intended scope passes and preserve previous files for recovery. Regenerate dependent road coverage, constrained contacts or flat layout when their input hashes or bounds changed.

Flat PV mode is a reversible runtime vertical offset per whole building. It does not modify source geometry or certify native source heights. Use the roads/terrain skill for generation and recovery. Keep the original contact-constrained mode available.

Version-controlled skill source: `開発関連/skills/plateau-illustrated-textures/`. Run `scripts/sync-opengraffiti-skills.ps1` after edits, then `-Check` to verify installed copies. Retain the historical reference for tracing old experiments.

## Expanded district (2026-11-02)

The default runtime scope is `public/assets/pv-expanded-20261102/`: 3,492 whole native buildings within a 1,700m square around the original scope, plus 1,867 source road polygons. The original 127-building scope remains under `pv-adopted-20261029/`; `?scope=original` restores it. `?scope=expanded` selects the new scope. Both support flat and constrained terrain modes independently.

Run `node scripts/build-pv-expanded-district.mjs` only when rebuilding the expanded dependencies. It selects native batches, removes ancestor LOD alternatives, preserves original part keys, exports a separate GLB, then derives DEM, road material coverage, constrained ground, flat offsets and road selection. Download inputs and exact consumed tile hashes are recorded in the expanded source `source-downloads.json` and model manifest. Large original downloads remain ignored. Use the bundled Node 24 runtime. Dependencies of the native index builder are under `.tools/plateau-official-viewer/`.

Run `node scripts/audit-pv-expansion.mjs`: all original 254 building parts must retain byte-identical attributes/UVs, all original 184 road rings must match, no ancestor batch overlap may remain, and all 3,492 flat ground contacts must have zero error. Verify both street sides and actual drawing in GUI. Expanded constrained terrain preserves an elevated connector and a documented 12cm source boundary difference; the flat preview is separate and does not certify original heights. New material coverage is procedural where no adopted own-only atlas exists. Do not describe it as newly photographically certified.

Road JSON omits repeated district-sized building lists; `pv-data.ts` derives and caches sides lazily. Keep road geometry unchanged. The large constrained-ground solver uses local spatial bins, retaining exact contact tests and the existing far-field fallback. Keep model/output environment overrides scoped to the explicit regeneration command.
