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
