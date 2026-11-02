"""Create PnP correspondence files from landmark registration controls.

This keeps the manual landmark measurements as the source of truth and only
adapts them to the PnP solver input format. It does not validate a pose.
"""

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source = json.loads(Path(args.inputs).read_text(encoding="utf-8"))
    outputs = []
    for item in source.get("inputs", []):
        outputs.append(
            {
                "sourceId": item["sourceId"],
                "photo": item["photo"],
                "correspondences": [
                    {"world": c["world"], "pixel": c["pixel"], "name": c.get("name")}
                    for c in item.get("controls", [])
                    if len(c.get("world", [])) == 3 and len(c.get("pixel", [])) == 2
                ],
            }
        )

    result = {"status": "landmark-pnp-correspondence-inputs", "photoCount": len(outputs), "photos": outputs}
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"photoCount": len(outputs)}))


if __name__ == "__main__":
    main()
