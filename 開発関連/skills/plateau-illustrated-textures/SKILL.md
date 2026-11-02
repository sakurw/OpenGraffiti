---
name: plateau-illustrated-textures
description: Generate and export PLATEAU building models with native geometry and UVs, apply building-specific illustrated textures, and audit source identity and provenance. Use for OpenGraffiti model generation, texture replacement, and adopted-model verification.
---

# PLATEAU building-specific illustrated textures

Create restrained architectural illustration materials from each building's own visible components, retaining PLATEAU geometry and placement. This produces stylized interpretation, not a measured reconstruction or guaranteed PLATEAU-2D quality.

For current OpenGraffiti generation and export, read [references/opengraffiti-pv.md](references/opengraffiti-pv.md) first. The formal adoption document governs model choice. [references/opengraffiti.md](references/opengraffiti.md) describes historical photo and donor experiments, not the current runtime export procedure.

Preserve native source coordinates, geometry, UVs and building IDs in exported assets. A user-authorized flat preview may translate each whole building vertically at runtime; keep that reversible display transform separate from source geometry and regenerate its hash-linked layout after model changes. Use the `plateau-roads-terrain` skill when changing ground or roads.

## Establish provenance

Fix the road-bounded scope and selected IDs. Identify each source's building and visible component using location, shape and source metadata. Record URL, author/license when available, local path, SHA-256, visible part, occlusion and resolution limits. Rectified PLATEAU photo crops can be evidence, but label them as official aerial/oblique textures rather than street photographs.

Trace actual consumption: source photo → crop/reference → generation request or analysis → selected output → processing → atlas/material → displayed building. A source filename, style reference, or evidenceStatus label alone does not establish this chain. An output hash proves file identity, not that the generator saw the photograph. Mark missing request evidence unverified.

Keep these categories separate per building and per surface when possible:

- Own-building street-photo-conditioned pattern with input/output linkage.
- Own-building official-photo-conditioned pattern with input/output linkage.
- Same-building inference extending observed materials to unseen faces.
- Source-limited interpretation whose source cannot establish facade details.
- Geometry-only procedural fallback without building-specific photographic conditioning.
- Unverified provenance because source identity or the consumption record is missing.

Never count every displayed building as photo-based because some share a style image, list a source path, or originally had PLATEAU photographs.

## Analyze and generate

Inspect material family, color, opaque/glass proportions, window shape/rhythm, piers, bands, plinths, roof, equipment and closed ends. Separate observations from estimates. Roof-only imagery does not establish wall windows; background buildings are not facade references.

Generate a perspective-free module with a finite integer number of complete bays and floors. Use the building photo for content and the requested style reference only for drawing style: muted architectural colors, thin linework, restrained grain and simplified light. Exclude sky, roads, trees, signs, people and photographic shadows. Use image-generation/edit tools according to their instructions; retain the prompt, reference identities, tool result and chosen output hash.

Keep opaque wall, glass, roof and equipment distinct. Extend same-building observed materials onto unobserved surfaces when authorized. If only a generic fallback is available, label it as such. ID-hashed palette colors and default window spacing are not photo-derived.

## Apply to native geometry

Use original downloaded PLATEAU geometry and placement. Intermediate donor meshes may supply artwork, but must not replace scene geometry.

- Respect 3D Tiles REPLACE hierarchy: select the finest representation per building and retain genuine sibling fragments. Do not display ancestor and descendant copies together as ADD siblings.
- Prefer semantic wall/roof classes. Normal, height and area thresholds are only heuristics; inspect parapets, equipment and blank walls.
- Fit an integer number of bays across finite coplanar wall groups, with complete end modules and masonry caps. Keep windows off roofs, equipment, tiny faces and closed walls.
- Distinguish orthometric heights from ellipsoid coordinates and record the datum offset before vertical mapping.
- When baking to native UVs, record projection hit masks; leave misses transparent for explicit inference material. Do not silently retain original photo pixels in own-only atlases.
- Use pixel-footprint filtering for procedural repetition plus mipmaps/anisotropic image filtering. Hard step(fract(uv)) patterns can shimmer even with correct geometry.

## Verify and deliver

Check all selected IDs against rendered IDs, source/output hashes, missing links, and duplicate building occurrences. Inspect wall ends, roof/equipment exclusions, stationary frames and moving-camera behavior. Stationary frame equality only proves stationary stability.

For comparison, show the identical filtered geometry and a shared camera, own material on one side and original PLATEAU image/UV on the other. Keep context consistent, label sides, and verify that own-side raw-photo fallback is absent while the reference side actually has original maps. Both sides must include the complete selected scope.

Serve through HTTP/HTTPS, open the real browser page, inspect pixels, save screenshots and record errors and per-side counts. Report the URL, evidence-category totals, material uncertainties and the per-building evidence file. Build success or HTTP 200 alone is not visible-model verification.
