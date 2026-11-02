# Landmark same-camera depth render plan

The landmark depth gate must consume a depth buffer rendered from the same
camera used by `texture-building-landmark-photo-project.py`.

Required inputs:

- calibrated camera JSON
- PLATEAU GLB
- source photo resolution

The render path must preserve:

1. OpenCV camera matrix and distortion model used for photo projection.
2. OpenCV rotation/translation convention converted into the renderer camera
   convention.
3. The same pixel coordinate origin as the photo projection output.

The output depth buffer can then be passed to the triangle raster depth gate.

This file documents the invariant discovered during the landmark pipeline
validation: a depth buffer from a different Three.js camera cannot be used for
occlusion validation.
