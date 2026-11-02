# OpenGraffiti road and ground generation

Workspace `E:/OpenGraffiti`; adopted native assets: `public/assets/pv-adopted-20261029/`. Inspect current script inputs and output hashes before rebuilding. These are dependency layers, not an instruction to regenerate all assets for every change.

1. `build-pv-roads.mjs` derives the district list from source road polygons. `scripts/pv-road-selection.json` preserves selection identity. Retain original rings, source IDs and district-wide building coverage; inspect `src/pv-street.ts` for section selection.
2. `build-pv-official-dem.mjs` and `pv-official-frame.mjs` establish official DEM coordinates. The source is under `data/plateau/plateau-13104-shinjuku-ku-2025/udx/dem/`. Verify the exact input named in the script; local mesh height is not an independent elevation datum.
3. `build-pv-road-coverage.mjs` derives road coverage. `build-pv-walk-surface.mjs` derives shared walking inputs. `build-pv-smooth-terrain.mjs` builds contact-constrained terrain; preserve building-ground contacts and audit before accepting a new solve.
4. `build-pv-flat-layout.mjs` derives hash-linked flat preview offsets. Preserve constrained terrain assets. Never bake flat offsets into `city.glb` or authoritative coordinates.

Road coverage is a material layer on shared ground, avoiding overlapping road and terrain meshes. Inspect `src/pv-scene.ts` and its terrain imports for rendering and collision consumers; do not restore obsolete road-height/closure experiments merely because their scripts exist.

Verification entrypoints: `audit-pv-native-coordinates.mjs`, `audit-pv-official-dem.mjs`, `audit-pv-road-profile.mjs`, `test-pv-flat-layout.mjs`, and terrain/contact assertions in `tests/pv/revision.spec.ts`. Inspect arguments before execution. Run TypeScript/build checks and applicable Playwright regressions. Compare every building base with the chosen ground mode, not only a smoothness metric. Include street soil, boundaries, junctions, walking collisions and camera ground clamps in GUI verification.

Startup: `scripts/start-opengraffiti.ps1 -Terrain flat` or `-Terrain constrained`. Retain both paths and query overrides when changing defaults. Record prior asset hashes and preserve outputs in a recovery directory before regeneration. Vite builds that skip copying `public` do not update served terrain assets automatically.

Skill source: `開発関連/skills/plateau-roads-terrain/`. Install with `scripts/sync-opengraffiti-skills.ps1`; verify with `-Check`. The sync script manages only the two named project skills.

## Expanded district (2026-11-02)

The default runtime scope is `public/assets/pv-expanded-20261102/`: 3,492 whole native buildings within a 1,700m square around the original scope, plus 1,867 source road polygons. The original 127-building scope remains under `pv-adopted-20261029/`; `?scope=original` restores it. `?scope=expanded` selects the new scope. Both support flat and constrained terrain modes independently.

Run `node scripts/build-pv-expanded-district.mjs` only when rebuilding the expanded dependencies. It selects native batches, removes ancestor LOD alternatives, preserves original part keys, exports a separate GLB, then derives DEM, road material coverage, constrained ground, flat offsets and road selection. Download inputs and exact consumed tile hashes are recorded in the expanded source `source-downloads.json` and model manifest. Large original downloads remain ignored. Use the bundled Node 24 runtime. Dependencies of the native index builder are under `.tools/plateau-official-viewer/`.

Run `node scripts/audit-pv-expansion.mjs`: all original 254 building parts must retain byte-identical attributes/UVs, all original 184 road rings must match, no ancestor batch overlap may remain, and all 3,492 flat ground contacts must have zero error. Verify both street sides and actual drawing in GUI. Expanded constrained terrain preserves an elevated connector and a documented 12cm source boundary difference; the flat preview is separate and does not certify original heights. New material coverage is procedural where no adopted own-only atlas exists. Do not describe it as newly photographically certified.

Road JSON omits repeated district-sized building lists; `pv-data.ts` derives and caches sides lazily. Keep road geometry unchanged. The large constrained-ground solver uses local spatial bins, retaining exact contact tests and the existing far-field fallback. Keep model/output environment overrides scoped to the explicit regeneration command.
