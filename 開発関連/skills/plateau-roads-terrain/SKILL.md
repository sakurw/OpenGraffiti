---
name: plateau-roads-terrain
description: Generate PLATEAU roads and terrain, align building ground contacts, verify walkability and polygon continuity, and maintain reversible flat previews. Use for OpenGraffiti road or ground generation, floating or buried models, surface cracks, and road layering.
---

# PLATEAU roads and terrain

For OpenGraffiti, read [references/opengraffiti.md](references/opengraffiti.md) for inputs, scripts, verification and recovery. Establish the authoritative coordinate frame and elevation datum before changing heights. Distinguish original PLATEAU data, contact-constrained terrain, and the user-authorized flat PV display.

## Preserve topology and identity

Use original road polygons, including nonrectangular boundaries and holes. Keep source IDs and derive navigable centerlines from polygon topology; a bounding-box axis is not a substitute for a curved or branching road. Keep roads crossing district boundaries continuous. Check selection overlays against the rendered road footprint.

## Align ground and buildings

Use a shared surface for rendered ground, road height and walking collision. Define road versus ground material priority explicitly, including boundaries, to prevent flicker or ground appearing through roads. A small display bias must not alter authoritative elevations or create collision steps.

For constrained terrain, preserve building-ground contact constraints while smoothing surrounding surfaces. Do not pull terrain toward roof vertices or elevated structures. Resolve outlier provenance before treating it as ground. For a flat preview, use one plane and translate each whole building vertically using its ground contact; preserve shape, horizontal coordinates, UVs and source files. Keep constrained assets and a working restoration launcher.

## Verify and deliver

Audit all building contacts and road edges, not only a chosen view. Check cracks, intersections, road-ground continuity, below-ground visibility, collision, walking height and both sides of street elevations. Record hashes, modes and tolerances with results. Validate the actual browser and published asset directory after generation. Candidate files and partial audits must not be reported as accepted full coverage.
