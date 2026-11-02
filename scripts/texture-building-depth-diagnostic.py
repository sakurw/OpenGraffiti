"""Compare generated triangle depth ranges against a captured linear depth buffer.

This is a diagnostic stage for the landmark visibility pipeline. It does not
modify the coverage score; it identifies whether projection and depth domains
are compatible before visibility tuning.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("triangles")
    parser.add_argument("depth")
    args = parser.parse_args()

    triangles = json.loads(Path(args.triangles).read_text(encoding="utf-8"))["triangles"]
    depth = np.fromfile(args.depth, dtype=np.float32).reshape((768, 1024, 4))[:, :, 0]
    finite = depth[np.isfinite(depth) & (depth > 0)]
    triangle_depths = np.array([z for t in triangles for z in t.get("depths", [])], dtype=float)

    print(json.dumps({
        "depthPixels": int(finite.size),
        "renderDepthRange": [float(finite.min()), float(finite.max())] if finite.size else None,
        "triangleDepthRange": [float(triangle_depths.min()), float(triangle_depths.max())] if triangle_depths.size else None,
        "triangleCount": len(triangles),
    }))


if __name__ == "__main__":
    main()
