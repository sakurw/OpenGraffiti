# OpenGraffiti implementation

Paths below are relative to `E:/OpenGraffiti`, as of 2026-10-19. Recheck assets and counts. Commands run from that repository in PowerShell.

## Current entry points

- `public/assets/tocho-twelve-blocks-20261019/scope.json`: IDs, street polygons, native batch selection and LOD filtering.
- `public/tocho-texture-comparison-20261019.html`: shared-camera own/native texture comparison and provenance table.
- `public/tocho-twelve-blocks-own-only-review-20261019.html`: original own-only view.
- `scripts/tocho-nine-blocks-own-viewer-20261018.js`: common renderer; `data-scope-base` sets scope and `data-compare="true"` enables comparison despite its historical filename.
- `scripts/audit-tocho-texture-provenance-20261019.mjs`: regenerate evidence report. Inspect its output rather than treating metadata labels as proof.

The renderer's expanded buildings without profiles use ID-hashed colors, default bay/floor dimensions and shape heuristics. This is **geometry-only procedural fallback**, not per-building photographic generation. The historical atlas has 83 donors, which does not establish photo conditioning for all 127 buildings; even those 83 include source-limited inference.

## Photo-to-artwork chain

Locate the building record before using these historical scripts:

1. `scripts/collect-tocho-district-landmark-photos-20261018.mjs` and `scripts/collect-tocho-district-park-photos-20261018.mjs`: downloaded source manifests in `data/texture-city/tocho-district-photo-v2-20261018/`.
2. `scripts/prepare-tocho-district-photo-art-jobs-20261018.mjs`: inspected wall crops/street photos, observed features and prompts. Its style reference is not building identity evidence.
3. `scripts/assemble-tocho-district-photo-profiles-20261018.mjs`: initial generated output-to-building linkage.
4. `scripts/assemble-tocho-district-photo-v3-20261018.mjs`: remaining-building results, selected-image hashes, inference labels and retained central asset.
5. `public/assets/tocho-district-photo-v3-20261018/photo-profiles.json`, `artwork-provenance.json`, `artwork/`: actual profiles, output images and recorded provenance.
6. `scripts/build-tocho-district-photo-v3-20261018.mjs`: donor appearance/mapping and exclusions. Donor geometry is not the final native scene geometry.
7. `scripts/build-tocho-own-only-atlases-20261018.mjs`: BVH projection of donor appearance onto native UVs, with datum conversion and hit masks. It uses official image dimensions, not their pixels; unmatched pixels are transparent.

Central Tocho retains `public/assets/tocho-landmark/whole-illustrated-20261018/tocho-whole-illustrated-v1.glb`. Trace wall-hour generation separately: the central profile's illustrated PNG is an intermediate, not a raw photograph.

For a new photo-conditioned building, identify its own source, record a real generation request/result, then extend profile/donor inputs and atlas projection. Adding an ID to the scope only activates fallback. Legacy generators have fixed 83/82/46 counts and paths; adapt deliberately instead of assuming universal support. Use image generation/edit tools for new raster materials according to their instructions.

## Scope, official geometry and LOD

Original ZIP and unmodified B3DMs: `public/assets/plateau-official-shinjuku-2025/`. Use the `_bldg_3dtiles_13104_shinjuku-ku_lod2` source. `_no_texture` is an alternative representation, not a second overlay.

`prepare-tocho-nine-blocks-20261018.mjs` selects real enclosed road components from a raster and accepts output path, optional PLAZA+ seed, then JSON extra block ID/seed pairs. `build-tocho-nine-blocks-index-20261018.mjs` retains the finest selected descendants per building and emits runtime indexes. Verify all IDs survive and ancestor copies disappear.

Example derived-scope rebuild (overwrites that scope's derived assets):

```powershell
$tochoNode = '.tools/node-v24.20.0-win-x64/node.exe'
& $tochoNode scripts/prepare-tocho-nine-blocks-20261018.mjs public/assets/tocho-twelve-blocks-20261019 '[250,-40]' '[["PLAZA-L",[210,-220]],["PLAZA-R",[280,150]]]'
& $tochoNode scripts/build-tocho-nine-blocks-index-20261018.mjs public/assets/tocho-twelve-blocks-20261019
& $tochoNode scripts/build-tocho-nine-blocks-viewer-20261018.mjs
& $tochoNode scripts/audit-tocho-texture-provenance-20261019.mjs
```

Preserve needed manually attached scope metadata before scope preparation. Do not restart a healthy server or regenerate artwork just to audit existing results.

Verify existing atlases without rebaking:

```powershell
& .tools/node-v24.20.0-win-x64/node.exe scripts/build-tocho-own-only-atlases-20261018.mjs --verify
```

The browser runtime uses `.tools/plateau-official-viewer/node_modules`, local Draco, logarithmic depth and a larger tile cache. B3DM numeric batch properties can be binary descriptors rather than JSON arrays. Orthometric source heights need conversion to the viewer's ellipsoid frame.

## Evidence artifacts

- `public/assets/tocho-twelve-blocks-20261019/texture-provenance.json`: current per-building audit.
- `data/texture-city/tocho-twelve-blocks-20261019/texture-provenance-report.md`: readable findings and limits.
- `data/texture-city/tocho-twelve-blocks-20261019/scope-audit.json`: unique IDs and selected batches.
- Browser screenshots/verification under `data/texture-city/tocho-texture-comparison-20261019/`.

The viewer currently uses port 3110. Check the server and current page before reporting a URL. Historical counts and screenshots do not establish current photo coverage or moving-camera stability.
